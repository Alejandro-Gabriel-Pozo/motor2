import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { MENSAJE_CUENTA_NO_ENCONTRADA } from "@/core/features/cuentas/cuenta.guard";
import type { CodigoQuitarUnidadesDeLinea, ComandoQuitarUnidadesDeLinea, DatosQuitarUnidadesDeLinea, ResultadoQuitarUnidadesDeLinea } from "@/core/features/cuentas/cuenta.schema";
import { calcularPayloadHash, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { armarTicketVigente } from "@/core/pos/ticket";
import { formatearNumeroTicket } from "@/core/pos/numeracion-ticket";
import { frasesDePuesto } from "@/core/pos/puesto";
import { exito, fracaso, type Fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { chequearIdempotencia, registrarResultadoIdempotente } from "@/server/persistencia/movimientos/idempotencia";
import { cargarCuentaParaCorregirTicket } from "@/server/persistencia/pos/cargar-cuenta-para-corregir-ticket";
import { reemplazarVentaConMenosUnidadesEnTx } from "@/server/actions/movimientos/casos-de-uso/reemplazar-venta-con-menos-unidades";
import { emitirTicketCorregidoEnTx } from "./emitir-ticket-corregido";

/**
 * Caso de uso «quitar unidades de una línea de una cuenta cerrada» (E1 de la corrección por ajuste, docs/diseno-correccion-por-ajuste-2026-11-06.md): «cobré 2 cervezas y la
 * mesa tomó 1». Lo registrado no se edita: la venta A se REEMPLAZA por una venta B con lo que queda (contra-asiento enlazado, marca en A con el motivo, B enlazada con
 * `reemplazaAOperacionId`) y se emite el ticket corregido (el ejemplar siguiente, `corrigeAId` al A). La unidad quitada vuelve al stock (se asume que no se sirvió).
 * Mismo molde que `corregirLineaDeTicketCasoDeUso` (E0), que es el camino de la línea ENTERA.
 *
 * `import "server-only"` y SIN `"use server"`. No chequea permisos (la Server Action pide `anular_venta` y `pos_emitir_ticket_corregido`) ni el formato
 * (`guardComandoQuitarUnidadesDeLinea`).
 *
 * UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento), todo o nada:
 *  1. I3: la huella del comando y `chequearIdempotencia` (un reenvío exacto devuelve el mensaje ORIGINAL; la misma clave con otro contenido es conflicto);
 *  2. carga de la cuenta de ESTA sucursal; cerrada, con número, y la venta pedida tiene que ser la VIGENTE de una de sus líneas;
 *  3. guarda optimista: el último ejemplar y el total que la persona vio tienen que ser los guardados (si no, `LA_CUENTA_CAMBIO`);
 *  4. el reemplazo de la venta (`reemplazarVentaConMenosUnidadesEnTx`, de Movimientos): la decisión pura (`evaluarCorreccionPorUnidades`: venta vigente y no reemplazada, lo que la
 *     persona vio, promo, adicionales, unidades válidas, D7) y, si pasa, el contra-asiento R de A con la clave en él, la venta nueva B y la auditoría antes/después.
 *     Quitar todas las unidades responde `ALCANCE_TOTAL` (es anular la línea entera);
 *  6. el ticket corregido (`emitirTicketCorregidoEnTx`); si no se puede, se DESHACE todo lanzando, porque un `fracaso` confirmaría lo escrito;
 *  7. el mensaje de I3.
 * Dos correcciones a la vez de la misma venta: los índices únicos de `revierteAOperacionId` y `reemplazaAOperacionId` (y SERIALIZABLE) hacen ganar a una; la otra, al reintentar,
 * ve la venta ya reemplazada y responde «la venta cambió mientras la corregías».
 *
 * @contract Reemplaza una venta por otra con menos unidades y emite el ticket corregido, exactamente una vez por claveIdempotencia, o no hace nada.
 * @idempotency I3 (claveIdempotencia + payloadHash en el contra-asiento de la venta pedida), dentro de la misma transacción; además la guarda optimista del ejemplar y el total vistos.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (la anulación de A, las unidades antes y después, y el ejemplar nuevo).
 * @ficha permiso=anular_venta transaccion=SERIALIZABLE idempotencia=I3 auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */

/** Se lanza para DESHACER la transacción cuando un paso posterior a las escrituras no se puede; se atrapa afuera y sale como el fracaso que trae. */
class CorreccionNoAplicable extends Error {
  constructor(readonly fracaso: Fracaso<CodigoQuitarUnidadesDeLinea>) {
    super(fracaso.mensaje);
  }
}

export async function quitarUnidadesDeLineaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion" | "ahora">,
  comando: ComandoQuitarUnidadesDeLinea
): Promise<ResultadoQuitarUnidadesDeLinea> {
  const { cuentaId, operacionId, unidadesAQuitar, unidadesVistas, motivo, ejemplarVisto, totalVisto, claveIdempotencia } = comando;
  const payloadHash = calcularPayloadHash("QUITAR_UNIDADES_DE_LINEA", actor.sucursalId, { cuentaId, operacionId, unidadesAQuitar, unidadesVistas, motivo, ejemplarVisto, totalVisto });

  try {
    // `true`: dos correcciones simultáneas del mismo ticket chocan en el ejemplar duplicado o en los enlaces únicos; la que pierde repite y ve lo nuevo.
    return await conTransaccionSerializable(
      actor.transaccion,
      async (tx): Promise<ResultadoQuitarUnidadesDeLinea> => {
        const cuenta = await cargarCuentaParaCorregirTicket(tx, { cuentaId, sucursalId: actor.sucursalId });

        const chequeo = await chequearIdempotencia(tx, claveIdempotencia, payloadHash);
        if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
        if (chequeo.estado === "duplicado") {
          const [ultimoRepetido] = cuenta?.ejemplares ?? [];
          return exito(chequeo.mensaje, { numero: ultimoRepetido?.numero ?? 0, ejemplar: ultimoRepetido?.ejemplar ?? 0, ventaNuevaId: null, unidadesQueQuedan: 0, repetida: true });
        }

        if (!cuenta) return fracaso("NO_ENCONTRADA", MENSAJE_CUENTA_NO_ENCONTRADA);
        const puesto = frasesDePuesto(cuenta.mesaNumero);
        if (!cuenta.cerradaEn) return fracaso("CUENTA_ABIERTA", `La cuenta ${puesto.del} todavía está abierta: no tiene ticket que corregir.`);
        const [ultimo] = cuenta.ejemplares;
        if (!ultimo || !cuenta.ejemplares.some((e) => e.ejemplar === 1)) {
          return fracaso("SIN_NUMERACION", `La cuenta ${puesto.del} se cerró antes de la numeración de tickets: no tiene ticket que corregir.`);
        }
        // La venta pedida es la VIGENTE de una línea de esta cuenta: la suya, o la última corrección si la línea ya se corrigió por unidades.
        const esDeLaCuenta = cuenta.items.some((i) => (i.versionesDeLaVenta?.length ? i.versionesDeLaVenta[i.versionesDeLaVenta.length - 1]!.operacionId : i.operacionId) === operacionId);
        if (!esDeLaCuenta) return fracaso("LINEA_DE_OTRA_CUENTA", "Esa línea no es de esta cuenta, o ya no es la vigente.");

        // Guarda optimista: lo que la persona vio es lo guardado.
        const total = armarTicketVigente(cuenta.items, actor.ahora, cuenta.descuentoPorcentaje).total;
        if (ultimo.ejemplar !== ejemplarVisto || Math.abs(total - totalVisto) >= 0.005) {
          return fracaso("LA_CUENTA_CAMBIO", `El ticket cambió mientras lo corregías (ahora vale ${formatearNumeroTicket(ultimo)}): revisá la cuenta y volvé a intentar.`);
        }

        // El reemplazo de la venta es de Movimientos (dueño del Kardex): reglas puras, D7, contra-asiento, venta nueva y auditoría de las unidades.
        const reemplazo = await reemplazarVentaConMenosUnidadesEnTx(tx, actor, { operacionId, unidadesAQuitar, unidadesVistas, motivo }, { claveIdempotencia, payloadHash });
        if (!reemplazo.ok) return fracaso(reemplazo.codigo, reemplazo.mensaje);
        const { ventaNuevaId, unidadesQueQuedan: quedan, reversionId } = reemplazo.datos;

        const emitida = await emitirTicketCorregidoEnTx(tx, actor, { cuentaId, motivo });
        if (!emitida.ok) {
          // Ya se escribió la corrección: un `fracaso` devuelto confirmaría la transacción a medias. Se deshace entera.
          throw new CorreccionNoAplicable(fracaso(emitida.codigo, emitida.mensaje));
        }

        const mensaje = `Se quitaron ${unidadesAQuitar} unidad(es): la línea quedó en ${quedan}. ${emitida.mensaje}`;
        await registrarResultadoIdempotente(tx, reversionId, mensaje);
        const datos: DatosQuitarUnidadesDeLinea = { numero: emitida.datos.numero, ejemplar: emitida.datos.ejemplar, ventaNuevaId, unidadesQueQuedan: quedan, repetida: false };
        return exito(mensaje, datos);
      },
      undefined,
      undefined,
      true
    );
  } catch (e) {
    if (e instanceof CorreccionNoAplicable) return e.fracaso;
    throw e;
  }
}

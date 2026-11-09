import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { MENSAJE_CUENTA_NO_ENCONTRADA } from "@/core/features/cuentas/cuenta.guard";
import type { CodigoCorregirLineaDeTicket, ComandoCorregirLineaDeTicket, DatosCorregirLineaDeTicket, ResultadoCorregirLineaDeTicket } from "@/core/features/cuentas/cuenta.schema";
import { armarTicketVigente } from "@/core/pos/ticket";
import { formatearNumeroTicket } from "@/core/pos/numeracion-ticket";
import { frasesDePuesto } from "@/core/pos/puesto";
import { exito, fracaso, type Fracaso } from "@/core/resultado-caso";
import { calcularPayloadHash, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { chequearIdempotencia, registrarResultadoIdempotente } from "@/server/persistencia/movimientos/idempotencia";
import { cargarCuentaParaCorregirTicket } from "@/server/persistencia/pos/cargar-cuenta-para-corregir-ticket";
import { anularVentaEnTx } from "@/server/actions/movimientos/casos-de-uso/anular-venta";
import { emitirTicketCorregidoEnTx } from "./emitir-ticket-corregido";

/**
 * Caso de uso «corregir una línea de una cuenta cerrada» (E0 de la corrección por ajuste, docs/diseno-correccion-por-ajuste-2026-11-06.md). Lo registrado no se
 * edita: la línea se ANULA ENTERA (contra-asiento enlazado, con el motivo en la venta) y se emite el ticket corregido (el ejemplar siguiente, `corrigeAId` al A),
 * antes en tres pantallas y dos pasos que podían quedar a medias. Reutiliza los cuerpos de `anularVentaCasoDeUso` y `emitirTicketCorregidoCasoDeUso`.
 *
 * `import "server-only"` y SIN `"use server"`. No chequea permisos (la Server Action pide `anular_venta` y `pos_emitir_ticket_corregido`) ni el formato
 * (`guardComandoCorregirLineaDeTicket`).
 *
 * UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento), todo o nada:
 *  1. I3: la huella del comando y `chequearIdempotencia` (un reenvío exacto devuelve el mensaje ORIGINAL; la misma clave con otro contenido es conflicto);
 *  2. carga de la cuenta de ESTA sucursal; cerrada, con número, y la venta pedida tiene que ser de la cuenta;
 *  3. guarda optimista: el último ejemplar y el total que la persona vio tienen que ser los guardados (si no, `LA_CUENTA_CAMBIO`: otra persona ya corrigió);
 *  4. anular la venta (`anularVentaEnTx`: promo entera, adicionales con su producto, D7 si hubo conteo o pago a consignante posterior) con la clave en su contra-asiento;
 *  5. emitir el ticket corregido (`emitirTicketCorregidoEnTx`); si no se puede (era la última línea), se DESHACE todo lanzando, porque un `fracaso` confirmaría la anulación;
 *  6. el mensaje de I3.
 * Dos correcciones a la vez, o una corrección y una anulación: SERIALIZABLE hace perder a una, que al reintentar ve la línea ya anulada o el ejemplar nuevo.
 *
 * @contract Corrige una línea de una cuenta cerrada anulándola entera y emitiendo el ticket corregido, exactamente una vez por claveIdempotencia, o no hace nada.
 * @idempotency I3 (claveIdempotencia + payloadHash en el contra-asiento de la venta pedida), dentro de la misma transacción; además la guarda optimista del ejemplar y el total vistos.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (la anulación de cada venta y el ejemplar nuevo).
 * @ficha permiso=anular_venta transaccion=SERIALIZABLE idempotencia=I3 auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */

/** Se lanza para DESHACER la transacción cuando un paso posterior a las escrituras no se puede; se atrapa afuera y sale como el fracaso que trae. */
class CorreccionNoAplicable extends Error {
  constructor(readonly fracaso: Fracaso<CodigoCorregirLineaDeTicket>) {
    super(fracaso.mensaje);
  }
}

export async function corregirLineaDeTicketCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion" | "ahora">,
  comando: ComandoCorregirLineaDeTicket
): Promise<ResultadoCorregirLineaDeTicket> {
  const { cuentaId, operacionId, motivo, ejemplarVisto, totalVisto, claveIdempotencia } = comando;
  const payloadHash = calcularPayloadHash("CORREGIR_LINEA_DE_TICKET", actor.sucursalId, { cuentaId, operacionId, motivo, ejemplarVisto, totalVisto });

  try {
    // `true`: dos correcciones simultáneas del mismo ticket chocan en el ejemplar duplicado; la que pierde repite y ve el ejemplar nuevo (`LA_CUENTA_CAMBIO`).
    return await conTransaccionSerializable(
      actor.transaccion,
      async (tx): Promise<ResultadoCorregirLineaDeTicket> => {
        const cuenta = await cargarCuentaParaCorregirTicket(tx, { cuentaId, sucursalId: actor.sucursalId });

        const chequeo = await chequearIdempotencia(tx, claveIdempotencia, payloadHash);
        if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
        if (chequeo.estado === "duplicado") {
          const [ultimoRepetido] = cuenta?.ejemplares ?? [];
          return exito(chequeo.mensaje, { numero: ultimoRepetido?.numero ?? 0, ejemplar: ultimoRepetido?.ejemplar ?? 0, operacionesAnuladas: [], repetida: true });
        }

        if (!cuenta) return fracaso("NO_ENCONTRADA", MENSAJE_CUENTA_NO_ENCONTRADA);
        const puesto = frasesDePuesto(cuenta.mesaNumero);
        if (!cuenta.cerradaEn) return fracaso("CUENTA_ABIERTA", `La cuenta ${puesto.del} todavía está abierta: no tiene ticket que corregir.`);
        const [ultimo] = cuenta.ejemplares;
        if (!ultimo || !cuenta.ejemplares.some((e) => e.ejemplar === 1)) {
          return fracaso("SIN_NUMERACION", `La cuenta ${puesto.del} se cerró antes de la numeración de tickets: no tiene ticket que corregir.`);
        }
        // La venta pedida es la VIGENTE de una línea: la suya, o (E1) la última corrección si la línea ya se corrigió quitando unidades.
        const vigenteDe = (i: (typeof cuenta.items)[number]) => (i.versionesDeLaVenta?.length ? i.versionesDeLaVenta[i.versionesDeLaVenta.length - 1]!.operacionId : i.operacionId);
        if (!cuenta.items.some((i) => vigenteDe(i) === operacionId)) return fracaso("LINEA_DE_OTRA_CUENTA", "Esa línea no es de esta cuenta.");

        // Guarda optimista: lo que la persona vio es lo guardado.
        const total = armarTicketVigente(cuenta.items, actor.ahora, cuenta.descuentoPorcentaje).total;
        if (ultimo.ejemplar !== ejemplarVisto || Math.abs(total - totalVisto) >= 0.005) {
          return fracaso("LA_CUENTA_CAMBIO", `El ticket cambió mientras lo corregías (ahora vale ${formatearNumeroTicket(ultimo)}): revisá la cuenta y volvé a intentar.`);
        }

        const anulada = await anularVentaEnTx(tx, actor, { operacionId, motivo }, { claveIdempotencia, payloadHash });
        if (!anulada.ok) return fracaso(anulada.codigo, anulada.mensaje);

        const emitida = await emitirTicketCorregidoEnTx(tx, actor, { cuentaId, motivo });
        if (!emitida.ok) {
          // Ya se escribió la anulación: un `fracaso` devuelto confirmaría la transacción a medias. Se deshace entera.
          throw new CorreccionNoAplicable(
            emitida.codigo === "VENTA_ANULADA"
              ? fracaso("ULTIMA_LINEA", "Es la única línea que sigue vendida: no queda ticket que corregir. Si hay que anular toda la venta, usá «Anular venta» en Trazabilidad.")
              : fracaso(emitida.codigo, emitida.mensaje)
          );
        }

        const mensaje = `${emitida.mensaje} ${anulada.mensaje}`;
        await registrarResultadoIdempotente(tx, anulada.datos.reversionIds[0]!, mensaje);
        const datos: DatosCorregirLineaDeTicket = { numero: emitida.datos.numero, ejemplar: emitida.datos.ejemplar, operacionesAnuladas: anulada.datos.operacionesAnuladas, repetida: false };
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

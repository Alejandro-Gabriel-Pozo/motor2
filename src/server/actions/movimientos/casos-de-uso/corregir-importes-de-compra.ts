import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { construirReversion, evaluarCorreccionDeImportes, mensajeCorreccionDeImportes, rechazoPorCompraDeFactura } from "@/core/compras/public";
import { MENSAJE_OPERACION_NO_ENCONTRADA } from "@/core/features/compras/compra.guard";
import type { ComandoCorregirImportesDeCompra, ResultadoCorregirImportes } from "@/core/features/compras/compra.schema";
import { detalleReversionDeCompra } from "@/core/movimientos/public";
import { calcularPayloadHash, esChoqueDeFacturaUnica, MENSAJE_CONFLICTO_IDEMPOTENCIA, MENSAJE_FACTURA_DUPLICADA } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { LARGO_MAXIMO_MOTIVO_ANULACION } from "@/core/texto";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarCompraParaCorregirImportes } from "@/server/persistencia/compras/cargar-compra-para-corregir-importes";
import { escribirCorreccionDeCompraPorEjemplar } from "@/server/persistencia/compras/escribir-correccion-de-compra-por-ejemplar";
import { chequearIdempotencia, registrarResultadoIdempotente } from "@/server/persistencia/movimientos/idempotencia";

/**
 * Caso de uso «corregir los importes de una compra» por ejemplar (etapa C0, docs/diseno-correccion-de-compras-2026-11-06.md). La compra original queda CONGELADA (se anula con su contra-asiento, con el motivo, y no se edita en
 * nada más) y un ejemplar nuevo la reemplaza con las mismas cantidades, productos, secciones y lotes y los importes corregidos. Como el stock no cambia, corregir un importe NUNCA depende de que lo comprado siga en stock.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (lo hizo `conPermiso("corregir_compra")` en la Server Action) ni el formato (`guardComandoCorregirImportesDeCompra`).
 *
 * Todo corre dentro de UNA transacción SERIALIZABLE (con reintento ante un conflicto de escritura o un choque de índice único), y cada rechazo sale ANTES de escribir:
 *  1. idempotencia I3 (huella del pedido): un reenvío exacto devuelve el mensaje ORIGINAL; la misma clave con otro contenido es conflicto;
 *  2. carga de la compra de ESTA sucursal;
 *  3. guardas: es una COMPRA, no está anulada ni reemplazada (si ya la corrigió otra persona, se avisa que ya no es la vigente: guarda optimista, y dos correcciones a la vez dejan UNA sola ganadora), y no es la parte de una factura repartida;
 *  4. reglas puras (`evaluarCorreccionDeImportes`): renglones de la compra, importes en centavos válidos y al menos un cambio;
 *  5. el motivo: tiene que ser un motivo ACTIVO del catálogo configurable, de los que se ofrecen en correcciones (ámbito CORRECCION o TODOS);
 *  6. escritura (contra-asiento + marca de reemplazada + ejemplar nuevo con sus líneas) y auditoría por renglón corregido;
 *  7. el resultado para la idempotencia.
 *
 * @contract Corrige los importes de una compra vigente dejando la original intacta y un ejemplar nuevo que la reemplaza, exactamente una vez por claveIdempotencia.
 * @idempotency I3 (claveIdempotencia + payloadHash), dentro de la misma transacción; además el reemplazo es único por compra (índice único de la base).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (uno por renglón cuyo importe cambió).
 * @ficha permiso=corregir_compra transaccion=SERIALIZABLE idempotencia=I3 auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function corregirImportesDeCompraCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion" | "ahora">,
  comando: ComandoCorregirImportesDeCompra
): Promise<ResultadoCorregirImportes> {
  const { operacionId, claveIdempotencia } = comando;
  const importes = [...comando.importes].sort((a, b) => a.movimientoId.localeCompare(b.movimientoId));
  const payloadHash = calcularPayloadHash("CORREGIR_IMPORTES_COMPRA", actor.sucursalId, { operacionId, importes, motivoId: comando.motivoId, detalleMotivo: comando.detalleMotivo });

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCorregirImportes> => {
      const chequeo = await chequearIdempotencia(tx, claveIdempotencia, payloadHash);
      if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { compraAnteriorId: operacionId, compraNuevaId: null, repetida: true });
      if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

      const compra = await cargarCompraParaCorregirImportes(tx, { operacionId, sucursalId: actor.sucursalId });
      if (!compra) return fracaso("NO_ENCONTRADA", MENSAJE_OPERACION_NO_ENCONTRADA);
      if (compra.proceso !== "COMPRA") return fracaso("NO_ES_COMPRA", `Esa operación no es una Compra — es "${compra.proceso}".`);
      if (compra.reemplazadaPorId) return fracaso("YA_REEMPLAZADA", "Esta factura ya fue corregida por otra persona: abrí la versión vigente y volvé a intentarlo.");
      if (compra.anuladaEn) return fracaso("YA_ANULADA", "Una compra anulada no se puede corregir.");
      // E3a (D8): la compra de una PARTE de una factura repartida no se corrige suelta.
      const deFactura = rechazoPorCompraDeFactura(compra.esDeFactura, "corregir");
      if (deFactura) return fracaso(deFactura.motivo, deFactura.mensaje);

      const evaluacion = evaluarCorreccionDeImportes(compra.lineas, importes);
      if (!evaluacion.ok) return fracaso(evaluacion.codigo, evaluacion.mensaje);

      // El motivo sale del catálogo configurable (nada escrito en el código): activo y de los que se ofrecen en correcciones.
      const motivo = await tx.motivoMerma.findFirst({ where: { id: comando.motivoId, activo: true, ambito: { in: ["CORRECCION", "TODOS"] } }, select: { id: true, nombre: true } });
      if (!motivo) return fracaso("MOTIVO_INVALIDO", "Elegí un motivo de la lista: el que elegiste ya no está disponible.");
      const motivoTexto = (comando.detalleMotivo ? `${motivo.nombre}: ${comando.detalleMotivo}` : motivo.nombre).slice(0, LARGO_MAXIMO_MOTIVO_ANULACION);

      const reversion = construirReversion(compra.lineas.map((l) => ({ ...l, productoCodigo: "" })));
      const escrita = await escribirCorreccionDeCompraPorEjemplar(tx, {
        compraAnteriorId: compra.id,
        sucursalId: actor.sucursalId,
        usuarioId: actor.usuarioId,
        ahora: actor.ahora,
        fecha: compra.fecha,
        proveedorId: compra.proveedorId,
        nroFactura: compra.nroFactura,
        detalleLibre: compra.detalleLibre,
        motivoId: motivo.id,
        motivoTexto,
        detalleDeLaReversion: detalleReversionDeCompra(compra.id, compra.fecha, compra.nroFactura),
        claveIdempotencia,
        payloadHash,
        reversion,
        lineas: evaluacion.lineas,
      });

      for (const c of evaluacion.cambios) {
        await registrarCambioAuditado(tx, {
          entidad: "Operacion",
          entidadId: escrita.compraNuevaId,
          descripcion: `Compra${compra.nroFactura ? ` (factura ${compra.nroFactura})` : ""}: importe de «${c.productoNombre}» corregido. Motivo: ${motivoTexto}`,
          campo: "precioTotal",
          valorAnterior: c.anteriorEnCentavos / 100,
          valorNuevo: c.nuevoEnCentavos / 100,
          actorId: actor.usuarioId,
          sucursalId: actor.sucursalId,
        });
      }

      const mensaje = mensajeCorreccionDeImportes(evaluacion.cambios, compra.nroFactura);
      await registrarResultadoIdempotente(tx, escrita.compraNuevaId, mensaje);
      return exito(mensaje, { compraAnteriorId: compra.id, compraNuevaId: escrita.compraNuevaId, repetida: false });
    },
    undefined,
    undefined,
    true
  ).catch((e): ResultadoCorregirImportes => {
    // Segunda barrera del número de factura repetido (no debería pasar: la original se anula antes de insertar el ejemplar): mismo mensaje de negocio, nunca un error crudo.
    if (esChoqueDeFacturaUnica(e)) return fracaso("ENTRADA_INVALIDA", MENSAJE_FACTURA_DUPLICADA);
    throw e;
  });
}

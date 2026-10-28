import "server-only";
import { evaluarAnulacion, evaluarPosterioresAAnularCompra } from "@/core/compras/public";
import type { ComandoAnularFacturaProveedor, ResultadoAnularFacturaProveedor } from "@/core/features/compras/factura-proveedor.schema";
import { detalleReversionDeCompra } from "@/core/movimientos/public";
import { calcularPayloadHash, esChoqueDeClaveIdempotenciaDeFactura, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";
import { permisoYAlcanceEnSucursal } from "@/server/actions/con-permiso";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { chequearIdempotencia } from "@/server/persistencia/movimientos/idempotencia";
import { cargarReconciliacionesPosteriores } from "@/server/persistencia/movimientos/cargar-reconciliaciones-posteriores";
import { cargarCompraParaAnular } from "@/server/persistencia/compras/cargar-compra-para-anular";
import { escribirAnulacionDeCompra } from "@/server/persistencia/compras/escribir-anulacion-de-compra";
import {
  bloquearFactura,
  cargarAnulacionPorClaveIdempotencia,
  cargarPartesDeFactura,
  sucursalesConParteDeFactura,
  tieneNotasDeCreditoVigentes,
} from "@/server/persistencia/compras/cargar-factura-proveedor";
import { escribirAnulacionDeFactura } from "@/server/persistencia/compras/escribir-factura-proveedor";

const MENSAJE_NO_ENCONTRADA = "No se encontró esa factura de proveedor.";

/**
 * Caso de uso «anular una factura de proveedor» (E3a, ADR-041; D-ANUL del dueño: entera y atómica, bloqueada si algo se consumió). Lo hace un administrador, con motivo; queda como registro nuevo
 * (`AnulacionDeFacturaProveedor`) y la cabecera marcada anulada (libera el número).
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action pidió `anular_compra` en la sucursal activa y validó el formato (`guardComandoAnularFacturaProveedor`).
 *
 * Pasos:
 *  1. (fuera de la transacción) en qué sucursales de la empresa ya entró una parte: una lectura de VERIFICACIÓN que devuelve solo sus ids, para pedir `anular_compra` EN CADA UNA (`permisoYAlcanceEnSucursal`: la
 *     clave allí y, solo si está, el alcance de escritura en esa sucursal). Si falta en una, se rechaza nombrándola. Nadie ensancha sin su gate;
 *  2. dentro de UNA transacción SERIALIZABLE: I3 (la clave y la huella van en el registro de anulación); `SELECT … FOR UPDATE` de la cabecera (serializa contra la aceptación de una propuesta); anulada → «ya
 *     está anulada»; las partes que se ven tienen que ser las mismas del paso 1 (si una destino aceptó en el medio, se pide repetir); notas de crédito vigentes → rechazo (C29);
 *  3. cada parte se evalúa con las reglas de anular una compra (lo comprado sigue en stock, sin conteo posterior) ANTES de escribir nada: si una no se puede, no se anula ninguna;
 *  4. escribe la reversión de cada compra (la de siempre: AJUSTE con `revierteAOperacionId`), la cabecera anulada con la guarda `anuladaEn IS NULL`, el registro de anulación y la auditoría. Las propuestas
 *     pendientes no se tocan: las marca la anulación de su factura (ya no se aceptan ni aparecen en la bandeja).
 *
 * @contract Anula una factura de proveedor entera (todas sus partes recibidas) exactamente una vez por clave, o no anula nada.
 * @idempotency I3 (claveIdempotencia + payloadHash en el registro de anulación), dentro de la misma transacción; además la guarda `anuladaEn IS NULL` y la anulación única por factura.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento), con candado sobre la cabecera de la factura.
 * @sideEffects registrarCambioAuditado (la anulación, con el motivo).
 * @ficha permiso=anular_compra transaccion=SERIALIZABLE idempotencia=I3 auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function anularFacturaProveedorCasoDeUso(actor: ContextoDeAccion, comando: ComandoAnularFacturaProveedor): Promise<ResultadoAnularFacturaProveedor> {
  const payloadHash = calcularPayloadHash("ANULAR_FACTURA_PROVEEDOR", actor.sucursalId, { facturaId: comando.facturaId, motivo: comando.motivo });

  // 1. Las sucursales donde ya entró una parte (solo sus ids, para el gate) y la clave de anular EN CADA UNA, antes de ensanchar.
  const verificacion = await lecturaDeVerificacionEnLaEmpresa(actor);
  const sucursalesConParte = await sucursalesConParteDeFactura(verificacion.db, comando.facturaId);
  let ctx: ContextoDeAccion = actor;
  for (const sucursalId of sucursalesConParte) {
    if (sucursalId === actor.sucursalId) continue;
    const gate = await permisoYAlcanceEnSucursal(ctx, sucursalId, "anular_compra");
    if (!gate.ok) return fracaso("SIN_PERMISO_EN_SUCURSAL", `No podés anular esta factura: una de sus partes ya entró al stock de otra sucursal donde no tenés permiso de anular compras. ${gate.mensaje}`);
    ctx = gate.ctx;
  }

  return conTransaccionSerializable(ctx.transaccion, async (tx): Promise<ResultadoAnularFacturaProveedor> => {
    const chequeo = await chequearIdempotencia(tx, comando.claveIdempotencia, payloadHash, cargarAnulacionPorClaveIdempotencia);
    if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { repetida: true, facturaId: comando.facturaId });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    const factura = await bloquearFactura(tx, comando.facturaId);
    if (!factura) return fracaso("NO_ENCONTRADA", MENSAJE_NO_ENCONTRADA);
    if (factura.anuladaEn) return fracaso("YA_ANULADA", "La factura ya está anulada.");

    const partes = await cargarPartesDeFactura(tx, factura.id);
    const vistas = partes.map((p) => p.sucursalId).sort();
    if (vistas.join("|") !== [...sucursalesConParte].sort().join("|")) {
      return fracaso("CONFLICTO_IDEMPOTENCIA", "La factura cambió mientras la anulabas (otra sucursal aceptó su parte): volvé a intentarlo.");
    }
    if (await tieneNotasDeCreditoVigentes(tx, factura.id)) return fracaso("CON_NOTAS_DE_CREDITO", "La factura tiene notas de crédito vigentes: primero hay que anularlas.");

    // 3. Todas las partes se evalúan ANTES de escribir: si una no se puede anular, no se anula ninguna.
    const aRevertir = [];
    for (const parte of partes) {
      if (!parte.operacionId) continue;
      const compra = await cargarCompraParaAnular(tx, { operacionId: parte.operacionId, sucursalId: parte.sucursalId });
      if (!compra) return fracaso("NO_ENCONTRADA", MENSAJE_NO_ENCONTRADA);
      const evaluacion = evaluarAnulacion({ proceso: compra.proceso, anuladaEn: compra.anuladaEn, lineas: compra.lineas }, compra.saldos);
      if (!evaluacion.ok) {
        const motivo = evaluacion.motivo === "YA_ANULADA" ? "STOCK_CONSUMIDO" : evaluacion.motivo;
        return fracaso(motivo, `En «${parte.sucursalNombre}»: ${evaluacion.mensaje}`);
      }
      const posteriores = evaluarPosterioresAAnularCompra(
        await cargarReconciliacionesPosteriores(tx, {
          sucursalId: parte.sucursalId,
          soloConteos: true,
          alcances: [{ creadoEn: compra.creadoEn, pares: [...new Map(compra.lineas.map((l) => [`${l.productoId}|${l.seccionId}`, { productoId: l.productoId, seccionId: l.seccionId }])).values()] }],
        })
      );
      if (!posteriores.ok) return fracaso(posteriores.motivo, `En «${parte.sucursalNombre}»: ${posteriores.mensaje}`);
      aRevertir.push({ parte, compra, reversion: evaluacion.reversion });
    }

    let movimientos = 0;
    for (const { parte, compra, reversion } of aRevertir) {
      const escrita = await escribirAnulacionDeCompra(tx, {
        compraId: compra.id,
        sucursalId: parte.sucursalId,
        usuarioId: actor.usuarioId,
        ahora: actor.ahora,
        detalleLibre: detalleReversionDeCompra(compra.id, compra.fecha, compra.nroFactura),
        claveIdempotencia: null,
        payloadHash: null,
        reversion,
      });
      movimientos += escrita.movimientos;
    }

    const mensaje = `Factura anulada${factura.nroFactura ? ` (${factura.nroFactura})` : ""}: se revirtieron ${movimientos} movimiento(s) en ${aRevertir.length} sucursal(es) y las partes que faltaba aceptar ya no se pueden aceptar. El número queda libre para volver a cargarla.`;
    const anuladas = await escribirAnulacionDeFactura(tx, {
      facturaProveedorId: factura.id,
      usuarioId: actor.usuarioId,
      ahora: actor.ahora,
      motivo: comando.motivo,
      claveIdempotencia: comando.claveIdempotencia,
      payloadHash,
      resultadoMensaje: mensaje,
    });
    if (anuladas !== 1) return fracaso("YA_ANULADA", "La factura ya está anulada.");

    await registrarCambioAuditado(tx, {
      entidad: "FacturaProveedor",
      entidadId: factura.id,
      descripcion: `Factura de proveedor${factura.nroFactura ? ` ${factura.nroFactura}` : ""} anulada. Motivo: ${comando.motivo}`,
      campo: "anuladaEn",
      valorAnterior: null,
      valorNuevo: actor.ahora.toISOString(),
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito(mensaje, { repetida: false, facturaId: factura.id });
  }).catch(async (e): Promise<ResultadoAnularFacturaProveedor> => {
    if (esChoqueDeClaveIdempotenciaDeFactura(e)) {
      const ganador = await cargarAnulacionPorClaveIdempotencia(actor.db, comando.claveIdempotencia);
      if (ganador && ganador.payloadHash === payloadHash && ganador.resultadoMensaje !== null) return exito(ganador.resultadoMensaje, { repetida: true, facturaId: comando.facturaId });
      return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
    }
    throw e;
  });
}

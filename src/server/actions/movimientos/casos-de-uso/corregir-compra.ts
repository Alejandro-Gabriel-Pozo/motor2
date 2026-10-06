import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import {
  cabeceraCoincide,
  clavesDeFactura,
  descripcionAuditoriaCorreccion,
  diferenciasDeCabecera,
  mensajeCompraCorregida,
  normalizarCorreccion,
  validarCorreccion,
} from "@/core/compras/correccion";
import { MENSAJE_OPERACION_NO_ENCONTRADA } from "@/core/features/compras/compra.guard";
import type { ComandoCorregirCompra, ResultadoCorregirCompra } from "@/core/features/compras/compra.schema";
import { conTransaccionSerializable, esChoqueDeFacturaUnica, MENSAJE_FACTURA_DUPLICADA } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarCompraParaCorregir, cargarProveedorParaCorreccion, hayOtraCompraVigenteConFactura } from "@/server/persistencia/compras/cargar-compra-para-corregir";
import { escribirCorreccionDeCompra } from "@/server/persistencia/compras/escribir-correccion-de-compra";

/**
 * Caso de uso «corregir la cabecera de una compra» (K1b; Task #41, Fase M — mismo molde que `anular-compra.ts`). Es la orquestación que
 * antes vivía en línea en la Server Action `corregirCompra` (src/server/actions/movimientos/compras.ts), en el MISMO orden y con los
 * MISMOS textos. Las reglas siguen en `src/core/compras/correccion.ts`.
 *
 * Guardas, en este orden: la compra es de ESTA sucursal; es una Compra; no está anulada; si ya tiene exactamente lo pedido responde
 * «nada que corregir» (idempotencia natural, sin clave I3); lo que la persona vio (`esperado`) es lo que hoy está guardado (guarda
 * optimista); lo que cambia es válido; el proveedor nuevo existe y está activo; el par proveedor + N.º de factura no lo usa OTRA compra
 * vigente (y, bajo concurrencia, lo arbitra el índice único parcial: `esChoqueDeFacturaUnica` en el `.catch`). Una fila de auditoría
 * por campo que cambió.
 *
 * @contract Corrige la cabecera de una compra vigente con guarda optimista (esperado vs actual) — dos correcciones concurrentes nunca se pisan en silencio.
 * @idempotency Por estado — si ya tiene exactamente lo pedido responde "nada que corregir" sin escribir (idempotencia natural, sin clave I3).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento), con `.catch(esChoqueDeFacturaUnica)` para el índice único parcial de factura.
 * @sideEffects registrarCambioAuditado (uno por cada campo que cambió).
 * @ficha permiso=corregir_compra transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO
 */
export async function corregirCompraCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "transaccion">,
  comando: ComandoCorregirCompra
): Promise<ResultadoCorregirCompra> {
  const pedida = normalizarCorreccion(comando.nueva);
  const vista = normalizarCorreccion(comando.esperado);

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoCorregirCompra> => {
    const compra = await cargarCompraParaCorregir(tx, { operacionId: comando.operacionId, sucursalId: actor.sucursalId });
    if (!compra) return fracaso("NO_ENCONTRADA", MENSAJE_OPERACION_NO_ENCONTRADA);
    if (compra.proceso !== "COMPRA") return fracaso("NO_ES_COMPRA", `Esa operación no es una Compra — es "${compra.proceso}".`);
    if (compra.anuladaEn) return fracaso("YA_ANULADA", "Una compra anulada no se puede corregir.");

    const actual = compra.cabecera;
    const cambios = diferenciasDeCabecera(actual, pedida);
    if (!cambios.length) return exito("La compra ya tiene esos datos: no hay nada que corregir.", { compraId: compra.id, camposCorregidos: [] });
    if (!cabeceraCoincide(actual, vista)) {
      return fracaso("CAMBIO_CONCURRENTE", "Esta compra cambió mientras la editabas (otra persona la corrigió). Recargá la página y volvé a intentarlo.");
    }

    const invalido = validarCorreccion(cambios);
    if (invalido) return fracaso("ENTRADA_INVALIDA", invalido);

    let proveedorNuevoNombre: string | null = null;
    if (cambios.some((c) => c.campo === "proveedorId") && pedida.proveedorId) {
      const proveedor = await cargarProveedorParaCorreccion(tx, pedida.proveedorId);
      if (!proveedor) return fracaso("PROVEEDOR_INEXISTENTE", "El proveedor no existe.");
      if (!proveedor.activo) return fracaso("PROVEEDOR_INACTIVO", `El proveedor "${proveedor.nombre}" está inactivo.`);
      proveedorNuevoNombre = proveedor.nombre;
    }

    const clave = clavesDeFactura(pedida);
    if (clave && (await hayOtraCompraVigenteConFactura(tx, { sucursalId: actor.sucursalId, ...clave, excluirOperacionId: compra.id }))) {
      return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA);
    }

    await escribirCorreccionDeCompra(tx, compra.id, pedida);

    for (const c of cambios) {
      const esProveedor = c.campo === "proveedorId";
      await registrarCambioAuditado(tx, {
        entidad: "Operacion",
        entidadId: compra.id,
        descripcion: descripcionAuditoriaCorreccion(compra.fecha, actual.nroFactura, c.campo),
        campo: c.campo,
        valorAnterior: esProveedor ? compra.proveedorNombre : c.anterior,
        valorNuevo: esProveedor ? proveedorNuevoNombre : c.nuevo,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
    }

    return exito(mensajeCompraCorregida(cambios), { compraId: compra.id, camposCorregidos: cambios.map((c) => c.campo) });
  }).catch((e): ResultadoCorregirCompra => {
    // La transacción ya hizo rollback. Choque de la carrera de factura repetida (dos escrituras simultáneas con el mismo par proveedor + N.º de factura):
    // mismo mensaje de negocio que la carga, no un error 500. Cualquier otro error sigue de largo.
    if (esChoqueDeFacturaUnica(e)) return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA);
    throw e;
  });
}

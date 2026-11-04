import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { cabeceraCoincide, descripcionAuditoriaCorreccion, diferenciasDeCabecera, mensajeCompraCorregida, normalizarCorreccion, rechazoPorCompraDeFactura, validarCorreccion } from "@/core/compras/public";
import { MENSAJE_OPERACION_NO_ENCONTRADA } from "@/core/features/compras/compra.guard";
import type { ComandoCorregirCompra, ResultadoCorregirCompra } from "@/core/features/compras/compra.schema";
import { esChoqueDeFacturaUnica, MENSAJE_FACTURA_DUPLICADA } from "@/core/movimientos/public-servidor";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarCompraParaCorregir, cargarProveedorParaCorreccion } from "@/server/persistencia/compras/cargar-compra-para-corregir";
import { hayComprobanteVigenteEnLaEmpresa } from "@/server/persistencia/compras/comprobante-en-la-empresa";
import { escribirCorreccionDeCompra } from "@/server/persistencia/compras/escribir-correccion-de-compra";

/**
 * Caso de uso «corregir la cabecera de una compra» (K1b; Task #41, Fase M — mismo molde que `anular-compra.ts`). Es la orquestación que
 * antes vivía en línea en la Server Action `corregirCompra` (src/server/actions/movimientos/compras.ts), en el MISMO orden y con los
 * MISMOS textos. Las reglas siguen en `src/core/compras/correccion.ts`.
 *
 * Guardas, en este orden: la compra es de ESTA sucursal; es una Compra; no está anulada; si ya tiene exactamente lo pedido responde
 * «nada que corregir» (idempotencia natural, sin clave I3); lo que la persona vio (`esperado`) es lo que hoy está guardado (guarda
 * optimista); lo que cambia es válido (el N.º de factura, estructurado y obligatorio; la compra no queda sin proveedor); el proveedor nuevo existe y está activo; si cambia el proveedor o el número, el par proveedor + N.º de
 * factura no lo usa NINGÚN otro comprobante vigente de la empresa (`hayComprobanteVigenteEnLaEmpresa`, de cualquier sucursal, con el mensaje único; la transacción se abre con la base de verificación y la compra que se
 * corrige no cuenta contra sí misma) y, bajo concurrencia, lo arbitra el cerrojo con el reintento por serialización y, dentro de la sucursal, el índice único parcial (`esChoqueDeFacturaUnica` en el `.catch`). Una fila de
 * auditoría por campo que cambió.
 *
 * @contract Corrige la cabecera de una compra vigente con guarda optimista (esperado vs actual) — dos correcciones concurrentes nunca se pisan en silencio.
 * @idempotency Por estado — si ya tiene exactamente lo pedido responde "nada que corregir" sin escribir (idempotencia natural, sin clave I3).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento) sobre la base de verificación, con `.catch(esChoqueDeFacturaUnica)` para el índice único parcial de factura.
 * @sideEffects registrarCambioAuditado (uno por cada campo que cambió).
 * @ficha permiso=corregir_compra transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function corregirCompraCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "empresaId" | "db" | "transaccion" | "alcance">,
  comando: ComandoCorregirCompra
): Promise<ResultadoCorregirCompra> {
  const pedida = normalizarCorreccion(comando.nueva);
  const vista = normalizarCorreccion(comando.esperado);

  // La base de verificación: leer el número en las demás sucursales de la empresa (solo sí/no); la escritura no se ensancha.
  const verificacion = await lecturaDeVerificacionEnLaEmpresa(actor);
  return conTransaccionSerializable(verificacion.transaccion, async (tx): Promise<ResultadoCorregirCompra> => {
    const compra = await cargarCompraParaCorregir(tx, { operacionId: comando.operacionId, sucursalId: actor.sucursalId });
    if (!compra) return fracaso("NO_ENCONTRADA", MENSAJE_OPERACION_NO_ENCONTRADA);
    if (compra.proceso !== "COMPRA") return fracaso("NO_ES_COMPRA", `Esa operación no es una Compra — es "${compra.proceso}".`);
    if (compra.anuladaEn) return fracaso("YA_ANULADA", "Una compra anulada no se puede corregir.");
    // E3a (D8): la compra de una PARTE de una factura de proveedor lleva el proveedor y el número de la factura: no se corrige suelta.
    const deFactura = rechazoPorCompraDeFactura(compra.esDeFactura, "corregir");
    if (deFactura) return fracaso(deFactura.motivo, deFactura.mensaje);

    // Lo guardado se compara en su forma canónica (como lo pedido y lo visto): una compra vieja con «A-0001-00001234» no cambia de número por escribirlo con otros ceros (I15: lo viejo no se toca).
    const actual = normalizarCorreccion(compra.cabecera);
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

    if (cambios.some((c) => c.campo === "proveedorId" || c.campo === "nroFactura") && pedida.proveedorId && pedida.nroFactura) {
      if (await hayComprobanteVigenteEnLaEmpresa(tx, { empresaId: actor.empresaId, proveedorId: pedida.proveedorId, nroFactura: pedida.nroFactura, excluirOperacionId: compra.id })) {
        return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA);
      }
    }

    await escribirCorreccionDeCompra(tx, compra.id, cambios.some((c) => c.campo === "nroFactura") ? pedida : { ...pedida, nroFactura: compra.cabecera.nroFactura });

    for (const c of cambios) {
      const esProveedor = c.campo === "proveedorId";
      await registrarCambioAuditado(tx, {
        entidad: "Operacion",
        entidadId: compra.id,
        descripcion: descripcionAuditoriaCorreccion(compra.fecha, compra.cabecera.nroFactura, c.campo),
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

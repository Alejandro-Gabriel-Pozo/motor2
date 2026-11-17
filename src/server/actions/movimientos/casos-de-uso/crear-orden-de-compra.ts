import "server-only";
import { validarDatosDeOrden } from "@/core/compras/public";
import type { ComandoCrearOrdenDeCompra, ResultadoCrearOrdenDeCompra } from "@/core/features/compras/orden-de-compra.schema";
import { calcularPayloadHash, decidirIdempotencia, esChoqueDeIndiceUnico, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { ZONA_ARGENTINA, diaDeCalendario, fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { conEscrituraEnLaEmpresa } from "@/server/acceso/alcance";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { chequearIdempotencia } from "@/server/persistencia/movimientos/idempotencia";
import { cargarOrdenPorClaveIdempotencia } from "@/server/persistencia/movimientos/cargar-orden-de-compra";
import { escribirOrdenBorrador } from "@/server/persistencia/movimientos/escribir-orden-de-compra";
import { cargarProveedor } from "@/server/persistencia/movimientos/cargar-validaciones-de-movimiento";

const MENSAJE_ORDEN_YA_GUARDADA = "Esa orden ya estaba guardada.";

/**
 * Caso de uso «crear una orden de compra» (Compras, etapa OC; docs/diseno-compras-n3b-n4-etapas-2026-11-16.md §«Etapa OC»): un gerente o administrador deja armada la orden al proveedor como BORRADOR (proveedor, sucursal destino opcional, entrega prevista
 * opcional y las líneas: producto, cantidad en la unidad de stock y precio opcional). Todavía no tiene número ni se puede recibir contra ella: eso lo hace «pedirla».
 *
 * `import "server-only"` y SIN `"use server"`: no chequea permisos (la Server Action pidió `orden_de_compra_gestionar`: del módulo `ordenes_de_compra`, piso administrador) ni el formato (`guardComandoCrearOrdenDeCompra`).
 *
 * En UNA transacción SERIALIZABLE:
 *  1. idempotencia: la clave de reintento vive en la cabecera con la huella del pedido; la misma clave y los mismos datos devuelven la MISMA orden (`repetida`), la misma clave con otros datos es conflicto;
 *  2. `validarDatosDeOrden` (regla pura con el «hoy» argentino del reloj inyectado): proveedor, líneas (cantidad > 0, precio >= 0 o vacío, sin producto repetido) y entrega no anterior a hoy;
 *  3. el proveedor existe y está activo, la sucursal destino (si hay) existe y está activa, y cada producto existe en la empresa;
 *  4. escribe la cabecera BORRADOR y sus líneas (ids uuid de la aplicación) y audita (`OrdenDeCompra`, campo `estado`, de nada a BORRADOR).
 * Sin tabla de números: el número se asigna al pedir (la base, con un candado por empresa).
 *
 * @contract Crea una orden BORRADOR con sus líneas exactamente una vez por clave de reintento, o no crea nada.
 * @idempotency I3 (claveIdempotencia + payloadHash en la cabecera de la orden), dentro de la misma transacción; el índice único global de la clave decide la carrera.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (la orden creada).
 * @ficha permiso=orden_de_compra_gestionar transaccion=SERIALIZABLE idempotencia=I3 auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearOrdenDeCompraCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "db" | "transaccion" | "empresaId" | "alcance" | "ahora">,
  comando: ComandoCrearOrdenDeCompra,
  azar: FuenteDeAzar
): Promise<ResultadoCrearOrdenDeCompra> {
  const hoy = diaDeCalendario(actor.ahora, ZONA_ARGENTINA);
  const datos = validarDatosDeOrden({ proveedorId: comando.proveedorId, sucursalId: comando.sucursalId, fechaDeEntregaPrevista: comando.fechaDeEntregaPrevista, lineas: comando.lineas, hoy });
  if (!datos.ok) return fracaso(datos.codigo, datos.mensaje);
  const o = datos.valor;
  const payloadHash = calcularPayloadHash("ORDEN_DE_COMPRA", actor.sucursalId, { proveedorId: o.proveedorId, sucursalId: o.sucursalId, fechaDeEntregaPrevista: o.fechaDeEntregaPrevista, lineas: o.lineas });

  // La orden es un documento de la EMPRESA (`EMPRESA_ENTERA`): su sucursal destino es opcional e informativa y puede ser cualquiera de la empresa, no solo la activa.
  const base = await conEscrituraEnLaEmpresa(actor);
  return conTransaccionSerializable(base.transaccion, async (tx): Promise<ResultadoCrearOrdenDeCompra> => {
    // I3: la clave vive en la cabecera de la orden con la huella del pedido (la orden no guarda un mensaje de resultado: el de un reintento es siempre el mismo).
    const chequeo = await chequearIdempotencia(tx, comando.claveIdempotencia, payloadHash, async (db, clave) => {
      const guardada = await cargarOrdenPorClaveIdempotencia(db, clave);
      return guardada ? { payloadHash: guardada.payloadHash, resultadoMensaje: MENSAJE_ORDEN_YA_GUARDADA } : null;
    });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
    if (chequeo.estado === "duplicado") {
      const previa = await cargarOrdenPorClaveIdempotencia(tx, comando.claveIdempotencia);
      if (!previa) throw new Error("crearOrdenDeCompra: la clave figuraba como guardada y la orden no se ve.");
      return exito(chequeo.mensaje, { repetida: true, ordenId: previa.id });
    }

    const proveedor = await cargarProveedor(tx, o.proveedorId);
    if (!proveedor?.activo) return fracaso("PROVEEDOR_NO_DISPONIBLE", "El proveedor elegido ya no está disponible.");
    if (o.sucursalId) {
      const sucursal = await tx.sucursal.findUnique({ where: { id: o.sucursalId }, select: { activo: true } });
      if (!sucursal || !sucursal.activo) return fracaso("SUCURSAL_NO_DISPONIBLE", "La sucursal destino no está disponible.");
    }
    const existentes = await tx.producto.findMany({ where: { id: { in: o.lineas.map((l) => l.productoId) } }, select: { id: true } });
    if (existentes.length !== o.lineas.length) return fracaso("PRODUCTO_NO_DISPONIBLE", "Uno de los productos de la orden ya no está disponible.");

    const ordenId = azar.uuid();
    await escribirOrdenBorrador(tx, {
      id: ordenId,
      proveedorId: o.proveedorId,
      sucursalId: o.sucursalId,
      fechaDeEntregaPrevista: o.fechaDeEntregaPrevista ? fechaDeColumnaDate(o.fechaDeEntregaPrevista) : null,
      claveIdempotencia: comando.claveIdempotencia,
      payloadHash,
      creadoPorId: actor.usuarioId,
      lineas: o.lineas.map((l) => ({ id: azar.uuid(), productoId: l.productoId, cantidad: l.cantidad, precio: l.precio })),
    });
    await registrarCambioAuditado(tx, {
      entidad: "OrdenDeCompra",
      entidadId: ordenId,
      descripcion: `Orden de compra creada como borrador (${o.lineas.length} línea(s))`,
      campo: "estado",
      valorAnterior: null,
      valorNuevo: "BORRADOR",
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito("Orden guardada como borrador. Todavía no se pidió: pedila cuando esté lista.", { repetida: false, ordenId });
  }, undefined, undefined, true).catch(async (e): Promise<ResultadoCrearOrdenDeCompra> => {
    // El perdedor de la carrera por la clave única (dos envíos simultáneos con la misma clave): ve lo que dejó el ganador.
    if (esChoqueDeIndiceUnico(e)) {
      const ganador = await cargarOrdenPorClaveIdempotencia(actor.db, comando.claveIdempotencia);
      if (ganador) {
        return decidirIdempotencia({ payloadHash: ganador.payloadHash, resultadoMensaje: "." }, payloadHash).estado === "duplicado"
          ? exito(MENSAJE_ORDEN_YA_GUARDADA, { repetida: true, ordenId: ganador.id })
          : fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
      }
    }
    throw e;
  });
}

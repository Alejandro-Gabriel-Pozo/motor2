import "server-only";
import { validarDatosDeOrden } from "@/core/compras/public";
import type { ComandoCrearOrdenDeCompra, ResultadoCrearOrdenDeCompra } from "@/core/features/compras/orden-de-compra.schema";
import { calcularPayloadHash, decidirIdempotencia, esChoqueDeIndiceUnico, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { ZONA_ARGENTINA, diaDeCalendario, fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarOrdenPorClaveIdempotencia } from "@/server/persistencia/movimientos/cargar-orden-de-compra";
import { escribirOrdenBorrador } from "@/server/persistencia/movimientos/escribir-orden-de-compra";
import { cargarProveedor } from "@/server/persistencia/movimientos/cargar-validaciones-de-movimiento";

/**
 * Caso de uso «crear una orden de compra» (Compras, etapa OC; docs/diseno-compras-n3b-n4-etapas-2026-11-16.md §«Etapa OC»): un gerente o administrador deja armada la orden al proveedor como BORRADOR (proveedor, sucursal destino opcional, entrega prevista
 * opcional y las líneas: producto, cantidad en la unidad de stock y precio opcional). Todavía no tiene número ni se puede recibir contra ella: eso lo hace «pedirla».
 *
 * `import "server-only"` y SIN `"use server"`: no chequea permisos (la Server Action pidió `orden_de_compra_gestionar`: del módulo `ordenes_de_compra`, piso administrador) ni el formato (`guardComandoCrearOrdenDeCompra`).
 *
 * En UNA transacción SERIALIZABLE:
 *  1. idempotencia: la clave de reintento vive en la cabecera con la huella del pedido; la misma clave y los mismos datos devuelven la MISMA orden (`repetida`), la misma clave con otros datos es conflicto;
 *  2. `validarDatosDeOrden` (regla pura con el «hoy» argentino del reloj inyectado): proveedor, líneas (cantidad > 0, precio >= 0 o vacío, sin producto repetido) y entrega no anterior a hoy;
 *  3. el proveedor existe y está activo, la sucursal destino (si hay) existe, está activa y está en el alcance de quien crea, y cada producto existe en la empresa;
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
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "db" | "transaccion" | "alcance" | "ahora">,
  comando: ComandoCrearOrdenDeCompra,
  azar: FuenteDeAzar
): Promise<ResultadoCrearOrdenDeCompra> {
  const hoy = diaDeCalendario(actor.ahora, ZONA_ARGENTINA);
  const datos = validarDatosDeOrden({ proveedorId: comando.proveedorId, sucursalId: comando.sucursalId, fechaDeEntregaPrevista: comando.fechaDeEntregaPrevista, lineas: comando.lineas, hoy });
  if (!datos.ok) return fracaso(datos.codigo, datos.mensaje);
  const o = datos.valor;
  const payloadHash = calcularPayloadHash("ORDEN_DE_COMPRA", actor.sucursalId, { proveedorId: o.proveedorId, sucursalId: o.sucursalId, fechaDeEntregaPrevista: o.fechaDeEntregaPrevista, lineas: o.lineas });

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoCrearOrdenDeCompra> => {
    const previa = await cargarOrdenPorClaveIdempotencia(tx, comando.claveIdempotencia);
    if (previa) {
      return previa.payloadHash === payloadHash
        ? exito("Esa orden ya estaba guardada.", { repetida: true, ordenId: previa.id })
        : fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
    }

    const proveedor = await cargarProveedor(tx, o.proveedorId);
    if (!proveedor?.activo) return fracaso("PROVEEDOR_NO_DISPONIBLE", "El proveedor elegido ya no está disponible.");
    if (o.sucursalId) {
      const sucursal = await tx.sucursal.findUnique({ where: { id: o.sucursalId }, select: { activo: true } });
      const enAlcance = !actor.alcance || actor.alcance.escritura.includes(o.sucursalId);
      if (!sucursal || !sucursal.activo || !enAlcance) return fracaso("SUCURSAL_NO_DISPONIBLE", "La sucursal destino no está disponible.");
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
          ? exito("Esa orden ya estaba guardada.", { repetida: true, ordenId: ganador.id })
          : fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
      }
    }
    throw e;
  });
}

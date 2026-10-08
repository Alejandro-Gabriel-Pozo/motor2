import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoGuardarDescuentoProducto, ResultadoGuardarDescuentoProducto } from "@/core/features/carta/descuento-producto.schema";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { resolverGrupoDeProducto } from "@/server/lecturas/carta/grupo-de-producto";
import { borrarDescuentoProducto, fijarDescuentoProducto } from "@/server/persistencia/carta/descuento-producto";

/**
 * Caso de uso «fijar o sacar el % de descuento de un producto en la sucursal activa» (Hito 4 de la pureza, bloque 4.2, paso H4C-1 — `docs/plan-hito-4-pureza.md`
 * §3). Es el cuerpo que antes vivía en línea en la Server Action `guardarDescuentoProducto` (`src/server/actions/carta/descuento-producto.ts`), movido TAL CUAL:
 * las mismas lecturas (con la base del contexto, FUERA de la transacción, como antes), el mismo orden de chequeos, los mismos mensajes y la misma fila de
 * auditoría dentro de la transacción del cambio. La Server Action quedó como adaptador (`conPermiso("carta_producto_descuento")` →
 * `guardComandoGuardarDescuentoProducto` → este caso de uso → `revalidarCartasPublicas` si hubo cambio → `aResultadoAccion`). El criterio de negocio (un % sobre
 * el precio vigente de UN PV en la sucursal; no es una promo) está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni el formato del % (el guard).
 *
 * Orden, igual que antes: 1. el producto (`No se encontró el producto.`; un MP: `Solo un producto de venta (PV) puede tener descuento.`); 2. la fila actual del
 * par (producto, sucursal) —es uno de los dos lectores crudos de `DescuentoProductoSucursal` que admite `descuento-producto-en-un-solo-lugar.test.ts`—;
 * 3a. sacar (`porcentaje: null`): sin fila, nada que hacer (`huboCambio: false`, la acción no revalida); con fila, la borra y audita del % anterior a `null`;
 * 3b. fijar: si el producto es opción de un ítem agrupado de la carta en la sucursal, se rechaza; si no, la crea o la cambia (`fijarDescuentoProducto`, que
 * devuelve el id de la fila) y audita del % anterior (o `null` si no había) al nuevo. Repetir el mismo % vuelve a escribir la fila (sin fila de auditoría:
 * `registrarCambioAuditado` no anota lo que no cambió) y la acción revalida, como antes.
 *
 * @contract Deja el % de descuento pedido (o ninguno) del producto en la sucursal activa, con su registro de auditoría si cambió: los dos o ninguno.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo % (sin fila de auditoría nueva); sacar un descuento que no había no escribe.
 * @transaction `actor.transaccion` (READ COMMITTED): la escritura y su auditoría juntas; las lecturas previas van con `actor.db`, como antes.
 * @sideEffects registrarCambioAuditado (DescuentoProductoSucursal.porcentaje, del anterior al nuevo), en la misma transacción. La revalidación de la carta
 *   pública la hace la Server Action cuando `datos.huboCambio`.
 * @ficha permiso=carta_producto_descuento transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarDescuentoProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId" | "sucursalId">,
  comando: ComandoGuardarDescuentoProducto,
): Promise<ResultadoGuardarDescuentoProducto> {
  const { productoId, porcentaje: valor } = comando;

  const producto = await actor.db.producto.findUnique({ where: { id: productoId }, select: { nombre: true, tipo: true } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (producto.tipo !== "PV") return fracaso("NO_ES_PV", "Solo un producto de venta (PV) puede tener descuento.");

  const clave = { productoId_sucursalId: { productoId, sucursalId: actor.sucursalId } };
  const existente = await actor.db.descuentoProductoSucursal.findUnique({ where: clave });
  if (valor === null) {
    if (!existente) return exito(`«${producto.nombre}» no tenía descuento en esta sucursal.`, { huboCambio: false });
    await actor.transaccion(async (tx) => {
      await borrarDescuentoProducto(tx, { id: existente.id });
      await auditar(tx, actor, existente.id, producto.nombre, Number(existente.porcentaje), null);
    });
    return exito(`«${producto.nombre}» vuelve a su precio, sin descuento en esta sucursal.`, { huboCambio: true });
  }

  const grupo = await resolverGrupoDeProducto(productoId, actor.sucursalId, actor.db);
  if (grupo) return fracaso("OPCION_DE_ITEM_AGRUPADO", `«${producto.nombre}» es opción del ítem agrupado «${grupo.nombreItem}»: sacala de ahí para ponerle descuento.`);

  await actor.transaccion(async (tx) => {
    const fila = await fijarDescuentoProducto(tx, { productoId, sucursalId: actor.sucursalId, porcentaje: valor });
    await auditar(tx, actor, fila.id, producto.nombre, existente ? Number(existente.porcentaje) : null, valor);
  });
  return exito(`«${producto.nombre}» con ${valor} % de descuento en esta sucursal.`, { huboCambio: true });
}

/** La fila de auditoría del % (entidad «DescuentoProductoSucursal», `entidadId` = la fila; al sacarlo, la fila borrada), con la sucursal activa. */
async function auditar(
  tx: Parameters<typeof registrarCambioAuditado>[0],
  actor: { usuarioId: string; sucursalId: string },
  entidadId: string,
  nombre: string,
  anterior: number | null,
  nuevo: number | null,
) {
  await registrarCambioAuditado(tx, {
    entidad: "DescuentoProductoSucursal",
    entidadId,
    campo: "porcentaje",
    descripcion: `Descuento de "${nombre}"`,
    valorAnterior: anterior,
    valorNuevo: nuevo,
    actorId: actor.usuarioId,
    sucursalId: actor.sucursalId,
  });
}

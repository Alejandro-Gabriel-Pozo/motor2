import "server-only";
import type { PrismaClient } from "@prisma/client";
import { obtenerMiNivelPermisoEnAlgunaSucursal } from "@/server/acceso/gate";
import { puedeEditarCamposSensiblesDelProducto } from "@/server/acceso/campos-sensibles-de-producto";
import { listarPresentaciones, type PresentacionOpcion } from "@/server/actions/catalogo/productos";
import { grupoConElPrecioFinal, obtenerProductoPorId, obtenerUnidadesDelProducto } from "@/server/consultas/catalogo/productos";
import type { ComponentProps } from "react";
import type { ProductoExistente, ProductoForm } from "./producto-form";
import { cargarOpcionesFormularioProducto, conLasUnidadesDelProducto } from "./opciones-formulario";

/** Los props del formulario de edición de un producto: todo menos la `key` (la pone quien lo dibuja). */
export type PropsDeEdicionDelProducto = ComponentProps<typeof ProductoForm>;

/**
 * Lo que lee la pantalla del paso 1 del espacio del producto (`/catalogo/productos/[id]/datos`, Fase 6, 6.13; antes lo armaba `/editar`): los props del `ProductoForm` de un producto existente, o `null` si no
 * existe. Quien llama YA pasó las guardas de la página (`producto_ver_catalogo` y `producto_editar` de empresa): este módulo no decide quién puede abrir la pantalla, solo qué datos viajan al formulario.
 *
 * - S-12 (D8 del dueño): el costo de consignación (precio y consignante) solo viaja al formulario —un componente de cliente: sus props van al navegador— si el usuario tiene `pagar_consignante` EDITAR en alguna de
 *   sus sucursales de la empresa (P20, D23: no importa cuál esté activa). La consulta no lo devuelve sin la bandera, y la lista de proveedores del selector (solo se usa para elegir el consignante) tampoco se manda.
 * - M.2 (P6): cambiar el precio de venta, el factor de conversión y las unidades exige además `producto_campos_sensibles`. Sin la clave el formulario los muestra en solo lectura (con el valor guardado) y no manda esos
 *   campos: «no viene» es «no cambia» en el servidor, que rechaza igual un valor distinto del guardado (`actualizarProducto`).
 * - M.2-A4 (D): las unidades que el producto usa hoy van en las opciones aunque se hayan desactivado (`listarUnidadesActivas` trae solo las activas): sin esto el formulario las mostraba como «sin unidad» y, con la
 *   clave, las borraba al guardar.
 * - Fase 4 (ADR-035): «¿Cómo se vende?» (solo un PV): el modo guardado y el grupo donde está el precio final de cada opción, si lo tiene.
 */
export async function cargarEdicionDelProducto(
  ctx: { usuarioId: string; empresaId: string; membresias: readonly { sucursalId: string }[]; db: PrismaClient },
  id: string,
): Promise<PropsDeEdicionDelProducto | null> {
  const { editar: puedeGestionarConsignacion } = await obtenerMiNivelPermisoEnAlgunaSucursal(ctx, "pagar_consignante");
  const puedeEditarCamposSensibles = await puedeEditarCamposSensiblesDelProducto(ctx);

  const p = await obtenerProductoPorId(id, ctx.db, { conCostoDeConsignacion: puedeGestionarConsignacion });
  if (!p) return null;

  const [{ unidades: unidadesActivas, insumos, categorias, proveedores, puedeCrear }, unidadesDelProducto] = await Promise.all([cargarOpcionesFormularioProducto(ctx), obtenerUnidadesDelProducto(id, ctx.db)]);
  const unidades = conLasUnidadesDelProducto(unidadesActivas, [unidadesDelProducto?.unidadStock ?? null, unidadesDelProducto?.unidadCompra ?? null]);
  const productoExistente: ProductoExistente = {
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    tipo: p.tipo,
    categoriaId: p.categoriaId,
    unidadCompraId: p.unidadCompraId,
    unidadStockId: p.unidadStockId,
    factorConversion: Number(p.factorConversion),
    insumoId: p.insumoId,
    precioVenta: Number(p.precioVenta),
    pasoVenta: p.pasoVenta !== null ? Number(p.pasoVenta) : null,
    seProduce: p.seProduce,
    esConsignacion: p.esConsignacion,
    proveedorConsignacionId: p.proveedorConsignacionId,
    precioConsignacion: p.precioConsignacion ? Number(p.precioConsignacion) : 0,
    observaciones: p.observaciones ?? undefined,
  };
  const presentaciones: PresentacionOpcion[] = p.tipo === "MP" ? await listarPresentaciones(p.id) : [];
  const venta = p.tipo === "PV" ? { modo: p.modoDeVenta === "BASE_CONFIGURABLE" ? ("BASE_CONFIGURABLE" as const) : ("DIRECTO" as const), grupoConPrecioFinal: await grupoConElPrecioFinal(p.id, ctx.db) } : undefined;

  return {
    unidades,
    insumosIniciales: insumos,
    categoriasIniciales: categorias,
    proveedoresIniciales: puedeGestionarConsignacion ? proveedores : [],
    puedeCrear,
    puedeGestionarConsignacion,
    puedeEditarCamposSensibles,
    productoExistente,
    presentacionesIniciales: presentaciones,
    venta,
  };
}

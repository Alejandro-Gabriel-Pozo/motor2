import { listarUnidadesActivas } from "@/server/actions/catalogo/unidades";
import { listarInsumos } from "@/server/actions/catalogo/insumos";
import { listarCategoriasProducto } from "@/server/actions/catalogo/categorias-producto";
import { listarProveedoresParaSelector } from "@/server/actions/catalogo/proveedores";
import { obtenerMiNivelPermisoDeEmpresa } from "@/server/acceso/gate";
import type { PrismaClient } from "@prisma/client";

/**
 * Lo que necesita el formulario de producto (alta y edición) para armar sus listas desplegables y qué «+ Nuevo …» de alta rápida mostrar: cada uno
 * lo guarda un permiso de EDITAR propio (`categoria_alta`, `insumo_alta`, `proveedor_alta`); quien no lo tiene no recibe el botón para descubrirlo al guardar.
 */
export async function cargarOpcionesFormularioProducto(ctx: { usuarioId: string; empresaId: string; db: PrismaClient }) {
  const [unidades, insumos, categorias, proveedores, categoria, insumo, proveedor] = await Promise.all([
    listarUnidadesActivas(),
    listarInsumos(),
    listarCategoriasProducto(),
    listarProveedoresParaSelector(true),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "categoria_alta", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "insumo_alta", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedor_alta", ctx.db),
  ]);
  const puedeCrear = { categoria: categoria.editar, insumo: insumo.editar, proveedor: proveedor.editar };
  return { unidades, insumos, categorias, proveedores, puedeCrear };
}

/**
 * M.2-A4 (D): la lista de unidades del formulario de EDICIÓN lleva también las que el producto usa hoy aunque estén inactivas. `listarUnidadesActivas` trae solo las activas; si la unidad de stock o de compra del
 * producto se desactivó después, el formulario no la tenía: sin la clave decía «Sin unidad de compra» (falso) y con la clave el `<select>` mandaba "" y borraba la unidad de compra en silencio al guardar. Las que se
 * agregan van marcadas `inactiva: true` (el formulario las muestra con «(inactiva)» y no las ofrece para presentaciones nuevas). Sin duplicar las que ya están, ignora los `null` (sin unidad de compra).
 */
export function conLasUnidadesDelProducto<U extends { id: string }>(activas: readonly U[], delProducto: readonly (U | null)[]): (U & { inactiva?: boolean })[] {
  const yaEstan = new Set(activas.map((u) => u.id));
  const faltan: (U & { inactiva: true })[] = [];
  for (const u of delProducto) {
    if (u === null || yaEstan.has(u.id)) continue;
    yaEstan.add(u.id);
    faltan.push({ ...u, inactiva: true });
  }
  return [...activas, ...faltan];
}

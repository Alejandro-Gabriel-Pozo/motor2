import { listarUnidadesActivas } from "@/server/actions/catalogo/unidades";
import { listarInsumos } from "@/server/actions/catalogo/insumos";
import { listarCategoriasProducto } from "@/server/actions/catalogo/categorias-producto";
import { listarProveedores } from "@/server/actions/catalogo/proveedores";
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
    listarProveedores(true),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "categoria_alta", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "insumo_alta", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "proveedor_alta", ctx.db),
  ]);
  const puedeCrear = { categoria: categoria.editar, insumo: insumo.editar, proveedor: proveedor.editar };
  return { unidades, insumos, categorias, proveedores, puedeCrear };
}

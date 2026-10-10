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
 * M.2 (P6): ¿puede quien mira la pantalla cambiar el precio de venta, el factor de conversión y las unidades de un producto? Es `producto_campos_sensibles` EDITAR (clave de empresa), la misma pregunta que le
 * hace el servidor a cada acción (`puedeEditarCamposSensibles` de `src/server/actions/catalogo/productos.ts`, que no se exporta: ese archivo es `"use server"` y toda función exportada es un endpoint).
 * La calcula la PÁGINA, en el servidor, y baja al formulario como dato; el cliente no la decide. Es cortesía de la interfaz: sin la clave el formulario dibuja esos campos en solo lectura, pero la barrera es la
 * del servidor (`SIN_PERMISO_CAMPOS_SENSIBLES`).
 */
export async function puedeEditarCamposSensiblesDelProducto(ctx: { usuarioId: string; empresaId: string; db: PrismaClient }): Promise<boolean> {
  return (await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_campos_sensibles", ctx.db)).editar;
}

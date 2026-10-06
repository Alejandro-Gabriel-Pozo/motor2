"use server";

import { texto, validarTextoCatalogo } from "@/core/texto";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirSesion } from "../con-sesion";

export async function listarCategoriasProducto() {
  const ctx = await requerirSesion();
  return ctx.db.categoriaProducto.findMany({ orderBy: { nombre: "asc" } });
}

/**
 * Equivalente de crearCategoriaDesdePanel/crearCategoria_ (Catalogo.js:3054-3076): dedup case-insensible, reusa existente. Devuelve el id — lo usa el quick-create inline del form de Producto.
 *
 * NO pide el refresco de la vista: la llaman DOS flujos y a uno le sobraría — la pantalla de Categorías (closure "use server" de la página, que
 * sí lo pide ahí) y el alta rápida inline del formulario de Producto, que devuelve la categoría por callback al formulario y NO debe re-renderizar
 * la ruta con el formulario a medio llenar (ver la regla en refrescar.ts).
 */
export async function crearCategoriaProducto(nombre: string): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("categoria_alta", async (ctx) => {
    const n = texto(nombre);
    if (!n) return error("El nombre de la categoría no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre de la categoría");
    if (invalido) return error(invalido);

    const existente = await ctx.db.categoriaProducto.findFirst({ where: { nombre: { equals: n, mode: "insensitive" } } });
    if (existente) return okConId(`Ya existía la categoría "${existente.nombre}" — se reusa.`, existente.id, existente.nombre);

    const creada = await ctx.db.categoriaProducto.create({ data: { nombre: n } });
    return okConId(`Categoría "${creada.nombre}" creada.`, creada.id, creada.nombre);
  });
}

export async function actualizarActivaCategoriaProducto(categoriaId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("categorias", async (ctx) => {
    await ctx.db.categoriaProducto.update({ where: { id: categoriaId }, data: { activo } });
    // Se llama desde un closure "use server" de la página de Categorías, sin redirigir: sin esto la columna «Activa» no cambia (ver refrescar.ts).
    refrescarVistaSiHaceFalta();
    return ok(`Categoría ${activo ? "activada" : "desactivada"}.`);
  });
}

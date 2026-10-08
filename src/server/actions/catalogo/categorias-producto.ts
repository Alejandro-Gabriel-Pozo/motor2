"use server";

import { guardComandoCrearCategoriaProducto } from "@/core/features/catalogo/categorias-producto.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirVerAlguna } from "../con-sesion";
import { actualizarActivaCategoriaProductoCasoDeUso } from "./casos-de-uso/actualizar-activa-categoria-producto";
import { crearCategoriaProductoCasoDeUso } from "./casos-de-uso/crear-categoria-producto";

/**
 * Desde el Hito 4 de la pureza (bloque 4.3, paso H4C-7) las dos mutaciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{crear-categoria-producto,actualizar-activa-categoria-producto}.ts`; escrituras en server/persistencia/catalogo/categorias-producto.ts): el
 * archivo entero está en `ACCIONES_CON_CASO_DE_USO`. La lectura de abajo (H8) sigue acá.
 */

/** H8: la pantalla de Categorías o el formulario de producto (alta o edición). */
export async function listarCategoriasProducto() {
  const ctx = await requerirVerAlguna(["categorias", "alta_producto", "producto_ver_catalogo"]);
  return ctx.db.categoriaProducto.findMany({ orderBy: { nombre: "asc" } });
}

/**
 * Equivalente de crearCategoriaDesdePanel/crearCategoria_ (Catalogo.js:3054-3076): dedup case-insensible, reusa existente. Devuelve el id — lo usa el quick-create inline del form de Producto.
 *
 * NO pide el refresco de la vista: la llaman DOS flujos y a uno le sobraría — la pantalla de Categorías (closure "use server" de la página, que
 * sí lo pide ahí) y el alta rápida inline del formulario de Producto, que devuelve la categoría por callback al formulario y NO debe re-renderizar
 * la ruta con el formulario a medio llenar (ver la regla en refrescar.ts).
 *
 * Desde el Hito 4 (H4C-7): permiso (`conPermisoDeEmpresa("categoria_alta")`) → formato del nombre (`guardComandoCrearCategoriaProducto`,
 * core/features/catalogo/categorias-producto.guard.ts, DENTRO del envoltorio) → caso de uso (`casos-de-uso/crear-categoria-producto.ts`: buscar por nombre,
 * reusar o crear) → `aResultadoAccion`, y si salió bien el id y el nombre de la categoría (`okConId`).
 */
export async function crearCategoriaProducto(nombre: string): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("categoria_alta", async (ctx) => {
    const comando = guardComandoCrearCategoriaProducto({ nombre });
    if (!comando.ok) return error(comando.mensaje);
    const r = await crearCategoriaProductoCasoDeUso(ctx, comando.valor);
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/**
 * Desde el Hito 4 (H4C-7): permiso → caso de uso (`casos-de-uso/actualizar-activa-categoria-producto.ts`) → refrescar la vista → `aResultadoAccion`. Sin guard
 * (`SIN_GUARD`: solo recibe un id y un booleano).
 */
export async function actualizarActivaCategoriaProducto(categoriaId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("categorias", async (ctx) => {
    const resultado = await actualizarActivaCategoriaProductoCasoDeUso(ctx, { categoriaId, activo });
    // Se llama desde un closure "use server" de la página de Categorías, sin redirigir: sin esto la columna «Activa» no cambia (ver refrescar.ts).
    refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

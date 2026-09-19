"use server";

import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { conPermiso } from "../con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirSesion } from "../con-sesion";

export async function listarCategoriasProducto() {
  await requerirSesion();
  return prisma.categoriaProducto.findMany({ orderBy: { nombre: "asc" } });
}

/** Equivalente de crearCategoriaDesdePanel/crearCategoria_ (Catalogo.js:3054-3076): dedup case-insensible, reusa existente. Devuelve el id — lo usa el quick-create inline del form de Producto. */
export async function crearCategoriaProducto(nombre: string): Promise<ResultadoConId> {
  return conPermiso<ResultadoConId>("alta_producto", async () => {
    const n = texto(nombre);
    if (!n) return error("El nombre de la categoría no puede estar vacío.");
    const invalido = validarTextoCatalogo(n, "El nombre de la categoría");
    if (invalido) return error(invalido);

    const existente = await prisma.categoriaProducto.findFirst({ where: { nombre: { equals: n, mode: "insensitive" } } });
    if (existente) return okConId(`Ya existía la categoría "${existente.nombre}" — se reusa.`, existente.id, existente.nombre);

    const creada = await prisma.categoriaProducto.create({ data: { nombre: n } });
    return okConId(`Categoría "${creada.nombre}" creada.`, creada.id, creada.nombre);
  });
}

export async function actualizarActivaCategoriaProducto(categoriaId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermiso("categorias", async () => {
    await prisma.categoriaProducto.update({ where: { id: categoriaId }, data: { activo } });
    return ok(`Categoría ${activo ? "activada" : "desactivada"}.`);
  });
}

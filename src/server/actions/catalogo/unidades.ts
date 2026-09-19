"use server";

import type { MagnitudUnidad } from "@prisma/client";
import { prisma } from "@/lib/db";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermiso } from "@/core/permisos/gate";
import { conPermiso } from "../con-permiso";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirSesion } from "../con-sesion";

const DECIMALES_DEFAULT_POR_MAGNITUD: Record<MagnitudUnidad, number> = {
  CANTIDAD: 0,
  PESO: 2,
  VOLUMEN: 2,
};

export async function listarUnidadesParaPanel() {
  await requerirSesion();
  return prisma.unidad.findMany({ orderBy: { nombre: "asc" } });
}

export async function listarUnidadesActivas() {
  await requerirSesion();
  return prisma.unidad.findMany({ where: { activa: true }, orderBy: { nombre: "asc" } });
}

export async function crearUnidad(datos: { nombre: string; magnitud: MagnitudUnidad; decimales?: number }): Promise<ResultadoConId> {
  return conPermiso<ResultadoConId>("unidades", async () => {
    const nombre = texto(datos.nombre);
    if (!nombre) return error("El nombre de la unidad no puede estar vacío.");
    const invalido = validarTextoCatalogo(nombre, "El nombre de la unidad");
    if (invalido) return error(invalido);

    const decimales = datos.decimales ?? DECIMALES_DEFAULT_POR_MAGNITUD[datos.magnitud];
    if (!Number.isInteger(decimales) || decimales < 0 || decimales > 6) {
      return error("Los decimales tienen que ser un entero entre 0 y 6.");
    }

    const existente = await prisma.unidad.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" } } });
    if (existente) return error(`Ya existe una unidad llamada "${nombre}".`);

    const creada = await prisma.unidad.create({ data: { nombre, magnitud: datos.magnitud, decimales } });
    return okConId(`Unidad "${creada.nombre}" creada.`, creada.id, creada.nombre);
  });
}

export async function actualizarActivaUnidad(unidadId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermiso("unidades", async () => {
    await prisma.unidad.update({ where: { id: unidadId }, data: { activa } });
    return ok(`Unidad ${activa ? "activada" : "desactivada"}.`);
  });
}

export async function actualizarDecimalesUnidad(unidadId: string, decimales: number): Promise<ResultadoAccion> {
  return conPermiso("unidades", async () => {
    if (!Number.isInteger(decimales) || decimales < 0 || decimales > 6) {
      return error("Los decimales tienen que ser un entero entre 0 y 6.");
    }
    await prisma.unidad.update({ where: { id: unidadId }, data: { decimales } });
    return ok("Decimales actualizados.");
  });
}

export interface InsumoUnidadMezclada {
  insumo: string;
  unidades: string[];
  cantidadProductos: number;
}

/**
 * Equivalente de detectarInsumosConUnidadMezclada (Catalogo.js:4130+):
 * gateada aunque sea una lectura (mismo criterio que hoy) — por eso no usa
 * `conPermiso` (pensado para mutaciones que devuelven ResultadoAccion),
 * sino el gate inline, devolviendo los datos en éxito.
 */
export async function detectarInsumosConUnidadMezclada(): Promise<
  { ok: true; datos: InsumoUnidadMezclada[] } | { ok: false; mensaje: string }
> {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return { ok: false, mensaje: "No autenticado, o tu usuario no tiene ninguna sucursal asignada." };

  const gate = await requierePermiso(ctx.usuarioId, ctx.sucursalId, "insumos_mezclados");
  if (!gate.ok) return { ok: false, mensaje: gate.mensaje };

  const insumos = await prisma.insumo.findMany({
    include: { productos: { where: { activo: true }, include: { unidadStock: true } } },
  });

  const datos = insumos
    .map((insumo) => ({
      insumo: insumo.nombre,
      unidades: Array.from(new Set(insumo.productos.map((p) => p.unidadStock.nombre))),
      cantidadProductos: insumo.productos.length,
    }))
    .filter((r) => r.unidades.length > 1);

  return { ok: true, datos };
}

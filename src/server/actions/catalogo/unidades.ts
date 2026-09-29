"use server";

import type { MagnitudUnidad } from "@prisma/client";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermiso } from "@/core/permisos/gate";
import { whereDisponibleEnAlguna } from "@/core/catalogo/public-servidor";
import { decimalesDelPaso } from "@/core/catalogo/public";
import { conPermiso } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, ok, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirSesion } from "../con-sesion";

const DECIMALES_DEFAULT_POR_MAGNITUD: Record<MagnitudUnidad, number> = {
  CANTIDAD: 0,
  PESO: 2,
  VOLUMEN: 2,
};

export async function listarUnidadesParaPanel() {
  const ctx = await requerirSesion();
  return ctx.db.unidad.findMany({ orderBy: { nombre: "asc" } });
}

export async function listarUnidadesActivas() {
  const ctx = await requerirSesion();
  return ctx.db.unidad.findMany({ where: { activa: true }, orderBy: { nombre: "asc" } });
}

export async function crearUnidad(datos: { nombre: string; magnitud: MagnitudUnidad; decimales?: number }): Promise<ResultadoConId> {
  return conPermiso<ResultadoConId>("unidades", async (ctx) => {
    const nombre = texto(datos.nombre);
    if (!nombre) return error("El nombre de la unidad no puede estar vacío.");
    const invalido = validarTextoCatalogo(nombre, "El nombre de la unidad");
    if (invalido) return error(invalido);

    const decimales = datos.decimales ?? DECIMALES_DEFAULT_POR_MAGNITUD[datos.magnitud];
    if (!Number.isInteger(decimales) || decimales < 0 || decimales > 6) {
      return error("Los decimales tienen que ser un entero entre 0 y 6.");
    }

    const existente = await ctx.db.unidad.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" } } });
    if (existente) return error(`Ya existe una unidad llamada "${nombre}".`);

    const creada = await ctx.db.unidad.create({ data: { nombre, magnitud: datos.magnitud, decimales } });
    // Se llama desde un closure "use server" de la página de Unidades, sin redirigir: sin esto la tabla no cambia (ver refrescar.ts).
    refrescarVistaSiHaceFalta();
    return okConId(`Unidad "${creada.nombre}" creada.`, creada.id, creada.nombre);
  });
}

export async function actualizarActivaUnidad(unidadId: string, activa: boolean): Promise<ResultadoAccion> {
  return conPermiso("unidades", async (ctx) => {
    await ctx.db.unidad.update({ where: { id: unidadId }, data: { activa } });
    refrescarVistaSiHaceFalta(); // ver crearUnidad
    return ok(`Unidad ${activa ? "activada" : "desactivada"}.`);
  });
}

/**
 * Transición peligrosa (b) de R3 (Task #25, docs/plan-venta-fraccionada-2026-09-26.md — ver el docstring de `pasoVenta` en
 * prisma/schema.prisma): bajar los decimales de una Unidad no puede dejar a un producto "Se produce" (stock real) con un
 * `pasoVenta` que ya no entra en esos decimales — se rechaza, nombrando el primero que rompería (mismo criterio que
 * `dependenciasParaDesactivar`, "avisa qué es").
 */
export async function actualizarDecimalesUnidad(unidadId: string, decimales: number): Promise<ResultadoAccion> {
  return conPermiso("unidades", async (ctx) => {
    if (!Number.isInteger(decimales) || decimales < 0 || decimales > 6) {
      return error("Los decimales tienen que ser un entero entre 0 y 6.");
    }

    const productosConStockReal = await ctx.db.producto.findMany({
      where: { unidadStockId: unidadId, tipo: "PV", seProduce: true, pasoVenta: { not: null } },
      select: { nombre: true, pasoVenta: true },
    });
    const inconsistente = productosConStockReal.find((p) => decimalesDelPaso(Number(p.pasoVenta)) > decimales);
    if (inconsistente) {
      return error(
        `No se puede bajar a ${decimales} decimal(es): "${inconsistente.nombre}" "se produce" (tiene stock propio) y su paso de venta ` +
          `(${Number(inconsistente.pasoVenta)}) necesita más precisión — cambiale el paso de venta, desmarcá "Se produce", o dale una unidad propia.`
      );
    }

    await ctx.db.unidad.update({ where: { id: unidadId }, data: { decimales } });
    refrescarVistaSiHaceFalta(); // ver crearUnidad
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

  const gate = await requierePermiso(ctx.usuarioId, ctx.sucursalId, "insumos_mezclados", ctx.db);
  if (!gate.ok) return { ok: false, mensaje: gate.mensaje };

  const insumos = await ctx.db.insumo.findMany({
    include: { productos: { where: whereDisponibleEnAlguna(), include: { unidadStock: true } } },
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

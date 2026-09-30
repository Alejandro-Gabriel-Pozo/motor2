"use server";

import { Prisma } from "@prisma/client";
import { slugTenant, slugTenantUnico } from "@/core/carta/registro-tenants";
import {
  LARGO_MAXIMO_ETIQUETA_PORTAL,
  LARGO_MAXIMO_SUBTITULO_PORTAL,
  validarOrdenCarta,
  validarPosicionPortal,
  validarSlugTenant,
  validarTextoLibreCarta,
} from "@/core/carta/validaciones";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Registro público de las sucursales en el portal/carta (docs/plan-registro-tenants-2026-09-24.md, M6): lo que
 * arma el portal de la carta pública interna (ADR-006). Solo escriben en
 * `SucursalPublica` (lo fija test/arquitectura/carta-solo-lectura.test.ts): la sucursal en sí (nombre, activa) se sigue
 * administrando en Administración → Sucursales. Gate: `carta`, la misma acción que el resto del admin de la carta.
 *
 * Las tres reciben el `Sucursal.id` (la fila es 1:1 con la sucursal). No dependen de la sucursal activa de quien llama: el mapa
 * del portal es entre sucursales.
 */

const MAXIMO_INTENTOS_SLUG = 5;

function esChoqueDeUnicidad(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Agrega la sucursal al registro del portal (D3, opt-in): crea su fila SIN publicar, con el slug calculado UNA vez desde el
 * nombre (`slugTenant`) y desambiguado contra los que ya existen (`-2`, `-3`…). Si hace falta otra dirección, el slug se edita después a mano. Ante una carrera con otra alta que tomó el mismo slug (P2002), reintenta.
 */
export async function agregarSucursalAlPortal(sucursalId: string): Promise<ResultadoAccion> {
  return conPermiso("carta", async (ctx) => {
    const sucursal = await ctx.db.sucursal.findUnique({ where: { id: sucursalId }, select: { id: true, nombre: true } });
    if (!sucursal) return error("No se encontró la sucursal.");

    for (let intento = 0; intento < MAXIMO_INTENTOS_SLUG; intento++) {
      const yaEsta = await ctx.db.sucursalPublica.findFirst({ where: { sucursalId }, select: { slug: true } });
      if (yaEsta) return error(`"${sucursal.nombre}" ya está en el portal (slug ${yaEsta.slug}).`);

      const ocupados = new Set((await ctx.db.sucursalPublica.findMany({ select: { slug: true } })).map((f) => f.slug));
      const slug = slugTenantUnico(slugTenant(sucursal.nombre), ocupados);
      try {
        await ctx.db.sucursalPublica.create({ data: { sucursalId, slug } });
        revalidarCartasPublicas();
        return ok(`"${sucursal.nombre}" agregada al portal con el slug ${slug} (sin publicar todavía).`);
      } catch (e) {
        if (!esChoqueDeUnicidad(e)) throw e;
      }
    }
    return error("Otra carga simultánea tomó el mismo slug. Volvé a intentar.");
  });
}

export interface DatosSucursalPublica {
  slug: string;
  etiqueta?: string | null;
  subtituloPortal?: string | null;
  posX?: number | string | null;
  posY?: number | string | null;
  posW?: number | string | null;
  posH?: number | string | null;
  orden?: number | string | null;
  publicada: boolean;
}

/**
 * Guarda el registro público de una sucursal que ya está en el portal. Valida todo con los validadores de M2. Slug ya usado por otra sucursal → error con su nombre.
 */
export async function guardarSucursalPublica(sucursalId: string, datos: DatosSucursalPublica): Promise<ResultadoAccion> {
  return conPermiso("carta", async (ctx) => {
    const slug = validarSlugTenant(datos.slug);
    if (!slug.ok) return error(slug.mensaje);
    const etiqueta = validarTextoLibreCarta(datos.etiqueta, "La etiqueta", LARGO_MAXIMO_ETIQUETA_PORTAL);
    if (!etiqueta.ok) return error(etiqueta.mensaje);
    const subtitulo = validarTextoLibreCarta(datos.subtituloPortal, "El subtítulo", LARGO_MAXIMO_SUBTITULO_PORTAL);
    if (!subtitulo.ok) return error(subtitulo.mensaje);
    const posicion = validarPosicionPortal({ x: datos.posX, y: datos.posY, w: datos.posW, h: datos.posH });
    if (!posicion.ok) return error(posicion.mensaje);
    const orden = validarOrdenCarta(datos.orden);
    if (!orden.ok) return error(orden.mensaje);

    const existente = await ctx.db.sucursalPublica.findFirst({ where: { sucursalId }, select: { id: true, sucursal: { select: { nombre: true } } } });
    if (!existente) return error("Esta sucursal no está en el portal: agregala primero.");

    const conMismoSlug = await ctx.db.sucursalPublica.findFirst({ where: { slug: slug.valor, NOT: { sucursalId } }, select: { sucursal: { select: { nombre: true } } } });
    if (conMismoSlug) return error(`El slug ${slug.valor} ya lo usa "${conMismoSlug.sucursal.nombre}".`);

    try {
      await ctx.db.sucursalPublica.update({
        where: { id: existente.id },
        data: {
          slug: slug.valor,
          etiqueta: etiqueta.valor,
          subtituloPortal: subtitulo.valor,
          posX: posicion.valor.x,
          posY: posicion.valor.y,
          posW: posicion.valor.w,
          posH: posicion.valor.h,
          orden: orden.valor,
          publicada: datos.publicada,
        },
      });
    } catch (e) {
      if (esChoqueDeUnicidad(e)) return error("Otra sucursal tomó ese slug mientras guardabas. Revisalo y volvé a intentar.");
      throw e;
    }
    revalidarCartasPublicas();
    return ok(`Portal: "${existente.sucursal.nombre}" guardada${datos.publicada ? " y publicada" : " (sin publicar)"}.`);
  });
}

/**
 * Saca la sucursal del registro de motor2: borra su fila. Es la vuelta atrás del alta: la sucursal desaparece del portal.
 */
export async function quitarSucursalDelPortal(sucursalId: string): Promise<ResultadoAccion> {
  return conPermiso("carta", async (ctx) => {
    const existente = await ctx.db.sucursalPublica.findFirst({ where: { sucursalId }, select: { slug: true, sucursal: { select: { nombre: true } } } });
    if (!existente) return error("Esta sucursal no está en el portal.");
    await ctx.db.sucursalPublica.deleteMany({ where: { sucursalId } });
    revalidarCartasPublicas();
    return ok(`"${existente.sucursal.nombre}" quitada del portal (slug ${existente.slug}).`);
  });
}

/**
 * Mueve la tarjeta de una sucursal sobre el mapa del portal (arrastrando en la vista previa de /carta/portal): guarda SOLO `posX` y
 * `posY` (% del mapa, 0 a 100, 2 decimales); el ancho y el alto quedan como estaban. Exige que la sucursal ya tenga posición
 * completa: arrastrar mueve, no ubica por primera vez (eso se hace con los números de su formulario, que además es la alternativa sin arrastre).
 */
export async function moverSucursalEnMapa(sucursalId: string, x: number, y: number): Promise<ResultadoAccion> {
  return conPermiso("carta", async (ctx) => {
    const existente = await ctx.db.sucursalPublica.findFirst({ where: { sucursalId }, select: { id: true, posW: true, posH: true, sucursal: { select: { nombre: true } } } });
    if (!existente) return error("Esta sucursal no está en el portal.");
    if (existente.posW === null) return error("Esta sucursal todavía no tiene posición en el mapa: cargala con los números de su formulario.");
    const posicion = validarPosicionPortal({ x, y, w: Number(existente.posW), h: existente.posH === null ? null : Number(existente.posH) });
    if (!posicion.ok) return error(posicion.mensaje);
    await ctx.db.sucursalPublica.update({ where: { id: existente.id }, data: { posX: posicion.valor.x, posY: posicion.valor.y } });
    revalidarCartasPublicas();
    return ok(`"${existente.sucursal.nombre}" movida a ${posicion.valor.x}% / ${posicion.valor.y}%.`);
  });
}

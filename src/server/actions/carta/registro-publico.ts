"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { slugTenant, slugTenantUnico } from "@/core/carta/registro-tenants";
import {
  LARGO_MAXIMO_ETIQUETA_PORTAL,
  LARGO_MAXIMO_SUBTITULO_PORTAL,
  validarDominioPublico,
  validarNombreTabSheet,
  validarOrdenCarta,
  validarPosicionPortal,
  validarSheetId,
  validarSlugTenant,
  validarTextoLibreCarta,
} from "@/core/carta/validaciones";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

/**
 * Registro público de las sucursales en el portal/carta (docs/plan-registro-tenants-2026-09-24.md, M6): lo que
 * restaurant-menu-design lee por GET /api/carta/tenants en lugar de la tab "tenant" de su sheet maestra. Solo escriben en
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
 * nombre (`slugTenant`) y desambiguado contra los que ya existen (`-2`, `-3`…). Si al migrar un tenant de la sheet el slug no
 * coincide con su `tenant_id`, se edita después a mano. Ante una carrera con otra alta que tomó el mismo slug (P2002), reintenta.
 */
export async function agregarSucursalAlPortal(sucursalId: string): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const sucursal = await prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { id: true, nombre: true } });
    if (!sucursal) return error("No se encontró la sucursal.");

    for (let intento = 0; intento < MAXIMO_INTENTOS_SLUG; intento++) {
      const yaEsta = await prisma.sucursalPublica.findUnique({ where: { sucursalId }, select: { slug: true } });
      if (yaEsta) return error(`"${sucursal.nombre}" ya está en el portal (slug ${yaEsta.slug}).`);

      const ocupados = new Set((await prisma.sucursalPublica.findMany({ select: { slug: true } })).map((f) => f.slug));
      const slug = slugTenantUnico(slugTenant(sucursal.nombre), ocupados);
      try {
        await prisma.sucursalPublica.create({ data: { sucursalId, slug } });
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
  dominio?: string | null;
  subtituloPortal?: string | null;
  posX?: number | string | null;
  posY?: number | string | null;
  posW?: number | string | null;
  posH?: number | string | null;
  orden?: number | string | null;
  publicada: boolean;
  menuDesdeMotor2: boolean;
  sheetId?: string | null;
  sheetMenuNombre?: string | null;
}

/**
 * Guarda el registro público de una sucursal que ya está en el portal. Valida todo con los validadores de M2 (los mismos con los
 * que el endpoint sanea la salida). Publicar exige `sheetId`: mientras el theming (tab Config) viva en las sheets, la carta lo
 * necesita para CUALQUIER tenant, también los que leen el menú de motor2. Slug o dominio ya usados por otra sucursal → error con
 * su nombre.
 */
export async function guardarSucursalPublica(sucursalId: string, datos: DatosSucursalPublica): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const slug = validarSlugTenant(datos.slug);
    if (!slug.ok) return error(slug.mensaje);
    const etiqueta = validarTextoLibreCarta(datos.etiqueta, "La etiqueta", LARGO_MAXIMO_ETIQUETA_PORTAL);
    if (!etiqueta.ok) return error(etiqueta.mensaje);
    const subtitulo = validarTextoLibreCarta(datos.subtituloPortal, "El subtítulo", LARGO_MAXIMO_SUBTITULO_PORTAL);
    if (!subtitulo.ok) return error(subtitulo.mensaje);
    const dominio = validarDominioPublico(datos.dominio);
    if (!dominio.ok) return error(dominio.mensaje);
    const posicion = validarPosicionPortal({ x: datos.posX, y: datos.posY, w: datos.posW, h: datos.posH });
    if (!posicion.ok) return error(posicion.mensaje);
    const orden = validarOrdenCarta(datos.orden);
    if (!orden.ok) return error(orden.mensaje);
    const sheetId = validarSheetId(datos.sheetId);
    if (!sheetId.ok) return error(sheetId.mensaje);
    const tab = validarNombreTabSheet(datos.sheetMenuNombre);
    if (!tab.ok) return error(tab.mensaje);
    if (datos.publicada && !sheetId.valor) return error("Para publicar hace falta el id de la sheet: la carta todavía lee de ahí los colores y textos (tab Config).");

    const existente = await prisma.sucursalPublica.findUnique({ where: { sucursalId }, select: { id: true, sucursal: { select: { nombre: true } } } });
    if (!existente) return error("Esta sucursal no está en el portal: agregala primero.");

    const conMismoSlug = await prisma.sucursalPublica.findFirst({ where: { slug: slug.valor, NOT: { sucursalId } }, select: { sucursal: { select: { nombre: true } } } });
    if (conMismoSlug) return error(`El slug ${slug.valor} ya lo usa "${conMismoSlug.sucursal.nombre}".`);
    if (dominio.valor) {
      const conMismoDominio = await prisma.sucursalPublica.findFirst({ where: { dominio: dominio.valor, NOT: { sucursalId } }, select: { sucursal: { select: { nombre: true } } } });
      if (conMismoDominio) return error(`El dominio ${dominio.valor} ya lo usa "${conMismoDominio.sucursal.nombre}".`);
    }

    try {
      await prisma.sucursalPublica.update({
        where: { sucursalId },
        data: {
          slug: slug.valor,
          etiqueta: etiqueta.valor,
          dominio: dominio.valor,
          subtituloPortal: subtitulo.valor,
          posX: posicion.valor.x,
          posY: posicion.valor.y,
          posW: posicion.valor.w,
          posH: posicion.valor.h,
          orden: orden.valor,
          publicada: datos.publicada,
          menuDesdeMotor2: datos.menuDesdeMotor2,
          sheetId: sheetId.valor,
          sheetMenuNombre: tab.valor,
        },
      });
    } catch (e) {
      if (esChoqueDeUnicidad(e)) return error("Otra sucursal tomó ese slug o dominio mientras guardabas. Revisalos y volvé a intentar.");
      throw e;
    }
    return ok(`Portal: "${existente.sucursal.nombre}" guardada${datos.publicada ? " y publicada" : " (sin publicar)"}.`);
  });
}

/**
 * Saca la sucursal del registro de motor2: borra su fila. Es la vuelta atrás por tenant (D7): si la sheet maestra todavía
 * tiene una fila con ese `tenant_id`, la carta vuelve a usarla; si no, el tenant desaparece del portal.
 */
export async function quitarSucursalDelPortal(sucursalId: string): Promise<ResultadoAccion> {
  return conPermiso("carta", async () => {
    const existente = await prisma.sucursalPublica.findUnique({ where: { sucursalId }, select: { slug: true, sucursal: { select: { nombre: true } } } });
    if (!existente) return error("Esta sucursal no está en el portal.");
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    return ok(`"${existente.sucursal.nombre}" quitada del portal (slug ${existente.slug}).`);
  });
}

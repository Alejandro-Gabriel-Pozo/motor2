"use server";

import { requerirVerEnSucursal } from "../con-sesion";

const TAMANO_PAGINA_CONTEOS = 50;

/**
 * Historial de conteos de un producto/sección, más nuevo primero — para el
 * panel, paginado por cursor (antes un `take: 200` fijo sin forma de ver
 * conteos más viejos — hallazgo de la diligencia de motor2).
 *
 * `sucursalId` es obligatorio a propósito (no opcional como en una primera
 * versión de esta función): sin él, sin `seccionId`, listaría conteos de
 * CUALQUIER sucursal — bug encontrado escribiendo la UI, mismo tipo de
 * fuga que Core/Catálogo evitan scopeando todo por sucursal desde el vamos.
 *
 * `seccionId`/`productoId`/`desde`/`hasta` existían como filtro posible
 * (seccionId) o eran triviales de agregar (productoId, rango de fechas),
 * pero /reportes/conteos nunca los exponía en la página, a diferencia de
 * casi todos los demás reportes del módulo (hallazgo de la auditoría).
 *
 * LECTURA: se mudó TAL CUAL acá desde `conteo-fisico.ts` en la Task #41, Fase M13e2 (docs/arquitectura-casos-de-uso-2026-09-27.md,
 * mismo criterio que M13d con `lecturas-reclasificacion.ts`): con `registrarConteoFisico`/`registrarConteosFisicos` (M13e1) y
 * `resolverConteoPendiente`/`cancelarConteoFisico` (M13e2) ya migrados a caso de uso, `conteo-fisico.ts` entró en
 * `ACCIONES_CON_CASO_DE_USO`, y esa regla de dependency-cruiser (`accion-migrada-sin-orquestacion`) vale para el archivo ENTERO — no
 * admite `@/lib/db` en runtime. Esta lectura no es una mutación (no entra en la Fase M) y una Server Action no puede importar
 * `server/consultas/` (regla `acciones-sin-ui`), así que sigue siendo una Server Action con su propia guarda de sesión + permiso de
 * «Ver», en un archivo propio fuera de esa lista.
 */
export interface FiltroHistorialConteos {
  seccionId?: string;
  productoId?: string;
  desde?: Date;
  hasta?: Date;
  cursor?: string;
}

export async function obtenerHistorialConteosFisicos(sucursalId: string, filtro: FiltroHistorialConteos = {}) {
  const ctx = await requerirVerEnSucursal(sucursalId, "reporte_conteos");
  const { seccionId, productoId, desde, hasta, cursor } = filtro;
  const items = await ctx.db.conteoFisico.findMany({
    where: {
      sucursalId,
      ...(seccionId ? { seccionId } : {}),
      ...(productoId ? { productoId } : {}),
      ...(desde || hasta ? { fecha: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } } : {}),
    },
    include: { producto: true, seccion: true },
    orderBy: [{ fecha: "desc" }, { id: "desc" }],
    take: TAMANO_PAGINA_CONTEOS + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hayMas = items.length > TAMANO_PAGINA_CONTEOS;
  const pagina = hayMas ? items.slice(0, TAMANO_PAGINA_CONTEOS) : items;
  return { items: pagina, nextCursor: hayMas ? pagina[pagina.length - 1].id : null };
}

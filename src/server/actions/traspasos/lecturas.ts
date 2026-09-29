"use server";

import type { Prisma } from "@prisma/client";
import { requerirVerEnSucursal } from "../con-sesion";

/**
 * LECTURAS de traspasos entre sucursales: la Bandeja y el selector de sucursales. Vivían en `traspasos.ts` y se mudaron TAL CUAL acá en
 * la Task #41, Fase M11c (docs/arquitectura-casos-de-uso-2026-09-27.md): con sus ocho escrituras ya migradas a casos de uso,
 * `traspasos.ts` entró en `ACCIONES_CON_CASO_DE_USO`, y esa regla de dependency-cruiser (`accion-migrada-sin-orquestacion`) vale para
 * el archivo ENTERO — no admite `@/lib/db`. Las lecturas no son mutaciones (no entran en la Fase M) y una Server Action no puede
 * importar `server/consultas/` (regla `acciones-sin-ui`), así que siguen siendo Server Actions con su guarda de «Ver», en un archivo
 * propio fuera de esa lista.
 */

const INCLUDE_BANDEJA = {
  producto: { include: { unidadStock: true } },
  origenSucursal: true,
  destinoSucursal: true,
  seccionOrigen: true,
  seccionDestino: true,
  creadoPor: true,
} satisfies Prisma.TraspasoSucursalInclude;

const TAMANO_PAGINA_HISTORIAL = 30;

/**
 * Todo lo que sigue "en curso" — quien las cumple nunca es historial. Las
 * primeras 3 son "hay algo para ACCIONAR" de este lado (paraAprobar/
 * paraAceptar/paraReingreso); las últimas 2 son lo que ESTA sucursal
 * INICIÓ (iniciadoPor) y sigue esperando que decida la otra — antes
 * faltaban del todo, así que una solicitud/envío propio en curso se
 * mezclaba con el historial ya resuelto (hallazgo de la auditoría de
 * motor2). `iniciadoPor` es necesario en la condición de ENVIADA: un PULL
 * que Origen ya aprobó también queda ENVIADA con origenSucursalId=yo,
 * pero ahí lo inició Destino (paraAceptar del otro lado) — yo ya hice lo
 * mío, no estoy "esperando" en el mismo sentido que un PUSH propio.
 */
function condicionesEnCurso(sucursalId: string): Prisma.TraspasoSucursalWhereInput[] {
  return [
    { origenSucursalId: sucursalId, estado: "SOLICITADA" },
    { destinoSucursalId: sucursalId, estado: "ENVIADA" },
    { origenSucursalId: sucursalId, estado: "RECHAZADA_DESTINO" },
    { destinoSucursalId: sucursalId, estado: "SOLICITADA", iniciadoPor: "DESTINO" }, // mi propia solicitud PULL, esperando que Origen decida
    { origenSucursalId: sucursalId, estado: "ENVIADA", iniciadoPor: "ORIGEN" }, // mi propio envío PUSH, esperando que Destino decida
  ];
}

/**
 * Lectura de la Bandeja — abierta (leer no necesita el permiso de
 * escritura, mismo criterio que el resto del proyecto). Separa lo que hay
 * que ACCIONAR (siempre un puñado de traspasos en tránsito, sin límite:
 * por diseño de negocio nunca crece) del historial (crece con cada
 * traspaso resuelto desde que existe la sucursal — paginado por cursor,
 * hallazgo de la diligencia de motor2: "bandeja de traspasos sin límite").
 */
export async function obtenerBandejaTransferencias(sucursalId: string, cursorHistorial?: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "proceso_transferencia_sucursal");
  const [enCurso, historialMasUno] = await Promise.all([
    ctx.db.traspasoSucursal.findMany({
      where: { OR: condicionesEnCurso(sucursalId) },
      include: INCLUDE_BANDEJA,
      orderBy: { creadoEn: "desc" },
    }),
    ctx.db.traspasoSucursal.findMany({
      where: {
        AND: [{ OR: [{ origenSucursalId: sucursalId }, { destinoSucursalId: sucursalId }] }, { NOT: { OR: condicionesEnCurso(sucursalId) } }],
      },
      include: INCLUDE_BANDEJA,
      orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
      take: TAMANO_PAGINA_HISTORIAL + 1,
      ...(cursorHistorial ? { cursor: { id: cursorHistorial }, skip: 1 } : {}),
    }),
  ]);

  const paraAprobar = enCurso.filter((t) => t.origenSucursalId === sucursalId && t.estado === "SOLICITADA");
  const paraAceptar = enCurso.filter((t) => t.destinoSucursalId === sucursalId && t.estado === "ENVIADA");
  const paraReingreso = enCurso.filter((t) => t.origenSucursalId === sucursalId && t.estado === "RECHAZADA_DESTINO");
  // Lo que ESTA sucursal inició y sigue esperando que decida la otra — nada para accionar acá, solo visibilidad (y, para la solicitud PULL propia, poder cancelarla).
  const esperando = enCurso.filter(
    (t) =>
      (t.destinoSucursalId === sucursalId && t.estado === "SOLICITADA" && t.iniciadoPor === "DESTINO") ||
      (t.origenSucursalId === sucursalId && t.estado === "ENVIADA" && t.iniciadoPor === "ORIGEN")
  );

  const hayMasHistorial = historialMasUno.length > TAMANO_PAGINA_HISTORIAL;
  const historial = hayMasHistorial ? historialMasUno.slice(0, TAMANO_PAGINA_HISTORIAL) : historialMasUno;

  return {
    paraAprobar,
    paraAceptar,
    paraReingreso,
    esperando,
    historial,
    nextCursorHistorial: hayMasHistorial ? historial[historial.length - 1].id : null,
  };
}

/** Otras sucursales activas (nunca la propia) — para los <select> de origen/destino. */
export async function listarSucursalesDisponibles(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "proceso_transferencia_sucursal");
  return ctx.db.sucursal.findMany({ where: { activo: true, id: { not: sucursalId } }, orderBy: { nombre: "asc" } });
}

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

/**
 * S-15 (plan de endurecimiento de seguridad, T7): lo que la Bandeja dibuja y nada más. Una Server Action exportada es una puerta HTTP: quien tiene `traspaso_ver_bandeja` (piso
 * operario) la invoca a mano y recibe TODO lo que devuelve, no lo que la pantalla muestra. Antes volvían el `Producto` entero (con el costo de consignación, que es de
 * `pagar_consignante`) y el `User` entero de quien creó el traspaso (foto, cuenta verificada, kill-switch). Las dos sucursales y las dos secciones se piden por nombre.
 * Si la pantalla necesita un campo más, se AGREGA acá (nunca se vuelve a `include: { x: true }`: GT-3a).
 */
const SELECT_BANDEJA = {
  id: true,
  creadoEn: true,
  origenSucursalId: true,
  destinoSucursalId: true,
  cantidad: true,
  iniciadoPor: true,
  estado: true,
  detalle: true,
  motivoRechazoOrigen: true,
  motivoRechazoDestino: true,
  producto: { select: { nombre: true, codigo: true, unidadStock: { select: { nombre: true } } } },
  origenSucursal: { select: { nombre: true } },
  destinoSucursal: { select: { nombre: true } },
  seccionOrigen: { select: { nombre: true } },
  seccionDestino: { select: { nombre: true } },
  creadoPor: { select: { email: true } },
} satisfies Prisma.TraspasoSucursalSelect;

const TAMANO_PAGINA_HISTORIAL = 30;

/**
 * Todo lo que sigue "en curso" — quien las cumple nunca es historial. Las
 * primeras 3 son "hay algo para ACCIONAR" de este lado (paraAprobar/
 * paraAceptar/paraReingreso); las últimas 2 son lo que ESTA sucursal
 * mandó y sigue esperando que decida la otra: mi solicitud PULL sin
 * respuesta, y todo lo que YA SALIÓ de mi stock como Origen y el Destino
 * todavía no aceptó (ENVIADA). Esto último vale con cualquier
 * `iniciadoPor`: un PULL que aprobé también queda ENVIADA con
 * origenSucursalId=yo, el stock ya salió de mi Kardex y no está en ningún
 * lado hasta que el Destino acepte — mismo estado que un PUSH propio, así
 * que no debe esconderse en el historial (el indicador de stock en tránsito
 * de /stock/consolidado lo cuenta igual).
 */
function condicionesEnCurso(sucursalId: string): Prisma.TraspasoSucursalWhereInput[] {
  return [
    { origenSucursalId: sucursalId, estado: "SOLICITADA" },
    { destinoSucursalId: sucursalId, estado: "ENVIADA" },
    { origenSucursalId: sucursalId, estado: "RECHAZADA_DESTINO" },
    { destinoSucursalId: sucursalId, estado: "SOLICITADA", iniciadoPor: "DESTINO" }, // mi propia solicitud PULL, esperando que Origen decida
    { origenSucursalId: sucursalId, estado: "ENVIADA" }, // lo que salió de mi stock (PUSH propio o PULL que aprobé), esperando que Destino acepte
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
  const ctx = await requerirVerEnSucursal(sucursalId, "traspaso_ver_bandeja");
  const [enCurso, historialMasUno] = await Promise.all([
    ctx.db.traspasoSucursal.findMany({
      where: { OR: condicionesEnCurso(sucursalId) },
      select: SELECT_BANDEJA,
      orderBy: { creadoEn: "desc" },
    }),
    ctx.db.traspasoSucursal.findMany({
      where: {
        AND: [{ OR: [{ origenSucursalId: sucursalId }, { destinoSucursalId: sucursalId }] }, { NOT: { OR: condicionesEnCurso(sucursalId) } }],
      },
      select: SELECT_BANDEJA,
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
      (t.origenSucursalId === sucursalId && t.estado === "ENVIADA")
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

/** Otras sucursales activas (nunca la propia) — para los <select> de origen/destino. Cada pantalla pide Ver con la clave de SU acción. */
function otrasSucursalesActivas(db: Awaited<ReturnType<typeof requerirVerEnSucursal>>["db"], sucursalId: string) {
  return db.sucursal.findMany({ where: { activo: true, id: { not: sucursalId } }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
}

/** Las sucursales a las que se les puede pedir stock (pantalla «Solicitar»). */
export async function listarSucursalesParaSolicitar(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "traspaso_solicitar");
  return otrasSucursalesActivas(ctx.db, sucursalId);
}

/** Las sucursales a las que se les puede enviar stock directo (pantalla «Enviar directo»). */
export async function listarSucursalesParaEnviar(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "traspaso_enviar_directo");
  return otrasSucursalesActivas(ctx.db, sucursalId);
}

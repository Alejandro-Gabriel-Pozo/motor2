import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { altaDeParte, buscarFichasDeParte, cambiarEstadoDeParte, editarParte } from "../../src/server/actions/partes/partes";
import { EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { activarTodosLosModulos } from "../setup/modulos";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { EMPRESA_POR_DEFECTO_ID as A, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";

/**
 * Parte P1 (b): CADA acción de la ficha verifica en el SERVIDOR quién pide y si tiene el permiso EXACTO de esa acción (regla del proyecto: nunca confiar en el frontend). Para cada una de las cuatro acciones
 * (`altaDeParte` y `editarParte` piden `partes_editar`; `cambiarEstadoDeParte` pide `partes_desactivar`; `buscarFichasDeParte` pide `partes_ver`):
 *  (a) un usuario con TODAS las claves `partes_*` MENOS la que la acción exige es RECHAZADO (una clave no presta la otra) y no cambia nada en la base (fichas, versión, auditoría);
 *  (b) un usuario sin ninguna clave `partes_*` es rechazado, y sin efecto;
 *  (c) con el permiso exacto pasa (el piso manda: `partes_desactivar` es de piso administrador, así que la tiene el administrador de fábrica; las otras dos, un rol propio con solo esa fila);
 *  (d) un usuario de OTRA empresa (con todos los permisos en la suya) no ve ni toca la ficha ajena: no se encuentra y la base no cambia.
 * Mutación demostrada (anotada en el commit): cambiar en `src/server/actions/partes/partes.ts` el permiso de una acción por otro `partes_*` deja en rojo los casos (a) o (c) de esa acción; volver deja todo verde.
 */
type Clave = "partes_ver" | "partes_editar" | "partes_desactivar";
const TODAS: readonly Clave[] = ["partes_ver", "partes_editar", "partes_desactivar"];
const datos = { naturaleza: "HUMANA", nombre: "Persona Nueva" };

let parteId: string;
let centralId: string;
const actores: Record<string, { id: string; email: string }> = {};

async function rolCon(nombre: string, claves: readonly Clave[]) {
  const rol = await prisma.rol.create({ data: { nombre } });
  await prisma.permisoRol.createMany({ data: claves.map((accionClave) => ({ rolId: rol.id, accionClave, puedeVer: true, puedeEditar: true })) });
  return rol;
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  __setCookieDeTestParaSucursal(undefined);
  const base = await sembrarBase();
  centralId = base.sucursal.id;
  // Un actor por acción con todas las claves MENOS la que esa acción exige, uno sin ninguna y uno con exactamente la que exige cada acción de piso operario.
  for (const faltante of TODAS) {
    const rol = await rolCon(`todas-menos-${faltante}`, TODAS.filter((c) => c !== faltante));
    actores[`menos-${faltante}`] = await crearUsuarioConMembresia({ email: `menos-${faltante}@test.com`, sucursalId: centralId, rolId: rol.id });
  }
  const vacio = await rolCon("sin-partes", []);
  actores.ninguna = await crearUsuarioConMembresia({ email: "ninguna@test.com", sucursalId: centralId, rolId: vacio.id });
  for (const exacta of ["partes_ver", "partes_editar"] as const) {
    const rol = await rolCon(`solo-${exacta}`, [exacta]);
    actores[`solo-${exacta}`] = await crearUsuarioConMembresia({ email: `solo-${exacta}@test.com`, sucursalId: centralId, rolId: rol.id });
  }
  actores.admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });

  // Una ficha propia sobre la que se intenta editar y desactivar (como dueño: es un fixture).
  parteId = randomUUID();
  await prismaAdmin.parte.create({ data: { id: parteId, empresaId: A, idempotenciaAlta: randomUUID(), payloadHash: "h", naturaleza: "HUMANA", nombre: "Ana Pérez" } });

  // OTRA empresa con su propio administrador con todos los permisos en la suya.
  const sucursalAjena = await prismaAdmin.sucursal.create({ data: { nombre: "Ajena", empresaId: EMPRESA_TESTIGO_ID } });
  const rolAjeno = await prismaAdmin.rol.create({ data: { nombre: "admin", clave: "admin", empresaId: EMPRESA_TESTIGO_ID } });
  await prismaAdmin.permisoRol.createMany({ data: TODAS.map((accionClave) => ({ empresaId: EMPRESA_TESTIGO_ID, rolId: rolAjeno.id, accionClave, puedeVer: true, puedeEditar: true })) });
  const ajeno = await prismaAdmin.user.create({ data: { email: "ajeno@test.com" } });
  await crearMembresia({ usuarioId: ajeno.id, sucursalId: sucursalAjena.id, rolId: rolAjeno.id });
  await activarTodosLosModulos(EMPRESA_TESTIGO_ID);
  actores.ajeno = ajeno;
});

afterAll(() => {
  __setCookieDeTestParaSucursal(undefined);
});

const como = (actor: { id: string; email: string }) => mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });
const foto = async () => ({
  partes: await prismaAdmin.parte.findMany({ orderBy: { id: "asc" } }),
  auditoria: await prismaAdmin.registroAuditoria.count(),
});

interface Accion {
  nombre: string;
  exige: Clave;
  /** Quién la tiene con el permiso exacto (el piso manda: `partes_desactivar` es de piso administrador). */
  exacto: string;
  llamar: () => Promise<unknown>;
  /** Lo que devuelve cuando PASA (para no confundir un rechazo del caso de uso con uno del permiso). */
  pasa: (r: unknown) => boolean;
}
const ACCIONES_DE_PARTE: Accion[] = [
  { nombre: "altaDeParte", exige: "partes_editar", exacto: "solo-partes_editar", llamar: () => altaDeParte({ claveIdempotencia: randomUUID(), datos }), pasa: (r) => (r as { ok: boolean }).ok === true },
  { nombre: "editarParte", exige: "partes_editar", exacto: "solo-partes_editar", llamar: () => editarParte({ parteId, versionEsperada: 1, datos: { naturaleza: "HUMANA", nombre: "Ana Gómez" } }), pasa: (r) => (r as { ok: boolean }).ok === true },
  { nombre: "cambiarEstadoDeParte", exige: "partes_desactivar", exacto: "admin", llamar: () => cambiarEstadoDeParte(parteId, false), pasa: (r) => (r as { ok: boolean }).ok === true },
  { nombre: "buscarFichasDeParte", exige: "partes_ver", exacto: "solo-partes_ver", llamar: () => buscarFichasDeParte("Ana"), pasa: (r) => Array.isArray(r) && r.length === 1 },
];

/** Una acción rechazada por permiso: o devuelve `{ ok: false }` sin `codigo` (el rechazo del caso de uso SÍ lleva `codigo`) o, la lectura, lanza. */
async function llamarYVerRechazo(a: Accion): Promise<void> {
  const antes = await foto();
  const resultado = await a.llamar().then(
    (r) => ({ r }),
    (e: unknown) => ({ lanzo: e instanceof Error ? e.message : String(e) }),
  );
  if ("lanzo" in resultado) expect(resultado.lanzo, `${a.nombre}: no dice que falta el permiso`).toMatch(/permiso|acceso|No tenés|no tiene/i);
  else expect(resultado.r, `${a.nombre}: debía rechazar por permiso`).toMatchObject({ ok: false, mensaje: expect.stringMatching(/permiso|acceso|No tenés|no tiene/i) });
  expect(await foto(), `${a.nombre}: la base cambió`).toEqual(antes);
}

describe("las acciones de la ficha de parte verifican el permiso exacto en el servidor", () => {
  it.each(ACCIONES_DE_PARTE.map((a) => [a.nombre, a] as const))("(a) con todas las claves partes_* MENOS la que exige: %s rechaza y no cambia nada", async (_n, a) => {
    await como(actores[`menos-${a.exige}`]!);
    await llamarYVerRechazo(a);
  });

  it.each(ACCIONES_DE_PARTE.map((a) => [a.nombre, a] as const))("(b) sin ninguna clave partes_*: %s rechaza y no cambia nada", async (_n, a) => {
    await como(actores.ninguna!);
    await llamarYVerRechazo(a);
  });

  it.each(ACCIONES_DE_PARTE.map((a) => [a.nombre, a] as const))("(c) con el permiso exacto: %s pasa", async (_n, a) => {
    await como(actores[a.exacto]!);
    expect(a.pasa(await a.llamar().catch((e: unknown) => ({ lanzo: String(e) }))), `${a.nombre} no pasó con ${a.exige}`).toBe(true);
  });

  it("(c) el piso manda: un rol propio con la fila de partes_desactivar NO desactiva (es de piso administrador)", async () => {
    const rol = await rolCon("encargado-con-desactivar", ["partes_desactivar"]);
    const encargado = await crearUsuarioConMembresia({ email: "encargado@test.com", sucursalId: centralId, rolId: rol.id });
    await como(encargado);
    await llamarYVerRechazo(ACCIONES_DE_PARTE[2]!);
  });

  it("(d) un usuario de OTRA empresa (con todos los permisos en la suya) no ve la ficha ajena: la edición y la desactivación no la encuentran, la búsqueda no la trae, y la base no cambia", async () => {
    await como(actores.ajeno!);
    const antes = await foto();
    expect(await editarParte({ parteId, versionEsperada: 1, datos: { naturaleza: "HUMANA", nombre: "Intruso" } })).toMatchObject({ ok: false, codigo: "PARTE_NO_ENCONTRADA" });
    expect(await cambiarEstadoDeParte(parteId, false)).toMatchObject({ ok: false, codigo: "PARTE_NO_ENCONTRADA" });
    expect(await buscarFichasDeParte("Ana")).toEqual([]);
    expect(await foto()).toEqual(antes);
    // El alta en SU empresa sí entra y no toca la de la otra.
    expect(await altaDeParte({ claveIdempotencia: randomUUID(), datos })).toMatchObject({ ok: true });
    expect(await prismaAdmin.parte.count({ where: { empresaId: A } })).toBe(1);
    expect(await prismaAdmin.parte.count({ where: { empresaId: EMPRESA_TESTIGO_ID } })).toBe(1);
  });
});

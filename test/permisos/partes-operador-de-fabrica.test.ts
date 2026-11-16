import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { altaDeParte, buscarFichasDeParte, cambiarEstadoDeParte, editarParte } from "../../src/server/actions/partes/partes";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { EMPRESA_POR_DEFECTO_ID as A, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";

/**
 * Parte P1 — el rol de fábrica `operador` (como Pedernal; pedido del dueño 2026-11-16: «como pedernal,»): busca (`partes_ver`), da de alta y edita (`partes_editar`) fichas de personas y empresas, y NO desactiva
 * (`partes_desactivar` es de piso administrador: se rechaza en el servidor y la base queda intacta). Una empresa nueva sembrada nace con esa matriz.
 * Mutación demostrada (anotada en el PR): dar `partes_desactivar` al operador en `rolesEditarSemilla` de `acciones.ts` deja en rojo «la matriz de fábrica» y «NO desactiva»; sacar `operador` de `partes_editar` deja en rojo el alta y la edición.
 */
const datos = { naturaleza: "HUMANA", nombre: "Persona Nueva" };
let operador: { id: string; email: string };
let parteId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  __setCookieDeTestParaSucursal(undefined);
  const base = await sembrarBase();
  operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
  parteId = randomUUID();
  await prismaAdmin.parte.create({ data: { id: parteId, empresaId: A, idempotenciaAlta: randomUUID(), payloadHash: "h", naturaleza: "HUMANA", nombre: "Ana Pérez" } });
  mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
});

afterAll(() => {
  __setCookieDeTestParaSucursal(undefined);
});

describe("el operador de fábrica y las fichas de Parte", () => {
  it("la matriz de fábrica de una empresa sembrada: el operador tiene partes_ver y partes_editar (Ver y Editar) y NO partes_desactivar; el admin las tres", async () => {
    const filas = await prismaAdmin.permisoRol.findMany({ where: { accionClave: { startsWith: "partes_" } }, include: { rol: true }, orderBy: [{ accionClave: "asc" }] });
    const de = (clave: string | null) => filas.filter((f) => f.rol.clave === clave).map((f) => `${f.accionClave}:${f.puedeVer}:${f.puedeEditar}`);
    expect(de("operador")).toEqual(["partes_editar:true:true", "partes_ver:true:true"]);
    expect(de("admin")).toEqual(["partes_desactivar:true:true", "partes_editar:true:true", "partes_ver:true:true"]);
  });

  it("busca y encuentra la ficha de su empresa", async () => {
    expect(await buscarFichasDeParte("Ana")).toHaveLength(1);
  });

  it("da de alta una ficha, y repetir la misma clave de idempotencia no duplica", async () => {
    const claveIdempotencia = randomUUID();
    expect(await altaDeParte({ claveIdempotencia, datos })).toMatchObject({ ok: true });
    await altaDeParte({ claveIdempotencia, datos });
    expect(await prismaAdmin.parte.count({ where: { empresaId: A, nombre: "Persona Nueva" } })).toBe(1);
  });

  it("edita una ficha con la versión esperada", async () => {
    expect(await editarParte({ parteId, versionEsperada: 1, datos: { naturaleza: "HUMANA", nombre: "Ana Gómez" } })).toMatchObject({ ok: true });
    expect((await prismaAdmin.parte.findUniqueOrThrow({ where: { id: parteId } })).nombre).toBe("Ana Gómez");
  });

  it("NO desactiva: el servidor lo rechaza (piso administrador) y la base queda intacta", async () => {
    const antes = { parte: await prismaAdmin.parte.findUniqueOrThrow({ where: { id: parteId } }), auditoria: await prismaAdmin.registroAuditoria.count() };
    const r = await cambiarEstadoDeParte(parteId, false).catch((e: unknown) => ({ ok: false, mensaje: e instanceof Error ? e.message : String(e) }));
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringMatching(/permiso|acceso|No tenés|no tiene/i) });
    expect({ parte: await prismaAdmin.parte.findUniqueOrThrow({ where: { id: parteId } }), auditoria: await prismaAdmin.registroAuditoria.count() }).toEqual(antes);
  });

  it("no se le puede dar partes_desactivar al operador por el piso: la fila a mano tampoco lo habilita", async () => {
    const rol = await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } });
    await prismaAdmin.permisoRol.create({ data: { empresaId: A, rolId: rol.id, accionClave: "partes_desactivar", puedeVer: true, puedeEditar: true } });
    const r = await cambiarEstadoDeParte(parteId, false).catch((e: unknown) => ({ ok: false, mensaje: e instanceof Error ? e.message : String(e) }));
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringMatching(/permiso|acceso|No tenés|no tiene|nivel/i) });
    expect((await prismaAdmin.parte.findUniqueOrThrow({ where: { id: parteId } })).estado).toBe("ACTIVA");
  });
});

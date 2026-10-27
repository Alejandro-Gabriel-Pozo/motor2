import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarPromoCarta } from "../../src/server/actions/carta/promos";
import { guardComandoGuardarPromoCarta } from "../../src/core/features/carta/promos.guard";
import { resolverMenuCarta } from "../../src/server/lecturas/carta/menu";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * Alta de una promo ya en «solo salón» (docs/diseno-promo-solo-salon-2026-10-26.md, paso 6, P2): el precio pactado nunca llega a quedar publicado ni indexado. Sin la casilla, el alta es la de siempre (pública, sin fila de auditoría de
 * «solo salón»). En una EDICIÓN el interruptor no viaja (se cambia con `guardarSoloSalonPromoCarta`, con la versión que vio la pantalla): pedirlo se rechaza.
 */
describe("guardarPromoCarta: alta con «solo salón»", () => {
  let sucursalId: string;
  let seccionId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Menús" } })).id;
  });

  const auditoriaSoloSalon = () => prismaAdmin.registroAuditoria.findMany({ where: { entidad: "PromoCarta", campo: "soloSalon" } });

  it("nace en «solo salón»: la fila lo trae, queda auditado (de null a true) y la carta pública no la muestra", async () => {
    expect(await guardarPromoCarta({ seccionCartaId: seccionId, titulo: "Menú pactado", precio: 20000, soloSalon: true })).toMatchObject({ ok: true });
    const promo = await prisma.promoCarta.findFirstOrThrow({ where: { titulo: "Menú pactado" } });
    expect(promo).toMatchObject({ soloSalon: true, version: 1 });
    const filas = await auditoriaSoloSalon();
    expect(filas.map((f) => [f.entidadId, f.valorAnterior, f.valorNuevo])).toEqual([[promo.id, null, "true"]]);
    // La sucursal que la creó la ofrece (el admin puede prenderla): al público, nunca; al salón, sí.
    expect((await resolverMenuCarta(sucursalId, prisma, AHORA_DE_LA_CORRIDA))!.secciones.flatMap((s) => s.promos)).toEqual([]);
    expect((await resolverMenuCarta(sucursalId, prisma, AHORA_DE_LA_CORRIDA, undefined, "salon"))!.secciones.flatMap((s) => s.promos).map((p) => p.titulo)).toEqual(["Menú pactado"]);
  });

  it("sin la casilla (o con false) el alta es la de siempre: pública, sin fila de auditoría de «solo salón»", async () => {
    expect(await guardarPromoCarta({ seccionCartaId: seccionId, titulo: "Combo", precio: 9000 })).toMatchObject({ ok: true });
    expect(await guardarPromoCarta({ seccionCartaId: seccionId, titulo: "Combo 2", precio: 9000, soloSalon: false })).toMatchObject({ ok: true });
    expect((await prisma.promoCarta.findMany()).map((p) => p.soloSalon)).toEqual([false, false]);
    expect(await auditoriaSoloSalon()).toHaveLength(0);
    expect((await resolverMenuCarta(sucursalId, prisma, AHORA_DE_LA_CORRIDA))!.secciones.flatMap((s) => s.promos).map((p) => p.titulo).sort()).toEqual(["Combo", "Combo 2"]);
  });

  it("validación: un valor que no es booleano se rechaza sin crear nada; en una edición el interruptor no viaja (se rechaza, no se ignora)", async () => {
    for (const malo of ["true", 1, null, {}]) {
      const r = await guardarPromoCarta({ seccionCartaId: seccionId, titulo: "Malo", precio: 1000, soloSalon: malo as never });
      expect(r.ok, String(malo)).toBe(false);
    }
    expect(await prisma.promoCarta.count()).toBe(0);
    await guardarPromoCarta({ seccionCartaId: seccionId, titulo: "Existente", precio: 1000 });
    const existente = await prisma.promoCarta.findFirstOrThrow();
    const r = await guardarPromoCarta({ id: existente.id, seccionCartaId: seccionId, titulo: "Existente", precio: 1000, soloSalon: true });
    expect(r).toMatchObject({ ok: false });
    expect(r.mensaje).toContain("Dónde se ve");
    expect(await prisma.promoCarta.findUniqueOrThrow({ where: { id: existente.id } })).toMatchObject({ soloSalon: false, version: 1 });
    expect(await auditoriaSoloSalon()).toHaveLength(0);
  });

  it("el guard devuelve el comando de siempre (sin la clave) cuando no se pide, y soloSalon: true cuando se pide", () => {
    const base = { seccionCartaId: "s1", titulo: "X", precio: 100 };
    expect(guardComandoGuardarPromoCarta(base)).toEqual({ ok: true, valor: { seccionCartaId: "s1", titulo: "X", descripcion: null, precio: 100, orden: 0 } });
    expect(guardComandoGuardarPromoCarta({ ...base, soloSalon: false })).toEqual({ ok: true, valor: { seccionCartaId: "s1", titulo: "X", descripcion: null, precio: 100, orden: 0 } });
    expect(guardComandoGuardarPromoCarta({ ...base, soloSalon: true })).toMatchObject({ ok: true, valor: { soloSalon: true } });
  });
});

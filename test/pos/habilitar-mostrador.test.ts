import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { entrarComo, sembrarSalon } from "./salon-fixture";
import { habilitarMostrador } from "../../src/server/actions/pos/mesas";
import { habilitarMostradorCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/habilitar-mostrador";

/**
 * M1.4b del mostrador (ADR-039): «Habilitar el mostrador». Concurrencia e idempotencia con la base real (la prueba que el dueño pide: dos «Habilitar» a la vez dejan UNA fila),
 * auditoría, sucursal apagada y una sucursal que no pisa a la otra. El permiso (`pos_alta_mesa`) y el módulo Salón apagado los fijan `pos-rechaza-sin-permiso` y `modulos-apagados-en-el-pos`.
 */
describe("habilitarMostrador", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const mostradores = () => prisma.mesa.findMany({ where: { tipo: "MOSTRADOR" } });
  const filasDeAuditoria = () => prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Mesa" } });

  it("crea el puesto: la mesa 0 de tipo MOSTRADOR en la sucursal activa, con UNA fila de auditoría de quién lo habilitó", async () => {
    expect(await habilitarMostrador()).toEqual({ ok: true, mensaje: "Mostrador habilitado." });
    const puestos = await mostradores();
    expect(puestos).toHaveLength(1);
    expect(puestos[0]).toMatchObject({ sucursalId: s.sucursalId, numero: 0, tipo: "MOSTRADOR" });
    const filas = await filasDeAuditoria();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ entidad: "Mesa", entidadId: puestos[0].id, campo: "tipo", valorAnterior: null, valorNuevo: "MOSTRADOR", actorId: s.admin.id, sucursalId: s.sucursalId });
  });

  it("idempotente por estado: la segunda vez responde «ya estaba habilitado» sin escribir ni auditar", async () => {
    await habilitarMostrador();
    expect(await habilitarMostrador()).toEqual({ ok: true, mensaje: "El mostrador ya estaba habilitado." });
    expect(await mostradores()).toHaveLength(1);
    expect(await filasDeAuditoria()).toHaveLength(1);
  });

  for (const cuantas of [2, 5]) {
    it(`${cuantas} «Habilitar» a la vez: una crea, el resto responde «ya estaba habilitado», una sola fila y una sola fila de auditoría`, async () => {
      const resultados = await Promise.all(Array.from({ length: cuantas }, () => habilitarMostrador()));
      expect(resultados.every((r) => r.ok), resultados.map((r) => r.mensaje).join(" / ")).toBe(true);
      expect(resultados.filter((r) => r.mensaje === "Mostrador habilitado.")).toHaveLength(1);
      expect(resultados.filter((r) => r.mensaje === "El mostrador ya estaba habilitado.")).toHaveLength(cuantas - 1);
      expect(await mostradores()).toHaveLength(1);
      expect(await filasDeAuditoria()).toHaveLength(1);
    });
  }

  it("la carrera se repite sin dejar dos filas (varias rondas, una sucursal nueva por ronda)", async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const sucursal = await prisma.sucursal.create({ data: { nombre: `Ronda ${ronda}` } });
      const { transaccion } = baseDeTest({ lectura: [sucursal.id], escritura: [sucursal.id] });
      const actor = { usuarioId: s.admin.id, sucursalId: sucursal.id, transaccion };
      const resultados = await Promise.all([habilitarMostradorCasoDeUso(actor), habilitarMostradorCasoDeUso(actor), habilitarMostradorCasoDeUso(actor)]);
      expect(resultados.every((r) => r.ok), `ronda ${ronda}: ${resultados.map((r) => r.mensaje).join(" / ")}`).toBe(true);
      expect(resultados.filter((r) => r.ok && r.datos.creado), `ronda ${ronda}`).toHaveLength(1);
      expect(new Set(resultados.flatMap((r) => (r.ok ? [r.datos.mesaId] : []))).size, `ronda ${ronda}: todos devuelven el mismo puesto`).toBe(1);
      expect(await prisma.mesa.count({ where: { sucursalId: sucursal.id, tipo: "MOSTRADOR" } }), `ronda ${ronda}`).toBe(1);
    }
  });

  it("cada sucursal tiene el suyo: habilitar el de una no toca el de otra", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    await habilitarMostrador();
    const { transaccion } = baseDeTest({ lectura: [norte.id], escritura: [norte.id] });
    const r = await habilitarMostradorCasoDeUso({ usuarioId: s.admin.id, sucursalId: norte.id, transaccion });
    expect(r).toMatchObject({ ok: true, mensaje: "Mostrador habilitado.", datos: { creado: true } });
    expect((await mostradores()).map((m) => m.sucursalId).sort()).toEqual([s.sucursalId, norte.id].sort());
  });

  it("una sucursal desactivada no habilita el mostrador (SUCURSAL_INACTIVA) y no escribe nada", async () => {
    await prisma.sucursal.update({ where: { id: s.sucursalId }, data: { activo: false } });
    const r = await habilitarMostradorCasoDeUso({ usuarioId: s.admin.id, sucursalId: s.sucursalId, transaccion: baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).transaccion });
    expect(r).toMatchObject({ ok: false, codigo: "SUCURSAL_INACTIVA" });
    expect(await mostradores()).toEqual([]);
    expect(await filasDeAuditoria()).toEqual([]);
  });

  it("habilitar no toca las mesas de salón: el mapa y los números siguen igual", async () => {
    await habilitarMostrador();
    expect((await prisma.mesa.findMany({ where: { tipo: "SALON" } })).map((m) => m.numero)).toEqual([4]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { crearMozo, entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { anularItemEnviado } from "../../src/server/actions/pos/cuenta-anulacion";
import { obtenerMapaDeMesas } from "../../src/core/pos/mesas";
import { listarRegistrosAuditoria } from "../../src/core/permisos/auditoria";

/**
 * Anulación de un ítem ya enviado a cocina (src/server/actions/pos/cuenta.ts, docs/plan-tomar-pedido-2026-09-25.md paso 5): fila
 * espejo negativa + auditoría, con motivo obligatorio, guarda optimista y permiso propio (`pos_anular_item`).
 */
describe("anularItemEnviado (server action)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cuenta: Awaited<ReturnType<typeof sembrarCuenta>>;
  let mila: (typeof cuenta.items)[number];

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
    cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 3, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 },
    ]);
    mila = cuenta.items[0];
  });

  const espejosDe = (itemId: string) => prisma.cuentaItem.findMany({ where: { anulaAItemId: itemId }, orderBy: { creadoEn: "asc" } });

  it("anulación parcial: fila espejo negativa con el mismo producto/precio/envío, el motivo y quién; el original intacto; el total baja", async () => {
    expect((await obtenerMapaDeMesas(s.sucursalId)).mesas[0].total).toBe(30000);

    const r = await anularItemEnviado(mila.id, 1, "  Pidió una menos  ", 3);
    expect(r).toEqual({ ok: true, mensaje: "Se anuló 1 × «Milanesa» de la mesa 4." });

    const [espejo] = await espejosDe(mila.id);
    expect({ ...espejo, cantidad: Number(espejo.cantidad), precioUnitario: Number(espejo.precioUnitario) }).toMatchObject({
      cuentaId: cuenta.id, productoId: s.milanesa.id, cantidad: -1, precioUnitario: 9000, numeroEnvio: 1, motivoAnulacion: "Pidió una menos", creadoPorId: s.admin.id,
    });
    const original = await prisma.cuentaItem.findUniqueOrThrow({ where: { id: mila.id } });
    expect([Number(original.cantidad), original.numeroEnvio, original.anulaAItemId]).toEqual([3, 1, null]);
    expect((await obtenerMapaDeMesas(s.sucursalId)).mesas[0].total).toBe(21000);
  });

  it("deja la auditoría con actor, motivo y la cantidad vigente antes/después", async () => {
    await anularItemEnviado(mila.id, 2, "Salió frío", 3);
    const { items } = await listarRegistrosAuditoria({ entidad: "CuentaItem" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      entidad: "CuentaItem",
      entidadId: mila.id,
      campo: "cantidadVigente",
      valorAnterior: "3",
      valorNuevo: "1",
      actorId: s.admin.id,
      sucursalId: s.sucursalId,
    });
    expect(items[0].descripcion).toBe('Mesa 4, envío 1: anulación de 2 × "Milanesa" ya enviado a cocina. Motivo: Salió frío');
  });

  it("anulación total en dos pasos; después ya no queda nada que anular", async () => {
    expect((await anularItemEnviado(mila.id, 1, "Uno menos", 3)).ok).toBe(true);
    expect((await anularItemEnviado(mila.id, 2, "Se fueron", 2)).ok).toBe(true);
    expect((await espejosDe(mila.id)).map((e) => Number(e.cantidad))).toEqual([-1, -2]);
    expect(await anularItemEnviado(mila.id, 1, "Otra más", 0)).toEqual({ ok: false, mensaje: "No se puede anular más de lo que queda de «Milanesa» (0)." });
    expect((await obtenerMapaDeMesas(s.sucursalId)).mesas[0].total).toBe(3000);
  });

  it("exceder lo que queda se rechaza", async () => {
    expect(await anularItemEnviado(mila.id, 4, "Error", 3)).toEqual({ ok: false, mensaje: "No se puede anular más de lo que queda de «Milanesa» (3)." });
    expect(await espejosDe(mila.id)).toEqual([]);
  });

  it("sin motivo (vacío o solo espacios) se rechaza y no escribe nada", async () => {
    for (const motivo of ["", "   "]) {
      expect(await anularItemEnviado(mila.id, 1, motivo, 3)).toEqual({ ok: false, mensaje: "Escribí el motivo de la anulación." });
    }
    expect(await espejosDe(mila.id)).toEqual([]);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

  it("cantidades inválidas se rechazan", async () => {
    for (const cantidad of [0, -1, Number.NaN]) {
      const r = await anularItemEnviado(mila.id, cantidad, "Motivo", 3);
      expect(r.ok, String(cantidad)).toBe(false);
    }
    expect(await espejosDe(mila.id)).toEqual([]);
  });

  it("un ítem sin enviar no se anula: se quita", async () => {
    expect(await anularItemEnviado(cuenta.items[1].id, 1, "Motivo", 1)).toEqual({ ok: false, mensaje: "Ese ítem todavía no salió a cocina: usá «Quitar»." });
  });

  it("una fila espejo no se puede anular (espejo sobre espejo)", async () => {
    await anularItemEnviado(mila.id, 1, "Uno menos", 3);
    const [espejo] = await espejosDe(mila.id);
    expect(await anularItemEnviado(espejo.id, 1, "Otra", -1)).toEqual({ ok: false, mensaje: "Eso ya es una anulación: no se puede anular." });
    expect(await prisma.cuentaItem.count({ where: { anulaAItemId: espejo.id } })).toBe(0);
  });

  it("guarda optimista: si lo que queda cambió desde que se abrió el diálogo, rechaza sin anular", async () => {
    await anularItemEnviado(mila.id, 1, "Uno menos", 3);
    const r = await anularItemEnviado(mila.id, 1, "Otro mozo, mismo plato", 3);
    expect(r).toEqual({ ok: false, mensaje: "«Milanesa» cambió mientras lo mirabas (ahora quedan 2): revisá y volvé a intentar." });
    expect(await espejosDe(mila.id)).toHaveLength(1);
  });

  it("una cuenta cerrada no se toca: hay que anular la venta", async () => {
    await prisma.cuenta.update({ where: { id: cuenta.id }, data: { cerradaEn: new Date() } });
    expect(await anularItemEnviado(mila.id, 1, "Tarde", 3)).toEqual({ ok: false, mensaje: "La cuenta de la mesa 4 ya se cerró: anulá la venta (Reportes › Trazabilidad)." });
  });

  it("un ítem de otra sucursal no se encuentra", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const mesaNorte = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 1 } });
    const ajena = await sembrarCuenta(mesaNorte.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect(await anularItemEnviado(ajena.items[0].id, 1, "Motivo", 1)).toEqual({ ok: false, mensaje: "No se encontró ese ítem en esta sucursal." });
  });

  it("un mozo con pos_tomar_pedido pero SIN pos_anular_item no puede anular (la guarda es la clave propia)", async () => {
    const mozo = await crearMozo(s.sucursalId);
    await entrarComo(mozo);
    const r = await anularItemEnviado(mila.id, 1, "Motivo", 3);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect(r.mensaje).toContain('"pos_anular_item"');
    expect(await espejosDe(mila.id)).toEqual([]);
  });
});

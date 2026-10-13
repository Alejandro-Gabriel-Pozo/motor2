import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, sembrarCremaDelCafe, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { anularVenta } from "../../src/server/actions/movimientos/venta";

/**
 * GO-2b (ADR-030), contra Postgres real: ANULAR desde Trazabilidad la venta de un producto con adicionales. La del producto arrastra a sus operaciones hijas vigentes
 * (una reversión AJUSTE y una fila de auditoría por cada una); la de un adicional sola se rechaza (`ES_ADICIONAL`); dos anulaciones a la vez dejan UNA reversión por
 * operación.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let ops: { padre: string; hijas: string[] };

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  const crema = await sembrarCremaDelCafe(s, c);
  await entrarComo(s.admin);
  const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
  expect((await agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId), elegida(c, c.shotId), { opcionId: crema.cremaId, cantidad: 1, versionDeOpcionId: crema.versionId }] }])).ok).toBe(true);
  const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
  expect((await enviarACocina(cuentaId, items.map((i) => i.id))).ok).toBe(true);
  expect((await cerrarCuenta(cuentaId)).ok).toBe(true);
  const ventas = await prisma.operacion.findMany({ where: { proceso: "VENTA" }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
  ops = { padre: ventas.find((v) => v.operacionPadreId === null)!.id, hijas: ventas.filter((v) => v.operacionPadreId !== null).map((v) => v.id) };
  expect(ops.hijas).toHaveLength(2);
});

/** Las reversiones (AJUSTE) de las ventas: cada una nombra en su detalle la venta que revierte (`detalleReversionDeVenta`). */
const reversiones = async () =>
  (await prisma.operacion.findMany({ where: { proceso: "AJUSTE" }, select: { detalleLibre: true } })).map((r) => ({ revierteAOperacionId: [ops.padre, ...ops.hijas].find((id) => r.detalleLibre?.includes(id)) ?? null }));

describe("anular la venta de un producto con adicionales (GO-2b)", () => {
  it("la del producto arrastra a sus dos adicionales: tres reversiones, tres auditorías y el mensaje lo dice", async () => {
    const r = await anularVenta(ops.padre);
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).toMatch(/Tenía 2 adicionales: se anuló con ellos\.$/);
    const anuladas = await prisma.operacion.findMany({ where: { id: { in: [ops.padre, ...ops.hijas] } } });
    expect(anuladas.every((o) => o.anuladaEn !== null)).toBe(true);
    expect((await reversiones()).map((x) => x.revierteAOperacionId).sort()).toEqual([ops.padre, ...ops.hijas].sort());
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Operacion", campo: "anuladaEn" } })).toBe(3);
    // Otra vez: ya anulada, sin nada nuevo.
    expect(await anularVenta(ops.padre)).toEqual({ ok: false, mensaje: "Esta venta ya está anulada." });
    expect(await reversiones()).toHaveLength(3);
  });

  it("la venta de un adicional sola no se anula (ES_ADICIONAL) y no escribe nada", async () => {
    expect(await anularVenta(ops.hijas[0]!)).toEqual({ ok: false, mensaje: "Esta venta es un adicional de otro producto: anulá la venta de ese producto y se anula con sus adicionales." });
    expect(await reversiones()).toHaveLength(0);
  });

  it("dos anulaciones a la vez (Promise.all): una gana y deja UNA reversión por operación; la otra ve «ya anulada»", async () => {
    const resultados = await Promise.all([anularVenta(ops.padre), anularVenta(ops.padre)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.find((r) => !r.ok)!.mensaje).toBe("Esta venta ya está anulada.");
    const porOperacion = (await reversiones()).map((x) => x.revierteAOperacionId);
    expect(porOperacion.sort()).toEqual([ops.padre, ...ops.hijas].sort());
  });
});

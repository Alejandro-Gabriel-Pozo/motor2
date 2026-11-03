import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, sembrarCremaDelCafe, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { generarReporteVentasSinReceta } from "../../src/server/consultas/reportes/ventas-sin-receta";

/**
 * CARACTERIZACIÓN (no es una regla nueva): qué hace HOY el reporte «Ventas sin receta» con un ADICIONAL cuya opción no tiene consumo cargado (el dueño, 2026-10-29: el adicional sin consumo se
 * sigue vendiendo como hoy, sin descontar nada, y esas ventas tienen que «aparecer en algún lugar»). Cada adicional es SU PROPIA operación de venta (con su producto ancla, colgada de la del producto
 * que lo lleva), y «Ventas sin receta» define «sin receta» como una operación VENTA sin ninguna fila CONSUMO: por eso el adicional sin consumo SÍ aparece, con el nombre de su producto ancla
 * (no con el del producto que lo lleva, que sí descuenta su receta). Si alguna vez este test cambia, cambió lo que el dueño ve en ese reporte.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  await entrarComo(s.admin);
});

async function venderCafeConAdicional(opciones: ReturnType<typeof elegida>[]) {
  const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
  const agregado = await agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones }]);
  expect(agregado.ok, agregado.mensaje).toBe(true);
  const ids = (await prisma.cuentaItem.findMany({ where: { cuentaId }, select: { id: true } })).map((i) => i.id);
  expect((await enviarACocina(cuentaId, ids)).ok).toBe(true);
  const r = await cerrarCuenta(cuentaId);
  expect(r.ok, r.mensaje).toBe(true);
}

describe("«Ventas sin receta» y el adicional sin consumo (caracterización)", () => {
  it("un adicional SIN consumo (Crema) se vende, no descuenta nada y APARECE en «Ventas sin receta» con el nombre de su producto ancla; el café que lo lleva, no", async () => {
    const crema = await sembrarCremaDelCafe(s, c);
    await venderCafeConAdicional([elegida(c, c.chicoId), { opcionId: crema.cremaId, cantidad: 1, versionDeOpcionId: crema.versionId }]);

    // La operación del adicional: una VENTA de su ancla, colgada de la del café, sin ninguna fila CONSUMO.
    const delAdicional = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", operacionPadreId: { not: null } }, include: { movimientos: true } });
    expect(delAdicional.movimientos.map((m) => [m.proceso, m.productoId])).toEqual([["VENTA", crema.anclaId]]);

    const filas = await generarReporteVentasSinReceta(s.sucursalId, prisma);
    expect(filas.map((f) => [f.producto, f.cantidadVentasSinReceta])).toEqual([["Crema", 1]]);
  });

  it("control: un adicional CON consumo (Shot extra) y el café con su receta no aparecen: el reporte queda vacío", async () => {
    await venderCafeConAdicional([elegida(c, c.chicoId), elegida(c, c.shotId)]);
    expect(await generarReporteVentasSinReceta(s.sucursalId, prisma)).toEqual([]);
  });
});

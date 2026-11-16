import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { MENSAJE_PRODUCTO_OCULTO } from "../../src/core/catalogo/public";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { prismaAdmin } from "../setup/cliente-duenio";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";

/**
 * PRUEBA DE CARACTERIZACIÓN (sin código de producto; docs/diseno-ocultar-como-pedernal-2026-11-15.md, I-15 y decisión técnica 10): qué pasa hoy si el producto ANCLA de un adicional (el que respalda al «Shot extra» de un
 * café) queda OCULTO, en la sucursal o en toda la empresa. Lo que se fija acá es lo que HACE el sistema, no lo que se desea:
 *  - el café con su adicional se sigue vendiendo (la línea del adicional no pasa por el rechazo de «oculto»: «los adicionales de una línea configurada no pasan por» `agregarItems`) y se cobra completo;
 *  - el ancla SUELTA se rechaza igual que sin ocultar (ya se rechazaba, y el mensaje no cambia por estar oculta);
 *  - un producto común que sí se oculta se rechaza con el mensaje de «oculto» (control: la marca funciona en este mundo).
 * Si mañana se decide rechazar ocultar un ancla, o hacer que un ancla oculta frene el adicional, esta prueba cambia a propósito.
 */
describe("ocultar el producto ANCLA de un adicional (caracterización)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let c: CafeDelSalon;
  const ocultar = (productoId: string, sucursalId: string | null) =>
    prismaAdmin.ocultamientoProducto.create({ data: { id: crypto.randomUUID(), productoId, sucursalId, oculto: true, actualizadoPorId: s.admin.id, actualizadoEn: new Date() } });

  async function cuentaNueva() {
    const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 10 + (await prisma.cuenta.count()) } });
    return (await sembrarCuenta(mesa.id, s.admin.id)).id;
  }
  /** Un café grande con almendras y shot extra: lleva el adicional respaldado por el ancla. */
  const cafeConShot = () => [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId), elegida(c, c.shotId)] }];

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    c = await sembrarCafeDelSalon(s);
    await entrarComo(s.admin);
  });

  it.each(["en la sucursal", "en toda la empresa"] as const)("con el ancla oculta %s, el café con su adicional se agrega, se envía y se cobra completo", async (alcance) => {
    await ocultar(c.anclaDelShotId, alcance === "en la sucursal" ? s.sucursalId : null);
    const cuentaId = await cuentaNueva();
    const r = await agregarItems(cuentaId, cafeConShot());
    expect(r.ok, r.mensaje).toBe(true);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
    expect(items.map((i) => i.productoId).sort()).toEqual([c.cafeId, c.anclaDelShotId].sort());
    expect((await enviarACocina(cuentaId, items.map((i) => i.id))).ok).toBe(true);
    const cierre = await cerrarCuenta(cuentaId);
    expect(cierre.ok, cierre.mensaje).toBe(true);
  });

  it("el ancla SUELTA se rechaza igual esté oculta o no (el mensaje no cambia, y no dice «oculto»)", async () => {
    const sinOcultar = await agregarItems(await cuentaNueva(), [{ productoId: c.anclaDelShotId, cantidad: 1 }]);
    expect(sinOcultar.ok).toBe(false);
    await ocultar(c.anclaDelShotId, null);
    const oculta = await agregarItems(await cuentaNueva(), [{ productoId: c.anclaDelShotId, cantidad: 1 }]);
    expect(oculta).toEqual(sinOcultar);
    expect(oculta.mensaje).not.toContain(MENSAJE_PRODUCTO_OCULTO);
  });

  it("control: un producto común oculto sí se rechaza con el mensaje de «oculto»", async () => {
    await ocultar(s.flan.id, s.sucursalId);
    const r = await agregarItems(await cuentaNueva(), [{ productoId: s.flan.id, cantidad: 1 }]);
    expect(r).toEqual({ ok: false, mensaje: MENSAJE_PRODUCTO_OCULTO });
  });
});

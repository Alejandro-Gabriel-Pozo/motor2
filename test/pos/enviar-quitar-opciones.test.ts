import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItems, enviarACocina, quitarItemSinEnviar } from "../../src/server/actions/pos/cuenta-pedido";

/**
 * GO-2b (ADR-030), contra Postgres real: enviar a cocina y quitar sin enviar una línea con adicionales. Un producto nunca sale sin sus adicionales ni un adicional sin
 * su producto (pedir uno arrastra al resto de la familia); quitar el producto se lleva sus adicionales y las fotos (cascada); un adicional suelto sin enviar se puede
 * quitar; y quitar contra enviar a la vez deja todo enviado o todo borrado, nunca un adicional huérfano.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let cuentaId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  await entrarComo(s.admin);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});

async function cafeConDosAdicionales() {
  expect((await agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId), elegida(c, c.shotId, 2)] }, { productoId: s.flan.id, cantidad: 1 }])).ok).toBe(true);
  const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
  return { cafe: items.find((i) => i.productoId === c.cafeId)!, shot: items.find((i) => i.productoId === c.anclaDelShotId)!, flan: items.find((i) => i.productoId === s.flan.id)! };
}

describe("enviar a cocina con adicionales (GO-2b)", () => {
  it("pedir SOLO el adicional arrastra a su producto (y pedir el producto, a su adicional); lo demás de la cuenta no", async () => {
    const { shot, flan } = await cafeConDosAdicionales();
    const r = await enviarACocina(cuentaId, [shot.id]);
    expect(r).toMatchObject({ ok: true, numeroEnvio: 1, envioNuevo: true });
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
    expect(items.filter((i) => i.numeroEnvio === 1).map((i) => i.productoId).sort()).toEqual([c.anclaDelShotId, c.cafeId].sort());
    expect(items.find((i) => i.id === flan.id)!.numeroEnvio).toBeNull();
  });

  it("pedir el producto arrastra a su adicional", async () => {
    const { cafe, shot } = await cafeConDosAdicionales();
    expect((await enviarACocina(cuentaId, [cafe.id])).ok).toBe(true);
    expect((await prisma.cuentaItem.findUniqueOrThrow({ where: { id: shot.id } })).numeroEnvio).toBe(1);
  });
});

describe("quitar sin enviar con adicionales (GO-2b)", () => {
  it("quitar el producto borra sus adicionales y todas sus fotos", async () => {
    const { cafe } = await cafeConDosAdicionales();
    expect(await prisma.opcionElegidaEnLinea.count()).toBe(2);
    expect(await quitarItemSinEnviar(cafe.id)).toEqual({ ok: true, mensaje: "Se quitó «Café» de la mesa 4." });
    expect((await prisma.cuentaItem.findMany({ where: { cuentaId } })).map((i) => i.productoId)).toEqual([s.flan.id]);
    expect(await prisma.opcionElegidaEnLinea.count()).toBe(0);
  });

  it("un adicional suelto sin enviar se puede quitar (con su foto); el producto queda", async () => {
    const { cafe, shot } = await cafeConDosAdicionales();
    expect((await quitarItemSinEnviar(shot.id)).ok).toBe(true);
    expect(await prisma.cuentaItem.findUnique({ where: { id: shot.id } })).toBeNull();
    expect(await prisma.cuentaItem.findUnique({ where: { id: cafe.id } })).not.toBeNull();
    expect(await prisma.opcionElegidaEnLinea.count()).toBe(1);
  });

  it("ya enviado: no se quita ni el producto ni su adicional", async () => {
    const { cafe } = await cafeConDosAdicionales();
    await enviarACocina(cuentaId, [cafe.id]);
    expect(await quitarItemSinEnviar(cafe.id)).toEqual({ ok: false, mensaje: "Ese ítem ya salió a cocina: anulalo con motivo." });
    expect(await prisma.cuentaItem.count({ where: { cuentaId, lineaPadreId: cafe.id } })).toBe(1);
  });

  it("quitar contra enviar a la vez (Promise.all, varias vueltas): o todo enviado o todo borrado, nunca un adicional huérfano ni a medias", async () => {
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      await prismaAdmin.opcionElegidaEnLinea.deleteMany({});
      const { cafe, shot } = await cafeConDosAdicionales();
      const pedido = vuelta % 2 === 0 ? [shot.id] : [cafe.id];
      await Promise.all([quitarItemSinEnviar(cafe.id), enviarACocina(cuentaId, pedido)]);
      const padre = await prisma.cuentaItem.findUnique({ where: { id: cafe.id } });
      const adicional = await prisma.cuentaItem.findUnique({ where: { id: shot.id } });
      if (padre === null) expect(adicional, `vuelta ${vuelta}: adicional huérfano`).toBeNull();
      else {
        expect(adicional, `vuelta ${vuelta}`).not.toBeNull();
        expect([padre.numeroEnvio !== null, adicional!.numeroEnvio !== null], `vuelta ${vuelta}`).toEqual([true, true]);
      }
      await prismaAdmin.opcionElegidaEnLinea.deleteMany({});
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId, lineaPadreId: { not: null } } });
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId } });
    }
  });
});

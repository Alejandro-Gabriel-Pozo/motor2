import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import {
  actualizarActivoItemAgrupadoCarta,
  actualizarOrdenOpcionItemAgrupadoCarta,
  quitarOpcionItemAgrupadoCarta,
} from "../../src/server/actions/carta/items-agrupados";

/**
 * Los textos EXACTOS de las acciones de ítems agrupados de la carta, el ORDEN de sus chequeos, el aislamiento por sucursal (la carta es PROPIA de cada una, ADR-009) y
 * CUÁNDO invalidan la carta pública (Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1), ANTES de mudarlas a casos de uso. `acciones-items-agrupados.test.ts` cubre
 * los caminos principales, pero no qué gana cuando dos chequeos fallan a la vez, ni el filtro de sucursal de cada lectura, ni cuántas veces se revalida. Verde contra el
 * código de antes de la mudanza y después.
 */
describe("ítems agrupados de la carta: mensajes, orden de los chequeos, sucursal y revalidación", () => {
  let sucursalId: string;
  let otraId: string;
  let seccionId: string;
  let ids: Record<string, string>;

  beforeEach(async () => {
    vi.mocked(revalidarCartasPublicas).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    otraId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } })).id;
    const pv = async (codigo: string, nombre: string, precioVenta: number) => (await sembrarProductoDisponible({ codigo, nombre, tipo: "PV", precioVenta, unidadStockId: unidadId }, sucursalId)).id;
    ids = { coca: await pv("PV_COCA", "Coca-Cola 500cc", 5000), sprite: await pv("PV_SPRITE", "Sprite 500cc", 5000) };
  });

  const revalidaciones = () => {
    const n = vi.mocked(revalidarCartasPublicas).mock.calls.length;
    vi.mocked(revalidarCartasPublicas).mockClear();
    return n;
  };

  const itemEn = async (sucursal: string, nombre = "Gaseosa") => (await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursal, nombre, seccionCartaId: seccionId } })).id;
  const opcionEn = async (sucursal: string, itemAgrupadoCartaId: string, productoId: string, orden = 0) =>
    (await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: sucursal, itemAgrupadoCartaId, productoId, orden } })).id;

  describe("apagar y prender", () => {
    it("«no se encontró» (id inexistente o ítem de OTRA sucursal) sin revalidar ni escribir; el éxito dice prendido/apagado y revalida UNA vez", async () => {
      const mio = await itemEn(sucursalId);
      const ajeno = await itemEn(otraId, "Del otro lado");
      expect(await actualizarActivoItemAgrupadoCarta("cnoexiste000000000000000", false)).toEqual({ ok: false, mensaje: "No se encontró el ítem agrupado." });
      expect(await actualizarActivoItemAgrupadoCarta(ajeno, false)).toEqual({ ok: false, mensaje: "No se encontró el ítem agrupado." });
      expect(revalidaciones()).toBe(0);
      expect((await prisma.itemAgrupadoCarta.findUniqueOrThrow({ where: { id: ajeno } })).activo).toBe(true);

      expect(await actualizarActivoItemAgrupadoCarta(mio, false)).toEqual({ ok: true, mensaje: 'Ítem agrupado "Gaseosa" apagado.' });
      expect(revalidaciones()).toBe(1);
      expect((await prisma.itemAgrupadoCarta.findUniqueOrThrow({ where: { id: mio } })).activo).toBe(false);
      expect(await actualizarActivoItemAgrupadoCarta(mio, true)).toEqual({ ok: true, mensaje: 'Ítem agrupado "Gaseosa" prendido.' });
      expect(revalidaciones()).toBe(1);
    });
  });

  describe("orden de una opción", () => {
    it("el orden se valida ANTES de leer la opción (un orden roto gana sobre «no se encontró»), sin revalidar", async () => {
      expect(await actualizarOrdenOpcionItemAgrupadoCarta("cnoexiste000000000000000", "x")).toEqual({ ok: false, mensaje: "El orden tiene que ser un número entero." });
      expect(await actualizarOrdenOpcionItemAgrupadoCarta("cnoexiste000000000000000", 1.5)).toEqual({ ok: false, mensaje: "El orden tiene que ser un número entero." });
      expect(await actualizarOrdenOpcionItemAgrupadoCarta("cnoexiste000000000000000", 200_000)).toEqual({ ok: false, mensaje: "El orden tiene que ser un número entero." });
      expect(revalidaciones()).toBe(0);
    });

    it("«no se encontró» (inexistente u opción de OTRA sucursal) sin revalidar; el éxito nombra el producto, vacío o null valen 0 y revalida UNA vez", async () => {
      const mio = await itemEn(sucursalId);
      const miOpcion = await opcionEn(sucursalId, mio, ids.coca, 4);
      const ajeno = await itemEn(otraId, "Del otro lado");
      const opcionAjena = await opcionEn(otraId, ajeno, ids.sprite, 4);
      expect(await actualizarOrdenOpcionItemAgrupadoCarta("cnoexiste000000000000000", 1)).toEqual({ ok: false, mensaje: "No se encontró la opción." });
      expect(await actualizarOrdenOpcionItemAgrupadoCarta(opcionAjena, 9)).toEqual({ ok: false, mensaje: "No se encontró la opción." });
      expect(revalidaciones()).toBe(0);
      expect((await prisma.opcionItemAgrupadoCarta.findUniqueOrThrow({ where: { id: opcionAjena } })).orden).toBe(4);

      expect(await actualizarOrdenOpcionItemAgrupadoCarta(miOpcion, "7")).toEqual({ ok: true, mensaje: "Orden de «Coca-Cola 500cc» guardado." });
      expect(revalidaciones()).toBe(1);
      expect((await prisma.opcionItemAgrupadoCarta.findUniqueOrThrow({ where: { id: miOpcion } })).orden).toBe(7);
      expect((await actualizarOrdenOpcionItemAgrupadoCarta(miOpcion, null)).ok).toBe(true);
      expect((await prisma.opcionItemAgrupadoCarta.findUniqueOrThrow({ where: { id: miOpcion } })).orden).toBe(0);
      expect(revalidaciones()).toBe(1);
      await actualizarOrdenOpcionItemAgrupadoCarta(miOpcion, 3);
      expect((await actualizarOrdenOpcionItemAgrupadoCarta(miOpcion, "")).ok).toBe(true);
      expect((await prisma.opcionItemAgrupadoCarta.findUniqueOrThrow({ where: { id: miOpcion } })).orden).toBe(0);
    });
  });

  describe("quitar una opción", () => {
    it("«no se encontró» (inexistente, de OTRA sucursal o ya quitada) sin revalidar; el éxito nombra producto e ítem, borra solo esa fila y revalida UNA vez", async () => {
      const mio = await itemEn(sucursalId);
      const miOpcion = await opcionEn(sucursalId, mio, ids.coca);
      const otraOpcion = await opcionEn(sucursalId, mio, ids.sprite, 1);
      const ajeno = await itemEn(otraId, "Del otro lado");
      const opcionAjena = await opcionEn(otraId, ajeno, ids.sprite);
      expect(await quitarOpcionItemAgrupadoCarta("cnoexiste000000000000000")).toEqual({ ok: false, mensaje: "No se encontró la opción." });
      expect(await quitarOpcionItemAgrupadoCarta(opcionAjena)).toEqual({ ok: false, mensaje: "No se encontró la opción." });
      expect(revalidaciones()).toBe(0);
      expect(await prisma.opcionItemAgrupadoCarta.count({ where: { id: opcionAjena } })).toBe(1);

      expect(await quitarOpcionItemAgrupadoCarta(miOpcion)).toEqual({ ok: true, mensaje: "«Coca-Cola 500cc» ya no está en «Gaseosa»." });
      expect(revalidaciones()).toBe(1);
      expect((await prisma.opcionItemAgrupadoCarta.findMany({ where: { sucursalId }, select: { id: true } })).map((o) => o.id)).toEqual([otraOpcion]);
      expect(await quitarOpcionItemAgrupadoCarta(miOpcion)).toEqual({ ok: false, mensaje: "No se encontró la opción." });
      expect(revalidaciones()).toBe(0);
    });
  });
});

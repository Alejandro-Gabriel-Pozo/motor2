import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProducto, agregarPresentacionAlternativa, darDeAltaProducto } from "../../src/server/actions/catalogo/productos";

type Resp = { ok: boolean; mensaje: string };
type Accion = (...args: unknown[]) => Promise<Resp>;
const sinTipos = (f: unknown) => f as Accion;

/**
 * S-52 (GT-11; fila O.194 de `docs/pureza-integracion.md`): el alta completa, la edición de un producto y la presentación de compra alternativa tienen su `guardComando…` con rango EN LA PUERTA. El guard
 * se calcula en la acción y `validarDatosDeProducto` / el caso de uso aplican cada rechazo EN EL LUGAR DE SIEMPRE (los decimales del factor y del paso son los de la unidad de stock, que se lee a mitad
 * de camino), así que no cambia ningún mensaje ni el orden: una unidad o un producto inexistentes siguen ganando sobre un número fuera de rango. Se llaman SIN tipos: desde la red llega cualquier cosa.
 */
describe("S-52: los guards de la puerta de las acciones de producto y de presentación", () => {
  let kgId: string;
  let gId: string;
  let sucursalId: string;

  const datos = (extra: object = {}) => ({ nombre: "Queso", tipo: "MP", unidadStockId: kgId, factorConversion: 1, precioVenta: 0, ...extra });
  const productos = () => prisma.producto.count();

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("darDeAltaProducto y actualizarProducto: factor, precio, consignación y paso de venta", () => {
    const FACTORES: [unknown, string][] = [
      [Number.NaN, "El factor de conversión no es un número válido."],
      [Number.POSITIVE_INFINITY, "El factor de conversión no es un número válido."],
      [-1, "El factor de conversión tiene que ser mayor que cero."],
      [0, "El factor de conversión tiene que ser mayor que cero."],
      [1e308, "El factor de conversión es demasiado grande."],
      ["abc", "El factor de conversión no es un número válido."],
      [{}, "El factor de conversión no es un número válido."],
      [undefined, "Falta el factor de conversión."],
      [1.234, "El factor de conversión admite como máximo 2 decimales (unidad \"kg\")."],
    ];

    it.each(FACTORES)("factor %s → %s (alta y edición), sin crear ni cambiar nada", async (factorConversion, mensaje) => {
      expect(await sinTipos(darDeAltaProducto)(datos({ factorConversion }))).toEqual({ ok: false, mensaje });
      expect(await productos()).toBe(0);
      const id = (await sembrarProductoDisponible({ codigo: "MP_Q", nombre: "Queso", tipo: "MP", unidadStockId: kgId, factorConversion: 1 }, sucursalId)).id;
      expect(await sinTipos(actualizarProducto)(id, datos({ factorConversion }))).toEqual({ ok: false, mensaje });
      expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id } })).factorConversion)).toBe(1);
    });

    it("el precio de venta y el de consignación fuera de rango (negativo, NaN, ±Infinity, 1e308, texto, más de 2 decimales) se rechazan", async () => {
      for (const precioVenta of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1e308, "abc", 1.234]) {
        const r = await sinTipos(darDeAltaProducto)(datos({ precioVenta }));
        expect(r.ok, `precio ${precioVenta}`).toBe(false);
        expect(r.mensaje).toMatch(/El precio de venta/);
      }
      for (const precioConsignacion of [-1, Number.NaN, 1e308, "abc"]) {
        const r = await sinTipos(darDeAltaProducto)(datos({ precioConsignacion }));
        expect(r.ok, `consignación ${precioConsignacion}`).toBe(false);
        expect(r.mensaje).toMatch(/El precio de consignación/);
      }
      expect(await sinTipos(darDeAltaProducto)(datos({ esConsignacion: true, precioConsignacion: 10 }))).toEqual({ ok: false, mensaje: "Falta el proveedor de consignación." });
      expect(await productos()).toBe(0);
    });

    it("el paso de venta: solo un PV, mayor que 0 y hasta 1, hasta 4 decimales, que divida a 1; NaN, ±Infinity y 1e308 se rechazan", async () => {
      expect(await sinTipos(darDeAltaProducto)(datos({ pasoVenta: 0.5 }))).toEqual({ ok: false, mensaje: "El paso de venta solo aplica a productos de venta (PV)." });
      const pv = (pasoVenta: unknown) => sinTipos(darDeAltaProducto)(datos({ nombre: "Pizza", tipo: "PV", pasoVenta }));
      expect((await pv(Number.NaN)).mensaje).toBe("El paso de venta tiene que ser un número.");
      expect((await pv(Number.POSITIVE_INFINITY)).mensaje).toBe("El paso de venta tiene que ser un número.");
      expect((await pv("0.5")).mensaje).toBe("El paso de venta tiene que ser un número.");
      expect((await pv(0)).mensaje).toBe("El paso de venta tiene que ser mayor que 0 y hasta 1.");
      expect((await pv(1e308)).mensaje).toBe("El paso de venta tiene que ser mayor que 0 y hasta 1.");
      expect((await pv(0.3)).mensaje).toMatch(/dividir a 1 en partes iguales/);
      expect(await productos()).toBe(0);
    });

    it("unos datos que no son un objeto ya no revientan con un error crudo: se rechazan con un texto", async () => {
      for (const d of [null, undefined, 7, "x"]) {
        expect(await sinTipos(darDeAltaProducto)(d), String(d)).toEqual({ ok: false, mensaje: "Los datos del producto no son válidos." });
        expect(await sinTipos(actualizarProducto)("cualquiera", d), String(d)).toEqual({ ok: false, mensaje: "Los datos del producto no son válidos." });
      }
    });

    it("EL ORDEN: el nombre vacío gana sobre todo; una unidad de stock inexistente gana sobre un número fuera de rango; un producto inexistente (o un tipo distinto) gana en la edición", async () => {
      expect(await sinTipos(darDeAltaProducto)(datos({ nombre: "  ", factorConversion: Number.NaN }))).toEqual({ ok: false, mensaje: "El nombre no puede estar vacío." });
      expect(await sinTipos(darDeAltaProducto)(datos({ unidadStockId: "no-existe", factorConversion: Number.NaN, precioVenta: -5 }))).toEqual({ ok: false, mensaje: "La unidad de stock es obligatoria." });
      expect(await sinTipos(darDeAltaProducto)(datos({ unidadStockId: 7 }))).toEqual({ ok: false, mensaje: "La unidad de stock es obligatoria." });
      expect(await sinTipos(actualizarProducto)("no-existe", datos({ factorConversion: Number.NaN }))).toEqual({ ok: false, mensaje: "No se encontró el producto." });
      const id = (await sembrarProductoDisponible({ codigo: "MP_Q", nombre: "Queso", tipo: "MP", unidadStockId: kgId, factorConversion: 1 }, sucursalId)).id;
      expect((await sinTipos(actualizarProducto)(id, datos({ tipo: "PV", factorConversion: Number.NaN }))).mensaje).toMatch(/El tipo no se puede cambiar/);
      // El factor inválido gana sobre el precio inválido (el orden de siempre: factor, precio, consignación, paso).
      expect(await sinTipos(darDeAltaProducto)(datos({ factorConversion: Number.NaN, precioVenta: -1 }))).toEqual({ ok: false, mensaje: "El factor de conversión no es un número válido." });
    });

    it("control: un alta y una edición válidas siguen funcionando (factor 2,5; precio 100; paso 0,25 en un PV)", async () => {
      const alta = await sinTipos(darDeAltaProducto)(datos({ factorConversion: 2.5, precioVenta: 100 }));
      expect(alta.ok, alta.mensaje).toBe(true);
      const pizza = await sinTipos(darDeAltaProducto)(datos({ nombre: "Pizza", tipo: "PV", precioVenta: 100, pasoVenta: 0.25 }));
      expect(pizza.ok, pizza.mensaje).toBe(true);
      const id = (await prisma.producto.findFirstOrThrow({ where: { nombre: "Queso" } })).id;
      const edicion = await sinTipos(actualizarProducto)(id, datos({ factorConversion: 3, precioVenta: 120 }));
      expect(edicion.ok, edicion.mensaje).toBe(true);
      expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id } })).factorConversion)).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("agregarPresentacionAlternativa: el factor", () => {
    let harinaId: string;
    const agregar = (producto: unknown, unidad: unknown, factor: unknown) => sinTipos(agregarPresentacionAlternativa)(producto, unidad, factor);

    beforeEach(async () => {
      harinaId = (await sembrarProductoDisponible({ codigo: "MP_H", nombre: "Harina", tipo: "MP", unidadStockId: kgId, unidadCompraId: kgId }, sucursalId)).id;
    });

    it("un factor fuera de rango (NaN, ±Infinity, negativo, cero, 1e308, texto, un objeto, vacío) se rechaza y no crea la presentación", async () => {
      expect(await agregar(harinaId, gId, Number.NaN)).toEqual({ ok: false, mensaje: "El factor de conversión no es un número válido." });
      expect(await agregar(harinaId, gId, Number.NEGATIVE_INFINITY)).toEqual({ ok: false, mensaje: "El factor de conversión no es un número válido." });
      expect(await agregar(harinaId, gId, -1)).toEqual({ ok: false, mensaje: "El factor de conversión tiene que ser mayor que cero." });
      expect(await agregar(harinaId, gId, 0)).toEqual({ ok: false, mensaje: "El factor de conversión tiene que ser mayor que cero." });
      expect(await agregar(harinaId, gId, 1e308)).toEqual({ ok: false, mensaje: "El factor de conversión es demasiado grande." });
      expect(await agregar(harinaId, gId, "abc")).toEqual({ ok: false, mensaje: "El factor de conversión no es un número válido." });
      expect(await agregar(harinaId, gId, {})).toEqual({ ok: false, mensaje: "El factor de conversión no es un número válido." });
      expect(await agregar(harinaId, gId, undefined)).toEqual({ ok: false, mensaje: "Falta el factor de conversión." });
      expect(await prisma.presentacion.count()).toBe(0);
    });

    it("un producto o una unidad que no son texto se rechazan en el acto, sin el error crudo de Prisma", async () => {
      expect(await agregar(7, gId, 20)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
      expect(await agregar(harinaId, 7, 20)).toEqual({ ok: false, mensaje: "La unidad de compra no es válida." });
      expect(await agregar(harinaId, "", 20)).toEqual({ ok: false, mensaje: "La unidad de compra no es válida." });
    });

    it("EL ORDEN: un producto inexistente, y la unidad de compra por defecto, ganan sobre un factor fuera de rango", async () => {
      expect(await agregar("no-existe", gId, Number.NaN)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
      expect(await agregar(harinaId, kgId, Number.NaN)).toEqual({ ok: false, mensaje: "Esa ya es la unidad de compra por defecto de este producto." });
    });

    it("control: un factor válido crea la presentación", async () => {
      expect((await agregar(harinaId, gId, 20)).ok).toBe(true);
      expect(await prisma.presentacion.count()).toBe(1);
    });
  });
});

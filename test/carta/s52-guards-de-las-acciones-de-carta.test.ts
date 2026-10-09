import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";
import { agregarOpcionItemAgrupadoCarta } from "../../src/server/actions/carta/items-agrupados";
import { guardarCuposPromoCarta, guardarPrecioLocalPromoCarta } from "../../src/server/actions/carta/promos";

type Resp = { ok: boolean; mensaje: string };
type Accion = (...args: unknown[]) => Promise<Resp>;
const sinTipos = (f: unknown) => f as Accion;

/**
 * S-52 (GT-11; fila O.193 de `docs/pureza-integracion.md`): las cuatro acciones de la carta que tenían números sin guard de comando (el orden y las etiquetas del contenido de un producto, el orden de una
 * opción de un ítem agrupado, el precio de una promo en la sucursal y los cupos de una promo) calculan su `guardComando…` en la puerta y el caso de uso aplica su rechazo DESPUÉS de leer la entidad: una
 * entidad inexistente sigue ganando sobre un dato inválido (los textos y el orden de siempre). Se llaman SIN tipos: desde la red llega cualquier cosa.
 */
describe("S-52: los guards de la puerta de las acciones de la carta", () => {
  let sucursalId: string;
  let seccionId: string;
  let otraSeccionId: string;
  let pvId: string;
  let pv2Id: string;
  let mpId: string;
  let promoId: string;
  let itemId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Platos" } })).id;
    otraSeccionId = (await prisma.seccionCarta.create({ data: { nombre: "Postres" } })).id;
    pvId = (await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Milanesa", tipo: "PV", precioVenta: 9000, unidadStockId: unidadId }, sucursalId)).id;
    pv2Id = (await sembrarProductoDisponible({ codigo: "PV_2", nombre: "Flan", tipo: "PV", precioVenta: 9000, unidadStockId: unidadId }, sucursalId)).id;
    mpId = (await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadId } })).id;
    promoId = (await prisma.promoCarta.create({ data: { seccionCartaId: seccionId, titulo: "Menú", precio: 10000, sucursales: { create: { sucursalId } } } })).id;
    itemId = (await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Platos", seccionCartaId: seccionId } })).id;
    vi.mocked((await import("../../src/server/actions/carta/revalidar")).revalidarCartasPublicas).mockClear();
  });

  const NO_ES_ENTERO = "El orden tiene que ser un número entero.";
  const ORDENES_ROTOS: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e308, 100_001, 1.5, "abc", "12,5", {}, []];

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("guardarContenidoCartaProducto: descripción, tags y orden", () => {
    const guardar = (productoId: string, datos: unknown) => sinTipos(guardarContenidoCartaProducto)(productoId, datos);
    const filas = () => prisma.contenidoCartaProducto.count();

    it("un orden fuera de rango (NaN, ±Infinity, 1e308, mayor que el tope, no entero, texto, un objeto) se rechaza y no escribe", async () => {
      for (const orden of ORDENES_ROTOS) expect(await guardar(pvId, { visibleEnCarta: false, orden }), String(orden)).toEqual({ ok: false, mensaje: NO_ES_ENTERO });
      expect(await filas()).toBe(0);
    });

    it("la descripción larga, los tags inválidos y los datos que no son un objeto se rechazan; una sección o un género que no son texto, también", async () => {
      expect((await guardar(pvId, { visibleEnCarta: false, descripcion: "x".repeat(501) })).mensaje).toBe("La descripción no puede superar los 500 caracteres.");
      expect((await guardar(pvId, { visibleEnCarta: false, tags: ["<script>"] })).mensaje).toContain("caracteres no permitidos");
      for (const datos of [null, undefined, 7, "x", []]) expect(await guardar(pvId, datos), String(datos)).toEqual({ ok: false, mensaje: "Los datos del contenido de la carta no son válidos." });
      expect(await guardar(pvId, { visibleEnCarta: false, seccionCartaId: 5 })).toEqual({ ok: false, mensaje: "La sección de carta no es válida." });
      expect(await guardar(pvId, { visibleEnCarta: false, generoCartaId: 5 })).toEqual({ ok: false, mensaje: "El género no es válido." });
      expect(await filas()).toBe(0);
    });

    it("EL ORDEN: un producto inexistente, o uno que no es PV, gana sobre un dato fuera de rango (el guard se aplica después de leer el producto)", async () => {
      expect(await guardar("no-existe", { visibleEnCarta: false, orden: Number.NaN })).toEqual({ ok: false, mensaje: "No se encontró el producto." });
      expect(await guardar("no-existe", null)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
      expect(await guardar(mpId, { visibleEnCarta: false, orden: Number.NaN })).toEqual({ ok: false, mensaje: "Solo un producto de venta (PV) puede ir en la carta." });
    });

    it("control: un contenido válido (orden «3», tags, sección) se guarda", async () => {
      const r = await guardar(pvId, { visibleEnCarta: true, seccionCartaId: seccionId, descripcion: "  Rica  ", tags: "a, b", orden: "3" });
      expect(r.ok, r.mensaje).toBe(true);
      expect(await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { productoId: pvId } })).toMatchObject({ descripcion: "Rica", orden: 3, tags: ["a", "b"] });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("agregarOpcionItemAgrupadoCarta: el orden de la opción", () => {
    const agregar = (item: string, producto: string, orden?: unknown) => sinTipos(agregarOpcionItemAgrupadoCarta)(item, producto, orden);
    const opciones = () => prisma.opcionItemAgrupadoCarta.count();

    it("un orden fuera de rango se rechaza y no agrega la opción", async () => {
      for (const orden of ORDENES_ROTOS) expect(await agregar(itemId, pvId, orden), String(orden)).toEqual({ ok: false, mensaje: NO_ES_ENTERO });
      expect(await opciones()).toBe(0);
    });

    it("EL ORDEN: un ítem inexistente, «elegí el producto», un producto inexistente y uno ya agrupado ganan sobre un orden roto", async () => {
      expect(await agregar("no-existe", pvId, Number.NaN)).toEqual({ ok: false, mensaje: "No se encontró el ítem agrupado." });
      expect(await agregar(itemId, "", Number.NaN)).toEqual({ ok: false, mensaje: "Elegí el producto a agregar." });
      expect(await agregar(itemId, "no-existe", Number.NaN)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
      expect((await agregar(itemId, pvId)).ok).toBe(true);
      expect((await agregar(itemId, pvId, Number.NaN)).mensaje).toContain("ya está en");
    });

    it("control: sin orden (al final), con «2» y con vacío (vale 0) se agrega", async () => {
      expect((await agregar(itemId, pvId, null)).ok).toBe(true);
      expect((await agregar(itemId, pv2Id, "2")).ok).toBe(true);
      expect((await prisma.opcionItemAgrupadoCarta.findMany({ orderBy: { orden: "asc" } })).map((o) => o.orden)).toEqual([0, 2]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("guardarPrecioLocalPromoCarta: el precio", () => {
    const fijar = (promo: string, precio: unknown) => sinTipos(guardarPrecioLocalPromoCarta)(promo, precio);
    const auditorias = () => prismaAdmin.registroAuditoria.count({ where: { entidad: "PromoCartaSucursal" } });

    it("NaN, ±Infinity, negativo, 1e308, texto, un objeto y un arreglo se rechazan; no escriben ni auditan", async () => {
      for (const precio of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1e308, "abc", "1e999", {}, [1]]) {
        const r = await fijar(promoId, precio);
        expect(r.ok, String(precio)).toBe(false);
        expect(r.mensaje, String(precio)).not.toBe("No se encontró la promo.");
      }
      expect(await prisma.promoCartaSucursal.findFirstOrThrow({ where: { promoCartaId: promoId } })).toMatchObject({ precioLocal: null });
      expect(await auditorias()).toBe(0);
    });

    it("EL ORDEN: una promo inexistente gana sobre un precio inválido", async () => {
      expect(await fijar("no-existe", Number.NaN)).toEqual({ ok: false, mensaje: "No se encontró la promo." });
    });

    it("control: un precio válido, y null o vacío (vuelve al precio de la empresa), se guardan", async () => {
      expect((await fijar(promoId, "7500")).ok).toBe(true);
      expect(Number((await prisma.promoCartaSucursal.findFirstOrThrow({ where: { promoCartaId: promoId } })).precioLocal)).toBe(7500);
      expect((await fijar(promoId, "")).ok).toBe(true);
      expect((await prisma.promoCartaSucursal.findFirstOrThrow({ where: { promoCartaId: promoId } })).precioLocal).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("guardarCuposPromoCarta: la lista y las cantidades de los cupos", () => {
    const guardarCupos = (promo: string, cupos: unknown) => sinTipos(guardarCuposPromoCarta)(promo, cupos);
    const cupo = (extra: object = {}) => ({ seccionCartaId: seccionId, cantidadMinima: 0, cantidadMaxima: 2, ...extra });
    const cuposGuardados = () => prisma.promoCartaCupo.count({ where: { promoCartaId: promoId } });

    it("una lista que no es un arreglo, o con más de 50 cupos, se rechaza; un cupo nulo o con la sección que no es texto, también", async () => {
      for (const cupos of [null, undefined, {}, "x", 7]) expect(await guardarCupos(promoId, cupos), String(cupos)).toEqual({ ok: false, mensaje: "Los cupos de la promo no son válidos." });
      const muchos = Array.from({ length: 51 }, (_, i) => cupo({ seccionCartaId: `s${i}` }));
      expect(await guardarCupos(promoId, muchos)).toEqual({ ok: false, mensaje: "Los cupos no pueden ser más de 50 por vez." });
      for (const c of [null, undefined, 7, {}, cupo({ seccionCartaId: 5 }), cupo({ seccionCartaId: "" })]) {
        expect(await guardarCupos(promoId, [c]), JSON.stringify(c)).toEqual({ ok: false, mensaje: "Elegí la sección de cada cupo." });
      }
      expect(await cuposGuardados()).toBe(0);
    });

    it("las cantidades fuera de rango (NaN, ±Infinity, negativas, 1e308, mayores que 999, no enteras, texto) y un mínimo mayor que el máximo se rechazan; no escriben ni auditan", async () => {
      const MENSAJE_RANGO = (que: string) => `${que} tiene que ser un número entero entre 0 y 999.`;
      for (const maxima of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1e308, 1000, 1.5, "abc"]) {
        expect(await guardarCupos(promoId, [cupo({ cantidadMaxima: maxima })]), `máxima ${maxima}`).toEqual({ ok: false, mensaje: MENSAJE_RANGO("La cantidad máxima") });
      }
      for (const minima of [Number.NaN, Number.NEGATIVE_INFINITY, -1, 1e308, 1000, 0.5, "abc"]) {
        expect(await guardarCupos(promoId, [cupo({ cantidadMinima: minima })]), `mínima ${minima}`).toEqual({ ok: false, mensaje: MENSAJE_RANGO("La cantidad mínima") });
      }
      expect(await guardarCupos(promoId, [cupo({ cantidadMaxima: 0 })])).toEqual({ ok: false, mensaje: "La cantidad máxima de un cupo tiene que ser al menos 1." });
      expect(await guardarCupos(promoId, [cupo({ cantidadMinima: 3, cantidadMaxima: 2 })])).toEqual({ ok: false, mensaje: "En cada cupo, el mínimo no puede ser mayor que el máximo." });
      expect(await guardarCupos(promoId, [cupo(), cupo()])).toEqual({ ok: false, mensaje: "No se puede repetir la misma sección de carta en dos cupos de la misma promo." });
      expect(await cuposGuardados()).toBe(0);
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "PromoCartaCupo" } })).toBe(0);
    });

    it("EL ORDEN: una promo inexistente gana sobre una lista o un cupo inválidos", async () => {
      expect(await guardarCupos("no-existe", null)).toEqual({ ok: false, mensaje: "No se encontró la promo." });
      expect(await guardarCupos("no-existe", [cupo({ cantidadMaxima: Number.NaN })])).toEqual({ ok: false, mensaje: "No se encontró la promo." });
    });

    it("control: una lista válida (dos secciones) se guarda, y una lista vacía vuelve la promo a informativa", async () => {
      const r = await guardarCupos(promoId, [cupo(), cupo({ seccionCartaId: otraSeccionId, cantidadMinima: "1", cantidadMaxima: "1" })]);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await cuposGuardados()).toBe(2);
      expect((await guardarCupos(promoId, [])).ok).toBe(true);
      expect(await cuposGuardados()).toBe(0);
    });
  });
});

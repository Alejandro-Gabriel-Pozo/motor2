import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { actualizarVisibleEnCarta, guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";
import { normalizarTagsCarta, validarOrdenCarta } from "../../src/core/carta/validaciones";

/**
 * Los textos EXACTOS de las dos acciones del contenido de carta de un producto, el ORDEN de sus chequeos y CUÁNDO invalidan la carta pública (Hito 5, bloque D,
 * `docs/plan-hito-5-pureza.md` §6.1), ANTES de mudarlas a casos de uso. Las dos LEEN el producto antes de validar nada (un producto inexistente gana sobre una
 * descripción larga): por eso no tienen guard de formato. Verde contra el código de antes de la mudanza y después.
 */
describe("contenido de carta de un producto: mensajes, orden de los chequeos y revalidación", () => {
  let centralId: string;
  let norteId: string;
  let pizzaId: string;
  let harinaId: string;
  let seccionId: string;

  beforeEach(async () => {
    vi.mocked(revalidarCartasPublicas).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const unidad = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    pizzaId = (await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: unidad.id, precioVenta: 1000 }, centralId)).id;
    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidad.id }, centralId)).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Platos" } })).id;
  });

  const revalidaciones = () => {
    const n = vi.mocked(revalidarCartasPublicas).mock.calls.length;
    vi.mocked(revalidarCartasPublicas).mockClear();
    return n;
  };
  const filas = () => prisma.contenidoCartaProducto.findMany({ orderBy: { id: "asc" } });

  it("guardar: el producto se lee ANTES de validar (inexistente o MP ganan sobre una descripción larga), sin revalidar ni escribir", async () => {
    const larga = "d".repeat(501);
    expect(await guardarContenidoCartaProducto("cnoexiste000000000000000", { visibleEnCarta: true, descripcion: larga })).toEqual({ ok: false, mensaje: "No se encontró el producto." });
    expect(await guardarContenidoCartaProducto(harinaId, { visibleEnCarta: true, descripcion: larga })).toEqual({ ok: false, mensaje: "Solo un producto de venta (PV) puede ir en la carta." });
    expect(revalidaciones()).toBe(0);
    expect(await filas()).toEqual([]);
  });

  it("guardar: validaciones en su orden (descripción, tags, orden, falta de sección), cada una con su texto", async () => {
    const tagMalo = ["bien", "mal<>"];
    const mensajeTags = (normalizarTagsCarta(tagMalo) as { mensaje: string }).mensaje;
    const mensajeOrden = (validarOrdenCarta("1,5") as { mensaje: string }).mensaje;
    expect(await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: true, descripcion: "d".repeat(501), tags: tagMalo, orden: "1,5" })).toEqual({
      ok: false,
      mensaje: "La descripción no puede superar los 500 caracteres.",
    });
    expect(await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: true, tags: tagMalo, orden: "1,5" })).toEqual({ ok: false, mensaje: mensajeTags });
    expect(mensajeTags).toMatch(/tag/);
    expect(await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: true, orden: "1,5" })).toEqual({ ok: false, mensaje: mensajeOrden });
    expect(await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: true })).toEqual({
      ok: false,
      mensaje: "Elegí la sección de carta donde se muestra (sin sección no puede salir en la carta).",
    });
    expect(await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: true, seccionCartaId: "   " })).toEqual({
      ok: false,
      mensaje: "Elegí la sección de carta donde se muestra (sin sección no puede salir en la carta).",
    });
    expect(revalidaciones()).toBe(0);
    expect(await filas()).toEqual([]);
  });

  it("guardar: la sección inexistente gana sobre el género; después el género inexistente (también el de OTRA sucursal) y el apagado", async () => {
    const ajeno = await prisma.generoCarta.create({ data: { sucursalId: norteId, nombre: "Vinos" } });
    const apagado = await prisma.generoCarta.create({ data: { sucursalId: centralId, nombre: "Viejo", activo: false } });
    expect(await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: true, seccionCartaId: "cnoexiste000000000000000", generoCartaId: "cnoexiste000000000000000" })).toEqual({
      ok: false,
      mensaje: "No se encontró la sección de carta.",
    });
    expect(await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: true, seccionCartaId: seccionId, generoCartaId: "cnoexiste000000000000000" })).toEqual({ ok: false, mensaje: "No se encontró el género." });
    expect(await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: true, seccionCartaId: seccionId, generoCartaId: ajeno.id })).toEqual({ ok: false, mensaje: "No se encontró el género." });
    expect(await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: true, seccionCartaId: seccionId, generoCartaId: apagado.id })).toEqual({
      ok: false,
      mensaje: "Ese género está apagado: elegí uno activo, o ninguno.",
    });
    expect(revalidaciones()).toBe(0);
    expect(await filas()).toEqual([]);
  });

  it("guardar: mostrar y ocultar con sus textos, UNA revalidación por éxito y una sola fila por (sucursal, producto); oculto se guarda sin sección", async () => {
    const genero = await prisma.generoCarta.create({ data: { sucursalId: centralId, nombre: "Pizzas" } });
    expect(
      await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: true, seccionCartaId: ` ${seccionId} `, descripcion: " Con muzza ", tags: "Vegano, SIN TACC", especial: true, orden: "4", generoCartaId: ` ${genero.id} ` }),
    ).toEqual({ ok: true, mensaje: 'Carta: "Pizza" se muestra.' });
    expect(revalidaciones()).toBe(1);
    expect(await filas()).toMatchObject([
      { sucursalId: centralId, productoId: pizzaId, visibleEnCarta: true, seccionCartaId: seccionId, descripcion: "Con muzza", tags: ["Vegano", "SIN TACC"], especial: true, orden: 4, generoCartaId: genero.id },
    ]);
    expect(await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: false })).toEqual({ ok: true, mensaje: 'Carta: "Pizza" queda oculto.' });
    expect(revalidaciones()).toBe(1);
    expect(await filas()).toMatchObject([{ productoId: pizzaId, visibleEnCarta: false, seccionCartaId: null, descripcion: null, tags: [], especial: false, generoCartaId: null }]);
  });

  it("atajo mostrar/ocultar: producto inexistente o MP; mostrar sin sección; mostrar con sección; ocultar crea la fila; UNA revalidación por éxito", async () => {
    expect(await actualizarVisibleEnCarta("cnoexiste000000000000000", true)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
    expect(await actualizarVisibleEnCarta(harinaId, true)).toEqual({ ok: false, mensaje: "Solo un producto de venta (PV) puede ir en la carta." });
    expect(await actualizarVisibleEnCarta(pizzaId, true)).toEqual({
      ok: false,
      mensaje: "Elegí la sección de carta donde se muestra (sin sección no puede salir en la carta).",
    });
    expect(revalidaciones()).toBe(0);
    expect(await filas()).toEqual([]);

    // La sección de OTRA sucursal no cuenta: la fila de Norte (que ya existía cuando Central todavía no tiene la suya) no habilita mostrar acá.
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: norteId, productoId: pizzaId, visibleEnCarta: false, seccionCartaId: seccionId } });
    expect(await actualizarVisibleEnCarta(pizzaId, true)).toEqual({
      ok: false,
      mensaje: "Elegí la sección de carta donde se muestra (sin sección no puede salir en la carta).",
    });
    expect(revalidaciones()).toBe(0);

    expect(await actualizarVisibleEnCarta(pizzaId, false)).toEqual({ ok: true, mensaje: 'Carta: "Pizza" queda oculto.' });
    expect(revalidaciones()).toBe(1);
    expect(await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: { sucursalId_productoId: { sucursalId: centralId, productoId: pizzaId } } })).toMatchObject({ visibleEnCarta: false, seccionCartaId: null });

    expect(await actualizarVisibleEnCarta(pizzaId, true)).toEqual({
      ok: false,
      mensaje: "Elegí la sección de carta donde se muestra (sin sección no puede salir en la carta).",
    });
    await prisma.contenidoCartaProducto.update({ where: { sucursalId_productoId: { sucursalId: centralId, productoId: pizzaId } }, data: { seccionCartaId: seccionId } });
    expect(await actualizarVisibleEnCarta(pizzaId, true)).toEqual({ ok: true, mensaje: 'Carta: "Pizza" se muestra.' });
    expect(revalidaciones()).toBe(1);
    expect((await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: { sucursalId_productoId: { sucursalId: centralId, productoId: pizzaId } } })).visibleEnCarta).toBe(true);
    expect(await prisma.contenidoCartaProducto.count()).toBe(2);
  });
});

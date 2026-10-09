import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { accionesDelMenuQueElUsuarioPuedeVer, requierePermiso, requierePermisoVer } from "../../src/server/acceso/gate";
import { actualizarVisibleEnCarta, guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";
import { actualizarActivoGeneroCarta, guardarGeneroCarta } from "../../src/server/actions/carta/generos";
import {
  actualizarActivoItemAgrupadoCarta,
  actualizarOrdenOpcionItemAgrupadoCarta,
  agregarOpcionItemAgrupadoCarta,
  guardarItemAgrupadoCarta,
  quitarOpcionItemAgrupadoCarta,
} from "../../src/server/actions/carta/items-agrupados";
import { actualizarActivaPromoCarta, guardarCuposPromoCarta, guardarPromoCarta } from "../../src/server/actions/carta/promos";

/**
 * S-10 del plan de endurecimiento de seguridad, decisión D1 del dueño (fila O.59 de `docs/pureza-integracion.md`; CAMBIA COMPORTAMIENTO): `carta_generos`, `carta_contenido_producto` y
 * `carta_items_agrupados` estaban declaradas de contexto EMPRESA (el gate aprueba si CUALQUIER membresía de la empresa tiene la clave) y sin embargo solo escriben en la carta de la
 * sucursal ACTIVA (ADR-009, C3: la carta es propia de cada sucursal). «Si lo declaré de empresa, me equivoqué»: se evalúan contra la membresía de la sucursal donde se escribe.
 *
 * Escenario: una empresa con Central (S1) y Norte (S2). `mixto` es administrador de Central y OPERADOR de Norte (el rol de fábrica sin ninguna clave de carta); la sucursal ACTIVA es
 * Norte. Con el defecto, `mixto` editaba la carta de Norte con el permiso que tiene en Central. `dueno` es administrador de las dos (el control que sí escribe). Con acceso denegado no se
 * escribe nada: ni filas nuevas ni cambios en las existentes de Norte, y la respuesta es la misma denegación que da el gate de la sucursal.
 */
describe("S-10 / D1: las claves de carta que escriben en una sucursal se evalúan en ESA sucursal", () => {
  let centralId: string;
  let norteId: string;
  let seccionId: string;
  let pizzaId: string;
  let flanId: string;
  let sinContenidoId: string;
  let generoNorteId: string;
  let itemNorteId: string;
  let opcionPizzaId: string;
  let opcionFlanId: string;
  let mixtoId: string;
  let duenoId: string;
  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });

  /** Todo lo que `mixto` podría tocar de Norte, para comparar antes y después del ataque. */
  const fotoDeNorte = async () => ({
    generos: await prisma.generoCarta.findMany({ where: { sucursalId: norteId }, orderBy: { nombre: "asc" } }),
    contenidos: await prisma.contenidoCartaProducto.findMany({ where: { sucursalId: norteId }, orderBy: { productoId: "asc" } }),
    items: await prisma.itemAgrupadoCarta.findMany({ where: { sucursalId: norteId }, orderBy: { nombre: "asc" } }),
    opciones: await prisma.opcionItemAgrupadoCarta.findMany({ where: { sucursalId: norteId }, orderBy: { productoId: "asc" } }),
  });
  /** La denegación EXACTA que da el gate de la sucursal activa para esa clave (la acción devuelve el mismo texto). */
  const denegacionDe = async (usuarioId: string, clave: "carta_generos" | "carta_contenido_producto" | "carta_items_agrupados") => {
    const g = await requierePermiso(usuarioId, norteId, clave, prisma);
    if (g.ok) throw new Error(`se esperaba una denegación de ${clave} en Norte`);
    return g.mensaje;
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const { kg } = await sembrarCatalogoBase();

    duenoId = (await crearUsuarioConMembresia({ email: "dueno@test.com", sucursalId: centralId, rolId: base.admin.id })).id;
    await crearMembresia({ usuarioId: duenoId, sucursalId: norteId, rolId: base.admin.id });
    mixtoId = (await crearUsuarioConMembresia({ email: "mixto@test.com", sucursalId: centralId, rolId: base.admin.id })).id;
    await crearMembresia({ usuarioId: mixtoId, sucursalId: norteId, rolId: base.operador.id });

    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
    const pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, centralId);
    const flan = await sembrarProductoDisponible({ codigo: "PV_FLAN", nombre: "Flan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, centralId);
    const sinContenido = await sembrarProductoDisponible({ codigo: "PV_SIN", nombre: "Sin contenido", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, centralId);
    pizzaId = pizza.id;
    flanId = flan.id;
    sinContenidoId = sinContenido.id;
    for (const id of [pizzaId, flanId, sinContenidoId]) await prisma.disponibilidadProducto.create({ data: { sucursalId: norteId, productoId: id, disponible: true } });

    // La carta PROPIA de Norte: un género, el contenido de la pizza, un ítem agrupado con dos opciones.
    generoNorteId = (await prisma.generoCarta.create({ data: { sucursalId: norteId, nombre: "Pizzas", orden: 1 } })).id;
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: norteId, productoId: pizzaId, visibleEnCarta: true, seccionCartaId: seccionId, descripcion: "Muzza" } });
    itemNorteId = (await prisma.itemAgrupadoCarta.create({ data: { sucursalId: norteId, nombre: "Clásicos", seccionCartaId: seccionId, orden: 1 } })).id;
    opcionPizzaId = (await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: norteId, itemAgrupadoCartaId: itemNorteId, productoId: pizzaId, orden: 0 } })).id;
    opcionFlanId = (await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: norteId, itemAgrupadoCartaId: itemNorteId, productoId: flanId, orden: 1 } })).id;
  });

  describe("quien tiene la clave en Central pero NO en Norte (la sucursal activa)", () => {
    beforeEach(async () => {
      await como(mixtoId, "mixto@test.com");
      __setCookieDeTestParaSucursal(norteId);
    });

    it("los géneros: no crea ni edita ni apaga un género de Norte", async () => {
      const antes = await fotoDeNorte();
      const esperado = await denegacionDe(mixtoId, "carta_generos");
      expect(await guardarGeneroCarta({ nombre: "Cervezas" })).toMatchObject({ ok: false, mensaje: esperado });
      expect(await guardarGeneroCarta({ id: generoNorteId, nombre: "Renombrado" })).toMatchObject({ ok: false, mensaje: esperado });
      expect(await actualizarActivoGeneroCarta(generoNorteId, false)).toMatchObject({ ok: false, mensaje: esperado });
      expect(await fotoDeNorte()).toEqual(antes);
    });

    it("el contenido de los productos: no guarda ni muestra ni oculta nada en la carta de Norte", async () => {
      const antes = await fotoDeNorte();
      const esperado = await denegacionDe(mixtoId, "carta_contenido_producto");
      // Edita el contenido que ya existe y crea el de un producto que no tenía.
      expect(await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: false, seccionCartaId: seccionId, descripcion: "Cambiada" })).toMatchObject({ ok: false, mensaje: esperado });
      expect(await guardarContenidoCartaProducto(sinContenidoId, { visibleEnCarta: true, seccionCartaId: seccionId })).toMatchObject({ ok: false, mensaje: esperado });
      // El atajo de mostrar/ocultar también crea la fila si no existía.
      expect(await actualizarVisibleEnCarta(pizzaId, false)).toMatchObject({ ok: false, mensaje: esperado });
      expect(await actualizarVisibleEnCarta(sinContenidoId, false)).toMatchObject({ ok: false, mensaje: esperado });
      expect(await fotoDeNorte()).toEqual(antes);
    });

    it("los ítems agrupados: no crea, no edita, no apaga ni toca las opciones de un ítem de Norte", async () => {
      const antes = await fotoDeNorte();
      const esperado = await denegacionDe(mixtoId, "carta_items_agrupados");
      expect(await guardarItemAgrupadoCarta({ nombre: "Postres", seccionCartaId: seccionId, productoIds: [sinContenidoId] })).toMatchObject({ ok: false, mensaje: esperado });
      expect(await guardarItemAgrupadoCarta({ id: itemNorteId, nombre: "Renombrado", seccionCartaId: seccionId })).toMatchObject({ ok: false, mensaje: esperado });
      expect(await actualizarActivoItemAgrupadoCarta(itemNorteId, false)).toMatchObject({ ok: false, mensaje: esperado });
      expect(await agregarOpcionItemAgrupadoCarta(itemNorteId, sinContenidoId)).toMatchObject({ ok: false, mensaje: esperado });
      expect(await actualizarOrdenOpcionItemAgrupadoCarta(opcionPizzaId, 9)).toMatchObject({ ok: false, mensaje: esperado });
      expect(await quitarOpcionItemAgrupadoCarta(opcionFlanId)).toMatchObject({ ok: false, mensaje: esperado });
      expect(await fotoDeNorte()).toEqual(antes);
    });

    it("la pantalla tampoco lo ofrece: Norte no le da el «Ver» de las tres claves, ni el menú el ítem de agrupados", async () => {
      for (const clave of ["carta_generos", "carta_contenido_producto", "carta_items_agrupados"] as const) {
        expect((await requierePermisoVer(mixtoId, norteId, clave, prisma)).ok, clave).toBe(false);
      }
      const visibles = await accionesDelMenuQueElUsuarioPuedeVer(mixtoId, (await prisma.sucursal.findUniqueOrThrow({ where: { id: norteId } })).empresaId, norteId, ["carta_items_agrupados"], prisma);
      expect(visibles.has("carta_items_agrupados")).toBe(false);
    });
  });

  describe("controles: quien SÍ tiene la clave en la sucursal donde escribe", () => {
    it("dueno (administrador de Norte) escribe la carta de Norte", async () => {
      await como(duenoId, "dueno@test.com");
      __setCookieDeTestParaSucursal(norteId);
      expect((await guardarGeneroCarta({ nombre: "Cervezas" })).ok).toBe(true);
      expect((await actualizarActivoGeneroCarta(generoNorteId, false)).ok).toBe(true);
      expect((await guardarContenidoCartaProducto(sinContenidoId, { visibleEnCarta: true, seccionCartaId: seccionId })).ok).toBe(true);
      expect((await actualizarVisibleEnCarta(sinContenidoId, false)).ok).toBe(true);
      expect((await guardarItemAgrupadoCarta({ id: itemNorteId, nombre: "Clásicos II", seccionCartaId: seccionId })).ok).toBe(true);
      expect((await actualizarActivoItemAgrupadoCarta(itemNorteId, false)).ok).toBe(true);
      expect((await actualizarOrdenOpcionItemAgrupadoCarta(opcionPizzaId, 5)).ok).toBe(true);
      expect((await quitarOpcionItemAgrupadoCarta(opcionFlanId)).ok).toBe(true);
      expect(await prisma.generoCarta.count({ where: { sucursalId: norteId, nombre: "Cervezas" } })).toBe(1);
    });

    it("mixto escribe la carta de CENTRAL (donde es administrador) y no la de Norte", async () => {
      await como(mixtoId, "mixto@test.com");
      __setCookieDeTestParaSucursal(centralId);
      const antes = await fotoDeNorte();
      expect((await guardarGeneroCarta({ nombre: "Cervezas" })).ok).toBe(true);
      expect(await prisma.generoCarta.count({ where: { sucursalId: centralId, nombre: "Cervezas" } })).toBe(1);
      expect(await fotoDeNorte()).toEqual(antes);
    });
  });

  describe("las claves que son de la EMPRESA entera no cambian de contexto", () => {
    it("`carta_promo_definir` sigue valiendo con la clave de CUALQUIER membresía (la promo es de la empresa)", async () => {
      await como(mixtoId, "mixto@test.com");
      __setCookieDeTestParaSucursal(norteId);
      const r = await guardarPromoCarta({ seccionCartaId: seccionId, titulo: "Combo", precio: 10, orden: 1 });
      expect(r.ok, r.mensaje).toBe(true);
      const promo = await prisma.promoCarta.findFirstOrThrow({ where: { titulo: "Combo" } });
      expect((await actualizarActivaPromoCarta(promo.id, false)).ok).toBe(true);
      expect((await guardarCuposPromoCarta(promo.id, [])).ok).toBe(true);
    });
  });
});

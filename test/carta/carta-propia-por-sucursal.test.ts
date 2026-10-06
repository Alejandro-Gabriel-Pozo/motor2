import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { activarTodosLosModulos } from "../setup/modulos";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { dbDeEmpresa } from "../../src/core/auth/base";
import { copiarCartaDeSucursal } from "../../src/server/actions/carta/copiar-carta";
import { actualizarVisibleEnCarta, guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";
import { actualizarActivoGeneroCarta, guardarGeneroCarta } from "../../src/server/actions/carta/generos";
import {
  actualizarActivoItemAgrupadoCarta,
  actualizarOrdenOpcionItemAgrupadoCarta,
  agregarOpcionItemAgrupadoCarta,
  guardarItemAgrupadoCarta,
  quitarOpcionItemAgrupadoCarta,
} from "../../src/server/actions/carta/items-agrupados";
import { cargarAdminCarta } from "../../src/server/consultas/carta/admin";
import { resolverMenuCarta } from "../../src/server/lecturas/carta/menu";

/**
 * Carta PROPIA de cada sucursal (ADR-009, C3/C4; decisión del dueño 2026-10-02), contra Postgres real y a través de las Server Actions: escribir
 * y mover solo en la sucursal activa (con validación de pertenencia), copiar de otra sucursal SOLO sobre una carta vacía y con confirmación, la
 * clave propia `carta_copiar_de_sucursal` y el aislamiento entre empresas.
 */
describe("carta propia por sucursal — acciones", () => {
  let sucursalA: string;
  let sucursalB: string;
  let adminAId: string;
  let adminBId: string;
  let operadorAId: string;
  let seccionId: string;
  let unidadId: string;
  let ids: { pizza: string; birra: string; coca: string; sprite: string };

  const como = async (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalA = base.sucursal.id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    const adminA = await crearUsuarioConMembresia({ email: "admin-a@test.com", sucursalId: sucursalA, rolId: base.admin.id });
    const adminB = await crearUsuarioConMembresia({ email: "admin-b@test.com", sucursalId: sucursalB, rolId: base.admin.id });
    const operadorA = await crearUsuarioConMembresia({ email: "operador-a@test.com", sucursalId: sucursalA, rolId: base.operador.id });
    adminAId = adminA.id;
    adminBId = adminB.id;
    operadorAId = operadorA.id;

    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
    const pv = async (codigo: string, nombre: string, precioVenta: number) => {
      const p = await sembrarProductoDisponible({ codigo, nombre, tipo: "PV", precioVenta, unidadStockId: unidadId }, sucursalA);
      await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalB, productoId: p.id, disponible: true } });
      return p.id;
    };
    ids = { pizza: await pv("PV_PIZZA", "Pizza", 10000), birra: await pv("PV_BIRRA", "Birra", 5000), coca: await pv("PV_COCA", "Coca", 3000), sprite: await pv("PV_SPRITE", "Sprite", 3000) };
  });

  /** La carta armada de la sucursal A: un género, dos contenidos (uno con género) y un ítem agrupado con dos opciones. */
  async function armarCartaDeA() {
    const genero = await prisma.generoCarta.create({ data: { sucursalId: sucursalA, nombre: "Cervezas", orden: 2 } });
    await prisma.contenidoCartaProducto.createMany({
      data: [
        { sucursalId: sucursalA, productoId: ids.pizza, visibleEnCarta: true, seccionCartaId: seccionId, orden: 1, descripcion: "Muzza", tags: ["Veggie"], especial: true },
        { sucursalId: sucursalA, productoId: ids.birra, visibleEnCarta: false, seccionCartaId: seccionId, orden: 5, generoCartaId: genero.id },
      ],
    });
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalA, nombre: "Gaseosas", seccionCartaId: seccionId, orden: 3, generoCartaId: genero.id, tags: ["Frío"] } });
    await prisma.opcionItemAgrupadoCarta.createMany({
      data: [ids.coca, ids.sprite].map((productoId, orden) => ({ sucursalId: sucursalA, itemAgrupadoCartaId: item.id, productoId, orden })),
    });
    return { generoId: genero.id, itemId: item.id };
  }

  const contarCarta = async (sucursalId: string) => ({
    contenidos: await prisma.contenidoCartaProducto.count({ where: { sucursalId } }),
    generos: await prisma.generoCarta.count({ where: { sucursalId } }),
    items: await prisma.itemAgrupadoCarta.count({ where: { sucursalId } }),
    opciones: await prisma.opcionItemAgrupadoCarta.count({ where: { sucursalId } }),
  });

  describe("escrituras: solo en la sucursal activa", () => {
    it("guardar contenido, género e ítem agrupado crea filas de la sucursal activa y no toca las de la otra", async () => {
      const deB = await prisma.generoCarta.create({ data: { sucursalId: sucursalB, nombre: "Género de B" } });
      await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalB, productoId: ids.pizza, visibleEnCarta: true, seccionCartaId: seccionId, descripcion: "de B" } });

      await como(adminAId, "admin-a@test.com");
      expect((await guardarContenidoCartaProducto(ids.pizza, { visibleEnCarta: true, seccionCartaId: seccionId, descripcion: "de A" })).ok).toBe(true);
      expect((await guardarGeneroCarta({ nombre: "Género de A" })).ok).toBe(true);
      expect((await guardarItemAgrupadoCarta({ nombre: "Agrupado de A", seccionCartaId: seccionId })).ok).toBe(true);

      expect(await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { sucursalId: sucursalA, productoId: ids.pizza } })).toMatchObject({ descripcion: "de A" });
      expect(await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { sucursalId: sucursalB, productoId: ids.pizza } })).toMatchObject({ descripcion: "de B" });
      expect((await prisma.generoCarta.findMany({ where: { sucursalId: sucursalA } })).map((g) => g.nombre)).toEqual(["Género de A"]);
      expect((await prisma.generoCarta.findMany({ where: { sucursalId: sucursalB } })).map((g) => g.nombre)).toEqual(["Género de B"]);
      expect((await prisma.itemAgrupadoCarta.findMany({ select: { nombre: true, sucursalId: true } }))).toEqual([{ nombre: "Agrupado de A", sucursalId: sucursalA }]);
      expect(deB.activo).toBe(true);
    });

    it("el mismo nombre de género o de ítem agrupado puede existir en dos sucursales; en la misma, no", async () => {
      await prisma.generoCarta.create({ data: { sucursalId: sucursalB, nombre: "Cervezas" } });
      await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalB, nombre: "Gaseosas", seccionCartaId: seccionId } });
      await como(adminAId, "admin-a@test.com");
      expect((await guardarGeneroCarta({ nombre: "Cervezas" })).ok).toBe(true);
      expect((await guardarItemAgrupadoCarta({ nombre: "Gaseosas", seccionCartaId: seccionId })).ok).toBe(true);
      expect((await guardarGeneroCarta({ nombre: "cervezas" })).ok).toBe(false);
      expect((await guardarItemAgrupadoCarta({ nombre: "gaseosas", seccionCartaId: seccionId })).ok).toBe(false);
    });

    it("no se puede tocar, mover ni ordenar lo que es de la carta de OTRA sucursal (género, ítem agrupado, opción)", async () => {
      const deB = await prisma.generoCarta.create({ data: { sucursalId: sucursalB, nombre: "Género de B" } });
      const itemB = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalB, nombre: "Agrupado de B", seccionCartaId: seccionId } });
      const opcionB = await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: sucursalB, itemAgrupadoCartaId: itemB.id, productoId: ids.coca, orden: 4 } });

      await como(adminAId, "admin-a@test.com");
      const rechazos = await Promise.all([
        actualizarActivoGeneroCarta(deB.id, false),
        guardarGeneroCarta({ id: deB.id, nombre: "Renombrado" }),
        actualizarActivoItemAgrupadoCarta(itemB.id, false),
        guardarItemAgrupadoCarta({ id: itemB.id, nombre: "Renombrado", seccionCartaId: seccionId }),
        agregarOpcionItemAgrupadoCarta(itemB.id, ids.sprite),
        actualizarOrdenOpcionItemAgrupadoCarta(opcionB.id, 9),
        quitarOpcionItemAgrupadoCarta(opcionB.id),
        // Un contenido de A no puede colgarse del género de B.
        guardarContenidoCartaProducto(ids.pizza, { visibleEnCarta: true, seccionCartaId: seccionId, generoCartaId: deB.id }),
      ]);
      for (const r of rechazos) expect(r.ok, r.mensaje).toBe(false);

      expect(await prisma.generoCarta.findUniqueOrThrow({ where: { id: deB.id } })).toMatchObject({ nombre: "Género de B", activo: true });
      expect(await prisma.itemAgrupadoCarta.findUniqueOrThrow({ where: { id: itemB.id } })).toMatchObject({ nombre: "Agrupado de B", activo: true });
      expect(await prisma.opcionItemAgrupadoCarta.findMany({ where: { itemAgrupadoCartaId: itemB.id }, select: { productoId: true, orden: true } })).toEqual([{ productoId: ids.coca, orden: 4 }]);
      expect(await contarCarta(sucursalA)).toEqual({ contenidos: 0, generos: 0, items: 0, opciones: 0 });
    });

    it("mostrar/ocultar en la sucursal A no cambia lo que muestra la B", async () => {
      await prisma.contenidoCartaProducto.createMany({
        data: [sucursalA, sucursalB].map((sucursalId) => ({ sucursalId, productoId: ids.pizza, visibleEnCarta: true, seccionCartaId: seccionId })),
      });
      await como(adminAId, "admin-a@test.com");
      expect((await actualizarVisibleEnCarta(ids.pizza, false)).ok).toBe(true);
      expect((await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { sucursalId: sucursalA } })).visibleEnCarta).toBe(false);
      expect((await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { sucursalId: sucursalB } })).visibleEnCarta).toBe(true);
      const menuB = await resolverMenuCarta(sucursalB, prisma);
      expect(menuB!.secciones.flatMap((s) => s.items.map((i) => i.nombre))).toEqual(["Pizza"]);
    });
  });

  describe("copiar de otra sucursal", () => {
    it("sobre una carta vacía copia contenido, géneros, ítems agrupados con sus opciones y el orden; el origen y las promos quedan igual", async () => {
      const { generoId, itemId } = await armarCartaDeA();
      const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: sucursalA } }, seccionCartaId: seccionId, titulo: "Promo A", precio: 1000 } });
      const antesA = await contarCarta(sucursalA);

      await como(adminBId, "admin-b@test.com");
      const r = await copiarCartaDeSucursal(sucursalA, true);
      expect(r.ok, r.mensaje).toBe(true);
      expect(r.mensaje).toContain("2 productos, 1 ítems agrupados y 1 géneros");

      expect(await contarCarta(sucursalB)).toEqual(antesA);
      expect(await contarCarta(sucursalA)).toEqual(antesA);

      const generoB = await prisma.generoCarta.findFirstOrThrow({ where: { sucursalId: sucursalB } });
      expect(generoB).toMatchObject({ nombre: "Cervezas", orden: 2, activo: true });
      expect(generoB.id).not.toBe(generoId);

      const contenidos = await prisma.contenidoCartaProducto.findMany({ where: { sucursalId: sucursalB }, orderBy: { orden: "asc" } });
      expect(contenidos.map((c) => ({ p: c.productoId, v: c.visibleEnCarta, s: c.seccionCartaId, o: c.orden, d: c.descripcion, t: c.tags, e: c.especial, g: c.generoCartaId }))).toEqual([
        { p: ids.pizza, v: true, s: seccionId, o: 1, d: "Muzza", t: ["Veggie"], e: true, g: null },
        { p: ids.birra, v: false, s: seccionId, o: 5, d: null, t: [], e: false, g: generoB.id },
      ]);

      const itemB = await prisma.itemAgrupadoCarta.findFirstOrThrow({ where: { sucursalId: sucursalB }, include: { opciones: { orderBy: { orden: "asc" } } } });
      expect(itemB.id).not.toBe(itemId);
      expect(itemB).toMatchObject({ nombre: "Gaseosas", seccionCartaId: seccionId, orden: 3, generoCartaId: generoB.id, tags: ["Frío"] });
      expect(itemB.opciones.map((o) => ({ p: o.productoId, o: o.orden, s: o.sucursalId }))).toEqual([
        { p: ids.coca, o: 0, s: sucursalB },
        { p: ids.sprite, o: 1, s: sucursalB },
      ]);

      // Las promos y sus cupos no se copian ni se tocan.
      expect(await prisma.promoCarta.findMany({ select: { id: true } })).toEqual([{ id: promo.id }]);
      expect(await prisma.promoCartaSucursal.findMany({ select: { sucursalId: true } })).toEqual([{ sucursalId: sucursalA }]);

      // Queda auditado en la sucursal destino.
      const auditoria = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "CartaSucursal", entidadId: sucursalB } });
      expect(auditoria.descripcion).toContain("copiada de «Central»");
    });

    it("después de copiar, cada carta evoluciona por su lado", async () => {
      await armarCartaDeA();
      await como(adminBId, "admin-b@test.com");
      expect((await copiarCartaDeSucursal(sucursalA, true)).ok).toBe(true);

      expect((await actualizarVisibleEnCarta(ids.pizza, false)).ok).toBe(true);
      const [a, b] = await Promise.all([cargarAdminCarta(sucursalA, prisma), cargarAdminCarta(sucursalB, prisma)]);
      expect(a.secciones.map((s) => s.cantidadItems)).toEqual([2]);
      expect(b.secciones.map((s) => s.cantidadItems)).toEqual([1]);
    });

    it("nunca copia sin confirmación explícita", async () => {
      await armarCartaDeA();
      await como(adminBId, "admin-b@test.com");
      const r = await copiarCartaDeSucursal(sucursalA, false);
      expect(r.ok).toBe(false);
      expect(await contarCarta(sucursalB)).toEqual({ contenidos: 0, generos: 0, items: 0, opciones: 0 });
    });

    it("rechaza copiar de la misma sucursal, de una que no existe y de una sin carta propia", async () => {
      await como(adminBId, "admin-b@test.com");
      expect((await copiarCartaDeSucursal(sucursalB, true)).mensaje).toMatch(/otra sucursal/);
      expect((await copiarCartaDeSucursal("no-existe", true)).mensaje).toMatch(/No se encontró esa sucursal/);
      const sinCarta = await copiarCartaDeSucursal(sucursalA, true);
      expect(sinCarta.ok).toBe(false);
      expect(sinCarta.mensaje).toMatch(/no tiene carta propia/);
      expect(await contarCarta(sucursalB)).toEqual({ contenidos: 0, generos: 0, items: 0, opciones: 0 });
    });

    it.each([
      ["un contenido", async (s: string, p: string, seccion: string) => void (await prisma.contenidoCartaProducto.create({ data: { sucursalId: s, productoId: p, visibleEnCarta: false, seccionCartaId: seccion } }))],
      ["un género", async (s: string) => void (await prisma.generoCarta.create({ data: { sucursalId: s, nombre: "Propio" } }))],
      ["un ítem agrupado", async (s: string, _p: string, seccion: string) => void (await prisma.itemAgrupadoCarta.create({ data: { sucursalId: s, nombre: "Propio", seccionCartaId: seccion } }))],
    ])("rechaza copiar sobre una carta que ya tiene %s propio, sin pisar ni mezclar", async (_cual, sembrar) => {
      await armarCartaDeA();
      await sembrar(sucursalB, ids.sprite, seccionId);
      const antes = await contarCarta(sucursalB);

      await como(adminBId, "admin-b@test.com");
      const r = await copiarCartaDeSucursal(sucursalA, true);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/ya tiene carta propia/);
      expect(await contarCarta(sucursalB)).toEqual(antes);
    });

    it("una segunda copia (ya con carta) se rechaza", async () => {
      await armarCartaDeA();
      await como(adminBId, "admin-b@test.com");
      expect((await copiarCartaDeSucursal(sucursalA, true)).ok).toBe(true);
      const despues = await contarCarta(sucursalB);
      expect((await copiarCartaDeSucursal(sucursalA, true)).ok).toBe(false);
      expect(await contarCarta(sucursalB)).toEqual(despues);
    });

    it("dos copias a la vez desde distintos orígenes: una sola entra, la carta no se mezcla", async () => {
      await armarCartaDeA();
      const sucursalC = (await prisma.sucursal.create({ data: { nombre: "Sucursal C" } })).id;
      await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalC, productoId: ids.pizza, visibleEnCarta: true, seccionCartaId: seccionId } });

      await como(adminBId, "admin-b@test.com");
      const resultados = await Promise.all([copiarCartaDeSucursal(sucursalA, true), copiarCartaDeSucursal(sucursalC, true)]);
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      const copia = await contarCarta(sucursalB);
      const delOrigen = resultados[0].ok ? await contarCarta(sucursalA) : await contarCarta(sucursalC);
      expect(copia).toEqual(delOrigen);
    });
  });

  describe("permisos (una clave propia por acción, contexto sucursal)", () => {
    it("el operador (sin la clave) no puede copiar", async () => {
      await armarCartaDeA();
      await como(operadorAId, "operador-a@test.com");
      const r = await copiarCartaDeSucursal(sucursalA, true);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
      expect(await contarCarta(sucursalB)).toEqual({ contenidos: 0, generos: 0, items: 0, opciones: 0 });
    });

    it("sin la clave en el rol admin tampoco: quitar el permiso lo bloquea aunque la carta esté vacía", async () => {
      await armarCartaDeA();
      await prisma.permisoRol.updateMany({ where: { accionClave: "carta_copiar_de_sucursal" }, data: { puedeEditar: false, puedeVer: false } });
      await como(adminBId, "admin-b@test.com");
      const r = await copiarCartaDeSucursal(sucursalA, true);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
      expect(await contarCarta(sucursalB)).toEqual({ contenidos: 0, generos: 0, items: 0, opciones: 0 });
    });
  });

  describe("entre empresas", () => {
    it("una sucursal de otra empresa no se puede copiar ni aparece como origen; sus cartas no se mezclan", async () => {
      await armarCartaDeA();
      await prismaAdmin.empresa.create({ data: { id: "norte", nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
      await activarTodosLosModulos("norte");
      const sucursalNorte = await prismaAdmin.sucursal.create({ data: { nombre: "Norte", empresaId: "norte" } });
      const unidadNorte = await prismaAdmin.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0, empresaId: "norte" } });
      const seccionNorte = await prismaAdmin.seccionCarta.create({ data: { nombre: "Norte", empresaId: "norte" } });
      const productoNorte = await prismaAdmin.producto.create({ data: { empresaId: "norte", codigo: "PV_NORTE", nombre: "Plato Norte", tipo: "PV", precioVenta: 100, unidadStockId: unidadNorte.id } });
      await prismaAdmin.contenidoCartaProducto.create({ data: { empresaId: "norte", sucursalId: sucursalNorte.id, productoId: productoNorte.id, visibleEnCarta: true, seccionCartaId: seccionNorte.id } });

      // La empresa principal: la sucursal B (vacía) no ve a Norte como origen, y copiar de Norte falla como «no existe».
      const adminB = await prisma.user.findUniqueOrThrow({ where: { id: adminBId } });
      await como(adminB.id, adminB.email);
      const r = await copiarCartaDeSucursal(sucursalNorte.id, true);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No se encontró esa sucursal/);
      expect(await contarCarta(sucursalB)).toEqual({ contenidos: 0, generos: 0, items: 0, opciones: 0 });

      const adminDePrincipal = await cargarAdminCarta(sucursalB, dbDeEmpresa("empresa_principal"));
      expect(adminDePrincipal.sucursalesConCarta.map((s) => s.id)).toEqual([sucursalA]);
      const adminDeNorte = await cargarAdminCarta(sucursalNorte.id, dbDeEmpresa("norte"));
      expect(adminDeNorte.cartaVacia).toBe(false);
      expect(adminDeNorte.sucursalesConCarta).toEqual([]);

      // El contenido de Norte nunca aparece en la carta de la principal ni al revés.
      const menuB = await resolverMenuCarta(sucursalB, dbDeEmpresa("empresa_principal"));
      expect(menuB!.secciones).toEqual([]);
    });
  });
});

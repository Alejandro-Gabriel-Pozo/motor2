import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivaSeccionCarta, guardarSeccionCarta } from "../../src/server/actions/carta/secciones";
import { actualizarVisibleEnCarta, guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";
import { actualizarActivaPromoCarta, guardarPromoCarta } from "../../src/server/actions/carta/promos";
import { resolverMenuCarta } from "../../src/core/carta/menu-consulta";
import { normalizarTagsCarta, validarImagenUrlCarta, validarOrdenCarta, validarPrecioCarta } from "../../src/core/carta/validaciones";

/**
 * Admin de la carta (docs/plan-carta-catalogo-2026-09-24.md, M9): las Server Actions de `src/server/actions/carta/` validan lo
 * que termina en la carta pública, solo escriben en las tablas de carta, exigen el permiso `carta` y las promos quedan
 * atadas a la sucursal activa. Desde docs/plan-carta-seccion-directa-2026-09-25.md el contenido de un PV elige su sección de carta
 * directo (obligatoria si se muestra, DA2) y no tiene imagen propia.
 */

describe("validaciones de la carta (puras)", () => {
  it("imagenUrl: vacío = sin imagen; https seguro pasa; lo demás se rechaza con un mensaje", () => {
    expect(validarImagenUrlCarta("  ")).toEqual({ ok: true, valor: null });
    expect(validarImagenUrlCarta("https://cdn.x.com/a.jpg")).toEqual({ ok: true, valor: "https://cdn.x.com/a.jpg" });
    expect(validarImagenUrlCarta("http://cdn.x.com/a.jpg").ok).toBe(false);
    expect(validarImagenUrlCarta("https://cdn.x.com/a.jpg);background:red").ok).toBe(false);
  });

  it("tags: desde texto con comas o lista, sin vacíos ni repetidos (sin distinguir mayúsculas)", () => {
    expect(normalizarTagsCarta(" Regional, veggie ,,Veggie, Sin TACC")).toEqual({ ok: true, valor: ["Regional", "veggie", "Sin TACC"] });
    expect(normalizarTagsCarta(["A", " a ", "B"])).toEqual({ ok: true, valor: ["A", "B"] });
    expect(normalizarTagsCarta(null)).toEqual({ ok: true, valor: [] });
    expect(normalizarTagsCarta("<script>").ok).toBe(false);
    expect(normalizarTagsCarta("x".repeat(31)).ok).toBe(false);
    expect(normalizarTagsCarta("1,2,3,4,5,6,7,8,9").ok).toBe(false);
  });

  it("orden y precio", () => {
    expect(validarOrdenCarta("")).toEqual({ ok: true, valor: 0 });
    expect(validarOrdenCarta("-2")).toEqual({ ok: true, valor: -2 });
    expect(validarOrdenCarta("1.5").ok).toBe(false);
    expect(validarPrecioCarta("25000")).toEqual({ ok: true, valor: 25000 });
    expect(validarPrecioCarta(10.005)).toEqual({ ok: true, valor: 10.01 });
    expect(validarPrecioCarta(-1).ok).toBe(false);
    expect(validarPrecioCarta(Infinity).ok).toBe(false);
    expect(validarPrecioCarta("").ok).toBe(false);
  });
});

describe("Server Actions de la carta", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let operadorRolId: string;
  let categoriaId: string;
  let pvId: string;
  let mpId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    operadorRolId = base.operador.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    categoriaId = (await prisma.categoriaProducto.create({ data: { nombre: "Bife" } })).id;
    pvId = (await sembrarProductoDisponible({ codigo: "PV_BIFE", nombre: "Bife de chorizo", tipo: "PV", categoriaId, precioVenta: 34000, unidadStockId: u.id }, sucursalId)).id;
    mpId = (await prisma.producto.create({ data: { codigo: "MP_CARNE", nombre: "Carne", tipo: "MP", unidadStockId: u.id } })).id;
  });

  describe("secciones de carta", () => {
    it("crea, rechaza un nombre repetido (sin distinguir mayúsculas) y edita", async () => {
      const r = await guardarSeccionCarta({ nombre: "Platos Principales", titulo: "Del fuego", orden: "2" });
      expect(r.ok).toBe(true);
      const id = r.ok ? r.id : "";
      expect(await prisma.seccionCarta.findUniqueOrThrow({ where: { id } })).toMatchObject({ nombre: "Platos Principales", titulo: "Del fuego", orden: 2, activa: true, imagenUrl: null });

      expect(await guardarSeccionCarta({ nombre: "platos principales" })).toMatchObject({ ok: false, mensaje: 'Ya existe la sección de carta "Platos Principales".' });

      const e = await guardarSeccionCarta({ id, nombre: "Platos Principales", titulo: "", descripcion: "A las brasas", imagenUrl: "https://cdn.x.com/p.jpg" });
      expect(e.ok).toBe(true);
      expect(await prisma.seccionCarta.findUniqueOrThrow({ where: { id } })).toMatchObject({ titulo: null, descripcion: "A las brasas", imagenUrl: "https://cdn.x.com/p.jpg", orden: 0 });
    });

    it("rechaza nombre vacío, imagen insegura y orden no entero sin escribir nada", async () => {
      expect((await guardarSeccionCarta({ nombre: "  " })).ok).toBe(false);
      expect((await guardarSeccionCarta({ nombre: "Entradas", imagenUrl: "javascript:alert(1)" })).ok).toBe(false);
      expect((await guardarSeccionCarta({ nombre: "Entradas", orden: "abc" })).ok).toBe(false);
      expect(await prisma.seccionCarta.count()).toBe(0);
    });

    it("se apaga y se prende, nunca se borra", async () => {
      const r = await guardarSeccionCarta({ nombre: "Entradas" });
      const id = r.ok ? r.id : "";
      expect((await actualizarActivaSeccionCarta(id, false)).ok).toBe(true);
      expect((await prisma.seccionCarta.findUniqueOrThrow({ where: { id } })).activa).toBe(false);
      expect((await actualizarActivaSeccionCarta(id, true)).ok).toBe(true);
      expect((await prisma.seccionCarta.findUniqueOrThrow({ where: { id } })).activa).toBe(true);
      expect(await actualizarActivaSeccionCarta("no-existe", true)).toMatchObject({ ok: false });
    });
  });

  describe("contenido de carta de un PV", () => {
    it("guardar el contenido (con su sección) hace aparecer al PV en la carta (con tags normalizados); ocultarlo lo saca", async () => {
      const s = await guardarSeccionCarta({ nombre: "Platos" });
      const seccionCartaId = s.ok ? s.id : "";
      expect((await resolverMenuCarta(sucursalId))!.secciones).toEqual([]);

      const r = await guardarContenidoCartaProducto(pvId, { visibleEnCarta: true, seccionCartaId, descripcion: " 400 g ", tags: "Regional, regional,Sin TACC", especial: true, orden: 1 });
      expect(r.ok).toBe(true);
      const seccion = (await resolverMenuCarta(sucursalId))!.secciones[0];
      expect(seccion.nombre).toBe("Platos");
      expect(seccion.items[0]).toMatchObject({ nombre: "Bife de chorizo", descripcion: "400 g", tags: ["Regional", "Sin TACC"], especial: true, precio: 34000, imagenUrl: null });

      expect((await actualizarVisibleEnCarta(pvId, false)).ok).toBe(true);
      expect((await resolverMenuCarta(sucursalId))!.secciones).toEqual([]);
      // Ocultar no borra lo cargado.
      expect(await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: { productoId: pvId } })).toMatchObject({ descripcion: "400 g", especial: true, seccionCartaId });
      // Y volver a mostrarlo con el atajo funciona: ya tiene sección.
      expect((await actualizarVisibleEnCarta(pvId, true)).ok).toBe(true);
      expect((await resolverMenuCarta(sucursalId))!.secciones[0].items.map((i) => i.productoId)).toEqual([pvId]);
    });

    it("DA2: visible exige sección; oculto se guarda sin ella; una sección inexistente se rechaza", async () => {
      const falta = "Elegí la sección de carta donde se muestra (sin sección no puede salir en la carta).";
      expect(await guardarContenidoCartaProducto(pvId, { visibleEnCarta: true })).toMatchObject({ ok: false, mensaje: falta });
      expect(await guardarContenidoCartaProducto(pvId, { visibleEnCarta: true, seccionCartaId: "  " })).toMatchObject({ ok: false, mensaje: falta });
      expect(await guardarContenidoCartaProducto(pvId, { visibleEnCarta: true, seccionCartaId: "no-existe" })).toMatchObject({ ok: false, mensaje: "No se encontró la sección de carta." });
      expect(await prisma.contenidoCartaProducto.count()).toBe(0);

      // Oculto, sin sección: se guarda (por si se vuelve a mostrar después).
      expect((await guardarContenidoCartaProducto(pvId, { visibleEnCarta: false, descripcion: "Para después" })).ok).toBe(true);
      expect(await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: { productoId: pvId } })).toMatchObject({ visibleEnCarta: false, seccionCartaId: null, descripcion: "Para después" });
      // Mostrarlo con el atajo, sin sección: se rechaza y sigue oculto.
      expect(await actualizarVisibleEnCarta(pvId, true)).toMatchObject({ ok: false, mensaje: falta });
      expect((await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: { productoId: pvId } })).visibleEnCarta).toBe(false);
      // Sin fila todavía, tampoco se puede mostrar con el atajo.
      await prisma.contenidoCartaProducto.deleteMany();
      expect(await actualizarVisibleEnCarta(pvId, true)).toMatchObject({ ok: false, mensaje: falta });
      expect(await prisma.contenidoCartaProducto.count()).toBe(0);
    });

    it("la categoría del producto no importa: un PV sin categoría sale en la sección elegida", async () => {
      const s = await guardarSeccionCarta({ nombre: "Bebidas" });
      await prisma.producto.update({ where: { id: pvId }, data: { categoriaId: null } });
      expect((await guardarContenidoCartaProducto(pvId, { visibleEnCarta: true, seccionCartaId: s.ok ? s.id : "" })).ok).toBe(true);
      const [seccion] = (await resolverMenuCarta(sucursalId))!.secciones;
      expect(seccion.items).toEqual([expect.objectContaining({ productoId: pvId, categoria: "Bebidas" })]);
    });

    it("solo PV; valida tags; no toca el producto", async () => {
      const s = await guardarSeccionCarta({ nombre: "Platos" });
      const seccionCartaId = s.ok ? s.id : "";
      expect(await guardarContenidoCartaProducto(mpId, { visibleEnCarta: true, seccionCartaId })).toMatchObject({ ok: false, mensaje: "Solo un producto de venta (PV) puede ir en la carta." });
      expect(await actualizarVisibleEnCarta(mpId, true)).toMatchObject({ ok: false });
      expect((await guardarContenidoCartaProducto(pvId, { visibleEnCarta: true, seccionCartaId, tags: ["<b>"] })).ok).toBe(false);
      expect(await guardarContenidoCartaProducto("no-existe", { visibleEnCarta: true })).toMatchObject({ ok: false, mensaje: "No se encontró el producto." });
      expect(await prisma.contenidoCartaProducto.count()).toBe(0);
      expect(await prisma.producto.findUniqueOrThrow({ where: { id: pvId } })).toMatchObject({ nombre: "Bife de chorizo", categoriaId });
    });
  });

  describe("promos de la sucursal", () => {
    it("crea en la sucursal activa, edita, y se apaga", async () => {
      const s = await guardarSeccionCarta({ nombre: "Promos" });
      const seccionCartaId = s.ok ? s.id : "";
      expect((await guardarPromoCarta({ seccionCartaId, titulo: "1 pizza + coca 1,5L", precio: "25000", orden: 1 })).ok).toBe(true);
      const promo = await prisma.promoCarta.findFirstOrThrow();
      expect(promo).toMatchObject({ sucursalId, titulo: "1 pizza + coca 1,5L", orden: 1, activa: true });
      expect(Number(promo.precio)).toBe(25000);

      expect((await guardarPromoCarta({ id: promo.id, seccionCartaId, titulo: "1 pizza + coca", precio: 26000, descripcion: "Muzza" })).ok).toBe(true);
      expect(await prisma.promoCarta.findUniqueOrThrow({ where: { id: promo.id } })).toMatchObject({ titulo: "1 pizza + coca", descripcion: "Muzza" });

      expect((await actualizarActivaPromoCarta(promo.id, false)).ok).toBe(true);
      expect((await prisma.promoCarta.findUniqueOrThrow({ where: { id: promo.id } })).activa).toBe(false);
    });

    it("una promo de OTRA sucursal no se puede editar ni apagar pasando su id", async () => {
      const s = await guardarSeccionCarta({ nombre: "Promos" });
      const ajena = await prisma.promoCarta.create({ data: { sucursalId: otraSucursalId, seccionCartaId: s.ok ? s.id : "", titulo: "Ajena", precio: 1 } });
      expect(await guardarPromoCarta({ id: ajena.id, seccionCartaId: ajena.seccionCartaId, titulo: "Pisada", precio: 2 })).toMatchObject({ ok: false, mensaje: "No se encontró la promo en esta sucursal." });
      expect(await actualizarActivaPromoCarta(ajena.id, false)).toMatchObject({ ok: false });
      expect(await prisma.promoCarta.findUniqueOrThrow({ where: { id: ajena.id } })).toMatchObject({ titulo: "Ajena", activa: true });
    });

    it("valida título, precio y sección", async () => {
      const s = await guardarSeccionCarta({ nombre: "Promos" });
      const seccionCartaId = s.ok ? s.id : "";
      expect((await guardarPromoCarta({ seccionCartaId, titulo: " ", precio: 1 })).ok).toBe(false);
      expect((await guardarPromoCarta({ seccionCartaId, titulo: "X", precio: -1 })).ok).toBe(false);
      expect((await guardarPromoCarta({ seccionCartaId: "no-existe", titulo: "X", precio: 1 })).ok).toBe(false);
      expect(await prisma.promoCarta.count()).toBe(0);
    });
  });

  it("sin el permiso `carta` (el operador arranca sin él) ninguna acción escribe", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: operadorRolId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });

    const resultados = await Promise.all([
      guardarSeccionCarta({ nombre: "Entradas" }),
      guardarContenidoCartaProducto(pvId, { visibleEnCarta: false }),
      actualizarVisibleEnCarta(pvId, false),
    ]);
    for (const r of resultados) {
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
    }
    expect(await prisma.seccionCarta.count()).toBe(0);
    expect(await prisma.contenidoCartaProducto.count()).toBe(0);
  });
});

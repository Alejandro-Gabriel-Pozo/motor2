import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import {
  actualizarActivoItemAgrupadoCarta,
  actualizarOrdenOpcionItemAgrupadoCarta,
  agregarOpcionItemAgrupadoCarta,
  guardarItemAgrupadoCarta,
  quitarOpcionItemAgrupadoCarta,
} from "../../src/server/actions/carta/items-agrupados";
import { resolverMenuCarta } from "../../src/core/carta/menu-consulta";
import { validarNombreItemAgrupadoCarta } from "../../src/core/carta/validaciones";

/**
 * Server Actions de los ítems agrupados de la carta (docs/plan-agrupacion-items-carta-2026-09-24.md, M5): exigen `carta`,
 * validan lo que termina en la carta pública, solo escriben en ItemAgrupadoCarta / OpcionItemAgrupadoCarta, y BLOQUEAN
 * agrupar productos de distinto precio (D5, decisión del dueño; caso «Los Miches»). Desde
 * docs/plan-carta-seccion-directa-2026-09-25.md el ítem agrupado elige su sección de carta directo y no tiene imagen.
 */
describe("Server Actions de ítems agrupados", () => {
  let sucursalId: string;
  let operadorRolId: string;
  let sBebidas: string;
  let sOtras: string;
  let unidadId: string;
  let ids: Record<string, string>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    operadorRolId = base.operador.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    const cGas = (await prisma.categoriaProducto.create({ data: { nombre: "Gaseosa 500 CC" } })).id;
    const cAgua = (await prisma.categoriaProducto.create({ data: { nombre: "Aguas" } })).id;
    sBebidas = (await prisma.seccionCarta.create({ data: { nombre: "Bebidas sin alcohol" } })).id;
    sOtras = (await prisma.seccionCarta.create({ data: { nombre: "Otras bebidas" } })).id;
    const pv = async (codigo: string, nombre: string, precioVenta: number, categoriaId = cGas) =>
      (await sembrarProductoDisponible({ codigo, nombre, tipo: "PV", categoriaId, precioVenta, unidadStockId: unidadId }, sucursalId)).id;
    ids = {
      coca: await pv("PV_COCA", "Coca-Cola 500cc", 5000),
      sprite: await pv("PV_SPRITE", "Sprite 500cc", 5000),
      fanta: await pv("PV_FANTA", "Fanta 500cc", 5500),
      agua: await pv("PV_AGUA", "Agua saborizada 500cc", 5000, cAgua),
      mp: (await prisma.producto.create({ data: { codigo: "MP_JARABE", nombre: "Jarabe", tipo: "MP", unidadStockId: unidadId } })).id,
    };
  });

  const crearGaseosa = async (nombre = "Gaseosa 500 CC") => {
    const r = await guardarItemAgrupadoCarta({ nombre, seccionCartaId: sBebidas, descripcion: "Bien fría", tags: "Sin alcohol", especial: true });
    expect(r.ok, r.mensaje).toBe(true);
    return r.ok ? r.id : "";
  };

  it("sin el permiso `carta` (el operador arranca sin él) ninguna acción escribe", async () => {
    const agId = await crearGaseosa();
    await agregarOpcionItemAgrupadoCarta(agId, ids.coca);
    const opcionId = (await prisma.opcionItemAgrupadoCarta.findFirstOrThrow()).id;

    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: operadorRolId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const resultados = await Promise.all([
      guardarItemAgrupadoCarta({ nombre: "Otra", seccionCartaId: sBebidas }),
      guardarItemAgrupadoCarta({ id: agId, nombre: "Renombrada", seccionCartaId: sBebidas }),
      actualizarActivoItemAgrupadoCarta(agId, false),
      agregarOpcionItemAgrupadoCarta(agId, ids.sprite),
      actualizarOrdenOpcionItemAgrupadoCarta(opcionId, 7),
      quitarOpcionItemAgrupadoCarta(opcionId),
    ]);
    for (const r of resultados) {
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
    }
    expect(await prisma.itemAgrupadoCarta.findMany({ select: { nombre: true, activo: true } })).toEqual([{ nombre: "Gaseosa 500 CC", activo: true }]);
    expect(await prisma.opcionItemAgrupadoCarta.findMany({ select: { productoId: true, orden: true } })).toEqual([{ productoId: ids.coca, orden: 0 }]);
  });

  it("alta, edición y nombre repetido (sin distinguir mayúsculas)", async () => {
    const agId = await crearGaseosa();
    expect(await prisma.itemAgrupadoCarta.findUniqueOrThrow({ where: { id: agId } })).toMatchObject({
      nombre: "Gaseosa 500 CC",
      seccionCartaId: sBebidas,
      descripcion: "Bien fría",
      tags: ["Sin alcohol"],
      especial: true,
      orden: 0,
      activo: true,
    });
    // Sin imagen propia: la carta solo dibuja la de la sección.
    expect(await prisma.itemAgrupadoCarta.findUniqueOrThrow({ where: { id: agId } })).not.toHaveProperty("imagenUrl");
    expect(await guardarItemAgrupadoCarta({ nombre: "gaseosa 500 cc", seccionCartaId: sBebidas })).toEqual({ ok: false, mensaje: 'Ya existe el ítem agrupado "Gaseosa 500 CC".' });

    const e = await guardarItemAgrupadoCarta({ id: agId, nombre: "Gaseosa 500 CC", seccionCartaId: sOtras, descripcion: "", tags: ["Fría", "fría"], orden: "3" });
    expect(e.ok).toBe(true);
    expect(await prisma.itemAgrupadoCarta.findUniqueOrThrow({ where: { id: agId } })).toMatchObject({
      seccionCartaId: sOtras,
      descripcion: null,
      tags: ["Fría"],
      especial: false,
      orden: 3,
    });
    expect(await guardarItemAgrupadoCarta({ id: "no-existe", nombre: "X", seccionCartaId: sBebidas })).toEqual({ ok: false, mensaje: "No se encontró el ítem agrupado." });
    expect(await prisma.itemAgrupadoCarta.count()).toBe(1);
  });

  it("validaciones: nombre vacío, tags, descripción larga, orden no entero, sección vacía o inexistente → no escribe", async () => {
    expect(validarNombreItemAgrupadoCarta("  ").ok).toBe(false);
    const casos = [
      { nombre: "  ", seccionCartaId: sBebidas },
      { nombre: "Gaseosa", seccionCartaId: sBebidas, tags: "<script>" },
      { nombre: "Gaseosa", seccionCartaId: sBebidas, tags: "1,2,3,4,5,6,7,8,9" },
      { nombre: "Gaseosa", seccionCartaId: sBebidas, descripcion: "x".repeat(501) },
      { nombre: "Gaseosa", seccionCartaId: sBebidas, orden: "1.5" },
      { nombre: "Gaseosa", seccionCartaId: "no-existe" },
      { nombre: "Gaseosa", seccionCartaId: "" },
    ];
    for (const datos of casos) expect((await guardarItemAgrupadoCarta(datos)).ok, JSON.stringify(datos).slice(0, 80)).toBe(false);
    expect(await guardarItemAgrupadoCarta({ nombre: "Gaseosa", seccionCartaId: "no-existe" })).toEqual({ ok: false, mensaje: "No se encontró la sección de carta." });
    expect(await guardarItemAgrupadoCarta({ nombre: "Gaseosa", seccionCartaId: "" })).toEqual({ ok: false, mensaje: "Elegí la sección de carta del ítem agrupado." });
    expect(await prisma.itemAgrupadoCarta.count()).toBe(0);
  });

  describe("opciones", () => {
    it("solo PV (un MP da error); producto o ítem inexistente → error", async () => {
      const agId = await crearGaseosa();
      expect(await agregarOpcionItemAgrupadoCarta(agId, ids.mp)).toEqual({ ok: false, mensaje: "Solo un producto de venta (PV) puede ir en la carta." });
      expect(await agregarOpcionItemAgrupadoCarta(agId, "no-existe")).toEqual({ ok: false, mensaje: "No se encontró el producto." });
      expect(await agregarOpcionItemAgrupadoCarta("no-existe", ids.coca)).toEqual({ ok: false, mensaje: "No se encontró el ítem agrupado." });
      expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(0);
    });

    it("un producto que ya está en otro grupo da error con el nombre de ese grupo; en el mismo, 'ya está'", async () => {
      const g500 = await crearGaseosa();
      const g15 = await crearGaseosa("Gaseosa 1,5L");
      expect((await agregarOpcionItemAgrupadoCarta(g15, ids.sprite)).ok).toBe(true);
      expect(await agregarOpcionItemAgrupadoCarta(g500, ids.sprite)).toEqual({ ok: false, mensaje: "«Sprite 500cc» ya está en «Gaseosa 1,5L»: quitalo de ahí primero." });
      expect(await agregarOpcionItemAgrupadoCarta(g15, ids.sprite)).toEqual({ ok: false, mensaje: "«Sprite 500cc» ya está en «Gaseosa 1,5L»." });
      expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(1);
    });

    it("precio (D5, «Los Miches»): Coca y Sprite a $5000 entran; Fanta a $5500 se RECHAZA sin escribir; bajada a $5000 en Catálogo, entra", async () => {
      const agId = await crearGaseosa();
      // El primer producto de un ítem nuevo no tiene con qué comparar: entra siempre (acá, incluso uno de otro precio).
      const otroId = await crearGaseosa("Grupo nuevo");
      expect((await agregarOpcionItemAgrupadoCarta(otroId, ids.fanta)).ok).toBe(true);
      await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { productoId: ids.fanta } });

      expect((await agregarOpcionItemAgrupadoCarta(agId, ids.coca)).ok).toBe(true);
      expect((await agregarOpcionItemAgrupadoCarta(agId, ids.sprite)).ok).toBe(true);

      const rechazo = await agregarOpcionItemAgrupadoCarta(agId, ids.fanta);
      expect(rechazo).toEqual({
        ok: false,
        mensaje: "«Fanta 500cc» cuesta $5.500 acá y «Gaseosa 500 CC» ya tiene opciones a $5.000: agrupá solo productos del mismo precio, o dejala aparte.",
      });
      expect(await prisma.opcionItemAgrupadoCarta.count({ where: { itemAgrupadoCartaId: agId } })).toBe(2);
      expect(await prisma.opcionItemAgrupadoCarta.findUnique({ where: { productoId: ids.fanta } })).toBeNull();

      // Se corrige el precio en Catálogo (fuera de esta acción) y se reintenta.
      await prisma.producto.update({ where: { id: ids.fanta }, data: { precioVenta: 5000 } });
      expect((await agregarOpcionItemAgrupadoCarta(agId, ids.fanta)).ok).toBe(true);
      expect(await prisma.opcionItemAgrupadoCarta.count({ where: { itemAgrupadoCartaId: agId } })).toBe(3);
    });

    it("precio (D5): se compara con precioDeCarta en la sucursal ACTIVA (el precio local habilitado cuenta, el deshabilitado no)", async () => {
      const agId = await crearGaseosa();
      expect((await agregarOpcionItemAgrupadoCarta(agId, ids.coca)).ok).toBe(true);
      // Fanta tiene $5500 global pero un precio local habilitado de $5000 acá: coincide.
      await prisma.precioLocalProducto.create({ data: { sucursalId, productoId: ids.fanta, precio: 5000, habilitado: true } });
      expect((await agregarOpcionItemAgrupadoCarta(agId, ids.fanta)).ok).toBe(true);
      // Sprite tiene $5000 global pero un local habilitado de $6000 acá: no coincide.
      await prisma.precioLocalProducto.create({ data: { sucursalId, productoId: ids.sprite, precio: 6000, habilitado: true } });
      expect((await agregarOpcionItemAgrupadoCarta(agId, ids.sprite)).mensaje).toMatch(/^«Sprite 500cc» cuesta \$6\.000 acá/);
      // Deshabilitado: vuelve a valer el global ($5000) y entra.
      await prisma.precioLocalProducto.updateMany({ where: { productoId: ids.sprite }, data: { habilitado: false } });
      expect((await agregarOpcionItemAgrupadoCarta(agId, ids.sprite)).ok).toBe(true);
    });

    it("agregar, reordenar y quitar; quitar deja intacto el ContenidoCartaProducto", async () => {
      const agId = await crearGaseosa();
      await prisma.contenidoCartaProducto.create({ data: { productoId: ids.sprite, visibleEnCarta: true, descripcion: "Lima-limón" } });
      expect(await agregarOpcionItemAgrupadoCarta(agId, ids.coca)).toEqual({ ok: true, mensaje: "«Coca-Cola 500cc» agregado a «Gaseosa 500 CC»." });
      expect((await agregarOpcionItemAgrupadoCarta(agId, ids.sprite, "5")).ok).toBe(true);
      const opciones = await prisma.opcionItemAgrupadoCarta.findMany({ orderBy: { orden: "asc" }, select: { id: true, productoId: true, orden: true } });
      expect(opciones.map((o) => [o.productoId, o.orden])).toEqual([
        [ids.coca, 0],
        [ids.sprite, 5],
      ]);

      const spriteOpcion = opciones[1].id;
      expect((await actualizarOrdenOpcionItemAgrupadoCarta(spriteOpcion, "-1")).ok).toBe(true);
      expect((await prisma.opcionItemAgrupadoCarta.findUniqueOrThrow({ where: { id: spriteOpcion } })).orden).toBe(-1);
      expect((await actualizarOrdenOpcionItemAgrupadoCarta(spriteOpcion, "x")).ok).toBe(false);
      expect(await actualizarOrdenOpcionItemAgrupadoCarta("no-existe", 1)).toEqual({ ok: false, mensaje: "No se encontró la opción." });

      expect(await quitarOpcionItemAgrupadoCarta(spriteOpcion)).toEqual({ ok: true, mensaje: "«Sprite 500cc» ya no está en «Gaseosa 500 CC»." });
      expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(1);
      expect(await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: { productoId: ids.sprite } })).toMatchObject({ visibleEnCarta: true, descripcion: "Lima-limón" });
      expect(await quitarOpcionItemAgrupadoCarta(spriteOpcion)).toEqual({ ok: false, mensaje: "No se encontró la opción." });
    });

    it("la categoría de la opción no importa (sin aviso D4): una de otra categoría se agrega igual y sale en la sección del ítem", async () => {
      const agId = await crearGaseosa();
      expect((await agregarOpcionItemAgrupadoCarta(agId, ids.coca)).ok).toBe(true);
      expect(await agregarOpcionItemAgrupadoCarta(agId, ids.agua)).toEqual({ ok: true, mensaje: "«Agua saborizada 500cc» agregado a «Gaseosa 500 CC»." });
      const [seccion] = (await resolverMenuCarta(sucursalId))!.secciones;
      expect(seccion.nombre).toBe("Bebidas sin alcohol");
      expect(seccion.items.find((i) => i.productoId === agId)!.opciones!.map((o) => o.productoId)).toEqual([ids.coca, ids.agua]);
    });
  });

  describe("alta con productos (DA7)", () => {
    const opcionesDe = async (itemId: string) =>
      (await prisma.opcionItemAgrupadoCarta.findMany({ where: { itemAgrupadoCartaId: itemId }, orderBy: { orden: "asc" }, select: { productoId: true, orden: true } })).map((o) => [
        o.productoId,
        o.orden,
      ]);

    it("tres productos del mismo precio: entran los tres, en ese orden, en un solo mensaje", async () => {
      await prisma.producto.update({ where: { id: ids.fanta }, data: { precioVenta: 5000 } });
      const r = await guardarItemAgrupadoCarta({ nombre: "Gaseosa 500 CC", seccionCartaId: sBebidas, productoIds: [ids.coca, ids.sprite, ids.fanta] });
      expect(r).toEqual({ ok: true, mensaje: 'Ítem agrupado "Gaseosa 500 CC" creado con 3 de 3 productos.', id: expect.any(String), nombre: "Gaseosa 500 CC" });
      expect(await opcionesDe(r.ok ? r.id : "")).toEqual([
        [ids.coca, 0],
        [ids.sprite, 1],
        [ids.fanta, 2],
      ]);
    });

    it("uno de otro precio: entran los otros dos y el mensaje dice cuál no entró y por qué (bloqueo D5)", async () => {
      const r = await guardarItemAgrupadoCarta({ nombre: "Gaseosa 500 CC", seccionCartaId: sBebidas, productoIds: [ids.coca, ids.fanta, ids.sprite] });
      expect(r.ok).toBe(true);
      expect(r.mensaje).toBe(
        'Ítem agrupado "Gaseosa 500 CC" creado con 2 de 3 productos. No entró: «Fanta 500cc» cuesta $5.500 acá y «Gaseosa 500 CC» ya tiene opciones a $5.000: agrupá solo productos del mismo precio, o dejala aparte.'
      );
      expect(await opcionesDe(r.ok ? r.id : "")).toEqual([
        [ids.coca, 0],
        [ids.sprite, 1],
      ]);
      expect(await prisma.opcionItemAgrupadoCarta.findUnique({ where: { productoId: ids.fanta } })).toBeNull();
    });

    it("uno ya agrupado en otro ítem: no entra (mismo criterio que «Agregar producto») y el mensaje lo nombra", async () => {
      const otro = await crearGaseosa("Gaseosa 1,5L");
      expect((await agregarOpcionItemAgrupadoCarta(otro, ids.sprite)).ok).toBe(true);
      const r = await guardarItemAgrupadoCarta({ nombre: "Gaseosa 500 CC", seccionCartaId: sBebidas, productoIds: [ids.coca, ids.sprite, "no-existe", ids.mp] });
      expect(r.ok).toBe(true);
      expect(r.mensaje).toBe(
        'Ítem agrupado "Gaseosa 500 CC" creado con 1 de 4 productos. No entraron: «Sprite 500cc» ya está en «Gaseosa 1,5L»: quitalo de ahí primero. No se encontró el producto. Solo un producto de venta (PV) puede ir en la carta.'
      );
      expect(await opcionesDe(r.ok ? r.id : "")).toEqual([[ids.coca, 0]]);
      // Sprite sigue en su grupo.
      expect((await prisma.opcionItemAgrupadoCarta.findUniqueOrThrow({ where: { productoId: ids.sprite } })).itemAgrupadoCartaId).toBe(otro);
    });

    it("sin productos (o lista vacía/repetidos) = alta de siempre; al editar, productoIds se ignora; un alta rechazada no agrega nada", async () => {
      const r = await guardarItemAgrupadoCarta({ nombre: "Gaseosa 500 CC", seccionCartaId: sBebidas, productoIds: [] });
      expect(r.mensaje).toBe('Ítem agrupado "Gaseosa 500 CC" creado.');
      const id = r.ok ? r.id : "";
      expect((await guardarItemAgrupadoCarta({ id, nombre: "Gaseosa 500 CC", seccionCartaId: sBebidas, productoIds: [ids.coca] })).mensaje).toBe('Ítem agrupado "Gaseosa 500 CC" guardado.');
      expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(0);

      const repetidos = await guardarItemAgrupadoCarta({ nombre: "Otra", seccionCartaId: sBebidas, productoIds: [ids.coca, ids.coca, " "] });
      expect(repetidos.mensaje).toBe('Ítem agrupado "Otra" creado con 1 de 1 producto.');

      // Nombre repetido: no se crea el ítem y no se agrega ninguna opción.
      expect(await guardarItemAgrupadoCarta({ nombre: "gaseosa 500 cc", seccionCartaId: sBebidas, productoIds: [ids.sprite] })).toMatchObject({ ok: false });
      expect(await prisma.opcionItemAgrupadoCarta.findUnique({ where: { productoId: ids.sprite } })).toBeNull();
    });

    it("sin el permiso `carta` no crea el ítem ni agrega productos", async () => {
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: operadorRolId });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
      const r = await guardarItemAgrupadoCarta({ nombre: "Gaseosa 500 CC", seccionCartaId: sBebidas, productoIds: [ids.coca] });
      expect(r.ok).toBe(false);
      expect(await prisma.itemAgrupadoCarta.count()).toBe(0);
      expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(0);
    });
  });

  it("apagar y prender: la fila sigue existiendo", async () => {
    const agId = await crearGaseosa();
    expect(await actualizarActivoItemAgrupadoCarta(agId, false)).toEqual({ ok: true, mensaje: 'Ítem agrupado "Gaseosa 500 CC" apagado.' });
    expect((await prisma.itemAgrupadoCarta.findUniqueOrThrow({ where: { id: agId } })).activo).toBe(false);
    expect((await actualizarActivoItemAgrupadoCarta(agId, true)).ok).toBe(true);
    expect((await prisma.itemAgrupadoCarta.findUniqueOrThrow({ where: { id: agId } })).activo).toBe(true);
    expect(await actualizarActivoItemAgrupadoCarta("no-existe", true)).toEqual({ ok: false, mensaje: "No se encontró el ítem agrupado." });
  });

  it("no toca Producto: precioVenta, categoría y ContenidoCartaProducto no cambian", async () => {
    await prisma.contenidoCartaProducto.create({ data: { productoId: ids.coca, visibleEnCarta: true, descripcion: "Clásica" } });
    const leer = () =>
      prisma.producto.findMany({
        orderBy: { codigo: "asc" },
        select: { id: true, precioVenta: true, categoriaId: true, contenidoCarta: { select: { visibleEnCarta: true, descripcion: true } } },
      });
    const antes = await leer();
    const agId = await crearGaseosa();
    await agregarOpcionItemAgrupadoCarta(agId, ids.coca);
    await agregarOpcionItemAgrupadoCarta(agId, ids.sprite);
    await agregarOpcionItemAgrupadoCarta(agId, ids.fanta); // rechazado por precio
    await actualizarActivoItemAgrupadoCarta(agId, false);
    await quitarOpcionItemAgrupadoCarta((await prisma.opcionItemAgrupadoCarta.findUniqueOrThrow({ where: { productoId: ids.coca } })).id);
    expect(await leer()).toEqual(antes);
  });

  it("fin a fin: después de agregar dos opciones, resolverMenuCarta muestra el ítem agrupado", async () => {
    const agId = await crearGaseosa();
    await agregarOpcionItemAgrupadoCarta(agId, ids.coca);
    await agregarOpcionItemAgrupadoCarta(agId, ids.sprite);
    const items = (await resolverMenuCarta(sucursalId))!.secciones.flatMap((s) => s.items);
    expect(items).toEqual([
      {
        productoId: agId,
        nombre: "Gaseosa 500 CC",
        categoria: "Bebidas sin alcohol",
        descripcion: "Bien fría",
        precio: 5000,
        tags: ["Sin alcohol"],
        especial: true,
        imagenUrl: null,
        opciones: [
          { productoId: ids.coca, nombre: "Coca-Cola 500cc", precio: 5000 },
          { productoId: ids.sprite, nombre: "Sprite 500cc", precio: 5000 },
        ],
      },
    ]);
  });
});

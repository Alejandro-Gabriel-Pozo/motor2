import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarDescuentoProducto } from "../../src/server/actions/carta/descuento-producto";
import { agregarOpcionItemAgrupadoCarta, guardarItemAgrupadoCarta } from "../../src/server/actions/carta/items-agrupados";
import { descuentosDeProductoEnSucursal, productoTieneDescuentoEnAlgunaSucursal } from "../../src/core/carta/descuento-producto-consulta";
import { resolverMenuCarta } from "../../src/core/carta/menu-consulta";

/**
 * Producto con descuento (Fase 2): `guardarDescuentoProducto` pone, cambia o saca el % de UN PV EN LA SUCURSAL ACTIVA. Exige `carta_producto_descuento`,
 * valida el % (0 < % < 100; vacío o 0 lo borra), audita cada cambio, no deja descontar un MP ni una opción de un ítem agrupado, y la carta pública
 * lo refleja con el precio de lista tachado.
 */
describe("guardarDescuentoProducto", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let operadorRolId: string;
  let adminId: string;
  let pvId: string;
  let pv2Id: string;
  let mpId: string;
  let seccionId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    operadorRolId = base.operador.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Platos" } })).id;
    pvId = (await sembrarProductoDisponible({ codigo: "PV_BIFE", nombre: "Bife de chorizo", tipo: "PV", precioVenta: 34000, unidadStockId: u.id }, sucursalId)).id;
    pv2Id = (await sembrarProductoDisponible({ codigo: "PV_FLAN", nombre: "Flan", tipo: "PV", precioVenta: 1234.55, unidadStockId: u.id }, sucursalId)).id;
    mpId = (await prisma.producto.create({ data: { codigo: "MP_CARNE", nombre: "Carne", tipo: "MP", unidadStockId: u.id } })).id;
    for (const [id, orden] of [[pvId, 1], [pv2Id, 2]] as const) {
      await prisma.contenidoCartaProducto.create({ data: { productoId: id, visibleEnCarta: true, seccionCartaId: seccionId, orden } });
    }
  });

  it("crea el descuento, lo cambia y lo borra (vacío o 0), siempre una sola fila por producto y sucursal", async () => {
    const r = await guardarDescuentoProducto(pvId, 15);
    expect(r).toMatchObject({ ok: true });
    expect(await prisma.descuentoProductoSucursal.findMany()).toMatchObject([{ productoId: pvId, sucursalId, porcentaje: expect.anything() }]);
    expect(Number((await prisma.descuentoProductoSucursal.findFirstOrThrow()).porcentaje)).toBe(15);

    expect((await guardarDescuentoProducto(pvId, "20,5")).ok).toBe(true);
    const filas = await prisma.descuentoProductoSucursal.findMany();
    expect(filas).toHaveLength(1);
    expect(Number(filas[0].porcentaje)).toBe(20.5);

    expect((await guardarDescuentoProducto(pvId, "")).ok).toBe(true);
    expect(await prisma.descuentoProductoSucursal.count()).toBe(0);

    await guardarDescuentoProducto(pvId, 10);
    expect((await guardarDescuentoProducto(pvId, 0)).ok).toBe(true);
    expect(await prisma.descuentoProductoSucursal.count()).toBe(0);
  });

  it("borrar un descuento que no existía responde ok sin escribir ni auditar", async () => {
    const r = await guardarDescuentoProducto(pvId, null);
    expect(r.ok).toBe(true);
    expect(r.mensaje).toMatch(/no tenía descuento/);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "DescuentoProductoSucursal" } })).toBe(0);
  });

  it("rechaza un % fuera de rango o con formato inválido sin escribir nada", async () => {
    for (const malo of [100, 150, -5, "abc", Infinity]) {
      expect((await guardarDescuentoProducto(pvId, malo as number | string)).ok, String(malo)).toBe(false);
    }
    expect(await prisma.descuentoProductoSucursal.count()).toBe(0);
  });

  it("solo un PV: rechaza una MP y un producto inexistente", async () => {
    expect(await guardarDescuentoProducto(mpId, 10)).toMatchObject({ ok: false, mensaje: expect.stringMatching(/producto de venta/) });
    expect(await guardarDescuentoProducto("no-existe", 10)).toMatchObject({ ok: false, mensaje: "No se encontró el producto." });
    expect(await prisma.descuentoProductoSucursal.count()).toBe(0);
  });

  it("es POR SUCURSAL: el de una sucursal no toca a la otra", async () => {
    await guardarDescuentoProducto(pvId, 15);
    expect([...(await descuentosDeProductoEnSucursal(sucursalId, prisma))]).toEqual([[pvId, 15]]);
    expect((await descuentosDeProductoEnSucursal(otraSucursalId, prisma)).size).toBe(0);
    expect(await productoTieneDescuentoEnAlgunaSucursal(pvId, prisma)).toBe(true);
    expect(await productoTieneDescuentoEnAlgunaSucursal(pv2Id, prisma)).toBe(false);
  });

  it("audita el alta, el cambio y la baja con valor anterior y nuevo", async () => {
    await guardarDescuentoProducto(pvId, 15);
    await guardarDescuentoProducto(pvId, 25);
    await guardarDescuentoProducto(pvId, null);
    const registros = await prisma.registroAuditoria.findMany({ where: { entidad: "DescuentoProductoSucursal" }, orderBy: { creadoEn: "asc" } });
    expect(registros.map((r) => [r.campo, r.valorAnterior, r.valorNuevo])).toEqual([
      ["porcentaje", null, "15"],
      ["porcentaje", "15", "25"],
      ["porcentaje", "25", null],
    ]);
    expect(registros[0]).toMatchObject({ actorId: adminId, sucursalId, descripcion: 'Descuento de "Bife de chorizo"' });
  });

  it("un producto que es opción de un ítem agrupado no admite descuento, y al revés: un producto con descuento no entra a un agrupado", async () => {
    const agrupado = await guardarItemAgrupadoCarta({ nombre: "Platos agrupados", seccionCartaId: seccionId });
    const agrupadoId = agrupado.ok ? agrupado.id : "";
    expect(agrupado.ok).toBe(true);

    // Camino 1: PV ya con descuento → no se puede agrupar.
    await guardarDescuentoProducto(pv2Id, 10);
    const rechazada = await agregarOpcionItemAgrupadoCarta(agrupadoId, pv2Id);
    expect(rechazada.ok).toBe(false);
    expect(rechazada.mensaje).toMatch(/tiene descuento/);
    expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(0);

    // Camino 2: PV agrupado → no se le puede poner descuento.
    expect((await agregarOpcionItemAgrupadoCarta(agrupadoId, pvId)).ok).toBe(true);
    const r = await guardarDescuentoProducto(pvId, 10);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/opción del ítem agrupado/);
    expect(await prisma.descuentoProductoSucursal.count({ where: { productoId: pvId } })).toBe(0);
  });

  it("la carta pública muestra el precio descontado y el de lista (redondeo a centavos), y un producto sin descuento queda igual que antes", async () => {
    await guardarDescuentoProducto(pv2Id, 15);
    const carta = (await resolverMenuCarta(sucursalId, prisma))!;
    const items = carta.secciones.flatMap((s) => s.items);
    const flan = items.find((i) => i.nombre === "Flan")!;
    expect(flan.precio).toBe(1049.37); // 1234,55 × 0,85 = 1049,3675
    expect(flan).toMatchObject({ precioLista: 1234.55, descuentoPorcentaje: 15 });
    const bife = items.find((i) => i.nombre === "Bife de chorizo")!;
    expect(bife.precio).toBe(34000);
    expect(bife).not.toHaveProperty("precioLista");
    expect(bife).not.toHaveProperty("descuentoPorcentaje");
  });

  it("el descuento de una sucursal no aparece en la carta de la otra", async () => {
    await guardarDescuentoProducto(pv2Id, 15);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursalId, productoId: pv2Id, disponible: true } });
    const cartaOtra = (await resolverMenuCarta(otraSucursalId, prisma))!;
    const flan = cartaOtra.secciones.flatMap((s) => s.items).find((i) => i.nombre === "Flan")!;
    expect(flan.precio).toBe(1234.55);
    expect(flan).not.toHaveProperty("precioLista");
  });

  it("sin el permiso `carta_producto_descuento` (el operador no lo tiene) no escribe", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: operadorRolId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const r = await guardarDescuentoProducto(pvId, 15);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect(await prisma.descuentoProductoSucursal.count()).toBe(0);
  });
});

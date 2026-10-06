import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarSalon } from "./salon-fixture";
import { abrirCuenta } from "../../src/server/actions/pos/cuenta-apertura";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";
import { guardarDescuentoProducto } from "../../src/server/actions/carta/descuento-producto";
import { resolverMenuCarta } from "../../src/core/carta/menu-consulta";
import { cargarAdminCarta } from "../../src/core/carta/admin-consulta";
import { cargarSelectorCartaPos } from "../../src/core/pos/selector-carta-consulta";
import { cargarPromoCartaParaAgregar } from "../../src/core/pos/promo-combo-consulta";
import { descuentosConfiguradosEnSucursal } from "../../src/core/carta/descuento-producto-consulta";
import { descuentosDeProductoEnSucursal } from "../../src/core/carta/public-servidor";
import { precioLocalActivoEn } from "../../src/core/catalogo/public-servidor";

/**
 * R1 (decisión del dueño, 2026-10-01), contra Postgres real: apagar la capacidad `precio_local` de la sucursal hace que NO rijan ni el precio
 * local de las promos ni el descuento de los productos de esa sucursal — rige el precio de la empresa — en TODOS los lectores (carta pública,
 * selector del POS, alta de la promo, alta de ítems a la cuenta, admin). Lo configurado no se borra: al reactivar la capacidad vuelve a regir.
 */
describe("R1: apagar precio_local desactiva el precio local de la promo y el descuento de producto", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let seccionId: string;
  let promoId: string;

  async function fijarCapacidad(habilitado: boolean) {
    const existente = await prisma.capacidadSucursal.findFirst({ where: { accionClave: "precio_local", sucursalId: s.sucursalId } });
    if (existente) await prisma.capacidadSucursal.update({ where: { id: existente.id }, data: { habilitado } });
    else await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId: s.sucursalId, habilitado } });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Postres", orden: 1 } })).id;
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.flan.id, visibleEnCarta: true, seccionCartaId: seccionId } });
    promoId = (await prisma.promoCarta.create({ data: { seccionCartaId: seccionId, titulo: "Combo flan", precio: 25000, sucursales: { create: { sucursalId: s.sucursalId, precioLocal: 22000 } } } })).id;
    await prisma.promoCartaCupo.create({ data: { promoCartaId: promoId, seccionCartaId: seccionId, cantidadMinima: 1, cantidadMaxima: 1 } });
    expect((await guardarDescuentoProducto(s.flan.id, 15)).ok).toBe(true);
  });

  const precioPromoEnCartaPublica = async () => (await resolverMenuCarta(s.sucursalId, prisma))!.secciones.flatMap((sec) => sec.promos).find((p) => p.titulo === "Combo flan")?.precio;
  const precioPromoEnSelector = async () => {
    const selector = await cargarSelectorCartaPos(s.sucursalId, prisma);
    const promo = selector.seccionesCarta.flatMap((sec) => sec.entradas).find((e) => e.tipo === "promo");
    return promo?.tipo === "promo" ? promo.precio : undefined;
  };
  const precioFlanEnSelector = async () => {
    const selector = await cargarSelectorCartaPos(s.sucursalId, prisma);
    const flan = selector.seccionesCarta.flatMap((sec) => sec.entradas.flatMap((e) => (e.tipo === "producto" ? [e.producto] : []))).find((p) => p.productoId === s.flan.id)!;
    return { precio: flan.precio, precioLista: flan.precioLista ?? null };
  };
  const precioFlanEnCartaPublica = async () => {
    const item = (await resolverMenuCarta(s.sucursalId, prisma))!.secciones.flatMap((sec) => sec.items).find((i) => i.nombre === "Flan")!;
    return { precio: item.precio, descuentoPorcentaje: item.descuentoPorcentaje ?? null };
  };

  it("con la capacidad prendida (o sin fila) rigen el precio local de la promo y el descuento", async () => {
    expect(await precioLocalActivoEn(s.sucursalId, prisma)).toBe(true);
    expect(await precioPromoEnCartaPublica()).toBe(22000);
    expect(await precioPromoEnSelector()).toBe(22000);
    expect((await cargarPromoCartaParaAgregar(s.sucursalId, promoId, prisma))?.precio).toBe(22000);
    expect(await precioFlanEnSelector()).toEqual({ precio: 2550, precioLista: 3000 });
    expect((await descuentosDeProductoEnSucursal(s.sucursalId, prisma)).get(s.flan.id)).toBe(15);
  });

  it("con la capacidad apagada, todos los lectores dan el precio de la empresa para la promo y el precio de lista para el producto", async () => {
    await fijarCapacidad(false);

    expect(await precioLocalActivoEn(s.sucursalId, prisma)).toBe(false);
    expect(await precioPromoEnCartaPublica()).toBe(25000);
    expect(await precioPromoEnSelector()).toBe(25000);
    expect((await cargarPromoCartaParaAgregar(s.sucursalId, promoId, prisma))?.precio).toBe(25000);
    expect(await precioFlanEnSelector()).toEqual({ precio: 3000, precioLista: null });
    expect(await precioFlanEnCartaPublica()).toMatchObject({ precio: 3000, descuentoPorcentaje: null });
    expect((await descuentosDeProductoEnSucursal(s.sucursalId, prisma)).size).toBe(0);
  });

  it("agregar a la cuenta con la capacidad apagada cobra el precio de lista (sin descuento) y no guarda precio de lista aparte", async () => {
    await fijarCapacidad(false);
    expect((await abrirCuenta(s.mesa.id, 2)).ok).toBe(true);
    const cuenta = await prisma.cuenta.findFirstOrThrow({ where: { mesaId: s.mesa.id, cerradaEn: null } });
    expect((await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }])).ok).toBe(true);
    const [flan] = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    expect(Number(flan.precioUnitario)).toBe(3000);
    expect(flan.precioCartaUnitario).toBeNull();
  });

  it("el admin sigue viendo lo configurado (el % y el precio local) y se entera de que no rigen; el precio que rige es el de la empresa", async () => {
    await fijarCapacidad(false);
    const admin = await cargarAdminCarta(s.sucursalId, prisma);
    expect(admin.precioLocalActivo).toBe(false);
    expect(admin.productos.find((p) => p.id === s.flan.id)?.descuento).toBe(15);
    const promo = admin.promos.find((p) => p.id === promoId)!;
    expect(promo.precioLocal).toBe(22000);
    expect(promo.precioAca).toBe(25000);
    expect((await descuentosConfiguradosEnSucursal(s.sucursalId, prisma)).get(s.flan.id)).toBe(15);
  });

  it("no se borra nada: al reactivar la capacidad vuelven a regir el precio local de la promo y el descuento", async () => {
    await fijarCapacidad(false);
    expect(await precioPromoEnCartaPublica()).toBe(25000);
    expect(await prisma.promoCartaSucursal.count({ where: { promoCartaId: promoId, precioLocal: 22000 } })).toBe(1);
    expect(await prisma.descuentoProductoSucursal.count({ where: { productoId: s.flan.id } })).toBe(1);

    await fijarCapacidad(true);

    expect(await precioPromoEnCartaPublica()).toBe(22000);
    expect(await precioFlanEnSelector()).toEqual({ precio: 2550, precioLista: 3000 });
    expect((await cargarAdminCarta(s.sucursalId, prisma)).precioLocalActivo).toBe(true);
  });

  it("es por sucursal: apagarla en otra sucursal no cambia esta", async () => {
    const otra = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId: otra, habilitado: false } });
    expect(await precioLocalActivoEn(otra, prisma)).toBe(false);
    expect(await precioLocalActivoEn(s.sucursalId, prisma)).toBe(true);
    expect(await precioPromoEnCartaPublica()).toBe(22000);
  });
});

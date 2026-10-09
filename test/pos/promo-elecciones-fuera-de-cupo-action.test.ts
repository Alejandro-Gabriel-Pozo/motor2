import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarSalon } from "./salon-fixture";
import { abrirCuenta } from "../../src/server/actions/pos/cuenta-apertura";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";

/**
 * S-01 (O.50), tanda T1 del plan de endurecimiento de seguridad: el ATAQUE de punta a punta contra `agregarItems`. Cualquiera con `pos_tomar_pedido` (un
 * mozo) podía agregar a una promo elecciones de secciones que no son cupos, o una sección repetida, con cualquier producto de la empresa (una MP, un
 * producto no disponible en la sucursal) y que cada unidad saliera a $0,01: `validarEleccionPromo` solo miraba los CUPOS, pero el caso de uso aplanaba
 * TODAS las elecciones recibidas. Esperado: PROMO_INVALIDA, cero `PromoCuenta` y cero `CuentaItem`.
 */
describe("S-01: agregarItems rechaza las elecciones de una promo fuera de sus cupos", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let seccionPlatosId: string;
  let seccionPostresId: string;
  let seccionOtraId: string;
  let promoCartaId: string;
  let cuentaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);

    const [platos, postres, otra] = await Promise.all([
      prisma.seccionCarta.create({ data: { nombre: "Platos" } }),
      prisma.seccionCarta.create({ data: { nombre: "Postres" } }),
      prisma.seccionCarta.create({ data: { nombre: "Otra sección" } }),
    ]);
    seccionPlatosId = platos.id;
    seccionPostresId = postres.id;
    seccionOtraId = otra.id;
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.milanesa.id, visibleEnCarta: true, seccionCartaId: seccionPlatosId } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.flan.id, visibleEnCarta: true, seccionCartaId: seccionPostresId } });

    // Menú del día a $10000: cupo Platos 1..2 y cupo Postres 1..1.
    const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccionPlatosId, titulo: "Menú del día", precio: 10000 } });
    promoCartaId = promo.id;
    await prisma.promoCartaCupo.createMany({
      data: [
        { promoCartaId, seccionCartaId: seccionPlatosId, cantidadMinima: 1, cantidadMaxima: 2, orden: 0 },
        { promoCartaId, seccionCartaId: seccionPostresId, cantidadMinima: 1, cantidadMaxima: 1, orden: 1 },
      ],
    });

    await abrirCuenta(s.mesa.id, 2);
    cuentaId = (await prisma.cuenta.findFirstOrThrow({ where: { mesaId: s.mesa.id, cerradaEn: null } })).id;
  });

  const platosValido = () => ({ seccionCartaId: seccionPlatosId, elegidos: [{ productoId: s.milanesa.id, cantidad: 1 }] });
  const postresValido = () => ({ seccionCartaId: seccionPostresId, elegidos: [{ productoId: s.flan.id, cantidad: 1 }] });

  async function nadaEscrito() {
    expect(await prisma.promoCuenta.count()).toBe(0);
    expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(0);
  }

  it("control: la elección completa y dentro de los cupos se agrega, con el precio de la promo", async () => {
    const r = await agregarItems(cuentaId, [], [{ promoCartaId, elecciones: [platosValido(), postresValido()] }]);
    expect(r.ok).toBe(true);
    expect(await prisma.promoCuenta.count({ where: { cuentaId } })).toBe(1);
    expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(2);
  });

  it("ataque 1: una elección extra de una sección que NO es cupo, con 30 unidades de una MP, se rechaza sin escribir nada", async () => {
    const r = await agregarItems(cuentaId, [], [{ promoCartaId, elecciones: [platosValido(), postresValido(), { seccionCartaId: seccionOtraId, elegidos: [{ productoId: s.muzzarella.id, cantidad: 30 }] }] }]);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("Menú del día");
    await nadaEscrito();
  });

  it("ataque 1b: la elección extra puede ser de un producto de venta de la empresa que no está en ningún cupo (una pizza, una sección ajena)", async () => {
    const r = await agregarItems(cuentaId, [], [{ promoCartaId, elecciones: [platosValido(), postresValido(), { seccionCartaId: seccionOtraId, elegidos: [{ productoId: s.pizza.id, cantidad: 5 }] }] }]);
    expect(r.ok).toBe(false);
    await nadaEscrito();
  });

  it("ataque 2: la MISMA sección repetida (la primera con 30 de una MP, la segunda válida) se rechaza sin escribir nada", async () => {
    const r = await agregarItems(cuentaId, [], [
      {
        promoCartaId,
        elecciones: [{ seccionCartaId: seccionPlatosId, elegidos: [{ productoId: s.muzzarella.id, cantidad: 30 }] }, platosValido(), postresValido()],
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("Menú del día");
    await nadaEscrito();
  });

  it("un producto repetido dentro del mismo cupo se rechaza sin escribir nada", async () => {
    const r = await agregarItems(cuentaId, [], [
      { promoCartaId, elecciones: [{ seccionCartaId: seccionPlatosId, elegidos: [{ productoId: s.milanesa.id, cantidad: 1 }, { productoId: s.milanesa.id, cantidad: 1 }] }, postresValido()] },
    ]);
    expect(r.ok).toBe(false);
    await nadaEscrito();
  });

  it("un producto de venta NO disponible en la sucursal, aunque esté en la sección del cupo, se rechaza sin escribir nada", async () => {
    const noDisponible = await prisma.producto.create({ data: { codigo: "PV_NODISP", nombre: "Lasaña", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 8000 } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: noDisponible.id, visibleEnCarta: true, seccionCartaId: seccionPlatosId } });
    const r = await agregarItems(cuentaId, [], [{ promoCartaId, elecciones: [{ seccionCartaId: seccionPlatosId, elegidos: [{ productoId: noDisponible.id, cantidad: 1 }] }, postresValido()] }]);
    expect(r.ok).toBe(false);
    await nadaEscrito();
  });

  it("una MP elegida DENTRO del cupo correcto (no es un producto de venta, no es elegible) se rechaza sin escribir nada", async () => {
    const r = await agregarItems(cuentaId, [], [{ promoCartaId, elecciones: [{ seccionCartaId: seccionPlatosId, elegidos: [{ productoId: s.muzzarella.id, cantidad: 1 }] }, postresValido()] }]);
    expect(r.ok).toBe(false);
    await nadaEscrito();
  });

  it("la forma rota (elegidos que no es lista, productoId que no es texto, cantidad que no es número) se rechaza sin escribir nada", async () => {
    const rotas: unknown[] = [
      { seccionCartaId: seccionOtraId, elegidos: { productoId: s.muzzarella.id, cantidad: 30 } },
      { seccionCartaId: seccionOtraId, elegidos: [{ productoId: { not: "x" }, cantidad: 30 }] },
      { seccionCartaId: seccionOtraId, elegidos: [{ productoId: s.muzzarella.id, cantidad: "30" }] },
      null,
    ];
    for (const rota of rotas) {
      const r = await agregarItems(cuentaId, [], [{ promoCartaId, elecciones: [platosValido(), postresValido(), rota] }] as unknown as Parameters<typeof agregarItems>[2]);
      expect(r.ok).toBe(false);
    }
    await nadaEscrito();
  });
});

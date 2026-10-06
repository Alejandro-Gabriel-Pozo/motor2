import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarSalon } from "../pos/salon-fixture";
import { abrirCuenta, asignarClienteACuenta } from "../../src/server/actions/pos/cuenta-apertura";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { anularItemEnviado } from "../../src/server/actions/pos/cuenta-anulacion";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { guardarDescuentoProducto } from "../../src/server/actions/carta/descuento-producto";
import { altaCliente } from "../../src/server/actions/clientes/cliente";
import { obtenerReporteDescuentosProductos } from "../../src/server/consultas/reportes/descuentos-productos";

/**
 * Reporte de descuentos de productos (Fase 2): contra Postgres real y con las acciones reales del POS. El ahorro es lista − cobrado sobre los
 * sueltos con descuento de producto ya vendidos y no anulados; con un cliente con descuento rige solo el mayor, y si ganó el del cliente la venta
 * es del reporte «Descuentos por cliente», no de este.
 */
describe("obtenerReporteDescuentosProductos", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  const desde = new Date("2000-01-01");
  const hasta = new Date("2100-01-01");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const abrir = async () => {
    expect((await abrirCuenta(s.mesa.id, 2)).ok).toBe(true);
    return prisma.cuenta.findFirstOrThrow({ where: { mesaId: s.mesa.id, cerradaEn: null } });
  };
  const enviarTodo = async (cuentaId: string) => {
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId, numeroEnvio: null } });
    expect((await enviarACocina(cuentaId, items.map((i) => i.id))).ok).toBe(true);
  };
  const vender = async (items: { productoId: string; cantidad: number }[], clientePct?: number) => {
    const cuenta = await abrir();
    if (clientePct !== undefined) {
      const c = await altaCliente(`Cliente ${clientePct}`, clientePct);
      if (!c.ok) throw new Error(c.mensaje);
      await asignarClienteACuenta(cuenta.id, c.id);
    }
    expect((await agregarItems(cuenta.id, items)).ok).toBe(true);
    await enviarTodo(cuenta.id);
    return cuenta;
  };
  const reporte = (sucursalId = s.sucursalId, d = desde, h = hasta) => obtenerReporteDescuentosProductos(sucursalId, d, h, prisma);

  it("sin ninguna venta con descuento de producto: reporte vacío", async () => {
    expect(await reporte()).toEqual({ desde, hasta, importeALista: 0, importeCobrado: 0, ahorro: 0, descuentoEfectivoPct: null, productos: [] });
  });

  it("una venta con descuento: unidades, importe a lista, cobrado y ahorro exactos", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await vender([{ productoId: s.flan.id, cantidad: 2 }]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    const rep = await reporte();
    expect(rep).toMatchObject({ importeALista: 6000, importeCobrado: 5100, ahorro: 900, descuentoEfectivoPct: 15 });
    expect(rep.productos).toEqual([
      { productoId: s.flan.id, codigo: "PV_FLAN", producto: "Flan", unidades: 2, importeALista: 6000, importeCobrado: 5100, ahorro: 900, descuentoEfectivoPct: 15 },
    ]);
  });

  it("un producto sin descuento no aparece, y los productos se ordenan por ahorro", async () => {
    await guardarDescuentoProducto(s.flan.id, 10); // 3000 → 300 por unidad
    await guardarDescuentoProducto(s.milanesa.id, 10); // 9000 → 900 por unidad
    const cuenta = await vender([
      { productoId: s.flan.id, cantidad: 1 },
      { productoId: s.milanesa.id, cantidad: 1 },
      { productoId: s.pizza.id, cantidad: 1 },
    ]);
    await cerrarCuenta(cuenta.id);
    const rep = await reporte();
    expect(rep.productos.map((p) => [p.producto, p.ahorro])).toEqual([["Milanesa", 900], ["Flan", 300]]);
    expect(rep.ahorro).toBe(1200);
  });

  it("una anulación parcial de lo enviado resta su parte del ahorro", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await vender([{ productoId: s.flan.id, cantidad: 2 }]);
    const [item] = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    expect((await anularItemEnviado(item.id, 1, "se equivocó", 2)).ok).toBe(true);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    const [fila] = (await reporte()).productos;
    expect(fila).toMatchObject({ unidades: 1, importeALista: 3000, importeCobrado: 2550, ahorro: 450 });
  });

  it("una venta anulada entera no cuenta", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await vender([{ productoId: s.flan.id, cantidad: 1 }]);
    await cerrarCuenta(cuenta.id);
    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" } });
    expect((await anularVenta(venta.id)).ok).toBe(true);
    expect((await reporte()).productos).toEqual([]);
  });

  it("con un cliente de MAYOR descuento la venta es del reporte de clientes: no cuenta acá", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await vender([{ productoId: s.flan.id, cantidad: 1 }], 20);
    await cerrarCuenta(cuenta.id);
    expect((await reporte()).productos).toEqual([]);
  });

  it("con un cliente de MENOR descuento gana el producto y la venta cuenta acá", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await vender([{ productoId: s.flan.id, cantidad: 1 }], 10);
    await cerrarCuenta(cuenta.id);
    expect((await reporte()).productos).toMatchObject([{ producto: "Flan", ahorro: 450 }]);
  });

  it("una cuenta todavía abierta (sin cerrar) no cuenta", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    await vender([{ productoId: s.flan.id, cantidad: 1 }]);
    expect((await reporte()).productos).toEqual([]);
  });

  it("es por sucursal: otra sucursal no ve estas ventas", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await vender([{ productoId: s.flan.id, cantidad: 1 }]);
    await cerrarCuenta(cuenta.id);
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    expect((await reporte(otra.id)).productos).toEqual([]);
    expect((await reporte()).productos).toHaveLength(1);
  });

  it("fuera del rango de fechas: no aparece", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await vender([{ productoId: s.flan.id, cantidad: 1 }]);
    await cerrarCuenta(cuenta.id);
    expect((await reporte(s.sucursalId, new Date("2000-01-01"), new Date("2001-01-01"))).productos).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { registrarPagoConsignante } from "../../src/server/actions/reportes/consignacion";
import { generarReporteConsignacion } from "../../src/core/reportes/consignacion";

describe("generarReporteConsignacion", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let rolOperadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    rolOperadorId = base.operador.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("detecta cuánto se le debe a cada consignante y cuánto stock en consignación queda sin vender", async () => {
    const consignante = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Vinos del Valle" } });
    const mp = await sembrarProductoDisponible(
      {
        codigo: "MP_VINO", nombre: "Vino en consignación", tipo: "MP", unidadStockId: unidadKgId, insumoId,
        esConsignacion: true, proveedorConsignacionId: consignante.id, precioConsignacion: 20,
      },
      sucursalId
    );
    const pv = await sembrarProductoDisponible({ codigo: "PV_COPA", nombre: "Copa de vino", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 50 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId: consignante.id, items: [{ productoId: mp.id, cantidad: 10 }] }); // recepción sin costo real
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 3 }] });

    const rep = await generarReporteConsignacion(sucursalId);
    expect(rep.debidoPorConsignante.find((d) => d.proveedor === "Vinos del Valle")?.importe).toBe(3 * 20);
    expect(rep.stockSinVender.find((s) => s.productoId === mp.id)?.stockActual).toBe(7);
  });

  async function armarConsignanteConDeuda(importeLiquidado: number) {
    const consignante = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Vinos del Valle" } });
    const mp = await sembrarProductoDisponible(
      {
        codigo: "MP_VINO", nombre: "Vino en consignación", tipo: "MP", unidadStockId: unidadKgId, insumoId,
        esConsignacion: true, proveedorConsignacionId: consignante.id, precioConsignacion: 20,
      },
      sucursalId
    );
    const pv = await sembrarProductoDisponible({ codigo: "PV_COPA", nombre: "Copa de vino", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 50 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId: consignante.id, items: [{ productoId: mp.id, cantidad: 10 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: importeLiquidado / 20 }] });
    return consignante;
  }

  describe("registrarPagoConsignante", () => {
    it("un pago reduce el saldo debido — antes de esto, el saldo solo podía crecer (hallazgo de la auditoría)", async () => {
      const consignante = await armarConsignanteConDeuda(60);

      const resultado = await registrarPagoConsignante(consignante.id, 40, new Date());
      expect(resultado.ok, resultado.mensaje).toBe(true);

      const rep = await generarReporteConsignacion(sucursalId);
      const fila = rep.debidoPorConsignante.find((d) => d.proveedorId === consignante.id);
      expect(fila?.liquidado).toBe(60);
      expect(fila?.pagado).toBe(40);
      expect(fila?.importe).toBe(20);
    });

    it("varios pagos parciales pueden saldar el total", async () => {
      const consignante = await armarConsignanteConDeuda(60);
      await registrarPagoConsignante(consignante.id, 40, new Date());
      await registrarPagoConsignante(consignante.id, 20, new Date());

      const rep = await generarReporteConsignacion(sucursalId);
      expect(rep.debidoPorConsignante.find((d) => d.proveedorId === consignante.id)?.importe).toBe(0);
    });

    it("rechaza un importe que no sea mayor a 0", async () => {
      const consignante = await armarConsignanteConDeuda(60);
      const resultado = await registrarPagoConsignante(consignante.id, 0, new Date());
      expect(resultado.ok).toBe(false);
    });

    it("rechaza un importe negativo", async () => {
      const consignante = await armarConsignanteConDeuda(60);
      const resultado = await registrarPagoConsignante(consignante.id, -40, new Date());
      expect(resultado.ok).toBe(false);
      expect(resultado.mensaje).toBe("El importe no puede ser negativo.");
    });

    it("rechaza un importe que no es un número (NaN)", async () => {
      const consignante = await armarConsignanteConDeuda(60);
      const resultado = await registrarPagoConsignante(consignante.id, Number.NaN, new Date());
      expect(resultado.ok).toBe(false);
    });

    // Antes de usar validarImporte, esto validaba a mano (!(importe > 0) + esNumeroFinito) sin el tope de
    // decimales ni el máximo del módulo central — un importe con más de 2 decimales pasaba esa validación
    // casera y podía fallar feo contra la columna Decimal en vez de dar este mensaje entendible.
    it("rechaza un importe con más de 2 decimales, con el mensaje de validarImporte", async () => {
      const consignante = await armarConsignanteConDeuda(60);
      const resultado = await registrarPagoConsignante(consignante.id, 40.123, new Date());
      expect(resultado.ok).toBe(false);
      expect(resultado.mensaje).toBe("El importe admite como máximo 2 decimales.");
    });

    it("rechaza un importe astronómicamente grande (tope de las columnas Decimal)", async () => {
      const consignante = await armarConsignanteConDeuda(60);
      const resultado = await registrarPagoConsignante(consignante.id, 1e13, new Date());
      expect(resultado.ok).toBe(false);
      expect(resultado.mensaje).toBe("El importe es demasiado grande.");
    });

    it("rechaza un proveedor inexistente", async () => {
      const resultado = await registrarPagoConsignante("no-existe", 10, new Date());
      expect(resultado.ok).toBe(false);
    });

    it("un operador (sin el permiso pagar_consignante) no puede registrar un pago", async () => {
      const consignante = await armarConsignanteConDeuda(60);
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: rolOperadorId });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });

      const resultado = await registrarPagoConsignante(consignante.id, 10, new Date());
      expect(resultado.ok).toBe(false);
    });
  });

  describe("filtro de período", () => {
    it("sin filtro, el saldo es el acumulado de siempre — filtrando por un período sin movimiento, no hay filas", async () => {
      const consignante = await armarConsignanteConDeuda(60);
      await registrarPagoConsignante(consignante.id, 20, new Date());

      const haceUnAño = new Date();
      haceUnAño.setFullYear(haceUnAño.getFullYear() - 1);
      const repFiltrado = await generarReporteConsignacion(sucursalId, undefined, { desde: haceUnAño, hasta: haceUnAño });
      expect(repFiltrado.debidoPorConsignante.find((d) => d.proveedorId === consignante.id)).toBeUndefined();

      const repSinFiltro = await generarReporteConsignacion(sucursalId);
      expect(repSinFiltro.debidoPorConsignante.find((d) => d.proveedorId === consignante.id)?.importe).toBe(40);
    });
  });
});

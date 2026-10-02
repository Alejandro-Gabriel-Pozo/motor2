import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { altaProveedor, actualizarProveedor } from "../../src/server/actions/catalogo/proveedores";
import { darDeAltaProducto } from "../../src/server/actions/catalogo/productos";
import { setFrecuenciaConteo } from "../../src/server/actions/stock/frecuencia-conteo";
import { setStockMinimoProducto } from "../../src/server/actions/stock/stock-minimo";
import { guardarItemAgrupadoCarta } from "../../src/server/actions/carta/items-agrupados";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { ENTERO_MAXIMO_RAZONABLE, LARGO_MAXIMO_DETALLE, LARGO_MAXIMO_NOTAS, MAXIMO_LINEAS_POR_OPERACION, MAXIMO_PRODUCTOS_POR_ITEM_AGRUPADO, STOCK_MINIMO_MAXIMO } from "../../src/core/datos/limites";

const largo = (n: number) => "x".repeat(n);

describe("Topes de entrada de las Server Actions (S-22/S-23/S-29)", () => {
  let mpId: string;
  let seccionId: string;
  let unidadId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(base.sucursal.id)).id;
    unidadId = catalogo.kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    mpId = (await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Sal", tipo: "MP", unidadStockId: unidadId, insumoId: catalogo.insumo.id } })).id;
  });

  describe("proveedores (S-22)", () => {
    it("el alta rechaza un email sin formato y los textos largos, y no crea nada", async () => {
      expect((await altaProveedor({ nombre: "P1", email: "no-es-un-mail" })).ok).toBe(false);
      expect((await altaProveedor({ nombre: "P1", notas: largo(LARGO_MAXIMO_NOTAS + 1) })).ok).toBe(false);
      expect((await altaProveedor({ nombre: "P1", contacto: largo(500) })).ok).toBe(false);
      expect(await prisma.proveedor.count()).toBe(0);
    });

    it("la edición rechaza lo mismo y deja el proveedor intacto; un valor válido se recorta y vacío → null", async () => {
      const creado = await altaProveedor({ nombre: "P2", email: "a@b.com", notas: "ok" });
      if (!creado.ok) throw new Error("esperaba ok");
      expect((await actualizarProveedor(creado.id, { email: "x@@y" })).ok).toBe(false);
      expect((await actualizarProveedor(creado.id, { notas: largo(LARGO_MAXIMO_NOTAS + 1) })).ok).toBe(false);
      expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: creado.id } })).email).toBe("a@b.com");
      expect((await actualizarProveedor(creado.id, { email: "  c@d.com  ", notas: "   " })).ok).toBe(true);
      const p = await prisma.proveedor.findUniqueOrThrow({ where: { id: creado.id } });
      expect(p.email).toBe("c@d.com");
      expect(p.notas).toBeNull();
    });
  });

  it("producto: observaciones largas se rechazan (S-22)", async () => {
    const r = await darDeAltaProducto({ nombre: "Pan", tipo: "MP", unidadStockId: unidadId, factorConversion: 1, observaciones: largo(LARGO_MAXIMO_NOTAS + 1) });
    expect(r.ok).toBe(false);
    expect(await prisma.producto.count({ where: { nombre: "Pan" } })).toBe(0);
  });

  it("frecuencia de conteo: tope por encima de la columna Int (S-23)", async () => {
    expect((await setFrecuenciaConteo(mpId, ENTERO_MAXIMO_RAZONABLE + 1)).ok).toBe(false);
    expect((await setFrecuenciaConteo(mpId, 2_147_483_647)).ok).toBe(false);
    expect((await setFrecuenciaConteo(mpId, ENTERO_MAXIMO_RAZONABLE)).ok).toBe(true);
  });

  it("stock mínimo: tope por encima de Decimal(14,4) (S-23)", async () => {
    expect((await setStockMinimoProducto(mpId, STOCK_MINIMO_MAXIMO + 1)).ok).toBe(false);
    expect((await setStockMinimoProducto(mpId, 1e15)).ok).toBe(false);
    expect((await setStockMinimoProducto(mpId, STOCK_MINIMO_MAXIMO)).ok).toBe(true);
  });

  it("ítem agrupado de carta: tope de productoIds en el alta (S-23)", async () => {
    const productoIds = Array.from({ length: MAXIMO_PRODUCTOS_POR_ITEM_AGRUPADO + 1 }, (_, i) => `p${i}`);
    const r = await guardarItemAgrupadoCarta({ nombre: "Gaseosa", seccionCartaId: "x", productoIds });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/no pueden ser más de/);
  });

  describe("venta y movimientos (S-22/S-23/S-29)", () => {
    it("venta: tope de líneas y de detalle, sin tocar la base", async () => {
      const ventas = Array(MAXIMO_LINEAS_POR_OPERACION + 1).fill({ productoId: mpId, cantidadVendida: 1 });
      expect((await registrarVenta({ fecha: new Date(), seccionId, ventas })).mensaje).toMatch(/no pueden ser más de/);
      const conDetalle = await registrarVenta({ fecha: new Date(), seccionId, detalle: largo(LARGO_MAXIMO_DETALLE + 1), ventas: [{ productoId: mpId, cantidadVendida: 1 }] });
      expect(conDetalle.mensaje).toMatch(/caracteres/);
      expect(await prisma.operacion.count()).toBe(0);
    });

    it("registrarMovimiento: un proceso 'constructor' se rechaza con el mensaje de proceso inválido", async () => {
      const r = await registrarMovimiento({ proceso: "constructor", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 1 }] } as never);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/no se registra con esta acción/);
    });

    it("registrarMovimiento: tope de líneas y de detalleLibre", async () => {
      const items = Array(MAXIMO_LINEAS_POR_OPERACION + 1).fill({ productoId: mpId, cantidad: 1 });
      expect((await registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId, items })).mensaje).toMatch(/no pueden ser más de/);
      const r = await registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId, detalleLibre: largo(LARGO_MAXIMO_DETALLE + 1), items: [{ productoId: mpId, cantidad: 1 }] });
      expect(r.mensaje).toMatch(/caracteres/);
      expect(await prisma.operacion.count()).toBe(0);
    });
  });
});

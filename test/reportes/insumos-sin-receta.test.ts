import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion, sembrarCompraDeKardex, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { generarReporteInsumosSinRecetaVinculada } from "../../src/server/consultas/reportes/insumos-sin-receta";

describe("generarReporteInsumosSinRecetaVinculada", () => {
  it("detecta la MP huérfana (sin ninguna receta) y excluye la que sí está vinculada", async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();

    const huerfana = await sembrarProductoDisponible({ codigo: "MP_HUERFANA", nombre: "Sin nadie que la use", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId);
    const vinculada = await sembrarProductoDisponible({ codigo: "MP_VINCULADA", nombre: "Harina de receta", tipo: "MP", unidadStockId: catalogo.kg.id }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: vinculada.id, cantidad: 1, unidadId: catalogo.kg.id }] } } });

    const filas = await generarReporteInsumosSinRecetaVinculada(sucursalId, prisma);
    expect(filas.map((f) => f.productoId)).toContain(huerfana.id);
    expect(filas.map((f) => f.productoId)).not.toContain(vinculada.id);
  });

  it("marca tieneProveedor según si hay alguna compra VIGENTE con proveedor en el Kardex (una anulada, o sin proveedor, no cuenta)", async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    const seccionId = (await sembrarSeccion(sucursalId)).id;
    const usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino" } });
    const mp = (codigo: string, nombre: string) => sembrarProductoDisponible({ codigo, nombre, tipo: "MP", unidadStockId: catalogo.kg.id }, sucursalId);
    const conProveedor = await mp("MP_1", "Con proveedor");
    const sinNada = await mp("MP_2", "Sin proveedor");
    const soloAnulada = await mp("MP_3", "Solo una compra anulada");
    const sinProveedorEnLaCompra = await mp("MP_4", "Comprada sin proveedor");
    const compra = (productoId: string, extra: { proveedorId?: string | null; anulada?: boolean }) =>
      sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId, productoId, proveedorId: proveedor.id, fecha: "2026-09-10", precioPorUnidadStock: 10, ...extra });
    await compra(conProveedor.id, {});
    await compra(soloAnulada.id, { anulada: true });
    await compra(sinProveedorEnLaCompra.id, { proveedorId: null });
    // La tabla `ProveedorPorProducto` ya NO manda: una fila suelta sin compra detrás no hace que el producto «tenga proveedor».
    await prisma.proveedorPorProducto.create({ data: { productoId: sinNada.id, proveedorId: proveedor.id, unidadCompraId: catalogo.kg.id, precioUnitario: 10, precioPorUnidadStock: 10 } });

    const filas = await generarReporteInsumosSinRecetaVinculada(sucursalId, prisma);
    const tiene = (id: string) => filas.find((f) => f.productoId === id)?.tieneProveedor;
    expect(tiene(conProveedor.id)).toBe(true);
    expect(tiene(sinNada.id)).toBe(false);
    expect(tiene(soloAnulada.id)).toBe(false);
    expect(tiene(sinProveedorEnLaCompra.id)).toBe(false);
  });

  it("una MP huérfana disponible solo en OTRA sucursal no aparece acá", async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const sucursalId = base.sucursal.id;
    const otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const catalogo = await sembrarCatalogoBase();

    const huerfana = await sembrarProductoDisponible({ codigo: "MP_OTRA", nombre: "Solo en otra", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, otraSucursalId);

    const filas = await generarReporteInsumosSinRecetaVinculada(sucursalId, prisma);
    expect(filas.map((f) => f.productoId)).not.toContain(huerfana.id);
  });
});

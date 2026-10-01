import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { generarReporteHuecosCatalogo, obtenerProblemasUnidadMezclada } from "../../src/core/reportes/huecos-catalogo";
import { requierePermisoVerDeEmpresa } from "../../src/core/permisos/gate";

describe("generarReporteHuecosCatalogo", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("detecta un PV disponible acá que nunca se vendió en esta sucursal", async () => {
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Nunca vendido", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    const rep = await generarReporteHuecosCatalogo(sucursalId, prisma);
    expect(rep.pvSinVentaNunca.map((p) => p.productoId)).toContain(pv.id);
  });

  it("un producto no disponible acá no aparece, aunque nunca se haya vendido", async () => {
    const otraSucursal = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const pv = await sembrarProductoDisponible({ codigo: "PV_0", nombre: "Solo en otra", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, otraSucursal);
    const rep = await generarReporteHuecosCatalogo(sucursalId, prisma);
    expect(rep.pvSinVentaNunca.map((p) => p.productoId)).not.toContain(pv.id);
  });

  it("un PV vendido no aparece en la lista", async () => {
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Vendido", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] });
    const rep = await generarReporteHuecosCatalogo(sucursalId, prisma);
    expect(rep.pvSinVentaNunca.map((p) => p.productoId)).not.toContain(pv.id);
  });

  it("detecta una MP vinculada a receta pero sin ningún proveedor cargado", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Sin proveedor", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });

    const rep = await generarReporteHuecosCatalogo(sucursalId, prisma);
    expect(rep.insumosConRecetaSinProveedor.map((p) => p.productoId)).toContain(mp.id);
  });

  it("una MP 'Se produce' sin proveedor NO aparece — se fabrica con su propia receta, nunca se compra (§8.7)", async () => {
    const mpProducida = await sembrarProductoDisponible(
      { codigo: "MP_2", nombre: "Prepizza masa", tipo: "MP", unidadStockId: unidadKgId, insumoId, seProduce: true },
      sucursalId
    );
    const pv = await sembrarProductoDisponible({ codigo: "PV_2", nombre: "Pizza", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpProducida.id, cantidad: 1, unidadId: unidadKgId }] } },
    });

    const rep = await generarReporteHuecosCatalogo(sucursalId, prisma);
    expect(rep.insumosConRecetaSinProveedor.map((p) => p.productoId)).not.toContain(mpProducida.id);
  });

  it("unidad mezclada respeta el permiso 'insumos_mezclados' (operador no puede verla)", async () => {
    const otroKg = await prisma.unidad.create({ data: { nombre: "kg2", magnitud: "PESO", decimales: 2 } });
    await prisma.producto.create({ data: { codigo: "MP_A", nombre: "Producto A", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    await prisma.producto.create({ data: { codigo: "MP_B", nombre: "Producto B", tipo: "MP", unidadStockId: otroKg.id, insumoId } });

    const problemas = await obtenerProblemasUnidadMezclada(prisma);
    expect(problemas.length).toBe(1);
    expect(problemas[0].unidades.length).toBe(2);

    const base = await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: (await prisma.rol.findFirstOrThrow({ where: { nombre: "operador" } })).id });
    const gate = await requierePermisoVerDeEmpresa(operador.id, base.empresaId, "insumos_mezclados", prisma);
    expect(gate.ok).toBe(false);
  });
});

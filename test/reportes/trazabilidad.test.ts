import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { obtenerOperacionPorId, buscarOperacionesPorProducto } from "../../src/core/reportes/trazabilidad";

describe("Trazabilidad", () => {
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

  it("obtenerOperacionPorId trae los movimientos de la operación, y nunca la de otra sucursal", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const resultado = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5 }] });
    expect(resultado.ok).toBe(true);
    const operacion = await prisma.operacion.findFirstOrThrow({ where: { sucursalId } });

    const traida = await obtenerOperacionPorId(sucursalId, operacion.id);
    expect(traida?.items.length).toBe(1);
    expect(traida?.items[0].productoNombre).toBe("Harina");

    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const noEncontrada = await obtenerOperacionPorId(otraSucursal.id, operacion.id);
    expect(noEncontrada).toBeNull();
  });

  it("buscarOperacionesPorProducto encuentra por nombre o código, sin duplicar operación", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_ESPECIAL", nombre: "Harina 000", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5 }] });

    const porNombre = await buscarOperacionesPorProducto(sucursalId, "harina 000");
    expect(porNombre.length).toBe(1);

    const porCodigo = await buscarOperacionesPorProducto(sucursalId, "MP_ESPECIAL");
    expect(porCodigo.length).toBe(1);
    expect(porCodigo[0].idOperacion).toBe(porNombre[0].idOperacion);
  });
});

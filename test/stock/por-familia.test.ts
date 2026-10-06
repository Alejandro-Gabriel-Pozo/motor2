import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularStockPorFamilia } from "../../src/server/consultas/stock/por-familia";

describe("calcularStockPorFamilia", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let unidadGId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    unidadGId = catalogo.g.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("agrupa el saldo de varios productos bajo el mismo Insumo", async () => {
    const insumo = await prisma.insumo.create({ data: { nombre: "Harina compartida" } });
    const a = await sembrarProductoDisponible({ codigo: "MP_A", nombre: "Harina Proveedor A", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumo.id }, sucursalId);
    const b = await sembrarProductoDisponible({ codigo: "MP_B", nombre: "Harina Proveedor B", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumo.id }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: a.id, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: b.id, cantidad: 5 }] });

    const filas = await calcularStockPorFamilia(sucursalId, prisma);
    const fila = filas.find((f) => f.insumoId === insumo.id);
    expect(fila?.saldo).toBe(15);
    expect(fila?.productos.sort()).toEqual(["Harina Proveedor A", "Harina Proveedor B"]);
  });

  it("un producto sin Insumo asignado queda afuera del reporte", async () => {
    const suelto = await sembrarProductoDisponible({ codigo: "MP_SUELTO", nombre: "Suelto", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: suelto.id, cantidad: 10 }] });

    const filas = await calcularStockPorFamilia(sucursalId, prisma);
    expect(filas.find((f) => f.productos.includes("Suelto"))).toBeUndefined();
  });

  it("marca unidadesMezcladas cuando dos productos del mismo Insumo tienen distinta unidad de stock", async () => {
    const insumo = await prisma.insumo.create({ data: { nombre: "Manteca" } });
    const enKg = await sembrarProductoDisponible({ codigo: "MP_KG", nombre: "Manteca en kg", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumo.id }, sucursalId);
    const enG = await sembrarProductoDisponible({ codigo: "MP_G", nombre: "Manteca en g", tipo: "MP", unidadStockId: unidadGId, insumoId: insumo.id }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: enKg.id, cantidad: 5 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: enG.id, cantidad: 500 }] });

    const filas = await calcularStockPorFamilia(sucursalId, prisma);
    const fila = filas.find((f) => f.insumoId === insumo.id);
    expect(fila?.unidadesMezcladas).toBe(true);
  });

  it("agrupa por Grupo (cadena de grupos) cuando el Insumo tiene uno asignado", async () => {
    const grupoPadre = await prisma.grupo.create({ data: { nombre: "Bebidas" } });
    const grupoHijo = await prisma.grupo.create({ data: { nombre: "Bebidas sin alcohol", grupoPadreId: grupoPadre.id } });
    const insumo = await prisma.insumo.create({ data: { nombre: "Coca", grupoId: grupoHijo.id } });
    const producto = await sembrarProductoDisponible({ codigo: "MP_COCA", nombre: "Coca 500ml", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumo.id }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: producto.id, cantidad: 20 }] });

    const filas = await calcularStockPorFamilia(sucursalId, prisma);
    const fila = filas.find((f) => f.insumoId === insumo.id);
    expect(fila?.grupoCadena).toBe("Bebidas > Bebidas sin alcohol");
  });
});

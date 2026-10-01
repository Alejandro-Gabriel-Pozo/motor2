import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarCambioAuditado, listarRegistrosAuditoria } from "../../src/core/permisos/auditoria";
import { actualizarProducto } from "../../src/server/actions/catalogo/productos";
import { setPrecioLocalProducto } from "../../src/server/actions/movimientos/precio-local";
import { guardarPermisos } from "../../src/server/actions/permisos/permisos";
import { actualizarCapacidad } from "../../src/server/actions/permisos/capacidades-sucursal";
import { crearRol, actualizarActivoRol } from "../../src/server/actions/permisos/roles";

describe("Auditoría administrativa (A3, Pivote 6)", () => {
  let sucursalId: string;
  let adminId: string;
  let adminRolId: string;
  let unidadKgId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminRolId = base.admin.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: adminRolId });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  describe("registrarCambioAuditado / listarRegistrosAuditoria (core)", () => {
    it("no crea ninguna fila si el valor no cambió", async () => {
      await registrarCambioAuditado(prisma, {
        entidad: "Producto", entidadId: "p1", campo: "precioVenta", descripcion: "test",
        valorAnterior: 100, valorNuevo: 100, actorId: adminId,
      });
      const { items } = await listarRegistrosAuditoria({ incluirFilasDeEmpresa: true, sucursalIds: [sucursalId] }, prisma);
      expect(items).toHaveLength(0);
    });

    it("crea una fila con antes/después cuando el valor cambia, y null se distingue de '0'", async () => {
      await registrarCambioAuditado(prisma, {
        entidad: "Producto", entidadId: "p1", campo: "precioVenta", descripcion: "Producto \"Pan\": precio de venta",
        valorAnterior: null, valorNuevo: 0, actorId: adminId,
      });
      const { items } = await listarRegistrosAuditoria({ incluirFilasDeEmpresa: true, sucursalIds: [sucursalId] }, prisma);
      expect(items).toHaveLength(1);
      expect(items[0]!.valorAnterior).toBeNull();
      expect(items[0]!.valorNuevo).toBe("0");
      expect(items[0]!.actor.email).toBe("admin@test.com");
    });

    it("filtra por entidad", async () => {
      await registrarCambioAuditado(prisma, { entidad: "Producto", entidadId: "p1", campo: "precioVenta", descripcion: "x", valorAnterior: 1, valorNuevo: 2, actorId: adminId });
      await registrarCambioAuditado(prisma, { entidad: "Rol", entidadId: "r1", campo: "activo", descripcion: "y", valorAnterior: true, valorNuevo: false, actorId: adminId });

      const { items } = await listarRegistrosAuditoria({ entidad: "Rol", incluirFilasDeEmpresa: true, sucursalIds: [sucursalId] }, prisma);
      expect(items).toHaveLength(1);
      expect(items[0]!.entidad).toBe("Rol");
    });
  });

  it("actualizarProducto registra el cambio de precioVenta con quién y los valores", async () => {
    const producto = await prisma.producto.create({
      data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 },
    });

    await actualizarProducto(producto.id, { nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1, precioVenta: 150 });

    const { items } = await listarRegistrosAuditoria({ entidad: "Producto", incluirFilasDeEmpresa: true, sucursalIds: [sucursalId] }, prisma);
    const registro = items.find((r) => r.campo === "precioVenta")!;
    expect(registro).toBeDefined();
    expect(registro.valorAnterior).toBe("100");
    expect(registro.valorNuevo).toBe("150");
    expect(registro.actorId).toBe(adminId);
  });

  it("actualizarProducto NO registra nada si el precio no cambió", async () => {
    const producto = await prisma.producto.create({
      data: { codigo: "PV_2", nombre: "Torta", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 200 },
    });

    await actualizarProducto(producto.id, { nombre: "Torta", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1, precioVenta: 200 });

    const { items } = await listarRegistrosAuditoria({ entidad: "Producto", incluirFilasDeEmpresa: true, sucursalIds: [sucursalId] }, prisma);
    expect(items).toHaveLength(0);
  });

  it("setPrecioLocalProducto registra precio y habilitado por separado", async () => {
    const producto = await prisma.producto.create({
      data: { codigo: "PV_3", nombre: "Empanada", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 50 },
    });

    await setPrecioLocalProducto(producto.id, 60, true);

    const { items } = await listarRegistrosAuditoria({ entidad: "PrecioLocalProducto", incluirFilasDeEmpresa: true, sucursalIds: [sucursalId] }, prisma);
    expect(items.map((r) => r.campo).sort()).toEqual(["habilitado", "precio"]);
    const precio = items.find((r) => r.campo === "precio")!;
    expect(precio.valorAnterior).toBeNull(); // no había fila previa
    expect(precio.valorNuevo).toBe("60");
    expect(precio.sucursalId).toBe(sucursalId);
  });

  it("guardarPermisos registra el cambio de puedeEditar/puedeVer para el rol", async () => {
    // admin arranca con proceso_venta habilitado (seed): se le deja solo «Ver».
    const r = await guardarPermisos([
      { rolId: adminRolId, accionClave: "proceso_venta", anterior: { puedeVer: true, puedeEditar: true }, nuevo: { puedeVer: true, puedeEditar: false } },
    ]);
    expect(r.ok, r.mensaje).toBe(true);

    const { items } = await listarRegistrosAuditoria({ entidad: "PermisoRol", incluirFilasDeEmpresa: true, sucursalIds: [sucursalId] }, prisma);
    const editar = items.find((r) => r.campo === "puedeEditar")!;
    expect(editar.valorAnterior).toBe("true"); // admin arranca con proceso_venta habilitado (seed)
    expect(editar.valorNuevo).toBe("false");
  });

  it("actualizarCapacidad registra el cambio de habilitado", async () => {
    await actualizarCapacidad("proceso_venta", null, false);

    const { items } = await listarRegistrosAuditoria({ entidad: "CapacidadSucursal", incluirFilasDeEmpresa: true, sucursalIds: [sucursalId] }, prisma);
    expect(items).toHaveLength(1);
    expect(items[0]!.valorAnterior).toBeNull(); // no había fila previa (default = habilitado)
    expect(items[0]!.valorNuevo).toBe("false");
  });

  it("actualizarActivoRol registra el cambio de activo", async () => {
    await crearRol("cajero");
    const rol = await prisma.rol.findFirstOrThrow({ where: { nombre: "cajero" } });

    await actualizarActivoRol(rol.id, false);

    const { items } = await listarRegistrosAuditoria({ entidad: "Rol", incluirFilasDeEmpresa: true, sucursalIds: [sucursalId] }, prisma);
    const registro = items.find((r) => r.entidadId === rol.id)!;
    expect(registro.valorAnterior).toBe("true");
    expect(registro.valorNuevo).toBe("false");
  });
});

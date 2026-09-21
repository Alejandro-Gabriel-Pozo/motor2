import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivoProducto } from "../../src/server/actions/catalogo/productos";

describe("actualizarActivoProducto", () => {
  let sucursalId: string;
  let productoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const producto = await prisma.producto.create({
      data: { codigo: "PV_ACTIVAR", nombre: "Pizza Activar", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 },
    });
    productoId = producto.id;
  });

  it("desactiva y vuelve a activar un producto, con un mensaje que lleva su nombre", async () => {
    const baja = await actualizarActivoProducto(productoId, false);
    expect(baja).toMatchObject({ ok: true, mensaje: 'Producto "Pizza Activar" desactivado.' });
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).activo).toBe(false);

    const alta = await actualizarActivoProducto(productoId, true);
    expect(alta).toMatchObject({ ok: true, mensaje: 'Producto "Pizza Activar" activado.' });
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).activo).toBe(true);
  });

  it("un id que no existe devuelve un mensaje, no un error de Prisma", async () => {
    // Antes: `update` sobre un id inexistente rechazaba con P2025 sin atrapar, y el llamador recibía una excepción en vez de un ResultadoAccion.
    await expect(actualizarActivoProducto("no-existe", false)).resolves.toMatchObject({ ok: false, mensaje: "No se encontró el producto." });
  });

  it("un rol que ve productos pero NO tiene editar_producto no puede desactivar: el producto queda activo", async () => {
    const soloVe = await prisma.rol.create({ data: { nombre: "solo-ve-productos" } });
    await prisma.permisoRol.create({ data: { rolId: soloVe.id, accionClave: "alta_producto", puedeVer: true, puedeEditar: true } });
    const usuario = await crearUsuarioConMembresia({ email: "solove@test.com", sucursalId, rolId: soloVe.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    // Ojo: se le da Ver+EDITAR de `alta_producto` a propósito. Si la acción pidiera esa clave en vez de `editar_producto`, este rol podría desactivar.
    const r = await actualizarActivoProducto(productoId, false);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).activo).toBe(true);
  });
});

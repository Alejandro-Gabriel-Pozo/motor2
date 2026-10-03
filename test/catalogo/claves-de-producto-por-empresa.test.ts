import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, sembrarProductoDisponible, prisma, prismaAdmin } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { requierePermiso, requierePermisoDeEmpresa } from "../../src/core/permisos/gate";
import { actualizarProducto, sincronizarPrecioGrupoCarta, type DatosProducto } from "../../src/server/actions/catalogo/productos";

/**
 * Claves de producto de CONTEXTO EMPRESA (`producto_editar`, `producto_asignar_insumo`, `producto_sincronizar_precio_carta`): valen si CUALQUIER
 * membresía activa del usuario en la empresa las tiene, no solo la de la sucursal en la que está parado. El producto es un dato de la empresa:
 * el permiso no puede depender de qué sucursal esté seleccionada. En cambio `producto_disponibilidad` sigue siendo de la sucursal activa.
 */
const CLAVES_DE_EMPRESA = ["producto_editar", "producto_asignar_insumo", "producto_sincronizar_precio_carta"] as const;

describe("claves de producto: valen con cualquier membresía de la empresa", () => {
  let empresaId: string;
  let sucursalA: string;
  let sucursalB: string;
  let rolConsultaId: string;
  let rolOperadorId: string;
  let unidadId: string;
  let productoId: string;
  let hermanoId: string;

  const datosPV = (precioVenta: number): DatosProducto => ({ nombre: "Producto de prueba", tipo: "PV", unidadStockId: unidadId, factorConversion: 1, precioVenta });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    empresaId = base.sucursal.empresaId;
    sucursalA = base.sucursal.id;
    sucursalB = (await prismaAdmin.sucursal.create({ data: { nombre: "Segunda", empresaId } })).id;
    rolOperadorId = base.operador.id;
    // Un rol personalizado sin ninguna fila de permisos: no tiene ninguna de las claves.
    rolConsultaId = (await prisma.rol.create({ data: { nombre: "consulta" } })).id;
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    const categoriaId = (await prisma.categoriaProducto.create({ data: { nombre: "Gaseosa" } })).id;
    productoId = (await sembrarProductoDisponible({ codigo: "CPE_1", nombre: "Producto de prueba", tipo: "PV", categoriaId, precioVenta: 1000, unidadStockId: unidadId }, sucursalA)).id;
    hermanoId = (await sembrarProductoDisponible({ codigo: "CPE_2", nombre: "Hermano", tipo: "PV", categoriaId, precioVenta: 1000, unidadStockId: unidadId }, sucursalA)).id;
    // La sincronización necesita que el producto esté en un ítem agrupado de la carta.
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } });
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalA, nombre: "Gaseosa", seccionCartaId: seccion.id } });
    await prisma.opcionItemAgrupadoCarta.createMany({ data: [productoId, hermanoId].map((id, orden) => ({ sucursalId: sucursalA, itemAgrupadoCartaId: item.id, productoId: id, orden })) });
  });

  it("la clave que tiene la membresía de OTRA sucursal alcanza, sea cual sea la sucursal activa", async () => {
    for (const [i, orden] of ([[rolConsultaId, rolOperadorId], [rolOperadorId, rolConsultaId]] as const).entries()) {
      const usuario = await crearUsuarioConMembresia({ email: `mixto${i}@test.com`, sucursalId: sucursalA, rolId: orden[0] });
      await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursalB, rolId: orden[1] });
      for (const clave of CLAVES_DE_EMPRESA) {
        expect((await requierePermisoDeEmpresa(usuario.id, empresaId, clave, prismaAdmin)).ok, `${clave} (caso ${i})`).toBe(true);
      }
      await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });
      expect((await actualizarProducto(productoId, datosPV(1100 + i))).ok, `actualizarProducto (caso ${i})`).toBe(true);
      expect((await sincronizarPrecioGrupoCarta([productoId, hermanoId], 1200 + i)).ok, `sincronizarPrecioGrupoCarta (caso ${i})`).toBe(true);
    }
  });

  it("sin la clave en ninguna membresía de la empresa se deniega, y el producto no cambia", async () => {
    const usuario = await crearUsuarioConMembresia({ email: "consulta@test.com", sucursalId: sucursalA, rolId: rolConsultaId });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursalB, rolId: rolConsultaId });
    for (const clave of CLAVES_DE_EMPRESA) {
      expect((await requierePermisoDeEmpresa(usuario.id, empresaId, clave, prismaAdmin)).ok, clave).toBe(false);
    }
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });
    expect((await actualizarProducto(productoId, datosPV(7777))).ok).toBe(false);
    expect((await sincronizarPrecioGrupoCarta([productoId, hermanoId], 7777)).ok).toBe(false);
    expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).precioVenta)).toBe(1000);
  });

  it("la disponibilidad sigue siendo de la sucursal: la clave de otra sucursal no alcanza", async () => {
    const usuario = await crearUsuarioConMembresia({ email: "disp@test.com", sucursalId: sucursalA, rolId: rolConsultaId });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursalB, rolId: rolOperadorId });
    expect((await requierePermiso(usuario.id, sucursalA, "producto_disponibilidad", prismaAdmin)).ok).toBe(false);
    expect((await requierePermiso(usuario.id, sucursalB, "producto_disponibilidad", prismaAdmin)).ok).toBe(true);
  });
});

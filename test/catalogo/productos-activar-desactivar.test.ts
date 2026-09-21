import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, sembrarSeccion, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivoProducto } from "../../src/server/actions/catalogo/productos";

describe("actualizarActivoProducto", () => {
  let sucursalId: string;
  let productoId: string;
  let kgId: string;
  let adminUsuarioId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    sucursalId = base.sucursal.id;
    kgId = catalogo.kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminUsuarioId = admin.id;
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
  describe("auditoría", () => {
    const registros = () => prisma.registroAuditoria.findMany({ where: { entidad: "Producto", entidadId: productoId, campo: "activo" }, orderBy: { creadoEn: "asc" } });

    it("cada activar/desactivar queda en la auditoría, con quién y qué valor anterior", async () => {
      await actualizarActivoProducto(productoId, false);
      await actualizarActivoProducto(productoId, true);
      const filas = await registros();
      expect(filas.map((f) => [f.valorAnterior, f.valorNuevo])).toEqual([["true", "false"], ["false", "true"]]);
      expect(filas[0].descripcion).toBe('Producto "Pizza Activar": activo');
      expect(filas.every((f) => f.actorId === adminUsuarioId)).toBe(true);
    });

    it("un intento bloqueado, o repetir el mismo estado, no deja registro", async () => {
      const seccion = await sembrarSeccion(sucursalId, "Depósito");
      const op = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: adminUsuarioId } });
      await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId, seccionId: seccion.id, proceso: "COMPRA", cantidad: 1, detalle: "test" } });
      expect((await actualizarActivoProducto(productoId, false)).ok).toBe(false); // bloqueado por saldo
      expect((await actualizarActivoProducto(productoId, true)).ok).toBe(true); // ya estaba activo
      expect(await registros()).toEqual([]);
    });
  });

  describe("al DESACTIVAR bloquea si todavía depende de él algo que se rompería", () => {
    async function platoActivoQueLoUsa(nombre: string) {
      const plato = await prisma.producto.create({ data: { codigo: `PV_${nombre}`, nombre, tipo: "PV", unidadStockId: kgId, precioVenta: 100 } });
      await prisma.recetaVersion.create({ data: { productoId: plato.id, version: 1, ingredientes: { create: [{ insumoProductoId: productoId, cantidad: 1, unidadId: kgId }] } } });
      return plato;
    }
    async function conSaldo(cantidad: number) {
      const seccion = await sembrarSeccion(sucursalId, "Depósito");
      const op = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: adminUsuarioId } });
      await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId, seccionId: seccion.id, proceso: "COMPRA", cantidad, detalle: "test" } });
    }
    const activo = async () => (await prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).activo;

    it("no lo desactiva si está en la receta vigente de un plato activo, y dice cuáles", async () => {
      await platoActivoQueLoUsa("Calzone");
      await platoActivoQueLoUsa("Fainá");
      const r = await actualizarActivoProducto(productoId, false);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain('"Pizza Activar"');
      expect(r.mensaje).toContain("Calzone");
      expect(r.mensaje).toContain("Fainá");
      expect(await activo()).toBe(true);
    });

    it("no lo desactiva si tiene saldo, y dice dónde", async () => {
      await conSaldo(2.5);
      const r = await actualizarActivoProducto(productoId, false);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("Central / Depósito");
      expect(await activo()).toBe(true);
    });

    it("sin dependencias, lo desactiva", async () => {
      const inactivo = await prisma.producto.create({ data: { codigo: "PV_INACTIVO", nombre: "Inactivo", tipo: "PV", unidadStockId: kgId, precioVenta: 1, activo: false } });
      await prisma.recetaVersion.create({ data: { productoId: inactivo.id, version: 1, ingredientes: { create: [{ insumoProductoId: productoId, cantidad: 1, unidadId: kgId }] } } });
      // Un plato INACTIVO que lo usa no bloquea: no se puede vender de todos modos.
      expect((await actualizarActivoProducto(productoId, false)).ok).toBe(true);
      expect(await activo()).toBe(false);
    });

    it("REACTIVAR nunca se bloquea, aunque tenga saldo o recetas", async () => {
      await prisma.producto.update({ where: { id: productoId }, data: { activo: false } });
      await conSaldo(1);
      await platoActivoQueLoUsa("Calzone");
      expect((await actualizarActivoProducto(productoId, true)).ok).toBe(true);
      expect(await activo()).toBe(true);
    });
  });
});

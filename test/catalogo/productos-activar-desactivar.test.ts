import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, sembrarSeccion, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarDisponibilidadProducto } from "../../src/server/actions/catalogo/productos";

describe("actualizarDisponibilidadProducto", () => {
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
    // El producto arranca disponible acá — mismo estado que dejaría el alta con el tilde tildado (P5), antes de esa pieza.
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId, disponible: true } });
  });

  const disponibleAca = async () => (await prisma.disponibilidadProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } }))?.disponible;
  const activoGlobal = async () => (await prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).activo;

  it("desactiva y vuelve a activar un producto en la sucursal, con un mensaje que lleva su nombre y la sucursal", async () => {
    const baja = await actualizarDisponibilidadProducto(productoId, false);
    expect(baja).toMatchObject({ ok: true, mensaje: 'Producto "Pizza Activar" desactivado en "Central".' });
    expect(await disponibleAca()).toBe(false);

    const alta = await actualizarDisponibilidadProducto(productoId, true);
    expect(alta).toMatchObject({ ok: true, mensaje: 'Producto "Pizza Activar" activado en "Central".' });
    expect(await disponibleAca()).toBe(true);
  });

  it("un id que no existe devuelve un mensaje, no un error de Prisma", async () => {
    await expect(actualizarDisponibilidadProducto("no-existe", false)).resolves.toMatchObject({ ok: false, mensaje: "No se encontró el producto." });
  });

  it("un rol que ve productos pero NO tiene editar_producto no puede desactivar: el producto sigue disponible acá", async () => {
    const soloVe = await prisma.rol.create({ data: { nombre: "solo-ve-productos" } });
    await prisma.permisoRol.create({ data: { rolId: soloVe.id, accionClave: "alta_producto", puedeVer: true, puedeEditar: true } });
    const usuario = await crearUsuarioConMembresia({ email: "solove@test.com", sucursalId, rolId: soloVe.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    // Ojo: se le da Ver+EDITAR de `alta_producto` a propósito. Si la acción pidiera esa clave en vez de `editar_producto`, este rol podría desactivar.
    const r = await actualizarDisponibilidadProducto(productoId, false);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect(await disponibleAca()).toBe(true);
  });

  describe("auditoría", () => {
    const registros = () => prisma.registroAuditoria.findMany({ where: { entidad: "DisponibilidadProducto", entidadId: `${sucursalId}:${productoId}`, campo: "disponible" }, orderBy: { creadoEn: "asc" } });

    it("cada activar/desactivar queda en la auditoría, con quién y qué valor anterior", async () => {
      await actualizarDisponibilidadProducto(productoId, false);
      await actualizarDisponibilidadProducto(productoId, true);
      const filas = await registros();
      expect(filas.map((f) => [f.valorAnterior, f.valorNuevo])).toEqual([["true", "false"], ["false", "true"]]);
      expect(filas[0].descripcion).toBe('Producto "Pizza Activar" en "Central": disponible');
      expect(filas.every((f) => f.actorId === adminUsuarioId)).toBe(true);
    });

    it("un intento bloqueado, o repetir el mismo estado, no deja registro", async () => {
      const seccion = await sembrarSeccion(sucursalId, "Depósito");
      const op = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: adminUsuarioId } });
      await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId, seccionId: seccion.id, proceso: "COMPRA", cantidad: 1, detalle: "test" } });
      expect((await actualizarDisponibilidadProducto(productoId, false)).ok).toBe(false); // bloqueado por saldo
      expect((await actualizarDisponibilidadProducto(productoId, true)).ok).toBe(true); // ya estaba disponible
      expect(await registros()).toEqual([]);
    });
  });

  describe("espejo transitorio de Producto.activo (sincronizarActivoGlobal, hasta P13)", () => {
    it("desactivar en la ÚNICA sucursal donde estaba disponible pone activo:false global — equivale al comportamiento de antes", async () => {
      expect(await activoGlobal()).toBe(true);
      await actualizarDisponibilidadProducto(productoId, false);
      expect(await activoGlobal()).toBe(false);
    });

    it("con 2 sucursales disponibles, desactivar en una sola mantiene activo:true global (sigue disponible en la otra)", async () => {
      const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursal.id, productoId, disponible: true } });

      await actualizarDisponibilidadProducto(productoId, false); // desactiva en "Central"

      expect(await disponibleAca()).toBe(false);
      expect(await activoGlobal()).toBe(true); // sigue disponible en "Norte"
    });
  });

  it("desactivar en esta sucursal no toca la disponibilidad de la otra — el corazón del pendiente", async () => {
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursal.id, productoId, disponible: true } });

    await actualizarDisponibilidadProducto(productoId, false);

    expect(await disponibleAca()).toBe(false);
    const enNorte = await prisma.disponibilidadProducto.findUnique({ where: { sucursalId_productoId: { sucursalId: otraSucursal.id, productoId } } });
    expect(enNorte?.disponible).toBe(true);
  });

  describe("al DESACTIVAR bloquea si todavía depende de él algo que se rompería EN ESTA SUCURSAL", () => {
    async function platoDisponibleAcaQueLoUsa(nombre: string) {
      const plato = await prisma.producto.create({ data: { codigo: `PV_${nombre}`, nombre, tipo: "PV", unidadStockId: kgId, precioVenta: 100 } });
      await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: plato.id, disponible: true } });
      await prisma.recetaVersion.create({ data: { productoId: plato.id, version: 1, ingredientes: { create: [{ insumoProductoId: productoId, cantidad: 1, unidadId: kgId }] } } });
      return plato;
    }
    async function conSaldo(cantidad: number) {
      const seccion = await sembrarSeccion(sucursalId, "Depósito");
      const op = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: adminUsuarioId } });
      await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId, seccionId: seccion.id, proceso: "COMPRA", cantidad, detalle: "test" } });
    }

    it("no lo desactiva si está en la receta vigente de un plato disponible acá, y dice cuáles", async () => {
      await platoDisponibleAcaQueLoUsa("Calzone");
      await platoDisponibleAcaQueLoUsa("Fainá");
      const r = await actualizarDisponibilidadProducto(productoId, false);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain('"Pizza Activar"');
      expect(r.mensaje).toContain("Calzone");
      expect(r.mensaje).toContain("Fainá");
      expect(await disponibleAca()).toBe(true);
    });

    it("no lo desactiva si tiene saldo, y dice dónde", async () => {
      await conSaldo(2.5);
      const r = await actualizarDisponibilidadProducto(productoId, false);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("Central / Depósito");
      expect(await disponibleAca()).toBe(true);
    });

    it("sin dependencias, lo desactiva", async () => {
      // Un plato que lo usa pero NO está disponible acá no bloquea: no se puede vender de todos modos.
      const plato = await prisma.producto.create({ data: { codigo: "PV_NO_DISPONIBLE", nombre: "No disponible acá", tipo: "PV", unidadStockId: kgId, precioVenta: 1 } });
      await prisma.recetaVersion.create({ data: { productoId: plato.id, version: 1, ingredientes: { create: [{ insumoProductoId: productoId, cantidad: 1, unidadId: kgId }] } } });
      expect((await actualizarDisponibilidadProducto(productoId, false)).ok).toBe(true);
      expect(await disponibleAca()).toBe(false);
    });

    it("REACTIVAR nunca se bloquea, aunque tenga saldo o recetas", async () => {
      await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId, productoId } }, data: { disponible: false } });
      await conSaldo(1);
      await platoDisponibleAcaQueLoUsa("Calzone");
      expect((await actualizarDisponibilidadProducto(productoId, true)).ok).toBe(true);
      expect(await disponibleAca()).toBe(true);
    });
  });
});

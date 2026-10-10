import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto, darDeAltaProductoRapido, type DatosProducto } from "../../src/server/actions/catalogo/productos";

/**
 * M.2 (P4, D-2 del dueño) — la clave fina `producto_campos_sensibles` en el ALTA de un producto. Crear un producto con precio de venta, con un factor de conversión distinto de 1 o con
 * unidad de compra es fijar justo lo que la edición ya protege (si el alta lo dejara libre, el que no puede editar el precio lo fijaría dando de alta un producto nuevo). Fallo cerrado:
 * sin la clave el alta no puede traer precio distinto de 0, factor distinto de 1 ni unidad de compra; la unidad de STOCK queda libre (sin ella no hay producto). El alta rápida
 * (`darDeAltaProductoRapido`: solo la unidad de stock, factor 1, precio 0) no cambia.
 */
describe("M.2: el alta de un producto con precio, factor o unidad de compra es de quien tiene producto_campos_sensibles", () => {
  const MENSAJE = "No tenés permiso para cambiar el precio de venta, el factor de conversión ni las unidades del producto.";
  let sucursalId: string;
  let adminId: string;
  let operadorId: string;
  let soloAltaId: string;
  let conClaveId: string;
  let kgId: string;
  let gId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const nuevo = (extra: Partial<DatosProducto> = {}): DatosProducto => ({ nombre: "Vino", tipo: "MP", unidadStockId: kgId, factorConversion: 1, ...extra });
  const cantidad = (nombre = "Vino") => prisma.producto.count({ where: { nombre } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    // Un rol propio con SOLO alta_producto y otro que además tiene la clave fina (la delegó el gerente por configuración).
    const soloAlta = await prisma.rol.create({ data: { nombre: "Altas" } });
    await prisma.permisoRol.create({ data: { rolId: soloAlta.id, accionClave: "alta_producto", puedeVer: true, puedeEditar: true } });
    soloAltaId = (await crearUsuarioConMembresia({ email: "altas@test.com", sucursalId, rolId: soloAlta.id })).id;
    const precios = await prisma.rol.create({ data: { nombre: "Precios" } });
    for (const accionClave of ["alta_producto", "producto_campos_sensibles"]) {
      await prisma.permisoRol.create({ data: { rolId: precios.id, accionClave, puedeVer: true, puedeEditar: true } });
    }
    conClaveId = (await crearUsuarioConMembresia({ email: "precios@test.com", sucursalId, rolId: precios.id })).id;
    await como(operadorId, "operador@test.com");
  });

  describe("EL ATAQUE: sin la clave, el alta con precio, factor o unidad de compra se rechaza y no crea el producto", () => {
    const ATAQUES: [string, () => Partial<DatosProducto>][] = [
      ["un precio de venta de 7000", () => ({ precioVenta: 7000 })],
      ["un factor de conversión de 25", () => ({ factorConversion: 25 })],
      ["una unidad de compra", () => ({ unidadCompraId: gId })],
    ];
    const ACTORES: [string, () => Promise<void>][] = [
      ["el operador de fábrica", () => como(operadorId, "operador@test.com")],
      ["un rol propio con solo alta_producto", () => como(soloAltaId, "altas@test.com")],
    ];

    for (const [quien, actuar] of ACTORES) {
      it.each(ATAQUES)(`${quien} da de alta con %s → rechazo y no se crea el producto`, async (_nombre, cambios) => {
        await actuar();
        const r = await darDeAltaProducto(nuevo(cambios()));
        expect(r.ok).toBe(false);
        expect(r.mensaje).toContain(MENSAJE);
        expect(await cantidad()).toBe(0);
      });
    }

    it("un precio escrito como texto o un factor que no es un número también se rechazan (fallo cerrado, nunca «cero» por no entenderlo)", async () => {
      expect((await darDeAltaProducto(nuevo({ precioVenta: "7000" as unknown as number }))).ok).toBe(false);
      expect((await darDeAltaProducto(nuevo({ factorConversion: "25" as unknown as number }))).ok).toBe(false);
      expect(await cantidad()).toBe(0);
    });
  });

  describe("controles: lo que sigue andando sin la clave", () => {
    it("el alta con precio 0 y factor 1 (el formulario con los campos en su valor por defecto)", async () => {
      const r = await darDeAltaProducto(nuevo({ precioVenta: 0, unidadCompraId: null }));
      expect(r.ok, r.mensaje).toBe(true);
      expect(await cantidad()).toBe(1);
    });

    it("el alta sin mandar el precio ni la unidad de compra", async () => {
      expect((await darDeAltaProducto(nuevo({ nombre: "Vino tinto" }))).ok).toBe(true);
    });

    it("la unidad de stock es libre: el alta elige la que quiera", async () => {
      expect((await darDeAltaProducto(nuevo({ unidadStockId: gId }))).ok).toBe(true);
      expect((await prisma.producto.findFirstOrThrow({ where: { nombre: "Vino" } })).unidadStockId).toBe(gId);
    });

    it("el alta rápida (solo nombre y unidad de stock) no cambia", async () => {
      const r = await darDeAltaProductoRapido("Aceite", kgId);
      expect(r.ok, r.mensaje).toBe(true);
      const p = await prisma.producto.findFirstOrThrow({ where: { nombre: "Aceite" } });
      expect([Number(p.precioVenta), Number(p.factorConversion), p.unidadCompraId]).toEqual([0, 1, null]);
    });
  });

  describe("controles: quien tiene la clave", () => {
    it("el administrador da de alta con precio, factor y unidad de compra", async () => {
      await como(adminId, "admin@test.com");
      const r = await darDeAltaProducto(nuevo({ precioVenta: 7000, factorConversion: 25, unidadCompraId: gId }));
      expect(r.ok, r.mensaje).toBe(true);
      const p = await prisma.producto.findFirstOrThrow({ where: { nombre: "Vino" } });
      expect([Number(p.precioVenta), Number(p.factorConversion), p.unidadCompraId]).toEqual([7000, 25, gId]);
    });

    it("un rol propio CON la clave también", async () => {
      await como(conClaveId, "precios@test.com");
      expect((await darDeAltaProducto(nuevo({ precioVenta: 7000 }))).ok).toBe(true);
    });

    it("la clave NO reemplaza a alta_producto: sin ella, ni quien tiene la clave fina da de alta", async () => {
      const soloClave = await prisma.rol.create({ data: { nombre: "SoloClave" } });
      await prisma.permisoRol.create({ data: { rolId: soloClave.id, accionClave: "producto_campos_sensibles", puedeVer: true, puedeEditar: true } });
      const u = await crearUsuarioConMembresia({ email: "soloclave@test.com", sucursalId, rolId: soloClave.id });
      await como(u.id, "soloclave@test.com");
      expect((await darDeAltaProducto(nuevo())).ok).toBe(false);
      expect(await cantidad()).toBe(0);
    });
  });
});

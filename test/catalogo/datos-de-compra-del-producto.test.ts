import { beforeEach, describe, expect, it, vi } from "vitest";

// Estos tests ejercen las presentaciones de compra: corren con el interruptor ENCENDIDO (`PRESENTACIONES_VISIBLES`, decisión del dueño 2026-11-06). El estado apagado y la reversibilidad: `presentaciones-interruptor*.test.ts(x)`.
vi.mock("../../src/core/catalogo/presentaciones-visibles", async (original) => ({ ...(await original<typeof import("../../src/core/catalogo/presentaciones-visibles")>()), PRESENTACIONES_VISIBLES: true }));

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { activarTodosLosModulos } from "../setup/modulos";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { obtenerDatosDeCompraDelProducto } from "../../src/server/actions/catalogo/productos";

/**
 * `obtenerDatosDeCompraDelProducto` (Compras, etapa 1, paso 6) es una lectura de servidor invocable directo: su propio test de permiso y de aislamiento (no alcanza con «la cubre la RLS»).
 *  - Permiso: sin el «Ver» de `proceso_compra` se rechaza con el mensaje de permiso ANTES de leer (la guarda abre el cuerpo; ni siquiera un id real devuelve datos).
 *  - Aislamiento: un usuario de la empresa testigo con permiso de compra que pide un producto de la principal recibe `null`, igual que con un id inexistente (no se filtra la existencia).
 *  - Ids rotos: devuelven `null` o un rechazo controlado, nunca un error crudo de Prisma.
 */
describe("obtenerDatosDeCompraDelProducto", () => {
  let sucursalId: string;
  let rolAdminId: string;
  let adminId: string;
  let adminEmail: string;
  let productoId: string;
  let cajaId: string;

  const comoAdmin = () => mockearUsuarioActual({ id: adminId, email: adminEmail, nombre: null });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    sucursalId = base.sucursal.id;
    rolAdminId = base.admin.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: rolAdminId });
    adminId = admin.id;
    adminEmail = admin.email;

    const caja = await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } });
    const bolsa = await prisma.unidad.create({ data: { nombre: "bolsa", magnitud: "CANTIDAD", decimales: 0 } });
    cajaId = caja.id;
    const producto = await prisma.producto.create({
      data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, unidadCompraId: catalogo.g.id, factorConversion: 5 },
    });
    productoId = producto.id;
    await prisma.presentacion.create({ data: { productoId, unidadCompraId: caja.id, factorConversion: 12, activa: true } });
    await prisma.presentacion.create({ data: { productoId, unidadCompraId: bolsa.id, factorConversion: 25, activa: false } });
    await comoAdmin();
  });

  it("caso feliz: código, nombre, unidad de stock, la unidad por defecto (la de compra del producto, con su factor) y SOLO las presentaciones activas", async () => {
    expect(await obtenerDatosDeCompraDelProducto(productoId)).toEqual({
      codigo: "MP_HARINA",
      nombre: "Harina",
      unidades: {
        unidadStockNombre: "kg",
        porDefecto: { unidadCompraId: expect.any(String), nombre: "g", factor: 5 },
        presentaciones: [{ unidadCompraId: cajaId, nombre: "caja", factor: 12 }],
      },
    });
  });

  it("sin unidad de compra propia, la por defecto es la de stock (factor 1 si el del producto es 0/vacío)", async () => {
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const sinCompra = await prisma.producto.create({ data: { codigo: "MP_SAL", nombre: "Sal", tipo: "MP", unidadStockId: kg.id, factorConversion: 1 } });
    expect(await obtenerDatosDeCompraDelProducto(sinCompra.id)).toEqual({
      codigo: "MP_SAL",
      nombre: "Sal",
      unidades: { unidadStockNombre: "kg", porDefecto: { unidadCompraId: kg.id, nombre: "kg", factor: 1 }, presentaciones: [] },
    });
  });

  describe("permiso", () => {
    it("un rol sin el «Ver» de proceso_compra se rechaza con el mensaje de permiso, aun con el id de un producto real (no devuelve datos)", async () => {
      const rolSinPermisos = await prisma.rol.create({ data: { nombre: "sin-permisos" } });
      const lector = await crearUsuarioConMembresia({ email: "lector@test.com", sucursalId, rolId: rolSinPermisos.id });
      await mockearUsuarioActual({ id: lector.id, email: lector.email, nombre: null });
      await expect(obtenerDatosDeCompraDelProducto(productoId)).rejects.toThrow(/No tenés permiso/);
      await expect(obtenerDatosDeCompraDelProducto("id-inexistente")).rejects.toThrow(/No tenés permiso/);
    });

    it("el «Ver» de OTRA pantalla no alcanza", async () => {
      const rol = await prisma.rol.create({ data: { nombre: "solo-merma" } });
      await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: "proceso_merma", puedeVer: true, puedeEditar: false } });
      const lector = await crearUsuarioConMembresia({ email: "merma@test.com", sucursalId, rolId: rol.id });
      await mockearUsuarioActual({ id: lector.id, email: lector.email, nombre: null });
      await expect(obtenerDatosDeCompraDelProducto(productoId)).rejects.toThrow(/No tenés permiso/);
    });

    it("con «Ver» sin poder Editar responde", async () => {
      const rol = await prisma.rol.create({ data: { nombre: "solo-ver-compra" } });
      await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: "proceso_compra", puedeVer: true, puedeEditar: false } });
      const lector = await crearUsuarioConMembresia({ email: "ver@test.com", sucursalId, rolId: rol.id });
      await mockearUsuarioActual({ id: lector.id, email: lector.email, nombre: null });
      expect(await obtenerDatosDeCompraDelProducto(productoId)).toMatchObject({ codigo: "MP_HARINA" });
    });
  });

  describe("aislamiento entre empresas", () => {
    it("un usuario de la empresa testigo con permiso de compra, pidiendo el id de un producto de la principal, recibe null: lo mismo que con un id inexistente", async () => {
      const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
      await activarTodosLosModulos(EMPRESA_TESTIGO_ID);
      const sucursalB = await testigo.sucursal.create({ data: { nombre: "Testigo" } });
      const rolB = await testigo.rol.create({ data: { nombre: "comprador-b" } });
      await testigo.permisoRol.create({ data: { rolId: rolB.id, accionClave: "proceso_compra", puedeVer: true, puedeEditar: true } });
      const usuarioB = await crearUsuarioConMembresia({ email: "b@testigo.com", sucursalId: sucursalB.id, rolId: rolB.id });
      await mockearUsuarioActual({ id: usuarioB.id, email: usuarioB.email, nombre: null });

      // Control: el usuario B sí tiene el permiso (un producto propio de B responde).
      const unidadB = await testigo.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
      const propioB = await testigo.producto.create({ data: { codigo: "MP_B", nombre: "Propio B", tipo: "MP", unidadStockId: unidadB.id, factorConversion: 1 } });
      expect(await obtenerDatosDeCompraDelProducto(propioB.id)).toMatchObject({ codigo: "MP_B" });

      const ajeno = await obtenerDatosDeCompraDelProducto(productoId);
      const inexistente = await obtenerDatosDeCompraDelProducto("cl-no-existe-0000000000");
      expect(ajeno).toBeNull();
      expect(ajeno).toStrictEqual(inexistente);

      // Y la inversa: el admin de la principal no ve el producto de B.
      await comoAdmin();
      expect(await obtenerDatosDeCompraDelProducto(propioB.id)).toBeNull();
    });
  });

  describe("ids inexistentes o mal formados", () => {
    it("un id con byte NUL (\\u0000): null, sin error crudo de Prisma", async () => {
      await expect(obtenerDatosDeCompraDelProducto("abc\u0000def")).resolves.toBeNull();
    });

    it.each([
      ["inexistente", "cl-no-existe-0000000000"],
      ["string vacío", ""],
      ["texto raro (comillas, SQL, unicode)", "'; DROP TABLE \"Producto\"; -- ✓ \\ %"],
      ["muy largo", "x".repeat(10_000)],
    ])("%s: null, sin error crudo de Prisma", async (_nombre, id) => {
      await expect(obtenerDatosDeCompraDelProducto(id)).resolves.toBeNull();
    });

    it.each([
      ["un número", 123],
      ["un objeto", { contains: "a" }],
      ["undefined", undefined],
      ["null", null],
    ])("%s (cast): null, sin error crudo de Prisma", async (_nombre, id) => {
      await expect(obtenerDatosDeCompraDelProducto(id as unknown as string)).resolves.toBeNull();
    });
  });
});

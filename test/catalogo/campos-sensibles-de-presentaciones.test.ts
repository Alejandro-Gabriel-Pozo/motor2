import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivaPresentacion, agregarPresentacionAlternativa } from "../../src/server/actions/catalogo/productos";
import { agregarPresentacionAlternativaCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/agregar-presentacion-alternativa";
import { guardComandoAgregarPresentacionAlternativa } from "../../src/core/features/catalogo/productos.guard";

/**
 * M.2 (P3) — la clave fina `producto_campos_sensibles` en las PRESENTACIONES de compra. El factor de una presentación mueve el stock que entra y el costo por unidad de todo lo que se compre
 * con ella. M-4 (O.199) ya impide CAMBIAR el factor de una presentación que se usó en compras, pero cualquiera con `producto_presentaciones` podía CREAR una presentación nueva con el factor que
 * quisiera. Ahora definir un factor —crear la presentación, o reactivarla con otro factor— exige además la clave fina; reactivarla con el MISMO factor y activarla o desactivarla
 * (`actualizarActivaPresentacion`) siguen siendo de `producto_presentaciones` solo.
 */
describe("M.2: el factor de una presentación de compra es de quien tiene producto_campos_sensibles", () => {
  const MENSAJE = "No tenés permiso para cambiar el precio de venta, el factor de conversión ni las unidades del producto.";
  let sucursalId: string;
  let adminId: string;
  let operadorId: string;
  let soloPresentacionesId: string;
  let conClaveId: string;
  let kgId: string;
  let gId: string;
  let productoId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const presentaciones = () => prismaAdmin.presentacion.findMany({ where: { productoId }, orderBy: { unidadCompraId: "asc" } });
  const auditorias = () => prismaAdmin.registroAuditoria.count({ where: { entidad: "Presentacion" } });
  /** Deja una presentación en gramos con el factor y el estado dados, escrita directo (como si alguien con la clave la hubiera creado antes). */
  const sembrarPresentacion = (factorConversion: number, activa: boolean) => prisma.presentacion.create({ data: { productoId, unidadCompraId: gId, factorConversion, activa } });
  /** El vínculo proveedor↔producto que cada compra con proveedor escribe: la huella de que la presentación se usó. */
  const marcarUsada = async () => {
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PROV_1", nombre: "Molinos SA" } });
    await prisma.proveedorPorProducto.create({ data: { productoId, proveedorId: proveedor.id, unidadCompraId: gId, precioUnitario: 1, precioPorUnidadStock: 1 } });
  };
  const actor = (usuarioId: string) => ({ usuarioId, ...baseDeTest });
  const comando = (factorConversion: number, sensibles: boolean) => ({
    productoId,
    unidadCompraId: gId,
    factorConversion,
    factor: guardComandoAgregarPresentacionAlternativa({ productoId, unidadCompraId: gId, factorConversion }).factor,
    puedeEditarCamposSensibles: sensibles,
  });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    // Un rol propio con SOLO producto_presentaciones y otro que además tiene la clave fina (la delegó el gerente por configuración).
    const soloPresentaciones = await prisma.rol.create({ data: { nombre: "Presentaciones" } });
    await prisma.permisoRol.create({ data: { rolId: soloPresentaciones.id, accionClave: "producto_presentaciones", puedeVer: true, puedeEditar: true } });
    soloPresentacionesId = (await crearUsuarioConMembresia({ email: "presentaciones@test.com", sucursalId, rolId: soloPresentaciones.id })).id;
    const compras = await prisma.rol.create({ data: { nombre: "Compras" } });
    for (const accionClave of ["producto_presentaciones", "producto_campos_sensibles"]) {
      await prisma.permisoRol.create({ data: { rolId: compras.id, accionClave, puedeVer: true, puedeEditar: true } });
    }
    conClaveId = (await crearUsuarioConMembresia({ email: "compras@test.com", sucursalId, rolId: compras.id })).id;
    productoId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kgId, unidadCompraId: kgId, factorConversion: 1 } })).id;
    await como(operadorId, "operador@test.com");
  });

  describe("EL ATAQUE: sin la clave, definir un factor se rechaza y no escribe nada", () => {
    const ACTORES: [string, () => Promise<void>][] = [
      ["el operador de fábrica", () => como(operadorId, "operador@test.com")],
      ["un rol propio con solo producto_presentaciones", () => como(soloPresentacionesId, "presentaciones@test.com")],
    ];

    for (const [quien, actuar] of ACTORES) {
      it(`${quien} crea una presentación NUEVA (otra unidad, factor 50) → rechazo y NO hay fila Presentacion`, async () => {
        await actuar();
        const r = await agregarPresentacionAlternativa(productoId, gId, 50);
        expect(r.ok).toBe(false);
        expect(r.mensaje).toContain(MENSAJE);
        expect(await presentaciones()).toEqual([]);
        expect(await auditorias()).toBe(0);
      });

      it(`${quien} reactiva una presentación con OTRO factor → rechazo y la fila queda como estaba`, async () => {
        await actuar();
        await sembrarPresentacion(20, false);
        const r = await agregarPresentacionAlternativa(productoId, gId, 30);
        expect(r.ok).toBe(false);
        expect(r.mensaje).toContain(MENSAJE);
        const [fila] = await presentaciones();
        expect([Number(fila!.factorConversion), fila!.activa]).toEqual([20, false]);
        expect(await auditorias()).toBe(0);
      });
    }

    it("el caso de uso responde con el código SIN_PERMISO_CAMPOS_SENSIBLES", async () => {
      const r = await agregarPresentacionAlternativaCasoDeUso(actor(operadorId), comando(50, false));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("SIN_PERMISO_CAMPOS_SENSIBLES");
      expect(await presentaciones()).toEqual([]);
    });

    it("el rechazo le gana a FACTOR_CON_USO: con la presentación ya usada, cambiar el factor sin la clave dice que falta la clave", async () => {
      await sembrarPresentacion(20, true);
      await marcarUsada();
      const sinClave = await agregarPresentacionAlternativaCasoDeUso(actor(operadorId), comando(30, false));
      expect(sinClave.ok).toBe(false);
      if (!sinClave.ok) expect(sinClave.codigo).toBe("SIN_PERMISO_CAMPOS_SENSIBLES");
    });
  });

  describe("controles: lo que sigue andando sin la clave", () => {
    it("reactivar una presentación con el MISMO factor", async () => {
      await sembrarPresentacion(20, false);
      const r = await agregarPresentacionAlternativa(productoId, gId, 20);
      expect(r.ok, r.mensaje).toBe(true);
      const [fila] = await presentaciones();
      expect([Number(fila!.factorConversion), fila!.activa]).toEqual([20, true]);
      expect(await auditorias()).toBe(0); // no cambió el factor: ninguna fila de auditoría
    });

    it("reactivar con el mismo factor una presentación que ya se usó", async () => {
      await sembrarPresentacion(20, false);
      await marcarUsada();
      expect((await agregarPresentacionAlternativa(productoId, gId, 20)).ok).toBe(true);
    });

    it("activar y desactivar una presentación (actualizarActivaPresentacion)", async () => {
      const fila = await sembrarPresentacion(20, true);
      expect((await actualizarActivaPresentacion(fila.id, false)).ok).toBe(true);
      expect((await presentaciones())[0]!.activa).toBe(false);
      expect((await actualizarActivaPresentacion(fila.id, true)).ok).toBe(true);
      expect((await presentaciones())[0]!.activa).toBe(true);
    });

    it("el rechazo de un producto inexistente o de la unidad por defecto sigue siendo el de siempre (no depende de la clave)", async () => {
      expect(await agregarPresentacionAlternativa("no-existe", gId, 20)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
      expect((await agregarPresentacionAlternativa(productoId, kgId, 1)).mensaje).toBe("Esa ya es la unidad de compra por defecto de este producto.");
    });
  });

  describe("controles: quien tiene la clave", () => {
    it("un rol propio CON la clave crea la presentación, y queda auditada", async () => {
      await como(conClaveId, "compras@test.com");
      const r = await agregarPresentacionAlternativa(productoId, gId, 50);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await presentaciones()).toHaveLength(1);
      expect(await auditorias()).toBe(1);
    });

    it("el administrador crea la presentación", async () => {
      await como(adminId, "admin@test.com");
      expect((await agregarPresentacionAlternativa(productoId, gId, 50)).ok).toBe(true);
    });

    it("FACTOR_CON_USO sigue igual para quien tiene la clave: no cambia el factor de una presentación ya usada", async () => {
      await sembrarPresentacion(20, true);
      await marcarUsada();
      const r = await agregarPresentacionAlternativaCasoDeUso(actor(conClaveId), comando(30, true));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("FACTOR_CON_USO");
      expect(Number((await presentaciones())[0]!.factorConversion)).toBe(20);
    });

    it("la clave NO reemplaza a producto_presentaciones: sin ella, ni quien tiene la clave fina agrega una presentación", async () => {
      const soloClave = await prisma.rol.create({ data: { nombre: "SoloClave" } });
      await prisma.permisoRol.create({ data: { rolId: soloClave.id, accionClave: "producto_campos_sensibles", puedeVer: true, puedeEditar: true } });
      const u = await crearUsuarioConMembresia({ email: "soloclave@test.com", sucursalId, rolId: soloClave.id });
      await como(u.id, "soloclave@test.com");
      expect((await agregarPresentacionAlternativa(productoId, gId, 50)).ok).toBe(false);
      expect(await presentaciones()).toEqual([]);
    });
  });
});

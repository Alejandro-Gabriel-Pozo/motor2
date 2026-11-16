import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { MENSAJE_GENERICO } from "../../src/core/textos/texto-de";
import { ocultarProducto } from "../../src/server/actions/catalogo/ocultar-producto";
import { limitadorMutaciones } from "../../src/server/actions/limitador-de-mutaciones";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { prismaAdmin } from "../setup/cliente-duenio";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";

/**
 * La Server Action `ocultarProducto` REAL (docs/diseno-ocultar-como-pedernal-2026-11-15.md, etapa d; O-10 y O-13), con la sesión simulada y el gate, la base y los roles REALES: es el control de autorización de «Ocultar en toda
 * la empresa», que ningún otro test ejercía por la acción (el generador de denegación fija `LOCAL`; el test del caso de uso pasa `puedeEnLaEmpresa` a mano; el e2e usa un administrador con alcance total).
 *  - el OPERADOR (con el permiso de la sucursal pero sin ser gerente ni administrador): EMPRESA rechazado, sin marca y sin auditoría; LOCAL de control, sí;
 *  - administrador o gerente SIN membresía en alguna sucursal activa: EMPRESA rechazado, sin marca; con membresía en TODAS: pasa, y el gerente pasa aunque su rol de sucursal sea el de operador;
 *  - doble clic = una marca y un registro; al crearse una sucursal nueva el alcance deja de ser total y «volver a mostrar» en toda la empresa se rechaza (la marca queda como estaba);
 *  - otra empresa: «No se encontró el producto.» y ninguna marca en ninguna empresa; una entrada fuera de lo permitido se rechaza con el genérico, sin marca.
 * Mutación demostrada: reemplazar `await puedeOcultarEnLaEmpresa(ctx)` por `true` en la acción deja en rojo los casos del operador, del administrador de una sola sucursal y del gerente sin membresía en todas.
 */
describe("ocultarProducto (Server Action real): «toda la empresa» solo para gerente o administrador con alcance total", () => {
  let sucursalA: string;
  let sucursalB: string;
  let adminRolId: string;
  let operadorRolId: string;
  let productoId: string;
  const marcas = () => prismaAdmin.ocultamientoProducto.findMany({ where: { productoId }, orderBy: { creadoEn: "asc" } });
  const auditoria = () => prismaAdmin.registroAuditoria.count({ where: { entidad: "OcultamientoProducto" } });
  const entrarComo = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const usuario = (email: string, sucursalId: string, rolId: string) => crearUsuarioConMembresia({ email, sucursalId, rolId });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    sucursalA = base.sucursal.id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    adminRolId = base.admin.id;
    operadorRolId = base.operador.id;
    // El operador SÍ puede activar y desactivar productos en su sucursal (la clave que pide el envoltorio): lo único que le falta es ser gerente o administrador.
    await prisma.permisoRol.updateMany({ where: { rolId: operadorRolId, accionClave: "producto_disponibilidad" }, data: { puedeVer: true, puedeEditar: true } });
    productoId = (await prisma.producto.create({ data: { codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 } })).id;
    await prisma.disponibilidadProducto.createMany({ data: [{ sucursalId: sucursalA, productoId, disponible: true }, { sucursalId: sucursalB, productoId, disponible: true }] });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("el OPERADOR (en las dos sucursales, con el permiso de la sucursal): «toda la empresa» se rechaza sin marca ni auditoría; el LOCAL de control sí funciona", async () => {
    const op = await usuario("operador@test.com", sucursalA, operadorRolId);
    await crearMembresia({ usuarioId: op.id, sucursalId: sucursalB, rolId: operadorRolId });
    await entrarComo(op.id, "operador@test.com");
    expect(await ocultarProducto(productoId, "EMPRESA", true)).toEqual({ ok: false, mensaje: MENSAJE_GENERICO });
    expect(await marcas()).toHaveLength(0);
    expect(await auditoria()).toBe(0);
    // Control: el mismo operador, el mismo producto, alcance LOCAL: el permiso de la sucursal alcanza.
    expect(await ocultarProducto(productoId, "LOCAL", true)).toMatchObject({ ok: true });
    expect(await marcas()).toMatchObject([{ oculto: true }]);
    expect((await marcas())[0]?.sucursalId).not.toBeNull();
  });

  it("un ADMINISTRADOR de UNA sola de las dos sucursales activas: «toda la empresa» se rechaza (alcance total); con membresía de administración en las dos, pasa", async () => {
    const admin = await usuario("admin@test.com", sucursalA, adminRolId);
    await entrarComo(admin.id, "admin@test.com");
    expect(await ocultarProducto(productoId, "EMPRESA", true)).toEqual({ ok: false, mensaje: MENSAJE_GENERICO });
    expect(await marcas()).toHaveLength(0);
    expect(await auditoria()).toBe(0);
    await crearMembresia({ usuarioId: admin.id, sucursalId: sucursalB, rolId: adminRolId });
    expect(await ocultarProducto(productoId, "EMPRESA", true)).toMatchObject({ ok: true });
    expect(await marcas()).toMatchObject([{ sucursalId: null, oculto: true }]);
  });

  it("un GERENTE de la empresa sin membresía en todas las sucursales activas: se rechaza; con membresía en todas pasa aunque su rol de sucursal sea el de operador", async () => {
    const gerente = await usuario("gerente@test.com", sucursalA, operadorRolId);
    await prismaAdmin.usuarioEmpresa.updateMany({ where: { usuarioId: gerente.id }, data: { rolEmpresa: "gerente" } });
    await entrarComo(gerente.id, "gerente@test.com");
    expect(await ocultarProducto(productoId, "EMPRESA", true)).toEqual({ ok: false, mensaje: MENSAJE_GENERICO });
    expect(await marcas()).toHaveLength(0);
    await crearMembresia({ usuarioId: gerente.id, sucursalId: sucursalB, rolId: operadorRolId });
    expect(await ocultarProducto(productoId, "EMPRESA", true)).toMatchObject({ ok: true });
    expect(await marcas()).toMatchObject([{ sucursalId: null, oculto: true }]);
  });

  it("doble clic (dos pedidos iguales): una marca y un registro; y al crearse una sucursal nueva el alcance deja de ser total: «volver a mostrar» en toda la empresa se rechaza y la marca queda como estaba", async () => {
    const admin = await usuario("admin@test.com", sucursalA, adminRolId);
    await crearMembresia({ usuarioId: admin.id, sucursalId: sucursalB, rolId: adminRolId });
    await entrarComo(admin.id, "admin@test.com");
    const dos = await Promise.all([ocultarProducto(productoId, "EMPRESA", true), ocultarProducto(productoId, "EMPRESA", true)]);
    expect(dos.every((r) => r.ok)).toBe(true);
    expect(await marcas()).toHaveLength(1);
    expect(await auditoria()).toBe(1);
    await prisma.sucursal.create({ data: { nombre: "Sur (nueva)" } });
    expect(await ocultarProducto(productoId, "EMPRESA", false)).toEqual({ ok: false, mensaje: MENSAJE_GENERICO });
    expect(await marcas()).toMatchObject([{ sucursalId: null, oculto: true }]);
    expect(await auditoria()).toBe(1);
  });

  it("un producto de OTRA empresa no se ve ni se toca (ni LOCAL ni EMPRESA), y una entrada fuera de lo permitido se rechaza con el genérico, sin marca", async () => {
    const otra = "empresa_ajena_ocultar";
    await prismaAdmin.empresa.create({ data: { id: otra, nombre: otra, slug: otra, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    const unidadAjena = await prismaAdmin.unidad.create({ data: { empresaId: otra, nombre: "kg", magnitud: "PESO", decimales: 2 } });
    const ajeno = await prismaAdmin.producto.create({ data: { empresaId: otra, codigo: "PV_AJENO", nombre: "Ajeno", tipo: "PV", unidadStockId: unidadAjena.id, precioVenta: 1 } });
    const admin = await usuario("admin@test.com", sucursalA, adminRolId);
    await crearMembresia({ usuarioId: admin.id, sucursalId: sucursalB, rolId: adminRolId });
    await entrarComo(admin.id, "admin@test.com");
    for (const alcance of ["LOCAL", "EMPRESA"] as const) {
      expect(await ocultarProducto(ajeno.id, alcance, true)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
    }
    expect(await ocultarProducto(randomUUID(), "LOCAL", true)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
    expect(await prismaAdmin.ocultamientoProducto.count()).toBe(0);
    expect(await ocultarProducto(productoId, "TODAS" as never, true)).toEqual({ ok: false, mensaje: MENSAJE_GENERICO });
    expect(await ocultarProducto(productoId, "LOCAL", "si" as never)).toEqual({ ok: false, mensaje: MENSAJE_GENERICO });
    expect(await ocultarProducto("", "LOCAL", true)).toEqual({ ok: false, mensaje: MENSAJE_GENERICO });
    expect(await prismaAdmin.ocultamientoProducto.count()).toBe(0);
  });

  it("con el limitador de mutaciones agotado no se hace nada (se corta antes de tocar la base)", async () => {
    const admin = await usuario("admin@test.com", sucursalA, adminRolId);
    await entrarComo(admin.id, "admin@test.com");
    vi.spyOn(limitadorMutaciones, "excedeLimite").mockReturnValue(true);
    const r = await ocultarProducto(productoId, "LOCAL", true);
    expect(r.ok).toBe(false);
    expect(await marcas()).toHaveLength(0);
  });
});

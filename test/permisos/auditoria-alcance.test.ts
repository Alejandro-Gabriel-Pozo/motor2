import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { listarRegistrosAuditoria, registrarCambioAuditado, sucursalesVisiblesDeAuditoria } from "../../src/core/permisos/auditoria";
import { esGerenteDeEmpresa } from "../../src/core/permisos/rol-empresa";

/**
 * `/administracion/auditoria` se gatea con `ver_auditoria` en la sucursal ACTIVA; sin este filtro mostraba también las
 * filas de sucursales donde el rol del usuario NO puede ver la auditoría.
 */
describe("Auditoría: alcance por sucursal", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  let sucursalB: { id: string };
  let actorId: string;

  async function registrar(sucursalId: string | null, descripcion: string) {
    await registrarCambioAuditado(prisma, {
      entidad: "Producto", entidadId: "p1", campo: "precioVenta", descripcion, valorAnterior: 1, valorNuevo: 2, actorId, sucursalId,
    });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
    sucursalB = await prisma.sucursal.create({ data: { nombre: "Sucursal B" } });
    const actor = await crearUsuarioConMembresia({ email: "actor@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    actorId = actor.id;
    await registrar(base.sucursal.id, "de A");
    await registrar(sucursalB.id, "de B");
    await registrar(null, "sin sucursal");
  });

  it("con las sucursales donde puede ver: trae esas filas y las de la empresa (sin sucursal), no las de otra", async () => {
    const { items } = await listarRegistrosAuditoria({ incluirFilasDeEmpresa: true, sucursalIds: [base.sucursal.id] }, prisma);
    expect(items.map((i) => i.descripcion).sort()).toEqual(["de A", "sin sucursal"]);
  });

  it("con todas las sucursales ve todas", async () => {
    const { items } = await listarRegistrosAuditoria({ incluirFilasDeEmpresa: true, sucursalIds: [base.sucursal.id, sucursalB.id] }, prisma);
    expect(items.map((i) => i.descripcion).sort()).toEqual(["de A", "de B", "sin sucursal"]);
  });

  it("sin ninguna sucursal visible solo quedan las filas sin sucursal", async () => {
    const { items } = await listarRegistrosAuditoria({ incluirFilasDeEmpresa: true, sucursalIds: [] }, prisma);
    expect(items.map((i) => i.descripcion)).toEqual(["sin sucursal"]);
  });

  it("sin incluirFilasDeEmpresa las filas sin sucursal no salen, aunque se vean todas las sucursales", async () => {
    const { items } = await listarRegistrosAuditoria({ incluirFilasDeEmpresa: false, sucursalIds: [base.sucursal.id, sucursalB.id] }, prisma);
    expect(items.map((i) => i.descripcion).sort()).toEqual(["de A", "de B"]);
  });

  it("sin sucursales visibles y sin filas de empresa no trae nada", async () => {
    const { items } = await listarRegistrosAuditoria({ incluirFilasDeEmpresa: false, sucursalIds: [] }, prisma);
    expect(items).toEqual([]);
  });

  it("el filtro de sucursales se combina con el de entidad y con el cursor de paginación", async () => {
    for (let i = 0; i < 55; i++) await registrar(base.sucursal.id, `A ${i}`);
    await registrar(sucursalB.id, "B extra");
    const primera = await listarRegistrosAuditoria({ entidad: "Producto", incluirFilasDeEmpresa: true, sucursalIds: [base.sucursal.id] }, prisma);
    expect(primera.items).toHaveLength(50);
    expect(primera.nextCursor).not.toBeNull();
    const segunda = await listarRegistrosAuditoria({ entidad: "Producto", incluirFilasDeEmpresa: true, sucursalIds: [base.sucursal.id], cursor: primera.nextCursor! }, prisma);
    const todas = [...primera.items, ...segunda.items].map((i) => i.descripcion);
    expect(todas).not.toContain("de B");
    expect(todas).not.toContain("B extra");
    expect(todas).toHaveLength(57);
  });

  describe("esGerenteDeEmpresa", () => {
    it("solo el rol de empresa «gerente» cuenta", () => {
      expect(esGerenteDeEmpresa("gerente")).toBe(true);
      expect(esGerenteDeEmpresa(null)).toBe(false);
      expect(esGerenteDeEmpresa("otro")).toBe(false);
    });
  });

  describe("sucursalesVisiblesDeAuditoria", () => {
    it("deja solo las sucursales donde el rol del usuario tiene ver_auditoria", async () => {
      const operadorEnB = await crearUsuarioConMembresia({ email: "mixto@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
      await crearMembresia({ usuarioId: operadorEnB.id, sucursalId: sucursalB.id, rolId: base.operador.id });

      const visibles = await sucursalesVisiblesDeAuditoria(operadorEnB.id, [base.sucursal.id, sucursalB.id], prisma);
      expect(visibles).toEqual([base.sucursal.id]);
    });
  });
});

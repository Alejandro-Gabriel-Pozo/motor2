import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { versionVigenteDeReceta } from "../setup/version-de-receta";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { quitarPasoDeReceta, agregarPasoAReceta } from "../../src/server/actions/catalogo/recetas";
import { guardarRecetaACiegas as guardarReceta } from "../../src/server/actions/catalogo/receta-a-ciegas";

/**
 * Paso 2 del plan (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, D6(b)): cada versión nueva de la receta CENTRAL
 * deja un registro de auditoría propio — `entidad: "RecetaVersion"`, `sucursalId: null` (alcance = Catálogo Central, no un
 * dato por sucursal), sin importar por cuál de las funciones puntuales (agregar/editar/quitar ingrediente o paso) se llegó,
 * porque todas delegan en `guardarReceta`.
 */
describe("Auditoría de la receta central (RecetaVersion)", () => {
  let sucursalId: string;
  let sucursalNombre: string;
  let unidadKgId: string;
  let adminId: string;
  let pv: { id: string; nombre: string };
  let mp: { id: string };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    sucursalNombre = base.sucursal.nombre;
    const { kg } = await sembrarCatalogoBase();
    unidadKgId = kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    mp = await sembrarProductoDisponible({ codigo: "MP_AUD", nombre: "Harina auditoría", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    pv = await sembrarProductoDisponible({ codigo: "PV_AUD", nombre: "Pizza auditoría", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
  });

  it("un guardado deja un registro (null → \"1\"), actor admin, sucursalId null, descripción con «guardada desde «<sucursal>»»", async () => {
    const r = await guardarReceta(pv.id, [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }]);
    expect(r.ok, r.mensaje).toBe(true);

    const version = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id } });
    const registros = await prisma.registroAuditoria.findMany({ where: { entidad: "RecetaVersion", entidadId: version.id } });
    expect(registros).toHaveLength(1);
    const registro = registros[0];
    expect(registro.campo).toBe("version");
    expect(registro.valorAnterior).toBeNull();
    expect(registro.valorNuevo).toBe("1");
    expect(registro.actorId).toBe(adminId);
    expect(registro.sucursalId).toBeNull();
    expect(registro.descripcion).toContain(`guardada desde "${sucursalNombre}"`);
  });

  it("un segundo guardado deja \"1\" → \"2\", con id de entidad distinto (la versión nueva)", async () => {
    await guardarReceta(pv.id, [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }]);
    const r2 = await guardarReceta(pv.id, [{ insumoProductoId: mp.id, cantidad: 2, unidadId: unidadKgId }]);
    expect(r2.ok, r2.mensaje).toBe(true);

    const versiones = await prisma.recetaVersion.findMany({ where: { productoId: pv.id }, orderBy: { version: "asc" } });
    expect(versiones.map((v) => v.version)).toEqual([1, 2]);

    const registroV2 = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "RecetaVersion", entidadId: versiones[1].id } });
    expect(registroV2.valorAnterior).toBe("1");
    expect(registroV2.valorNuevo).toBe("2");

    expect(await prisma.registroAuditoria.count({ where: { entidad: "RecetaVersion" } })).toBe(2);
  });

  it("una validación fallida no deja ningún registro de auditoría", async () => {
    const r = await guardarReceta(pv.id, []); // sin ingredientes: rechazado por validarIngredientes
    expect(r.ok).toBe(false);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "RecetaVersion" } })).toBe(0);
    expect(await prisma.recetaVersion.count({ where: { productoId: pv.id } })).toBe(0);
  });

  it("quitarPasoDeReceta (y cualquier acción puntual que delega en guardarReceta) también queda auditado", async () => {
    await guardarReceta(pv.id, [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }]);
    const conPaso = await agregarPasoAReceta(pv.id, { orden: 1, instruccion: "Amasar" }, await versionVigenteDeReceta(pv.id));
    expect(conPaso.ok, conPaso.mensaje).toBe(true);

    const r = await quitarPasoDeReceta(pv.id, 1, await versionVigenteDeReceta(pv.id));
    expect(r.ok, r.mensaje).toBe(true);

    // 3 versiones en total (alta + agregar paso + quitar paso) → 3 registros de auditoría, uno por versión, sin huecos.
    const versiones = await prisma.recetaVersion.findMany({ where: { productoId: pv.id }, orderBy: { version: "asc" } });
    expect(versiones.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "RecetaVersion" } })).toBe(3);
  });
});

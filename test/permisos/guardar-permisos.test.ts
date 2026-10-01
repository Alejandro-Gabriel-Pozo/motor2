import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarPermisos } from "../../src/server/actions/permisos/permisos";
import { esCeldaFija, mismoEstado, normalizarPermiso, SIN_PERMISO, textoEstado } from "../../src/core/permisos/matriz";

/**
 * Matriz de permisos con «Guardar»: todos los cambios juntos o ninguno, con «Ver ⊇ Editar», la salvaguarda del admin y detección de que otra persona
 * cambió algo mientras se editaba (decisión 6 de docs/grounding-lista-ver-editar-2026-09-18.md).
 */
describe("reglas de la matriz (puras)", () => {
  it("Ver ⊇ Editar: quien puede editar puede ver", () => {
    expect(normalizarPermiso("operador", "proceso_venta", { puedeVer: false, puedeEditar: true })).toEqual({ puedeVer: true, puedeEditar: true });
    expect(normalizarPermiso("operador", "proceso_venta", { puedeVer: true, puedeEditar: false })).toEqual({ puedeVer: true, puedeEditar: false });
    expect(normalizarPermiso("operador", "proceso_venta", SIN_PERMISO)).toEqual(SIN_PERMISO);
  });

  it("el admin siempre conserva Editar en gestion_permisos y gestion_usuarios; otros roles, no", () => {
    expect(esCeldaFija("admin", "gestion_permisos")).toBe(true);
    expect(esCeldaFija("admin", "gestion_usuarios")).toBe(true);
    expect(esCeldaFija("admin", "proceso_venta")).toBe(false);
    expect(esCeldaFija("operador", "gestion_permisos")).toBe(false);
    expect(normalizarPermiso("admin", "gestion_permisos", SIN_PERMISO)).toEqual({ puedeVer: true, puedeEditar: true });
  });

  it("textos del resumen y comparación de estados", () => {
    expect(textoEstado({ puedeVer: true, puedeEditar: true })).toBe("Ver y editar");
    expect(textoEstado({ puedeVer: true, puedeEditar: false })).toBe("Solo ver");
    expect(textoEstado(SIN_PERMISO)).toBe("Sin acceso");
    expect(mismoEstado(SIN_PERMISO, { puedeVer: false, puedeEditar: false })).toBe(true);
    expect(mismoEstado(SIN_PERMISO, { puedeVer: true, puedeEditar: false })).toBe(false);
  });
});

describe("guardarPermisos", () => {
  let adminRolId: string;
  let operadorRolId: string;

  const actual = async (rolId: string, accionClave: string) => {
    const f = await prisma.permisoRol.findUnique({ where: { rolId_accionClave: { rolId, accionClave } } });
    return f ? { puedeVer: f.puedeVer, puedeEditar: f.puedeEditar } : SIN_PERMISO;
  };
  const cambio = async (rolId: string, accionClave: string, nuevo: { puedeVer: boolean; puedeEditar: boolean }) => ({
    rolId,
    accionClave,
    anterior: await actual(rolId, accionClave),
    nuevo,
  });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    adminRolId = base.admin.id;
    operadorRolId = base.operador.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("guarda varios cambios juntos y deja un registro de auditoría por cada campo que cambió", async () => {
    const r = await guardarPermisos([
      await cambio(operadorRolId, "reporte_salud", { puedeVer: true, puedeEditar: true }),
      await cambio(operadorRolId, "reporte_vencimientos", { puedeVer: true, puedeEditar: false }),
    ]);

    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).toBe("2 permiso(s) guardado(s).");
    expect(await actual(operadorRolId, "reporte_salud")).toEqual({ puedeVer: true, puedeEditar: true });
    expect(await actual(operadorRolId, "reporte_vencimientos")).toEqual({ puedeVer: true, puedeEditar: false });

    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "PermisoRol" } });
    expect(auditoria.length).toBeGreaterThanOrEqual(2);
    expect(auditoria.every((a) => a.descripcion.includes("operador"))).toBe(true);
  });

  it("todo o nada: si un cambio del lote es inválido, no se aplica NINGUNO", async () => {
    const antes = await actual(operadorRolId, "reporte_salud");
    const r = await guardarPermisos([
      await cambio(operadorRolId, "reporte_salud", { puedeVer: true, puedeEditar: true }),
      { rolId: operadorRolId, accionClave: "accion_que_no_existe", anterior: SIN_PERMISO, nuevo: { puedeVer: true, puedeEditar: false } },
    ]);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("No se guardó nada");
    expect(await actual(operadorRolId, "reporte_salud")).toEqual(antes);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "PermisoRol" } })).toBe(0);
  });

  it("si otra persona cambió un permiso mientras se editaba, no se guarda nada (ni lo que no chocaba) y se dice cuál", async () => {
    const editando = [
      await cambio(operadorRolId, "reporte_salud", { puedeVer: true, puedeEditar: true }),
      await cambio(operadorRolId, "reporte_vencimientos", { puedeVer: true, puedeEditar: false }),
    ];
    // Mientras tanto, otra persona cambia reporte_vencimientos.
    await prisma.permisoRol.upsert({
      where: { rolId_accionClave: { rolId: operadorRolId, accionClave: "reporte_vencimientos" } },
      update: { puedeVer: true, puedeEditar: true },
      create: { rolId: operadorRolId, accionClave: "reporte_vencimientos", puedeVer: true, puedeEditar: true },
    });
    const stockAntes = editando[0].anterior;

    const r = await guardarPermisos(editando);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("Otra persona cambió");
    expect(r.mensaje).toContain("reporte_vencimientos");
    expect(r.mensaje).toContain("No se guardó nada");
    expect(await actual(operadorRolId, "reporte_salud")).toEqual(stockAntes); // lo que no chocaba tampoco se guardó
    expect(await actual(operadorRolId, "reporte_vencimientos")).toEqual({ puedeVer: true, puedeEditar: true }); // queda lo de la otra persona
  });

  it("aplica «Ver ⊇ Editar» al escribir: pedir Editar sin Ver guarda las dos", async () => {
    const r = await guardarPermisos([await cambio(operadorRolId, "reporte_salud", { puedeVer: false, puedeEditar: true })]);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await actual(operadorRolId, "reporte_salud")).toEqual({ puedeVer: true, puedeEditar: true });
  });

  it("la salvaguarda del admin: no se le puede quitar Editar en gestion_permisos, y un cambio que no cambia nada no se guarda", async () => {
    const r = await guardarPermisos([await cambio(adminRolId, "gestion_permisos", { puedeVer: true, puedeEditar: false })]);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe("No hay cambios para guardar.");
    expect(await actual(adminRolId, "gestion_permisos")).toEqual({ puedeVer: true, puedeEditar: true });
  });

  it("crea el permiso si el rol no tenía fila para esa acción", async () => {
    await prisma.permisoRol.deleteMany({ where: { rolId: operadorRolId, accionClave: "reporte_salud" } });
    const r = await guardarPermisos([{ rolId: operadorRolId, accionClave: "reporte_salud", anterior: SIN_PERMISO, nuevo: { puedeVer: true, puedeEditar: false } }]);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await actual(operadorRolId, "reporte_salud")).toEqual({ puedeVer: true, puedeEditar: false });
  });

  it("rechaza un rol desactivado, un lote vacío, celdas repetidas y datos mal formados", async () => {
    await prisma.rol.update({ where: { id: operadorRolId }, data: { activo: false } });
    expect((await guardarPermisos([await cambio(operadorRolId, "reporte_salud", { puedeVer: true, puedeEditar: false })])).ok).toBe(false);
    await prisma.rol.update({ where: { id: operadorRolId }, data: { activo: true } });

    expect((await guardarPermisos([])).mensaje).toBe("No hay cambios para guardar.");
    const uno = await cambio(operadorRolId, "reporte_salud", { puedeVer: true, puedeEditar: false });
    expect((await guardarPermisos([uno, uno])).mensaje).toBe("Hay dos cambios para la misma celda.");
    expect((await guardarPermisos([{ rolId: operadorRolId, accionClave: "reporte_salud", anterior: { puedeVer: "sí" }, nuevo: SIN_PERMISO } as never])).mensaje).toBe(
      "Los cambios no tienen el formato esperado."
    );
    expect((await guardarPermisos(null as never)).mensaje).toBe("No hay cambios para guardar.");
  });

  it("solo la puede usar quien tiene «Editar» de gestion_permisos", async () => {
    const base = await prisma.sucursal.findFirstOrThrow();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.id, rolId: operadorRolId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });

    const r = await guardarPermisos([await cambio(operadorRolId, "reporte_salud", { puedeVer: true, puedeEditar: true })]);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
  });
});

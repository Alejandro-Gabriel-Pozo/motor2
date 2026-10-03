import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { ACCIONES } from "../../src/core/permisos/acciones";

/**
 * La migración de datos 20260926012600_permiso_calibrar_rendimiento_local agrega a cualquier base existente la acción
 * `calibrar_rendimiento_local` y el permiso de admin (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 3b, D5).
 * Tiene que ser idempotente y no pisar nada que ya esté configurado. Se ejecuta acá sentencia por sentencia contra la base de
 * pruebas (mismo molde que migracion-permiso-carta.test.ts).
 */
const SQL = readFileSync(join(__dirname, "../../prisma/migrations/20260926012600_permiso_calibrar_rendimiento_local/migration.sql"), "utf8");
const SENTENCIAS = SQL.replace(/\r\n/g, "\n")
  .split(";\n")
  .map((s) =>
    s
      .split("\n")
      .filter((linea) => !linea.trim().startsWith("--"))
      .join("\n")
      .trim()
  )
  .filter((s) => s.length > 0);

async function correrMigracion() {
  for (const sentencia of SENTENCIAS) await prisma.$executeRawUnsafe(sentencia);
}

describe("migración de datos del permiso calibrar_rendimiento_local", () => {
  let adminId: string;
  let operadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    adminId = (await prisma.rol.create({ data: { nombre: "admin", clave: "admin" } })).id;
    operadorId = (await prisma.rol.create({ data: { nombre: "operador", clave: "operador" } })).id;
  });

  it("tiene las dos sentencias esperadas (la acción y el permiso de admin)", () => {
    expect(SENTENCIAS.length).toBe(2);
  });

  it("crea la acción y da Ver y Editar solo a admin; el operador queda sin asignar", async () => {
    await correrMigracion();

    expect(await prisma.accion.count({ where: { clave: "calibrar_rendimiento_local" } })).toBe(1);
    const deAdmin = await prisma.permisoRol.findMany({ where: { rolId: adminId } });
    expect(deAdmin.map((p) => p.accionClave)).toEqual(["calibrar_rendimiento_local"]);
    expect(deAdmin[0].puedeVer && deAdmin[0].puedeEditar).toBe(true);
    expect(await prisma.permisoRol.count({ where: { rolId: operadorId } })).toBe(0);
  });

  it("es idempotente: correrla dos veces no duplica ni falla", async () => {
    await correrMigracion();
    await correrMigracion();
    expect(await prisma.accion.count({ where: { clave: "calibrar_rendimiento_local" } })).toBe(1);
    expect(await prisma.permisoRol.count({ where: { rolId: adminId } })).toBe(1);
  });

  it("no pisa un permiso que ya estaba configurado a mano", async () => {
    await prisma.accion.create({ data: { clave: "calibrar_rendimiento_local", descripcion: "ya existía" } });
    await prisma.permisoRol.create({ data: { rolId: adminId, accionClave: "calibrar_rendimiento_local", puedeVer: true, puedeEditar: false } });

    await correrMigracion();

    const conservado = await prisma.permisoRol.findUniqueOrThrow({ where: { rolId_accionClave: { rolId: adminId, accionClave: "calibrar_rendimiento_local" } } });
    expect(conservado.puedeEditar).toBe(false);
    expect((await prisma.accion.findUniqueOrThrow({ where: { clave: "calibrar_rendimiento_local" } })).descripcion).toBe("ya existía");
  });

  it("coincide con lo que declara la fuente única de acciones (la descripción y el rol semilla)", () => {
    const accion = ACCIONES.find((a) => a.clave === "calibrar_rendimiento_local");
    expect(accion, "calibrar_rendimiento_local tiene que estar en ACCIONES").toBeDefined();
    expect(accion!.rolesEditarSemilla).toEqual(["admin"]);
    expect(SQL).toContain(`'${accion!.descripcion}'`);
  });
});

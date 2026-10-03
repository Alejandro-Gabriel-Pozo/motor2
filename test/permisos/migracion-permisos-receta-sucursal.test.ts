import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Migración de datos 20261002140000_permisos_receta_sucursal: da de alta las tres acciones de la receta propia por sucursal (una clave por
 * acción, ADR-008) y se las asigna a los roles «admin» de cada empresa; el operador no las recibe.
 */
const CLAVES = ["receta_sucursal_editar", "receta_sucursal_copiar", "receta_sucursal_volver_central"] as const;
const CARPETA = join(__dirname, "../../prisma/migrations/20261002140000_permisos_receta_sucursal");

function sentencias(archivo: string): string[] {
  return readFileSync(join(CARPETA, archivo), "utf8")
    .replace(/\r\n/g, "\n")
    .split(";\n")
    .map((s) =>
      s
        .split("\n")
        .filter((linea) => !linea.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0);
}

async function correr(archivo: string) {
  for (const sentencia of sentencias(archivo)) await prismaAdmin.$executeRawUnsafe(sentencia);
}

describe("migración de datos: acciones de la receta propia por sucursal", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("son tres acciones de contexto sucursal (editar de nivel operario, las otras de administrador) en el catálogo del código, semilla solo para admin", () => {
    for (const clave of CLAVES) {
      expect(ACCIONES.find((a) => a.clave === clave), clave).toMatchObject({ contexto: "sucursal", nivelMinimo: clave === "receta_sucursal_editar" ? "operario" : "administrador", rolesEditarSemilla: ["admin"] });
    }
  });

  it("da de alta las tres acciones con la misma descripción que el catálogo del código, y es idempotente", async () => {
    await correr("migration.sql");
    await correr("migration.sql");
    const filas = await prismaAdmin.accion.findMany({ where: { clave: { in: [...CLAVES] } }, orderBy: { clave: "asc" } });
    expect(filas.map((f) => [f.clave, f.descripcion])).toEqual(
      [...CLAVES].sort().map((clave) => [clave, ACCIONES.find((a) => a.clave === clave)?.descripcion])
    );
  });

  it("se las da (ver y editar) al rol admin y a ningún otro", async () => {
    const admin = await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId: EMPRESA_POR_DEFECTO_ID } });
    const operador = await prismaAdmin.rol.create({ data: { nombre: "operador", empresaId: EMPRESA_POR_DEFECTO_ID } });
    await correr("migration.sql");
    await correr("migration.sql");

    const deAdmin = await prismaAdmin.permisoRol.findMany({ where: { rolId: admin.id, accionClave: { in: [...CLAVES] } } });
    expect(deAdmin).toHaveLength(3);
    expect(deAdmin.every((p) => p.puedeVer && p.puedeEditar)).toBe(true);
    expect(await prismaAdmin.permisoRol.count({ where: { rolId: operador.id, accionClave: { in: [...CLAVES] } } })).toBe(0);
  });

  it("no pisa un permiso ya configurado del admin", async () => {
    const admin = await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId: EMPRESA_POR_DEFECTO_ID } });
    await prismaAdmin.accion.create({ data: { clave: "receta_sucursal_copiar", descripcion: "x" } });
    await prismaAdmin.permisoRol.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, rolId: admin.id, accionClave: "receta_sucursal_copiar", puedeVer: true, puedeEditar: false } });
    await correr("migration.sql");
    const fila = await prismaAdmin.permisoRol.findFirstOrThrow({ where: { rolId: admin.id, accionClave: "receta_sucursal_copiar" } });
    expect(fila.puedeEditar).toBe(false);
  });

  it("la reversa borra las acciones y todo lo configurado sobre ellas", async () => {
    const admin = await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId: EMPRESA_POR_DEFECTO_ID } });
    await correr("migration.sql");
    await correr("down.sql");
    expect(await prismaAdmin.accion.count({ where: { clave: { in: [...CLAVES] } } })).toBe(0);
    expect(await prismaAdmin.permisoRol.count({ where: { rolId: admin.id, accionClave: { in: [...CLAVES] } } })).toBe(0);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Migración de datos 20261002120000_permiso_traspasar_gerencia: da de alta `traspasar_gerencia` (piso gerente, sin padre). Antes el traspaso lo
 * gateaba un `esGerenteDeEmpresa` suelto; ahora es una clave del catálogo, y ningún rol la recibe: la tiene solo el gerente, sin matriz.
 */
const CLAVE = "traspasar_gerencia";
const CARPETA = join(__dirname, "../../prisma/migrations/20261002120000_permiso_traspasar_gerencia");

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

describe("migración de datos: acción «traspasar_gerencia»", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("es de piso gerente y de contexto empresa en el catálogo del código, sin rol que la edite desde el arranque", () => {
    const accion = ACCIONES.find((a) => a.clave === CLAVE);
    expect(accion).toMatchObject({ contexto: "empresa", nivelMinimo: "gerente", rolesEditarSemilla: [] });
  });

  it("da de alta la acción con la misma descripción que el catálogo del código, y es idempotente", async () => {
    await correr("migration.sql");
    await correr("migration.sql");
    const filas = await prismaAdmin.accion.findMany({ where: { clave: CLAVE } });
    expect(filas.map((f) => f.descripcion)).toEqual([ACCIONES.find((a) => a.clave === CLAVE)?.descripcion]);
  });

  it("no asigna la acción a ningún rol ni sucursal (la tiene solo el gerente, sin pasar por la matriz)", async () => {
    const rol = await prismaAdmin.rol.create({ data: { nombre: "admin", clave: "admin", empresaId: EMPRESA_POR_DEFECTO_ID } });
    await prismaAdmin.accion.create({ data: { clave: "gestion_usuarios", descripcion: "x" } });
    await prismaAdmin.permisoRol.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, rolId: rol.id, accionClave: "gestion_usuarios", puedeVer: true, puedeEditar: true } });
    await correr("migration.sql");
    expect(await prismaAdmin.permisoRol.count({ where: { accionClave: CLAVE } })).toBe(0);
    expect(await prismaAdmin.capacidadSucursal.count({ where: { accionClave: CLAVE } })).toBe(0);
  });

  it("la reversa borra la acción y todo lo configurado sobre ella", async () => {
    await correr("migration.sql");
    const rol = await prismaAdmin.rol.create({ data: { nombre: "admin", clave: "admin", empresaId: EMPRESA_POR_DEFECTO_ID } });
    await prismaAdmin.permisoRol.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, rolId: rol.id, accionClave: CLAVE, puedeVer: true, puedeEditar: true } });
    await correr("down.sql");
    expect(await prismaAdmin.accion.count({ where: { clave: CLAVE } })).toBe(0);
    expect(await prismaAdmin.permisoRol.count({ where: { accionClave: CLAVE } })).toBe(0);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Migración de datos 20261002150500_permiso_carta_copiar_de_sucursal: da de alta la acción de copiar a la sucursal activa la carta propia de
 * otra sucursal (una clave por acción, ADR-008) y se la asigna a los roles «admin» de cada empresa; el operador no la recibe.
 */
const CLAVE = "carta_copiar_de_sucursal";
const CARPETA = join(__dirname, "../../prisma/migrations/20261002150500_permiso_carta_copiar_de_sucursal");

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

describe("migración de datos: acción de copiar la carta de otra sucursal", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("es una acción de contexto sucursal y nivel administrador en el catálogo del código, semilla solo para admin", () => {
    expect(ACCIONES.find((a) => a.clave === CLAVE)).toMatchObject({ contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] });
  });

  it("da de alta la acción con la misma descripción que el catálogo del código, y es idempotente", async () => {
    await correr("migration.sql");
    await correr("migration.sql");
    const filas = await prismaAdmin.accion.findMany({ where: { clave: CLAVE } });
    expect(filas.map((f) => [f.clave, f.descripcion])).toEqual([[CLAVE, ACCIONES.find((a) => a.clave === CLAVE)?.descripcion]]);
  });

  it("se la da (ver y editar) al rol admin y a ningún otro", async () => {
    const admin = await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId: EMPRESA_POR_DEFECTO_ID } });
    const operador = await prismaAdmin.rol.create({ data: { nombre: "operador", empresaId: EMPRESA_POR_DEFECTO_ID } });
    await correr("migration.sql");
    await correr("migration.sql");

    const deAdmin = await prismaAdmin.permisoRol.findMany({ where: { rolId: admin.id, accionClave: CLAVE } });
    expect(deAdmin).toHaveLength(1);
    expect(deAdmin[0]).toMatchObject({ puedeVer: true, puedeEditar: true });
    expect(await prismaAdmin.permisoRol.count({ where: { rolId: operador.id, accionClave: CLAVE } })).toBe(0);
  });

  it("no pisa un permiso ya configurado del admin", async () => {
    const admin = await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId: EMPRESA_POR_DEFECTO_ID } });
    await prismaAdmin.accion.create({ data: { clave: CLAVE, descripcion: "x" } });
    await prismaAdmin.permisoRol.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, rolId: admin.id, accionClave: CLAVE, puedeVer: true, puedeEditar: false } });
    await correr("migration.sql");
    const fila = await prismaAdmin.permisoRol.findFirstOrThrow({ where: { rolId: admin.id, accionClave: CLAVE } });
    expect(fila.puedeEditar).toBe(false);
  });

  it("la reversa borra la acción y todo lo configurado sobre ella", async () => {
    const admin = await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId: EMPRESA_POR_DEFECTO_ID } });
    await correr("migration.sql");
    await correr("down.sql");
    expect(await prismaAdmin.accion.count({ where: { clave: CLAVE } })).toBe(0);
    expect(await prismaAdmin.permisoRol.count({ where: { rolId: admin.id, accionClave: CLAVE } })).toBe(0);
  });
});

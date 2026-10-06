import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * La migración de datos 20260919120000_permisos_reportes_y_acciones_faltantes agrega a cualquier base existente (entre ellas
 * la del cliente, que no tenía ver_auditoria, pagar_consignante ni anular_venta) las acciones y el permiso de admin. Tiene que
 * ser idempotente y no pisar nada que ya esté configurado. Se ejecuta acá sentencia por sentencia contra la base de pruebas.
 */
const SQL = readFileSync(join(__dirname, "../../prisma/migrations/20260919120000_permisos_reportes_y_acciones_faltantes/migration.sql"), "utf8");
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

const NUEVAS = ["anular_venta", "pagar_consignante", "ver_auditoria", "ver_reportes_dinero", "ver_reportes_control", "ver_reportes_operativos", "ver_reportes_catalogo"];

async function correrMigracion() {
  for (const sentencia of SENTENCIAS) await prisma.$executeRawUnsafe(sentencia);
}

describe("migración de datos de permisos de reportes", () => {
  let adminId: string;
  let operadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    adminId = (await prisma.rol.create({ data: { nombre: "admin", clave: "admin" } })).id;
    operadorId = (await prisma.rol.create({ data: { nombre: "operador", clave: "operador" } })).id;
  });

  it("tiene las dos sentencias esperadas (acciones y permisos de admin)", () => {
    expect(SENTENCIAS.length).toBe(2);
  });

  it("crea las 7 acciones y da Ver y Editar solo a admin; el operador queda sin asignar", async () => {
    await correrMigracion();

    expect((await prisma.accion.findMany({ where: { clave: { in: NUEVAS } } })).length).toBe(7);
    const deAdmin = await prisma.permisoRol.findMany({ where: { rolId: adminId } });
    expect(deAdmin.map((p) => p.accionClave).sort()).toEqual([...NUEVAS].sort());
    expect(deAdmin.every((p) => p.puedeVer && p.puedeEditar)).toBe(true);
    expect(await prisma.permisoRol.count({ where: { rolId: operadorId } })).toBe(0);
  });

  it("es idempotente: correrla dos veces no duplica ni falla", async () => {
    await correrMigracion();
    await correrMigracion();
    expect(await prisma.accion.count({ where: { clave: { in: NUEVAS } } })).toBe(7);
    expect(await prisma.permisoRol.count({ where: { rolId: adminId } })).toBe(7);
  });

  it("no pisa un permiso que ya estaba configurado a mano", async () => {
    await prisma.accion.create({ data: { clave: "ver_reportes_dinero", descripcion: "ya existía" } });
    await prisma.permisoRol.create({ data: { rolId: adminId, accionClave: "ver_reportes_dinero", puedeVer: false, puedeEditar: false } });

    await correrMigracion();

    const conservado = await prisma.permisoRol.findUniqueOrThrow({ where: { rolId_accionClave: { rolId: adminId, accionClave: "ver_reportes_dinero" } } });
    expect(conservado.puedeVer).toBe(false);
    expect((await prisma.accion.findUniqueOrThrow({ where: { clave: "ver_reportes_dinero" } })).descripcion).toBe("ya existía");
  });
});

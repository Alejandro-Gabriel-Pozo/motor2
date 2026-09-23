import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * La migración 20260923103945_disponibilidad_producto crea DisponibilidadProducto y hace el backfill: una fila por cada
 * (Producto × Sucursal) existente, con `disponible` = el `Producto.activo` de origen (decisión 1 del plan: "inactivo en todas"
 * tiene que seguir significando lo mismo que hoy después de la migración). Se ejecuta sentencia por sentencia contra la base de
 * pruebas (mismo molde que migracion-permiso-anular-compra.test.ts), DESPUÉS de sembrar productos/sucursales a mano — el
 * CREATE TABLE de la migración real ya corrió una vez al aplicarla con `prisma migrate dev`, así que acá se recrea el escenario
 * "antes del backfill" borrando la tabla primero.
 */
const SQL = readFileSync(join(__dirname, "../../prisma/migrations/20260923103945_disponibilidad_producto/migration.sql"), "utf8");
const SENTENCIA_BACKFILL = SQL.replace(/\r\n/g, "\n")
  .split(";\n")
  .map((s) =>
    s
      .split("\n")
      .filter((linea) => !linea.trim().startsWith("--"))
      .join("\n")
      .trim()
  )
  .filter((s) => s.length > 0)
  .find((s) => s.startsWith("INSERT INTO"))!;

describe("migración de datos de DisponibilidadProducto (backfill)", () => {
  let sucursalA: string;
  let sucursalB: string;
  let productoActivo: string;
  let productoInactivo: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const kg = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    sucursalA = (await prisma.sucursal.create({ data: { nombre: "Sucursal A" } })).id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Sucursal B", activo: false } })).id;
    productoActivo = (await prisma.producto.create({ data: { codigo: "MIG_ACTIVO", nombre: "Activo", tipo: "MP", unidadStockId: kg.id, activo: true } })).id;
    productoInactivo = (await prisma.producto.create({ data: { codigo: "MIG_INACTIVO", nombre: "Inactivo", tipo: "MP", unidadStockId: kg.id, activo: false } })).id;
  });

  it("existe la sentencia de backfill en la migración", () => {
    expect(SENTENCIA_BACKFILL).toBeDefined();
    expect(SENTENCIA_BACKFILL).toContain("CROSS JOIN");
  });

  it("crea una fila por cada (Producto × Sucursal), con `disponible` = el `activo` de origen", async () => {
    await prisma.$executeRawUnsafe(SENTENCIA_BACKFILL);

    const filas = await prisma.disponibilidadProducto.findMany();
    expect(filas).toHaveLength(4); // 2 productos × 2 sucursales

    const de = (productoId: string, sucursalId: string) => filas.find((f) => f.productoId === productoId && f.sucursalId === sucursalId)!.disponible;
    expect(de(productoActivo, sucursalA)).toBe(true);
    expect(de(productoActivo, sucursalB)).toBe(true);
    expect(de(productoInactivo, sucursalA)).toBe(false);
    expect(de(productoInactivo, sucursalB)).toBe(false);
  });

  it("incluye sucursales con activo=false (se puede volver a prender y su catálogo sigue ahí)", async () => {
    await prisma.$executeRawUnsafe(SENTENCIA_BACKFILL);
    const filasDeB = await prisma.disponibilidadProducto.findMany({ where: { sucursalId: sucursalB } });
    expect(filasDeB).toHaveLength(2);
  });
});

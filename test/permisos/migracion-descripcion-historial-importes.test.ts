import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Migración de datos 20261002100000_descripcion_historial_importes: la clave `reporte_historial_importes` pasa a cubrir también el proveedor y
 * el N.º de factura del Historial de un producto, y la descripción que ve quien asigna el permiso tiene que decirlo. Solo toca esa fila de
 * `Accion`: no crea ni mueve permisos concedidos.
 */
const CLAVE = "reporte_historial_importes";
const DESCRIPCION_ANTERIOR = "Ver los importes (precios de compra y de venta) dentro del reporte «Historial de un producto»";
const CARPETA = join(__dirname, "../../prisma/migrations/20261002100000_descripcion_historial_importes");

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

const descripcionGuardada = async (clave: string) => (await prismaAdmin.accion.findUniqueOrThrow({ where: { clave } })).descripcion;

describe("migración de datos: descripción de «reporte_historial_importes»", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    await prismaAdmin.accion.createMany({
      data: [
        { clave: CLAVE, descripcion: DESCRIPCION_ANTERIOR },
        { clave: "reporte_perdidas", descripcion: "Ver el reporte «Pérdidas»" },
      ],
    });
  });

  it("deja en la fila la misma descripción que el catálogo del código, y no toca otras acciones", async () => {
    await correr("migration.sql");
    expect(await descripcionGuardada(CLAVE)).toBe(ACCIONES.find((a) => a.clave === CLAVE)?.descripcion);
    expect(await descripcionGuardada(CLAVE)).toMatch(/proveedor y N\.º de factura/);
    expect(await descripcionGuardada("reporte_perdidas")).toBe("Ver el reporte «Pérdidas»");
  });

  it("es idempotente, y no falla en una base donde la acción todavía no existe", async () => {
    await correr("migration.sql");
    await correr("migration.sql");
    expect(await prismaAdmin.accion.count({ where: { clave: CLAVE } })).toBe(1);

    await limpiarBaseDeTest();
    await correr("migration.sql");
    expect(await prismaAdmin.accion.count({ where: { clave: CLAVE } })).toBe(0);
  });

  it("la reversa vuelve a la descripción anterior", async () => {
    await correr("migration.sql");
    await correr("down.sql");
    expect(await descripcionGuardada(CLAVE)).toBe(DESCRIPCION_ANTERIOR);
  });
});

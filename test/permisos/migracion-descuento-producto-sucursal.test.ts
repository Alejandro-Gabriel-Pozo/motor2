import { describe, expect, it } from "vitest";
import { prismaAdmin } from "../setup/test-db";
import { probarMigracionDeParticion } from "./particion-migracion-harness";

/**
 * Migración 20261001190000_descuento_producto_sucursal: el producto con descuento (un % por producto y sucursal). La parte de DATOS de permisos (la
 * clave nueva `carta_producto_descuento` copia lo que cada rol ya tenía en `carta_contenido_producto`) usa el mismo banco de pruebas que las demás;
 * la parte de schema se comprueba contra la base ya migrada.
 */
probarMigracionDeParticion({
  directorio: "20261001190000_descuento_producto_sucursal",
  titulo: "clave del descuento de producto de la carta",
  desdeMarca: "-- Permisos (datos): clave nueva `carta_producto_descuento`.",
  sentenciasEsperadas: 3,
  // El padre es de contexto empresa y la hija de sucursal: estrechamiento deliberado (quien editaba el contenido de carta en toda la empresa
  // puede fijar el descuento, que se ejerce en la sucursal activa). No da un permiso que antes no tuviera.
  contextoDePadres: { carta_contenido_producto: "mixto" },
});

describe("migración 20261001190000_descuento_producto_sucursal: estado del schema", () => {
  it("la tabla DescuentoProductoSucursal existe con su clave natural única por producto y sucursal", async () => {
    const cols = (await prismaAdmin.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'DescuentoProductoSucursal'`)).map((c) => c.column_name);
    expect(cols).toEqual(expect.arrayContaining(["productoId", "sucursalId", "porcentaje", "empresaId"]));
    const unicos = await prismaAdmin.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'DescuentoProductoSucursal' AND indexdef LIKE 'CREATE UNIQUE%'`
    );
    expect(unicos.some((i) => i.indexdef.includes('"productoId"') && i.indexdef.includes('"sucursalId"'))).toBe(true);
  });

  it("tiene RLS por empresa como el resto de las tablas con empresaId", async () => {
    const r = await prismaAdmin.$queryRawUnsafe<{ rls: boolean; politicas: bigint }[]>(
      `SELECT c.relrowsecurity AS rls, (SELECT count(*) FROM pg_policies p WHERE p.tablename = 'DescuentoProductoSucursal' AND p.policyname = 'aislamiento_empresa') AS politicas FROM pg_class c WHERE c.relname = 'DescuentoProductoSucursal'`
    );
    expect(r[0].rls).toBe(true);
    expect(Number(r[0].politicas)).toBe(1);
  });
});

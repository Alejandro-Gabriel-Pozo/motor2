import { describe, expect, it } from "vitest";
import { prismaAdmin } from "../setup/test-db";
import { probarMigracionDeParticion } from "./particion-migracion-harness";

/**
 * Migración 20261001180000_promo_de_empresa: la promo pasa a definirse una vez por empresa y se prende por sucursal. La parte de DATOS de permisos
 * (la clave `carta_promos` se parte en definir/activar/precio local) usa el mismo banco de pruebas que las demás particiones; la parte de schema
 * se comprueba contra la base ya migrada.
 */
probarMigracionDeParticion({
  directorio: "20261001180000_promo_de_empresa",
  titulo: "partición de la clave de las promos de la carta",
  desdeMarca: "-- Permisos (datos): partición de `carta_promos`.",
  sentenciasEsperadas: 3,
  contextoDePadres: { carta_promos: "mixto" },
});

describe("migración 20261001180000_promo_de_empresa: estado del schema", () => {
  const columnas = async (tabla: string) =>
    (await prismaAdmin.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_name = '${tabla}'`)).map((c) => c.column_name);

  it("la promo ya no es de una sucursal: PromoCarta no tiene sucursalId y existe PromoCartaSucursal con el precio local", async () => {
    expect(await columnas("PromoCarta")).not.toContain("sucursalId");
    const sucursal = await columnas("PromoCartaSucursal");
    expect(sucursal).toEqual(expect.arrayContaining(["promoCartaId", "sucursalId", "activa", "precioLocal", "empresaId"]));
  });

  it("desaparecen la marca de reporte PromocionProducto y el apagador Sucursal.promocionesHabilitadas", async () => {
    const tabla = await prismaAdmin.$queryRawUnsafe<{ t: string | null }[]>(`SELECT to_regclass('"PromocionProducto"')::text AS t`);
    expect(tabla[0].t).toBeNull();
    expect(await columnas("Sucursal")).not.toContain("promocionesHabilitadas");
  });

  it("PromoCartaSucursal tiene RLS por empresa como el resto de las tablas con empresaId", async () => {
    const r = await prismaAdmin.$queryRawUnsafe<{ rls: boolean; politicas: bigint }[]>(
      `SELECT c.relrowsecurity AS rls, (SELECT count(*) FROM pg_policies p WHERE p.tablename = 'PromoCartaSucursal' AND p.policyname = 'aislamiento_empresa') AS politicas FROM pg_class c WHERE c.relname = 'PromoCartaSucursal'`
    );
    expect(r[0].rls).toBe(true);
    expect(Number(r[0].politicas)).toBe(1);
  });
});

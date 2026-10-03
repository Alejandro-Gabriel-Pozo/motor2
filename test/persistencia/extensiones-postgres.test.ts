import { afterAll, describe, expect, it } from "vitest";
import { prisma, prismaAdmin } from "../setup/test-db";

/**
 * Migración 20261003120000_extensiones_btree_gist_trgm_unaccent: las tres extensiones están instaladas y cumplen lo que se las activó para hacer,
 * también para el rol de la aplicación (`motor2_app`, el de `prisma`). Las tablas son temporales: no queda nada en la base.
 */
afterAll(() => prismaAdmin.$disconnect());

describe("extensiones de Postgres", () => {
  it("btree_gist, pg_trgm y unaccent están instaladas", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ extname: string }>>`SELECT extname::text FROM pg_extension WHERE extname IN ('btree_gist', 'pg_trgm', 'unaccent') ORDER BY 1`;
    expect(filas.map((f) => f.extname)).toEqual(["btree_gist", "pg_trgm", "unaccent"]);
  });

  it("unaccent: «jamon» encuentra «Jamón» (y al revés)", async () => {
    const [r] = await prisma.$queryRaw<Array<{ a: boolean; b: boolean }>>`SELECT unaccent('Jamón') ILIKE unaccent('%jamon%') AS a, unaccent('JAMON') ILIKE unaccent('%jamón%') AS b`;
    expect(r).toEqual({ a: true, b: true });
  });

  it("pg_trgm: un error de tipeo sigue siendo parecido; un nombre distinto no", async () => {
    const [r] = await prisma.$queryRaw<Array<{ parecido: number; distinto: number }>>`SELECT similarity('mozzarella', 'mozarela') AS parecido, similarity('mozzarella', 'cerveza') AS distinto`;
    expect(r!.parecido).toBeGreaterThan(0.3);
    expect(r!.distinto).toBeLessThan(0.1);
  });

  it("btree_gist: la base rechaza dos períodos superpuestos del mismo recurso y deja pasar el de otro recurso o el contiguo", async () => {
    await prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE reserva_prueba (empresa text, recurso text, periodo tstzrange, EXCLUDE USING gist (empresa WITH =, recurso WITH =, periodo WITH &&)) ON COMMIT DROP`);
      const insertar = (recurso: string, desde: string, hasta: string) =>
        tx.$executeRawUnsafe(`INSERT INTO reserva_prueba VALUES ('e1', $1, tstzrange($2::timestamptz, $3::timestamptz))`, recurso, desde, hasta);
      await insertar("mesa-1", "2026-11-01T20:00Z", "2026-11-01T22:00Z");
      await insertar("mesa-2", "2026-11-01T21:00Z", "2026-11-01T23:00Z");
      await insertar("mesa-1", "2026-11-01T22:00Z", "2026-11-01T23:00Z");
      await tx.$executeRawUnsafe("SAVEPOINT antes_del_choque");
      await expect(insertar("mesa-1", "2026-11-01T21:30Z", "2026-11-01T22:30Z")).rejects.toThrow(/reserva_prueba_empresa_recurso_periodo_excl|exclusion/i);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT antes_del_choque");
    });
  });
});

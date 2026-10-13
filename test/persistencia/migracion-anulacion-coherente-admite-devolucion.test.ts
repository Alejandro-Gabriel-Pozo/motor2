import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Paquete 4, M6.3 — migración 20261018102000_anulacion_coherente_admite_devolucion: la regla `Operacion_anulacion_coherente_chk` admite anular una `DEVOLUCION_PROVEEDOR` (además de la VENTA y la COMPRA), contra una base real.
 *
 * Se corre sobre una base TEMPORAL armada migración por migración (todas las anteriores a la nuestra aplicadas, la nuestra a mano): así se ve la definición de antes, la de después y que la reversa deja EXACTAMENTE la de antes.
 * Qué se mide: la definición nueva (validada); que una devolución anulada entra y que AJUSTE, MERMA y TRANSFERENCIA_SALIDA_SUCURSAL anuladas siguen dando 23514 (como «quién anuló» sin «cuándo»); que la reversa ABORTA con una devolución
 * anulada y, sin ella, deja la definición idéntica a la de 20261002160000; y que volver a correr cualquiera de los dos sentidos es idempotente. La corrección de la prueba que vuelve a correr la migración ORIGINAL sobre la base compartida
 * (y deja la definición vieja) está en `reglas-operacion-movimiento.test.ts`.
 *
 * Mutaciones demostradas (ver las filas O.286 a O.299 de docs/pureza-integracion.md): M6.3 sin `DEVOLUCION_PROVEEDOR` en la lista, y el down sin su guarda.
 */
const NOMBRE = "20261018102000_anulacion_coherente_admite_devolucion";
const CHECK = "Operacion_anulacion_coherente_chk";
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");

describe("migración M6.3: la anulación admite la devolución a un proveedor", () => {
  let base: BaseTemporalMigrada;
  let definicionAnterior: string;
  let secuencia = 0;

  const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);
  const definicion = async () => (await q(`SELECT pg_get_constraintdef(oid) AS d, convalidated AS v FROM pg_constraint WHERE conname = $1 AND conrelid = '"Operacion"'::regclass`, [CHECK])).rows as Array<{ d: string; v: boolean }>;
  /** Inserta una operación (como dueño) y devuelve su error, si lo hubo (código y restricción). */
  const insertar = async (proceso: string, anulada: boolean, soloQuien = false) => {
    const id = `op-${++secuencia}`;
    try {
      await q(
        `INSERT INTO "Operacion" ("id", "empresaId", "sucursalId", "proceso", "fecha", "usuarioId", "anuladaEn", "anuladaPorId") VALUES ($1, 'emp-a', 'suc-a', $2::"Proceso", now(), 'usr-a', $3, $4)`,
        [id, proceso, anulada ? new Date() : null, anulada || soloQuien ? "usr-a" : null]
      );
      return { id, error: null as null | { codigo: string; restriccion: string } };
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      return { id, error: { codigo: err.code ?? "?", restriccion: err.constraint ?? "?" } };
    }
  };

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(NOMBRE);
    definicionAnterior = (await definicion())[0]!.d;
    await q(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ('emp-a', 'A', 'emp-a', 'America/Argentina/Buenos_Aires', 'ARS')`);
    await q(`INSERT INTO "User" ("id", "email") VALUES ('usr-a', 'a@test.com')`);
    await q(`INSERT INTO "Sucursal" ("id", "empresaId", "nombre") VALUES ('suc-a', 'emp-a', 'Central')`);
  }, 240_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("antes de la migración la regla solo admite VENTA y COMPRA: una devolución anulada da 23514", async () => {
    expect(definicionAnterior).toContain("'VENTA'");
    expect(definicionAnterior).not.toContain("DEVOLUCION_PROVEEDOR");
    expect((await insertar("DEVOLUCION_PROVEEDOR", true)).error).toEqual({ codigo: "23514", restriccion: CHECK });
  });

  it("la migración deja la regla con DEVOLUCION_PROVEEDOR, validada, y es idempotente (se puede correr dos veces)", async () => {
    await q(leer("migration.sql"));
    await q(leer("migration.sql"));
    const filas = await definicion();
    expect(filas).toHaveLength(1);
    expect(filas[0]!.v).toBe(true);
    expect(filas[0]!.d).toContain("DEVOLUCION_PROVEEDOR");
    expect(filas[0]!.d).toContain("'VENTA'");
    expect(filas[0]!.d).toContain("'COMPRA'");
  });

  it("una DEVOLUCION_PROVEEDOR anulada entra; AJUSTE, MERMA y TRANSFERENCIA_SALIDA_SUCURSAL anuladas siguen dando 23514; y «quién anuló» sin «cuándo» sigue sin existir", async () => {
    expect((await insertar("DEVOLUCION_PROVEEDOR", true)).error).toBeNull();
    expect((await insertar("VENTA", true)).error).toBeNull();
    expect((await insertar("COMPRA", true)).error).toBeNull();
    for (const proceso of ["AJUSTE", "MERMA", "TRANSFERENCIA_SALIDA_SUCURSAL", "CONSUMO", "PRODUCCION"]) {
      expect((await insertar(proceso, true)).error, proceso).toEqual({ codigo: "23514", restriccion: CHECK });
    }
    expect((await insertar("DEVOLUCION_PROVEEDOR", false, true)).error, "anuladaPorId sin anuladaEn").toEqual({ codigo: "23514", restriccion: CHECK });
    expect((await insertar("DEVOLUCION_PROVEEDOR", false)).error, "una devolución vigente").toBeNull();
  });

  it("la reversa ABORTA, sin tocar nada, si hay una devolución anulada", async () => {
    await expect(q(leer("down.sql"))).rejects.toThrow(/No se puede bajar M6\.3: hay \d+ devolución/);
    const filas = await definicion();
    expect(filas).toHaveLength(1);
    expect(filas[0]!.d).toContain("DEVOLUCION_PROVEEDOR");
    expect(Number((await q(`SELECT count(*) AS n FROM "Operacion" WHERE proceso = 'DEVOLUCION_PROVEEDOR' AND "anuladaEn" IS NOT NULL`)).rows[0].n)).toBeGreaterThan(0);
  });

  it("sin devoluciones anuladas, la reversa deja EXACTAMENTE la definición de 20261002160000 (validada) y se puede correr dos veces; volver a subir la deja como antes", async () => {
    await q(`UPDATE "Operacion" SET "anuladaEn" = NULL, "anuladaPorId" = NULL WHERE proceso = 'DEVOLUCION_PROVEEDOR'`);
    await q(leer("down.sql"));
    await q(leer("down.sql"));
    const abajo = await definicion();
    expect(abajo).toHaveLength(1);
    expect(abajo[0]!.d).toBe(definicionAnterior);
    expect(abajo[0]!.v).toBe(true);
    expect((await insertar("DEVOLUCION_PROVEEDOR", true)).error).toEqual({ codigo: "23514", restriccion: CHECK });
    await q(leer("migration.sql"));
    expect((await definicion())[0]!.d).toContain("DEVOLUCION_PROVEEDOR");
    expect((await insertar("DEVOLUCION_PROVEEDOR", true)).error).toBeNull();
  });

  it("el migration.sql y el down.sql avisan que requieren autorización y que la reversa aborta, el migration.sql no tiene bloques DO y ninguno se disfraza de migración de políticas de sucursal", () => {
    const subida = leer("migration.sql");
    const reversa = leer("down.sql");
    expect(subida.split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(reversa).toMatch(/ABORTA/);
    expect(subida, "la prueba de reglas-operacion-movimiento parte el archivo por ';\\n': sin bloques DO").not.toMatch(/\bDO\s+\$\$/);
    for (const sql of [subida, reversa]) {
      expect(sql).not.toContain("alcance_sucursal_");
      expect(sql).not.toContain("app_sucursales_");
    }
  });
});

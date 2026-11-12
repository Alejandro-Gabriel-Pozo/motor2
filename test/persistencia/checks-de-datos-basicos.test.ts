import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID } from "../setup/empresa-de-prueba";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Migración 20261112160000_checks_de_datos_basicos (paso 10 de la auditoría de primitivas), contra la base real: la base rechaza lo que la app ya rechaza.
 * Qué se mide: que los tres CHECK existen y están VALIDADOS (no `NOT VALID`), y que cada uno rechaza el caso inválido (23514) y deja pasar el válido.
 * Mutación demostrada: sacar un CHECK de la migración hace caer su caso «rechaza».
 */
afterAll(() => prismaAdmin.$disconnect());
beforeEach(limpiarBaseDeTest);

const NOMBRES = ["Empresa_moneda_chk", "CotizacionDolar_fuente_chk", "Cliente_descuentoPorcentaje_chk"];

const codigoDeError = async (sql: string, ...params: unknown[]): Promise<string | null> => {
  try {
    await prismaAdmin.$executeRawUnsafe(sql, ...params);
    return null;
  } catch (e) {
    const m = /violates check constraint "([^"]+)"/.exec(String((e as Error).message));
    return m ? m[1]! : String((e as Error).message);
  }
};

describe("checks de datos básicos", () => {
  it("los tres CHECK existen y están validados", async () => {
    const filas = await prismaAdmin.$queryRawUnsafe<Array<{ conname: string; convalidated: boolean }>>(`SELECT conname::text, convalidated FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname`, NOMBRES);
    expect(filas.map((f) => f.conname).sort()).toEqual([...NOMBRES].sort());
    expect(filas.every((f) => f.convalidated)).toBe(true);
  });

  it("Empresa.moneda: tres letras mayúsculas pasa; minúsculas o largo distinto se rechazan", async () => {
    expect(await codigoDeError(`UPDATE "Empresa" SET "moneda" = 'ars' WHERE id = $1`, EMPRESA_DE_PRUEBA_ID)).toBe("Empresa_moneda_chk");
    expect(await codigoDeError(`UPDATE "Empresa" SET "moneda" = 'ARSS' WHERE id = $1`, EMPRESA_DE_PRUEBA_ID)).toBe("Empresa_moneda_chk");
    expect(await codigoDeError(`UPDATE "Empresa" SET "moneda" = 'ARS' WHERE id = $1`, EMPRESA_DE_PRUEBA_ID)).toBeNull();
  });

  it("CotizacionDolar.fuente: solo BNA o BCRA", async () => {
    const alta = (fuente: string) => codigoDeError(`INSERT INTO "CotizacionDolar" (id, fecha, fuente, venta) VALUES ($1, '2026-11-12', $2, 1500)`, `cot_${fuente}`, fuente);
    expect(await alta("OTRA")).toBe("CotizacionDolar_fuente_chk");
    expect(await alta("BNA")).toBeNull();
    expect(await alta("BCRA")).toBeNull();
  });

  it("Cliente.descuentoPorcentaje: de 0 a menos de 100", async () => {
    const alta = (id: string, d: string) => codigoDeError(`INSERT INTO "Cliente" (id, "empresaId", nombre, "descuentoPorcentaje") VALUES ($1, $2, $3, $4::numeric)`, id, EMPRESA_DE_PRUEBA_ID, `Cliente ${id}`, d);
    expect(await alta("c_neg", "-0.01")).toBe("Cliente_descuentoPorcentaje_chk");
    expect(await alta("c_cien", "100")).toBe("Cliente_descuentoPorcentaje_chk");
    expect(await alta("c_cero", "0")).toBeNull();
    expect(await alta("c_max", "99.99")).toBeNull();
  });

});

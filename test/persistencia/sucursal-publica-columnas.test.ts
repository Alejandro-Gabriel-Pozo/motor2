import { describe, expect, it } from "vitest";
import { prisma } from "../setup/test-db";

/**
 * Forma de `SucursalPublica` tras la migración `sucursal_publica_sin_columnas_de_sheet`: se fue lo que quedó de la época de la
 * carta en Google Sheets (`dominio`, `menuDesdeMotor2`, `sheetId`, `sheetMenuNombre` y su índice UNIQUE) y quedó todo lo que el portal
 * sí usa. Lo lee de `information_schema` / `pg_indexes`: si alguien revierte la migración o la reescribe de más, la suite lo nota.
 */
const DE_SHEET = ["dominio", "menuDesdeMotor2", "sheetId", "sheetMenuNombre"];

const columnas = () =>
  prisma.$queryRaw<Array<{ nombre: string; tipo: string; precision: number | null; escala: number | null }>>`
    SELECT column_name AS nombre, data_type AS tipo, numeric_precision::int AS precision, numeric_scale::int AS escala
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'SucursalPublica' ORDER BY column_name`;

describe("columnas de SucursalPublica", () => {
  it("ya no existen dominio, menuDesdeMotor2, sheetId ni sheetMenuNombre", async () => {
    const presentes = (await columnas()).map((c) => c.nombre).filter((n) => DE_SHEET.includes(n));
    expect(presentes).toEqual([]);
  });

  it("ya no existe el índice UNIQUE sobre dominio, y siguen los unique del portal por empresa", async () => {
    const indices = (await prisma.$queryRaw<Array<{ nombre: string }>>`
      SELECT indexname AS nombre FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'SucursalPublica'`).map((i) => i.nombre);
    expect(indices).not.toContain("SucursalPublica_dominio_key");
    expect(indices).toEqual(expect.arrayContaining(["SucursalPublica_empresaId_sucursalId_key", "SucursalPublica_empresaId_slug_key", "SucursalPublica_empresaId_id_key"]));
  });

  it("siguen las columnas del portal, incluida la posición en el mapa como numeric(5,2)", async () => {
    const porNombre = Object.fromEntries((await columnas()).map((c) => [c.nombre, c]));
    for (const n of ["id", "empresaId", "sucursalId", "slug", "etiqueta", "subtituloPortal", "orden", "publicada", "actualizadoEn"]) expect(porNombre[n], n).toBeDefined();
    for (const n of ["posX", "posY", "posW", "posH"]) expect(porNombre[n], n).toMatchObject({ tipo: "numeric", precision: 5, escala: 2 });
  });
});

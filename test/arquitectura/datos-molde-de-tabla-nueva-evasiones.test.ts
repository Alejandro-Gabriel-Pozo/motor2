import { describe, expect, it } from "vitest";
import {
  aplicarExcepciones,
  migracionesConMolde,
  privilegiosDe,
  sinComentarios,
  tablasCreadas,
  violacionesDeMolde,
  type Migracion,
  type Regla,
} from "./datos-molde-de-tabla-nueva-apoyo";

/**
 * Violaciones inyectadas de `datos-molde-de-tabla-nueva.test.ts`: cada regla del molde tiene su caso que DEBE fallar y su caso gemelo que DEBE pasar. Si se debilita el detector
 * (`datos-molde-de-tabla-nueva-apoyo.ts`), el caso correspondiente deja de fallar y esta prueba se pone roja.
 */

const BUENA = `
CREATE TABLE "Cosa" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Cosa_pkey" PRIMARY KEY ("id")
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "Cosa" FROM motor2_app;
    GRANT SELECT, INSERT ON "Cosa" TO motor2_app;
    GRANT UPDATE ("version") ON "Cosa" TO motor2_app;
  END IF;
END
$$;
`;

const migracion = (sql: string, carpeta = "20261116000000_x"): Migracion => ({ carpeta, sql });
const reglasDe = (sql: string): Regla[] => violacionesDeMolde([migracion(sql)]).map((v) => v.regla);

describe("molde de tabla nueva: lo que cumple pasa", () => {
  it("una tabla con id UUID, instantes con zona y REVOKE sin DELETE no tiene violaciones", () => {
    expect(violacionesDeMolde([migracion(BUENA)])).toEqual([]);
  });

  it("acepta la forma larga `TIMESTAMP WITH TIME ZONE` en minúsculas", () => {
    expect(reglasDe(BUENA.replace("TIMESTAMPTZ(3)", "timestamp with time zone"))).toEqual([]);
  });

  it("el REVOKE puede estar en otra migración posterior (las políticas por sucursal van aparte)", () => {
    const sinRevoke = BUENA.replace(/DO \$\$[\s\S]*\$\$;/, "");
    const aparte = `REVOKE ALL ON "Cosa" FROM motor2_app;`;
    expect(violacionesDeMolde([migracion(sinRevoke), migracion(aparte, "20261116010000_y")])).toEqual([]);
  });

  it("un REVOKE de varias tablas cubre a todas", () => {
    const dos = BUENA.replace("CREATE TABLE", "CREATE TABLE \"Otra\" (\"id\" UUID NOT NULL);\nCREATE TABLE").replace('REVOKE ALL ON "Cosa"', 'REVOKE ALL ON "Cosa", "Otra"');
    expect(violacionesDeMolde([migracion(dos)])).toEqual([]);
  });
});

describe("molde de tabla nueva: cada regla tiene su violación inyectada", () => {
  it("ID_UUID: un id TEXT se rechaza", () => {
    expect(reglasDe(BUENA.replace('"id" UUID', '"id" TEXT'))).toEqual(["ID_UUID"]);
  });

  it("ID_UUID: una tabla sin columna id se rechaza", () => {
    expect(reglasDe(BUENA.replace('"id" UUID NOT NULL,', ""))).toEqual(["ID_UUID"]);
  });

  it("INSTANTE_CON_ZONA: TIMESTAMP(3) se rechaza", () => {
    expect(reglasDe(BUENA.replace("TIMESTAMPTZ(3)", "TIMESTAMP(3)"))).toEqual(["INSTANTE_CON_ZONA"]);
  });

  it("INSTANTE_CON_ZONA: la forma larga SIN zona se rechaza", () => {
    expect(reglasDe(BUENA.replace("TIMESTAMPTZ(3)", "TIMESTAMP WITHOUT TIME ZONE"))).toEqual(["INSTANTE_CON_ZONA"]);
  });

  it("INSTANTE_CON_ZONA: `timestamp` pelado se rechaza", () => {
    expect(reglasDe(BUENA.replace("TIMESTAMPTZ(3)", "timestamp"))).toEqual(["INSTANTE_CON_ZONA"]);
  });

  it("SIN_DELETE: sin ningún REVOKE se rechaza (el script del rol da DELETE por defecto)", () => {
    expect(reglasDe(BUENA.replace(/\s*REVOKE ALL ON "Cosa" FROM motor2_app;/, ""))).toEqual(["SIN_DELETE"]);
  });

  it("SIN_DELETE: un REVOKE que solo toca a OTRO rol no alcanza", () => {
    expect(reglasDe(BUENA.replace("FROM motor2_app;", "FROM motor2_plataforma;"))).toEqual(["SIN_DELETE"]);
  });

  it("SIN_DELETE: un REVOKE comentado no cuenta", () => {
    expect(reglasDe(BUENA.replace('REVOKE ALL ON "Cosa" FROM motor2_app;', '-- REVOKE ALL ON "Cosa" FROM motor2_app;'))).toEqual(["SIN_DELETE"]);
  });

  it("SIN_DELETE: un REVOKE de UPDATE solamente no alcanza", () => {
    expect(reglasDe(BUENA.replace("REVOKE ALL ON", "REVOKE UPDATE ON"))).toEqual(["SIN_DELETE"]);
  });

  it("SIN_DELETE: GRANT de DELETE después del REVOKE se rechaza", () => {
    expect(reglasDe(BUENA.replace("GRANT SELECT, INSERT ON", "GRANT SELECT, INSERT, DELETE ON"))).toEqual(["SIN_DELETE"]);
  });

  it("SIN_DELETE: GRANT de TRUNCATE se rechaza", () => {
    expect(reglasDe(BUENA.replace("GRANT SELECT, INSERT ON", "GRANT SELECT, TRUNCATE ON"))).toEqual(["SIN_DELETE"]);
  });

  it("SIN_DELETE: GRANT ALL sobre la tabla se rechaza", () => {
    expect(reglasDe(BUENA.replace("GRANT SELECT, INSERT ON", "GRANT ALL ON"))).toEqual(["SIN_DELETE"]);
  });

  it("SIN_DELETE: un GRANT masivo ON ALL TABLES se rechaza para toda tabla nueva", () => {
    const masivo = BUENA + `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app;`;
    expect(reglasDe(masivo)).toEqual(["SIN_DELETE"]);
  });

  it("varias violaciones juntas se informan todas", () => {
    const mala = BUENA.replace('"id" UUID', '"id" TEXT').replace("TIMESTAMPTZ(3)", "TIMESTAMP(3)").replace(/\s*REVOKE ALL ON "Cosa" FROM motor2_app;/, "");
    expect(reglasDe(mala).sort()).toEqual(["ID_UUID", "INSTANTE_CON_ZONA", "SIN_DELETE"]);
  });

  it("una migración anterior al corte no se controla", () => {
    const vieja = migracion(BUENA.replace('"id" UUID', '"id" TEXT'), "20261001000000_vieja");
    expect(migracionesConMolde([vieja])).toEqual([]);
  });
});

describe("molde de tabla nueva: el lector de SQL", () => {
  it("no se confunde con paréntesis, comas y comentarios dentro de la tabla", () => {
    const sql = `
CREATE TABLE "Rara" (
    "id" UUID NOT NULL, -- una, coma (y paréntesis) en un comentario
    "texto" TEXT NOT NULL DEFAULT 'a, b (c) -- no es comentario',
    "importe" DECIMAL(14,2) NOT NULL,
    "busqueda" TEXT GENERATED ALWAYS AS (lower(coalesce("a" || ' ', '') || "b")) STORED,
    "momento" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Rara_chk" CHECK ("importe" >= 0 AND "texto" IN ('x', 'y'))
);`;
    const [t] = tablasCreadas(sql, "m");
    expect(t.nombre).toBe("Rara");
    expect(t.columnas.map((c) => `${c.nombre}:${c.tipo}`)).toEqual(["id:UUID", "texto:TEXT", "importe:DECIMAL(14,2)", "busqueda:TEXT", "momento:TIMESTAMP(3)"]);
  });

  it("sin comentarios deja los literales intactos", () => {
    expect(sinComentarios("SELECT '-- no'; -- sí\n/* x */ y")).toBe("SELECT '-- no'; \n y");
  });

  it("lee REVOKE y GRANT de varias tablas y de una lista de columnas", () => {
    const p = privilegiosDe(`REVOKE ALL ON "A", "B" FROM motor2_app; GRANT UPDATE ("x") ON "C" TO motor2_app; GRANT DELETE ON "D" TO motor2_app;`);
    expect([...p.revocadas].sort()).toEqual(["A", "B"]);
    expect([...p.conBorradoDado]).toEqual(["D"]);
    expect(p.masivo).toBe(false);
  });
});

describe("molde de tabla nueva: las excepciones", () => {
  const v = [{ tabla: "T", regla: "ID_UUID" as const, detalle: "x" }];
  const motivo = "Motivo escrito con más de cuarenta caracteres para que cuente.";

  it("una violación con excepción declarada no hace fallar", () => {
    expect(aplicarExcepciones(v, [{ tabla: "T", regla: "ID_UUID", motivo }])).toEqual({ sinExcepcion: [], excepcionesInvalidas: [] });
  });

  it("una excepción para OTRA regla no cubre la violación", () => {
    expect(aplicarExcepciones(v, [{ tabla: "T", regla: "SIN_DELETE", motivo }]).sinExcepcion).toHaveLength(1);
  });

  it("una excepción sin motivo suficiente falla", () => {
    expect(aplicarExcepciones(v, [{ tabla: "T", regla: "ID_UUID", motivo: "corto" }]).excepcionesInvalidas).toHaveLength(1);
  });

  it("una excepción que ya no hace falta falla (la lista solo baja)", () => {
    expect(aplicarExcepciones([], [{ tabla: "T", regla: "ID_UUID", motivo }]).excepcionesInvalidas).toHaveLength(1);
  });
});

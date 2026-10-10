import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TABLAS_CON_POLITICA_DE_SUCURSAL } from "../setup/clasificacion-de-tablas";
import { sqlDeFuncionesDeAlcance, sqlDePoliticasDeAlcance } from "../setup/politicas-de-alcance-de-sucursal";
import { ESCENARIOS, crearMundoDeSucursales, sqlBueno, type MundoDeSucursales } from "./rls-sucursal-mundo";

/**
 * M.3, Fase A, paso A10: las MUTACIONES y el ROJO PREVIO de la prueba de la RLS por sucursal. Un escenario que no se pone en rojo cuando la defensa se rompe no prueba nada (es el verde que no prueba nada de
 * las auditorías anteriores). Acá se corre el MISMO catálogo de escenarios de `rls-sucursal-mundo.ts` contra:
 *  - la base SIN políticas (el rojo previo: lo que la Fase B tiene que cerrar), y
 *  - el SQL del generador a propósito ROTO de una forma por vez (los mutantes), y se exige que se ponga en rojo en los escenarios que corresponden.
 * Un mutante «equivalente» (que Postgres trata igual que el original) tiene que dejar TODO en verde: se declara como tal con su motivo.
 *
 * Todo ocurre en una base TEMPORAL y en memoria: el SQL mutado no se escribe en ningún archivo ni llega a `prisma/migrations`.
 */
let mundo: MundoDeSucursales;
const bueno = sqlBueno();

beforeAll(async () => {
  mundo = await crearMundoDeSucursales();
}, 120_000);

afterAll(async () => {
  await mundo?.cerrar();
});

/** Corre todo el catálogo y devuelve los ids de los escenarios que encuentran problemas (una excepción de la base también cuenta como rojo). */
async function rojos(): Promise<string[]> {
  const rojo: string[] = [];
  for (const escenario of ESCENARIOS) {
    try {
      if ((await escenario.correr(mundo)).length > 0) rojo.push(escenario.id);
    } catch {
      rojo.push(escenario.id);
    }
  }
  return rojo.sort();
}

/** Aplica `sql` en la base (después de borrar lo anterior), corre el catálogo y la deja limpia. */
async function conSql(sql: string): Promise<string[]> {
  await mundo.quitarPoliticas();
  try {
    await mundo.aplicar(sql);
    return await rojos();
  } finally {
    await mundo.quitarPoliticas();
  }
}

const lineasDe = (sql: string) => sql.split("\n");

/** Aplica `f` a cada línea que sigue a una línea que cumple `previa` (las políticas del generador tienen una forma fija: cabecera, USING/WITH CHECK). */
function trasLinea(sql: string, previa: RegExp, f: (linea: string) => string | null): string {
  const lineas = lineasDe(sql);
  const salida: string[] = [];
  for (let i = 0; i < lineas.length; i++) {
    if (i > 0 && previa.test(lineas[i - 1])) {
      const nueva = f(lineas[i]);
      if (nueva !== null) salida.push(nueva);
    } else salida.push(lineas[i]);
  }
  return salida.join("\n");
}

/** El bloque de una tabla (de «-- Tabla» hasta la línea en blanco), reescrito con `f`. */
function enBloque(sql: string, tabla: string, f: (bloque: string) => string): string {
  const inicio = sql.indexOf(`\n-- ${tabla}\n`);
  if (inicio < 0) throw new Error(`no hay bloque para ${tabla}`);
  const fin = sql.indexOf("\n\n", inicio + 1);
  return sql.slice(0, inicio) + f(sql.slice(inicio, fin < 0 ? undefined : fin)) + (fin < 0 ? "" : sql.slice(fin));
}

const DESPUES_DE_CABECERA = (comando: string) => new RegExp(`^CREATE POLICY alcance_sucursal_${comando} ON .* FOR ${comando.toUpperCase()} TO motor2_app$`);

interface Mutante {
  id: string;
  titulo: string;
  sql: () => string;
  /** Los escenarios que TIENEN que ponerse en rojo (pueden ponerse otros: ahí es una pista de qué más se rompe). */
  rojos: string[];
  /** Mutante equivalente: Postgres lo trata igual que el original, así que no hay escenario que lo pueda distinguir. */
  equivalente?: string;
}

const HEREDADAS = ["Cuenta", "CuentaItem", "MovimientoStock", "PromoCuenta", "RecetaIngrediente", "RecetaPaso", "RecetaPasoIngrediente", "SustitutoRecetaIngrediente"];

const MUTANTES: readonly Mutante[] = [
  {
    id: "M1",
    titulo: "quitar «AS RESTRICTIVE» (las políticas pasan a ser PERMISSIVE y se SUMAN a la de empresa en vez de acotarla)",
    sql: () => bueno.replaceAll(" AS RESTRICTIVE", ""),
    rojos: ["E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"],
  },
  {
    id: "M2",
    titulo: "UPDATE sin WITH CHECK",
    sql: () => {
      const lineas = lineasDe(bueno);
      const salida: string[] = [];
      for (let i = 0; i < lineas.length; i++) {
        if (lineas[i].startsWith("  WITH CHECK") && lineas[i - 1].startsWith("  USING")) salida[salida.length - 1] += ";";
        else salida.push(lineas[i]);
      }
      return salida.join("\n");
    },
    rojos: [],
    equivalente:
      "en Postgres una política de UPDATE con solo USING usa esa misma expresión también como WITH CHECK (documentación de CREATE POLICY: «if only a USING clause is specified, that clause will be used for both USING and WITH CHECK cases»); como el generador escribe las dos IGUALES, omitir WITH CHECK no cambia nada",
  },
  {
    id: "M2b",
    titulo: "UPDATE con WITH CHECK (true) (no se frena mover una fila a una sucursal que se ve pero no se escribe)",
    sql: () => trasLinea(bueno, /^ {2}USING .*\)$/, (l) => (l.startsWith("  WITH CHECK") ? "  WITH CHECK (true);" : l)),
    // Solo E3: Postgres también exige que la fila NUEVA pase las políticas de SELECT, así que mover una fila a una sucursal que NI SIQUIERA se lee lo frena igual la de lectura (E2 y E6 quedan en verde).
    // El WITH CHECK de escritura es lo único que frena el movimiento hacia una sucursal de solo lectura.
    rojos: ["E3"],
  },
  {
    id: "M3",
    titulo: "alcance equivocado: la función de ESCRITURA lee la variable de LECTURA",
    sql: () => bueno.replace("current_setting('app.sucursales_escritura', true)", "current_setting('app.sucursales_lectura', true)"),
    rojos: ["E3", "E8"],
  },
  {
    id: "M3b",
    titulo: "alcance equivocado: la función de LECTURA ignora la escritura (la lectura efectiva deja de ser lectura ∪ escritura)",
    sql: () => bueno.replace("\n    || COALESCE(string_to_array(NULLIF(current_setting('app.sucursales_escritura', true), ''), ','), '{}'::text[])", ""),
    rojos: ["E3"],
  },
  {
    id: "M3c",
    titulo: "alcance equivocado: las políticas de SELECT usan la función de ESCRITURA",
    sql: () => trasLinea(bueno, DESPUES_DE_CABECERA("select"), (l) => l.replaceAll("app_sucursales_lectura()", "app_sucursales_escritura()")),
    rojos: ["E3", "E8"],
  },
  {
    id: "M4",
    titulo: "sin políticas de DELETE",
    sql: () => {
      const lineas = lineasDe(bueno);
      const salida: string[] = [];
      for (let i = 0; i < lineas.length; i++) {
        if (DESPUES_DE_CABECERA("delete").test(lineas[i])) i += 1; // la cabecera y su USING
        else salida.push(lineas[i]);
      }
      return salida.join("\n");
    },
    rojos: ["E2", "E3", "E7", "E8"],
  },
  {
    id: "M5",
    titulo: "INSERT con WITH CHECK (true)",
    sql: () => trasLinea(bueno, DESPUES_DE_CABECERA("insert"), () => "  WITH CHECK (true);"),
    rojos: ["E2", "E3", "E5", "E6", "E7", "E8"],
  },
  {
    id: "M6",
    titulo: "una tabla olvidada: CuentaItem sin ninguna política",
    sql: () => `${sqlDeFuncionesDeAlcance()}\n${sqlDePoliticasDeAlcance(TABLAS_CON_POLITICA_DE_SUCURSAL.filter((t) => t !== "CuentaItem"))}`,
    rojos: ["E0", "E1", "E3", "E6", "E8"],
  },
  {
    id: "M7",
    titulo: "las hijas dejan de verificar a su padre al escribir (INSERT con WITH CHECK (true) solo en las HEREDADAS)",
    sql: () => HEREDADAS.reduce((sql, tabla) => enBloque(sql, tabla, (b) => trasLinea(b, DESPUES_DE_CABECERA("insert"), () => "  WITH CHECK (true);")), bueno),
    rojos: ["E6"],
  },
  {
    id: "M8",
    titulo: "la fila de empresa (sucursalId NULL) deja de pedir un alcance fijado",
    sql: () => bueno.replaceAll(/\("sucursalId" IS NULL AND \(SELECT app_sucursales_(lectura|escritura)\(\)\) IS NOT NULL\)/g, '"sucursalId" IS NULL'),
    rojos: ["E0", "E5"],
  },
  {
    id: "M9",
    titulo: "las funciones devuelven «{}» en vez de NULL cuando no hay alcance",
    sql: () =>
      bueno
        .replace(/SELECT NULLIF\(\n( {4}COALESCE[\s\S]*?),\n {4}'\{\}'::text\[\]\)/, "SELECT $1")
        .replace("SELECT string_to_array(NULLIF(current_setting('app.sucursales_escritura', true), ''), ',')", "SELECT COALESCE(string_to_array(NULLIF(current_setting('app.sucursales_escritura', true), ''), ','), '{}'::text[])"),
    rojos: ["E0", "E5"],
  },
  {
    id: "M10",
    titulo: "TraspasoSucursal solo se ve y se escribe desde el origen",
    sql: () => enBloque(bueno, "TraspasoSucursal", (b) => b.replaceAll(/ OR "destinoSucursalId" = ANY\(\(SELECT app_sucursales_(lectura|escritura)\(\)\)::text\[\]\)/g, "")),
    rojos: ["E7"],
  },
];

describe("el catálogo de escenarios de la RLS por sucursal se pone en rojo cuando la defensa se rompe", () => {
  it("CONTROL: con el SQL bueno del generador ningún escenario encuentra problemas (si no, los rojos de abajo no significarían nada)", async (ctx) => {
    if (!mundo.hayRol) return ctx.skip();
    expect(await conSql(bueno)).toEqual([]);
  });

  it("ROJO PREVIO: sin ninguna política (la base de hoy) los escenarios de aislamiento fallan: eso es lo que la Fase B tiene que cerrar", async (ctx) => {
    if (!mundo.hayRol) return ctx.skip();
    await mundo.quitarPoliticas();
    const rojo = await rojos();
    // E9 (dos empresas) también se pone en rojo, pero SOLO por su caso de escritura cruzada (espera un 42501 de la RLS y sin políticas la base da un 23503 de clave foránea): la lectura entre empresas la
    // corta la política por empresa, la capa de abajo, que ya existe. Por eso no se lo exige acá.
    for (const id of ["E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E11"]) expect(rojo, `${id} tiene que estar en rojo sin políticas`).toContain(id);
  });

  for (const mutante of MUTANTES) {
    it(`${mutante.id}: ${mutante.titulo}${mutante.equivalente ? " (EQUIVALENTE)" : ""}`, async (ctx) => {
      if (!mundo.hayRol) return ctx.skip();
      const sql = mutante.sql();
      expect(sql, `${mutante.id}: el mutante no cambió el SQL (la transformación no encontró nada que romper)`).not.toBe(bueno);
      const rojo = await conSql(sql);
      if (mutante.equivalente) {
        expect(mutante.equivalente.length).toBeGreaterThan(60);
        expect(rojo, `${mutante.id} se declaró equivalente pero algún escenario lo distingue`).toEqual([]);
      } else {
        for (const id of mutante.rojos) expect(rojo, `${mutante.id}: el escenario ${id} no lo detectó (rojos: ${rojo.join(", ") || "ninguno"})`).toContain(id);
      }
    });
  }

  it("M11: sin el «::text[]» de la corrección del agente 2, Postgres ni siquiera deja crear la política (operator does not exist: text = text[])", async (ctx) => {
    if (!mundo.hayRol) return ctx.skip();
    const sinCast = bueno.replaceAll("())::text[])", "()))");
    expect(sinCast).not.toBe(bueno);
    await mundo.quitarPoliticas();
    await expect(mundo.aplicar(sinCast)).rejects.toMatchObject({ code: "42883" });
    await mundo.quitarPoliticas();
  });
});

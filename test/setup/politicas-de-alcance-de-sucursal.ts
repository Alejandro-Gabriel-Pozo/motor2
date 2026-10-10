import { ALCANCE_DE_TABLAS, TABLAS_CON_POLITICA_DE_SUCURSAL } from "./clasificacion-de-tablas";

/**
 * GENERADOR del SQL de la RLS por sucursal (M.3, Fase A, paso A9; plan `_planes/plan-m3-rls-por-sucursal-2026-10-10.md` §2). Lee la segunda dimensión de la clasificación
 * (`ALCANCE_DE_TABLAS`, `test/setup/clasificacion-de-tablas.ts`) y devuelve TEXTO SQL: no se conecta a nada y no escribe ningún archivo. La clasificación es la única fuente de verdad: nadie
 * escribe a mano una política por tabla. Una tabla nueva con alcance por sucursal sale con sus cuatro políticas sin tocar este archivo; una sin alcance de sucursal (GOBIERNO, DE_EMPRESA,
 * SIN_EMPRESA) no sale, y pedirla acá es un error.
 *
 * Este SQL NO es una migración. Vive solo como salida de este generador (y como fixture de los tests); que pase a `prisma/migrations` es la Fase B y necesita la orden del dueño.
 *
 * Qué genera:
 *  - Dos funciones `app_sucursales_lectura()` y `app_sucursales_escritura()` (`text[]`, STABLE, SECURITY INVOKER): leen las variables `app.sucursales_lectura` / `app.sucursales_escritura`
 *    (listas de ids separadas por coma, locales a la transacción) y devuelven NULL si la variable falta o está vacía. NULL hace que `= ANY(NULL)` no sea verdadero: no se lee ninguna fila y
 *    un INSERT da 42501. Eso es FALLAR CERRADO. La lectura efectiva es lectura ∪ escritura (quien puede escribir en una sucursal la puede leer), calculada en SQL.
 *  - Por cada tabla con alcance de sucursal, CUATRO políticas `AS RESTRICTIVE … TO motor2_app`, una por comando: SELECT (lectura en USING), INSERT (escritura en WITH CHECK), UPDATE
 *    (escritura en USING y en WITH CHECK, así no se puede mover una fila a una sucursal ajena) y DELETE (escritura en USING). Son RESTRICTIVE para que se combinen con AND con la política
 *    `aislamiento_empresa` (PERMISSIVE) en vez de sumarse a ella; `TO motor2_app` para que no alcancen a la consola ni a los scripts del dueño.
 *  - La condición de cada tabla sale de su alcance: PROPIA (`"sucursalId" = ANY(...)`), PROPIA_O_EMPRESA (además NULL = de la empresa, pero solo con un alcance fijado: sin variable
 *    tampoco se ve), HEREDADA (la FK obligatoria al padre en una subconsulta NO correlacionada, a lo largo de toda la cadena de padres) y ENTRE_SUCURSALES (origen o destino).
 *    Las FK no filtran por RLS (así es Postgres): por eso las hijas verifican la sucursal de su padre en el WITH CHECK y no confían en que la FK exista.
 *  - `(SELECT función())::text[]` dentro de `ANY(...)`: Postgres lo evalúa UNA vez por consulta (InitPlan) y no una vez por fila. El `::text[]` NO es decoración: sin él, `ANY((SELECT …))`
 *    se lee como `ANY (subconsulta)` (una fila por elemento) y Postgres falla con «operator does not exist: text = text[]»; con la conversión es una expresión escalar de tipo arreglo.
 */

export const ROL_DE_LA_APP = "motor2_app";

export const COMANDOS_CON_POLITICA_DE_ALCANCE = ["select", "insert", "update", "delete"] as const;
type Comando = (typeof COMANDOS_CON_POLITICA_DE_ALCANCE)[number];

type Modo = "lectura" | "escritura";
const FUNCION: Readonly<Record<Modo, string>> = { lectura: "app_sucursales_lectura", escritura: "app_sucursales_escritura" };

const IDENTIFICADOR = /^[A-Za-z][A-Za-z0-9_]*$/;
const PROFUNDIDAD_MAXIMA_DE_PADRES = 8;

/** El nombre de la política de un comando (el mismo en todas las tablas: los nombres de política son por tabla). */
export function nombreDePoliticaDeAlcance(comando: Comando): string {
  return `alcance_sucursal_${comando}`;
}

function identificador(valor: string): string {
  if (!IDENTIFICADOR.test(valor)) throw new Error(`politicas-de-alcance-de-sucursal: "${valor}" no es un identificador válido.`);
  return `"${valor}"`;
}

/** La condición de visibilidad/escritura de UNA tabla para un modo. Sale solo de la clasificación; una tabla sin alcance de sucursal es un error. */
function condicion(tabla: string, modo: Modo, profundidad = 0): string {
  if (profundidad > PROFUNDIDAD_MAXIMA_DE_PADRES) throw new Error(`politicas-de-alcance-de-sucursal: la cadena de padres de "${tabla}" es demasiado larga (¿un ciclo?).`);
  const declaracion = ALCANCE_DE_TABLAS[tabla];
  if (!declaracion) throw new Error(`politicas-de-alcance-de-sucursal: "${tabla}" no está en la clasificación de alcance.`);
  const lista = `ANY((SELECT ${FUNCION[modo]}())::text[])`;
  switch (declaracion.alcance) {
    case "PROPIA":
      return `"sucursalId" = ${lista}`;
    case "PROPIA_O_EMPRESA":
      // NULL = de la empresa entera. Solo cuenta con un alcance fijado: sin variable (NULL) la fila de empresa tampoco se ve ni se escribe.
      return `("sucursalId" = ${lista} OR ("sucursalId" IS NULL AND (SELECT ${FUNCION[modo]}()) IS NOT NULL))`;
    case "ENTRE_SUCURSALES":
      return `(${identificador(declaracion.columnaOrigen)} = ${lista} OR ${identificador(declaracion.columnaDestino)} = ${lista})`;
    case "HEREDADA":
      return `${identificador(declaracion.columna)} IN (SELECT "id" FROM ${identificador(declaracion.padre)} WHERE ${condicion(declaracion.padre, modo, profundidad + 1)})`;
    default:
      throw new Error(`politicas-de-alcance-de-sucursal: "${tabla}" es ${declaracion.alcance}: no lleva política de RLS por sucursal.`);
  }
}

function tablasValidadas(tablas: readonly string[]): string[] {
  const resultado = [...tablas].sort();
  for (const t of resultado) {
    identificador(t);
    condicion(t, "lectura"); // tira si no es una tabla con alcance de sucursal
  }
  if (new Set(resultado).size !== resultado.length) throw new Error("politicas-de-alcance-de-sucursal: tablas repetidas.");
  return resultado;
}

/** Las dos funciones. `app_sucursales_lectura()` ya incluye la escritura: es la lectura EFECTIVA. */
export function sqlDeFuncionesDeAlcance(): string {
  return `-- M.3 RLS por sucursal: funciones del alcance de la transacción (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- Devuelven NULL si la variable falta o está vacía: sin alcance no se ve ni se escribe ninguna fila (falla cerrado).
CREATE OR REPLACE FUNCTION app_sucursales_escritura() RETURNS text[]
LANGUAGE sql STABLE
AS $$
  SELECT string_to_array(NULLIF(current_setting('app.sucursales_escritura', true), ''), ',')
$$;

COMMENT ON FUNCTION app_sucursales_escritura() IS 'M.3: sucursales donde la transacción puede escribir (app.sucursales_escritura, local a la transacción) y NULL sin alcance.';

CREATE OR REPLACE FUNCTION app_sucursales_lectura() RETURNS text[]
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    COALESCE(string_to_array(NULLIF(current_setting('app.sucursales_lectura', true), ''), ','), '{}'::text[])
    || COALESCE(string_to_array(NULLIF(current_setting('app.sucursales_escritura', true), ''), ','), '{}'::text[]),
    '{}'::text[])
$$;

COMMENT ON FUNCTION app_sucursales_lectura() IS 'M.3: sucursales que la transacción puede leer = lectura (app.sucursales_lectura) más escritura, y NULL sin alcance.';
`;
}

/** Las cuatro políticas de cada tabla pedida (por defecto, todas las que llevan alcance de sucursal), ordenadas por tabla. */
export function sqlDePoliticasDeAlcance(tablas: readonly string[] = TABLAS_CON_POLITICA_DE_SUCURSAL): string {
  const bloques = tablasValidadas(tablas).map((tabla) => {
    const t = identificador(tabla);
    const lectura = condicion(tabla, "lectura");
    const escritura = condicion(tabla, "escritura");
    const cabecera = (comando: Comando) => `CREATE POLICY ${nombreDePoliticaDeAlcance(comando)} ON ${t} AS RESTRICTIVE FOR ${comando.toUpperCase()} TO ${ROL_DE_LA_APP}`;
    return [
      `-- ${tabla}`,
      `${cabecera("select")}\n  USING (${lectura});`,
      `${cabecera("insert")}\n  WITH CHECK (${escritura});`,
      `${cabecera("update")}\n  USING (${escritura})\n  WITH CHECK (${escritura});`,
      `${cabecera("delete")}\n  USING (${escritura});`,
    ].join("\n");
  });
  return `-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO ${ROL_DE_LA_APP} (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).\n${bloques.join("\n\n")}\n`;
}

/** Reversa de `sqlDePoliticasDeAlcance`: solo `DROP POLICY IF EXISTS` de las políticas que ese SQL crea. */
export function sqlDeReversaDePoliticasDeAlcance(tablas: readonly string[] = TABLAS_CON_POLITICA_DE_SUCURSAL): string {
  const drops = tablasValidadas(tablas).flatMap((tabla) => COMANDOS_CON_POLITICA_DE_ALCANCE.map((c) => `DROP POLICY IF EXISTS ${nombreDePoliticaDeAlcance(c)} ON ${identificador(tabla)};`));
  return `-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).\n${drops.join("\n")}\n`;
}

/** Reversa de `sqlDeFuncionesDeAlcance`. Va DESPUÉS de la reversa de las políticas (una política en uso impediría borrar la función). */
function sqlDeReversaDeFuncionesDeAlcance(): string {
  return `-- M.3 RLS por sucursal: reversa de las funciones del alcance.\nDROP FUNCTION IF EXISTS app_sucursales_lectura();\nDROP FUNCTION IF EXISTS app_sucursales_escritura();\n`;
}

/** El borrador completo del alta: las dos funciones y las políticas de las tablas con alcance de sucursal. */
export function sqlDeAlcanceDeSucursal(): string {
  return `${sqlDeFuncionesDeAlcance()}\n${sqlDePoliticasDeAlcance()}`;
}

/** La reversa completa: primero las políticas y después las funciones. */
export function sqlDeReversaDeAlcanceDeSucursal(): string {
  return `${sqlDeReversaDePoliticasDeAlcance()}\n${sqlDeReversaDeFuncionesDeAlcance()}`;
}

import { createHash } from "node:crypto";

/**
 * Cuentas y chequeos del reparto del E2E en partes (`playwright test --shard=i/n`). Lo usa el job `conteo-e2e` de `.github/workflows/ci.yml` (vía `scripts/conteo-e2e.ts`) y lo prueba
 * `test/arquitectura/ci-e2e-en-partes.test.ts` con JSON sintéticos: la lógica es pura (sin leer disco ni red) justamente para poder demostrar que cada chequeo se pone rojo cuando corresponde.
 *
 * Entrada: el JSON del reporter de Playwright de CADA parte (`resultado-playwright.json`: `stats` más el árbol `suites → specs → tests`) y el JSON de `playwright test --list --reporter=json`
 * de la suite ENTERA (sin `--shard`, sin correr nada). Comprueba que el reparto no perdió ni duplicó nada:
 *  - llegaron exactamente `esperadas` resultados (la cantidad de partes de la matriz);
 *  - ningún archivo de spec aparece en dos partes (Playwright reparte por archivo cuando `fullyParallel` es falso: si uno se partiera, los `beforeAll` correrían dos veces y los datos de un spec quedarían a medias);
 *  - ningún archivo de la lista entera quedó sin correr, y ninguno corrió sin estar en la lista;
 *  - la suma de las partes tiene los MISMOS tests (archivo, línea y título) que la lista entera, ni uno más ni uno menos, ni repetido;
 *  - nada falló (`unexpected` > 0 deja rojo el conteo, además de la parte que falló).
 * Suma las mismas cuatro cuentas de siempre (`stats`: pasados, salteados, flaky, fallados) y calcula la huella (sha256 de la lista ordenada «archivo::título::estado»), comparable con la de una corrida
 * de un solo runner.
 */

interface TestJson {
  status?: string;
}
interface SpecJson {
  title?: string;
  file?: string;
  line?: number;
  tests?: TestJson[];
}
interface SuiteJson {
  title?: string;
  file?: string;
  suites?: SuiteJson[];
  specs?: SpecJson[];
}
export interface StatsJson {
  expected?: number;
  unexpected?: number;
  flaky?: number;
  skipped?: number;
  duration?: number;
}
export interface ResultadoPlaywright {
  stats?: StatsJson;
  suites?: SuiteJson[];
}
export interface ParteDeResultado {
  nombre: string;
  json: ResultadoPlaywright;
}
export interface EntradaConteo {
  partes: ParteDeResultado[];
  /** `playwright test --list --reporter=json` de la suite entera. */
  lista: ResultadoPlaywright;
  /** Cuántas partes tendría que haber (`PARTES_E2E`). */
  esperadas: number;
}
export interface SalidaConteo {
  texto: string;
  errores: string[];
}

interface PruebaPlana {
  archivo: string;
  /** `archivo::línea::título completo` (título con los `describe` que lo contienen). */
  clave: string;
  estado: string;
}

/** Todas las pruebas del árbol, planas. Un `spec` puede traer varias `tests` (una por proyecto); acá hay un solo proyecto, pero se cuentan todas. */
export function pruebasDe(json: ResultadoPlaywright): PruebaPlana[] {
  const salida: PruebaPlana[] = [];
  const recorrer = (suite: SuiteJson, titulos: string[], archivoDelSuite: string) => {
    const archivo = suite.file ?? archivoDelSuite;
    // La suite de primer nivel de cada archivo se titula como el archivo: no es parte del nombre de la prueba.
    const propios = suite.title && suite.title !== archivo ? [...titulos, suite.title] : titulos;
    for (const spec of suite.specs ?? []) {
      const archivoDelSpec = spec.file ?? archivo;
      for (const t of spec.tests ?? []) {
        salida.push({ archivo: archivoDelSpec, clave: `${archivoDelSpec}::${spec.line ?? 0}::${[...propios, spec.title ?? ""].join(" › ")}`, estado: t.status ?? "?" });
      }
    }
    for (const hija of suite.suites ?? []) recorrer(hija, propios, archivo);
  };
  for (const suite of json.suites ?? []) recorrer(suite, [], suite.file ?? "");
  return salida;
}

const contar = (claves: string[]): Map<string, number> => {
  const cuenta = new Map<string, number>();
  for (const c of claves) cuenta.set(c, (cuenta.get(c) ?? 0) + 1);
  return cuenta;
};

const resumir = (lista: string[], tope = 10) => lista.slice(0, tope).join(", ") + (lista.length > tope ? ", …" : "");

export function evaluarConteo({ partes, lista, esperadas }: EntradaConteo): SalidaConteo {
  const errores: string[] = [];
  if (partes.length !== esperadas) errores.push(`Hay ${partes.length} resultados de Playwright y tendría que haber exactamente ${esperadas} (PARTES_E2E): ${JSON.stringify(partes.map((p) => p.nombre))}`);

  const dueno = new Map<string, string>();
  const suma = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  const lineasHuella: string[] = [];
  const clavesCorridas: string[] = [];
  const filasPorParte: string[] = [];
  const partesVacias: string[] = [];
  for (const parte of [...partes].sort((a, b) => a.nombre.localeCompare(b.nombre))) {
    const pruebas = pruebasDe(parte.json);
    const archivos = new Set(pruebas.map((p) => p.archivo));
    for (const archivo of archivos) {
      const otra = dueno.get(archivo);
      if (otra !== undefined) errores.push(`El spec ${archivo} aparece en dos partes: ${otra} y ${parte.nombre}`);
      else dueno.set(archivo, parte.nombre);
    }
    if (pruebas.length === 0) partesVacias.push(parte.nombre);
    const s = parte.json.stats ?? {};
    suma.expected += s.expected ?? 0;
    suma.unexpected += s.unexpected ?? 0;
    suma.flaky += s.flaky ?? 0;
    suma.skipped += s.skipped ?? 0;
    for (const p of pruebas) {
      clavesCorridas.push(p.clave);
      lineasHuella.push(`${p.clave}::${p.estado}`);
    }
    const cuentaDeLaParte = (s.expected ?? 0) + (s.unexpected ?? 0) + (s.flaky ?? 0) + (s.skipped ?? 0);
    if (cuentaDeLaParte !== pruebas.length) errores.push(`${parte.nombre}: las cuentas de «stats» suman ${cuentaDeLaParte} y el árbol del resultado trae ${pruebas.length} pruebas`);
    filasPorParte.push(`| ${parte.nombre} | ${archivos.size} | ${pruebas.length} | ${s.expected ?? 0} | ${s.skipped ?? 0} | ${s.flaky ?? 0} | ${s.unexpected ?? 0} | ${Math.round((s.duration ?? 0) / 1000)} s |`);
  }

  const pruebasLista = pruebasDe(lista);
  const archivosLista = new Set(pruebasLista.map((p) => p.archivo));
  if (pruebasLista.length === 0) errores.push("La lista de `playwright test --list` vino vacía: no hay contra qué comparar el reparto");
  const faltanArchivos = [...archivosLista].filter((a) => !dueno.has(a)).sort();
  if (faltanArchivos.length) errores.push(`Faltan ${faltanArchivos.length} specs de \`playwright test --list\` que ninguna parte corrió: ${resumir(faltanArchivos)}`);
  const sobranArchivos = [...dueno.keys()].filter((a) => !archivosLista.has(a)).sort();
  if (sobranArchivos.length) errores.push(`Corrieron ${sobranArchivos.length} specs que \`playwright test --list\` no lista: ${resumir(sobranArchivos)}`);

  const esperadasPorClave = contar(pruebasLista.map((p) => p.clave));
  const corridasPorClave = contar(clavesCorridas);
  const faltanPruebas: string[] = [];
  const sobranPruebas: string[] = [];
  for (const [clave, n] of esperadasPorClave) if ((corridasPorClave.get(clave) ?? 0) < n) faltanPruebas.push(clave);
  for (const [clave, n] of corridasPorClave) if (n > (esperadasPorClave.get(clave) ?? 0)) sobranPruebas.push(clave);
  if (faltanPruebas.length) errores.push(`Faltan ${faltanPruebas.length} pruebas de la lista que las partes no corrieron: ${resumir(faltanPruebas.sort(), 5)}`);
  if (sobranPruebas.length) errores.push(`Sobran ${sobranPruebas.length} pruebas que las partes corrieron de más (repetidas o fuera de la lista): ${resumir(sobranPruebas.sort(), 5)}`);
  if (clavesCorridas.length !== pruebasLista.length) errores.push(`Las partes suman ${clavesCorridas.length} pruebas y la lista entera tiene ${pruebasLista.length}`);
  if (suma.unexpected > 0) errores.push(`Hay ${suma.unexpected} pruebas falladas`);

  const huella = createHash("sha256").update(lineasHuella.sort().join("\n")).digest("hex");
  const texto = [
    "## Conteo de Playwright (todas las partes)",
    "",
    "| parte | specs | pruebas | pasadas | salteadas | flaky | falladas | duración |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...filasPorParte,
    "",
    `- specs de \`playwright test --list\`: ${archivosLista.size}`,
    `- pruebas de \`playwright test --list\`: ${pruebasLista.length}`,
    `- total (suma de las partes): ${suma.expected + suma.unexpected + suma.flaky + suma.skipped}`,
    `- pasados: ${suma.expected}`,
    `- salteados: ${suma.skipped}`,
    `- flaky (pasaron en el reintento): ${suma.flaky}`,
    `- fallados: ${suma.unexpected}`,
    `- sha256 de la lista ordenada archivo::línea::título::estado: ${huella}`,
    ...(partesVacias.length ? [`- aviso: ${partesVacias.length} partes no corrieron ningún spec (${partesVacias.join(", ")}): Playwright reparte por archivo y hay más partes que bloques; bajá PARTES_E2E y la matriz del job e2e (no es un error: la parte vacía pasa)`] : []),
    ...(errores.length ? ["", "### ERRORES", ...errores.map((e) => `- ${e}`)] : []),
  ].join("\n");
  return { texto, errores };
}

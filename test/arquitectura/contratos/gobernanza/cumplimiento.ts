import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { arbolMemoizado } from "../indice";
import { MANIFIESTO } from "../manifiesto";
import type { Contrato } from "../tipos";
import { APROBACIONES, idsDeContratosAprobados, type Aprobacion } from "./aprobaciones";

/**
 * El CUMPLIMIENTO del cableado del guardián (paso G6, «guardián del guardián»). El registro de aprobaciones (`aprobaciones.ts`) atrapa que el mecanismo cambió; esto dice POR QUÉ
 * un cambio neutraliza al guardián, con archivo, línea y corrección, y no depende de que alguien haya aprobado o no. Son EVALUADORES PUROS (texto de entrada, lista de hallazgos), con
 * casos sintéticos en `cumplimiento.test.ts`, y una función `revisarCumplimiento(raiz)` que los corre sobre un árbol (el repo real o la copia del arnés de mutaciones). Decisión del
 * dueño: fail-closed. Lo que el evaluador no puede analizar es un hallazgo, no un «todo bien».
 *
 *  (a) `.github/workflows/ci.yml`: el job `estatico` corre `npm run arquitectura` y el job `integracion` corre `npm test`, sin `if`, sin `continue-on-error` ni cambio de carpeta; el job `gate`
 *      necesita los cinco jobs, su expresión los nombra y se llama «Gate (requerido)»; ningún `continue-on-error` en todo el workflow; ningún `if` fuera de la lista declarada
 *      (`CONDICIONES_PERMITIDAS`); sin `paths` ni `paths-ignore` en `on:`; ninguna variable que cambie el comportamiento de los guardianes (`CREAR_CERCOS`, `BAJAR_CERCOS`, `REGENERAR_*`…).
 *  (b) `package.json`: `scripts.test` y `scripts.arquitectura` valen lo esperado y no hay ganchos `pre`/`post` de ellos.
 *  (c) `vitest.config.ts` (análisis estático del AST): ningún `exclude` deja afuera un guardián, un `include` los cubre, `allowOnly` no está en true y no hay claves que cambien qué se corre.
 *  (d) skip/only (AST, no regex): ningún `skip`, `only`, `todo`, `skipIf`, `runIf`, `ctx.skip`, `xit` ni `xdescribe` en los tests protegidos, y cada uno tiene al menos un test.
 *  (e) cableado: los guardianes esperados existen, terminan en `.test.ts` y están bajo `test/`; un `.ts` con pruebas que no termina en `.test.ts` no corre.
 *  (f) manifiesto: no vacío, y el conjunto de ids es el de los contratos aprobados en el registro. (Que cada contrato tenga alcance > 0 archivos lo hace el motor: `alcance-vacio`.)
 */

const RUTA_DE_CI = ".github/workflows/ci.yml";
const RUTA_DE_PAQUETE = "package.json";
const RUTA_DE_VITEST = "vitest.config.ts";
const CARPETA_DE_CONTRATOS = "test/arquitectura/contratos";

export const TIPOS_DE_CUMPLIMIENTO = [
  "archivo-ausente",
  "ci-ilegible",
  "ci-job-ausente",
  "ci-sin-paso",
  "ci-paso-alterado",
  "ci-continue-on-error",
  "ci-condicion-no-permitida",
  "ci-gate-sin-needs",
  "ci-gate-expresion",
  "ci-gate-renombrado",
  "ci-filtro-de-rutas",
  "ci-variable-prohibida",
  "package-ilegible",
  "script-ausente",
  "script-distinto",
  "script-de-ganchos",
  "vitest-no-analizable",
  "vitest-excluye-guardian",
  "vitest-include-no-cubre",
  "vitest-allowonly",
  "vitest-clave-peligrosa",
  "prueba-desactivada",
  "guardian-sin-pruebas",
  "guardian-ausente",
  "guardian-mal-cableado",
  "prueba-sin-sufijo-test",
  "manifiesto-vacio",
  "contrato-sin-aprobar",
  "aprobado-ausente-del-manifiesto",
] as const;

export type TipoDeCumplimiento = (typeof TIPOS_DE_CUMPLIMIENTO)[number];

export interface HallazgoDeCumplimiento {
  tipo: TipoDeCumplimiento;
  /** Ruta relativa a la raíz del repo, con `/`. */
  archivo: string;
  /** 1-based. */
  linea: number;
  columna: number;
  que: string;
  como: string;
}

/**
 * Memoria de los evaluadores: el mismo texto da siempre los mismos hallazgos (son funciones puras), y el arnés de mutaciones los corre cientos de veces sobre árboles que casi no cambian. La clave
 * incluye el texto entero, así que una mutación que lo cambia siempre se evalúa de nuevo.
 */
const memoria = new Map<string, HallazgoDeCumplimiento[]>();
function memorizado(clave: string, calcular: () => HallazgoDeCumplimiento[]): HallazgoDeCumplimiento[] {
  let previo = memoria.get(clave);
  if (previo === undefined) {
    previo = calcular();
    memoria.set(clave, previo);
  }
  return previo.map((h) => ({ ...h }));
}

type Agregar = (tipo: TipoDeCumplimiento, linea: number, que: string, como: string, columna?: number) => void;

function armar(archivo: string): { hallazgos: HallazgoDeCumplimiento[]; agregar: Agregar } {
  const hallazgos: HallazgoDeCumplimiento[] = [];
  return { hallazgos, agregar: (tipo, linea, que, como, columna = 1) => void hallazgos.push({ tipo, archivo, linea, columna, que, como }) };
}

const lf = (texto: string): string => texto.replace(/\r\n/g, "\n");

// ---------------------------------------------------------------------------------------------------------------------------------
// (a) El workflow de CI: un lector mínimo de YAML por indentación (sin dependencias nuevas)
// ---------------------------------------------------------------------------------------------------------------------------------

interface NodoYaml {
  /** La clave (`jobs`, `steps`…), `-` si es un elemento de lista, o vacío si es un valor suelto. */
  clave: string;
  valor: string;
  linea: number;
  indent: number;
  hijos: NodoYaml[];
}

interface TokenYaml {
  indent: number;
  texto: string;
  linea: number;
  bloque: string | null;
}

/** El texto sin su comentario (`# …` precedido de espacio o al principio), respetando comillas. */
function sinComentarioYaml(linea: string): string {
  let comilla = "";
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comilla !== "") {
      if (c === comilla) comilla = "";
    } else if (c === '"' || c === "'") comilla = c;
    else if (c === "#" && (i === 0 || /\s/.test(linea[i - 1]))) return linea.slice(0, i);
  }
  return linea;
}

function tokenizarYaml(texto: string): TokenYaml[] {
  const lineas = lf(texto).split("\n");
  const tokens: TokenYaml[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const limpia = sinComentarioYaml(lineas[i]);
    if (limpia.trim() === "") continue;
    let indent = limpia.length - limpia.trimStart().length;
    let contenido = limpia.trim();
    while (contenido === "-" || contenido.startsWith("- ")) {
      tokens.push({ indent, texto: "-", linea: i + 1, bloque: null });
      const resto = contenido.slice(1);
      indent += 1 + (resto.length - resto.trimStart().length);
      contenido = resto.trim();
    }
    if (contenido === "") continue;
    let bloque: string | null = null;
    const lineaDeLaClave = i + 1;
    if (/:\s+[|>][+-]?\d*$/.test(contenido)) {
      const lineasDelBloque: string[] = [];
      let j = i + 1;
      while (j < lineas.length && (lineas[j].trim() === "" || lineas[j].length - lineas[j].trimStart().length > indent)) lineasDelBloque.push(lineas[j++]);
      bloque = lineasDelBloque.join("\n");
      i = j - 1;
    }
    tokens.push({ indent, texto: contenido, linea: lineaDeLaClave, bloque });
  }
  return tokens;
}

function parsearYaml(texto: string): NodoYaml {
  const raiz: NodoYaml = { clave: "", valor: "", linea: 0, indent: -1, hijos: [] };
  const pila: NodoYaml[] = [raiz];
  for (const t of tokenizarYaml(texto)) {
    while (pila[pila.length - 1].indent >= t.indent) pila.pop();
    let nodo: NodoYaml;
    if (t.texto === "-") nodo = { clave: "-", valor: "", linea: t.linea, indent: t.indent, hijos: [] };
    else {
      const par = /^("[^"]*"|'[^']*'|[^\s:][^:]*?)\s*:(?:\s+(.*))?$/.exec(t.texto);
      nodo = par === null ? { clave: "", valor: t.texto, linea: t.linea, indent: t.indent, hijos: [] } : { clave: par[1].replace(/^["']|["']$/g, ""), valor: t.bloque ?? (par[2] ?? ""), linea: t.linea, indent: t.indent, hijos: [] };
    }
    pila[pila.length - 1].hijos.push(nodo);
    pila.push(nodo);
  }
  return raiz;
}

const hijoDe = (n: NodoYaml | undefined, clave: string): NodoYaml | undefined => n?.hijos.find((h) => h.clave === clave);
const escalar = (n: NodoYaml | undefined): string => (n === undefined ? "" : n.valor.trim().replace(/^["']|["']$/g, ""));
const descendientes = (n: NodoYaml): NodoYaml[] => n.hijos.flatMap((h) => [h, ...descendientes(h)]);

/** Los elementos de una lista YAML: `[a, b]` en una línea, o `- a` por línea. */
function elementosDeLista(n: NodoYaml | undefined): string[] {
  if (n === undefined) return [];
  if (n.valor.trim().startsWith("[")) return n.valor.trim().replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter((x) => x !== "");
  if (n.valor.trim() !== "") return [escalar(n)];
  return n.hijos.map((h) => (h.clave === "-" ? (h.hijos[0] === undefined ? "" : h.hijos[0].clave === "" ? escalar(h.hijos[0]) : "") : escalar(h))).filter((x) => x !== "");
}

interface PasoDeJob {
  nodo: NodoYaml;
  nombre: string;
  run: string;
}

function pasosDe(job: NodoYaml): PasoDeJob[] {
  return (hijoDe(job, "steps")?.hijos ?? []).filter((p) => p.clave === "-").map((p) => ({ nodo: p, nombre: escalar(hijoDe(p, "name")), run: hijoDe(p, "run")?.valor.trim() ?? "" }));
}

/** Los jobs que el gate exige (en el orden en que figuran en `needs`), el gate y los dos pasos que corren a los guardianes. Derivado del workflow real de `ci.yml`. */
const JOBS_QUE_EXIGE_EL_GATE = ["estatico", "build", "integracion", "conteo", "e2e"] as const;
const NOMBRE_DEL_GATE = "Gate (requerido)";
const PASOS_DE_LOS_GUARDIANES: readonly { job: string; descripcion: string; corre: (run: string) => boolean }[] = [
  { job: "estatico", descripcion: "npm run arquitectura", corre: (run) => run === "npm run arquitectura" },
  { job: "integracion", descripcion: "npm test", corre: (run) => /^npm test(\s|$)/.test(run) },
];

/**
 * Las ÚNICAS condiciones `if:` que el workflow puede tener, cada una con su motivo. Un `if` fuera de esta lista es un hallazgo; los dos pasos de los guardianes no admiten ninguno.
 * Agregar una entrada es cambiar este archivo, que está congelado por hash (`aprobaciones.ts`).
 */
const CONDICIONES_PERMITIDAS: readonly { job: string; paso: string | null; condicion: string; motivo: string }[] = [
  { job: "conteo", paso: null, condicion: "always()", motivo: "el conteo corre aunque alguna parte de Vitest haya fallado, para informar qué se perdió" },
  { job: "gate", paso: null, condicion: "always()", motivo: "el gate corre siempre y falla él si algún job no terminó en verde (un job omitido también lo hace fallar)" },
  { job: "integracion", paso: "Tests que fallaron (resumen al final del log)", condicion: "failure()", motivo: "resumen de lo que falló, solo si npm test falló" },
  { job: "integracion", paso: "Resultado de Vitest de esta parte (artefacto)", condicion: "always()", motivo: "sube el resultado de la parte aunque falle, para que el conteo la vea" },
  { job: "e2e", paso: "Conteo (línea de base)", condicion: "always()", motivo: "informa el conteo de Playwright aunque falle" },
  { job: "e2e", paso: "Resultado de Playwright (artefacto)", condicion: "always()", motivo: "sube el resultado aunque falle" },
  { job: "e2e", paso: "Trazas de los specs que fallaron", condicion: "failure()", motivo: "sube las trazas solo si Playwright falló" },
];

/** Variables que cambian lo que hacen los guardianes (regeneran una línea de base o un golden): jamás en el CI. */
const RE_VARIABLE_PROHIBIDA = /\b(CREAR_CERCOS|BAJAR_CERCOS|GOLDEN_ACTUALIZAR|REGENERAR_[A-Z0-9_]+|CONTRATOS_[A-Z0-9_]+)\b/;

export const evaluarWorkflow = (texto: string, archivo: string = RUTA_DE_CI): HallazgoDeCumplimiento[] => memorizado(`workflow\0${archivo}\0${texto}`, () => workflowSinMemoria(texto, archivo));

function workflowSinMemoria(texto: string, archivo: string): HallazgoDeCumplimiento[] {
  const { hallazgos, agregar } = armar(archivo);
  const raiz = parsearYaml(texto);
  const jobsNodo = hijoDe(raiz, "jobs");
  if (jobsNodo === undefined || jobsNodo.hijos.length === 0) {
    agregar("ci-ilegible", 1, "el workflow no tiene la sección `jobs:` (o no se pudo leer): sin ella no se puede comprobar que corra a los guardianes", "restaurá `jobs:` con los jobs estatico, build, integracion, conteo, e2e y gate");
    return hallazgos;
  }
  const jobs = new Map(jobsNodo.hijos.map((j) => [j.clave, j]));

  // Disparadores: nada de filtros por carpeta.
  const disparadores = hijoDe(raiz, "on");
  if (disparadores === undefined) agregar("ci-ilegible", 1, "el workflow no tiene `on:`: no se dispara nunca", "restaurá `on:` con push y pull_request");
  else {
    for (const n of descendientes(disparadores)) {
      if (n.clave === "paths" || n.clave === "paths-ignore") agregar("ci-filtro-de-rutas", n.linea, `\`${n.clave}\` en \`on:\`: el CI se salta cuando solo cambian esas carpetas y un cambio ahí pasa sin guardianes`, `sacá \`${n.clave}\` (el CI corre en todo cambio)`);
    }
  }

  // Los jobs exigidos existen.
  for (const nombre of [...JOBS_QUE_EXIGE_EL_GATE, "gate"]) {
    if (!jobs.has(nombre)) agregar("ci-job-ausente", jobsNodo.linea, `falta el job \`${nombre}\``, `restaurá el job \`${nombre}\`: el gate exige estatico, build, integracion, conteo y e2e`);
  }

  // Los pasos de los guardianes.
  for (const g of PASOS_DE_LOS_GUARDIANES) {
    const job = jobs.get(g.job);
    if (job === undefined) continue;
    const paso = pasosDe(job).find((p) => g.corre(p.run));
    if (paso === undefined) {
      agregar("ci-sin-paso", job.linea, `el job \`${g.job}\` no tiene un paso que corra \`${g.descripcion}\`: el guardián queda desconectado del CI`, `restaurá en \`${g.job}\` un paso con \`run: ${g.descripcion}\``);
      continue;
    }
    for (const clave of ["working-directory", "shell"]) {
      const alterado = hijoDe(paso.nodo, clave);
      if (alterado !== undefined) agregar("ci-paso-alterado", alterado.linea, `el paso \`${g.descripcion}\` de \`${g.job}\` cambia \`${clave}\`: corre en otro lugar o con otro intérprete`, `sacá \`${clave}\` de ese paso`);
    }
    const condicion = hijoDe(paso.nodo, "if");
    if (condicion !== undefined) agregar("ci-condicion-no-permitida", condicion.linea, `el paso \`${g.descripcion}\` de \`${g.job}\` tiene \`if: ${escalar(condicion)}\`: puede saltearse`, "sacá el `if`: los pasos de los guardianes corren siempre");
  }

  // Ningún continue-on-error y ningún if fuera de la lista.
  for (const [id, job] of jobs) {
    const contexto: { nodo: NodoYaml; que: string; paso: string | null; run: string | null }[] = [{ nodo: job, que: `el job \`${id}\``, paso: null, run: null }];
    for (const p of pasosDe(job)) contexto.push({ nodo: p.nodo, que: `el paso «${p.nombre || p.run.split("\n")[0]}» del job \`${id}\``, paso: p.nombre, run: p.run });
    for (const c of contexto) {
      const soe = hijoDe(c.nodo, "continue-on-error");
      if (soe !== undefined && escalar(soe) !== "false") agregar("ci-continue-on-error", soe.linea, `${c.que} tiene \`continue-on-error: ${escalar(soe)}\`: si falla, el CI sigue en verde`, "sacá `continue-on-error`");
      const condicion = hijoDe(c.nodo, "if");
      if (condicion === undefined) continue;
      const guardian = c.run !== null && PASOS_DE_LOS_GUARDIANES.some((g) => g.job === id && g.corre(c.run ?? ""));
      const permitida = CONDICIONES_PERMITIDAS.some((p) => p.job === id && p.paso === c.paso && p.condicion === escalar(condicion));
      if (!permitida && !guardian) agregar("ci-condicion-no-permitida", condicion.linea, `${c.que} tiene \`if: ${escalar(condicion)}\`, que no está en la lista de condiciones permitidas (CONDICIONES_PERMITIDAS)`, "sacá el `if`, o agregalo a CONDICIONES_PERMITIDAS de cumplimiento.ts con su motivo y su aprobación");
    }
  }

  // El gate.
  const gate = jobs.get("gate");
  if (gate !== undefined) {
    if (escalar(hijoDe(gate, "name")) !== NOMBRE_DEL_GATE) agregar("ci-gate-renombrado", hijoDe(gate, "name")?.linea ?? gate.linea, `el job \`gate\` se llama «${escalar(hijoDe(gate, "name"))}» y la regla de la rama espera «${NOMBRE_DEL_GATE}»: nada se podría fusionar, o el gate dejaría de exigirse`, `devolvele el nombre «${NOMBRE_DEL_GATE}»`);
    const necesita = new Set(elementosDeLista(hijoDe(gate, "needs")));
    const expresion = pasosDe(gate).map((p) => p.run).join("\n");
    for (const nombre of JOBS_QUE_EXIGE_EL_GATE) {
      if (!necesita.has(nombre)) agregar("ci-gate-sin-needs", hijoDe(gate, "needs")?.linea ?? gate.linea, `el gate no espera al job \`${nombre}\` (\`needs\`): puede fallar sin que el gate lo note`, `agregá \`${nombre}\` a \`needs\` del gate`);
      if (!new RegExp(`needs\\.${nombre}\\.result\\s*\\}\\}"\\s*=\\s*"success"`).test(expresion)) {
        agregar("ci-gate-expresion", pasosDe(gate)[0]?.nodo.linea ?? gate.linea, `la expresión del gate no exige \`needs.${nombre}.result\` = "success"`, `agregá \`"\${{ needs.${nombre}.result }}" = "success"\` a la prueba del gate`);
      }
    }
  }

  // Variables que cambian a los guardianes: en cualquier línea que no sea comentario.
  lf(texto).split("\n").forEach((l, i) => {
    const m = RE_VARIABLE_PROHIBIDA.exec(sinComentarioYaml(l));
    if (m !== null) agregar("ci-variable-prohibida", i + 1, `\`${m[1]}\` en el workflow: cambia lo que hacen los guardianes (regenera o salta una línea de base)`, "sacala: esas variables se usan a mano, en local, nunca en el CI");
  });
  return hallazgos.sort((a, b) => a.linea - b.linea || a.columna - b.columna);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (b) package.json
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Los scripts cuyo valor exacto se exige. `arquitectura` es el actual de `package.json`: dependency-cruiser Y el ejecutor de evidencia de los contratos (`ejecutar.ts`, el camino B del guardián, con `tsx` y sin Vitest);
 * sacar cualquiera de los dos es un `script-distinto`. Si cambia (p. ej. se le encadena otro comando) se cambia acá, con su aprobación.
 */
const SCRIPTS_ESPERADOS: Readonly<Record<string, string>> = {
  test: "vitest run",
  arquitectura: "depcruise src plataforma next.config.ts --config .dependency-cruiser.cjs && tsx test/arquitectura/contratos/ejecutar.ts",
};
const GANCHOS_PROHIBIDOS = ["pretest", "posttest", "prearquitectura", "postarquitectura"];

const nombreDe = (p: ts.PropertyAssignment | ts.ObjectLiteralElementLike): string | null => ("name" in p && p.name !== undefined && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) ? p.name.text : null);
const propiedadDe = (o: ts.ObjectLiteralExpression, nombre: string): ts.PropertyAssignment | undefined => o.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && nombreDe(p) === nombre);
const posicionDe = (fuente: ts.SourceFile, nodo: ts.Node): { linea: number; columna: number } => {
  const { line, character } = fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente));
  return { linea: line + 1, columna: character + 1 };
};

export const evaluarScripts = (texto: string, archivo: string = RUTA_DE_PAQUETE): HallazgoDeCumplimiento[] => memorizado(`scripts\0${archivo}\0${texto}`, () => scriptsSinMemoria(texto, archivo));

function scriptsSinMemoria(texto: string, archivo: string): HallazgoDeCumplimiento[] {
  const { hallazgos, agregar } = armar(archivo);
  try {
    JSON.parse(texto);
  } catch {
    agregar("package-ilegible", 1, "package.json no es un JSON válido: no se pueden comprobar los scripts", "corregí la sintaxis de package.json");
    return hallazgos;
  }
  const fuente = ts.parseJsonText(archivo, lf(texto));
  const expresion = fuente.statements[0]?.expression;
  const raiz = expresion !== undefined && ts.isObjectLiteralExpression(expresion) ? expresion : undefined;
  const scriptsProp = raiz === undefined ? undefined : propiedadDe(raiz, "scripts");
  if (scriptsProp === undefined || !ts.isObjectLiteralExpression(scriptsProp.initializer)) {
    agregar("script-ausente", 1, "package.json no tiene la clave `scripts`: `npm test` no existe", 'restaurá `"scripts"` con `"test": "vitest run"`');
    return hallazgos;
  }
  const scripts = scriptsProp.initializer;
  const dondeScripts = posicionDe(fuente, scriptsProp);
  for (const [nombre, esperado] of Object.entries(SCRIPTS_ESPERADOS)) {
    const p = propiedadDe(scripts, nombre);
    if (p === undefined) {
      agregar("script-ausente", dondeScripts.linea, `package.json no tiene el script \`${nombre}\`: el guardián queda desconectado de \`npm run ${nombre}\``, `restaurá \`"${nombre}": "${esperado}"\``, dondeScripts.columna);
      continue;
    }
    const valor = ts.isStringLiteral(p.initializer) ? p.initializer.text : null;
    if (valor !== esperado) {
      const donde = posicionDe(fuente, p);
      agregar("script-distinto", donde.linea, `el script \`${nombre}\` es «${valor ?? "(no es un texto)"}» y tiene que ser «${esperado}»`, `restaurá \`"${nombre}": "${esperado}"\` (si el cambio es a propósito, cambiá SCRIPTS_ESPERADOS de cumplimiento.ts con su aprobación)`, donde.columna);
    }
  }
  for (const g of GANCHOS_PROHIBIDOS) {
    const p = propiedadDe(scripts, g);
    if (p !== undefined) {
      const donde = posicionDe(fuente, p);
      agregar("script-de-ganchos", donde.linea, `el script \`${g}\` corre antes o después de \`npm test\`/\`npm run arquitectura\` y puede cambiar lo que hacen`, `sacá \`${g}\``, donde.columna);
    }
  }
  return hallazgos;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (c) vitest.config.ts
// ---------------------------------------------------------------------------------------------------------------------------------

const escapar = (c: string): string => c.replace(/[.+^$()|\\]/g, "\\$&");

/** Un glob a expresión regular (`**`, `*`, `?`, `{a,b}`, `[abc]`). Devuelve null si el patrón usa algo que no se sabe analizar (`(`, `!`, `|`). */
function globARegExp(patron: string): RegExp | null {
  const p = patron.replace(/^\.\//, "");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "(" || c === ")" || c === "!" || c === "|") return null;
    if (c === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const fin = p.indexOf("}", i);
      if (fin < 0) return null;
      const alternativas = p.slice(i + 1, fin).split(",").map((a) => globARegExp(a));
      if (alternativas.some((a) => a === null)) return null;
      re += `(?:${alternativas.map((a) => a?.source.slice(1, -1)).join("|")})`;
      i = fin;
    } else if (c === "[") {
      const fin = p.indexOf("]", i);
      if (fin < 0) return null;
      re += p.slice(i, fin + 1);
      i = fin;
    } else re += escapar(c);
  }
  return new RegExp(`^${re}$`);
}

/** ¿El patrón (como lo lee Vitest: un glob, o una carpeta) alcanza a esta ruta? `null` si no se sabe analizar el patrón. */
export function patronAlcanza(patron: string, ruta: string): boolean | null {
  const directo = globARegExp(patron);
  const carpeta = globARegExp(`${patron.replace(/\/+$/, "")}/**`);
  if (directo === null || carpeta === null) return null;
  return directo.test(ruta) || carpeta.test(ruta);
}

const CLAVES_QUE_CAMBIAN_QUE_SE_CORRE = ["projects", "workspace", "dir", "root", "testNamePattern"];

export const evaluarConfigDeVitest = (texto: string, protegidos: readonly string[], archivo: string = RUTA_DE_VITEST): HallazgoDeCumplimiento[] =>
  memorizado(`vitest\0${archivo}\0${protegidos.join(",")}\0${texto}`, () => configDeVitestSinMemoria(texto, protegidos, archivo));

function configDeVitestSinMemoria(texto: string, protegidos: readonly string[], archivo: string): HallazgoDeCumplimiento[] {
  const { hallazgos, agregar } = armar(archivo);
  const fuente = arbolMemoizado(archivo, lf(texto));
  const noAnalizable = (nodo: ts.Node, que: string): void => {
    const d = posicionDe(fuente, nodo);
    agregar("vitest-no-analizable", d.linea, `${que}: no se puede comprobar estáticamente que no deje afuera a un guardián`, "escribilo como literales (listas de textos, `...configDefaults.exclude`) para que se pueda analizar", d.columna);
  };
  const exportada = fuente.statements.find((s): s is ts.ExportAssignment => ts.isExportAssignment(s));
  const llamada = exportada?.expression;
  const argumento = llamada !== undefined && ts.isCallExpression(llamada) ? llamada.arguments[0] : llamada;
  if (argumento === undefined || !ts.isObjectLiteralExpression(argumento)) {
    agregar("vitest-no-analizable", 1, "vitest.config.ts no exporta `defineConfig({ … })` con un objeto literal", "restaurá `export default defineConfig({ … })` con un objeto literal");
    return hallazgos;
  }
  for (const p of argumento.properties) if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p) && !ts.isMethodDeclaration(p)) noAnalizable(p, "la configuración usa una propagación (`...`) o un acceso que no es una propiedad simple");
  const raizRoot = propiedadDe(argumento, "root");
  if (raizRoot !== undefined) {
    const d = posicionDe(fuente, raizRoot);
    agregar("vitest-clave-peligrosa", d.linea, "`root` cambia desde dónde Vitest busca los tests", "sacá `root`", d.columna);
  }
  const testProp = propiedadDe(argumento, "test");
  if (testProp === undefined) return hallazgos;
  if (!ts.isObjectLiteralExpression(testProp.initializer)) {
    noAnalizable(testProp, "`test` no es un objeto literal");
    return hallazgos;
  }
  const prueba = testProp.initializer;
  for (const p of prueba.properties) if (!ts.isPropertyAssignment(p)) noAnalizable(p, "`test` usa una propagación (`...`) o una propiedad que no es simple");

  for (const clave of CLAVES_QUE_CAMBIAN_QUE_SE_CORRE) {
    const p = propiedadDe(prueba, clave);
    if (p !== undefined) {
      const d = posicionDe(fuente, p);
      agregar("vitest-clave-peligrosa", d.linea, `\`test.${clave}\` cambia qué tests se corren o desde dónde`, `sacá \`${clave}\` (los guardianes corren con la configuración por defecto de Vitest)`, d.columna);
    }
  }

  const allowOnly = propiedadDe(prueba, "allowOnly");
  if (allowOnly !== undefined && allowOnly.initializer.kind !== ts.SyntaxKind.FalseKeyword) {
    const d = posicionDe(fuente, allowOnly);
    agregar("vitest-allowonly", d.linea, "`allowOnly` no es `false`: un `.only` en un test deja de fallar y el resto de los tests no corre", "sacá `allowOnly` (el valor por defecto ya falla en CI)", d.columna);
  }

  const exclude = propiedadDe(prueba, "exclude");
  if (exclude !== undefined) {
    if (!ts.isArrayLiteralExpression(exclude.initializer)) noAnalizable(exclude, "`test.exclude` no es una lista literal");
    else {
      for (const e of exclude.initializer.elements) {
        if (ts.isSpreadElement(e) && e.expression.getText(fuente) === "configDefaults.exclude") continue;
        if (!ts.isStringLiteral(e)) {
          noAnalizable(e, "un elemento de `test.exclude` no es un texto ni `...configDefaults.exclude`");
          continue;
        }
        const alcanzados = protegidos.map((r) => ({ r, ok: patronAlcanza(e.text, r) }));
        if (alcanzados.some((a) => a.ok === null)) {
          noAnalizable(e, `el patrón «${e.text}» de \`test.exclude\` usa una sintaxis de glob que no se sabe analizar`);
          continue;
        }
        const dejaAfuera = alcanzados.filter((a) => a.ok === true).map((a) => a.r);
        if (dejaAfuera.length > 0) {
          const d = posicionDe(fuente, e);
          agregar("vitest-excluye-guardian", d.linea, `el patrón «${e.text}» de \`test.exclude\` deja afuera ${dejaAfuera.length} guardián(es) protegido(s), p. ej. ${dejaAfuera[0]}: \`npm test\` ya no los corre`, `sacá «${e.text}» de \`test.exclude\``, d.columna);
        }
      }
    }
  }

  const include = propiedadDe(prueba, "include");
  if (include !== undefined) {
    if (!ts.isArrayLiteralExpression(include.initializer) || !include.initializer.elements.every(ts.isStringLiteral)) noAnalizable(include, "`test.include` no es una lista literal de textos");
    else {
      const patrones = include.initializer.elements.map((e) => (e as ts.StringLiteral).text);
      const sinCubrir = protegidos.filter((r) => !patrones.some((p) => patronAlcanza(p, r) === true));
      if (sinCubrir.length > 0) {
        const d = posicionDe(fuente, include);
        agregar("vitest-include-no-cubre", d.linea, `\`test.include\` no alcanza a ${sinCubrir.length} guardián(es) protegido(s), p. ej. ${sinCubrir[0]}: \`npm test\` no los corre`, "sacá `include` (el valor por defecto corre todo `*.test.ts`) o agregá un patrón que los cubra", d.columna);
      }
    }
  }
  return hallazgos.sort((a, b) => a.linea - b.linea || a.columna - b.columna);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (d) skip / only en los tests protegidos
// ---------------------------------------------------------------------------------------------------------------------------------

const PROPIEDADES_QUE_APAGAN = new Set(["skip", "only", "todo", "skipIf", "runIf"]);
const FUNCIONES_QUE_APAGAN = new Set(["xit", "xdescribe", "xtest", "fit", "fdescribe"]);

function raizDe(e: ts.Expression): string | null {
  let actual: ts.Expression = e;
  while (true) {
    if (ts.isIdentifier(actual)) return actual.text;
    if (ts.isPropertyAccessExpression(actual) || ts.isElementAccessExpression(actual)) actual = actual.expression;
    else if (ts.isCallExpression(actual)) actual = actual.expression;
    else if (ts.isNonNullExpression(actual) || ts.isParenthesizedExpression(actual)) actual = actual.expression;
    else return null;
  }
}

/** Un test protegido: ningún `skip`/`only`/`todo`/`skipIf`/`runIf`/`ctx.skip`/`xit`/`xdescribe` (mirando el AST: una mención en un texto o en un comentario no cuenta) y al menos un `it` o `test`. */
export const evaluarPruebaProtegida = (texto: string, archivo: string): HallazgoDeCumplimiento[] => memorizado(`prueba\0${archivo}\0${texto}`, () => pruebaProtegidaSinMemoria(texto, archivo));

function pruebaProtegidaSinMemoria(texto: string, archivo: string): HallazgoDeCumplimiento[] {
  const { hallazgos, agregar } = armar(archivo);
  const fuente = arbolMemoizado(archivo, lf(texto));
  let pruebas = 0;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isPropertyAccessExpression(nodo) && PROPIEDADES_QUE_APAGAN.has(nodo.name.text)) {
      const d = posicionDe(fuente, nodo);
      agregar("prueba-desactivada", d.linea, `\`${nodo.getText(fuente).split("\n")[0].slice(0, 60)}\` desactiva o recorta pruebas de un guardián protegido (\`.${nodo.name.text}\`)`, `sacá \`.${nodo.name.text}\`: los tests de un guardián corren todos, siempre`, d.columna);
    } else if (ts.isElementAccessExpression(nodo) && ts.isStringLiteralLike(nodo.argumentExpression) && PROPIEDADES_QUE_APAGAN.has(nodo.argumentExpression.text)) {
      const d = posicionDe(fuente, nodo);
      agregar("prueba-desactivada", d.linea, `\`${nodo.getText(fuente).split("\n")[0].slice(0, 60)}\` desactiva o recorta pruebas de un guardián protegido`, `sacá el acceso a \`${nodo.argumentExpression.text}\``, d.columna);
    } else if (ts.isCallExpression(nodo)) {
      if (ts.isIdentifier(nodo.expression) && FUNCIONES_QUE_APAGAN.has(nodo.expression.text)) {
        const d = posicionDe(fuente, nodo);
        agregar("prueba-desactivada", d.linea, `\`${nodo.expression.text}(…)\` desactiva o recorta pruebas de un guardián protegido`, `usá la forma sin prefijo (\`it\`, \`describe\`, \`test\`)`, d.columna);
      }
      const r = raizDe(nodo.expression);
      if ((r === "it" || r === "test") && !PROPIEDADES_QUE_APAGAN.has(ts.isPropertyAccessExpression(nodo.expression) ? nodo.expression.name.text : "")) pruebas++;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  if (pruebas === 0) agregar("guardian-sin-pruebas", 1, "el archivo no tiene ningún `it(…)` ni `test(…)`: un guardián sin pruebas no verifica nada", "restaurá sus pruebas");
  return hallazgos.sort((a, b) => a.linea - b.linea || a.columna - b.columna);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (e) Cableado de los tests protegidos
// ---------------------------------------------------------------------------------------------------------------------------------

/** Los tests propios del guardián de contratos que tienen que existir. Una prueba nueva de esa carpeta se protege sola (se descubre); una que se borra o se renombra falla acá. */
const GUARDIANES_ESPERADOS: readonly string[] = [
  `${CARPETA_DE_CONTRATOS}/contratos.test.ts`,
  `${CARPETA_DE_CONTRATOS}/motor.test.ts`,
  `${CARPETA_DE_CONTRATOS}/mutaciones-de-contratos.test.ts`,
  `${CARPETA_DE_CONTRATOS}/contratos-de-la-carta.test.ts`,
  `${CARPETA_DE_CONTRATOS}/contratos-del-sistema-visual.test.ts`,
  `${CARPETA_DE_CONTRATOS}/gobernanza/areas.test.ts`,
  `${CARPETA_DE_CONTRATOS}/gobernanza/clasificacion.test.ts`,
  `${CARPETA_DE_CONTRATOS}/gobernanza/aprobaciones.test.ts`,
  `${CARPETA_DE_CONTRATOS}/gobernanza/cumplimiento.test.ts`,
];

/** Los guardianes de `test/arquitectura/` que también se protegen: los que fijan hashes, el CI, las rutas del núcleo y los escapes de entorno de los demás guardianes. */
export const GUARDIANES_ADICIONALES: readonly string[] = [
  "test/arquitectura/caracterizaciones-congeladas.test.ts",
  "test/arquitectura/despliegues-y-cadena-de-suministro.test.ts",
  "test/arquitectura/rol-de-pruebas-solo-local.test.ts",
  "test/arquitectura/dominios-clasificados.test.ts",
  "test/arquitectura/entornos-y-escapes.test.ts",
  "test/arquitectura/cercos/trinquete.test.ts",
];

const GUARDIANES_ESPERADOS_EN_TOTAL: readonly string[] = [...GUARDIANES_ESPERADOS, ...GUARDIANES_ADICIONALES];

/** ¿Un archivo `.ts` que no termina en `.test.ts` llama a `describe`/`it`/`test` al nivel de arriba? Entonces es un test que Vitest no corre. */
function primeraLlamadaDePruebas(texto: string, archivo: string): { linea: number; columna: number } | null {
  const fuente = arbolMemoizado(archivo, lf(texto));
  for (const s of fuente.statements) {
    if (ts.isExpressionStatement(s) && ts.isCallExpression(s.expression)) {
      const r = raizDe(s.expression.expression);
      if (r === "describe" || r === "it" || r === "test") return posicionDe(fuente, s);
    }
  }
  return null;
}

/**
 * `esperados`: las rutas de los guardianes que tienen que existir. `archivos`: ruta → texto de los `.ts` que hay hoy en la carpeta de contratos (los que existen, para cazar un test renombrado).
 */
export function evaluarCableado(esperados: readonly string[], archivos: ReadonlyMap<string, string>): HallazgoDeCumplimiento[] {
  const salida: HallazgoDeCumplimiento[] = [];
  for (const ruta of esperados) {
    const { hallazgos, agregar } = armar(ruta);
    if (!ruta.startsWith("test/") || !ruta.endsWith(".test.ts")) {
      agregar("guardian-mal-cableado", 1, `el guardián «${ruta}» no está bajo \`test/\` o no termina en \`.test.ts\`: Vitest no lo corre`, "dejalo bajo `test/` y con el sufijo `.test.ts`");
    } else if (!archivos.has(ruta)) {
      agregar("guardian-ausente", 1, `el guardián «${ruta}» no existe: se borró o se renombró, y \`npm test\` ya no lo corre`, `restauralo en esa ruta (si se mudó a propósito, cambiá GUARDIANES_ESPERADOS de cumplimiento.ts con su aprobación)`);
    }
    salida.push(...hallazgos);
  }
  for (const [ruta, texto] of archivos) {
    if (ruta.endsWith(".test.ts")) continue;
    const donde = primeraLlamadaDePruebas(texto, ruta);
    if (donde !== null) {
      const { hallazgos, agregar } = armar(ruta);
      agregar("prueba-sin-sufijo-test", donde.linea, `«${ruta}» tiene pruebas (\`describe\`/\`it\`/\`test\`) y no termina en \`.test.ts\`: Vitest no las corre`, "renombralo a `.test.ts`", donde.columna);
      salida.push(...hallazgos);
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (f) El manifiesto
// ---------------------------------------------------------------------------------------------------------------------------------

export function evaluarManifiesto(ids: readonly string[], aprobados: readonly string[], archivo = `${CARPETA_DE_CONTRATOS}/manifiesto.ts`): HallazgoDeCumplimiento[] {
  const { hallazgos, agregar } = armar(archivo);
  if (ids.length === 0) agregar("manifiesto-vacio", 1, "el manifiesto no tiene ningún contrato: el guardián pasa porque no vigila nada", "restaurá los contratos en `manifiesto.ts`");
  for (const id of ids) {
    if (!aprobados.includes(id)) agregar("contrato-sin-aprobar", 1, `el contrato «${id}» está en el manifiesto y no tiene su aprobación en el registro`, `agregá la aprobación de «${id}» al registro APROBACIONES de aprobaciones.ts (referencia + motivo)`);
  }
  for (const id of aprobados) {
    if (!ids.includes(id)) agregar("aprobado-ausente-del-manifiesto", 1, `el contrato «${id}» tiene una aprobación vigente y ya no está en el manifiesto`, `restauralo en \`manifiesto.ts\`, o agregá el retiro de «${id}» al registro APROBACIONES (blob «retirado», referencia + motivo)`);
  }
  return hallazgos;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// El árbol real (o una copia)
// ---------------------------------------------------------------------------------------------------------------------------------

const leerONulo = (raiz: string, ruta: string): string | null => {
  const absoluta = join(raiz, ...ruta.split("/"));
  return existsSync(absoluta) ? lf(readFileSync(absoluta, "utf8")) : null;
};

/** Todos los `.ts` bajo una carpeta, como ruta relativa a `raiz` → texto. */
function tsBajo(raiz: string, carpeta: string): Map<string, string> {
  const salida = new Map<string, string>();
  const recorrer = (dir: string): void => {
    const absoluta = join(raiz, ...dir.split("/"));
    if (!existsSync(absoluta)) return;
    for (const nombre of readdirSync(absoluta).sort()) {
      const ruta = `${dir}/${nombre}`;
      if (statSync(join(raiz, ...ruta.split("/"))).isDirectory()) recorrer(ruta);
      else if (nombre.endsWith(".ts")) salida.set(ruta, lf(readFileSync(join(raiz, ...ruta.split("/")), "utf8")));
    }
  };
  recorrer(carpeta);
  return salida;
}

export interface OpcionesDeCumplimiento {
  /** El manifiesto en uso (el real, o el alterado de una mutación). */
  contratos?: readonly Contrato[];
  /** El registro de aprobaciones en uso (el real, o uno de prueba). */
  registro?: readonly Aprobacion[];
}

export interface ResultadoDeCumplimiento {
  hallazgos: HallazgoDeCumplimiento[];
  /** Los tests protegidos que se revisaron (esperados más descubiertos). */
  protegidos: readonly string[];
}

/** Corre los evaluadores sobre el árbol en `raiz`. Un archivo que falta es un hallazgo (`archivo-ausente`), no un «nada que revisar». */
export function revisarCumplimiento(raiz: string, opciones: OpcionesDeCumplimiento = {}): ResultadoDeCumplimiento {
  const contratos = opciones.contratos ?? MANIFIESTO;
  const registro = opciones.registro ?? APROBACIONES;
  const hallazgos: HallazgoDeCumplimiento[] = [];
  const sinArchivo = (ruta: string): void => void hallazgos.push({ tipo: "archivo-ausente", archivo: ruta, linea: 1, columna: 1, que: `no existe «${ruta}»: no se puede comprobar su cableado`, como: `restauralo en la raíz del repo` });

  const ci = leerONulo(raiz, RUTA_DE_CI);
  if (ci === null) sinArchivo(RUTA_DE_CI);
  else hallazgos.push(...evaluarWorkflow(ci));
  const paquete = leerONulo(raiz, RUTA_DE_PAQUETE);
  if (paquete === null) sinArchivo(RUTA_DE_PAQUETE);
  else hallazgos.push(...evaluarScripts(paquete));

  const deContratos = tsBajo(raiz, CARPETA_DE_CONTRATOS);
  const protegidos = [...new Set([...GUARDIANES_ESPERADOS_EN_TOTAL, ...[...deContratos.keys()].filter((r) => r.endsWith(".test.ts"))])].sort();
  const vitest = leerONulo(raiz, RUTA_DE_VITEST);
  if (vitest === null) sinArchivo(RUTA_DE_VITEST);
  else hallazgos.push(...evaluarConfigDeVitest(vitest, protegidos));

  const existentes = new Map(deContratos);
  for (const r of GUARDIANES_ADICIONALES) {
    const texto = leerONulo(raiz, r);
    if (texto !== null) existentes.set(r, texto);
  }
  hallazgos.push(...evaluarCableado(GUARDIANES_ESPERADOS_EN_TOTAL, existentes));
  for (const ruta of protegidos) {
    const texto = leerONulo(raiz, ruta);
    if (texto !== null) hallazgos.push(...evaluarPruebaProtegida(texto, ruta));
  }
  hallazgos.push(...evaluarManifiesto(contratos.map((c) => c.id).sort(), idsDeContratosAprobados(registro)));
  return { hallazgos, protegidos };
}

export const formatearHallazgoDeCumplimiento = (h: HallazgoDeCumplimiento): string => `${h.archivo}:${h.linea}:${h.columna}  [cumplimiento · ${h.tipo}]\n  ${h.que} → ${h.como}`;

export const resumirCumplimiento = (r: ResultadoDeCumplimiento): string => `${r.protegidos.length} tests protegidos, ${r.hallazgos.length} hallazgos`;

export const formatearReporteDeCumplimiento = (r: ResultadoDeCumplimiento): string => [...r.hallazgos.map(formatearHallazgoDeCumplimiento), resumirCumplimiento(r)].join("\n");

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { formatearHallazgo, revisarContratos } from "../motor";
import { APROBACIONES, idsDeContratosAprobados, revisarAprobaciones, rutasDelMecanismo, type Aprobacion } from "../gobernanza/aprobaciones";
import { GUARDIANES_ADICIONALES, revisarCumplimiento } from "../gobernanza/cumplimiento";
import { archivosEnAlcance, problemasEstructurales } from "../gobernanza/evidencia";
import { ARCHIVO_DE_AREAS, AREAS, POLITICA_DE_TIPOS, areaDe, compararAreas, posicionEnTexto, type DeclaracionDeAreas } from "../gobernanza/areas";
import { REGLAS_DE_RUTA, clasificarRutas, leerCronsDeVercel, listarRutasConGit, type ReglaDeRuta, type TipoDeRuta } from "../gobernanza/clasificacion";
import { EXCLUSIONES, type Exclusion } from "../gobernanza/exclusiones";
import { usosDeContratos } from "../gobernanza/usos";
import type { Contrato } from "../tipos";
import { construirMatriz, type ClaseDeMutacion, type EsperadoDeMutacion, type EstadoDeMutacion, type Matriz, type MutacionDeMatriz } from "./matriz";
import { ARCHIVO_DEL_MANIFIESTO, OPERADORES, archivosDelAlcance, esNoAplica, type BaseDeMutacion, type Cambio, type EjemplosDeContrato, type Mutacion, type Verifica } from "./operadores";

/**
 * El ARNÉS de mutaciones (paso G6a): corre cada mutación de la matriz (`matriz.ts`) sobre una COPIA del repo (nunca el repo real), compara lo que el guardián dice con lo que la matriz
 * espera y devuelve una tabla (invariante · clase · elemento · mutación · resultado esperado · resultado real). No escribe nada en el repo.
 *
 * La copia es MÍNIMA pero FIEL: lleva todo archivo que puede cambiar el veredicto del motor (los que mencionan la marca, los del alcance de cada contrato, las fuentes y sus
 * definiciones) más los archivos del propio guardián y de su CI. Lo demás del repo no puede producir un hallazgo del motor, y la clasificación y las áreas miran el listado REAL de git
 * (más lo que cada mutación agrega o saca), no la copia.
 */

export interface Observado {
  verifica: Verifica;
  tipo: string;
  archivo: string;
  linea: number;
  columna: number;
  /** El contrato, el área o el sujeto del hallazgo. */
  sujeto: string;
  que: string;
  como: string;
}

export type Veredicto =
  /** La mutación dio el hallazgo esperado (tipo, archivo, línea y mensaje). */
  | "protegido"
  /** Hueco conocido: la mutación sigue sin detectarse, como dice la matriz. */
  | "hueco-conocido-confirmado"
  /** HUECO: la mutación sobrevivió (la verificación pasó o dio otra cosa). */
  | "HUECO"
  /** Un hueco conocido que ya se detecta: hay que marcarlo `protegido` y sacar su deuda. */
  | "hueco-ya-protegido"
  | "no-aplica"
  | "error-del-operador"
  /** Después de revertir, el guardián no volvió a dar 0 hallazgos. */
  | "aislamiento-roto";

export interface FilaDeResultado {
  invariante: string;
  clase: ClaseDeMutacion;
  elemento: string;
  mutacion: string;
  operador: string;
  estado: EstadoDeMutacion;
  hueco: string;
  esperado: string;
  real: string;
  veredicto: Veredicto;
  detalle: string;
}

export interface OpcionesDelArnes {
  raizReal: string;
  contratos: readonly Contrato[];
  ejemplos: Readonly<Record<string, EjemplosDeContrato>>;
  hoy: string;
  /** Solo los invariantes de los contratos y solo el motor (un árbol sintético sin git, sin clasificación ni áreas). */
  soloContratos: boolean;
  /** Para probar el propio arnés: altera la matriz antes de correrla (p. ej. marca como protegida una mutación que sobrevive). */
  alterar?: (matriz: Matriz) => Matriz;
  /** Para probar el propio arnés: corre solo las mutaciones que cumplen el filtro. */
  filtro?: (invariante: string, mutacion: MutacionDeMatriz) => boolean;
}

export interface ResultadoDelArnes {
  matriz: Matriz;
  filas: readonly FilaDeResultado[];
  /** Cuántas mutaciones se aplicaron de verdad (sin contar las que no aplican). */
  corridas: number;
  milisegundos: number;
  /** En qué se fue el tiempo (ms, acumulado de todas las verificaciones). */
  tiempos: Readonly<Record<"motor" | "clasificacion" | "areas" | "cumplimiento" | "aprobaciones" | "evidencia", number>>;
  /** Lo que da el guardián sobre la copia SIN mutar: tiene que ser vacío. */
  baseLimpia: readonly Observado[];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La copia
// ---------------------------------------------------------------------------------------------------------------------------------

const RAICES_DE_MARCAS = ["src/", "plataforma/", "scripts/", "prisma/", "test/"];
const DEL_GUARDIAN = ["test/arquitectura/cercos/trinquete.ts", ".github/workflows/ci.yml", "package.json", "vitest.config.ts"];
const PREFIJO_DEL_GUARDIAN = "test/arquitectura/contratos/";

const abs = (raiz: string, ruta: string): string => join(raiz, ...ruta.split("/"));

function caminar(raiz: string, dir = ""): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(abs(raiz, dir)).sort()) {
    if (nombre === "node_modules" || nombre === ".git") continue;
    const ruta = dir === "" ? nombre : `${dir}/${nombre}`;
    if (statSync(abs(raiz, ruta)).isDirectory()) salida.push(...caminar(raiz, ruta));
    else salida.push(ruta);
  }
  return salida;
}

interface Preparada {
  base: BaseDeMutacion;
  /** Los datos reales de la clasificación (no cambian entre mutaciones). */
  raizReal: string;
  limpiar: () => void;
}

function prepararBase(o: OpcionesDelArnes): Preparada {
  const archivos = o.soloContratos ? caminar(o.raizReal) : listarRutasConGit(o.raizReal).archivos;
  const reglas: readonly ReglaDeRuta[] = o.soloContratos ? [] : REGLAS_DE_RUTA;
  const exclusiones: readonly Exclusion[] = o.soloContratos ? [] : EXCLUSIONES;
  const crons = o.soloContratos ? [] : leerCronsDeVercel(o.raizReal);
  const areas: DeclaracionDeAreas = o.soloContratos ? {} : AREAS;

  const aCopiar = new Set<string>();
  for (const ruta of archivos) {
    if (RAICES_DE_MARCAS.some((r) => ruta.startsWith(r)) && /\.(tsx?|css)$/.test(ruta) && readFileSync(abs(o.raizReal, ruta), "utf8").includes("@contrato")) aCopiar.add(ruta);
    if (ruta.startsWith(PREFIJO_DEL_GUARDIAN) || DEL_GUARDIAN.includes(ruta)) aCopiar.add(ruta);
  }
  // Lo que el cumplimiento y el registro de aprobaciones leen: el mecanismo entero (también lo que hashean en parte) y los guardianes adicionales que protegen.
  if (!o.soloContratos) for (const r of [...rutasDelMecanismo(o.raizReal), ...GUARDIANES_ADICIONALES]) if (existsSync(abs(o.raizReal, r))) aCopiar.add(r);
  for (const c of o.contratos) {
    for (const r of archivosDelAlcance({ archivos }, c)) aCopiar.add(r);
    for (const r of [c.fuente.archivo, `${PREFIJO_DEL_GUARDIAN}contratos/${c.id}.ts`]) if (archivos.includes(r)) aCopiar.add(r);
  }
  const raizCopia = mkdtempSync(join(tmpdir(), "mutaciones-copia-"));
  for (const ruta of aCopiar) {
    const destino = abs(raizCopia, ruta);
    mkdirSync(dirname(destino), { recursive: true });
    cpSync(abs(o.raizReal, ruta), destino);
  }

  const areaDeArchivo = new Map<string, string>();
  if (!o.soloContratos) {
    const { tipos } = clasificarRutas({ archivos, ignorados: [], crons, reglas, exclusiones, hoy: o.hoy });
    for (const [ruta, tipo] of tipos) {
      const a = POLITICA_DE_TIPOS[tipo].declara ? areaDe(ruta, tipo) : null;
      if (a !== null) areaDeArchivo.set(ruta, a);
    }
  }
  const base: BaseDeMutacion = {
    raiz: raizCopia,
    contratos: o.contratos,
    hoy: o.hoy,
    archivos,
    reglas,
    exclusiones,
    crons,
    areas,
    textoDeAreas: o.soloContratos ? "" : readFileSync(abs(o.raizReal, ARCHIVO_DE_AREAS), "utf8"),
    areaDeArchivo,
    ejemplos: o.ejemplos,
  };
  return { base, raizReal: o.raizReal, limpiar: () => rmSync(raizCopia, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Verificar: el motor, la clasificación y las áreas sobre la copia (con lo que la mutación altera en memoria)
// ---------------------------------------------------------------------------------------------------------------------------------

interface Escenario {
  contratos: readonly Contrato[];
  hoy: string;
  areas: DeclaracionDeAreas;
  reglas: readonly ReglaDeRuta[];
  exclusiones: readonly Exclusion[];
  politicaDeTipos: typeof POLITICA_DE_TIPOS;
  registro: readonly Aprobacion[];
  /** El piso de archivos leídos de la evidencia. La copia es mínima (no tiene los 2.500 archivos del repo): el piso real se prueba en el repo real, acá solo hace falta que el control exista y falle cuando se lo sube. */
  piso: number;
  crons: readonly string[];
  ignoradas: readonly string[];
  archivos: readonly string[];
}

/** El piso de archivos leídos en la copia mínima: basta con que el motor haya leído alguno. */
const PISO_DE_LA_COPIA = 1;

const escenarioBase = (base: BaseDeMutacion): Escenario => ({
  contratos: base.contratos,
  hoy: base.hoy,
  areas: base.areas,
  reglas: base.reglas,
  exclusiones: base.exclusiones,
  politicaDeTipos: POLITICA_DE_TIPOS,
  registro: APROBACIONES,
  piso: PISO_DE_LA_COPIA,
  crons: base.crons,
  ignoradas: [],
  archivos: base.archivos,
});

/** Cuánto tardó cada verificación (ms), acumulado: para medir y optimizar el arnés. */
const tiempos = { motor: 0, clasificacion: 0, areas: 0, cumplimiento: 0, aprobaciones: 0, evidencia: 0 };
const medir = <T>(clave: keyof typeof tiempos, f: () => T): T => {
  const t0 = performance.now();
  try {
    return f();
  } finally {
    tiempos[clave] += performance.now() - t0;
  }
};

/**
 * `conMecanismo`: además del motor, la clasificación y las áreas, corre el cumplimiento del cableado, el registro de aprobaciones y los controles estructurales de la evidencia por corrida (`gobernanza/evidencia.ts`). Se pide en las mutaciones de evasión y en las que tocan el mecanismo
 * (ver `tocaElMecanismo`): son las que pueden dar uno de esos hallazgos, y correrlos en las cientos de mutaciones de contratos sería pagar tiempo para no mirar nada.
 */
function observar(base: BaseDeMutacion, e: Escenario, soloMotor: boolean, conMecanismo: boolean): Observado[] {
  const salida: Observado[] = [];
  let manifiestoValido = true;
  let archivosLeidos = 0;
  try {
    const del = medir("motor", () => revisarContratos({ raiz: base.raiz, contratos: e.contratos, hoy: e.hoy }));
    archivosLeidos = del.resumen.archivosLeidos;
    for (const h of del.hallazgos) {
      salida.push({ verifica: "motor", tipo: h.tipo, archivo: h.archivo, linea: h.linea, columna: h.columna, sujeto: h.contrato, que: h.que, como: `${h.como} · ${formatearHallazgo(h).split("\n")[0]}` });
    }
  } catch (error) {
    manifiestoValido = false;
    salida.push({ verifica: "manifiesto", tipo: "manifiesto-mal-armado", archivo: ARCHIVO_DEL_MANIFIESTO, linea: 1, columna: 1, sujeto: "", que: (error as Error).message, como: "corregí el manifiesto: el motor lo lanza en vez de dar un hallazgo" });
  }
  if (soloMotor) return salida;
  let tipos: ReadonlyMap<string, TipoDeRuta> | null = null;
  try {
    const r = medir("clasificacion", () => clasificarRutas({ archivos: e.archivos, ignorados: e.ignoradas, crons: e.crons, reglas: e.reglas, exclusiones: e.exclusiones, hoy: e.hoy }));
    for (const h of r.hallazgos) salida.push({ verifica: "clasificacion", tipo: h.tipo, archivo: h.archivo, linea: h.linea, columna: h.columna, sujeto: "", que: h.que, como: h.como });
    tipos = r.tipos;
  } catch (error) {
    salida.push({ verifica: "manifiesto", tipo: "reglas-mal-armadas", archivo: "test/arquitectura/contratos/gobernanza/clasificacion.ts", linea: 1, columna: 1, sujeto: "", que: (error as Error).message, como: "corregí las reglas: la clasificación las lanza" });
  }
  if (tipos === null || !manifiestoValido) return salida;
  const ar = medir("areas", () => compararAreas({ tipos, declaraciones: e.areas, usos: usosDeContratos(base.raiz, e.contratos), posicionDeEntrada: (a) => posicionEnTexto(base.textoDeAreas, a) }));
  for (const h of ar.hallazgos) salida.push({ verifica: "areas", tipo: h.tipo, archivo: h.archivo, linea: h.linea, columna: h.columna, sujeto: h.area, que: h.que, como: h.como });
  if (!conMecanismo) return salida;
  for (const h of medir("cumplimiento", () => revisarCumplimiento(base.raiz, { contratos: e.contratos, registro: e.registro })).hallazgos) {
    salida.push({ verifica: "cumplimiento", tipo: h.tipo, archivo: h.archivo, linea: h.linea, columna: h.columna, sujeto: "", que: h.que, como: h.como });
  }
  const aprobaciones = medir("aprobaciones", () => revisarAprobaciones({ raiz: base.raiz, contratos: e.contratos, exclusiones: e.exclusiones, politicaDeTipos: e.politicaDeTipos, registro: e.registro }));
  for (const h of aprobaciones.hallazgos) salida.push({ verifica: "aprobaciones", tipo: h.tipo, archivo: h.archivo, linea: h.linea, columna: h.columna, sujeto: h.clave, que: h.que, como: h.como });
  // La evidencia por corrida: los tres controles que separan «pasó» de «no encontró nada» (ids distintos del aprobado, alcance de 0 archivos, menos archivos leídos que el piso).
  const estructurales = medir("evidencia", () =>
    problemasEstructurales({
      ids: e.contratos.map((c) => c.id).sort(),
      aprobados: idsDeContratosAprobados(e.registro),
      alcances: e.contratos.map((c) => ({ id: c.id, raices: c.alcance.raices, archivos: archivosEnAlcance(base.raiz, c).length })),
      archivosLeidos,
      piso: e.piso,
    })
  );
  for (const p of estructurales) salida.push({ verifica: "evidencia", tipo: p.tipo, archivo: p.archivo, linea: 1, columna: 1, sujeto: p.sujeto, que: p.que, como: p.como });
  return salida;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Aplicar y revertir cambios sobre la copia
// ---------------------------------------------------------------------------------------------------------------------------------

function aplicarAlListado(archivos: readonly string[], cambios: readonly Cambio[]): string[] {
  const set = new Set(archivos);
  for (const c of cambios) {
    if (c.op === "escribir") set.add(c.ruta);
    else if (c.op === "borrar") set.delete(c.ruta);
    else {
      for (const f of [...set]) {
        if (f === c.de || f.startsWith(`${c.de}/`)) {
          set.delete(f);
          set.add(`${c.a}${f.slice(c.de.length)}`);
        }
      }
    }
  }
  return [...set].sort();
}

interface Deshacer {
  revertir: () => void;
}

function aplicarEnDisco(raiz: string, cambios: readonly Cambio[]): Deshacer {
  const originales = new Map<string, string | null>();
  const movidos: { de: string; a: string }[] = [];
  const creadas: string[] = [];
  const guardar = (ruta: string): void => {
    if (!originales.has(ruta)) originales.set(ruta, existsSync(abs(raiz, ruta)) ? readFileSync(abs(raiz, ruta), "utf8") : null);
  };
  for (const c of cambios) {
    if (c.op === "escribir") {
      guardar(c.ruta);
      const creada = mkdirSync(dirname(abs(raiz, c.ruta)), { recursive: true });
      if (creada !== undefined) creadas.push(creada);
      writeFileSync(abs(raiz, c.ruta), c.contenido);
    } else if (c.op === "borrar") {
      if (existsSync(abs(raiz, c.ruta))) {
        guardar(c.ruta);
        rmSync(abs(raiz, c.ruta));
      }
    } else if (existsSync(abs(raiz, c.de))) {
      const creada = mkdirSync(dirname(abs(raiz, c.a)), { recursive: true });
      if (creada !== undefined) creadas.push(creada);
      renameSync(abs(raiz, c.de), abs(raiz, c.a));
      movidos.push({ de: c.de, a: c.a });
    }
  }
  return {
    revertir: () => {
      for (const m of [...movidos].reverse()) renameSync(abs(raiz, m.a), abs(raiz, m.de));
      for (const [ruta, contenido] of originales) {
        if (contenido === null) rmSync(abs(raiz, ruta), { force: true });
        else {
          mkdirSync(dirname(abs(raiz, ruta)), { recursive: true });
          writeFileSync(abs(raiz, ruta), contenido);
        }
      }
      for (const dir of creadas) if (existsSync(dir) && caminar(dir, "").length === 0) rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Verificar con las pruebas del propio guardián (banco aparte, en paralelo)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Corre las pruebas indicadas en un banco con la mutación aplicada; devuelve una prueba roja por cada una que falla. */
async function correrPruebasEnBanco(p: Preparada, m: Mutacion): Promise<Observado[]> {
  const banco = mkdtempSync(join(tmpdir(), "mutaciones-banco-"));
  try {
    for (const ruta of caminar(p.base.raiz).filter((r) => r.startsWith(PREFIJO_DEL_GUARDIAN) || r === "test/arquitectura/cercos/trinquete.ts")) {
      mkdirSync(dirname(abs(banco, ruta)), { recursive: true });
      cpSync(abs(p.base.raiz, ruta), abs(banco, ruta));
    }
    symlinkSync(join(p.raizReal, "node_modules"), join(banco, "node_modules"), "dir");
    writeFileSync(join(banco, "vitest.banco.config.mjs"), 'export default { test: { environment: "node", include: ["test/**/*.test.ts"] } };\n');
    aplicarEnDisco(banco, m.cambios);
    const entorno: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(entorno)) if (k.startsWith("VITEST")) delete entorno[k];
    const salida = await new Promise<string>((resolver) => {
      const hijo = spawn(process.execPath, [join(p.raizReal, "node_modules", "vitest", "vitest.mjs"), "run", "--config", "vitest.banco.config.mjs", "--root", banco, "--reporter=json", ...(m.pruebas ?? [])], { cwd: banco, env: entorno, timeout: 150_000 });
      let texto = "";
      hijo.stdout.on("data", (d: Buffer) => (texto += d.toString()));
      hijo.on("close", () => resolver(texto));
      hijo.on("error", () => resolver(texto));
    });
    const json = salida.slice(salida.includes('{"numTotal') ? salida.indexOf('{"numTotal') : salida.indexOf("{"));
    const rojas: string[] = [];
    try {
      const r = JSON.parse(json) as { testResults?: { assertionResults?: { status: string; fullName: string }[] }[] };
      for (const t of r.testResults ?? []) for (const a of t.assertionResults ?? []) if (a.status === "failed") rojas.push(a.fullName);
    } catch {
      return [{ verifica: "pruebas", tipo: "banco-sin-resultado", archivo: m.cambios[0] && m.cambios[0].op === "escribir" ? m.cambios[0].ruta : "", linea: 1, columna: 1, sujeto: "", que: `el banco de pruebas no devolvió un resultado legible: ${salida.slice(0, 300)}`, como: "revisá el banco" }];
    }
    if (rojas.length === 0) return [];
    const cambio = m.cambios[0];
    const archivo = cambio && cambio.op === "escribir" ? cambio.ruta : "";
    return [{ verifica: "pruebas", tipo: "prueba-roja", archivo, linea: m.linea(banco), columna: 1, sujeto: "", que: `${rojas.length} pruebas rojas: ${rojas.join(" | ")}`, como: "la mutación rompe las pruebas del propio guardián: corregí la constante o la lógica, o las pruebas de borde" }];
  } finally {
    rmSync(banco, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Comparar lo esperado con lo observado
// ---------------------------------------------------------------------------------------------------------------------------------

const describir = (o: Observado): string => `${o.verifica}/${o.tipo} ${o.archivo}:${o.linea}:${o.columna}${o.sujeto ? ` [${o.sujeto}]` : ""} «${o.que.slice(0, 160)}»`;
const describirLista = (os: readonly Observado[]): string => (os.length === 0 ? "ningún hallazgo (la verificación pasa)" : os.slice(0, 6).map(describir).join(" ; ") + (os.length > 6 ? ` ; … y ${os.length - 6} más` : ""));

/** ¿Algún hallazgo observado cumple lo que se espera (tipo, archivo, línea real y un fragmento del mensaje)? Si no, por qué. */
function cumple(x: EsperadoDeMutacion, m: Mutacion, obs: readonly Observado[], raizMutada: string): { ok: true } | { ok: false; detalle: string } {
  const lineaEsperada = x.linea === "calculada" ? m.linea(raizMutada) : x.linea === "sin-posicion" ? 1 : x.linea;
  const mismos = obs.filter((o) => o.verifica === x.verifica && o.tipo === x.tipo && o.archivo === x.archivo);
  if (mismos.length === 0) return { ok: false, detalle: `no apareció ${x.verifica}/${x.tipo} en ${x.archivo}` };
  const buenos = mismos.filter((o) => o.linea === lineaEsperada && `${o.que} ${o.como}`.includes(x.mensajeIncluye));
  if (buenos.length === 0) {
    const porLinea = mismos.some((o) => o.linea === lineaEsperada);
    return { ok: false, detalle: porLinea ? `apareció ${x.tipo} en la línea ${lineaEsperada} pero el mensaje no dice «${x.mensajeIncluye}»` : `apareció ${x.tipo} pero no en la línea ${lineaEsperada} (dio ${mismos.map((o) => o.linea).join(", ")})` };
  }
  if (lineaEsperada < 1 || buenos.some((o) => o.linea < 1 || o.como.trim() === "")) return { ok: false, detalle: "el hallazgo no trae una línea real (≥ 1) o una corrección sugerida" };
  return { ok: true };
}

function evaluar(e: MutacionDeMatriz, m: Mutacion, obs: readonly Observado[], raizMutada: string): { veredicto: Veredicto; detalle: string } {
  if (e.estado === "hueco-conocido") {
    return obs.length === 0
      ? { veredicto: "hueco-conocido-confirmado", detalle: `sigue sin detectarse (deuda ${e.hueco})` }
      : { veredicto: "hueco-ya-protegido", detalle: `el hueco «${e.hueco}» ya se detecta (${describirLista(obs)}): pasalo a protegido y sacá su deuda` };
  }
  // Lo esperado (el hallazgo principal) y, además, lo que otros mecanismos tienen que decir de la misma mutación (p. ej. el registro de aprobaciones además del cumplimiento).
  const esperados = [e.esperado, ...e.ademas];
  for (const x of esperados) {
    const r = cumple(x, m, obs, raizMutada);
    if (!r.ok) return { veredicto: "HUECO", detalle: r.detalle };
  }
  const sobran = obs.filter((o) => !esperados.some((x) => o.verifica === x.verifica && o.tipo === x.tipo && o.archivo === x.archivo) && !m.tolerados.some((t) => t.verifica === o.verifica && t.tipo === o.tipo));
  if (sobran.length > 0) return { veredicto: "HUECO", detalle: `además de lo esperado dio otros hallazgos que la mutación no explica: ${describirLista(sobran)}` };
  return { veredicto: "protegido", detalle: "" };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Correr la matriz
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * ¿La mutación puede dar un hallazgo del cumplimiento o del registro de aprobaciones? Sí si es de evasión, si espera uno, si altera en memoria el manifiesto, las exclusiones, la política o el registro, o si
 * cambia un archivo del mecanismo, de la carpeta de contratos o uno de los guardianes adicionales.
 */
function tocaElMecanismo(e: MutacionDeMatriz, m: Mutacion, mecanismo: ReadonlySet<string>): boolean {
  if (e.clase === "evasion" || e.ademas.length > 0 || e.esperado.verifica === "cumplimiento" || e.esperado.verifica === "aprobaciones" || e.esperado.verifica === "evidencia") return true;
  if (m.contratos !== null || m.exclusiones !== null || m.politicaDeTipos !== null || m.registro !== null || m.piso !== null) return true;
  const afecta = (ruta: string): boolean => ruta.startsWith(PREFIJO_DEL_GUARDIAN) || [...mecanismo].some((r) => r === ruta || r.startsWith(`${ruta}/`));
  return m.cambios.some((c) => (c.op === "mover" ? afecta(c.de) || afecta(c.a) : afecta(c.ruta)));
}

const escenarioDe = (base: BaseDeMutacion, m: Mutacion): Escenario => ({
  contratos: m.contratos ?? base.contratos,
  hoy: m.hoy ?? base.hoy,
  areas: m.areas ?? base.areas,
  reglas: m.reglas ?? base.reglas,
  exclusiones: m.exclusiones ?? base.exclusiones,
  politicaDeTipos: m.politicaDeTipos ?? POLITICA_DE_TIPOS,
  registro: m.registro ?? APROBACIONES,
  piso: m.piso ?? PISO_DE_LA_COPIA,
  crons: m.crons ?? base.crons,
  ignoradas: m.ignoradas ?? [],
  archivos: m.listadoVacio ? [] : aplicarAlListado(base.archivos, m.cambios),
});

const textoDe = (x: EsperadoDeMutacion): string => `${x.verifica}/${x.tipo} · ${x.archivo}:${x.linea} · «${x.mensajeIncluye}»`;
const textoEsperado = (e: MutacionDeMatriz): string =>
  e.estado === "hueco-conocido" ? `hueco conocido «${e.hueco}»: hoy no hay hallazgo (lo que debería decir: ${e.esperado.tipo} · «${e.esperado.mensajeIncluye}»)` : [e.esperado, ...e.ademas].map(textoDe).join(" + ");

export async function ejecutarMatriz(o: OpcionesDelArnes): Promise<ResultadoDelArnes> {
  const inicio = Date.now();
  tiempos.motor = tiempos.clasificacion = tiempos.areas = tiempos.cumplimiento = tiempos.aprobaciones = tiempos.evidencia = 0;
  const p = prepararBase(o);
  try {
    const matriz = o.alterar ? o.alterar(construirMatriz(p.base)) : construirMatriz(p.base);
    const invariantes = o.soloContratos ? matriz.invariantes.filter((i) => i.origen === "contrato") : matriz.invariantes;
    const mecanismo = new Set([...rutasDelMecanismo(o.raizReal), ...GUARDIANES_ADICIONALES]);
    const baseLimpia = observar(p.base, escenarioBase(p.base), o.soloContratos, true);
    const filas: FilaDeResultado[] = [];
    let corridas = 0;

    // Fase 1: armar cada mutación (y anotar las que no aplican o están mal armadas).
    interface Armada {
      inv: string;
      e: MutacionDeMatriz;
      m: Mutacion;
      pruebas: Promise<Observado[]> | null;
      /** Una mutación verificada por las pruebas del banco que además espera hallazgos del cumplimiento o del registro: lo que se observa en la copia, con la mutación aplicada. */
      enLaCopia: { obs: Observado[]; aislamiento: string } | null;
    }
    const armadas: Armada[] = [];
    const fila = (inv: string, e: MutacionDeMatriz, mutacion: string, real: string, veredicto: Veredicto, detalle: string): FilaDeResultado => ({
      invariante: inv,
      clase: e.clase,
      elemento: `${e.elemento.ruta} · ${e.elemento.que}`,
      mutacion,
      operador: e.operador,
      estado: e.estado,
      hueco: e.hueco,
      esperado: textoEsperado(e),
      real,
      veredicto,
      detalle,
    });
    for (const inv of invariantes) {
      for (const e of inv.mutaciones) {
        if (o.filtro && !o.filtro(inv.id, e)) continue;
        if (o.soloContratos && e.esperado.verifica !== "motor") {
          filas.push(fila(inv.id, e, "(no corre en el árbol sintético)", "", "no-aplica", "se verifica con la clasificación o las áreas del repo real"));
          continue;
        }
        const operador = OPERADORES[e.operador];
        if (operador === undefined) {
          filas.push(fila(inv.id, e, "", "", "error-del-operador", `no existe el operador «${e.operador}»`));
          continue;
        }
        try {
          const m = operador.aplicar(p.base, e.parametros);
          if (esNoAplica(m)) filas.push(fila(inv.id, e, "(no aplica)", "", "no-aplica", m.noAplica));
          else armadas.push({ inv: inv.id, e, m, pruebas: m.pruebas === null ? null : correrPruebasEnBanco(p, m), enLaCopia: null });
        } catch (error) {
          filas.push(fila(inv.id, e, "", "", "error-del-operador", (error as Error).message));
        }
      }
    }

    // Fase 2: aplicar, verificar y revertir, una por una (las pruebas del banco ya corren en paralelo). Una mutación del banco que además espera hallazgos del cumplimiento o del registro
    // pasa también por acá, para que ellos la vean en la copia.
    for (const a of armadas) {
      corridas++;
      if (a.pruebas !== null && a.e.ademas.length === 0) continue;
      let deshacer: Deshacer | null = null;
      try {
        deshacer = aplicarEnDisco(p.base.raiz, a.m.cambios);
        const conMecanismo = tocaElMecanismo(a.e, a.m, mecanismo);
        const obs = observar(p.base, escenarioDe(p.base, a.m), o.soloContratos, conMecanismo);
        const { veredicto, detalle } = a.pruebas === null ? evaluar(a.e, a.m, obs, p.base.raiz) : { veredicto: "protegido" as Veredicto, detalle: "" };
        deshacer.revertir();
        deshacer = null;
        let final = { veredicto, detalle };
        let aislamiento = "";
        if (a.m.cambios.length > 0) {
          const despues = observar(p.base, escenarioBase(p.base), o.soloContratos, conMecanismo);
          if (despues.length > 0) {
            aislamiento = `después de revertir quedaron hallazgos: ${describirLista(despues)}`;
            final = { veredicto: "aislamiento-roto", detalle: aislamiento };
          }
        }
        if (a.pruebas === null) filas.push(fila(a.inv, a.e, a.m.descripcion, describirLista(obs), final.veredicto, final.detalle));
        else a.enLaCopia = { obs, aislamiento };
      } catch (error) {
        deshacer?.revertir();
        filas.push(fila(a.inv, a.e, a.m.descripcion, "", "error-del-operador", (error as Error).message));
        a.enLaCopia = { obs: [], aislamiento: "error-del-operador" };
      }
    }
    for (const a of armadas) {
      if (a.pruebas === null) continue;
      if (a.enLaCopia?.aislamiento === "error-del-operador") continue;
      const obs = [...(a.enLaCopia?.obs ?? []), ...(await a.pruebas)];
      const { veredicto, detalle } = a.enLaCopia !== null && a.enLaCopia.aislamiento !== "" ? { veredicto: "aislamiento-roto" as Veredicto, detalle: a.enLaCopia.aislamiento } : evaluar(a.e, a.m, obs, p.base.raiz);
      filas.push(fila(a.inv, a.e, a.m.descripcion, describirLista(obs), veredicto, detalle));
    }
    return { matriz, filas, corridas, milisegundos: Date.now() - inicio, tiempos: { ...tiempos }, baseLimpia };
  } finally {
    p.limpiar();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------------------------------------------------------------------

const FALLAN: readonly Veredicto[] = ["HUECO", "hueco-ya-protegido", "error-del-operador", "aislamiento-roto"];
export const falla = (f: FilaDeResultado): boolean => FALLAN.includes(f.veredicto);

/** La tabla (invariante · clase · elemento · mutación · resultado esperado · resultado real) como texto; con `soloFallas` solo las filas que fallan, con el encabezado «HUECO». */
export function tablaComoTexto(filas: readonly FilaDeResultado[], soloFallas = false): string {
  return filas
    .filter((f) => !soloFallas || falla(f))
    .map((f) => {
      const cabeza = f.veredicto === "HUECO" ? `HUECO: ${f.invariante} · ${f.clase} · ${f.elemento}: el guardián no protege esto` : `${f.veredicto.toUpperCase()}: ${f.invariante} · ${f.clase} · ${f.elemento}`;
      return [cabeza, `  mutación: ${f.mutacion} [${f.operador}]`, `  esperado: ${f.esperado}`, `  real:     ${f.real}`, ...(f.detalle ? [`  detalle:  ${f.detalle}`] : [])].join("\n");
    })
    .join("\n");
}

/** La misma tabla como JSON, para el ejecutor de evidencia (G5). */
export const tablaComoJson = (filas: readonly FilaDeResultado[]): string => JSON.stringify(filas, null, 2);

/** ¿Existe en el texto de un archivo de pruebas un test con ese título exacto? (`it("…")`, `test("…")`, con cualquier tipo de comilla.) */
export function existeElTest(textoDelArchivo: string, titulo: string): boolean {
  const re = /\b(?:it|test)(?:\.\w+)?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  return [...textoDelArchivo.matchAll(re)].some((m) => m[2] === titulo);
}

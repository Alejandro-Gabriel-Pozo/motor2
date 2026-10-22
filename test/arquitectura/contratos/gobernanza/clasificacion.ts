import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MOTIVO_MINIMO } from "../politica";
import type { TipoDeHallazgo } from "../tipos";
import { EXCLUSIONES, bajoLaExclusion, revisarGobiernoDeExclusiones, validarExclusiones, type Exclusion } from "./exclusiones";

/**
 * La CLASIFICACIÓN DE RUTAS del repo (paso G2 de la gobernanza de contratos): el «alcance completo» del guardián. Cada archivo del repo (lo versionado más lo nuevo
 * sin versionar: `git ls-files -co --exclude-standard`) tiene que caer en UNA regla que le da un TIPO. Fail-closed: un archivo que ninguna regla reconoce
 * (backend, frontend, migraciones, scripts, workers, código generado, un `.ts` escondido en `docs/` o en `public/`) es un hallazgo, no se ignora. Las únicas salidas
 * son una regla nueva (que se revisa en el diff) o una exclusión escrita, con motivo, responsable, aprobación, vencimiento y cantidad exacta (`exclusiones.ts`).
 *
 * Una regla es un PREFIJO + EXTENSIONES (+ opcionalmente una lista de NOMBRES) permitidos. Si varias reglas aceptan un archivo, gana la más específica (prefijo más
 * largo; a igual prefijo, la que lista nombres): por eso el cron (`src/app/api/cron/`) le gana a `src/app/` sin importar el orden de la lista. Dos reglas de tipos
 * distintos igual de específicas son `clasificacion-ambigua`. Los trabajos programados de `vercel.json` se cruzan además con la clasificación (`cron-mal-clasificado`).
 *
 * Aparte, `git ls-files -oi --exclude-standard` (lo IGNORADO) no puede devolver nada bajo las raíces de código: agregar un patrón a `.gitignore` para esconder código
 * también falla. Sin campos opcionales: `tsc` rechaza una regla a la que le falte algo.
 */

export type TipoDeRuta =
  | "frontend"
  | "trabajo-programado"
  | "nucleo"
  | "servidor"
  | "consola"
  | "esquema"
  | "migraciones"
  | "scripts"
  | "pruebas"
  | "ci"
  | "configuracion"
  | "agentes"
  | "documentacion"
  | "activos"
  | "seguridad-config"
  | "generado";

/** Cerrado. `generado` existe y NO tiene reglas: versionar código generado exige declararlo (una regla `generado` con su motivo). */
export const TIPOS_DE_RUTA: readonly TipoDeRuta[] = [
  "frontend",
  "trabajo-programado",
  "nucleo",
  "servidor",
  "consola",
  "esquema",
  "migraciones",
  "scripts",
  "pruebas",
  "ci",
  "configuracion",
  "agentes",
  "documentacion",
  "activos",
  "seguridad-config",
  "generado",
];

/**
 * Una regla de clasificación.
 *  - `prefijo`: `""` (la raíz del repo) o una carpeta con `/` final.
 *  - `profundidad`: `directa` (solo los archivos que están justo en el prefijo) o `recursiva` (todo lo que cuelga de él).
 *  - `extensiones`: las que acepta (con punto, en minúscula); `[]` = no restringe por extensión.
 *  - `nombres`: los nombres de archivo que acepta (sin carpeta); `[]` = no restringe por nombre.
 *  Tiene que restringir por al menos una de las dos. `motivo` (20 caracteres o más) dice por qué esa ruta es de ese tipo.
 */
export interface ReglaDeRuta {
  tipo: TipoDeRuta;
  prefijo: string;
  profundidad: "directa" | "recursiva";
  extensiones: readonly string[];
  nombres: readonly string[];
  motivo: string;
}

/** Las reglas del repo, de lo específico a lo general (el orden no cambia el resultado: gana la más específica; está así para leerse). */
export const REGLAS_DE_RUTA: readonly ReglaDeRuta[] = [
  // --- Frontend y trabajos programados. Los dos crons de `vercel.json` viven dentro de `src/app/api/` pero son trabajo de servidor: su regla es más específica.
  { tipo: "trabajo-programado", prefijo: "src/app/api/cron/", profundidad: "recursiva", extensiones: [".ts"], nombres: [], motivo: "los crons de vercel.json: rutas de servidor que dispara el planificador, no pantallas" },
  { tipo: "frontend", prefijo: "src/app/", profundidad: "recursiva", extensiones: [".ts", ".tsx", ".css"], nombres: [], motivo: "App Router de Next: páginas, layouts, rutas de API, acciones y estilos" },
  { tipo: "frontend", prefijo: "src/components/", profundidad: "recursiva", extensiones: [".ts", ".tsx"], nombres: [], motivo: "componentes de pantalla compartidos entre secciones" },
  { tipo: "frontend", prefijo: "src/ui/", profundidad: "recursiva", extensiones: [".ts", ".tsx"], nombres: [], motivo: "las primitivas de interfaz (sin negocio)" },
  // --- Núcleo y servidor.
  { tipo: "nucleo", prefijo: "src/core/", profundidad: "recursiva", extensiones: [".ts"], nombres: [], motivo: "dominio puro: reglas de negocio sin base, sin React y sin Next" },
  { tipo: "servidor", prefijo: "src/server/", profundidad: "recursiva", extensiones: [".ts"], nombres: [], motivo: "casos de uso, persistencia, lecturas, sesión y permisos del servidor" },
  { tipo: "servidor", prefijo: "src/lib/", profundidad: "recursiva", extensiones: [".ts"], nombres: [], motivo: "utilidades de infraestructura compartidas (base, errores, correo)" },
  { tipo: "servidor", prefijo: "src/types/", profundidad: "recursiva", extensiones: [".ts"], nombres: [], motivo: "declaraciones de tipos globales de la app" },
  { tipo: "servidor", prefijo: "src/", profundidad: "directa", extensiones: [".ts"], nombres: [], motivo: "los archivos sueltos de src (env, proxy, instrumentación): configuración de ejecución del servidor" },
  // --- Consola de plataforma (otra app Next, con su propio package.json).
  { tipo: "consola", prefijo: "plataforma/src/", profundidad: "recursiva", extensiones: [".ts", ".tsx", ".css"], nombres: [], motivo: "código de la consola de plataforma" },
  { tipo: "consola", prefijo: "plataforma/", profundidad: "directa", extensiones: [".ts", ".json"], nombres: ["next.config.ts", "package.json", "tsconfig.json", "vercel.json"], motivo: "la configuración de la app de la consola, lista cerrada" },
  // --- Base de datos.
  { tipo: "esquema", prefijo: "prisma/", profundidad: "directa", extensiones: [".prisma", ".ts"], nombres: ["schema.prisma", "seed.ts"], motivo: "el esquema de Prisma y la siembra de datos" },
  { tipo: "esquema", prefijo: "", profundidad: "directa", extensiones: [".ts"], nombres: ["prisma.config.ts"], motivo: "la configuración de Prisma, en la raíz" },
  { tipo: "migraciones", prefijo: "prisma/migrations/", profundidad: "recursiva", extensiones: [".sql", ".toml"], nombres: ["migration.sql", "down.sql", "verificacion-previa.sql", "migration_lock.toml"], motivo: "migraciones, su reversa, la verificación previa a las que la piden y el candado del proveedor" },
  // --- Herramientas, pruebas y CI.
  { tipo: "scripts", prefijo: "scripts/", profundidad: "recursiva", extensiones: [".ts", ".mjs", ".sh", ".sql", ".md"], nombres: [], motivo: "scripts de operación, de arquitectura, de la demo y de la consola, con sus runbooks" },
  { tipo: "pruebas", prefijo: "test/", profundidad: "recursiva", extensiones: [".ts", ".tsx", ".json", ".txt", ".md"], nombres: [], motivo: "pruebas, sus utilidades y sus datos congelados (golden)" },
  { tipo: "ci", prefijo: ".github/", profundidad: "recursiva", extensiones: [".yml"], nombres: [], motivo: "workflows de GitHub Actions y Dependabot" },
  // --- Raíz: listas cerradas de archivos.
  {
    tipo: "configuracion",
    prefijo: "",
    profundidad: "directa",
    extensiones: [],
    nombres: [
      ".dependency-cruiser-dominios.cjs",
      ".dependency-cruiser-excepciones.cjs",
      ".dependency-cruiser.cjs",
      ".env.example",
      ".gitattributes",
      ".gitignore",
      ".gitleaks.toml",
      "docker-compose.yml",
      "eslint.config.mjs",
      "knip.jsonc",
      "next.config.ts",
      "package-lock.json",
      "package.json",
      "playwright.config.ts",
      "playwright.demo.config.ts",
      "postcss.config.mjs",
      "stryker.config.mjs",
      "stryker.piloto.config.mjs",
      "tsconfig.json",
      "vercel.json",
      "vitest.config.ts",
      "vitest.demo-invariantes.config.ts",
      "vitest.seed-6-meses.config.ts",
      "vitest.seed-carta-la-cuadra.config.ts",
      "vitest.seed.config.ts",
    ],
    motivo: "la configuración de herramientas del repo, en la raíz: lista cerrada de archivos",
  },
  { tipo: "agentes", prefijo: ".claude/", profundidad: "recursiva", extensiones: [".md"], nombres: [], motivo: "agentes y skills de Claude Code del repo" },
  { tipo: "agentes", prefijo: "", profundidad: "directa", extensiones: [".md"], nombres: ["AGENTS.md", "CLAUDE.md"], motivo: "las instrucciones de agentes de la raíz" },
  // --- Documentación y activos: solo lo que no ejecuta (un .ts acá no se reconoce).
  { tipo: "documentacion", prefijo: "docs/", profundidad: "recursiva", extensiones: [".md"], nombres: [], motivo: "documentos, ADR y checkpoints: solo Markdown" },
  { tipo: "documentacion", prefijo: "", profundidad: "directa", extensiones: [".md"], nombres: ["README.md", "PENDIENTE-PARA-LA-UNION.md"], motivo: "los documentos sueltos de la raíz, lista cerrada" },
  { tipo: "activos", prefijo: "public/", profundidad: "recursiva", extensiones: [".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".ico", ".woff2"], nombres: [], motivo: "imágenes y fuentes que sirve Next tal cual: nada ejecutable" },
  { tipo: "activos", prefijo: "src/fonts/", profundidad: "recursiva", extensiones: [".woff2", ".txt"], nombres: [], motivo: "las fuentes de la app y las licencias OFL que las acompañan" },
  { tipo: "activos", prefijo: "src/app/", profundidad: "directa", extensiones: [".ico"], nombres: ["favicon.ico"], motivo: "el ícono de la app, que Next toma de src/app" },
  { tipo: "seguridad-config", prefijo: ".zap/", profundidad: "recursiva", extensiones: [".tsv"], nombres: [], motivo: "reglas de OWASP ZAP para el escaneo de seguridad" },
];

/** Las raíces del código: lo IGNORADO por git no puede aparecer bajo ninguna (salvo los generados declarados abajo). */
const RAICES_DE_CODIGO: readonly string[] = ["src/", "plataforma/src/", "prisma/migrations/", "scripts/", "test/"];
/** Los únicos archivos generados que pueden estar ignorados bajo una raíz de código: por nombre exacto o por sufijo. */
const GENERADOS_NOMBRES: readonly string[] = ["next-env.d.ts"];
const GENERADOS_SUFIJOS: readonly string[] = [".tsbuildinfo"];

export type TipoDeHallazgoDeRuta =
  | "ruta-sin-clasificar"
  | "clasificacion-ambigua"
  | "exclusion-ampliada"
  | "exclusion-sin-uso"
  | "ignorado-en-raiz-de-codigo"
  | "cron-mal-clasificado"
  | Extract<TipoDeHallazgo, "excepcion-sin-motivo" | "excepcion-sin-responsable" | "excepcion-sin-aprobacion" | "excepcion-vencida" | "horizonte-excedido" | "alcance-vacio">;

export interface HallazgoDeRuta {
  tipo: TipoDeHallazgoDeRuta;
  /** Ruta relativa a la raíz del repo, con `/`. */
  archivo: string;
  /** 1-based (1 cuando no aplica: la clasificación no mira dentro de los archivos). */
  linea: number;
  columna: number;
  /** Qué falta o qué pasa. */
  que: string;
  /** Cómo se corrige. */
  como: string;
}

export interface ResultadoDeClasificacion {
  hallazgos: readonly HallazgoDeRuta[];
  /** Avisos que NO fallan (una exclusión que vence pronto). */
  avisos: readonly string[];
  /** Archivos listados (versionados + nuevos sin versionar). */
  total: number;
  clasificados: number;
  excluidos: number;
  porTipo: Readonly<Record<TipoDeRuta, number>>;
  /** El tipo de cada archivo clasificado (ruta → tipo); lo no clasificado y lo excluido no figura. Lo usa `areas.ts` para derivar las áreas. */
  tipos: ReadonlyMap<string, TipoDeRuta>;
}

export interface EntradaDeClasificacion {
  /** `git ls-files -co --exclude-standard`. */
  archivos: readonly string[];
  /** `git ls-files -oi --exclude-standard` (solo lo que cuelga de las raíces de código hace falta mirar). */
  ignorados: readonly string[];
  /** Las rutas de los crons de `vercel.json` (`/api/cron/x`). */
  crons: readonly string[];
  reglas: readonly ReglaDeRuta[];
  exclusiones: readonly Exclusion[];
  /** `AAAA-MM-DD`: lo inyecta quien llama (los tests, uno fijo; el guardián real, `fechaUtcDeHoy()`). */
  hoy: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------------------------------------------------------------

/** Un conjunto de reglas mal armado no es un hallazgo: es un error del propio archivo y se lanza. */
function validarReglas(reglas: readonly ReglaDeRuta[]): void {
  const problemas: string[] = [];
  if (reglas.length === 0) problemas.push("no hay ninguna regla: todo el repo quedaría sin clasificar");
  for (const r of reglas) {
    const en = `regla ${r.tipo} «${r.prefijo}»`;
    if (!TIPOS_DE_RUTA.includes(r.tipo)) problemas.push(`${en}: tipo desconocido`);
    if (r.prefijo !== "" && (!r.prefijo.endsWith("/") || r.prefijo.startsWith("/") || r.prefijo.includes("//") || /[*?[\]{}]/.test(r.prefijo))) problemas.push(`${en}: el prefijo es la raíz (\`""\`) o una carpeta relativa con \`/\` final y sin comodines`);
    if (r.extensiones.length === 0 && r.nombres.length === 0) problemas.push(`${en}: acepta cualquier archivo; restringí por extensiones o por nombres`);
    for (const e of r.extensiones) if (!/^\.[a-z0-9]+$/.test(e)) problemas.push(`${en}: la extensión «${e}» tiene que empezar con punto y ser minúscula`);
    for (const n of r.nombres) if (n === "" || n.includes("/")) problemas.push(`${en}: el nombre «${n}» tiene que ser un nombre de archivo, sin carpeta`);
    if (r.motivo.trim().length < MOTIVO_MINIMO) problemas.push(`${en}: el motivo necesita ${MOTIVO_MINIMO} caracteres o más`);
  }
  for (const tipo of TIPOS_DE_RUTA) if (tipo !== "generado" && reglas.length > 0 && !reglas.some((r) => r.tipo === tipo)) problemas.push(`el tipo «${tipo}» no tiene ninguna regla`);
  if (problemas.length > 0) throw new Error(`Reglas de clasificación de rutas mal armadas:\n${problemas.map((p) => `  - ${p}`).join("\n")}`);
}

const nombreDe = (ruta: string): string => ruta.slice(ruta.lastIndexOf("/") + 1);

function coincide(r: ReglaDeRuta, ruta: string): boolean {
  if (!ruta.startsWith(r.prefijo)) return false;
  const resto = ruta.slice(r.prefijo.length);
  if (r.profundidad === "directa" && resto.includes("/")) return false;
  const nombre = nombreDe(resto);
  if (r.nombres.length > 0 && !r.nombres.includes(nombre)) return false;
  return r.extensiones.length === 0 || r.extensiones.some((e) => nombre.endsWith(e));
}

/** Más grande = más específica: prefijo más largo; a igual prefijo, la que lista nombres. */
const especificidad = (r: ReglaDeRuta): number => r.prefijo.length * 2 + (r.nombres.length > 0 ? 1 : 0);

const lista = (rs: readonly ReglaDeRuta[]): string => rs.map((r) => `${r.tipo} («${r.prefijo}»)`).join(", ");

/** La pista de una ruta que no encaja: las reglas cuyo prefijo la cubre (o, si ninguna, qué regla pegar). */
function comoClasificar(ruta: string, reglas: readonly ReglaDeRuta[]): string {
  const cercanas = reglas.filter((r) => r.prefijo !== "" && ruta.startsWith(r.prefijo) && (r.profundidad === "recursiva" || !ruta.slice(r.prefijo.length).includes("/"))).sort((a, b) => b.prefijo.length - a.prefijo.length);
  const carpeta = ruta.includes("/") ? ruta.slice(0, ruta.lastIndexOf("/") + 1) : "";
  const ext = nombreDe(ruta).includes(".") ? nombreDe(ruta).slice(nombreDe(ruta).lastIndexOf(".")) : "";
  const pegar = `{ tipo: "<tipo>", prefijo: "${carpeta}", profundidad: "recursiva", extensiones: ["${ext}"], nombres: [], motivo: "<20 caracteres o más>" }`;
  const salida = "o, si es código que no se analiza a propósito, una exclusión en `gobernanza/exclusiones.ts` (motivo, responsable, aprobación, vence, cantidad exacta)";
  if (carpeta === "") return `agregá «${nombreDe(ruta)}» a la lista de \`nombres\` de la regla de la raíz que le corresponda en \`gobernanza/clasificacion.ts\` (configuracion, documentacion, agentes…), ${salida}`;
  if (cercanas.length > 0) {
    const r = cercanas[0];
    const admite = r.extensiones.length > 0 ? `solo admite ${r.extensiones.join(", ")}` : `solo admite los nombres ${r.nombres.join(", ")}`;
    return `la regla ${r.tipo} («${r.prefijo}», ${r.profundidad}) ${admite}: si el archivo es código escondido en esa carpeta, movelo a donde corresponde; si es legítimo, ampliá esa regla en \`gobernanza/clasificacion.ts\`; ${salida}`;
  }
  return `agregá en \`REGLAS_DE_RUTA\` de \`gobernanza/clasificacion.ts\` la regla ${pegar} (tipos: ${TIPOS_DE_RUTA.join(", ")}), ${salida}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La clasificación
// ---------------------------------------------------------------------------------------------------------------------------------

const comparar = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

/** Función pura: recibe las listas (versionados + nuevos, e ignorados), las reglas y las exclusiones, y devuelve los hallazgos ordenados. */
export function clasificarRutas(entrada: EntradaDeClasificacion): ResultadoDeClasificacion {
  validarReglas(entrada.reglas);
  validarExclusiones(entrada.exclusiones);
  const hallazgos: HallazgoDeRuta[] = [];
  const agregar = (tipo: TipoDeHallazgoDeRuta, archivo: string, que: string, como: string): void => {
    hallazgos.push({ tipo, archivo, linea: 1, columna: 1, que, como });
  };

  const archivos = [...new Set(entrada.archivos)].sort();
  const porTipo = Object.fromEntries(TIPOS_DE_RUTA.map((t) => [t, 0])) as Record<TipoDeRuta, number>;
  const tipoDe = new Map<string, TipoDeRuta>();
  const dentro = new Map<Exclusion, string[]>(entrada.exclusiones.map((e) => [e, []]));
  let excluidos = 0;

  if (archivos.length === 0) agregar("alcance-vacio", ".", "no hay ningún archivo para clasificar", "el listado de git vino vacío: un guardián sin archivos pasaría en vacío");

  for (const ruta of archivos) {
    const exclusion = entrada.exclusiones.find((e) => bajoLaExclusion(e, ruta));
    if (exclusion !== undefined) {
      dentro.get(exclusion)?.push(ruta);
      excluidos++;
      continue;
    }
    const candidatas = entrada.reglas.filter((r) => coincide(r, ruta));
    if (candidatas.length === 0) {
      agregar("ruta-sin-clasificar", ruta, "ninguna regla de clasificación reconoce este archivo (ni su carpeta con esa extensión)", comoClasificar(ruta, entrada.reglas));
      continue;
    }
    const mejor = Math.max(...candidatas.map(especificidad));
    const ganadoras = candidatas.filter((r) => especificidad(r) === mejor);
    if (new Set(ganadoras.map((r) => r.tipo)).size > 1) {
      agregar("clasificacion-ambigua", ruta, `${ganadoras.length} reglas de tipos distintos lo aceptan con la misma especificidad: ${lista(ganadoras)}`, "dejá una sola regla para esa ruta (o hacé una más específica): un archivo no puede ser de dos tipos");
      continue;
    }
    porTipo[ganadoras[0].tipo]++;
    tipoDe.set(ruta, ganadoras[0].tipo);
  }

  // --- Exclusiones: cantidad exacta, gobierno y vencimiento.
  for (const [exclusion, bajo] of dentro) {
    const n = bajo.length;
    if (n === 0) {
      agregar("exclusion-sin-uso", exclusion.ruta, "la exclusión no cubre ningún archivo", "sacala de `exclusiones.ts`: una exclusión sin archivos es una puerta abierta");
    } else if (n > exclusion.archivos) {
      const muestra = bajo.slice(0, 8).join(", ");
      agregar("exclusion-ampliada", exclusion.ruta, `la exclusión declara ${exclusion.archivos} archivos y hay ${n} (${muestra}${n > 8 ? ", …" : ""})`, `si el código nuevo es legítimo, clasificalo con una regla y movelo fuera de la exclusión; si no, bajá la cantidad a ${exclusion.archivos}: excluir más pide una aprobación nueva`);
    } else if (n < exclusion.archivos) {
      agregar("exclusion-sin-uso", exclusion.ruta, `la exclusión declara ${exclusion.archivos} archivos y hay ${n}`, `bajá \`archivos\` a ${n}`);
    }
  }
  const gobierno = revisarGobiernoDeExclusiones(entrada.exclusiones, entrada.hoy);
  for (const p of gobierno.problemas) agregar(p.tipo, p.ruta, p.que, p.como);
  const avisos = gobierno.avisos.map((a) => `aviso: [clasificacion] la exclusión de «${a.ruta}» ${a.dias === 0 ? "vence hoy" : `vence en ${a.dias} ${a.dias === 1 ? "día" : "días"} (${a.vence})`}`);

  // --- Los crons de vercel.json tienen que estar clasificados como trabajo programado.
  for (const cron of entrada.crons) {
    const archivo = `src/app${cron}/route.ts`;
    const tipo = tipoDe.get(archivo);
    if (tipo === undefined) {
      agregar("cron-mal-clasificado", archivo, `el cron «${cron}» de vercel.json no tiene un archivo clasificado en «${archivo}» (no existe, está excluido o no lo reconoce ninguna regla)`, "corregí la ruta del cron en `vercel.json` o creá la ruta de API que lo atiende");
    } else if (tipo !== "trabajo-programado") {
      agregar("cron-mal-clasificado", archivo, `el cron «${cron}» de vercel.json está clasificado como ${tipo}, no como trabajo-programado`, "la regla `trabajo-programado` de `src/app/api/cron/` tiene que existir y ganarle a la del frontend");
    }
  }

  // --- Lo ignorado por git no puede esconder código bajo las raíces.
  for (const ruta of new Set(entrada.ignorados)) {
    if (!RAICES_DE_CODIGO.some((r) => ruta.startsWith(r))) continue;
    const nombre = nombreDe(ruta);
    if (GENERADOS_NOMBRES.includes(nombre) || GENERADOS_SUFIJOS.some((s) => nombre.endsWith(s))) continue;
    agregar("ignorado-en-raiz-de-codigo", ruta, "git lo ignora y está bajo una raíz de código (src, plataforma/src, prisma/migrations, scripts, test): el guardián no lo vería", "quitá el patrón de `.gitignore` que lo oculta (`git check-ignore -v <ruta>` dice cuál); si es un generado legítimo, declaralo en `gobernanza/clasificacion.ts`");
  }

  const ordenados = hallazgos.sort((a, b) => comparar(a.archivo, b.archivo) || a.linea - b.linea || a.columna - b.columna || comparar(a.tipo, b.tipo) || comparar(a.que, b.que));
  const clasificados = tipoDe.size;
  return { hallazgos: ordenados, avisos, total: archivos.length, clasificados, excluidos, porTipo, tipos: tipoDe };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// El repo real
// ---------------------------------------------------------------------------------------------------------------------------------

function git(raiz: string, args: readonly string[]): string[] {
  const salida = execFileSync("git", ["-C", raiz, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return salida.split("\0").filter((r) => r !== "");
}

/** Lo versionado y lo nuevo sin versionar que existe en disco, y lo ignorado bajo las raíces de código (`-z`: sin escapes en las rutas). */
export function listarRutasConGit(raiz: string): { archivos: string[]; ignorados: string[] } {
  const archivos = git(raiz, ["ls-files", "-z", "-co", "--exclude-standard"]).filter((r) => existsSync(join(raiz, ...r.split("/"))));
  const ignorados = git(raiz, ["ls-files", "-z", "-oi", "--exclude-standard", "--", ...RAICES_DE_CODIGO]);
  return { archivos: [...new Set(archivos)].sort(), ignorados: [...new Set(ignorados)].sort() };
}

/** Las rutas de los crons de `vercel.json`. Si el archivo no tiene la forma esperada, lanza: un guardián que no lee los crons no los cruza. */
export function leerCronsDeVercel(raiz: string): string[] {
  const json: unknown = JSON.parse(readFileSync(join(raiz, "vercel.json"), "utf8"));
  const crons = typeof json === "object" && json !== null && "crons" in json ? json.crons : [];
  if (!Array.isArray(crons)) throw new Error("vercel.json: `crons` tiene que ser una lista");
  return crons.map((c: unknown) => {
    if (typeof c !== "object" || c === null || !("path" in c) || typeof c.path !== "string" || !c.path.startsWith("/api/")) throw new Error("vercel.json: cada cron necesita un `path` que empiece con /api/");
    return c.path;
  });
}

/** La corrida real: el repo en `raiz` con las reglas y las exclusiones del repo. */
export function revisarClasificacionDelRepo(raiz: string, hoy: string): ResultadoDeClasificacion {
  const { archivos, ignorados } = listarRutasConGit(raiz);
  return clasificarRutas({ archivos, ignorados, crons: leerCronsDeVercel(raiz), reglas: REGLAS_DE_RUTA, exclusiones: EXCLUSIONES, hoy });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------------------------------------------------------------------

/** Un hallazgo en el formato del motor: `archivo:línea:columna  [clasificacion · tipo]` y, abajo, qué falta → cómo se corrige. */
export const formatearHallazgoDeRuta = (h: HallazgoDeRuta): string => `${h.archivo}:${h.linea}:${h.columna}  [clasificacion · ${h.tipo}]\n  ${h.que} → ${h.como}`;

/** El resumen: cuántos archivos, cuántos sin clasificar y cuántos por tipo (solo los tipos con archivos, más `generado` aunque sea 0). */
export function resumirClasificacion(r: ResultadoDeClasificacion): string {
  const sin = r.hallazgos.filter((h) => h.tipo === "ruta-sin-clasificar").length;
  const tipos = TIPOS_DE_RUTA.filter((t) => r.porTipo[t] > 0 || t === "generado").map((t) => `${t} ${r.porTipo[t]}`);
  return `${r.total} archivos · ${r.clasificados} clasificados · ${r.excluidos} excluidos · ${sin} sin clasificar · por tipo: ${tipos.join(", ")}`;
}

/** El reporte completo; con muchos hallazgos (una carpeta renombrada da cientos) muestra los primeros `limite` y cuenta el resto. */
export function formatearReporteDeClasificacion(r: ResultadoDeClasificacion, limite: number): string {
  const vistos = r.hallazgos.slice(0, limite).map(formatearHallazgoDeRuta);
  const resto = r.hallazgos.length - vistos.length;
  return [...vistos, ...(resto > 0 ? [`… y ${resto} hallazgos más`] : []), ...r.avisos, resumirClasificacion(r)].join("\n");
}

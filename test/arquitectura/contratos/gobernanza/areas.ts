import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { MANIFIESTO } from "../manifiesto";
import { fechaUtcDeHoy } from "../politica";
import { revisarClasificacionDelRepo, type TipoDeRuta } from "./clasificacion";
import { usosDeContratos, type UsosDeContrato } from "./usos";

/**
 * Las ÁREAS del repo y los contratos que cada una declara (paso G3 de la gobernanza de contratos). La unidad es el ÁREA (una carpeta de primer o segundo nivel), no el
 * archivo ni la constante: cada área dice de qué contratos del manifiesto depende, o `[]` si no depende de ninguno. El campo es obligatorio para toda área que declara:
 * no alcanza con «no poner nada», y agregar una etiqueta tampoco silencia nada, porque el guardián compara la declaración con los usos reales en las dos direcciones.
 *
 *  - `area-sin-declaracion`: un área aparece sola (código nuevo en una carpeta que no figura en `AREAS`). El hallazgo trae la línea exacta para pegar acá.
 *  - `area-fantasma`: una entrada de `AREAS` sin ningún archivo clasificado detrás (la carpeta se renombró o se borró).
 *  - `dependencia-omitida`: el área usa un contrato (algún archivo lo declara según el motor o tiene señales crudas) y no lo declara.
 *  - `dependencia-falsa`: el área declara un contrato que nada del área usa (o que no existe en el manifiesto). BLOQUEA: decisión del dueño, falla cerrado.
 *  - `area-sin-clasificar`: un archivo de un tipo que declara no cae en ninguna área (seguro: no debe pasar si la clasificación de rutas está bien).
 * El área que contiene la FUENTE de un contrato queda eximida de declararlo (se deriva del manifiesto). El uso real sin declaración por ARCHIVO sigue siendo
 * `uso-sin-declarar` del motor aunque el área lo declare: este guardián no lo reemplaza, lo complementa.
 *
 * Qué tipos de ruta declaran y cuáles no: `POLITICA_DE_TIPOS` (un `Record` exhaustivo: un tipo nuevo en la clasificación no compila hasta que se decide). Las prohibiciones
 * («no tocar la base») no se declaran: se aplican por tipo; omitir la declaración nunca exime a un módulo.
 */

/**
 * Los ids de contrato que un área puede declarar. `tsc` rechaza cualquier otro. El manifiesto tipa `id` como `string`, así que esta lista se mantiene a mano y el
 * guardián la cruza con él: un id de acá que el manifiesto no tiene es `dependencia-falsa`; un contrato del manifiesto que falte acá no se puede declarar y, si un
 * área lo usa, es `dependencia-omitida` con la pista de agregarlo.
 */
export const IDS_DE_CONTRATO = ["borde-propio-de-carta", "separador-de-lista-de-carta", "tokens-visuales", "primitiva-boton", "primitiva-campo", "primitiva-selector", "primitiva-area-de-texto", "primitiva-casilla", "primitiva-aviso", "primitiva-insignia", "primitiva-enlace"] as const;
export type IdDeContrato = (typeof IDS_DE_CONTRATO)[number];

/** Área → contratos que declara. `[]` es «no dependo de ninguno» (explícito y obligatorio). Los nombres se derivan de la ruta (`areaDe`). */
export type DeclaracionDeAreas = Readonly<Record<string, readonly IdDeContrato[]>>;

const CARTA: readonly IdDeContrato[] = ["borde-propio-de-carta", "separador-de-lista-de-carta"];

export const AREAS: DeclaracionDeAreas = {
  // --- frontend: src/app (las secciones de `(app)`, los grupos de rutas, la API, las pantallas sueltas y la raíz), src/components y src/ui.
  "app": [],
  "app/(app)": [],
  "app/(app)/administracion": ["primitiva-aviso", "primitiva-boton", "primitiva-campo", "primitiva-enlace", "primitiva-selector", "tokens-visuales"],
  "app/(app)/carta": ["primitiva-area-de-texto", "primitiva-aviso", "primitiva-boton", "primitiva-campo", "primitiva-casilla", "primitiva-selector", "tokens-visuales"],
  "app/(app)/catalogo": ["primitiva-aviso", "primitiva-boton", "primitiva-campo", "primitiva-casilla", "primitiva-enlace", "primitiva-selector", "tokens-visuales"],
  "app/(app)/inicio": ["tokens-visuales"],
  "app/(app)/movimientos": ["primitiva-aviso", "primitiva-boton", "primitiva-campo", "primitiva-casilla", "primitiva-selector", "tokens-visuales"],
  "app/(app)/reportes": ["primitiva-aviso", "primitiva-boton", "primitiva-campo", "primitiva-enlace", "primitiva-selector", "tokens-visuales"],
  "app/(app)/stock": ["primitiva-aviso", "primitiva-boton", "primitiva-campo", "primitiva-enlace", "primitiva-selector", "tokens-visuales"],
  "app/(app)/traspasos": ["primitiva-aviso", "primitiva-boton", "primitiva-campo", "primitiva-enlace", "primitiva-selector", "tokens-visuales"],
  "app/(carta-publica)": [],
  "app/(pos)": ["primitiva-aviso", "primitiva-boton", "tokens-visuales"],
  "app/api": [],
  "app/invitacion": ["primitiva-aviso", "primitiva-boton", "primitiva-campo", "primitiva-casilla", "tokens-visuales"],
  "app/login": ["primitiva-aviso", "tokens-visuales"],
  "components": ["primitiva-aviso", "primitiva-boton", "primitiva-campo", "primitiva-enlace", "primitiva-selector", "tokens-visuales"],
  "components/carta": ["primitiva-area-de-texto", "primitiva-aviso", "primitiva-boton", "primitiva-campo", "primitiva-casilla", "primitiva-selector", "tokens-visuales"],
  "components/carta-publica": CARTA,
  "components/catalogo": ["primitiva-aviso", "primitiva-boton", "primitiva-campo", "primitiva-enlace", "primitiva-insignia", "primitiva-selector", "tokens-visuales"],
  "components/mesas": ["tokens-visuales"],
  "components/receta": [],
  "ui": ["tokens-visuales"],
  // --- trabajo-programado: los crons de vercel.json.
  "app/api/cron": [],
  // --- nucleo: una por carpeta de src/core (las 21 de `.dependency-cruiser-dominios.cjs`) y los archivos sueltos de la raíz.
  "core": [],
  "core/auth": [],
  "core/carta": [],
  "core/catalogo": [],
  "core/compras": [],
  "core/correo": [],
  "core/datos": [],
  "core/estadistica": [],
  "core/features": [],
  "core/fiscal": [],
  "core/modulos": [],
  "core/movimientos": [],
  "core/navegacion": [],
  "core/opciones": [],
  "core/permisos": [],
  "core/plataforma": [],
  "core/pos": [],
  "core/precios": [],
  "core/reportes": [],
  "core/seguridad": [],
  "core/stock": [],
  "core/tiempo": [],
  // --- servidor: las capas de src/server, más src/lib, src/types y los archivos sueltos de src.
  "server/acceso": [],
  "server/actions": [],
  "server/adaptadores": [],
  "server/auditoria": [],
  "server/carta-publica": [],
  "server/consultas": [],
  "server/lecturas": [],
  "server/operaciones-de-plataforma": [],
  "server/persistencia": [],
  "server/sesion": [],
  "lib": [],
  "types": [],
  "src": [],
  // --- consola de plataforma.
  "plataforma": [],
  "plataforma/app": [],
  "plataforma/servidor": [],
  // --- scripts, por subcarpeta (y los sueltos).
  "scripts": [],
  "scripts/arquitectura": [],
  "scripts/demo-seed": [],
  "scripts/operaciones": [],
  "scripts/plataforma": [],
};

/** Dónde vive este archivo: lo usan los hallazgos para decir dónde pegar o borrar una línea. */
export const ARCHIVO_DE_AREAS = "test/arquitectura/contratos/gobernanza/areas.ts";

// ---------------------------------------------------------------------------------------------------------------------------------
// Qué tipos de ruta declaran contratos
// ---------------------------------------------------------------------------------------------------------------------------------

export type PoliticaDeTipo = { declara: true } | { declara: false; motivo: string };

/** Cerrado y exhaustivo: cada tipo de ruta de la clasificación declara sus contratos o dice POR QUÉ no. Un tipo nuevo no compila hasta que se decide. */
export const POLITICA_DE_TIPOS: Readonly<Record<TipoDeRuta, PoliticaDeTipo>> = {
  "frontend": { declara: true },
  "trabajo-programado": { declara: true },
  "nucleo": { declara: true },
  "servidor": { declara: true },
  "consola": { declara: true },
  "scripts": { declara: true },
  "pruebas": { declara: false, motivo: "las pruebas verifican contratos, no dependen de ellos: usan lo que prueban, y si un contrato regula un archivo de prueba el motor lo exige por archivo" },
  "documentacion": { declara: false, motivo: "Markdown: no ejecuta nada ni usa ninguna fuente de contrato" },
  "configuracion": { declara: false, motivo: "configuración de herramientas del repo en la raíz: sin lógica de negocio ni de presentación que dependa de un contrato" },
  "activos": { declara: false, motivo: "imágenes, fuentes y licencias que Next sirve tal cual: nada ejecutable" },
  "ci": { declara: false, motivo: "workflows de CI: orquestan comandos, no usan fuentes de contrato; su integridad la vigilan sus propios guardianes" },
  "agentes": { declara: false, motivo: "instrucciones para agentes (Markdown): no ejecutan nada" },
  "esquema": { declara: false, motivo: "esquema de Prisma, siembra y su configuración: datos y definiciones, sin contratos de presentación; un uso real lo exige igual la declaración por archivo del motor" },
  "migraciones": { declara: false, motivo: "SQL de migraciones: historial inmutable de la base, sin contratos de código" },
  "seguridad-config": { declara: false, motivo: "reglas de escaneo de OWASP ZAP: datos de configuración, no código" },
  "generado": { declara: false, motivo: "el tipo existe y no tiene reglas: versionar código generado exige declararlo en la clasificación" },
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Derivar el área de una ruta
// ---------------------------------------------------------------------------------------------------------------------------------

/** El área de una ruta clasificada, o `null` si cae en ninguna (`area-sin-clasificar`). Solo se pregunta por rutas de tipos que declaran. */
export function areaDe(ruta: string, tipo: TipoDeRuta): string | null {
  const bajo = (prefijo: string): string[] | null => (ruta.startsWith(prefijo) ? ruta.slice(prefijo.length).split("/") : null);
  let s: string[] | null;
  switch (tipo) {
    case "frontend":
      if ((s = bajo("src/app/")) !== null) {
        if (s.length === 1) return "app";
        // `(app)` se parte por sección; el resto de los grupos y carpetas (`(pos)`, `(carta-publica)`, `api`, `login`…), por su primer nivel.
        if (s[0] === "(app)") return s.length === 2 ? "app/(app)" : `app/(app)/${s[1]}`;
        return `app/${s[0]}`;
      }
      if ((s = bajo("src/components/")) !== null) return s.length === 1 ? "components" : `components/${s[0]}`;
      if (bajo("src/ui/") !== null) return "ui";
      return null;
    case "trabajo-programado":
      return bajo("src/app/api/cron/") !== null ? "app/api/cron" : null;
    case "nucleo":
      return (s = bajo("src/core/")) === null ? null : s.length === 1 ? "core" : `core/${s[0]}`;
    case "servidor":
      if ((s = bajo("src/server/")) !== null) return s.length === 1 ? "server" : `server/${s[0]}`;
      if (bajo("src/lib/") !== null) return "lib";
      if (bajo("src/types/") !== null) return "types";
      return (s = bajo("src/")) !== null && s.length === 1 ? "src" : null;
    case "consola":
      if ((s = bajo("plataforma/src/")) !== null) return s.length === 1 ? "plataforma" : `plataforma/${s[0]}`;
      return (s = bajo("plataforma/")) !== null && s.length === 1 ? "plataforma" : null;
    case "scripts":
      return (s = bajo("scripts/")) === null ? null : s.length === 1 ? "scripts" : `scripts/${s[0]}`;
    default:
      return null;
  }
}

/** Las carpetas de `src/core/` según `.dependency-cruiser-dominios.cjs` (la fuente única de los dominios): de ahí salen las 21 áreas del núcleo. */
export function carpetasDeNucleo(raiz: string): string[] {
  const { DOMINIOS_DE_NEGOCIO, INFRA_TRANSVERSAL } = createRequire(__filename)(join(raiz, ".dependency-cruiser-dominios.cjs")) as { DOMINIOS_DE_NEGOCIO: string[]; INFRA_TRANSVERSAL: Record<string, string> };
  return [...DOMINIOS_DE_NEGOCIO, ...Object.keys(INFRA_TRANSVERSAL)].sort();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La comparación
// ---------------------------------------------------------------------------------------------------------------------------------

export type TipoDeHallazgoDeArea = "area-sin-declaracion" | "area-fantasma" | "dependencia-omitida" | "dependencia-falsa" | "area-sin-clasificar";

export interface HallazgoDeArea {
  tipo: TipoDeHallazgoDeArea;
  /** Ruta relativa a la raíz del repo, con `/`. */
  archivo: string;
  /** 1-based. */
  linea: number;
  columna: number;
  area: string;
  /** Qué falta o qué pasa. */
  que: string;
  /** Cómo se corrige. */
  como: string;
}

export interface AreaDerivada {
  nombre: string;
  tipo: TipoDeRuta;
  archivos: readonly string[];
}

export interface ResultadoDeAreas {
  hallazgos: readonly HallazgoDeArea[];
  /** Las áreas reales, derivadas de las rutas clasificadas (no de `AREAS`). */
  areas: readonly AreaDerivada[];
  /** Archivos de tipos que no declaran (se clasifican y se cuentan, pero no tienen área). */
  sinDeclarar: Readonly<Partial<Record<TipoDeRuta, number>>>;
  /** Cuántas de las áreas reales declaran `[]` y cuántas declaran al menos un contrato. */
  conLista: number;
  conVacio: number;
}

export interface EntradaDeAreas {
  /** ruta → tipo, de la clasificación de rutas. */
  tipos: ReadonlyMap<string, TipoDeRuta>;
  declaraciones: Readonly<Record<string, readonly string[]>>;
  usos: readonly UsosDeContrato[];
  /** Dónde está la entrada de un área en el archivo de declaraciones (línea y columna, 1-based); 1:1 si no se sabe. */
  posicionDeEntrada: (area: string) => { linea: number; columna: number };
}

/** El primer archivo (por ruta) de un área que usa un contrato, con su posición, y cuántos archivos del área lo usan. */
interface PrimerUso {
  ruta: string;
  linea: number;
  columna: number;
  n: number;
}

const comparar = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);
/** El valor de `clave` en el mapa; si no está, lo crea. */
function obtener<K, V>(mapa: Map<K, V>, clave: K, crear: () => V): V {
  let v = mapa.get(clave);
  if (v === undefined) {
    v = crear();
    mapa.set(clave, v);
  }
  return v;
}
const linea = (area: string, ids: readonly string[]): string => `  ${JSON.stringify(area)}: [${ids.map((i) => JSON.stringify(i)).join(", ")}],`;

/** Función pura: deriva las áreas de las rutas clasificadas, las compara con la declaración y con los usos reales, y devuelve los hallazgos ordenados. */
export function compararAreas(entrada: EntradaDeAreas): ResultadoDeAreas {
  const hallazgos: HallazgoDeArea[] = [];
  const agregar = (tipo: TipoDeHallazgoDeArea, archivo: string, area: string, que: string, como: string, pos = { linea: 1, columna: 1 }): void => {
    hallazgos.push({ tipo, archivo, area, que, como, ...pos });
  };

  // --- Las áreas reales.
  const archivosPorArea = new Map<string, { tipo: TipoDeRuta; archivos: string[] }>();
  const sinDeclarar: Partial<Record<TipoDeRuta, number>> = {};
  for (const [ruta, tipo] of [...entrada.tipos].sort((a, b) => comparar(a[0], b[0]))) {
    if (!POLITICA_DE_TIPOS[tipo].declara) {
      sinDeclarar[tipo] = (sinDeclarar[tipo] ?? 0) + 1;
      continue;
    }
    const area = areaDe(ruta, tipo);
    if (area === null) {
      agregar("area-sin-clasificar", ruta, "", `el archivo es de tipo ${tipo} y no cae en ninguna área`, "agregá la regla de área en `areaDe` de `gobernanza/areas.ts`: toda ruta de un tipo que declara tiene que pertenecer a un área");
      continue;
    }
    const existente = archivosPorArea.get(area);
    if (existente === undefined) archivosPorArea.set(area, { tipo, archivos: [ruta] });
    else existente.archivos.push(ruta);
  }
  const areas: AreaDerivada[] = [...archivosPorArea].map(([nombre, v]) => ({ nombre, tipo: v.tipo, archivos: v.archivos })).sort((a, b) => comparar(a.nombre, b.nombre));

  // --- Qué contratos usa cada área (por archivo) y qué áreas contienen una fuente.
  const areaDeArchivo = new Map<string, string>();
  for (const a of areas) for (const f of a.archivos) areaDeArchivo.set(f, a.nombre);
  const conocidos = new Set(entrada.usos.map((u) => u.id));
  const usoPorArea = new Map<string, Map<string, PrimerUso>>();
  const eximidas = new Map<string, Set<string>>();
  for (const u of entrada.usos) {
    const areaDeFuente = areaDeArchivo.get(u.fuente);
    if (areaDeFuente !== undefined) obtener(eximidas, areaDeFuente, () => new Set<string>()).add(u.id);
    for (const f of u.archivos) {
      const area = areaDeArchivo.get(f.ruta);
      if (area === undefined) continue;
      const delArea = obtener(usoPorArea, area, () => new Map<string, PrimerUso>());
      const previo = delArea.get(u.id);
      if (previo === undefined) delArea.set(u.id, { ruta: f.ruta, linea: f.linea, columna: f.columna, n: 1 });
      else previo.n++;
    }
  }

  // --- Áreas sin declaración (con la línea exacta para pegar) y declaraciones comparadas con los usos.
  let conLista = 0;
  let conVacio = 0;
  for (const a of areas) {
    const usos = usoPorArea.get(a.nombre) ?? new Map<string, PrimerUso>();
    const exentos = eximidas.get(a.nombre) ?? new Set<string>();
    const declaradas = entrada.declaraciones[a.nombre];
    if (declaradas === undefined) {
      const usados = [...usos.keys()].filter((id) => !exentos.has(id)).sort();
      const cuantos = `${a.archivos.length} archivo${a.archivos.length === 1 ? "" : "s"}`;
      agregar(
        "area-sin-declaracion",
        a.archivos[0],
        a.nombre,
        `el área «${a.nombre}» (${a.tipo}, ${cuantos}) no declara sus contratos${usados.length > 0 ? `; usa ${usados.map((i) => `«${i}»`).join(", ")}` : ""}`,
        `pegá en \`AREAS\` de «${ARCHIVO_DE_AREAS}» la línea: ${linea(a.nombre, usados).trim()}  (\`[]\` = no depende de ningún contrato)`
      );
      continue;
    }
    if (declaradas.length > 0) conLista++;
    else conVacio++;
    const posicion = entrada.posicionDeEntrada(a.nombre);
    const vistas = new Set<string>();
    for (const id of declaradas) {
      if (vistas.has(id)) {
        agregar("dependencia-falsa", ARCHIVO_DE_AREAS, a.nombre, `el área «${a.nombre}» declara «${id}» más de una vez`, `dejá «${id}» una sola vez en su línea de \`AREAS\``, posicion);
        continue;
      }
      vistas.add(id);
      if (!conocidos.has(id)) {
        agregar("dependencia-falsa", ARCHIVO_DE_AREAS, a.nombre, `el área «${a.nombre}» declara «${id}» y ese contrato no existe en el manifiesto`, `borrá «${id}» de la línea de «${a.nombre}» en \`AREAS\` (o declaralo en \`manifiesto.ts\`)`, posicion);
      } else if (!usos.has(id)) {
        agregar("dependencia-falsa", ARCHIVO_DE_AREAS, a.nombre, `el área «${a.nombre}» declara «${id}» y ningún archivo del área lo usa (ni lo declara ni tiene lo que el contrato regula)`, `borrá «${id}» de la línea de «${a.nombre}» en \`AREAS\`: una etiqueta sin uso real no declara nada`, posicion);
      }
    }
    for (const [id, uso] of [...usos].sort((x, y) => comparar(x[0], y[0]))) {
      if (declaradas.includes(id) || exentos.has(id)) continue;
      const pista = (IDS_DE_CONTRATO as readonly string[]).includes(id) ? "" : `; antes agregá «${id}» a \`IDS_DE_CONTRATO\``;
      agregar(
        "dependencia-omitida",
        uso.ruta,
        a.nombre,
        `el área «${a.nombre}» usa el contrato «${id}» (${uso.n} archivo${uso.n === 1 ? "" : "s"}; el primero, este) y no lo declara`,
        `agregá «${id}» a la línea de «${a.nombre}» en \`AREAS\` de «${ARCHIVO_DE_AREAS}»${pista}`,
        { linea: uso.linea, columna: uso.columna }
      );
    }
  }

  // --- Entradas de AREAS sin área real.
  for (const nombre of Object.keys(entrada.declaraciones)) {
    if (archivosPorArea.has(nombre)) continue;
    agregar("area-fantasma", ARCHIVO_DE_AREAS, nombre, `«${nombre}» figura en \`AREAS\` y no hay ningún archivo en esa área`, `borrá la línea de «${nombre}» de \`AREAS\` (si la carpeta se renombró, la nueva aparece sola como \`area-sin-declaracion\` con su línea)`, entrada.posicionDeEntrada(nombre));
  }

  hallazgos.sort((a, b) => comparar(a.archivo, b.archivo) || a.linea - b.linea || a.columna - b.columna || comparar(a.tipo, b.tipo) || comparar(a.area, b.area));
  return { hallazgos, areas, sinDeclarar, conLista, conVacio };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// El repo real y el reporte
// ---------------------------------------------------------------------------------------------------------------------------------

/** Dónde está la línea de un área en el texto de `areas.ts` (1-based); 1:1 si no se encuentra. */
export function posicionEnTexto(texto: string, area: string): { linea: number; columna: number } {
  const clave = `${JSON.stringify(area)}:`;
  const lineas = texto.split("\n");
  const i = lineas.findIndex((l) => l.trimStart().startsWith(clave));
  return i < 0 ? { linea: 1, columna: 1 } : { linea: i + 1, columna: lineas[i].indexOf(clave) + 1 };
}

/** La corrida real: clasificación de rutas del repo en `raiz`, usos reales del manifiesto y la declaración `AREAS`. */
export function revisarAreasDelRepo(raiz: string, hoy: string = fechaUtcDeHoy(), declaraciones: Readonly<Record<string, readonly string[]>> = AREAS): ResultadoDeAreas {
  const texto = readFileSync(join(raiz, ...ARCHIVO_DE_AREAS.split("/")), "utf8");
  return compararAreas({
    tipos: revisarClasificacionDelRepo(raiz, hoy).tipos,
    declaraciones,
    usos: usosDeContratos(raiz, MANIFIESTO),
    posicionDeEntrada: (area) => posicionEnTexto(texto, area),
  });
}

/** Un hallazgo en el formato del motor: `archivo:línea:columna  [areas · tipo]` y, abajo, qué falta → cómo se corrige. */
export const formatearHallazgoDeArea = (h: HallazgoDeArea): string => `${h.archivo}:${h.linea}:${h.columna}  [areas · ${h.tipo}]\n  ${h.que} → ${h.como}`;

/** El resumen: cuántas áreas, por tipo, cuántas declaran `[]` y cuántas contratos, y los archivos de tipos que no declaran. */
export function resumirAreas(r: ResultadoDeAreas): string {
  const porTipo = new Map<TipoDeRuta, number>();
  for (const a of r.areas) porTipo.set(a.tipo, (porTipo.get(a.tipo) ?? 0) + 1);
  const tipos = [...porTipo].sort((a, b) => comparar(a[0], b[0])).map(([t, n]) => `${t} ${n}`);
  const sin = Object.entries(r.sinDeclarar).sort((a, b) => comparar(a[0], b[0])).map(([t, n]) => `${t} ${n}`);
  return `${r.areas.length} áreas (${tipos.join(", ")}) · ${r.conVacio} declaran [] · ${r.conLista} declaran contratos · archivos de tipos que no declaran: ${sin.join(", ")}`;
}

export const formatearReporteDeAreas = (r: ResultadoDeAreas): string => [...r.hallazgos.map(formatearHallazgoDeArea), resumirAreas(r)].join("\n");

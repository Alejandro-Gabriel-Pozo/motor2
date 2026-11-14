/**
 * El ORÁCULO de los metadatos públicos de la carta (`docs/diseno-nombre-publico-de-la-empresa-en-la-carta-2026-11-14.md`, nivel 10): la tabla de lo esperado, escrita APARTE del código y con textos literales
 * (no se arma con las funciones que prueba). La recorren el test de las funciones puras, el de las páginas con la base real y el e2e. Ejemplos con «Empresa B», «Sucursal 1», «Centro» y «Costa».
 */

/** Cómo puede estar el dato `portal_nombre_publico` de una empresa. */
export type EstadoDelNombre = "valido" | "sin-cargar" | "invalido-al-leer";

export const NOMBRE_VALIDO = "Empresa B";
/** Lo que se puede guardar «a mano» en la base y no pasa la validación: al leer cuenta como «sin cargar». */
export const VALORES_INVALIDOS_AL_LEER: readonly unknown[] = ["Empresa <B>", "Empresa​B", "Empresa\nB", "a".repeat(61), 7, ["Empresa B"], "   "];
/** Lo que equivale a «sin cargar». */
export const VALORES_SIN_CARGAR: readonly unknown[] = [undefined, null, ""];

/** Los datos de prueba de cada pantalla (los mismos para todas las filas). */
export const SUCURSAL_DE_LA_CARTA = "Sucursal 1";
export const SECCIONES_DE_LA_CARTA = ["Entradas", "Platos"];
export const SUCURSALES_DEL_PORTAL = ["Centro", "Costa"];

export interface FilaDelOraculo {
  estado: EstadoDelNombre;
  pantalla: "carta" | "portal";
  titulo: string;
  descripcion: string;
  /** `og:site_name`; `null` = AUSENTE. */
  nombreDelSitio: string | null;
}

export const ORACULO: readonly FilaDelOraculo[] = [
  { estado: "valido", pantalla: "carta", titulo: "Sucursal 1 · Carta · Empresa B", descripcion: "Carta de Sucursal 1 — Empresa B. Entradas, Platos.", nombreDelSitio: "Empresa B" },
  { estado: "valido", pantalla: "portal", titulo: "Empresa B · Cartas", descripcion: "Cartas de Empresa B: Centro, Costa.", nombreDelSitio: "Empresa B" },
  { estado: "sin-cargar", pantalla: "carta", titulo: "Sucursal 1 · Carta", descripcion: "Carta de Sucursal 1. Entradas, Platos.", nombreDelSitio: null },
  { estado: "sin-cargar", pantalla: "portal", titulo: "Cartas", descripcion: "Cartas: Centro, Costa.", nombreDelSitio: null },
  { estado: "invalido-al-leer", pantalla: "carta", titulo: "Sucursal 1 · Carta", descripcion: "Carta de Sucursal 1. Entradas, Platos.", nombreDelSitio: null },
  { estado: "invalido-al-leer", pantalla: "portal", titulo: "Cartas", descripcion: "Cartas: Centro, Costa.", nombreDelSitio: null },
];

/** Las páginas públicas de la carta que arman metadatos (una dimensión: si aparece otra, el guardián falla hasta declararla acá). */
export const PAGINAS_PUBLICAS_DECLARADAS: readonly string[] = [
  "src/app/(carta-publica)/carta-publica/[empresa]/page.tsx",
  "src/app/(carta-publica)/carta-publica/[empresa]/[sucursal]/page.tsx",
];

/** Las superficies de Open Graph que la carta emite (otra superficie nueva falla el guardián hasta declararla acá). */
export const CLAVES_DE_OPEN_GRAPH_DECLARADAS: readonly string[] = ["type", "locale", "siteName", "title", "description", "url", "images"];

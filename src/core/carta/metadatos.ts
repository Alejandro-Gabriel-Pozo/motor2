import { MARCA_PUBLICA } from "./marca";

/**
 * Metadatos de la parte PÚBLICA de la carta (título, descripción, datos para compartir en redes y buscadores). PURO: arma textos a partir de datos, no lee `process.env`
 * ni nada de Next (el borde que los convierte en `Metadata` está en `components/carta-publica/metadatos.ts`).
 *
 * La marca es fija (`MARCA_PUBLICA`, `marca.ts`); el nombre de la sucursal, la descripción que cargó el comercio en el tema y las secciones salen de los datos. El público de la carta no ve
 * el nombre de la aplicación que la sirve.
 *
 * Largos: ~60 caracteres de título y ~160 de descripción, que es lo que los buscadores y las vistas previas muestran sin cortar.
 */

export const LARGO_MAXIMO_TITULO_PUBLICO = 60;
export const LARGO_MAXIMO_DESCRIPCION_PUBLICA = 160;

/** Lo que las páginas públicas entregan al borde para armar las etiquetas `<meta>`. */
export interface MetadatosPublicos {
  titulo: string;
  descripcion: string;
  /** Dirección pública definitiva de la página (la canónica); `null` si la instalación no tiene dominio de cartas configurado. */
  url: string | null;
  /** Origen (esquema + host) de la dirección pública, para la base de las URL relativas; `null` igual que `url`. */
  origen: string | null;
  /** El nombre del sitio en las vistas previas: la marca. */
  nombreSitio: string;
  /** Imagen para la vista previa, SOLO si el comercio cargó una; `null` si no hay (no se inventa ninguna). */
  imagen: string | null;
}

const normalizarEspacios = (texto: string) => texto.replace(/\s+/g, " ").trim();
const contiene = (texto: string, parte: string) => texto.toLocaleLowerCase("es").includes(parte.toLocaleLowerCase("es"));

/** Recorta a `maximo` caracteres (con «…» al final), preferentemente en un límite de palabra. Un texto que entra se devuelve limpio de espacios sobrantes. */
export function recortarTexto(texto: string, maximo: number): string {
  const limpio = normalizarEspacios(texto);
  if (limpio.length <= maximo) return limpio;
  const corte = limpio.slice(0, maximo - 1);
  const ultimoEspacio = corte.lastIndexOf(" ");
  const base = ultimoEspacio >= maximo * 0.6 ? corte.slice(0, ultimoEspacio) : corte;
  return `${base.replace(/[\s,;:.\-—·]+$/u, "")}…`;
}

/**
 * Título de la carta de una sucursal: `<nombre> · Carta` y, si la marca no está ya en el nombre, `· <marca>`. Si con la marca no entra en el largo, se queda con lo anterior
 * (el nombre de la sucursal es lo que más identifica) y, si ni eso entra, se recorta.
 */
export function tituloDeCartaDeSucursal(nombre: string): string {
  const base = `${normalizarEspacios(nombre)} · Carta`;
  if (contiene(nombre, MARCA_PUBLICA)) return recortarTexto(base, LARGO_MAXIMO_TITULO_PUBLICO);
  const completo = `${base} · ${MARCA_PUBLICA}`;
  return completo.length <= LARGO_MAXIMO_TITULO_PUBLICO ? completo : recortarTexto(base, LARGO_MAXIMO_TITULO_PUBLICO);
}

/**
 * Descripción de la carta de una sucursal. Si el comercio cargó la suya en el tema (`restaurante_descripcion`), esa. Si no, «Carta de <sucursal> — <marca>.» seguida de los nombres de las
 * secciones (lo que de verdad ofrece la carta), todo recortado al largo de una descripción.
 */
export function descripcionDeCartaDeSucursal(datos: { nombre: string; descripcionPropia?: string | null; secciones: readonly string[] }): string {
  const propia = datos.descripcionPropia ? normalizarEspacios(datos.descripcionPropia) : "";
  if (propia) return recortarTexto(propia, LARGO_MAXIMO_DESCRIPCION_PUBLICA);
  const nombre = normalizarEspacios(datos.nombre);
  const encabezado = contiene(nombre, MARCA_PUBLICA) ? `Carta de ${nombre}.` : `Carta de ${nombre} — ${MARCA_PUBLICA}.`;
  const secciones = datos.secciones.map(normalizarEspacios).filter(Boolean);
  return recortarTexto(secciones.length > 0 ? `${encabezado} ${secciones.join(", ")}.` : encabezado, LARGO_MAXIMO_DESCRIPCION_PUBLICA);
}

/** Título del portal: el que cargó el comercio (con la marca si no la nombra) o, sin título, «<marca> · Cartas». */
export function tituloDelPortal(tituloPortal?: string | null): string {
  const titulo = tituloPortal ? normalizarEspacios(tituloPortal) : "";
  if (!titulo) return recortarTexto(`${MARCA_PUBLICA} · Cartas`, LARGO_MAXIMO_TITULO_PUBLICO);
  if (contiene(titulo, MARCA_PUBLICA)) return recortarTexto(titulo, LARGO_MAXIMO_TITULO_PUBLICO);
  const completo = `${titulo} · ${MARCA_PUBLICA}`;
  return completo.length <= LARGO_MAXIMO_TITULO_PUBLICO ? completo : recortarTexto(titulo, LARGO_MAXIMO_TITULO_PUBLICO);
}

/** Descripción del portal: «Cartas de <marca>: <sucursal>, <sucursal>…» (una sola sucursal: «Carta de …»). */
export function descripcionDelPortal(etiquetasDeSucursales: readonly string[]): string {
  const etiquetas = etiquetasDeSucursales.map(normalizarEspacios).filter(Boolean);
  if (etiquetas.length === 0) return recortarTexto(`Cartas de ${MARCA_PUBLICA}.`, LARGO_MAXIMO_DESCRIPCION_PUBLICA);
  return recortarTexto(`${etiquetas.length === 1 ? "Carta" : "Cartas"} de ${MARCA_PUBLICA}: ${etiquetas.join(", ")}.`, LARGO_MAXIMO_DESCRIPCION_PUBLICA);
}

/** La URL de una imagen cargada por el comercio, solo si es https (lo que ya exige el validador de imágenes del tema y del portal); cualquier otra cosa, sin imagen. */
export function imagenParaCompartir(url: string | null | undefined): string | null {
  const limpia = url?.trim();
  return limpia && /^https:\/\/[^\s]+$/i.test(limpia) ? limpia : null;
}

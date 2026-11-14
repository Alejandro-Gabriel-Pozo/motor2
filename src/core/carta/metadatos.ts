import { esUrlHttpsPermitida } from "@/core/datos/url";
import { validarNombrePublico } from "./nombre-publico";

/**
 * Metadatos de la parte PÚBLICA de la carta (título, descripción, datos para compartir en redes y buscadores). PURO: arma textos a partir de datos, no lee `process.env`
 * ni nada de Next (el borde que los convierte en `Metadata` está en `components/carta-publica/metadatos.ts`).
 *
 * El nombre público de la empresa sale de un dato de cada empresa (`portal_nombre_publico`, `docs/diseno-nombre-publico-de-la-empresa-en-la-carta-2026-11-14.md`) y llega como parámetro; sin nombre cargado
 * (o con uno que no pasa la validación) los textos salen NEUTROS (F1: sin el «· <nombre>» ni el «de <nombre>», y sin nombre del sitio), nunca con un valor escrito en el código ni con el de otra empresa.
 * El nombre de la sucursal, la descripción que cargó el comercio en el tema y las secciones salen de los datos. El público de la carta no ve el nombre de la aplicación que la sirve.
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
  /** El nombre del sitio en las vistas previas: el nombre público de la empresa; `null` si no hay (entonces no se emite `og:site_name`). */
  nombreSitio: string | null;
  /** Imagen para la vista previa, SOLO si el comercio cargó una; `null` si no hay (no se inventa ninguna). */
  imagen: string | null;
}

const normalizarEspacios = (texto: string) => texto.replace(/\s+/g, " ").trim();
const contiene = (texto: string, parte: string) => texto.toLocaleLowerCase("es").includes(parte.toLocaleLowerCase("es"));

/** F1 (fallar cerrado): el nombre público tal como se puede usar en un texto (recortado, NFC, 1 a 60, sin `<` `>` ni invisibles) o `null`: nada, vacío o inválido = sin nombre. */
export function nombrePublicoUsable(nombre: unknown): string | null {
  const r = validarNombrePublico(nombre);
  return r.ok ? r.valor : null;
}

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
 * Título de la carta de una sucursal: `<nombre> · Carta` y, si hay nombre público de la empresa y no está ya en el nombre, `· <nombre público>`. Si con él no entra en el largo, se queda con lo anterior
 * (el nombre de la sucursal es lo que más identifica) y, si ni eso entra, se recorta. Sin nombre público: solo `<nombre> · Carta`.
 */
export function tituloDeCartaDeSucursal(nombre: string, nombreEmpresa?: string | null): string {
  const base = `${normalizarEspacios(nombre)} · Carta`;
  const empresa = nombrePublicoUsable(nombreEmpresa);
  if (!empresa || contiene(nombre, empresa)) return recortarTexto(base, LARGO_MAXIMO_TITULO_PUBLICO);
  const completo = `${base} · ${empresa}`;
  return completo.length <= LARGO_MAXIMO_TITULO_PUBLICO ? completo : recortarTexto(base, LARGO_MAXIMO_TITULO_PUBLICO);
}

/**
 * Descripción de la carta de una sucursal. Si el comercio cargó la suya en el tema (`restaurante_descripcion`), esa. Si no, «Carta de <sucursal> — <nombre público>.» (sin el « — <nombre público>» si no hay) seguida
 * de los nombres de las secciones (lo que de verdad ofrece la carta), todo recortado al largo de una descripción.
 */
export function descripcionDeCartaDeSucursal(datos: { nombre: string; nombreEmpresa?: string | null; descripcionPropia?: string | null; secciones: readonly string[] }): string {
  const propia = datos.descripcionPropia ? normalizarEspacios(datos.descripcionPropia) : "";
  if (propia) return recortarTexto(propia, LARGO_MAXIMO_DESCRIPCION_PUBLICA);
  const nombre = normalizarEspacios(datos.nombre);
  const empresa = nombrePublicoUsable(datos.nombreEmpresa);
  const encabezado = !empresa || contiene(nombre, empresa) ? `Carta de ${nombre}.` : `Carta de ${nombre} — ${empresa}.`;
  const secciones = datos.secciones.map(normalizarEspacios).filter(Boolean);
  return recortarTexto(secciones.length > 0 ? `${encabezado} ${secciones.join(", ")}.` : encabezado, LARGO_MAXIMO_DESCRIPCION_PUBLICA);
}

/** Título del portal: el que cargó el comercio (con el nombre público si no lo nombra) o, sin título, «<nombre público> · Cartas»; sin nombre público, el título solo o «Cartas». */
export function tituloDelPortal(tituloPortal?: string | null, nombreEmpresa?: string | null): string {
  const titulo = tituloPortal ? normalizarEspacios(tituloPortal) : "";
  const empresa = nombrePublicoUsable(nombreEmpresa);
  if (!titulo) return recortarTexto(empresa ? `${empresa} · Cartas` : "Cartas", LARGO_MAXIMO_TITULO_PUBLICO);
  if (!empresa || contiene(titulo, empresa)) return recortarTexto(titulo, LARGO_MAXIMO_TITULO_PUBLICO);
  const completo = `${titulo} · ${empresa}`;
  return completo.length <= LARGO_MAXIMO_TITULO_PUBLICO ? completo : recortarTexto(titulo, LARGO_MAXIMO_TITULO_PUBLICO);
}

/** Descripción del portal: «Cartas de <nombre público>: <sucursal>, <sucursal>…» (una sola sucursal: «Carta de …»); sin nombre público: «Cartas: <sucursal>…» (o «Cartas.» sin sucursales). */
export function descripcionDelPortal(etiquetasDeSucursales: readonly string[], nombreEmpresa?: string | null): string {
  const etiquetas = etiquetasDeSucursales.map(normalizarEspacios).filter(Boolean);
  const empresa = nombrePublicoUsable(nombreEmpresa);
  const palabra = etiquetas.length === 1 ? "Carta" : "Cartas";
  const encabezado = empresa ? `${palabra} de ${empresa}` : palabra;
  return recortarTexto(etiquetas.length === 0 ? `${encabezado}.` : `${encabezado}: ${etiquetas.join(", ")}.`, LARGO_MAXIMO_DESCRIPCION_PUBLICA);
}

/** La URL de una imagen cargada por el comercio, solo si es https (lo que ya exige el validador de imágenes del tema y del portal); cualquier otra cosa, sin imagen. */
export function imagenParaCompartir(url: string | null | undefined): string | null {
  const limpia = url?.trim();
  return limpia && esUrlHttpsPermitida(limpia) ? limpia : null;
}

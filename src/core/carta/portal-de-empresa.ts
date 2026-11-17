import type { ResultadoDeRegla } from "@/core/datos/resultado-de-regla";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "@/core/datos/texto-de-catalogo";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import type { PartesDeImagen } from "./imagen-externa";

/**
 * PORTAL DE LA EMPRESA como en Pedernal (migración 20261117162000; diseño `docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md` §6.1 y §13; Pedernal `modulos/portal/dominio/portal.ts` y `primitivas/texto/datos-de-portal.ts`, versión final del 2026-11-17). Dominio PURO: valida y compara; no lee la base ni el
 * reloj (el azar entra por el puerto). Todo lo opcional vacío es `null` («usa el valor por defecto», que vive UNA vez en el código). Cada dato declara lo que se PERMITE (conjunto, largo, forma); la base copia las mismas reglas en sus CHECK y una prueba espejo las compara.
 */

/** Las dos variantes del portal: `A` = tarjetas, `B` = imagen con zonas. Nace `A`. */
const VARIANTES_DE_PORTAL = ["A", "B"] as const;
export type VarianteDePortal = (typeof VARIANTES_DE_PORTAL)[number];
export const esVarianteDePortal = (v: unknown): v is VarianteDePortal => typeof v === "string" && (VARIANTES_DE_PORTAL as readonly string[]).includes(v);

/** La llave del QR: 22 a 64 caracteres de `[A-Za-z0-9_-]`. */
const FORMA_DEL_CODIGO = /^[A-Za-z0-9_-]{22,64}$/;
export const esCodigoDePortalValido = (codigo: unknown): codigo is string => typeof codigo === "string" && FORMA_DEL_CODIGO.test(codigo);

const ALFABETO_URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** El código de un portal nuevo: 128 bits de azar (16 bytes) en base64 de URL, 22 caracteres. El azar entra por el puerto (nunca `Math.random`): un test le pasa una fuente fija. */
export function generarCodigoDePortal(azar: FuenteDeAzar): string {
  const bytes = azar.bytes(16);
  let acumulado = 0;
  let bits = 0;
  let salida = "";
  for (const b of bytes) {
    acumulado = (acumulado << 8) | b;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      salida += ALFABETO_URL[(acumulado >> bits) & 63];
    }
    acumulado &= (1 << bits) - 1;
  }
  if (bits > 0) salida += ALFABETO_URL[(acumulado << (6 - bits)) & 63];
  return salida;
}

/** Línea superior (1 a 40) y título (1 a 60) del portal: texto de una línea con los signos del catálogo, sin exigir una letra. Los números van escritos acá, una sola vez; la base los copia en sus CHECK. */
export function lineaDelPortalDesdeTexto(texto: string): ResultadoDeRegla<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, { maximo: 40, exigirUnaLetra: false, conSignosDeCatalogo: true });
}
export function tituloDelPortalDesdeTexto(texto: string): ResultadoDeRegla<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, { maximo: 60, exigirUnaLetra: false, conSignosDeCatalogo: true });
}

/** Un color: `#rrggbb` en minúsculas (el CONTRASTE no se mide acá). */
const FORMA_DEL_COLOR = /^#[0-9a-f]{6}$/;
export const esColorDePortalValido = (color: unknown): color is string => typeof color === "string" && FORMA_DEL_COLOR.test(color);

/**
 * El teléfono de la tarjeta: SOLO DÍGITOS, de 1 a 40 (decisión del dueño, 2026-11-17: «solo números»). Sin espacios, guiones, `+` ni letras. Lista de permitidos también en el servidor (la base lo repite en `PortalTarjeta_telefono_chk`; una prueba espejo compara los dos).
 * Previene un invisible, un `<>` o un símbolo en un dato que se muestra en una página pública.
 */
const FORMA_DEL_TELEFONO = /^[0-9]{1,40}$/;
export const esTelefonoDeTarjetaValido = (telefono: unknown): telefono is string => typeof telefono === "string" && FORMA_DEL_TELEFONO.test(telefono);

/** Porcentajes de la imagen con dos decimales, guardados como enteros en CENTÉSIMAS (10000 = 100 %): sin decimales flotantes. */
const CENTESIMAS_DEL_TOTAL = 10_000;
const PORCENTAJE = /^([0-9]{1,3})(?:\.([0-9]{1,2}))?$/;

/** «12.5» → 1250. Devuelve `null` si no es un porcentaje de 0 a 100 con hasta dos decimales. */
export function centesimasDesdeTexto(texto: string): number | null {
  const m = PORCENTAJE.exec(texto);
  if (m === null) return null;
  const valor = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return valor <= CENTESIMAS_DEL_TOTAL ? valor : null;
}

/** 1250 → «12.50» (el texto que Postgres guarda en `numeric(5,2)`). */
export const textoDesdeCentesimas = (centesimas: number): string => `${Math.trunc(centesimas / 100)}.${String(centesimas % 100).padStart(2, "0")}`;

/** Un rectángulo sobre la imagen, en centésimas de porcentaje, por su esquina superior izquierda y su tamaño. */
export interface RectanguloEnCentesimas {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/** Las mismas reglas que los CHECK de `PortalZona`: ancho y alto positivos y el rectángulo entero dentro de la imagen. */
export function zonaDentroDeLaImagen(r: RectanguloEnCentesimas): boolean {
  return r.x >= 0 && r.y >= 0 && r.ancho > 0 && r.alto > 0 && r.x + r.ancho <= CENTESIMAS_DEL_TOTAL && r.y + r.alto <= CENTESIMAS_DEL_TOTAL;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Lo ya validado (lo que el caso de uso compara y escribe)
// ---------------------------------------------------------------------------------------------------------------------------

export interface DatosDelPortal {
  variante: VarianteDePortal;
  lineaSuperior: string | null;
  titulo: string | null;
  colorEncabezado: string | null;
  colorPagina: string | null;
  colorDetras: string | null;
  logoVisible: boolean;
}

export interface TarjetaDePortal {
  sucursalId: string;
  orden: number;
  visible: boolean;
  nombre: string | null;
  telefono: string | null;
  foto: PartesDeImagen | null;
}

/** Una zona en centésimas; `id` solo se usa al crearla (si ya hay una zona de esa sucursal en el portal, se identifica por la sucursal). */
export interface ZonaDePortal extends RectanguloEnCentesimas {
  id: string;
  sucursalId: string;
  visible: boolean;
}

export const mismaImagen = (a: PartesDeImagen | null, b: PartesDeImagen | null): boolean =>
  a === null || b === null ? a === b : a.proveedor === b.proveedor && a.cuenta === b.cuenta && a.idPublico === b.idPublico && a.version === b.version && a.extension === b.extension;

export const mismosDatosDelPortal = (a: DatosDelPortal, b: DatosDelPortal): boolean =>
  a.variante === b.variante &&
  a.lineaSuperior === b.lineaSuperior &&
  a.titulo === b.titulo &&
  a.colorEncabezado === b.colorEncabezado &&
  a.colorPagina === b.colorPagina &&
  a.colorDetras === b.colorDetras &&
  a.logoVisible === b.logoVisible;

export const mismaTarjeta = (a: TarjetaDePortal, b: TarjetaDePortal): boolean =>
  a.sucursalId === b.sucursalId && a.orden === b.orden && a.visible === b.visible && a.nombre === b.nombre && a.telefono === b.telefono && mismaImagen(a.foto, b.foto);

export const mismaZona = (a: ZonaDePortal, b: ZonaDePortal): boolean =>
  a.sucursalId === b.sucursalId && a.x === b.x && a.y === b.y && a.ancho === b.ancho && a.alto === b.alto && a.visible === b.visible;

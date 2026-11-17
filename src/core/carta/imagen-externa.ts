import { invalido, valido, type ResultadoDeRegla } from "@/core/datos/resultado-de-regla";

/**
 * IMAGEN POR DIRECCIÓN EXTERNA del portal de la empresa (diseño `docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md` §6.1 y §13; Pedernal `capacidades/activos/direccion-externa.ts` y `proveedores-de-imagen.ts`, versión de `main`): la imagen de fondo del
 * portal y la foto de cada tarjeta NO se suben a Motor2; la persona pega la dirección de la imagen en el proveedor y lo que se guarda son las PARTES (proveedor, cuenta, id público, versión, extensión), las cinco juntas o ninguna. Dominio PURO: ni red ni DNS.
 *
 * Reglas (todo nace cerrado: cada parte declara lo que se PERMITE, nunca lo que se prohíbe; la base las copia en `imagen_externa_valida`, migración 20261117162000, y una prueba espejo las compara):
 *  · proveedor: lista cerrada (`CLOUDINARY`); su host es un literal de acá, nunca sale de lo pegado;
 *  · cuenta: `[a-z0-9_-]`, de 1 a 64; id público: de 1 a 200, tramos de `[A-Za-z0-9_-]` separados por `/`; versión: de 1 a 12 dígitos, sin cero inicial; extensión: jpg, jpeg, png o webp.
 *
 * LO PEGADO NUNCA SE REUTILIZA: se lo descompone en partes que pasan estas listas y la dirección que se muestra se vuelve a armar desde la plantilla del proveedor (`urlDeImagenExterna`). El host se compara por IGUALDAD EXACTA con el literal (nada de «termina en»,
 * «contiene» ni resolver nombres), así que sufijos engañosos, IP, `localhost`, puntos finales o puertos no tienen por dónde pasar. Mínima a propósito (el diseño pedía «la mínima si no existe»): sin red, sin variantes de tamaño y sin las transformaciones del proveedor (las que
 * traiga lo pegado se descartan); la traída de bytes y el tope de peso son de la etapa de pantallas.
 */

/** La lista cerrada de proveedores de imagen. */
export const PROVEEDORES_DE_IMAGEN = ["CLOUDINARY"] as const;
export type ProveedorDeImagen = (typeof PROVEEDORES_DE_IMAGEN)[number];

/** Lo que se guarda por imagen: las partes, nunca la dirección pegada. */
export interface PartesDeImagen {
  readonly proveedor: ProveedorDeImagen;
  readonly cuenta: string;
  readonly idPublico: string;
  /** Solo los dígitos, sin la «v». */
  readonly version: string;
  readonly extension: string;
}

export type ErrorDeImagen = "VACIA" | "DEMASIADO_LARGA" | "CARACTER_NO_PERMITIDO" | "ESQUEMA_NO_PERMITIDO" | "HOST_NO_PERMITIDO" | "RUTA_INVALIDA" | "SIN_VERSION" | "ID_INVALIDO" | "EXTENSION_NO_PERMITIDA";

const LARGO_MAXIMO_DE_DIRECCION = 300;
const HOST_DE_CLOUDINARY = "res.cloudinary.com";
const EXTENSIONES: readonly string[] = ["jpg", "jpeg", "png", "webp"];

const CUENTA = /^[a-z0-9_-]{1,64}$/;
const VERSION = /^[1-9][0-9]{0,11}$/;
const TRAMO_DEL_ID = /^[A-Za-z0-9_-]+$/;
/** Lo que puede tener un tramo de transformación (se descarta, pero igual se mira): sin `%` ni `/`. */
const TRAMO_DE_TRANSFORMACION = /^[A-Za-z0-9_,.:-]+$/;
/** Visibles de ASCII (0x21 a 0x7E), sin la barra invertida: lo único que puede tener una dirección pegada. */
const ASCII_VISIBLE = /^[!-[\]-~]+$/;

function esIdPublico(id: string): boolean {
  return id.length >= 1 && id.length <= 200 && id.split("/").every((tramo) => TRAMO_DEL_ID.test(tramo));
}

/** ¿Son partes de una imagen que este sistema puede guardar? Cualquier cosa que no sea un objeto con las cinco partes bien formadas da `false` (nunca lanza). */
export function sonPartesDeImagenValidas(partes: unknown): partes is PartesDeImagen {
  if (typeof partes !== "object" || partes === null) return false;
  const p = partes as Record<string, unknown>;
  return (
    p.proveedor === "CLOUDINARY" &&
    typeof p.cuenta === "string" &&
    CUENTA.test(p.cuenta) &&
    typeof p.idPublico === "string" &&
    esIdPublico(p.idPublico) &&
    typeof p.version === "string" &&
    VERSION.test(p.version) &&
    typeof p.extension === "string" &&
    EXTENSIONES.includes(p.extension)
  );
}

/** La dirección completa de la imagen, armada desde las partes y la plantilla del proveedor (sin transformaciones): `https://res.cloudinary.com/<cuenta>/image/upload/v<versión>/<id>.<ext>`. Solo para partes ya válidas. */
export function urlDeImagenExterna(partes: PartesDeImagen): string {
  return `https://${HOST_DE_CLOUDINARY}/${partes.cuenta}/image/upload/v${partes.version}/${partes.idPublico}.${partes.extension}`;
}

/** Quita UN par de comillas que se arrastra al copiar. */
function sinComillas(texto: string): string {
  const pares: readonly (readonly [string, string])[] = [['"', '"'], ["'", "'"], ["“", "”"], ["‘", "’"]];
  for (const [abre, cierra] of pares) {
    if (texto.startsWith(abre) && texto.endsWith(cierra) && texto.length >= 2) return texto.slice(1, -1).trim();
  }
  return texto;
}

/**
 * Lee la dirección que pegó una persona. Tolera blancos en las puntas, un par de comillas alrededor, mayúsculas en el esquema y el host, `http://` (se acepta como texto de entrada; nunca se pide por `http`) y las transformaciones del proveedor (se descartan).
 * Rechaza con un código todo lo demás: otro host, usuario, puerto, `?`, `#`, `..`, `%`, tipos que no son `image/upload`, falta de versión, caracteres de control o fuera de ASCII. No admite fragmentos de HTML. Nunca lanza.
 */
export function leerDireccionDeImagen(texto: unknown): ResultadoDeRegla<PartesDeImagen, ErrorDeImagen> {
  if (typeof texto !== "string") return invalido("VACIA");
  const limpio = sinComillas(texto.trim());
  if (limpio === "") return invalido("VACIA");
  if (limpio.length > LARGO_MAXIMO_DE_DIRECCION) return invalido("DEMASIADO_LARGA");
  if (!ASCII_VISIBLE.test(limpio)) return invalido("CARACTER_NO_PERMITIDO");

  const minusculas = limpio.toLowerCase();
  const esquema = minusculas.startsWith("https://") ? "https://" : minusculas.startsWith("http://") ? "http://" : null;
  if (esquema === null) return invalido("ESQUEMA_NO_PERMITIDO");
  const resto = limpio.slice(esquema.length);

  const barra = resto.indexOf("/");
  if (barra === -1) return invalido("RUTA_INVALIDA");
  // Igualdad exacta con el literal del catálogo: un usuario (`@`), un puerto (`:`), un `?` o un `#` hacen que no coincida.
  if (resto.slice(0, barra).toLowerCase() !== HOST_DE_CLOUDINARY) return invalido("HOST_NO_PERMITIDO");
  const ruta = resto.slice(barra + 1);
  if (ruta.includes("?") || ruta.includes("#")) return invalido("RUTA_INVALIDA");

  const tramos = ruta.split("/");
  const [cuenta, recurso, entrega, ...cola] = tramos;
  if (cuenta === undefined || recurso !== "image" || entrega !== "upload" || cola.length < 2) return invalido("RUTA_INVALIDA");
  if (!CUENTA.test(cuenta)) return invalido("RUTA_INVALIDA");

  // Lo que sigue a `upload/`: transformaciones (se descartan), la versión `v<dígitos>` y el id con extensión.
  const posicionDeVersion = cola.findIndex((t) => t.startsWith("v") && VERSION.test(t.slice(1)));
  if (posicionDeVersion === -1) return invalido("SIN_VERSION");
  if (!cola.slice(0, posicionDeVersion).every((t) => TRAMO_DE_TRANSFORMACION.test(t))) return invalido("RUTA_INVALIDA");
  const version = cola[posicionDeVersion]!.slice(1);
  const tramosDelId = cola.slice(posicionDeVersion + 1);
  const ultimo = tramosDelId.pop();
  if (ultimo === undefined) return invalido("ID_INVALIDO");
  const punto = ultimo.lastIndexOf(".");
  if (punto === -1) return invalido("EXTENSION_NO_PERMITIDA");
  const extension = ultimo.slice(punto + 1).toLowerCase();
  if (!EXTENSIONES.includes(extension)) return invalido("EXTENSION_NO_PERMITIDA");
  const idPublico = [...tramosDelId, ultimo.slice(0, punto)].join("/");
  if (!esIdPublico(idPublico)) return invalido("ID_INVALIDO");

  return valido({ proveedor: "CLOUDINARY", cuenta, idPublico, version, extension });
}

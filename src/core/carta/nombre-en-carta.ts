/**
 * «Nombre en la carta» (2026-11-04; `docs/diseno-nombre-en-carta-2026-11-04.md`): en la carta de una sucursal NO puede haber dos cosas con el mismo nombre visible (regla del dueño). Dos nombres son
 * «el mismo» si no se distinguen sin mayúsculas ni tildes ni espacios de los bordes. Lógica PURA; las lecturas que juntan los nombres de la carta viven en `server/lecturas/carta/choque-de-nombre.ts`.
 */

/** La forma de comparar dos nombres de carta: sin tildes, sin mayúsculas, sin espacios de los bordes ni dobles. */
export function claveDeNombreDeCarta(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Con qué choca un nombre: el nombre en la carta de otro plato, el nombre del producto de otro plato visible, un ítem agrupado o una promo de la misma sucursal. */
export type TipoDeChoqueDeNombre = "nombre-en-carta" | "nombre-del-producto" | "agrupado" | "promo";

export interface ChoqueDeNombre {
  tipo: TipoDeChoqueDeNombre;
  /** El nombre con el que choca, tal como está escrito en su origen (para el mensaje). */
  con: string;
  /** Solo en `nombre-en-carta`: el producto que lleva ese nombre en la carta. */
  producto?: string;
}

/** Un nombre que ya está usado en la carta de la sucursal, con su origen. */
export interface NombreUsadoEnLaCarta {
  tipo: TipoDeChoqueDeNombre;
  nombre: string;
  /** Solo en `nombre-en-carta`: el producto que lleva ese nombre en la carta. */
  producto?: string;
}

/** El primer nombre usado que coincide con `nombre` (sin mayúsculas ni tildes), o `null`. Se queda con el primero en el orden dado: el mensaje es el mismo para quien repite. */
export function buscarChoqueEntreNombres(nombre: string, usados: readonly NombreUsadoEnLaCarta[]): ChoqueDeNombre | null {
  const clave = claveDeNombreDeCarta(nombre);
  const choca = usados.find((u) => claveDeNombreDeCarta(u.nombre) === clave);
  return choca ? { tipo: choca.tipo, con: choca.nombre, ...(choca.producto === undefined ? {} : { producto: choca.producto }) } : null;
}

/** El mensaje al usuario: nombra el nombre repetido y quién lo usa. */
export function mensajeDeChoqueDeNombre(nombre: string, choque: ChoqueDeNombre): string {
  const quien =
    choque.tipo === "nombre-en-carta"
      ? `el plato «${choque.producto ?? choque.con}» de esta carta, que se llama así en la carta`
      : choque.tipo === "nombre-del-producto"
        ? `el plato «${choque.con}» de esta carta, que sale con el nombre de su producto`
        : choque.tipo === "agrupado"
          ? `el ítem agrupado «${choque.con}» de esta carta`
          : `la promo «${choque.con}» de esta sucursal`;
  return `«${nombre}» ya lo usa ${quien}. En una carta no puede haber dos cosas con el mismo nombre: elegí otro.`;
}

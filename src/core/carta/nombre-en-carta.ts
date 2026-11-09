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

/** El mensaje al usuario (redacción confirmada por el dueño, 2026-11-04): nombra el nombre repetido, quién ya lo usa y la carta. */
export function mensajeDeChoqueDeNombre(nombre: string, choque: ChoqueDeNombre, sucursalNombre: string): string {
  const quien =
    choque.tipo === "nombre-en-carta" || choque.tipo === "nombre-del-producto"
      ? `el producto "${choque.producto ?? choque.con}"`
      : choque.tipo === "agrupado"
        ? `el ítem agrupado "${choque.con}"`
        : `la promo "${choque.con}"`;
  return `"${nombre}" ya lo usa ${quien} en la carta de ${sucursalNombre}. Ponele un nombre de carta distinto a uno de los dos.`;
}

/**
 * El estado del «Nombre en la carta» de un plato EN LA CARTA de una sucursal (2026-11-04, confirmado por el dueño): el interno solo vale como nombre de carta «si es apto para carta y fue adrede».
 *  - `pendiente`: sin decidir (`NULL`): la carta usa el nombre del producto (nunca se oculta un plato) pero el admin lo muestra «pendiente de completar»;
 *  - `propio`: tiene un nombre de carta distinto del interno;
 *  - `confirmado-igual-al-interno`: alguien lo dejó igual al interno a propósito («Está bien así»): no está pendiente. Si después renombran el producto, el de la carta queda como estaba.
 */
export type EstadoDelNombreDeCarta = "pendiente" | "propio" | "confirmado-igual-al-interno";

export function estadoDelNombreDeCarta(producto: { nombre: string }, contenido: { nombreEnCarta: string | null }): EstadoDelNombreDeCarta {
  if (contenido.nombreEnCarta === null) return "pendiente";
  return contenido.nombreEnCarta === producto.nombre ? "confirmado-igual-al-interno" : "propio";
}

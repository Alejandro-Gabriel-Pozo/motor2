/**
 * ORÁCULO del «Va con: …» (invitación «5+2»; caso del dueño, 2026-11-04: al tocar «guarnición» el «Va con» mostraba el nombre INTERNO de la base, «BIFE-»), escrito A MANO y aparte del código: no importa nada
 * de `src/`. Lo que DEBE leer el cliente como nombre de cada plato que lleva el bloque, según la FORMA del plato en la carta:
 *  - directo: su nombre de carta (`nombreEnCarta ?? nombre`);
 *  - base-oculta (la medida oculta: un renglón por opción, «cada opción como un plato»): los rótulos de sus renglones, uno por plato; NUNCA el nombre interno de la base;
 *  - base-con-nombre-arriba (una tabla con título): ese nombre (`nombreEnCarta ?? nombre`);
 *  - agrupado: el nombre del ítem agrupado.
 * Con un subconjunto (el plato admite solo algunas opciones del bloque) cada nombre lleva « (solo puré o ensalada)».
 *
 * Dimensiones: forma × nombre en la carta (sin / con) × subconjunto (todas / algunas) = 4 × 2 × 2.
 */
export const FORMA_DEL_PLATO = ["directo", "base-oculta", "base-con-nombre-arriba", "agrupado"] as const;
export const NOMBRE_EN_CARTA = ["sin", "con"] as const;
export const SUBCONJUNTO = ["todas", "algunas"] as const;

export const TAMANO_DEL_VA_CON = 4 * 2 * 2;

export const INTERNO = "BIFE-";
export const DE_CARTA = "Bife de la casa";
export const RENGLONES = ["Bife a criolla", "Bife con chimichurri"] as const;
export const AGRUPADO = "Platos del día";

/** Lo que DEBE decir «Va con» (sin el «Lo incluyen: »), en el orden de la sección, para ese plato. */
export function vaConEsperado(forma: (typeof FORMA_DEL_PLATO)[number], conNombre: (typeof NOMBRE_EN_CARTA)[number], subconjunto: (typeof SUBCONJUNTO)[number]): string[] {
  const nombres =
    forma === "base-oculta"
      ? [...RENGLONES]
      : forma === "agrupado"
        ? [AGRUPADO]
        : [conNombre === "con" ? DE_CARTA : INTERNO];
  return nombres.map((n) => (subconjunto === "algunas" ? `${n} (solo puré o ensalada)` : n));
}

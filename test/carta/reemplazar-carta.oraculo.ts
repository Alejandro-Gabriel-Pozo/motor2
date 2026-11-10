/**
 * ORÁCULO de «reemplazar la carta con la de otra sucursal» (2026-11-10), escrito APARTE del código que lo cumple (`src/core/features/carta/reemplazar-carta.ts` y el caso de uso). Es la tabla de reglas esperadas
 * que recorre `reemplazar-carta-combinaciones.test.ts`; la versión para leer está en `docs/diseno-reemplazar-carta-de-sucursal-2026-11-10.md` (N10).
 *
 * DIMENSIONES cuyas combinaciones cambian lo que ve el cliente en la carta (visibilidad en carta y POS):
 *   A. Lo que tiene el DESTINO: géneros (sí/no) × ítems agrupados (sí/no) × contenidos de producto (sí/no)  → 8 (vacío si los tres «no»).
 *   B. Lo que tiene el ORIGEN: ídem → 8 (sin carta si los tres «no»).
 *   C. Referencias a las filas del destino: no existen en el esquema (guardián en `reemplazar-carta-combinaciones.test.ts`); si apareciera una, la dimensión se declara acá.
 * El modo (copiar / reemplazar) es la otra dimensión: `COPIAR` rechaza todo destino con carta; `REEMPLAZAR` no.
 */

export interface PresenciaDeCarta {
  generos: boolean;
  items: boolean;
  contenidos: boolean;
}

export const PRESENCIAS: readonly PresenciaDeCarta[] = [false, true].flatMap((generos) => [false, true].flatMap((items) => [false, true].map((contenidos) => ({ generos, items, contenidos }))));

export const tieneCarta = (p: PresenciaDeCarta): boolean => p.generos || p.items || p.contenidos;

export const nombreDe = (p: PresenciaDeCarta): string => `${p.generos ? "G" : "-"}${p.items ? "I" : "-"}${p.contenidos ? "C" : "-"}`;

/** Lo que se espera de «REEMPLAZAR» con un destino y un origen DISTINTOS entre sí. */
export type EsperadoReemplazar = { ok: false; codigo: "ORIGEN_SIN_CARTA" } | { ok: true; huboCambio: true };

/**
 * Regla 1: un origen sin carta propia rechaza y el destino queda como estaba.
 * Regla 2: con un origen con carta, el destino queda EXACTAMENTE con lo del origen (lo que tenía de más desaparece, lo que le falta aparece), tenga o no carta antes.
 */
export function esperadoDeReemplazar(_destino: PresenciaDeCarta, origen: PresenciaDeCarta): EsperadoReemplazar {
  return tieneCarta(origen) ? { ok: true, huboCambio: true } : { ok: false, codigo: "ORIGEN_SIN_CARTA" };
}

/** Lo que se espera de «COPIAR» (la copia de siempre): solo sobre un destino vacío. */
export type EsperadoCopiar = { ok: false; codigo: "CARTA_PROPIA_EXISTENTE" | "ORIGEN_SIN_CARTA" } | { ok: true };

export function esperadoDeCopiar(destino: PresenciaDeCarta, origen: PresenciaDeCarta): EsperadoCopiar {
  if (tieneCarta(destino)) return { ok: false, codigo: "CARTA_PROPIA_EXISTENTE" };
  return tieneCarta(origen) ? { ok: true } : { ok: false, codigo: "ORIGEN_SIN_CARTA" };
}

/**
 * Columnas de las cuatro tablas de la carta propia, con su destino en la copia / el reemplazo. Un guardián falla si el esquema trae una columna que no figura acá (hay que decidir si la copia la copia).
 *  - `copia`: se copia al destino tal cual (con el género reapuntado, donde corresponda).
 *  - `identidad`: la genera la base en el destino (id, fechas, empresa, sucursal destino) o es la relación que reapunta la copia.
 */
export const COLUMNAS_DE_LA_CARTA: Readonly<Record<string, Readonly<Record<string, "copia" | "identidad">>>> = {
  GeneroCarta: { id: "identidad", empresaId: "identidad", sucursalId: "identidad", nombre: "copia", orden: "copia", activo: "copia", creadoEn: "identidad" },
  ItemAgrupadoCarta: {
    id: "identidad",
    empresaId: "identidad",
    sucursalId: "identidad",
    nombre: "copia",
    seccionCartaId: "copia",
    descripcion: "copia",
    tags: "copia",
    especial: "copia",
    orden: "copia",
    activo: "copia",
    generoCartaId: "copia",
    creadoEn: "identidad",
    actualizadoEn: "identidad",
  },
  OpcionItemAgrupadoCarta: { id: "identidad", empresaId: "identidad", sucursalId: "identidad", itemAgrupadoCartaId: "identidad", productoId: "copia", orden: "copia", creadoEn: "identidad" },
  ContenidoCartaProducto: {
    id: "identidad",
    empresaId: "identidad",
    sucursalId: "identidad",
    productoId: "copia",
    visibleEnCarta: "copia",
    seccionCartaId: "copia",
    descripcion: "copia",
    tags: "copia",
    especial: "copia",
    orden: "copia",
    mostrarNombreArriba: "copia",
    nombreEnCarta: "copia",
    generoCartaId: "copia",
    actualizadoEn: "identidad",
  },
};

/** Modelos del esquema que PUEDEN apuntar a filas de la carta propia: solo ellas mismas (ver el diseño, N5). Un modelo nuevo que apunte a una fila de carta obliga a revisar el borrado. */
export const MODELOS_QUE_APUNTAN_A_LA_CARTA: Readonly<Record<string, readonly string[]>> = {
  GeneroCarta: ["ContenidoCartaProducto", "ItemAgrupadoCarta"],
  ItemAgrupadoCarta: ["OpcionItemAgrupadoCarta"],
  OpcionItemAgrupadoCarta: [],
  ContenidoCartaProducto: [],
};

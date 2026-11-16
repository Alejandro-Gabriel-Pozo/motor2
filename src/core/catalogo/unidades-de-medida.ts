/**
 * Las 14 unidades de medida de Pedernal (docs/diseno-unidades-de-medida-como-pedernal-2026-11-15.md, etapa U0): el CATÁLOGO CERRADO y la
 * CONVERSIÓN EXACTA entre unidades de la misma dimensión. Núcleo PURO: sin Prisma, sin reloj, sin azar, sin `number` en la aritmética;
 * todavía NO está conectado a ninguna pantalla, tabla ni cálculo (la columna `Unidad.codigoFijo` es la etapa U1).
 *
 * Copia del resultado y de la forma de Pedernal (`src/primitivas/unidades/unidades.ts` y `convertir-cantidad.ts`, migración
 * `0025_catalogo.sql`): mismos códigos, símbolos, dimensiones y factores; misma regla «exacta o se rechaza, nunca redondea»; mismo
 * orden de controles. Los factores NO cambian nunca: cambiar uno revaluaría en silencio toda la historia.
 *
 * Diferencias declaradas con Pedernal:
 *  - «Dimensión» es la «magnitud» de Motor2 (el enum `MagnitudUnidad` tiene PESO, VOLUMEN y CANTIDAD; las 6 dimensiones de acá son el
 *    destino de U3). Se conservan los nombres de Pedernal (MASA, CONTEO…) y sus códigos de error (DIMENSION_DISTINTA…) para que sea
 *    la misma forma; el pasaje PESO→MASA, VOLUMEN→VOLUMEN, CANTIDAD→CONTEO es de U1b, no de este archivo.
 *  - Rango: Pedernal guarda cantidades en `numeric(18,4)`; Motor2 en `Decimal(14,4)` (`prisma/schema.prisma`, p. ej. `factorConversion`).
 *    Motivo: columnas ya existentes con datos. El tope de acá es el de Motor2.
 *  - Los NOMBRES que se ven («Kilogramo»…) no están acá: son texto de pantalla y entran en U2 con su aprobación.
 *
 * Los `bigint` se arman con `BigInt(…)` y no con literales `1n`: el proyecto compila con `target: ES2017`, que no admite literales `bigint`.
 *
 * Todo nace cerrado (AGENTS.md, 2026-11-11): una unidad que no está en `UNIDADES_DE_MEDIDA` no existe (la consulta usa propiedad propia,
 * nunca `in`, así «toString» o «__proto__» no pasan por unidad) y una entrada que no tiene la forma permitida se rechaza.
 */

/** Las seis dimensiones de las 14 unidades. */
export const DIMENSIONES_DE_UNIDAD = ["CONTEO", "MASA", "VOLUMEN", "LONGITUD", "SUPERFICIE", "TIEMPO"] as const;
export type DimensionDeUnidad = (typeof DIMENSIONES_DE_UNIDAD)[number];

/** Una unidad: dimensión, símbolo y factor ENTERO a la unidad base de su dimensión (la más chica, factor 1). */
export interface DefinicionDeUnidad {
  readonly dimension: DimensionDeUnidad;
  readonly simbolo: string;
  readonly factor: bigint;
}

export const UNIDADES_DE_MEDIDA = {
  UNIDAD: { dimension: "CONTEO", simbolo: "u", factor: BigInt(1) },
  GRAMO: { dimension: "MASA", simbolo: "g", factor: BigInt(1) },
  KILOGRAMO: { dimension: "MASA", simbolo: "kg", factor: BigInt(1_000) },
  TONELADA: { dimension: "MASA", simbolo: "t", factor: BigInt(1_000_000) },
  MILILITRO: { dimension: "VOLUMEN", simbolo: "ml", factor: BigInt(1) },
  LITRO: { dimension: "VOLUMEN", simbolo: "l", factor: BigInt(1_000) },
  METRO_CUBICO: { dimension: "VOLUMEN", simbolo: "m3", factor: BigInt(1_000_000) },
  MILIMETRO: { dimension: "LONGITUD", simbolo: "mm", factor: BigInt(1) },
  CENTIMETRO: { dimension: "LONGITUD", simbolo: "cm", factor: BigInt(10) },
  METRO: { dimension: "LONGITUD", simbolo: "m", factor: BigInt(1_000) },
  CENTIMETRO_CUADRADO: { dimension: "SUPERFICIE", simbolo: "cm2", factor: BigInt(1) },
  METRO_CUADRADO: { dimension: "SUPERFICIE", simbolo: "m2", factor: BigInt(10_000) },
  MINUTO: { dimension: "TIEMPO", simbolo: "min", factor: BigInt(1) },
  HORA: { dimension: "TIEMPO", simbolo: "h", factor: BigInt(60) },
} as const satisfies Record<string, DefinicionDeUnidad>;

export type CodigoDeUnidad = keyof typeof UNIDADES_DE_MEDIDA;

/** Los 14 códigos, en el orden de la lista. */
export const CODIGOS_DE_UNIDAD = Object.keys(UNIDADES_DE_MEDIDA) as readonly CodigoDeUnidad[];

/** `true` solo si `valor` es EXACTAMENTE uno de los 14 códigos (propiedad propia: «toString» o «__proto__» no lo son). */
export function esCodigoDeUnidad(valor: unknown): valor is CodigoDeUnidad {
  return typeof valor === "string" && Object.prototype.hasOwnProperty.call(UNIDADES_DE_MEDIDA, valor);
}

/** Decimales de una cantidad (columnas `Decimal(14,4)`). */
const DECIMALES_DE_CANTIDAD = 4;

/** Tope en unidades mínimas (diez mil-ésimas) de una columna `Decimal(14,4)`: 14 dígitos en total. */
export const MAXIMO_DE_UNIDADES_MINIMAS = BigInt(10) ** BigInt(14) - BigInt(1);

const LARGO_MAXIMO_DE_TEXTO = 40;
/** Forma permitida: entero o decimal con punto, sin signo, sin ceros a la izquierda, sin notación científica ni separador de miles. */
const FORMA_PERMITIDA = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

/** Motivos cerrados de rechazo, en el orden en que se controlan. */
export const MOTIVOS_DE_CONVERSION = ["UNIDAD_DESCONOCIDA", "CANTIDAD_INVALIDA", "DIMENSION_DISTINTA", "CONVERSION_NO_EXACTA", "FUERA_DE_RANGO"] as const;
export type MotivoDeConversion = (typeof MOTIVOS_DE_CONVERSION)[number];

export type ResultadoDeConversion = { readonly ok: true; readonly cantidad: string } | { readonly ok: false; readonly motivo: MotivoDeConversion };

/** Cantidad en texto → unidades mínimas (`bigint`), o `null` si no tiene la forma permitida (nunca pasa por `number`). */
function aUnidadesMinimas(texto: string): bigint | null {
  if (texto.length > LARGO_MAXIMO_DE_TEXTO) return null;
  const grupos = FORMA_PERMITIDA.exec(texto);
  if (grupos === null) return null;
  const entera = grupos[1] ?? "";
  const fraccion = grupos[2] ?? "";
  if (fraccion.length > DECIMALES_DE_CANTIDAD) return null;
  const unidades = BigInt(entera + fraccion.padEnd(DECIMALES_DE_CANTIDAD, "0"));
  return unidades > MAXIMO_DE_UNIDADES_MINIMAS ? null : unidades;
}

/** Unidades mínimas → texto con exactamente 4 decimales («1000.0000»), la forma canónica de Pedernal. */
function aTexto(unidades: bigint): string {
  const digitos = unidades.toString().padStart(DECIMALES_DE_CANTIDAD + 1, "0");
  const corte = digitos.length - DECIMALES_DE_CANTIDAD;
  return `${digitos.slice(0, corte)}.${digitos.slice(corte)}`;
}

/**
 * Convierte una cantidad entre dos unidades de la MISMA dimensión con aritmética entera exacta: `unidades × factor(de) / factor(a)`.
 * NUNCA redondea: si la división deja resto devuelve `CONVERSION_NO_EXACTA` (1 g a toneladas, 0,000001, no cabe en 4 decimales). No hay
 * redondeo ni siquiera opcional: quien necesite redondear lo decide aparte, explícitamente, con su propia regla.
 *
 * Orden de los controles (el primero que falla gana): unidad conocida (las dos), forma de la cantidad (texto como «12.5», hasta 4 decimales,
 * sin signo y dentro del tope de la columna), dimensión, exactitud, rango. Pura e idempotente: mismas entradas, mismo resultado.
 */
export function convertirCantidadExacta(cantidad: string, de: string, a: string): ResultadoDeConversion {
  if (!esCodigoDeUnidad(de) || !esCodigoDeUnidad(a)) return { ok: false, motivo: "UNIDAD_DESCONOCIDA" };
  const unidades = aUnidadesMinimas(cantidad);
  if (unidades === null) return { ok: false, motivo: "CANTIDAD_INVALIDA" };
  const origen = UNIDADES_DE_MEDIDA[de];
  const destino = UNIDADES_DE_MEDIDA[a];
  if (origen.dimension !== destino.dimension) return { ok: false, motivo: "DIMENSION_DISTINTA" };
  const numerador = unidades * origen.factor;
  if (numerador % destino.factor !== BigInt(0)) return { ok: false, motivo: "CONVERSION_NO_EXACTA" };
  const resultado = numerador / destino.factor;
  if (resultado > MAXIMO_DE_UNIDADES_MINIMAS) return { ok: false, motivo: "FUERA_DE_RANGO" };
  return { ok: true, cantidad: aTexto(resultado) };
}

/**
 * El «elemento configurable» (GO-0b): tipos y constantes de los grupos de opciones de venta (tamaño, variante, incluida, adicional).
 *
 * Son el ESPEJO de lo que GO-1 va a crear en la base (diseño: `_planes/go-0-grupos-de-opciones-diseno-2026-10-12.md`, §2): los enums
 * `TipoDeGrupoDeOpciones`, `ModoDePrecioDeMedida` y `EfectoDeConsumoDeOpcion` de Prisma y el `tipoDeDiferencia` de `VersionDeOpcion` /
 * `ProductoAdmiteOpcion`. Hoy NO existe nada de esto en `prisma/schema.prisma`: cuando exista, un test de paridad (como el de las alícuotas de
 * IVA) tiene que comparar estas listas con la base. Los nombres son neutros (multirrubro): un tamaño es una MEDIDA tanto para un café como para
 * un masaje de 30/60/90 minutos.
 *
 * Sin funciones y sin Prisma: solo constantes y tipos puros.
 */

/** Qué clase de grupo es; fija las reglas de precio y de consumo de sus opciones (diseño §2.0). Inmutable una vez creado el grupo. */
export const TIPOS_DE_GRUPO_DE_OPCIONES = ["MEDIDA", "VARIANTE", "INCLUIDA", "ADICIONAL"] as const;
export type TipoDeGrupoDeOpciones = (typeof TIPOS_DE_GRUPO_DE_OPCIONES)[number];

/** Cómo se cobra una MEDIDA en un producto: el precio ABSOLUTO del producto en esa medida, o una DIFERENCIA sobre el precio base. */
export const MODOS_DE_PRECIO_DE_MEDIDA = ["ABSOLUTO", "DIFERENCIA"] as const;
export type ModoDePrecioDeMedida = (typeof MODOS_DE_PRECIO_DE_MEDIDA)[number];

/** Qué hace una opción con el consumo de stock: SUMA ingredientes a los de la base o REEMPLAZA uno de ellos. */
export const EFECTOS_DE_CONSUMO_DE_OPCION = ["SUMA", "REEMPLAZA"] as const;
export type EfectoDeConsumoDeOpcion = (typeof EFECTOS_DE_CONSUMO_DE_OPCION)[number];

/** En qué se expresa una diferencia de precio: un MONTO fijo o un PORCENTAJE del precio base (el dueño elige cuál ingresa; se guarda uno solo). */
export const TIPOS_DE_DIFERENCIA = ["MONTO", "PORCENTAJE"] as const;
export type TipoDeDiferencia = (typeof TIPOS_DE_DIFERENCIA)[number];

/** Una diferencia de precio ya resuelta (la del producto si la sobrescribe, si no la de la versión de la opción). El porcentaje es el de `DECIMAL(7,4)`: hasta 4 decimales. */
export type DiferenciaDePrecio = { tipo: "MONTO"; monto: number } | { tipo: "PORCENTAJE"; porcentaje: number };

/** Tope de unidades de una opción por unidad vendida y de opciones por grupo (CHECK `BETWEEN 1 AND 10` de `GrupoDeOpciones`, `ProductoAdmiteOpcion` y `OpcionElegidaEnLinea`). */
export const CANTIDAD_MAXIMA_DE_OPCION = 10;

/** Tope del factor de escala de una MEDIDA (CHECK `factorEscala > 0 AND factorEscala <= 10`, `DECIMAL(8,4)`). */
export const FACTOR_DE_ESCALA_MAXIMO = 10;

/** Piso de un precio de lista y de un recargo: 0,01. Un importe de 0 en una línea de venta se lee como «venta vieja sin precio» (`core/moneda.ts`, `precioConDescuento`). */
export const IMPORTE_MINIMO = 0.01;

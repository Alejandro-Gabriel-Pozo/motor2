/**
 * Primitivas del catálogo de textos de interfaz (diseño `docs/diseno-textos-en-codigo-2026-11-16.md`, §3 nivel 5; tramo T1). Puras: sin I/O, sin imports.
 * Forma de Pedernal, código propio. No confundir con la regla de NOMBRES de `core/datos/texto-de-catalogo.ts` (lo que la persona escribe): esto es lo que el sistema le dice.
 */

/**
 * Qué clase de valor llena un hueco `{nombre}` del texto.
 *  - `texto`: una cadena (por ejemplo el nombre de un producto); se escribe tal cual, sin volver a interpretarla.
 *  - `causa`: la CLAVE de otro texto del catálogo que no tiene huecos propios (un solo nivel, sin recursión); se escribe su `porDefecto`.
 * Los tipos `numero`, `dinero` y `entidad` del diseño entran con la primera entrada real que los pida (hoy ninguna).
 */
export type TipoDeMarcador = "texto" | "causa";

/** Quién autorizó el texto: una decisión del registro (`DEC-NNNN`, `ACEPTADA` o `CORREGIDA`) o `HEREDADO` (escrito antes del catálogo; solo para la línea base, que solo baja). */
export type FuenteDeTexto = { readonly decision: string } | "HEREDADO";

/** Dónde se usa: la función o constante `nombre` de ese archivo (ruta desde la raíz del repo) cuyo cuerpo cita la clave. */
export interface UsoDeTexto {
  readonly archivo: string;
  readonly nombre: string;
}

export interface DefinicionDeTexto {
  /** El texto de hoy, palabra por palabra, con sus huecos `{nombre}`. */
  readonly porDefecto: string;
  /** Un renglón por hueco de `porDefecto`: ni uno más ni uno menos (lo comprueba el guardián). */
  readonly marcadores?: Readonly<Record<string, TipoDeMarcador>>;
  readonly usos: readonly UsoDeTexto[];
  readonly fuente: FuenteDeTexto;
  /** Solo si el mismo valor se mantiene bajo otra clave A PROPÓSITO: la otra clave y el motivo. */
  readonly homonimoDe?: { readonly clave: string; readonly motivo: string };
}

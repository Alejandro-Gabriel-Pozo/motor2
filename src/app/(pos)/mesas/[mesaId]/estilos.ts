/** Clases de botón de la pantalla de la mesa (mismo lenguaje visual que el mapa: primario en `--brand`, secundario con borde). */
export const BOTON_PRIMARIO =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-marca px-4 py-[9px] text-[13px] font-semibold text-superficie transition-colors enabled:hover:bg-marca-hover disabled:cursor-not-allowed disabled:opacity-50";
export const BOTON_SECUNDARIO =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-borde bg-superficie px-4 py-[9px] text-[13px] font-semibold enabled:hover:bg-superficie-suave disabled:cursor-not-allowed disabled:opacity-50";
// En celular (< 768 px, el `md:` de Tailwind) mide 44 px como mínimo de alto y de ancho: es un botón que se toca con el dedo, en una fila de la cuenta (MOVIL, O.460). En escritorio, igual que siempre.
export const BOTON_CHICO =
  "max-md:min-h-11 max-md:min-w-11 rounded-md border border-borde bg-superficie px-2.5 py-1 text-[12.5px] font-semibold enabled:hover:bg-superficie-suave disabled:cursor-not-allowed disabled:opacity-50";
export const CAMPO = "rounded-lg border border-borde bg-superficie px-3 py-2 text-[14px] outline-none focus:border-tinta-suave";

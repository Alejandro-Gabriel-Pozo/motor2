/** Clases de botón de la pantalla de la mesa (mismo lenguaje visual que el mapa: primario en `--brand`, secundario con borde). */
export const BOTON_PRIMARIO =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--brand)] px-4 py-[9px] text-[13px] font-semibold text-white transition-colors enabled:hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50";
export const BOTON_SECUNDARIO =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-4 py-[9px] text-[13px] font-semibold enabled:hover:bg-[#F1EFEA] disabled:cursor-not-allowed disabled:opacity-50";
export const BOTON_CHICO =
  "rounded-md border border-[var(--border)] bg-white px-2.5 py-1 text-[12.5px] font-semibold enabled:hover:bg-[#F1EFEA] disabled:cursor-not-allowed disabled:opacity-50";
export const CAMPO = "rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[14px] outline-none focus:border-[var(--ink-soft)]";

import { IconoAyuda } from "@/components/iconos";

/**
 * Ayuda de campo persistente — no depende de que el campo esté vacío (a
 * diferencia de un placeholder, que desaparece apenas se tipea). Mismo
 * problema que ERPNext resuelve con `description` + `.help-box`
 * (`base_input.js:223-234`) y Dolibarr con un ícono "?" al lado del label
 * (`Form::textwithpicto()`) — acá, más simple, un texto fijo bajo el
 * campo. Ver docs/comparativa-ux-erpnext-dolibarr.md §6.
 */
export function AyudaCampo({ children }: { children: React.ReactNode }) {
  return <p className="-mt-1 text-xs text-neutral-500">{children}</p>;
}

/**
 * Variante ícono "?" con tooltip nativo (`title`) — para encabezados de
 * columna en una tabla, donde `AyudaCampo` (un bloque de texto fijo) no
 * entra sin romper el layout. Mismo mecanismo de fondo que
 * `Form::textwithpicto()` de Dolibarr (ver docs/comparativa-ux-erpnext-dolibarr.md
 * §6.1): un ícono al lado del label que muestra la ayuda al hover, sin
 * ocupar espacio.
 */
export function AyudaIcono({ texto }: { texto: string }) {
  return (
    <span tabIndex={0} role="img" title={texto} className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center text-neutral-500">
      <IconoAyuda />
    </span>
  );
}

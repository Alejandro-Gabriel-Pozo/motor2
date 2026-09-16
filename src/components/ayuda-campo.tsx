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

/**
 * true si `valor` convierte a un número finito (no NaN, no ±Infinity).
 *
 * Las validaciones de las Server Actions usan `!(x > 0)` / `!(x >= 0)`, que
 * ya rechazan NaN, pero dejan pasar `Infinity` (`Infinity > 0` es true) y un
 * `NaN` en un `< 0` (`NaN < 0` es false). Este chequeo se agrega DESPUÉS de esas
 * validaciones, sin reemplazarlas. **El orden es a propósito y no debe
 * invertirse**: como ya pasaron `> 0` / `>= 0`, solo pueden llegar acá `±Infinity`
 * (y NaN en los sitios `< 0`); si el chequeo fuera antes, un `undefined` o un
 * texto no numérico cambiaría el mensaje de error que hoy se muestra (algunos
 * tests lo verifican, ej. `test/catalogo/presentaciones.test.ts`).
 *
 * Convierte con `Number()` a propósito — un número que llega como texto ("5")
 * sigue siendo válido, igual que en las comparaciones que ya existían. Por eso
 * `null`, `""` y `[]` (que `Number()` convierte en 0) cuentan como finitos y
 * `undefined` no: no usar este chequeo solo, sin una validación previa, sobre
 * un campo que pueda venir vacío.
 */
export function esNumeroFinito(valor: unknown): boolean {
  return Number.isFinite(Number(valor));
}

/**
 * true solo si `valor` YA ES un número (typeof "number") finito. A diferencia de `esNumeroFinito` no convierte: `null`, `""`, `[]` y `"5"`
 * quedan fuera. Es el chequeo para los datos que llegan de un POST crudo a una Server Action y se GUARDAN tal cual: si se valida con
 * `Number(x)` pero se guarda `x`, lo validado y lo guardado pueden ser cosas distintas.
 */
export function esNumeroEstricto(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

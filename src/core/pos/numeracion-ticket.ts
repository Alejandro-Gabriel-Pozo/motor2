/**
 * Numeración del ticket de cierre del POS (docs/plan-numeracion-ticket-2026-09-25.md). Núcleo PURO, sin Prisma: corre también en el
 * navegador (el ticket impreso y «Cuentas cerradas» formatean el número acá).
 *
 * Control interno de comandas (guest check control), NO comprobante fiscal: el ticket sigue diciendo «No válido como factura».
 * - Número BASE: secuencial por sucursal y sin huecos (`max + 1` dentro de la transacción serializable de `cerrarCuenta`).
 * - EJEMPLAR: cada papel impreso de ese número. 1 = A (el original); una corrección es el ejemplar siguiente (B, C…) con el MISMO
 *   número. Se guarda como entero y se muestra como letra (1 → A, 26 → Z, 27 → AA), igual que las columnas de una planilla.
 */

export type NumeroDeTicket = { numero: number; ejemplar: number };

/** El número base que le toca al próximo ticket de la sucursal, a partir del máximo ya emitido (null = ninguna todavía). */
export function siguienteNumeroTicket(max: number | null): number {
  return (max ?? 0) + 1;
}

/** 1 → «A», 2 → «B», 26 → «Z», 27 → «AA»… (numeración biyectiva en base 26). */
export function letraDeEjemplar(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Ejemplar de ticket inválido: ${n} (tiene que ser un entero desde 1).`);
  let letras = "";
  for (let resto = n; resto > 0; resto = Math.floor((resto - 1) / 26)) {
    letras = String.fromCharCode(65 + ((resto - 1) % 26)) + letras;
  }
  return letras;
}

/** «566-A»: el número base, sin ceros a la izquierda, y la letra del ejemplar. */
export function formatearNumeroTicket({ numero, ejemplar }: NumeroDeTicket): string {
  return `${numero}-${letraDeEjemplar(ejemplar)}`;
}

import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Un importe de una columna `Decimal(14,2)` a centavos enteros, sin pasar por `number` ni por un formato de texto. Es la misma cuenta que `centavosDeDecimal` de `server/persistencia/caja/caja.ts`: una lectura no puede importar de la persistencia
 * (regla `lecturas-capa`), así que vive acá, junto a las lecturas de la caja.
 */
export function centavosDeDecimal(d: Prisma.Decimal): bigint {
  return BigInt(d.mul(100).toDecimalPlaces(0).toString());
}

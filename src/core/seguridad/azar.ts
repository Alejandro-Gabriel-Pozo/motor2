/**
 * Puerto de ALEATORIEDAD (Pureza 1.5). El dominio nunca llama a un generador de azar por su cuenta (`randomBytes`, `randomInt`, `randomUUID`, `Math.random`):
 * recibe una `FuenteDeAzar`. Así sus funciones son deterministas (un test pasa una fuente fija) y el único lugar que conoce el generador criptográfico real es el
 * adaptador `src/lib/azar.ts`. Toda necesidad de azar del núcleo (tokens, códigos, secretos, vectores de inicialización, nonces, códigos de producto) entra por acá.
 */
export interface FuenteDeAzar {
  /** `cantidad` bytes criptográficamente aleatorios. */
  bytes(cantidad: number): Uint8Array;
  /** Entero uniforme en [minimo, maximoExclusivo). */
  entero(minimo: number, maximoExclusivo: number): number;
  /** UUID v4. */
  uuid(): string;
}

/** Un número en [0, 1) a partir del puerto (para el jitter de la espera entre reintentos): `entero / 1.000.000`. */
export function numeroEnUnidad(azar: FuenteDeAzar): number {
  return azar.entero(0, 1_000_000) / 1_000_000;
}

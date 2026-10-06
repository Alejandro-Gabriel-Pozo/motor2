import { revalidatePath } from "next/cache";

/**
 * Invalida el caché (ISR, `revalidate = 300`) de las cartas públicas tras una mutación del módulo carta (ADR-006, Fase 4):
 * sin esto, un cambio hecho desde el admin tardaría hasta 5 minutos en verse en `/carta-publica/<empresa>/<sucursal>`.
 * Con un segmento dinámico el segundo argumento es obligatorio; se invalida la página de TODAS las sucursales (una mutación
 * de carta rara vez afecta a más de una, y no hace falta averiguar cuál). La invalidación se aplica en la próxima visita.
 * El patrón lleva el route group `(carta-publica)` (es la estructura de archivos, no la URL): sin él no invalida nada, en
 * silencio — lo cubre el e2e "aplicar y desaplicar el tema se ve al instante" (test/e2e/carta-tema-admin.spec.ts).
 *
 * Se llama justo antes del `ok(...)` de cada acción de `src/server/actions/carta/` que cambia lo que la carta muestra. Igual
 * que `refrescarVistaSiHaceFalta`, traga solo el error E263 (fuera de un contexto Next —Vitest llamando la acción directo—
 * `revalidatePath` lanza "static generation store missing") y deja pasar cualquier otro.
 *
 * Lo que la carta muestra de un producto (nombre, precio, disponibilidad) también se cambia desde el catálogo: `actualizarProducto`,
 * `sincronizarPrecioGrupoCarta`, `actualizarDisponibilidadProducto` y las de precio local también la llaman
 * (`test/carta/revalida-al-cambiar-el-catalogo.test.ts`). Un cambio por una vía que no la llame se ve dentro de los 5 minutos del `revalidate`.
 */
export function revalidarCartasPublicas(): void {
  try {
    revalidatePath("/(carta-publica)/carta-publica/[empresa]/[sucursal]", "page");
  } catch (e) {
    const codigo = e instanceof Error ? (e as Error & { __NEXT_ERROR_CODE?: string }).__NEXT_ERROR_CODE : undefined;
    if (codigo === "E263") return;
    throw e;
  }
}

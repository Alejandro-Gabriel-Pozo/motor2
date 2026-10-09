import { revalidateTag } from "next/cache";
import { etiquetaDeCacheDeCartasPublicas } from "@/core/carta/public";

/**
 * Invalida el caché (ISR, `revalidate = 300`) de las cartas públicas DE UNA EMPRESA tras una mutación del módulo carta (ADR-006, Fase 4): sin esto, un cambio hecho
 * desde el admin tardaría hasta 5 minutos en verse en `/carta-publica/<empresa>/<sucursal>`. Se invalida la página de TODAS las sucursales de ESA empresa (una mutación de
 * carta rara vez afecta a más de una, y no hace falta averiguar cuál) y de ninguna otra: S-26 del plan de endurecimiento de seguridad. La invalidación se aplica en la próxima visita.
 *
 * El parámetro es obligatorio a propósito (`ctx.empresaSlug`): una invalidación sin empresa es la global de antes, que una mutación de A le hacía pagar a las cartas de B (el
 * compilador la rechaza, y `test/arquitectura/carta-publica-lista-cerrada.test.ts` prohíbe volver a `revalidatePath` sobre el patrón `[empresa]`). Se invalida por ETIQUETA
 * (`etiquetaDeCacheDeCartasPublicas`, la misma con que `server/carta-publica/sin-sesion.ts` marca la carta de cada empresa) y no por ruta: ver el porqué en esa función.
 * Con `{ expire: 0 }` la página vieja no se sirve ni un pedido más (la página regenera en esa misma visita).
 *
 * Se llama justo antes del `ok(...)` de cada acción de `src/server/actions/carta/` que cambia lo que la carta muestra. Igual
 * que `refrescarVistaSiHaceFalta`, traga solo el error E263 (fuera de un contexto Next —Vitest llamando la acción directo—
 * `revalidateTag` lanza "static generation store missing") y deja pasar cualquier otro.
 *
 * Lo que la carta muestra de un producto (nombre, precio, disponibilidad) también se cambia desde el catálogo: `actualizarProducto`,
 * `sincronizarPrecioGrupoCarta`, `actualizarDisponibilidadProducto` y las de precio local también la llaman
 * (`test/carta/revalida-al-cambiar-el-catalogo.test.ts`). Un cambio por una vía que no la llame se ve dentro de los 5 minutos del `revalidate`.
 */
export function revalidarCartasPublicas(empresaSlug: string): void {
  try {
    revalidateTag(etiquetaDeCacheDeCartasPublicas(empresaSlug), { expire: 0 });
  } catch (e) {
    const codigo = e instanceof Error ? (e as Error & { __NEXT_ERROR_CODE?: string }).__NEXT_ERROR_CODE : undefined;
    if (codigo === "E263") return;
    throw e;
  }
}

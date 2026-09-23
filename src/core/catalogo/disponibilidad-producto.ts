/**
 * Disponibilidad de un producto del Catálogo Central EN UNA SUCURSAL (docs/plan-disponibilidad-por-sucursal-2026-09-23.md).
 * Reemplaza el booleano GLOBAL `Producto.activo`, que sacaba un producto de TODO el negocio de una vez — el producto en sí
 * (nombre, código, unidad, receta, precio de lista) sigue siendo central y compartido, lo único que se vuelve local es "¿se usa
 * acá?".
 *
 * FILA AUSENTE = NO DISPONIBLE. Es lo contrario al criterio de PrecioLocalProducto/StockMinimoProducto/FrecuenciaConteoProducto
 * (donde "no hay fila" = valor por defecto benigno) y es a propósito: un producto dado de alta SIN el tilde "Activo en todas las
 * sucursales" no tiene que aparecer en las demás hasta que un admin de ESA sucursal lo active ahí a mano — eso solo se cumple si
 * la ausencia significa "no". `disponible: false` y "sin fila" significan lo mismo para el sistema: las funciones de acá abajo
 * son el ÚNICO lugar que colapsa esa equivalencia, para que no haya un segundo criterio escrito a mano en otra pantalla.
 *
 * Este módulo es puro (sin Prisma) para poder testearlo sin base — la capa de consulta (P3) vive en el mismo archivo pero se
 * agrega después, sin tocar esto.
 */

export interface FilaDisponibilidad {
  disponible: boolean;
}

export interface FilaDisponibilidadEnSucursal extends FilaDisponibilidad {
  sucursalId: string;
}

/** Fila ausente (undefined/null) = NO disponible. `disponible: false` es lo mismo para el sistema — esto es lo único que lo decide. */
export function resolverDisponibilidad(fila: FilaDisponibilidad | null | undefined): boolean {
  return fila?.disponible === true;
}

/** Por sucursal, a partir de las filas de UN producto. Toda sucursal de `sucursalIds` sin fila propia cae en `false`. */
export function resolverDisponibilidadPorSucursal(filas: readonly FilaDisponibilidadEnSucursal[], sucursalIds: readonly string[]): Map<string, boolean> {
  const porSucursal = new Map(filas.map((f) => [f.sucursalId, f.disponible]));
  return new Map(sucursalIds.map((id) => [id, porSucursal.get(id) === true]));
}

/** "Inactivo en todas" ≡ el `activo: false` global de antes (decisión 1 del plan) — ninguna fila en `true`. */
export function estaDisponibleEnAlguna(filas: readonly FilaDisponibilidad[]): boolean {
  return filas.some((f) => f.disponible === true);
}

/** Resumen para la ficha/lista de catálogo: "disponible en 2 de 4 sucursales". */
export function contarSucursalesDisponibles(filas: readonly FilaDisponibilidad[], totalSucursales: number): { disponibles: number; total: number } {
  return { disponibles: filas.filter((f) => f.disponible === true).length, total: totalSucursales };
}

/**
 * Productos "universales": disponibles en TODAS las `sucursalIdsActivas` dadas, sin excepción — decisión 4 del plan (dueño,
 * 2026-09-23): al dar de alta una sucursal nueva, arranca SOLO con estos, nunca con los que son mayoría pero no unanimidad.
 * Más estricto que "disponible en alguna": un producto activo en 2 de 3 sucursales NO es universal y no se contagia solo.
 *
 * `sucursalIdsActivas` vacío (la primerísima sucursal del sistema, sin ninguna otra activa antes) da SIEMPRE `[]` — no "todos"
 * por vacuidad lógica: no hay nada contra qué ser universal todavía, así que la sucursal nueva arranca en cero (ver test).
 */
export function productosUniversales(disponibilidadPorProducto: ReadonlyMap<string, readonly FilaDisponibilidadEnSucursal[]>, sucursalIdsActivas: readonly string[]): string[] {
  if (sucursalIdsActivas.length === 0) return [];
  const universales: string[] = [];
  for (const [productoId, filas] of disponibilidadPorProducto) {
    const porSucursal = resolverDisponibilidadPorSucursal(filas, sucursalIdsActivas);
    if (sucursalIdsActivas.every((id) => porSucursal.get(id) === true)) universales.push(productoId);
  }
  return universales;
}

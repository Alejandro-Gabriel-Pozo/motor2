import { ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE, claveEnCatalogo } from "./acciones";

// Las reglas PURAS de las capacidades por sucursal (la decisión). El LECTOR que trae las filas de `CapacidadSucursal` (`sucursalTieneCapacidad`, `capacidadesDeSucursal`) vive en
// `server/acceso/capacidades-sucursal.ts` desde el Hito 5 (pieza 5.2, bloque 2, 4A-5): lo usan el gate y el precio local de la carta pública, y este archivo ya no conoce la base (P0).

export function esCapacidadSiempreHabilitada(accionClave: string): boolean {
  return accionClave === "capacidades_sucursal" || (ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE as readonly string[]).includes(accionClave);
}

/** Regla de una acción, dadas sus filas candidatas (la de la sucursal y/o la «default»). */
export function resolverCapacidad(candidatas: Array<{ sucursalId: string | null; habilitado: boolean }>, sucursalId: string | null): boolean {
  const especifica = candidatas.find((c) => c.sucursalId === sucursalId);
  if (especifica) return especifica.habilitado;

  // Fila "default" (sucursalId NULL) — a lo sumo una por acción, lo
  // garantiza un índice único parcial en la migración (Postgres no lo
  // garantiza solo con una columna nullable dentro de un @@unique
  // compuesto).
  const porDefecto = candidatas.find((c) => c.sucursalId === null);

  // Sin ninguna fila configurada = habilitado (Sucursales.js:621: "si no
  // hay fila para esta acción, se puede").
  return porDefecto ? porDefecto.habilitado : true;
}

/** Una fila de `CapacidadSucursal` en lo único que usa la regla: de qué acción, de qué sucursal (`null` = el Default) y si está habilitada. */
export interface FilaDeCapacidad {
  accionClave: string;
  sucursalId: string | null;
  habilitado: boolean;
}

/**
 * Lo que la pantalla «Capacidades por sucursal» tiene que mostrar en una celda: el valor EFECTIVO (el mismo que decide el acceso, porque sale de `resolverCapacidad` y de
 * `esCapacidadSiempreHabilitada`, no de una copia) y si la sucursal lo HEREDA del Default (no tiene fila propia y el Default sí tiene fila). `sucursalId: null` es la
 * columna Default: muestra su fila, o «habilitado» si no hay, y nunca hereda.
 */
export interface CapacidadEfectiva {
  habilitado: boolean;
  heredaDelDefault: boolean;
}

export function capacidadEfectiva(accionClave: string, filas: readonly FilaDeCapacidad[], sucursalId: string | null): CapacidadEfectiva {
  const deLaAccion = filas.filter((f) => f.accionClave === accionClave);
  const habilitado = esCapacidadSiempreHabilitada(accionClave) || resolverCapacidad(deLaAccion, sucursalId);
  const heredaDelDefault = sucursalId !== null && !deLaAccion.some((f) => f.sucursalId === sucursalId) && deLaAccion.some((f) => f.sucursalId === null);
  return { habilitado, heredaDelDefault };
}

/**
 * Las acciones que la pantalla de capacidades deja tocar (poda aprobada por el dueño el 2026-11-06, «los interruptores muertos hay que ocultarlos»): las que el acceso da
 * SIEMPRE por habilitadas (`esCapacidadSiempreHabilitada`: `capacidades_sucursal` y las claves de gobierno de accesos) no cambian nada al apagarlas, así que no se listan. Es la MISMA
 * marca que usa el acceso, no una lista aparte. Las claves que ya no están en el catálogo (restos de la base) tampoco se listan.
 */
export function accionesConfigurablesPorSucursal<T extends { clave: string }>(acciones: readonly T[]): T[] {
  return acciones.filter((a) => claveEnCatalogo(a.clave) && !esCapacidadSiempreHabilitada(a.clave));
}

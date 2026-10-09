import { ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE } from "./acciones";

// Las reglas PURAS de las capacidades por sucursal (la decisión). El LECTOR que trae las filas de `CapacidadSucursal` (`sucursalTieneCapacidad`, `capacidadesDeSucursal`) vive en
// `server/acceso/capacidades-sucursal.ts` desde el Hito 5 (pieza 5.2, bloque 2, 4A-5): lo usan el gate y el precio local de la carta pública, y este archivo ya no conoce la base (P0).

export function esCapacidadSiempreHabilitada(accionClave: string): boolean {
  return accionClave === "capacidades_sucursal" || (ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE as readonly string[]).includes(accionClave);
}

/** Regla de una acción, dadas sus filas candidatas (la de la sucursal y/o la «default»). */
export function resolverCapacidad(candidatas: Array<{ sucursalId: string | null; habilitado: boolean }>, sucursalId: string): boolean {
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

import "server-only";
import { cargarSelectorCartaPos } from "@/server/lecturas/pos/selector-carta";
import type { Db } from "@/lib/db-tipos";

/**
 * El selector de carta del POS para tomar pedido (lo que se ofrece en la sucursal, con el precio vigente y sus descuentos). La lectura (`server/lecturas/pos/selector-carta.ts`) la comparte
 * con `promo-para-agregar`, que usa una acción; la pantalla de la mesa pide a esta consulta y no importa `server/lecturas` (regla `paginas-solo-consultas`, ADR-026). Mismo resultado que la
 * lectura. Sin guarda de permiso adentro: la página la pone antes. `ahora` obligatorio (O.22-c): lo fija la pantalla de la mesa, en el borde.
 *
 * GO-3b (ADR-032): con la `zonaHoraria` de la empresa (que ya no se usa para nada más: la poda 2026-11-13 sacó la vigencia y el menú del día) el selector ofrece también los combos con cupos de
 * entradas (lista). La pantalla de la mesa la pasa siempre.
 */
export function cargarSelectorCartaDeLaMesa(sucursalId: string, db: Db, ahora: Date, zonaHoraria?: string) {
  return cargarSelectorCartaPos(sucursalId, db, ahora, undefined, undefined, zonaHoraria !== undefined);
}

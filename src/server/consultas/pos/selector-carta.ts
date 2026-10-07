import "server-only";
import { cargarSelectorCartaPos } from "@/server/lecturas/pos/selector-carta";
import type { Db } from "@/lib/db-tipos";

/**
 * El selector de carta del POS para tomar pedido (lo que se ofrece en la sucursal, con el precio vigente y sus descuentos). La lectura (`server/lecturas/pos/selector-carta.ts`) la comparte
 * con `promo-para-agregar`, que usa una acción; la pantalla de la mesa pide a esta consulta y no importa `server/lecturas` (regla `paginas-solo-consultas`, ADR-026). Mismo resultado que la
 * lectura. Sin guarda de permiso adentro: la página la pone antes.
 */
export function cargarSelectorCartaDeLaMesa(sucursalId: string, db: Db) {
  return cargarSelectorCartaPos(sucursalId, db);
}

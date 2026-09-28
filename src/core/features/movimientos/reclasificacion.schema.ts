import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «reclasificar stock» (Task #41, Fase M, M13d — docs/arquitectura-casos-de-uso-2026-09-27.md): el comando y el
 * resultado del caso de uso de `src/server/actions/stock/casos-de-uso/reclasificar-stock.ts`. Vive en `core/features/movimientos/`
 * (mismo dominio que `movimiento.schema.ts` — RECLASIFICACION es un proceso más del enum `Proceso`), pero es un caso de uso PROPIO: no
 * reutiliza `ProcesoGenerico`/`DatosMovimientoInput` de M13a-c (entrada, permiso, validación y escritura son todos distintos — un
 * producto, un origen, N destinos, la regla "la suma de destinos es exactamente el saldo disponible").
 */

/** Un destino de la reclasificación: a qué sección (y opcionalmente qué lote) entra cuánto. */
export interface DestinoReclasificacion {
  seccionId: string;
  loteVencimiento?: Date | null;
  cantidad: number;
}

/**
 * Comando «reclasificar stock»: lo que recibe `reclasificarStockCasoDeUso`, YA validado por `guardComandoReclasificarStock` (formato:
 * producto, sección de origen, destinos no vacíos, clave I3, sección de cada destino). El chequeo "único destino idéntico al origen"
 * NO es parte del guard (necesita comparar contra el origen recién resuelto, y por orden de mensajes corre DESPUÉS de que el caso de uso
 * confirma que las secciones son de la sucursal de quien llama) — vive en el caso de uso.
 */
export interface ComandoReclasificarStock {
  productoId: string;
  seccionOrigenId: string;
  loteOrigen?: Date | null;
  destinos: DestinoReclasificacion[];
  fecha: Date;
  detalle?: string;
  /** I3 — UUID generado por el cliente al abrir el formulario, reenviado tal cual en reintentos. Opcional durante el rollout (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §9.3). */
  claveIdempotencia?: string;
}

/** Por qué no se pudo reclasificar (un formato inválido lo rechaza antes el guard). */
export type CodigoReclasificarStock =
  | "CONFLICTO_IDEMPOTENCIA"
  | "SECCION_ORIGEN_NO_ENCONTRADA"
  | "SECCION_DESTINO_NO_ENCONTRADA"
  | "DESTINO_IDENTICO_AL_ORIGEN"
  | "PRODUCTO_NO_ENCONTRADO"
  | "PRODUCTO_NO_DISPONIBLE"
  | "CANTIDAD_INVALIDA"
  | "SUMA_NO_COINCIDE"
  | "SIN_SALDO";

/**
 * `datos` de una reclasificación exitosa — discriminado por `repetida` (backlog post-cierre de Task #41, 2026-09-28,
 * docs/pendientes-sesion-2026-09-27.md §3): mismo criterio que `DatosRegistrarMovimiento` — con campos independientemente nullable,
 * `{ operacionId: "x", disponible: 5, destinosCantidad: 2, repetida: true }` tipaba bien aunque fuera contradictorio (el camino de
 * idempotencia "duplicado" nunca vuelve a escribir nada). La unión discriminada lo hace un error de compilación.
 */
export type DatosReclasificarStock =
  | { repetida: true; operacionId: null; disponible: null; destinosCantidad: null }
  | { repetida: false; operacionId: string; disponible: number; destinosCantidad: number };

export type ResultadoReclasificarStock = ResultadoCaso<DatosReclasificarStock, CodigoReclasificarStock>;

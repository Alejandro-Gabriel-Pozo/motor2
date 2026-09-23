/**
 * Semilla de los catálogos de Motivo de Merma y Destino de Consumo (mismo rol que `acciones.ts`: única fuente de verdad
 * de los valores iniciales) — plan "motivos de Consumo/Merma como catálogo administrable" (agente de planificación,
 * 2026-09-23), P2. Consumida por `prisma/seed.ts`, el backfill de la migración expand (P3) y los fixtures de test
 * (`test/setup/test-db.ts`, `test/e2e/fixtures/auth.ts`).
 *
 * Los `nombre` son EXACTAMENTE los labels de hoy (`MOTIVOS_MERMA`/`DESTINOS_CONSUMO`, `ui-config.ts`) — la migración a
 * catálogo administrable no cambia nada visible para quien ya usa el sistema, solo deja de estar fijo en un enum.
 */

export interface MotivoSemilla {
  nombre: string;
  descripcion?: string;
}

export const MOTIVOS_MERMA_SEMILLA: readonly MotivoSemilla[] = [
  { nombre: "Vencido" },
  { nombre: "Roto o caído" },
  { nombre: "Mal preparado / quemado" },
  {
    nombre: "Devolución de cliente (no revendible)",
    // Nombre aclarado a propósito (BUGFIX A-3, AUDITORIA-movimientos.md — la nota vivía en el docstring del enum viejo,
    // MotivoMerma en schema.prisma, y se traslada acá para no perderse al migrar).
    descripcion:
      "Devuelto por el cliente pero NO revendible: descuenta stock de verdad. Si la mercadería vuelve en condiciones de revenderse, va por el proceso «Devolución de cliente (revendible)», que SUMA stock — nunca por este motivo.",
  },
  { nombre: "Robo o faltante" },
  { nombre: "Otro" },
] as const;

export const DESTINOS_CONSUMO_SEMILLA: readonly MotivoSemilla[] = [
  { nombre: "Personal" },
  { nombre: "Degustación / cortesía" },
  { nombre: "Evento" },
  { nombre: "Elaboración interna" },
  { nombre: "Otro" },
] as const;

/**
 * Valor crudo del enum viejo `MotivoMerma` (renombrado `MotivoMermaLegacy` en la migración expand P3, dropeado en la
 * migración contract P8 — plan "motivos de Consumo/Merma como catálogo administrable", 2026-09-23) → `nombre` de la
 * fila equivalente en la tabla `MotivoMerma`. Usado por el backfill SQL de ambas migraciones (P3 y P8) y, ya sin el
 * enum, sigue vivo como la tabla de traducción que usa `scripts/seed-demo-pizzeria-6-meses.ts` para resolver
 * `EventoMerma.motivo` (guion.ts, que sigue identificando un motivo con este mismo código corto) a un motivoId real.
 */
export const EQUIVALENCIA_MOTIVO_MERMA_LEGACY: Readonly<Record<string, string>> = {
  VENCIDO: "Vencido",
  ROTO_O_CAIDO: "Roto o caído",
  MAL_PREPARADO_O_QUEMADO: "Mal preparado / quemado",
  DEVOLUCION_CLIENTE_NO_REVENDIBLE: "Devolución de cliente (no revendible)",
  ROBO_O_FALTANTE: "Robo o faltante",
  OTRO: "Otro",
};

/**
 * Igual que `EQUIVALENCIA_MOTIVO_MERMA_LEGACY`, para el enum viejo `DestinoConsumo` → la tabla `DestinoConsumo`. Sin
 * consumidor propio hoy (guion.ts no tiene todavía un `EventoConsumo` con destino) — se conserva por simetría con la
 * de Merma, para cuando lo tenga.
 */
export const EQUIVALENCIA_DESTINO_CONSUMO_LEGACY: Readonly<Record<string, string>> = {
  PERSONAL: "Personal",
  DEGUSTACION_CORTESIA: "Degustación / cortesía",
  EVENTO: "Evento",
  ELABORACION_INTERNA: "Elaboración interna",
  OTRO: "Otro",
};

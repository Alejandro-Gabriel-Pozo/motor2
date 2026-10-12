import type { NivelDePureza, SenalesDeFuente } from "../../scripts/arquitectura/analizar-fuente";

/**
 * Pureza HEREDADA del núcleo (Fase 0 del plan de pureza, PR 0.5): los archivos de `src/core/` que hoy NO son P0, uno por uno, con lo que los ensucia y
 * en qué fase del plan se limpian. Es la deuda, escrita y vigilada, no un baseline silencioso:
 *  - todo archivo de `src/core/` que NO figure acá tiene que ser P0 (lo nuevo nace puro);
 *  - un archivo de la lista no puede EMPEORAR (otro nivel peor, o una señal de impureza que no tenía);
 *  - si MEJORA, el test falla hasta que se actualice la entrada (o se la saque si llegó a P0): así cada mejora queda fijada y la lista solo se achica.
 * Generada de `npm run inventario:arquitectura -- --detalle` el 2026-10-06 (sobre main 9f370c0). VACÍA desde la Fase 6, tramo 6b (2026-10-11): todo `src/core/` es P0
 * (el tramo 6a sacó la sesión a `server/sesion`; el 6b, los tipos de Prisma y la factura autorizada). Queda el tipo y la lista vacía para que la regla siga leyéndose igual.
 */
export interface EntradaDePurezaHeredada {
  nivel: Exclude<NivelDePureza, "P0">;
  senales: (keyof SenalesDeFuente)[];
  pendiente: string;
}

export const PUREZA_HEREDADA_DEL_NUCLEO: Record<string, EntradaDePurezaHeredada> = {};

import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «resolver un conteo pendiente» (Task #41, Fase M, M13e2 — docs/arquitectura-casos-de-uso-2026-09-27.md). Cierra
 * un conteo que quedó PENDIENTE (accion FALTA_MOVIMIENTO): 'resuelto' si el movimiento que faltaba ya se cargó (el stock se corrigió
 * solo, no hay nada más que hacer acá) o 'ajustar' si se buscó y no apareció (se ajusta contra el saldo de HOY, no el del día del
 * conteo — entre medio pudo haber más movimientos).
 *
 * El formato lo valida `guardComandoResolverConteo` (`resolver-conteo.guard.ts`): el tipo `ComoResolverConteo` solo acota en tiempo de
 * compilación, y un POST crudo con otro valor caía en la rama «ajustar» y escribía un movimiento de stock. Todo lo demás (el conteo
 * existe, es de esta sucursal, está PENDIENTE, el producto sigue en el catálogo) depende de datos de base y se queda en el caso de uso
 * (`casos-de-uso/resolver-conteo-pendiente.ts`).
 */
export type ComoResolverConteo = "resuelto" | "ajustar";

/** Comando «resolver un conteo pendiente»: lo que valida `guardComandoResolverConteo` antes de abrir la transacción. */
export interface ComandoResolverConteo {
  conteoId: string;
  comoResolver: ComoResolverConteo;
}

/** Por qué no se pudo resolver el conteo. */
export type CodigoResolverConteo = "CONTEO_NO_ENCONTRADO" | "CONTEO_NO_PENDIENTE" | "PRODUCTO_NO_ENCONTRADO";

/** `datos` de un conteo resuelto con éxito. */
export interface DatosResolverConteo {
  /** true si se escribió un ajuste de Kardex (rama 'ajustar' con diferencia != 0) — false si solo se cerró (rama 'resuelto' o diferencia 0). */
  ajustado: boolean;
}

export type ResultadoResolverConteo = ResultadoCaso<DatosResolverConteo, CodigoResolverConteo>;

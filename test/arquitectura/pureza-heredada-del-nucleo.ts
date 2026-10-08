import type { NivelDePureza, SenalesDeFuente } from "../../scripts/arquitectura/analizar-fuente";

/**
 * Pureza HEREDADA del núcleo (Fase 0 del plan de pureza, PR 0.5): los archivos de `src/core/` que hoy NO son P0, uno por uno, con lo que los ensucia y
 * en qué fase del plan se limpian. Es la deuda, escrita y vigilada, no un baseline silencioso:
 *  - todo archivo de `src/core/` que NO figure acá tiene que ser P0 (lo nuevo nace puro);
 *  - un archivo de la lista no puede EMPEORAR (otro nivel peor, o una señal de impureza que no tenía);
 *  - si MEJORA, el test falla hasta que se actualice la entrada (o se la saque si llegó a P0): así cada mejora queda fijada y la lista solo se achica.
 * Generada de `npm run inventario:arquitectura -- --detalle` el 2026-10-06 (sobre main 9f370c0).
 */
export interface EntradaDePurezaHeredada {
  nivel: Exclude<NivelDePureza, "P0">;
  senales: (keyof SenalesDeFuente)[];
  pendiente: string;
}

export const PUREZA_HEREDADA_DEL_NUCLEO: Record<string, EntradaDePurezaHeredada> = {
  "src/core/auth/base.ts": { nivel: "P3", senales: ["prismaDeTipo", "importaCliente", "escribeEnLaBase", "entorno"], pendiente: "Fase 6: no escribe datos (el único $executeRaw es el set_config local a la transacción): es infraestructura de la base por empresa; sale UNA vez a server/sesion junto con contexto y rol-de-ejecucion, sin tocar su código (todas las listas de seguridad que la nombran cambian en el mismo commit)" },
  "src/core/auth/contexto.ts": { nivel: "P4", senales: ["serverOnly", "reactONext", "leeLaBase", "entorno"], pendiente: "Fase 6: pasa a server/sesion (depende de server-only, React o Next)" },
  "src/core/auth/ir-al-login.ts": { nivel: "P4", senales: ["reactONext"], pendiente: "Fase 6: pasa a server/sesion (depende de server-only, React o Next)" },
  "src/core/auth/rol-de-ejecucion.ts": { nivel: "P3", senales: ["prismaDeTipo", "leeLaBase"], pendiente: "Fase 6: lo importa solo auth/base.ts (infraestructura de sesión): no puede salir antes que él, se muda con server/sesion" },
  "src/core/auth/session.ts": { nivel: "P4", senales: ["serverOnly", "reactONext"], pendiente: "Fase 6: pasa a server/sesion (depende de server-only, React o Next)" },
  "src/core/carta/promo-sucursal.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/catalogo/filtro-selector-producto.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/catalogo/receta-a-input.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/catalogo/recetas-vigentes.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: las reglas puras (alcance, quedarseConLaVigente, whereConReceta, incluirRecetaVigente) usan tipos de Prisma en la firma (Prisma.RecetaVersionInclude…); pasan a tipos de dominio propios" },
  "src/core/features/movimientos/conteo-fisico.guard.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/features/movimientos/conteo-fisico.schema.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/features/movimientos/movimiento.schema.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/features/traspasos/traspaso.guard.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/features/traspasos/traspaso.schema.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/fiscal/factura-autorizada.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/movimientos/anulaciones.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/movimientos/armar-filas-de-movimiento.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/movimientos/public.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/movimientos/transiciones.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/movimientos/ui-config.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/reportes/historial-producto.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: los tipos de Prisma se reemplazan por tipos de dominio propios" },
  "src/core/reportes/historial-vistas.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/reportes/margen-real.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/reportes/periodo-tipos.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/stock/seccion-habitual.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
};

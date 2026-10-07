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
  "src/core/auth/acceso.ts": { nivel: "P3", senales: ["importaCliente", "leeLaBase", "reloj", "entorno"], pendiente: "Fase 6: es login, base e infraestructura de sesión (lo usa solo lib/auth.ts): se muda entero a server/sesion con auth/base y auth/contexto" },
  "src/core/auth/base.ts": { nivel: "P3", senales: ["prismaDeTipo", "importaCliente", "escribeEnLaBase", "entorno"], pendiente: "Fase 4: la escritura sale a un caso de uso (server/persistencia); el cálculo queda puro" },
  "src/core/auth/contexto.ts": { nivel: "P4", senales: ["serverOnly", "reactONext", "leeLaBase", "entorno"], pendiente: "Fase 6: pasa a server/sesion (depende de server-only, React o Next)" },
  "src/core/auth/invitacion.ts": { nivel: "P3", senales: ["leeLaBase", "escribeEnLaBase", "reloj"], pendiente: "Fase 4: la escritura sale a un caso de uso (server/persistencia); el cálculo queda puro" },
  "src/core/auth/ir-al-login.ts": { nivel: "P4", senales: ["reactONext"], pendiente: "Fase 6: pasa a server/sesion (depende de server-only, React o Next)" },
  "src/core/auth/rol-de-ejecucion.ts": { nivel: "P3", senales: ["prismaDeTipo", "leeLaBase"], pendiente: "Fase 6: lo importa solo auth/base.ts (infraestructura de sesión): no puede salir antes que él, se muda con server/sesion" },
  "src/core/auth/session.ts": { nivel: "P4", senales: ["serverOnly", "reactONext"], pendiente: "Fase 6: pasa a server/sesion (depende de server-only, React o Next)" },
  "src/core/carta/promo-sucursal.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/catalogo/disponibilidad-producto-consulta.ts": { nivel: "P3", senales: ["prismaDeTipo", "leeLaBase"], pendiente: "Fase 4: lo usan core/movimientos/registrar-venta (la venta, dentro de su transacción SERIALIZABLE) y los cargadores de core/reportes/comun: salen cuando la venta pase a caso de uso" },
  "src/core/catalogo/filtro-selector-producto.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/catalogo/precio-local-consulta.ts": { nivel: "P3", senales: ["prismaDeTipo", "leeLaBase"], pendiente: "Fase 4: lo usan core/movimientos/precio-venta (la venta) y core/reportes/comun: salen cuando la venta pase a caso de uso; entonces también pasa a server/acceso el lector de capacidades" },
  "src/core/catalogo/receta-a-input.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/catalogo/recetas-vigentes.ts": { nivel: "P3", senales: ["prismaDeTipo", "leeLaBase"], pendiente: "Fase 4: es el embudo de recetas que usa core/movimientos/registrar-venta dentro de la transacción de la venta (y core/reportes/comun): sale cuando la venta pase a caso de uso" },
  "src/core/features/empresa/aceptar-invitacion-de-usuario.ts": { nivel: "P3", senales: ["prismaDeTipo", "leeLaBase", "escribeEnLaBase"], pendiente: "Fase 4: la escritura sale a un caso de uso (server/persistencia); el cálculo queda puro" },
  "src/core/features/empresa/aceptar-invitacion.ts": { nivel: "P3", senales: ["prismaDeTipo", "leeLaBase", "escribeEnLaBase"], pendiente: "Fase 4: la escritura sale a un caso de uso (server/persistencia); el cálculo queda puro" },
  "src/core/features/empresa/invitacion-de-usuario.ts": { nivel: "P3", senales: ["prismaDeTipo", "leeLaBase", "escribeEnLaBase"], pendiente: "Fase 4: la escritura sale a un caso de uso (server/persistencia); el cálculo queda puro" },
  "src/core/features/movimientos/conteo-fisico.guard.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/features/movimientos/conteo-fisico.schema.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/features/movimientos/movimiento.schema.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/features/traspasos/traspaso.guard.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/features/traspasos/traspaso.schema.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/fiscal/factura-autorizada.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/movimientos/anulaciones.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/movimientos/armar-filas-de-movimiento.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/movimientos/con-reintento.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/movimientos/precio-venta.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/movimientos/public.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/movimientos/transiciones.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/movimientos/ui-config.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/permisos/auditoria.ts": { nivel: "P3", senales: ["prismaDeTipo", "escribeEnLaBase"], pendiente: "Fase 4: la escritura sale a un caso de uso (server/persistencia); el cálculo queda puro" },
  "src/core/permisos/capacidades-sucursal.ts": { nivel: "P3", senales: ["prismaDeTipo", "leeLaBase"], pendiente: "Fase 4: su lectura la usa core/catalogo/precio-local-consulta (el embudo del precio local, de la venta); entonces pasa a server/acceso" },
  "src/core/permisos/gerencia.ts": { nivel: "P3", senales: ["prismaDeTipo", "leeLaBase", "escribeEnLaBase"], pendiente: "Fase 4: la escritura sale a un caso de uso (server/persistencia); el cálculo queda puro" },
  "src/core/permisos/gestion-de-usuarios.ts": { nivel: "P3", senales: ["prismaDeTipo", "leeLaBase"], pendiente: "Fase 4: son lecturas de decisión DENTRO de la transacción de escritura y las usan casos de uso de core/features/empresa; salen junto con esas escrituras" },
  "src/core/permisos/invariantes.ts": { nivel: "P3", senales: ["prismaDeTipo", "leeLaBase"], pendiente: "Fase 4: son lecturas de decisión DENTRO de la transacción de escritura y las usan casos de uso de core/features/empresa; salen junto con esas escrituras" },
  "src/core/reportes/comun.ts": { nivel: "P3", senales: ["prismaDeValor", "leeLaBase"], pendiente: "Fase 4: los cargadores de costos y catálogo los comparte registrar-venta (el costo congelado del Kardex, decisión D1 del dueño): salen cuando la venta pase a caso de uso" },
  "src/core/reportes/historial-producto.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: los tipos de Prisma se reemplazan por tipos de dominio propios" },
  "src/core/reportes/historial-vistas.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/reportes/margen-real.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/reportes/periodo-tipos.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
  "src/core/stock/seccion-habitual.ts": { nivel: "P1", senales: ["prismaDeTipo"], pendiente: "Fase 6: tipos de dominio propios en lugar de los de Prisma" },
};

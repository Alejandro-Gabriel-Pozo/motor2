/**
 * A qué panel del menú lateral pertenece un ítem (ADR-010): `empresa` (lo que afecta a toda la empresa: catálogo compartido, roles,
 * sucursales), `sucursal` (la operación de la sucursal activa: movimientos, stock, reportes, salón) o `ambos` (pantallas que tienen una
 * cara en cada panel y aparecen en los dos). Va en su propio archivo para que `core/movimientos/ui-config.ts` (que declara sus ítems del
 * menú) pueda usar el tipo sin importar `estructura.ts`, que a su vez importa a movimientos.
 */
export type PanelNav = "empresa" | "sucursal" | "ambos";

/** El panel que se está mostrando: nunca `ambos`. */
export type PanelActivo = Exclude<PanelNav, "ambos">;

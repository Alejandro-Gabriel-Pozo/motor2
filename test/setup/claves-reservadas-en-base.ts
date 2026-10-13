import type { NivelDeAccion } from "../../src/core/permisos/acciones";

/**
 * Las claves de permiso que una migración de datos da de alta en la BASE antes de que existan en el catálogo `ACCIONES` (src/core/permisos/acciones.ts): hoy las siete de los GASTOS (Paquete 3, M4.5; D1 y D4 del dueño).
 * El módulo `gastos` está «en desarrollo» y `test/arquitectura/acciones-con-modulo.test.ts` prohíbe acciones de un módulo en desarrollo; además la matriz de permisos las mostraría en todas las empresas. Entran a `ACCIONES` en la
 * Etapa C, con su guarda: ese día salen de esta lista (el guardián de paridad lo exige en las dos direcciones).
 *
 * Cada una lleva su descripción DEFINITIVA (la compara la paridad con la de la base, y después con la de `ACCIONES`), el contexto, el piso que va a tener y a quién se siembra. Las comparten `paridad-catalogo-migraciones.test.ts` y
 * `migracion-permisos-gastos.test.ts`.
 */
export interface ClaveReservadaEnBase {
  readonly descripcion: string;
  readonly contexto: "empresa" | "sucursal";
  readonly nivelMinimo: NivelDeAccion;
  /** Roles de sistema que la reciben de la migración (con Ver y Editar). Vacío = nadie. */
  readonly semilla: ReadonlyArray<"admin">;
}

const MOTIVO = "Paquete 3, M4.5: módulo `gastos` en desarrollo; entra a ACCIONES en la Etapa C, con su guarda (docs/adr/ADR-029-factura-de-proveedor-documento-de-empresa.md).";
export const MOTIVO_DE_LAS_RESERVADAS_EN_BASE = MOTIVO;

export const RESERVADAS_EN_BASE: Readonly<Record<string, ClaveReservadaEnBase>> = {
  gasto_ver: { descripcion: "Ver los gastos de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
  gasto_registrar: { descripcion: "Registrar un gasto en la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
  gasto_anular: { descripcion: "Anular un gasto de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
  gasto_reclasificar: { descripcion: "Reclasificar el tipo de costo de un gasto de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
  gasto_repartir: { descripcion: "Repartir un gasto entre sucursales", contexto: "empresa", nivelMinimo: "administrador", semilla: [] },
  conceptos_gasto: { descripcion: "Administrar el catálogo de conceptos de gasto", contexto: "empresa", nivelMinimo: "administrador", semilla: ["admin"] },
  reporte_gastos_empresa: { descripcion: "Ver el reporte de gastos de toda la empresa", contexto: "empresa", nivelMinimo: "administrador", semilla: ["admin"] },
};

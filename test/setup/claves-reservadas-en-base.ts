import type { NivelDeAccion } from "../../src/core/permisos/acciones";

/**
 * Las claves de permiso que una migración de datos da de alta en la BASE antes de que existan en el catálogo `ACCIONES` (src/core/permisos/acciones.ts): hoy las siete de los GASTOS (Paquete 3, M4.5; D1 y D4 del dueño) y las tres de
 * los CENTROS DE COSTOS (Paquete 5, M7.4). Cada una declara en `migracion` la carpeta de la migración que la da de alta (los tests de cada migración filtran por ahí).
 * Los módulos `gastos` y `centros_de_costos` están «en desarrollo» y `test/arquitectura/acciones-con-modulo.test.ts` prohíbe acciones de un módulo en desarrollo; además la matriz de permisos las mostraría en todas las empresas. Entran a
 * `ACCIONES` en la Etapa C, con su guarda: ese día salen de esta lista (el guardián de paridad lo exige en las dos direcciones).
 *
 * Cada una lleva su descripción DEFINITIVA (la compara la paridad con la de la base, y después con la de `ACCIONES`), el contexto, el piso que va a tener y a quién se siembra. Las comparten `paridad-catalogo-migraciones.test.ts` y
 * `migracion-permisos-gastos.test.ts` y `migracion-permisos-centros-de-costos.test.ts`.
 */
export interface ClaveReservadaEnBase {
  readonly descripcion: string;
  readonly contexto: "empresa" | "sucursal";
  readonly nivelMinimo: NivelDeAccion;
  /** Roles de sistema que la reciben de la migración (con Ver y Editar). Vacío = nadie. */
  readonly semilla: ReadonlyArray<"admin">;
  /** La carpeta de la migración de datos que da de alta la clave (la que la siembra). */
  readonly migracion: string;
}

const MOTIVO =
  "Paquete 3, M4.5: módulo `gastos` en desarrollo; entra a ACCIONES en la Etapa C, con su guarda (docs/adr/ADR-029-factura-de-proveedor-documento-de-empresa.md). Paquete 5, M7.4: módulo `centros_de_costos` en desarrollo; ídem (docs/adr/ADR-031-centros-de-costos-y-distribucion-por-versiones.md).";

const M4_5 = "20261016114000_permisos_gastos";
const M7_4 = "20261019103000_permisos_centros_de_costos";
export const MOTIVO_DE_LAS_RESERVADAS_EN_BASE = MOTIVO;

export const RESERVADAS_EN_BASE: Readonly<Record<string, ClaveReservadaEnBase>> = {
  gasto_ver: { descripcion: "Ver los gastos de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"], migracion: M4_5 },
  gasto_registrar: { descripcion: "Registrar un gasto en la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"], migracion: M4_5 },
  gasto_anular: { descripcion: "Anular un gasto de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"], migracion: M4_5 },
  gasto_reclasificar: { descripcion: "Reclasificar el tipo de costo de un gasto de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"], migracion: M4_5 },
  gasto_repartir: { descripcion: "Repartir un gasto entre sucursales", contexto: "empresa", nivelMinimo: "administrador", semilla: [], migracion: M4_5 },
  conceptos_gasto: { descripcion: "Administrar el catálogo de conceptos de gasto", contexto: "empresa", nivelMinimo: "administrador", semilla: ["admin"], migracion: M4_5 },
  reporte_gastos_empresa: { descripcion: "Ver el reporte de gastos de toda la empresa", contexto: "empresa", nivelMinimo: "administrador", semilla: ["admin"], migracion: M4_5 },
  centros_costos: { descripcion: "Administrar los planes y centros de costos de la empresa", contexto: "empresa", nivelMinimo: "administrador", semilla: ["admin"], migracion: M7_4 },
  distribucion_costos: { descripcion: "Distribuir los gastos de la sucursal entre centros de costos", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"], migracion: M7_4 },
  reporte_gastos_por_unidad: { descripcion: "Ver el reporte de gastos por unidad de negocio de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"], migracion: M7_4 },
};

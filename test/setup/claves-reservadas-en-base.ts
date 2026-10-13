import type { NivelDeAccion } from "../../src/core/permisos/acciones";

/**
 * Las claves de permiso que una migración de datos da de alta en la BASE antes de que existan en el catálogo `ACCIONES` (src/core/permisos/acciones.ts): hoy las siete de los GASTOS (Paquete 3, M4.5; D1 y D4 del dueño) y las tres de la
 * NOTA DE CRÉDITO DE PROVEEDOR (Paquete 4, M6.4; Decisión 3 del dueño). El módulo `gastos` está «en desarrollo» y `test/arquitectura/acciones-con-modulo.test.ts` prohíbe acciones de un módulo en desarrollo; además la matriz de permisos las
 * mostraría en todas las empresas. Entran a `ACCIONES` en la Etapa C, con su guarda: ese día salen de esta lista (el guardián de paridad lo exige en las dos direcciones).
 *
 * Cada una lleva su descripción DEFINITIVA (la compara la paridad con la de la base, y después con la de `ACCIONES`), el contexto, el piso que va a tener, a quién se siembra y la MIGRACIÓN que la da de alta: cada prueba de una migración de
 * permisos mira solo las claves de la suya (`clavesReservadasDe`). Las comparten `paridad-catalogo-migraciones.test.ts`, `migracion-permisos-gastos.test.ts`, `migracion-permisos-notas-de-credito.test.ts` y
 * `paquete-3-m4-subir-bajar-subir.test.ts`.
 */
export interface ClaveReservadaEnBase {
  /** La carpeta de la migración de datos que da de alta la clave. */
  readonly migracion: string;
  readonly descripcion: string;
  readonly contexto: "empresa" | "sucursal";
  readonly nivelMinimo: NivelDeAccion;
  /** Roles de sistema que la reciben de la migración (con Ver y Editar). Vacío = nadie. */
  readonly semilla: ReadonlyArray<"admin">;
}

const MOTIVO =
  "Paquete 3, M4.5 (los gastos) y Paquete 4, M6.4 (la nota de crédito de proveedor): la base las tiene desde su migración y entran a ACCIONES en la Etapa C, con su guarda (docs/adr/ADR-029-factura-de-proveedor-documento-de-empresa.md).";
export const MOTIVO_DE_LAS_RESERVADAS_EN_BASE = MOTIVO;

const GASTOS = "20261016114000_permisos_gastos";
const NOTAS_DE_CREDITO = "20261018103000_permisos_notas_de_credito";

export const RESERVADAS_EN_BASE: Readonly<Record<string, ClaveReservadaEnBase>> = {
  gasto_ver: { migracion: GASTOS, descripcion: "Ver los gastos de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
  gasto_registrar: { migracion: GASTOS, descripcion: "Registrar un gasto en la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
  gasto_anular: { migracion: GASTOS, descripcion: "Anular un gasto de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
  gasto_reclasificar: { migracion: GASTOS, descripcion: "Reclasificar el tipo de costo de un gasto de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
  gasto_repartir: { migracion: GASTOS, descripcion: "Repartir un gasto entre sucursales", contexto: "empresa", nivelMinimo: "administrador", semilla: [] },
  conceptos_gasto: { migracion: GASTOS, descripcion: "Administrar el catálogo de conceptos de gasto", contexto: "empresa", nivelMinimo: "administrador", semilla: ["admin"] },
  reporte_gastos_empresa: { migracion: GASTOS, descripcion: "Ver el reporte de gastos de toda la empresa", contexto: "empresa", nivelMinimo: "administrador", semilla: ["admin"] },
  nota_credito_proveedor: { migracion: NOTAS_DE_CREDITO, descripcion: "Registrar una nota de crédito de proveedor sobre mercadería de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
  gasto_nota_credito: { migracion: NOTAS_DE_CREDITO, descripcion: "Registrar una nota de crédito de proveedor sobre un gasto de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
  anular_nota_credito_proveedor: { migracion: NOTAS_DE_CREDITO, descripcion: "Anular una nota de crédito de proveedor de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
};

/** Las claves reservadas que da de alta UNA migración (por el nombre de su carpeta), ordenadas. */
export function clavesReservadasDe(migracion: string): string[] {
  return Object.keys(RESERVADAS_EN_BASE)
    .filter((c) => RESERVADAS_EN_BASE[c]!.migracion === migracion)
    .sort();
}

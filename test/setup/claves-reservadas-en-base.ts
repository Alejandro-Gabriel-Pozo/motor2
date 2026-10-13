import type { NivelDeAccion } from "../../src/core/permisos/acciones";

/**
 * Las claves de permiso que una migración de datos da de alta en la BASE antes de que existan en el catálogo `ACCIONES` (src/core/permisos/acciones.ts): hoy las siete de los GASTOS (Paquete 3, M4.5; D1 y D4 del dueño), las tres de la
 * NOTA DE CRÉDITO DE PROVEEDOR (Paquete 4, M6.4; Decisión 3 del dueño) y las tres de los CENTROS DE COSTOS (Paquete 5, M7.4). Los módulos `gastos` y `centros_de_costos` están «en desarrollo» y `test/arquitectura/acciones-con-modulo.test.ts` prohíbe acciones de un módulo en desarrollo; además la matriz de permisos las
 * mostraría en todas las empresas. Entran a `ACCIONES` en la Etapa C, con su guarda: ese día salen de esta lista (el guardián de paridad lo exige en las dos direcciones). Las tres de los GRUPOS DE OPCIONES DE VENTA (GO-1a) ya salieron: entraron a `ACCIONES` en GO-2a, con su guarda.
 *
 * Cada una lleva su descripción DEFINITIVA (la compara la paridad con la de la base, y después con la de `ACCIONES`), el contexto, el piso que va a tener, a quién se siembra y la MIGRACIÓN que la da de alta: cada prueba de una migración de
 * permisos mira solo las claves de la suya (`clavesReservadasDe`). Las comparten `paridad-catalogo-migraciones.test.ts`, `migracion-permisos-gastos.test.ts`, `migracion-permisos-notas-de-credito.test.ts`, `migracion-permisos-centros-de-costos.test.ts` y
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
  "Paquete 3, M4.5 (los gastos) y Paquete 4, M6.4 (la nota de crédito de proveedor): la base las tiene desde su migración y entran a ACCIONES en la Etapa C, con su guarda (docs/adr/ADR-029-factura-de-proveedor-documento-de-empresa.md). Paquete 5, M7.4: módulo `centros_de_costos` en desarrollo; ídem (docs/adr/ADR-031-centros-de-costos-y-distribucion-por-versiones.md). Las de GO-1a (los grupos de opciones de venta) ya NO están acá: entraron a ACCIONES en GO-2a, con su guarda (docs/adr/ADR-030-elemento-configurable-grupos-de-opciones.md).";
export const MOTIVO_DE_LAS_RESERVADAS_EN_BASE = MOTIVO;

const GASTOS = "20261016114000_permisos_gastos";
const NOTAS_DE_CREDITO = "20261018103000_permisos_notas_de_credito";
const CENTROS_DE_COSTOS = "20261019103000_permisos_centros_de_costos";

export const RESERVADAS_EN_BASE: Readonly<Record<string, ClaveReservadaEnBase>> = {
  ...reservadasDeGo3(),
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
  centros_costos: { migracion: CENTROS_DE_COSTOS, descripcion: "Administrar los planes y centros de costos de la empresa", contexto: "empresa", nivelMinimo: "administrador", semilla: ["admin"] },
  distribucion_costos: { migracion: CENTROS_DE_COSTOS, descripcion: "Distribuir los gastos de la sucursal entre centros de costos", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
  reporte_gastos_por_unidad: { migracion: CENTROS_DE_COSTOS, descripcion: "Ver el reporte de gastos por unidad de negocio de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] },
};

/** Las claves reservadas que da de alta UNA migración (por el nombre de su carpeta), ordenadas. */
export function clavesReservadasDe(migracion: string): string[] {
  return Object.keys(RESERVADAS_EN_BASE)
    .filter((c) => RESERVADAS_EN_BASE[c]!.migracion === migracion)
    .sort();
}

// GO-3 (ADR-032): las claves que dan de alta las migraciones de esquema de GO-3 (patrón GO-1a: viven en la base y entran a `ACCIONES` con su caso de uso, en GO-3 F3 y F4). Declarada como función (se
// iza) para dejar el bloque al final del archivo. `promo_menu_del_dia` es de clase O, delegable al encargado (D-5); `grupos_de_precio_definir`, de clase A.
function reservadasDeGo3(): Record<string, ClaveReservadaEnBase> {
  return {
    grupos_de_precio_definir: { migracion: "20261021110000_go3a_combinaciones", descripcion: "Definir las tarifas compartidas (grupos de precio) de las combinaciones", contexto: "empresa", nivelMinimo: "administrador", semilla: ["admin"] },
    promo_menu_del_dia: { migracion: "20261021100000_go3d_combos_y_menu_del_dia", descripcion: "Cargar el plato del día de los menús en la sucursal", contexto: "sucursal", nivelMinimo: "operario", semilla: ["admin"] },
  };
}

/** GO-3: el motivo de las claves reservadas de GO-3 (lo exige la paridad). */
export const MOTIVO_DE_LAS_RESERVADAS_DE_GO3 =
  "GO-3 (ADR-032): las claves del menú del día (GO-3d) y de los grupos de precio (GO-3a) las dan de alta las migraciones de esquema de GO-3 y entran a ACCIONES con su guarda y su caso de uso (GO-3 F3 y F4), cuando GO-2a y GO-2b ya estén fusionadas (docs/adr/ADR-032-combos-menu-del-dia-y-combinaciones.md).";

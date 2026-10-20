import type { DeclaracionDeAlcance } from "./clasificacion-de-tablas";

/**
 * Paquete 1, migraciones B1 a B6 (RLS por sucursal): sus carpetas y qué tablas lleva cada una. Lo comparten el guardián B7 (`test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts`)
 * y la prueba de subir/bajar/subir (`test/aislamiento/paquete-1-subir-bajar-subir.test.ts`).
 *
 * El SQL de cada migración sale SIEMPRE del generador (`politicas-de-alcance-de-sucursal.ts`): acá solo se reparten las tablas en grupos. Los padres de cada tabla HEREDADA van en el
 * mismo grupo que ella (Cuenta → Mesa, MovimientoStock → Seccion, Receta* → RecetaVersion), así ningún grupo depende de otro. La unión de los cinco grupos (el Paquete 1: 32 tablas, 128 políticas) más la de
 * `MIGRACIONES_DE_POLITICAS_POSTERIORES` tiene que ser EXACTAMENTE `TABLAS_CON_POLITICA_DE_SUCURSAL` (lo exige B7).
 *
 * Los tests del Paquete 1 que arman una base migrada hasta B1 (o hasta B6) usan `TABLAS_DEL_PAQUETE_1`, NO todo lo clasificado: una tabla con política que agregue una migración posterior no existe en esas bases.
 */

export const MIGRACION_B1_FUNCIONES = "20261014110000_rls_sucursal_b1_funciones";

export const MIGRACIONES_DE_POLITICAS_DE_SUCURSAL: readonly { readonly migracion: string; readonly tablas: readonly string[] }[] = [
  {
    migracion: "20261014120000_rls_sucursal_b2_configuracion",
    tablas: ["DisponibilidadProducto", "PrecioLocalProducto", "DescuentoProductoSucursal", "FrecuenciaConteoProducto", "StockMinimoProducto", "SeccionHabitualProducto", "RendimientoLocalIngrediente", "RecetaSucursal"],
  },
  {
    migracion: "20261014130000_rls_sucursal_b3_carta",
    tablas: ["ContenidoCartaProducto", "ItemAgrupadoCarta", "OpcionItemAgrupadoCarta", "GeneroCarta", "TemaCartaSucursal", "PromoCartaSucursal"],
  },
  {
    migracion: "20261014140000_rls_sucursal_b4_punto_de_venta",
    tablas: ["Mesa", "Cuenta", "CuentaItem", "PromoCuenta", "EjemplarTicket", "AgregadoDeCuenta"],
  },
  {
    migracion: "20261014150000_rls_sucursal_b5_stock_y_dinero",
    tablas: ["Seccion", "Operacion", "MovimientoStock", "ConteoFisico", "PagoConsignante", "TraspasoSucursal"],
  },
  {
    migracion: "20261014160000_rls_sucursal_b6_receta_y_auditoria",
    tablas: ["RecetaVersion", "RegistroAuditoria", "RecetaIngrediente", "RecetaPaso", "RecetaPasoIngrediente", "SustitutoRecetaIngrediente"],
  },
];

/** Las tablas del Paquete 1: la unión de los cinco grupos B2 a B6 (32 tablas, 128 políticas). Es lo único que existe con política en una base migrada hasta `ULTIMA_MIGRACION_DEL_PAQUETE_1`. */
export const TABLAS_DEL_PAQUETE_1: readonly string[] = MIGRACIONES_DE_POLITICAS_DE_SUCURSAL.flatMap((g) => g.tablas);

/** La última migración del Paquete 1 (B6). B7 exige que sea la del último grupo. */
export const ULTIMA_MIGRACION_DEL_PAQUETE_1 = "20261014160000_rls_sucursal_b6_receta_y_auditoria";

/**
 * Las migraciones POSTERIORES al Paquete 1 que crean políticas de alcance de sucursal (una tabla nueva con alcance: `Venta`, de M2-4, `FacturaProveedorSucursal`, de M3c, `ImputacionDeGasto`, de M4.4, `NotaCreditoProveedorImputacion`, de M6.2, `PlanDeCostosSucursal`, `DistribucionCostoVersion` y `DistribucionCostoLinea`, de M7.3, `OpcionApagadaEnSucursal` y `PrecioLocalDeOpcion`, de GO-1c, y `OpcionElegidaEnLinea`, de GO-1d), en el mismo formato que los grupos de arriba y en orden ascendente por nombre de migración.
 * B7 las suma a las que espera: cada una es el encabezado más la salida exacta del generador para sus tablas. Todas tienen que ser posteriores a `ULTIMA_MIGRACION_DEL_PAQUETE_1`.
 */
export const MIGRACIONES_DE_POLITICAS_POSTERIORES: readonly { readonly migracion: string; readonly tablas: readonly string[] }[] = [
  { migracion: "20261015123000_m2_rls_sucursal_venta", tablas: ["Venta"] },
  { migracion: "20261016102000_rls_sucursal_factura_proveedor_sucursal", tablas: ["FacturaProveedorSucursal"] },
  { migracion: "20261016113000_rls_sucursal_imputacion_de_gasto", tablas: ["ImputacionDeGasto"] },
  { migracion: "20261018101000_rls_sucursal_nota_credito_proveedor_imputacion", tablas: ["NotaCreditoProveedorImputacion"] },
  { migracion: "20261019102000_rls_sucursal_centros_de_costos", tablas: ["DistribucionCostoLinea", "DistribucionCostoVersion", "PlanDeCostosSucursal"] },
  { migracion: "20261020121000_go1c_rls_sucursal_opciones_por_sucursal", tablas: ["OpcionApagadaEnSucursal", "PrecioLocalDeOpcion"] },
  { migracion: "20261020131000_go1d_rls_sucursal_opcion_elegida", tablas: ["OpcionElegidaEnLinea"] },
  // GO-3 (ADR-032): el plato del día por sucursal (GO-3d-rls).
  { migracion: "20261021101000_go3d_rls_sucursal_menu_del_dia", tablas: ["EntradaDelDiaDeCupo"] },
  // GO-3 (ADR-032): el precio local de las combinaciones y de los grupos, y la foto de la combinación vendida (GO-3a-rls).
  { migracion: "20261021111000_go3a_rls_sucursal_combinaciones", tablas: ["CombinacionEnLinea", "PrecioLocalDeCombinacion"] },
];

/**
 * Las migraciones que RETIRAN políticas de alcance de sucursal porque sus tablas se retiran (en orden ascendente por nombre): su `migration.sql` es el encabezado más la salida exacta de la REVERSA del
 * generador para sus tablas, y su `down.sql`, el encabezado más la salida exacta del generador (las vuelve a crear). B7 las verifica byte a byte como a las demás, y la regla de la unión pasa a
 * ser: (Paquete 1 + posteriores) − retiradas = `TABLAS_CON_POLITICA_DE_SUCURSAL`. Cada una tiene que ser posterior a la migración que creó esas políticas.
 *
 * Ola «precio y carta», Fase 3, paso 3.7 (retiro de GO-3a, ADR-032): las dos tablas de GO-3a-rls. Va en una carpeta propia, ANTES de la migración de esquema que borra las tablas
 * (`20261022101000_retiro_go3a`): B7 exige que una migración de políticas sea solo el encabezado y la salida del generador.
 */
export const MIGRACIONES_DE_RETIRO_DE_POLITICAS: readonly { readonly migracion: string; readonly tablas: readonly string[] }[] = [
  { migracion: "20261022100000_retiro_go3a_rls", tablas: ["CombinacionEnLinea", "PrecioLocalDeCombinacion"] },
];

/**
 * El alcance que TENÍAN las tablas retiradas (ya no están en la clasificación porque no existen en la base): el generador lo usa SOLO para reproducir el SQL de las migraciones viejas que las
 * nombran (las de alta y la de retiro), que B7 sigue exigiendo byte a byte. Ninguna tabla de acá puede estar también en `ALCANCE_DE_TABLAS` (lo comprueba B7).
 */
export const ALCANCE_DE_TABLAS_RETIRADAS: Readonly<Record<string, DeclaracionDeAlcance>> = Object.freeze({
  // GO-3a (retirada en la Fase 3): el precio local de una combinación o de una tarifa, de una sucursal.
  PrecioLocalDeCombinacion: { alcance: "PROPIA" },
  // GO-3a (retirada en la Fase 3): la foto de la combinación vendida, de la sucursal de la mesa de su línea.
  CombinacionEnLinea: { alcance: "HEREDADA", padre: "CuentaItem", columna: "cuentaItemId" },
});

/** Las migraciones previas que la prueba de subir/bajar/subir baja DESPUÉS de B1 (en este orden: P3 y después M.2). Ambas reversas son destructivas. */
export const MIGRACION_P3_AGREGADO_DE_CUENTA = "20261014100000_i3_agregado_de_cuenta";
export const MIGRACION_M2_CAMPOS_SENSIBLES = "20261013120000_permiso_producto_campos_sensibles";

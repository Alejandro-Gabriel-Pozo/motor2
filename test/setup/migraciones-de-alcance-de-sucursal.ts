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
 * Las migraciones POSTERIORES al Paquete 1 que crean políticas de alcance de sucursal (una tabla nueva con alcance, p. ej. `Venta`, de M2-4), en el mismo formato que los grupos de arriba y en orden.
 * B7 las suma a las que espera: cada una es el encabezado más la salida exacta del generador para sus tablas. Todas tienen que ser posteriores a `ULTIMA_MIGRACION_DEL_PAQUETE_1`.
 */
export const MIGRACIONES_DE_POLITICAS_POSTERIORES: readonly { readonly migracion: string; readonly tablas: readonly string[] }[] = [
  { migracion: "20261015123000_m2_rls_sucursal_venta", tablas: ["Venta"] },
];

/** Las migraciones previas que la prueba de subir/bajar/subir baja DESPUÉS de B1 (en este orden: P3 y después M.2). Ambas reversas son destructivas. */
export const MIGRACION_P3_AGREGADO_DE_CUENTA = "20261014100000_i3_agregado_de_cuenta";
export const MIGRACION_M2_CAMPOS_SENSIBLES = "20261013120000_permiso_producto_campos_sensibles";

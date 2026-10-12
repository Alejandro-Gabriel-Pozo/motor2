/**
 * Paquete 1, migraciones B1 a B6 (RLS por sucursal): sus carpetas y qué tablas lleva cada una. Lo comparten el guardián B7 (`test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts`)
 * y la prueba de subir/bajar/subir (`test/aislamiento/paquete-1-subir-bajar-subir.test.ts`).
 *
 * El SQL de cada migración sale SIEMPRE del generador (`politicas-de-alcance-de-sucursal.ts`): acá solo se reparten las tablas en grupos. Los padres de cada tabla HEREDADA van en el
 * mismo grupo que ella (Cuenta → Mesa, MovimientoStock → Seccion, Receta* → RecetaVersion), así ningún grupo depende de otro. La unión de los cinco grupos tiene que ser EXACTAMENTE
 * `TABLAS_CON_POLITICA_DE_SUCURSAL` (lo exige B7).
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

/** Las migraciones previas que la prueba de subir/bajar/subir baja DESPUÉS de B1 (en este orden: P3 y después M.2). Ambas reversas son destructivas. */
export const MIGRACION_P3_AGREGADO_DE_CUENTA = "20261014100000_i3_agregado_de_cuenta";
export const MIGRACION_M2_CAMPOS_SENSIBLES = "20261013120000_permiso_producto_campos_sensibles";

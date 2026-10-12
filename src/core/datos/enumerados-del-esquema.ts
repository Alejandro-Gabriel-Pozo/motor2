/**
 * Los enumerados del esquema que usa el núcleo, como uniones de strings propias (Fase 6, tramo 6b: `src/core/` no depende de Prisma).
 * Son copia exacta de los `enum` de `prisma/schema.prisma`; la prueba de tipos `test/arquitectura/tipos-de-dominio-vs-prisma.test.ts` exige que
 * cada unión sea IGUAL a la que genera Prisma, así que un valor nuevo en el esquema (o uno de más acá) no compila hasta que se copie.
 *
 * Una sola hoja y sin imports, no repartidos por dominio: la importan movimientos, traspasos, catálogo y reportes, y repartirlos arma ciclos
 * (`sin-ciclos` cuenta también los imports de solo tipos).
 */

/** `enum Proceso` de `MovimientoStock.proceso`. */
export type Proceso =
  | "COMPRA"
  | "PRODUCCION"
  | "CONSUMO"
  | "AJUSTE"
  | "CONTROL"
  | "TRANSFERENCIA"
  | "MERMA"
  | "VENTA"
  | "DEVOLUCION_CONSIGNACION"
  | "LIQUIDACION_CONSIGNACION"
  | "DEVOLUCION_CLIENTE"
  | "DEVOLUCION_PROVEEDOR"
  | "RECLASIFICACION"
  | "TRANSFERENCIA_SALIDA_SUCURSAL"
  | "TRANSFERENCIA_ENTRADA_SUCURSAL"
  | "REINGRESO_TRANSFERENCIA_SUCURSAL";

/** `enum AccionConteo` del conteo físico. */
export type AccionConteo = "AJUSTAR" | "FALTA_MOVIMIENTO" | "DESCARTAR";

/** `enum EstadoTraspaso` de los traspasos entre sucursales. */
export type EstadoTraspaso = "SOLICITADA" | "ENVIADA" | "ACEPTADA" | "RECHAZADA_ORIGEN" | "RECHAZADA_DESTINO" | "CERRADA" | "CANCELADA";

/** `enum TipoProducto`: materia prima o producto de venta. */
export type TipoProducto = "MP" | "PV";

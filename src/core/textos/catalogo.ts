import type { DefinicionDeTexto } from "./tipos";

/**
 * El catálogo cerrado de textos de interfaz (diseño `docs/diseno-textos-en-codigo-2026-11-16.md`; DEC-0013). Una entrada por texto: la clave nombra UNA cosa; `ClaveDeTexto` se deduce de acá, así que pedir una
 * clave que no existe no compila. Hoy tiene la primera familia (R-11 del diseño): el rechazo de la etapa a2-1 de Presentaciones, unido en una sola causa con dos marcos.
 *
 * Convención de claves: `rechazo.<CODIGO>` (el `codigo` público de `fracaso`), o `rotulo.` / `accion.` / `aviso.` / `ayuda.` / `titulo.` / `columna.` (encabezado de tabla) más `<tema>` en minúsculas (lo comprueba
 * `test/arquitectura/catalogo-de-textos.test.ts`). Un texto nuevo entra acá con sus `usos` y su `fuente`, no escrito a mano en el código.
 */
export const CATALOGO = {
  // La causa, una sola vez: «hay más de una presentación activa en esa unidad». No se muestra sola: la completan los dos marcos de abajo.
  "rechazo.PRESENTACION_AMBIGUA": {
    porDefecto: "hay más de una presentación activa en esa unidad",
    usos: [
      { archivo: "src/server/actions/movimientos/casos-de-uso/armar-linea-de-movimiento.ts", nombre: "armarLineaMovimiento" },
      { archivo: "src/server/actions/catalogo/casos-de-uso/agregar-presentacion-alternativa.ts", nombre: "agregarPresentacionAlternativaCasoDeUso" },
    ],
    fuente: { decision: "DEC-0013" },
  },
  // Marco de la compra (la línea trae solo la unidad: no distingue cuál de las dos presentaciones es).
  "aviso.no_se_puede_registrar_la_compra": {
    porDefecto: 'No se puede registrar la compra de "{producto}": {causa}.',
    marcadores: { producto: "texto", causa: "causa" },
    usos: [{ archivo: "src/server/actions/movimientos/casos-de-uso/armar-linea-de-movimiento.ts", nombre: "armarLineaMovimiento" }],
    fuente: { decision: "DEC-0013" },
  },
  // Marco del alta de una presentación.
  "aviso.no_se_pudo_agregar_la_presentacion": {
    porDefecto: "No se pudo agregar la presentación: {causa}.",
    marcadores: { causa: "causa" },
    usos: [{ archivo: "src/server/actions/catalogo/casos-de-uso/agregar-presentacion-alternativa.ts", nombre: "agregarPresentacionAlternativaCasoDeUso" }],
    fuente: { decision: "DEC-0013" },
  },
  // «Ocultar» (tarjeta de la ficha del producto; los cinco de la tabla T13 de Pedernal y el rechazo por existencia). Una sola cosa cada uno.
  "accion.ocultar": { porDefecto: "Ocultar", usos: [{ archivo: "src/components/catalogo/tarjeta-ocultar.tsx", nombre: "TarjetaOcultar" }], fuente: { decision: "DEC-0014" } },
  "accion.volver_a_mostrar": { porDefecto: "Volver a mostrar", usos: [{ archivo: "src/components/catalogo/tarjeta-ocultar.tsx", nombre: "TarjetaOcultar" }], fuente: { decision: "DEC-0014" } },
  "accion.ocultar_en_la_empresa": { porDefecto: "Ocultar en toda la empresa", usos: [{ archivo: "src/components/catalogo/tarjeta-ocultar.tsx", nombre: "TarjetaOcultar" }], fuente: { decision: "DEC-0014" } },
  "aviso.oculto": { porDefecto: "Oculto", usos: [{ archivo: "src/components/catalogo/tarjeta-ocultar.tsx", nombre: "TarjetaOcultar" }], fuente: { decision: "DEC-0014" } },
  "aviso.oculto_en_la_empresa": { porDefecto: "Oculto en toda la empresa", usos: [{ archivo: "src/components/catalogo/tarjeta-ocultar.tsx", nombre: "TarjetaOcultar" }], fuente: { decision: "DEC-0014" } },
  "rechazo.TIENE_EXISTENCIA": { porDefecto: "Primero dejá la existencia en 0.", usos: [{ archivo: "src/server/actions/catalogo/casos-de-uso/ocultar-producto.ts", nombre: "ocultarProductoCasoDeUso" }], fuente: { decision: "DEC-0014" } },
  // Lote E (DEC-0016): rótulos de dinero de columnas de reportes, con las MISMAS palabras que tenían (aceptado por el dueño, 2026-11-16).
  "columna.importe": {
    porDefecto: "Importe",
    usos: [
      { archivo: "src/app/(app)/reportes/categorias/tabla-categorias.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/historial/como-se-vendio.tsx", nombre: "columnas" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "COLUMNAS_VENTAS" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "columnasCompras" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "COLUMNAS_VENTAS_POR_OPCION" },
      { archivo: "src/app/(app)/reportes/tabla-resumen.tsx", nombre: "COLUMNAS_TOP_PRODUCTOS" },
      { archivo: "src/app/(app)/reportes/tabla-resumen.tsx", nombre: "COLUMNAS_TOP_PROVEEDORES" },
      { archivo: "src/app/(app)/reportes/ventas-por-seccion/tabla-seccion.tsx", nombre: "COLUMNAS" },
    ],
    fuente: { decision: "DEC-0016" },
  },
  "columna.cobrado": {
    porDefecto: "Cobrado",
    usos: [
      { archivo: "src/app/(app)/reportes/descuentos-clientes/tabla-descuentos-clientes.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/descuentos-productos/tabla-descuentos-productos.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/margen-promociones/tabla-margen-promociones.tsx", nombre: "COLUMNAS" },
    ],
    fuente: { decision: "DEC-0016" },
  },
  "columna.margen": {
    porDefecto: "Margen",
    usos: [
      { archivo: "src/app/(app)/reportes/costos/tabla-costos.tsx", nombre: "COLUMNAS_PRODUCTOS" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "COLUMNAS_VENTAS_POR_OPCION" },
    ],
    fuente: { decision: "DEC-0016" },
  },
  "columna.food_cost": {
    porDefecto: "Food cost %",
    usos: [
      { archivo: "src/app/(app)/reportes/costos/tabla-costos.tsx", nombre: "COLUMNAS_PRODUCTOS" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "COLUMNAS_IMPACTO_RECETA" },
    ],
    fuente: { decision: "DEC-0016" },
  },
  "columna.costo_unitario": {
    porDefecto: "Costo unitario",
    usos: [
      { archivo: "src/app/(app)/reportes/costos/tabla-costos.tsx", nombre: "COLUMNAS_INSUMOS" },
      { archivo: "src/app/(app)/reportes/valuacion/tabla-valuacion.tsx", nombre: "COLUMNAS_CON_COSTO" },
    ],
    fuente: { decision: "DEC-0016" },
  },
  "columna.a_precio_de_lista": {
    porDefecto: "A precio de lista",
    usos: [
      { archivo: "src/app/(app)/reportes/descuentos-clientes/tabla-descuentos-clientes.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/descuentos-productos/tabla-descuentos-productos.tsx", nombre: "COLUMNAS" },
    ],
    fuente: { decision: "DEC-0016" },
  },
  "columna.margen_real_cobrado": {
    porDefecto: "Margen Real (cobrado)",
    usos: [
      { archivo: "src/app/(app)/reportes/descuentos-clientes/tabla-descuentos-clientes.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/margen-promociones/tabla-margen-promociones.tsx", nombre: "COLUMNAS" },
    ],
    fuente: { decision: "DEC-0016" },
  },
  // Rótulos del historial de la consola de plataforma para las acciones de los planes versionados (frente 4, M1). Los escribe `scripts/plan-de-plataforma.ts`; solo los ve la plataforma (la empresa NO ve ese historial).
  "rotulo.plan_creado": {
    porDefecto: "Plan creado",
    usos: [{ archivo: "plataforma/src/app/instalaciones/[instalacion]/empresas/textos.ts", nombre: "ACCION_DE_AUDITORIA" }],
    fuente: { decision: "DEC-0015" },
  },
  "rotulo.plan_borrador_guardado": {
    porDefecto: "Borrador de plan guardado",
    usos: [{ archivo: "plataforma/src/app/instalaciones/[instalacion]/empresas/textos.ts", nombre: "ACCION_DE_AUDITORIA" }],
    fuente: { decision: "DEC-0015" },
  },
  "rotulo.plan_version_publicada": {
    porDefecto: "Versión de plan publicada",
    usos: [{ archivo: "plataforma/src/app/instalaciones/[instalacion]/empresas/textos.ts", nombre: "ACCION_DE_AUDITORIA" }],
    fuente: { decision: "DEC-0015" },
  },
  "rotulo.plan_asignado": {
    porDefecto: "Plan asignado a la empresa",
    usos: [{ archivo: "plataforma/src/app/instalaciones/[instalacion]/empresas/textos.ts", nombre: "ACCION_DE_AUDITORIA" }],
    fuente: { decision: "DEC-0015" },
  },
  // Lote C1 (DEC-0020): «No se encontró {entidad}.», un solo molde con el género de la cosa («ese/esa» pasa a «el/la», aceptado por el dueño). Lo usan `server/actions/auth/` (C1) y los casos de uso y guards de movimientos, stock, clientes, reportes y traspasos (C2, DEC-0021). Absorbe las claves por código del lote A.
  "rechazo.NO_ENCONTRADO": {
    porDefecto: "No se encontró {entidad}.",
    marcadores: { entidad: "entidad" },
    usos: [
      { archivo: "src/server/actions/auth/casos-de-uso/actualizar-activo-membresia.ts", nombre: "actualizarActivoMembresiaCasoDeUso" },
      { archivo: "src/server/actions/auth/casos-de-uso/actualizar-notas-membresia.ts", nombre: "actualizarNotasMembresiaCasoDeUso" },
      { archivo: "src/server/actions/auth/casos-de-uso/invitar-a-vincular.ts", nombre: "invitarAVincularCasoDeUso" },
      { archivo: "src/server/actions/auth/casos-de-uso/actualizar-activo-sucursal.ts", nombre: "actualizarActivoSucursalCasoDeUso" },
      { archivo: "src/server/actions/auth/casos-de-uso/renombrar-sucursal.ts", nombre: "renombrarSucursalCasoDeUso" },
      { archivo: "src/server/actions/auth/casos-de-uso/actualizar-activo-usuario-en-empresa.ts", nombre: "actualizarActivoUsuarioEnEmpresaCasoDeUso" },
      { archivo: "src/server/actions/auth/casos-de-uso/invitacion-gestionable.ts", nombre: "invitacionGestionable" },
      { archivo: "src/server/actions/auth/casos-de-uso/invitaciones-de-usuario-en-tx.ts", nombre: "rotarInvitacionPendiente" },
      { archivo: "src/server/actions/auth/casos-de-uso/revocar-invitacion.ts", nombre: "revocarInvitacionCasoDeUso" },
      { archivo: "src/core/features/movimientos/cancelar-conteo.guard.ts", nombre: "guardComandoCancelarConteo" },
      { archivo: "src/core/features/movimientos/resolver-conteo.guard.ts", nombre: "guardComandoResolverConteo" },
      { archivo: "src/core/features/movimientos/secciones.guard.ts", nombre: "guardComandoActualizarRespaldoSeccion" },
      { archivo: "src/core/features/seccion-habitual/seccion-habitual.guard.ts", nombre: "guardComandoEliminarSeccionHabitual" },
      { archivo: "src/core/features/traspasos/traspaso-comandos.guard.ts", nombre: "MENSAJE_TRASPASO_NO_ENCONTRADO" },
      { archivo: "src/server/actions/clientes/casos-de-uso/actualizar-activo-cliente.ts", nombre: "actualizarActivoClienteCasoDeUso" },
      { archivo: "src/server/actions/clientes/casos-de-uso/actualizar-cliente.ts", nombre: "actualizarClienteCasoDeUso" },
      { archivo: "src/server/actions/movimientos/casos-de-uso/actualizar-activa-seccion.ts", nombre: "actualizarActivaSeccionCasoDeUso" },
      { archivo: "src/server/actions/movimientos/casos-de-uso/actualizar-activo-destino-consumo.ts", nombre: "actualizarActivoDestinoConsumoCasoDeUso" },
      { archivo: "src/server/actions/movimientos/casos-de-uso/actualizar-activo-motivo-merma.ts", nombre: "actualizarActivoMotivoMermaCasoDeUso" },
      { archivo: "src/server/actions/movimientos/casos-de-uso/actualizar-respaldo-seccion.ts", nombre: "actualizarRespaldoSeccionCasoDeUso" },
      { archivo: "src/server/actions/movimientos/casos-de-uso/cancelar-conteo-fisico.ts", nombre: "cancelarConteoFisicoCasoDeUso" },
      { archivo: "src/server/actions/movimientos/casos-de-uso/registrar-conteo-fisico.ts", nombre: "registrarConteoFisicoCasoDeUso" },
      { archivo: "src/server/actions/movimientos/casos-de-uso/registrar-movimiento.ts", nombre: "registrarMovimientoCasoDeUso" },
      { archivo: "src/server/actions/movimientos/casos-de-uso/renombrar-seccion.ts", nombre: "renombrarSeccionCasoDeUso" },
      { archivo: "src/server/actions/movimientos/casos-de-uso/resolver-conteo-pendiente.ts", nombre: "resolverConteoPendienteCasoDeUso" },
      { archivo: "src/server/actions/reportes/casos-de-uso/guardar-margen-objetivo.ts", nombre: "guardarMargenObjetivoCasoDeUso" },
      { archivo: "src/server/actions/stock/casos-de-uso/eliminar-frecuencia-conteo.ts", nombre: "eliminarFrecuenciaConteoCasoDeUso" },
      { archivo: "src/server/actions/stock/casos-de-uso/eliminar-seccion-habitual.ts", nombre: "eliminarSeccionHabitualCasoDeUso" },
      { archivo: "src/server/actions/stock/casos-de-uso/eliminar-stock-minimo.ts", nombre: "eliminarStockMinimoCasoDeUso" },
      { archivo: "src/server/actions/stock/casos-de-uso/reclasificar-stock.ts", nombre: "reclasificarStockCasoDeUso" },
      { archivo: "src/server/actions/stock/casos-de-uso/set-frecuencia-conteo.ts", nombre: "setFrecuenciaConteoCasoDeUso" },
      { archivo: "src/server/actions/stock/casos-de-uso/set-seccion-habitual.ts", nombre: "setSeccionHabitualCasoDeUso" },
      { archivo: "src/server/actions/stock/casos-de-uso/set-stock-minimo-producto.ts", nombre: "setStockMinimoProductoCasoDeUso" },
      { archivo: "src/server/persistencia/movimientos/cargar-origen-de-venta.ts", nombre: "prepararOrigen" },
    ],
    fuente: { decision: "DEC-0020" },
  },
  // Lote B (DEC-0019): encabezados NEUTROS de columnas de reportes, idénticos (sin «Estado» ni «Detalle», que son homónimos, ni rótulos de dinero).
  "columna.producto": {
    porDefecto: "Producto",
    usos: [
      { archivo: "src/app/(app)/reportes/categorias/tabla-categorias.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/consignacion/tabla-consignacion.tsx", nombre: "COLUMNAS_STOCK" },
      { archivo: "src/app/(app)/reportes/conteos/tabla-conteos.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/costos/tabla-costos.tsx", nombre: "COLUMNAS_PRODUCTOS" },
      { archivo: "src/app/(app)/reportes/descuentos-productos/tabla-descuentos-productos.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/devoluciones/tabla-devoluciones.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/diferencias/tabla-diferencias.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/insumos-sin-receta/tabla-insumos-sin-receta.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/perdidas/tabla-perdidas.tsx", nombre: "columnas" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "COLUMNAS_VENTAS" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "COLUMNAS_VENTAS_POR_OPCION" },
      { archivo: "src/app/(app)/reportes/salud/tabla-salud.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/sin-receta/tabla-sin-receta.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/tabla-resumen.tsx", nombre: "COLUMNAS_TOP_PRODUCTOS" },
      { archivo: "src/app/(app)/reportes/tabla-resumen.tsx", nombre: "COLUMNAS_STOCK_BAJO" },
      { archivo: "src/app/(app)/reportes/trazabilidad/tabla-trazabilidad.tsx", nombre: "COLUMNAS_ITEMS" },
      { archivo: "src/app/(app)/reportes/valuacion/tabla-valuacion.tsx", nombre: "COLUMNAS_CON_COSTO" },
      { archivo: "src/app/(app)/reportes/valuacion/tabla-valuacion.tsx", nombre: "COLUMNAS_SIN_COSTO" },
      { archivo: "src/app/(app)/reportes/vencimientos/tabla-vencimientos.tsx", nombre: "COLUMNAS_LOTES" },
      { archivo: "src/app/(app)/reportes/vencimientos/tabla-vencimientos.tsx", nombre: "COLUMNAS_CONCILIACION" },
    ],
    fuente: { decision: "DEC-0019" },
  },
  "columna.cantidad": {
    porDefecto: "Cantidad",
    usos: [
      { archivo: "src/app/(app)/reportes/categorias/tabla-categorias.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/devoluciones/tabla-devoluciones.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/historial/como-se-compro.tsx", nombre: "columnas" },
      { archivo: "src/app/(app)/reportes/historial/tabla-historial.tsx", nombre: "columnas" },
      { archivo: "src/app/(app)/reportes/perdidas/tabla-perdidas.tsx", nombre: "columnas" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "COLUMNAS_VENTAS" },
      { archivo: "src/app/(app)/reportes/trazabilidad/tabla-trazabilidad.tsx", nombre: "COLUMNAS_ITEMS" },
      { archivo: "src/app/(app)/reportes/vencimientos/tabla-vencimientos.tsx", nombre: "COLUMNAS_CONCILIACION" },
      { archivo: "src/app/(app)/reportes/ventas-por-seccion/tabla-seccion.tsx", nombre: "COLUMNAS" },
    ],
    fuente: { decision: "DEC-0019" },
  },
  "columna.seccion": {
    porDefecto: "Sección",
    usos: [
      { archivo: "src/app/(app)/reportes/conteos/tabla-conteos.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/historial/tabla-historial.tsx", nombre: "columnas" },
      { archivo: "src/app/(app)/reportes/salud/tabla-salud.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/tabla-resumen.tsx", nombre: "COLUMNAS_STOCK_BAJO" },
      { archivo: "src/app/(app)/reportes/trazabilidad/tabla-trazabilidad.tsx", nombre: "COLUMNAS_ENCONTRADAS" },
      { archivo: "src/app/(app)/reportes/trazabilidad/tabla-trazabilidad.tsx", nombre: "COLUMNAS_ITEMS" },
      { archivo: "src/app/(app)/reportes/vencimientos/tabla-vencimientos.tsx", nombre: "COLUMNAS_LOTES" },
      { archivo: "src/app/(app)/reportes/vencimientos/tabla-vencimientos.tsx", nombre: "COLUMNAS_CONCILIACION" },
    ],
    fuente: { decision: "DEC-0019" },
  },
  "columna.proveedor": {
    porDefecto: "Proveedor",
    usos: [
      { archivo: "src/app/(app)/reportes/consignacion/tabla-consignacion.tsx", nombre: "COLUMNAS_DEBIDO" },
      { archivo: "src/app/(app)/reportes/costos/tabla-costos.tsx", nombre: "COLUMNAS_INSUMOS" },
      { archivo: "src/app/(app)/reportes/historial/como-se-compro.tsx", nombre: "columnas" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "columnasCompras" },
      { archivo: "src/app/(app)/reportes/tabla-resumen.tsx", nombre: "COLUMNAS_TOP_PROVEEDORES" },
      { archivo: "src/app/(app)/reportes/valuacion/tabla-valuacion.tsx", nombre: "COLUMNAS_CON_COSTO" },
    ],
    fuente: { decision: "DEC-0019" },
  },
  "columna.insumo": {
    porDefecto: "Insumo",
    usos: [
      { archivo: "src/app/(app)/reportes/costos/tabla-costos.tsx", nombre: "COLUMNAS_INSUMOS" },
      { archivo: "src/app/(app)/reportes/insumos-sin-receta/tabla-insumos-sin-receta.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "COLUMNAS_GASTO_INSUMO" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "COLUMNAS_PRECIO_INSUMO" },
      { archivo: "src/app/(app)/reportes/rendimiento-recetas/por-sucursal/tabla-por-sucursal.tsx", nombre: "TablaPorSucursal" },
    ],
    fuente: { decision: "DEC-0019" },
  },
  "columna.categoria": {
    porDefecto: "Categoría",
    usos: [
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "COLUMNAS_GASTO_INSUMO" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "COLUMNAS_PRECIO_INSUMO" },
      { archivo: "src/app/(app)/reportes/ventas-por-seccion/tabla-seccion.tsx", nombre: "COLUMNAS" },
    ],
    fuente: { decision: "DEC-0019" },
  },
  "columna.unidades": {
    porDefecto: "Unidades",
    usos: [
      { archivo: "src/app/(app)/reportes/descuentos-productos/tabla-descuentos-productos.tsx", nombre: "COLUMNAS" },
      { archivo: "src/app/(app)/reportes/periodo/tabla-periodo.tsx", nombre: "COLUMNAS_VENTAS_POR_OPCION" },
    ],
    fuente: { decision: "DEC-0019" },
  },
  "columna.origen": {
    porDefecto: "Origen",
    usos: [
      { archivo: "src/app/(app)/reportes/historial/como-se-compro.tsx", nombre: "columnas" },
      { archivo: "src/app/(app)/reportes/historial/tabla-historial.tsx", nombre: "columnas" },
    ],
    fuente: { decision: "DEC-0019" },
  },
} as const satisfies Readonly<Record<string, DefinicionDeTexto>>;

export type ClaveDeTexto = keyof typeof CATALOGO;

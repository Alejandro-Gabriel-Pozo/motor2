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
} as const satisfies Readonly<Record<string, DefinicionDeTexto>>;

export type ClaveDeTexto = keyof typeof CATALOGO;

import type { DefinicionDeTexto } from "./tipos";

/**
 * El catálogo cerrado de textos de interfaz (diseño `docs/diseno-textos-en-codigo-2026-11-16.md`; DEC-0013). Una entrada por texto: la clave nombra UNA cosa; `ClaveDeTexto` se deduce de acá, así que pedir una
 * clave que no existe no compila. Hoy tiene la primera familia (R-11 del diseño): el rechazo de la etapa a2-1 de Presentaciones, unido en una sola causa con dos marcos.
 *
 * Convención de claves: `rechazo.<CODIGO>` (el `codigo` público de `fracaso`), o `rotulo.` / `accion.` / `aviso.` / `ayuda.` / `titulo.` más `<tema>` en minúsculas (lo comprueba
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
  // Lote A (DEC-0017): «No se encontró …» idénticos con el mismo código, una clave por código.
  "rechazo.MEMBRESIA_NO_ENCONTRADA": {
    porDefecto: "No se encontró esa membresía.",
    usos: [
      { archivo: "src/server/actions/auth/casos-de-uso/actualizar-activo-membresia.ts", nombre: "actualizarActivoMembresiaCasoDeUso" },
      { archivo: "src/server/actions/auth/casos-de-uso/actualizar-notas-membresia.ts", nombre: "actualizarNotasMembresiaCasoDeUso" },
      { archivo: "src/server/actions/auth/casos-de-uso/invitar-a-vincular.ts", nombre: "invitarAVincularCasoDeUso" },
    ],
    fuente: { decision: "DEC-0017" },
  },
  "rechazo.SUCURSAL_NO_ENCONTRADA": {
    porDefecto: "No se encontró esa sucursal.",
    usos: [
      { archivo: "src/server/actions/auth/casos-de-uso/actualizar-activo-sucursal.ts", nombre: "actualizarActivoSucursalCasoDeUso" },
      { archivo: "src/server/actions/auth/casos-de-uso/renombrar-sucursal.ts", nombre: "renombrarSucursalCasoDeUso" },
    ],
    fuente: { decision: "DEC-0017" },
  },
  "rechazo.CONTEO_NO_ENCONTRADO": {
    porDefecto: "No se encontró ese conteo.",
    usos: [
      { archivo: "src/server/actions/movimientos/casos-de-uso/cancelar-conteo-fisico.ts", nombre: "cancelarConteoFisicoCasoDeUso" },
      { archivo: "src/server/actions/movimientos/casos-de-uso/resolver-conteo-pendiente.ts", nombre: "resolverConteoPendienteCasoDeUso" },
    ],
    fuente: { decision: "DEC-0017" },
  },
  "rechazo.PRODUCTO_NO_ENCONTRADO": {
    porDefecto: "No se encontró el producto.",
    usos: [
      { archivo: "src/server/actions/stock/casos-de-uso/set-frecuencia-conteo.ts", nombre: "setFrecuenciaConteoCasoDeUso" },
      { archivo: "src/server/actions/stock/casos-de-uso/set-seccion-habitual.ts", nombre: "setSeccionHabitualCasoDeUso" },
      { archivo: "src/server/actions/stock/casos-de-uso/set-stock-minimo-producto.ts", nombre: "setStockMinimoProductoCasoDeUso" },
    ],
    fuente: { decision: "DEC-0017" },
  },
} as const satisfies Readonly<Record<string, DefinicionDeTexto>>;

export type ClaveDeTexto = keyof typeof CATALOGO;

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
} as const satisfies Readonly<Record<string, DefinicionDeTexto>>;

export type ClaveDeTexto = keyof typeof CATALOGO;

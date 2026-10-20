import type { TipoDeGrupoDeOpciones } from "@/core/opciones/public";

/**
 * GO-3b (ADR-032, F6 paso U4): lo que muestra la pantalla de COMBINACIONES de un producto (lo arma `server/consultas/catalogo/combinaciones.ts`). Solo tipos.
 */

/** Una celda de la grilla: el par de opciones de los ejes, el precio de la regla general (sin combinación) y la fila de la combinación, si existe. */
export interface CeldaDeCombinacion {
  opcionEje1: { opcionId: string; nombre: string };
  opcionEje2: { opcionId: string; nombre: string } | null;
  /** El precio de lista que daría la regla general (las opciones sumadas), o `null` si no se compone. */
  precioAditivo: number | null;
  fila: {
    combinacionId: string;
    version: number;
    activa: boolean;
    /** Precio propio, o `null`. */
    precio: number | null;
    /** El precio de esta combinación en la sucursal activa (habilitado o no), o `null`. */
    precioLocal: { precio: number; habilitado: boolean } | null;
    /** La receta propia vigente, o `null` (sin versión: la regla general). */
    receta: { numero: number; ingredientes: { insumoProductoId: string; cantidad: number; mermaPorcentaje: number }[] } | null;
  } | null;
}

export interface CombinacionesDelProductoAdmin {
  producto: { id: string; nombre: string; esPV: boolean; seProduce: boolean };
  /** Los grupos admitidos que pueden ser eje (MEDIDA o VARIANTE, una sola elección obligatoria). */
  posiblesEjes: { grupoId: string; nombre: string; tipo: TipoDeGrupoDeOpciones }[];
  ejes: { eje1: string | null; eje2: string | null };
  /** ¿Los ejes declarados siguen siendo válidos con lo que el producto admite hoy? (si no, la venta falla cerrado). */
  ejesValidos: boolean;
  eje1: { grupoId: string; nombre: string } | null;
  eje2: { grupoId: string; nombre: string } | null;
  celdas: CeldaDeCombinacion[];
  /** Las materias primas de la empresa (para la receta propia), con su unidad de stock. */
  materiasPrimas: { productoId: string; nombre: string; unidad: string }[];
}

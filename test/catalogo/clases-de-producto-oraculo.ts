/**
 * ORÁCULO de las clases de producto (docs/diseno-clases-de-producto-como-pedernal-2026-11-15.md, §4.1 y §10.1): las reglas esperadas
 * ESCRITAS APARTE del código, como tabla legible. NO importa nada de `src/core/catalogo/clases-de-producto.ts` más que los TIPOS
 * (para recorrer): si importara la lógica, el test compararía el código consigo mismo.
 *
 * Una fila por clase, una columna por pregunta de negocio. Cada celda sale de la tabla del diseño (§10.1) y de Pedernal
 * (`0025_catalogo.sql`, `0032_lotes_y_recetas.sql`, decisiones del dueño del 2026-11-12 y 2026-11-14).
 */
import type { ClaseDeProducto, MotivoDeRechazoDeClase, OperacionDeClase } from "@/core/catalogo/clases-de-producto";

export interface FilaDelOraculo {
  /** Vende: lleva alícuota, sección, nombre de cocina, descripción, precio y opciones; puede estar en la carta. */
  readonly vende: boolean;
  readonly seCompra: boolean;
  readonly sePuedeProducir: boolean;
  readonly llevaReceta: boolean;
  /** Puede ser ingrediente de una receta. El insumo (packaging, limpieza) NO (2026-11-14). */
  readonly esIngredienteDeReceta: boolean;
  /** Lo puede consumir una opción (2026-11-12: también el elaborado). */
  readonly loConsumeUnaOpcion: boolean;
  /** «siempre» o «solo_si_se_produce» (el vendible). */
  readonly stockPropio: "siempre" | "solo_si_se_produce";
  readonly cuentaEnElFoodCost: boolean;
}

export const FILAS_DEL_ORACULO: Readonly<Record<ClaseDeProducto, FilaDelOraculo>> = {
  MATERIA_PRIMA: { vende: false, seCompra: true, sePuedeProducir: false, llevaReceta: false, esIngredienteDeReceta: true, loConsumeUnaOpcion: true, stockPropio: "siempre", cuentaEnElFoodCost: true },
  INSUMO: { vende: false, seCompra: true, sePuedeProducir: false, llevaReceta: false, esIngredienteDeReceta: false, loConsumeUnaOpcion: true, stockPropio: "siempre", cuentaEnElFoodCost: false },
  REVENTA: { vende: true, seCompra: true, sePuedeProducir: false, llevaReceta: false, esIngredienteDeReceta: true, loConsumeUnaOpcion: true, stockPropio: "siempre", cuentaEnElFoodCost: true },
  ELABORADO: { vende: false, seCompra: false, sePuedeProducir: true, llevaReceta: true, esIngredienteDeReceta: true, loConsumeUnaOpcion: true, stockPropio: "siempre", cuentaEnElFoodCost: true },
  VENDIBLE: { vende: true, seCompra: false, sePuedeProducir: true, llevaReceta: true, esIngredienteDeReceta: false, loConsumeUnaOpcion: false, stockPropio: "solo_si_se_produce", cuentaEnElFoodCost: true },
};

/** Las cinco clases con sus textos literales de Pedernal (nombre en pantalla y descripción corta). */
export const TEXTOS_DE_PEDERNAL: Readonly<Record<ClaseDeProducto, { nombre: string; descripcion: string }>> = {
  MATERIA_PRIMA: { nombre: "Materia prima", descripcion: "Se compra y es componente de lo que se elabora y se vende." },
  INSUMO: { nombre: "Insumo", descripcion: "Se compra y se consume para operar, sin ser parte del producto." },
  REVENTA: { nombre: "Reventa", descripcion: "Se compra y se vende tal cual." },
  ELABORADO: { nombre: "Elaborado", descripcion: "Se produce en el negocio y se usa como componente." },
  VENDIBLE: { nombre: "Producto vendible", descripcion: "Se arma o se produce y se vende; tiene composición." },
};

/** Orden en pantalla (el de los chips de Pedernal). */
export const ORDEN_DE_PEDERNAL: readonly ClaseDeProducto[] = ["MATERIA_PRIMA", "INSUMO", "REVENTA", "ELABORADO", "VENDIBLE"];

/**
 * Qué se espera por operación: si se permite (según la fila) y, si no, con qué motivo. `entrar_en_receta` tiene dos motivos
 * distintos (el insumo tiene el suyo; el vendible, otro), por eso el motivo es una función de la clase.
 */
export interface ReglaDeOperacion {
  readonly texto: string;
  readonly permitido: (fila: FilaDelOraculo, clase: ClaseDeProducto, seProduce: boolean) => boolean;
  readonly motivo: (clase: ClaseDeProducto) => MotivoDeRechazoDeClase;
}

export const REGLAS_POR_OPERACION: Readonly<Record<OperacionDeClase, ReglaDeOperacion>> = {
  vender: { texto: "se vende solo si la clase vende (reventa, vendible)", permitido: (f) => f.vende, motivo: () => "LA_CLASE_NO_VENDE" },
  estar_en_la_carta: { texto: "está en la carta solo si la clase vende", permitido: (f) => f.vende, motivo: () => "LA_CLASE_NO_VENDE" },
  llevar_datos_de_venta: { texto: "alícuota, sección, nombre de cocina, descripción, precio y opciones: solo si la clase vende", permitido: (f) => f.vende, motivo: () => "CAMPO_NO_ADMITIDO_POR_LA_CLASE" },
  comprar: { texto: "se compra solo materia prima, insumo y reventa", permitido: (f) => f.seCompra, motivo: () => "PRODUCTO_NO_COMPRABLE" },
  producir: { texto: "se produce solo el elaborado y el vendible", permitido: (f) => f.sePuedeProducir, motivo: () => "LA_CLASE_NO_SE_PRODUCE" },
  llevar_receta: { texto: "lleva receta solo el elaborado y el vendible", permitido: (f) => f.llevaReceta, motivo: () => "PRODUCTO_NO_LLEVA_RECETA" },
  entrar_en_receta: {
    texto: "es ingrediente: materia prima, reventa y elaborado; el insumo no (packaging, 2026-11-14); el vendible tampoco",
    permitido: (f) => f.esIngredienteDeReceta,
    motivo: (c) => (c === "INSUMO" ? "COMPONENTE_ES_INSUMO" : "COMPONENTE_NO_ES_INGREDIENTE"),
  },
  ser_consumido_por_opcion: { texto: "lo consume una opción: todo menos el vendible", permitido: (f) => f.loConsumeUnaOpcion, motivo: () => "INSUMO_NO_ADMITIDO" },
  tener_stock_propio: {
    texto: "stock propio: siempre, salvo el vendible que solo lo tiene si se produce",
    permitido: (f, _c, seProduce) => f.stockPropio === "siempre" || seProduce,
    motivo: () => "SIN_STOCK_PROPIO",
  },
};

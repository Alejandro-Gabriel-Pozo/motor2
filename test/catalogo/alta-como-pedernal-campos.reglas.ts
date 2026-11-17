/**
 * ORÁCULO ESCRITO A MANO, aparte del código (decisión del dueño, 2026-11-17: «¿cuál está el problema en replicar las pantallas de Pedernal?… Si el oráculo… respondió esas ya preguntas, ¿por qué me estás preguntando eso?»):
 * qué campos dibuja el formulario de producto según la pantalla y la clase. El ALTA como Pedernal pide «¿Qué es?», Nombre, Nombre de cocina (solo vendible), Código, UNA «Unidad» y la alícuota de IVA (solo vendible); salen
 * del alta categoría, insumo, unidad de compra, factor de conversión, paso de venta y consignación, que siguen en la EDICIÓN y en la pantalla anterior (interruptor apagado). Cada fila se mide contra el HTML del formulario
 * con un marcador por campo.
 */
export type PantallaDelFormulario = "ALTA_COMO_PEDERNAL" | "ALTA_ANTERIOR" | "EDICION";
export type ClaseDeProductoDelFormulario = "MATERIA_PRIMA" | "VENDIBLE";

export const CAMPOS = ["categoria", "insumo", "unidadDeCompra", "factor", "pasoDeVenta", "consignacion", "iva", "rotuloUnidad", "rotuloUnidadDeStock"] as const;
export type CampoDelFormulario = (typeof CAMPOS)[number];

/** Cómo se reconoce cada campo en el HTML (el formulario se dibuja con permiso de campos sensibles y de consignación). */
export const MARCADOR: Record<CampoDelFormulario, RegExp> = {
  categoria: /Sin categoría/,
  insumo: /Sin insumo/,
  unidadDeCompra: /name="unidadCompraId"/,
  factor: /name="factorConversion"/,
  pasoDeVenta: /name="pasoVenta"/,
  consignacion: /Es consignación/,
  iva: /name="alicuotaIva"/,
  rotuloUnidad: /<label[^>]*>Unidad<\/label>/, // sin asterisco (maqueta de Pedernal): el rótulo es solo «Unidad»
  rotuloUnidadDeStock: />Unidad de stock</,
};

export interface FilaEsperada {
  pantalla: PantallaDelFormulario;
  clase: ClaseDeProductoDelFormulario;
  dibuja: Record<CampoDelFormulario, boolean>;
}

const ALTA = (vendible: boolean): FilaEsperada["dibuja"] => ({
  categoria: false, insumo: false, unidadDeCompra: false, factor: false, pasoDeVenta: false, consignacion: false, iva: vendible, rotuloUnidad: true, rotuloUnidadDeStock: false,
});
const COMPLETA = (vendible: boolean): FilaEsperada["dibuja"] => ({
  categoria: true, insumo: !vendible, unidadDeCompra: !vendible, factor: true, pasoDeVenta: vendible, consignacion: true, iva: true, rotuloUnidad: false, rotuloUnidadDeStock: true,
});

export const FILAS_ESPERADAS: readonly FilaEsperada[] = [
  { pantalla: "ALTA_COMO_PEDERNAL", clase: "MATERIA_PRIMA", dibuja: ALTA(false) },
  { pantalla: "ALTA_COMO_PEDERNAL", clase: "VENDIBLE", dibuja: ALTA(true) },
  { pantalla: "ALTA_ANTERIOR", clase: "MATERIA_PRIMA", dibuja: COMPLETA(false) },
  { pantalla: "ALTA_ANTERIOR", clase: "VENDIBLE", dibuja: COMPLETA(true) },
  { pantalla: "EDICION", clase: "MATERIA_PRIMA", dibuja: COMPLETA(false) },
  { pantalla: "EDICION", clase: "VENDIBLE", dibuja: COMPLETA(true) },
];

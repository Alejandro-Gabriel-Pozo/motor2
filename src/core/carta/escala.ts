/**
 * La ESCALA DE LETRA ÚNICA de la carta pública (Fase 5 de la ola «precio y carta», «carta pareja»; DEC-35; ADR-035). Un solo lugar para los tamaños: cada texto de la carta tiene un ROL y cada rol
 * un tamaño, el mismo para todo ítem (con o sin opciones, promo o plato). Los componentes no escriben tamaños: usan la clase del rol (`carta-rol-*`, `src/app/globals.css`), que lee la variable CSS
 * que arma `variablesDeLaEscala` (la pone `resolverEstiloCarta` en la raíz de la carta, y el portal en la suya).
 *
 * El TEMA de la sucursal sigue mandando hacia ARRIBA: el nombre, el precio, la descripción (también la línea «Elegí: …») y los tags toman `max(piso, lo que pide el tema)` (`carta_fuente_item_*`); un tema
 * que pide menos que el piso queda en el piso. El rol Opción (16 px) no tiene clave de tema (decisión del dueño). MÍNIMO de 14 px para todo texto que el cliente necesita para decidir; las únicas
 * excepciones son el `rotulo` (13 px, en mayúsculas espaciadas) y la `etiqueta` (los tags, de 12 px, decisión del dueño).
 *
 * En PAPEL (`@media print`) la escala es otra, en puntos, y el tema no cuenta (igual que sus colores): `ESCALA_IMPRESA`. Puro.
 */

/** Los roles de la carta y su tamaño en pantalla (el piso de cada uno). */
export const ESCALA_DE_LA_CARTA = {
  /** El nombre de un plato (o de una promo, o de una fila de un producto base oculto) y su precio: 19 px, peso 600. */
  producto: "1.1875rem",
  /** Una fila de opción (un tamaño de una lista, una fila o una celda de una tabla): 16 px; el rótulo en 400 y el precio en 600. */
  opcion: "1rem",
  /** Lo que se lee debajo del plato (descripción, «Guarnición: …», «Extras: …», el descuento) y el rótulo en negrita de cada aclaración («Guarnición:»): 14 px. Los encabezados de las columnas son `columna`. */
  aclaracion: "0.875rem",
  /** Los tags y los textos chicos de navegación (contadores, separadores, la etiqueta del portal): 12 px. */
  etiqueta: "0.75rem",
  /** El título del portal de sucursales: 24 px. */
  titulo: "1.5rem",
  /** El rótulo en mayúsculas del nombre «paraguas» (MILANESAS, PIZZAS): 13 px. */
  rotulo: "0.8125rem",
  /** El encabezado de columna de una tabla (Simple / Napolitana): 16 px. */
  columna: "1rem",
  /** El encabezado de tamaño (Chico / Mediano / Grande): 15 px. */
  tamano: "0.9375rem",
  /** La línea «Elegí: …» / «Incluidas: …»: 15 px. */
  eleccion: "0.9375rem",
} as const;

/** Los mismos roles en papel: Producto 12 pt, Opción 11 pt, Aclaración 10 pt, Etiqueta 9 pt, Título 16 pt, Rótulo 9,5 pt, Columna 11 pt, Tamaño 10,5 pt y Elección 10,5 pt. */
export const ESCALA_IMPRESA = {
  producto: "12pt",
  opcion: "11pt",
  aclaracion: "10pt",
  etiqueta: "9pt",
  titulo: "16pt",
  rotulo: "9.5pt",
  columna: "11pt",
  tamano: "10.5pt",
  eleccion: "10.5pt",
} as const;

/** Lo que pide el tema de la sucursal para los textos de un ítem (los `carta_fuente_item_*` ya resueltos; sin tema, sus defaults). */
interface TamanosDelTema {
  nombre: string;
  precio: string;
  descripcion: string;
  tags: string;
}

const piso = (base: string, tema: string | undefined) => (tema ? `max(${base}, ${tema})` : base);

/**
 * Las variables CSS de la escala: `--carta-fs-<rol>` (pantalla) y `--carta-fs-<rol>-impresa` (papel). Con `tema`, el nombre, el precio, la aclaración, la elección y la etiqueta toman `max(piso, tema)`; sin él
 * (el portal), el piso solo.
 */
export function variablesDeLaEscala(tema?: TamanosDelTema): Record<string, string> {
  const e = ESCALA_DE_LA_CARTA;
  return {
    "--carta-fs-producto": piso(e.producto, tema?.nombre),
    "--carta-fs-precio": piso(e.producto, tema?.precio),
    "--carta-fs-opcion": e.opcion,
    "--carta-fs-aclaracion": piso(e.aclaracion, tema?.descripcion),
    "--carta-fs-etiqueta": piso(e.etiqueta, tema?.tags),
    "--carta-fs-titulo": e.titulo,
    "--carta-fs-rotulo": e.rotulo,
    "--carta-fs-columna": e.columna,
    "--carta-fs-tamano": e.tamano,
    "--carta-fs-eleccion": piso(e.eleccion, tema?.descripcion),
    ...Object.fromEntries(Object.entries(ESCALA_IMPRESA).map(([rol, valor]) => [`--carta-fs-${rol}-impresa`, valor])),
  };
}

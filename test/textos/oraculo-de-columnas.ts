/**
 * Oráculo de las PALABRAS de los rótulos de dinero de columnas de reportes (lote E del catálogo de textos, DEC-0016; IT-7 del diseño `docs/diseno-textos-en-codigo-2026-11-16.md`: lo aprobado con las palabras
 * del dueño no cambia en silencio). Son los 7 literales TAL CUAL estaban el 2026-11-16 («Sí, mismas palabras (Recomendada)», dueño, 2026-11-16). `columnas.test.ts` los compara con el catálogo: cambiar una palabra
 * sin tocar acá pone el CI en rojo. Hablan de dinero: un cambio de redacción lo decide el dueño, no se edita acá por costumbre.
 */
export const ORACULO_DE_COLUMNAS_DE_DINERO: Readonly<Record<string, string>> = {
  "columna.importe": "Importe",
  "columna.cobrado": "Cobrado",
  "columna.margen": "Margen",
  "columna.food_cost": "Food cost %",
  "columna.costo_unitario": "Costo unitario",
  "columna.a_precio_de_lista": "A precio de lista",
  "columna.margen_real_cobrado": "Margen Real (cobrado)",
};

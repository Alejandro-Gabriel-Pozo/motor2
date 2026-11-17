/**
 * INTERRUPTOR del estilo de la maqueta en el libro de la carta pública (Frente 6, pantallas; decisión del dueño, 2026-11-16: «el estilo de la maqueta me gusta» y, a la pregunta «¿Querés que el libro de Motor2 pase
 * al estilo de la maqueta?», «Sí, igualar al de la maqueta»). La maqueta es `carta-libro.html` de Pedernal (tema oscuro, tipografía sans, color de marca verde, portada con un arco decorativo).
 * Una sola constante. Con `true` (hoy):
 *  - los TRES valores del tema que la sucursal NO cargó toman el de la maqueta (`conDefaultsDeLaMaqueta`, aplicado en el borde de la lectura pública, `server/lecturas/carta/publica.ts`): fondo oscuro, color de marca
 *    verde y tipografía sans. Lo que la sucursal SÍ cargó en su Tema manda siempre (nada de lo guardado se pisa ni se toca). El resolvedor del tema (`resolverEstiloCarta`) no cambia;
 *  - la portada y las cabeceras de sección toman el aire de la maqueta (arco decorativo, contador con letras separadas, título en color claro) con las clases `[data-estilo-libro="maqueta"]` de `globals.css`.
 * Con `false` vuelve el libro de siempre (claro, con la tipografía y el color por defecto de antes).
 * Es SOLO PRESENTACIÓN: no cambia el servidor, la carta guardada, los permisos ni ninguna función. Respuestas del dueño (2026-11-17): el libro va «incluido» (sin permiso ni plan nuevo); el rótulo de la barra
 * superior es el campo `topbar_back_label` que ya existía y «← Portal» pasa a ser su valor por defecto; «Restaurante», el subtítulo y el separador salen de campos del Tema que carga la empresa (sin cargar no se
 * dibujan); la letra de nombres, precios y títulos iguala a la de la maqueta; el precio va en blanco y negrita. Lo comprueba `test/carta/libro-estilo-maqueta.test.tsx` (los dos estados).
 */
export const LIBRO_ESTILO_MAQUETA: boolean = true;

/** Los valores del tema que toman los por defecto con el estilo de la maqueta (salen de `carta-libro.html`: fondo `#19191a`, marca `#6f7d52`, tipografía sans). Solo si la sucursal no cargó el suyo. */
export const DEFAULTS_DEL_LIBRO_MAQUETA: Readonly<Record<string, string>> = {
  color_fondo_dia: "#19191a",
  color_marca: "#6f7d52",
  carta_fuente_familia: "geist",
  // Dueño, 2026-11-17: «Portal con una flechita en dirección izquierda (es editable, lo era antes)» (`topbar_back_label`, ya existía) y «si» a igualar el tamaño de letra de nombres, precios y títulos al de la maqueta
  // (nombre y precio 1,2 em ≈ 1.35rem, título de sección 1,25 em ≈ 1.4rem, título del índice 1,6 em ≈ 1.8rem sobre la base de 18 px de la maqueta).
  topbar_back_label: "← Portal",
  carta_fuente_item_nombre: "1.35rem",
  carta_fuente_item_precio: "1.35rem",
  carta_fuente_banda_titulo: "1.4rem",
  carta_fuente_indice_titulo: "1.8rem",
};

/**
 * Los valores del tema de una sucursal con los por defecto de la maqueta en lo que NO cargó (ausente, vacío o no texto). Con el interruptor apagado devuelve los valores tal cual. Pura. Lo cargado
 * (aunque después `validarValorTema` lo rechace y caiga al por defecto del catálogo) no se reemplaza: la validación es del resolvedor.
 */
export function conDefaultsDeLaMaqueta(valores: unknown, activo: boolean = LIBRO_ESTILO_MAQUETA): Record<string, unknown> {
  const base: Record<string, unknown> = typeof valores === "object" && valores !== null && !Array.isArray(valores) ? { ...(valores as Record<string, unknown>) } : {};
  if (!activo) return base;
  for (const [clave, porDefecto] of Object.entries(DEFAULTS_DEL_LIBRO_MAQUETA)) {
    const cargado = base[clave];
    if (typeof cargado !== "string" || cargado.trim() === "") base[clave] = porDefecto;
  }
  return base;
}

/**
 * INTERRUPTOR del estilo de la maqueta en el libro de la carta pública (Frente 6, pantallas; decisión del dueño, 2026-11-16: «el estilo de la maqueta me gusta» y, a la pregunta «¿Querés que el libro de Motor2 pase
 * al estilo de la maqueta?», «Sí, igualar al de la maqueta»). La maqueta es `carta-libro.html` de Pedernal (tema oscuro, tipografía sans, color de marca verde, portada con un arco decorativo).
 * Una sola constante. Con `true` (hoy):
 *  - los TRES valores del tema que la sucursal NO cargó toman el de la maqueta (`DEFAULTS_DEL_LIBRO_MAQUETA`): fondo oscuro, color de marca verde y tipografía sans. Lo que la sucursal SÍ cargó en su Tema manda
 *    siempre (nada de lo guardado se pisa ni se toca);
 *  - la portada y las cabeceras de sección toman el aire de la maqueta (arco decorativo, contador con letras separadas, título en color claro) con las clases `[data-estilo-libro="maqueta"]` de `globals.css`.
 * Con `false` vuelve el libro de siempre (claro, con la tipografía y el color por defecto de antes).
 * Es SOLO PRESENTACIÓN: no cambia el servidor, la carta guardada, los permisos, los textos ni ninguna función. Lo que la maqueta trae de más (fila de contacto, perilla de tamaño de letra, ícono de compartir,
 * «extra de pago») NO entra: el libro sigue «para todos, como hoy». Lo comprueba `test/carta/libro-estilo-maqueta.test.ts` (los dos estados).
 */
export const LIBRO_ESTILO_MAQUETA: boolean = true;

/** Los valores del tema que toman los por defecto con el estilo de la maqueta (salen de `carta-libro.html`: fondo `#19191a`, marca `#6f7d52`, tipografía sans). Solo si la sucursal no cargó el suyo. */
export const DEFAULTS_DEL_LIBRO_MAQUETA: Readonly<Record<string, string>> = {
  color_fondo_dia: "#19191a",
  color_marca: "#6f7d52",
  carta_fuente_familia: "geist",
};

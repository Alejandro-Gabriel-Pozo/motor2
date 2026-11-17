/**
 * INTERRUPTOR del estilo de la maqueta en el libro de la carta pública (Frente 6, pantallas; decisión del dueño, 2026-11-16: «el estilo de la maqueta me gusta» y, a la pregunta «¿Querés que el libro de Motor2 pase
 * al estilo de la maqueta?», «Sí, igualar al de la maqueta»). La maqueta es `carta-libro.html` de Pedernal (tema oscuro, tipografía sans, color de marca verde, portada con un arco decorativo).
 * Una sola constante. Con `true` (hoy):
 *  - los TRES valores del tema que la sucursal NO cargó toman el de la maqueta (`conDefaultsDeLaMaqueta`, aplicado en el borde de la lectura pública, `server/lecturas/carta/publica.ts`): fondo oscuro, color de marca
 *    verde y tipografía sans. Lo que la sucursal SÍ cargó en su Tema manda siempre (nada de lo guardado se pisa ni se toca). El resolvedor del tema (`resolverEstiloCarta`) no cambia;
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

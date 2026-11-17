/**
 * INTERRUPTOR de los filtros extra de la lista de Productos (Frente 6, pantallas, paso 6 del plan; decisión del dueño, 2026-11-17: «2a», a la pregunta «En la lista de productos, Pedernal solo tiene Buscar,
 * ¿Qué es? y el botón Oculto; nosotros tenemos 4 filtros más… ¿Los ocultamos sin borrarlos (reversible) para que sea igual a Pedernal, o los dejamos?» — la respuesta fue ocultar «Cómo se vende»,
 * «En esta sucursal» y «Le falta algo» y dejar Buscar, «¿Qué es?» y «Estado»; regla de poda del 2026-10-28). Una sola constante.
 *
 * Con `false` (hoy) la lista de Productos NO ofrece esos tres controles (el desplegable «Más filtros» desaparece). No se borra nada: la consulta del servidor, los permisos, los parámetros de la dirección
 * (`?modo=…&disponible=…&falta=…`) y los filtros siguen funcionando como siempre si alguien llega con ellos en la URL (y «Limpiar filtros» los saca); solo dejan de estar a mano en pantalla. La marca
 * «Falta completar» de cada fila y el filtro «Estado» no cambian.
 * Con `true` vuelve el desplegable «Más filtros» tal cual. Lo comprueba `test/catalogo/filtros-extra-de-la-lista-interruptor.test.tsx` (los dos estados). Para volver a mostrarlos: poner `true`.
 */
export const FILTROS_EXTRA_DE_LA_LISTA_VISIBLES: boolean = false;

/** Los filtros que se ofrecen detrás de «Más filtros»: todos si el interruptor está encendido, ninguno si está apagado. */
export function masFiltrosOfrecidos<T>(masFiltros: readonly T[], visibles: boolean = FILTROS_EXTRA_DE_LA_LISTA_VISIBLES): readonly T[] {
  return visibles ? masFiltros : [];
}

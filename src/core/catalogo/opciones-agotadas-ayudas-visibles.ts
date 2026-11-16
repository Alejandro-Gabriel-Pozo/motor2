/**
 * INTERRUPTOR de los textos explicativos de «Opciones agotadas» (Frente 6, pantallas; decisión del dueño, 2026-11-16: «Sí, ese orden (Recomendada)», paso 3 «Opciones agotadas/Permisos/Capacidades»; criterio: «las pantallas
 * de pedernal, son con menos datos y más justas»). Una sola constante. Con `false` (hoy) NO se dibujan los textos de abajo; con `true` vuelven tal cual (nada más: no cambia el servidor, ni lo guardado, ni los permisos, ni ningún botón).
 *
 * TEXTOS QUE SE OCULTAN (declarados; los botones «Disponible/Agotada», el buscador, «Agotadas ahora», el bloque «Con esto, hoy no se pueden vender…», los avisos de stock y «Deshacer» se quedan):
 *  1. El párrafo «Lo que se acabó hoy: tocá una opción para marcarla agotada. No se ofrece en el salón ni en la carta de esta sucursal hasta que la vuelvas a prender (no se prende sola). Un plato entero se agota en Carta › Hoy.»
 *     (con él sale ese enlace a Carta › Hoy; sigue en las pestañas de Carta).
 *  2. El conteo de cada grupo: «· N de M disponibles».
 * Lo comprueba `test/catalogo/opciones-agotadas-ayudas-interruptor.test.tsx`. Para volver a mostrarlos: poner `true`.
 */
export const OPCIONES_AGOTADAS_AYUDAS_VISIBLES: boolean = false;

/**
 * INTERRUPTOR de los textos repetidos de las matrices de administración «Permisos» y «Capacidades por sucursal» (Frente 6, pantallas; decisión del dueño, 2026-11-16: «Sí, ese orden (Recomendada)», paso 3; criterio: «las
 * pantallas de pedernal, son con menos datos y más justas»). Una sola constante. Con `false` (hoy) NO se dibujan los textos de abajo; con `true` vuelven tal cual. No cambia el servidor, ni lo guardado, ni los permisos, ni
 * ninguna casilla o botón; la descripción de cada acción en «Permisos» NO se toca (es lo único legible de cada fila).
 *
 * TEXTOS QUE SE OCULTAN (declarados):
 *  Permisos:
 *   1. La nota al pie «Tocar «Editar» también prende «Ver»… Las claves de solo ver (los reportes) no tienen «Editar»…» (en el modo edición SÍ se muestra: ahí las reglas importan).
 *  Capacidades por sucursal:
 *   2. El párrafo de arriba «Columna "Default" = comportamiento para cualquier sucursal sin fila propia…».
 *   3. La marca «hereda del Default» bajo cada casilla (queda para el lector de pantalla, solo sin verse).
 * Lo comprueba `test/permisos/matrices-ayudas-interruptor.test.tsx` (los dos estados, en `permisos-matriz`). Para volver a mostrarlos: poner `true`.
 */
export const MATRICES_AYUDAS_VISIBLES: boolean = false;

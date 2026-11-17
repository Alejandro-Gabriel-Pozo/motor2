/**
 * INTERRUPTOR de «Nueva sección de carta» con SOLO el nombre (Frente 6, pantallas; decisión del dueño, 2026-11-16: «Sí, ese orden (Recomendada)», paso 1 «nueva sección con solo el nombre», y «Lista simple como
 * Pedernal (Recomendada)»). Una sola constante. Con `true` (hoy) el alta pide solo el nombre, como Pedernal; el resto de los datos de la sección se completan en SU pantalla (`/carta/parametrizacion/secciones/[id]`),
 * que ya los tiene. Con `false` vuelve el alta de antes, con los cinco campos. Para volver: poner `false` (nada más).
 *
 * DATOS QUE NO SE PIDEN EN EL ALTA (declarados): título, descripción, imagen (URL) y orden. No se pierde ninguno: la acción `guardarSeccionCarta` es la misma y los acepta vacíos; el título y la imagen quedan vacíos y el
 * orden cae al final de la lista (la cantidad de secciones, igual que el valor sugerido de antes). Solo cambia la PANTALLA; el servidor, lo guardado y los permisos no se tocan. Lo comprueba
 * `test/carta/alta-de-seccion-solo-nombre.test.tsx` (los dos estados).
 */
export const ALTA_DE_SECCION_SOLO_NOMBRE: boolean = true;

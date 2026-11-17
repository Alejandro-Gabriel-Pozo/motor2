/**
 * INTERRUPTOR de la vista plegada de «Opciones agotadas» (Frente 6, pantallas; decisión del dueño, 2026-11-16, viendo la captura a 375 px: «Sí, aprobado (Recomendada)», paso 3). Una sola constante.
 * Con `true` (hoy): los grupos con alguna opción agotada van PRIMERO y abiertos; los que tienen todo disponible quedan plegados («N · todas disponibles») y se abren tocando el nombre o buscando.
 * El orden y lo abierto se fijan al cargar la pantalla (dentro del grupo que se está tocando nada se mueve ni se cierra); lo agotado después se acomoda al recargar. Con `false` vuelve la lista de
 * siempre: todos los grupos abiertos, en el orden del servidor (alfabético).
 * Solo es pantalla: no cambia el servidor, ni lo guardado, ni los permisos, ni ningún botón. Lo comprueba `test/catalogo/opciones-agotadas-plegadas-interruptor.test.tsx` (los dos estados).
 */
export const OPCIONES_AGOTADAS_PLEGADAS: boolean = true;

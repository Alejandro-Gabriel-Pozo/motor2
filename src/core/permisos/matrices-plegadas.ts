/**
 * INTERRUPTORES de las vistas plegadas de «Permisos» y «Capacidades por sucursal» (Frente 6, pantallas; decisión del dueño, 2026-11-16, viendo la captura a 375 px: «Sí, aprobado (Recomendada)», paso 3).
 * Una constante por pantalla. Con `true` (hoy):
 *  - Permisos: las acciones se agrupan por módulo y, en la lectura, cada módulo queda plegado (se abre tocando su nombre); en la edición se ven todas (ahí hay que revisar cada casilla).
 *  - Capacidades por sucursal: un bloque plegado por módulo, cada uno con su tabla.
 * Con `false` vuelve la tabla única de siempre, con todas las acciones a la vista. Solo es pantalla: no cambia el servidor, ni lo guardado, ni los permisos, ni ninguna casilla.
 * El agrupado sale del catálogo (`agruparAccionesPorModulo`): un módulo o una acción nueva entra solo en su grupo. Lo comprueba `test/permisos/matrices-plegadas-interruptor.test.tsx` (los dos estados).
 */
export const PERMISOS_PLEGADOS: boolean = true;
export const CAPACIDADES_PLEGADAS: boolean = true;

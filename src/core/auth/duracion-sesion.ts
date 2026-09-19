/**
 * Cuánto dura la sesión (Auth.js, estrategia de base de datos: cada sesión es una fila de `Session` con su `expires`).
 *
 * Vence a las 12 horas SIN ACTIVIDAD, no a las 12 horas de haber entrado: mientras la persona usa la aplicación, Auth.js
 * corre el vencimiento hacia adelante cada `ACTUALIZAR_CADA_S`. Cubre un turno completo; si alguien no toca la app en 12 horas,
 * tiene que volver a entrar. El valor por defecto de Auth.js era 30 días, demasiado para tablets compartidas del local: una
 * sesión olvidada abierta seguía sirviendo un mes. Al vencer, el login recuerda la pantalla y vuelve a ella (ver `irAlLogin`).
 */
export const DURACION_SESION_S = 12 * 60 * 60;

/** Cada cuánto, con uso, se corre el vencimiento hacia adelante. Tiene que ser menor que `DURACION_SESION_S`. */
export const ACTUALIZAR_CADA_S = 60 * 60;

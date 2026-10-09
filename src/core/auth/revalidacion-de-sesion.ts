/**
 * Cada cuánto se REVALIDA una sesión viva contra la base (M-20 de la auditoría intermedia; decidido por el dueño: «5 minutos»).
 *
 * El motivo: la sesión dura hasta 12 horas (`DURACION_SESION_S`) y el callback `session` de Auth.js solo miraba `User.activoGlobal`. Quien perdía la membresía (su `UsuarioEmpresa` o su
 * `UsuarioSucursal` pasaba a inactivo) conservaba la sesión hasta que venciera. Con esto, como máximo 5 minutos después de la baja la sesión cae y la persona vuelve a `/login`. Es un tope
 * y no una consulta por pedido: dentro de la ventana no se toca la base (el costo de revalidar es una lectura por sesión cada 5 minutos, por instancia).
 *
 * La marca vive en la memoria de la instancia, no en la sesión: la tabla `Session` de Auth.js no tiene dónde guardarla (y el esquema no se toca por esto). Consecuencias, todas del lado seguro:
 * una instancia nueva (cold start) revalida de entrada; si la revalidación FALLA (base caída) no se anota nada y el siguiente pedido vuelve a intentarla; y el tope de 5 minutos vale en cada instancia.
 * Se recuerda también el veredicto NEGATIVO (la sesión de quien perdió la membresía no consulta la base en cada pedido hasta que venza, y sin escribir la base desde el borde del login).
 */
export const REVALIDAR_SESION_CADA_MS = 5 * 60 * 1000;

/** Tope de sesiones que el registro recuerda a la vez: al pasarlo se barren las vencidas y, si siguen sobrando, las más viejas (olvidar una sesión solo cuesta una revalidación de más). */
export const MAXIMO_DE_SESIONES_REVALIDADAS = 5_000;

/** Registro en memoria del último veredicto de cada sesión (por su token). `ahora` es el instante en milisegundos: el registro no lee el reloj. */
export function crearRegistroDeRevalidacion(cadaMs = REVALIDAR_SESION_CADA_MS, maximo = MAXIMO_DE_SESIONES_REVALIDADAS) {
  const ultimos = new Map<string, { instante: number; vigente: boolean }>();

  const podar = (ahora: number): void => {
    for (const [clave, v] of ultimos) if (ahora - v.instante >= cadaMs) ultimos.delete(clave);
    for (const clave of ultimos.keys()) {
      if (ultimos.size <= maximo) break;
      ultimos.delete(clave);
    }
  };

  return {
    /** El veredicto anotado si todavía rige (pasó MENOS que el tope desde que se anotó); `undefined` si la sesión nunca se revalidó acá o ya hay que volver a mirar la base. */
    veredictoVigente(clave: string, ahora: number): boolean | undefined {
      const v = ultimos.get(clave);
      return v !== undefined && ahora - v.instante < cadaMs ? v.vigente : undefined;
    },
    /** Anota el resultado de una revalidación que SÍ se pudo hacer. */
    anotar(clave: string, ahora: number, vigente: boolean): void {
      ultimos.delete(clave);
      ultimos.set(clave, { instante: ahora, vigente });
      if (ultimos.size > maximo) podar(ahora);
    },
    recordadas(): number {
      return ultimos.size;
    },
  };
}

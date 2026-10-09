/**
 * Rate limiting en memoria, por usuarioId — hallazgo de la auditoría de
 * backend: ninguna acción tenía límite de velocidad, así que un loop
 * descontrolado (bug de cliente, o una cuenta autenticada comprometida)
 * podía martillar cualquier mutación sin freno.
 *
 * Deliberadamente simple y "best effort": Vercel corre funciones
 * serverless sin estado compartido entre instancias, así que esto NO es
 * un límite distribuido — cada instancia cuenta por su cuenta, y el
 * conteo se pierde en un cold start. No reemplaza un WAF/Redis real si
 * algún día hace falta defenderse de un ataque de verdad; sí corta de
 * raíz el caso real y barato de resolver hoy: un bug o script que entra
 * en loop contra el mismo usuario autenticado.
 *
 * Límite alto a propósito (no es antiabuso agresivo): tiene que convivir
 * con flujos legítimos de carga masiva (ej. la grilla de Conteo Físico,
 * que puede disparar decenas de `registrarConteoFisico` seguidos al
 * confirmar).
 */
/**
 * Tope de claves que el limitador recuerda a la vez (M-17 de la auditoría intermedia): con claves que pone un anónimo (la IP, o un IPv6 que rota) el mapa crecía sin límite dentro de la instancia
 * porque nadie liberaba una clave vencida. Al pasar el tope se barren las ventanas vencidas y, si siguen sobrando, se olvidan las claves MÁS VIEJAS: lo peor que le pasa a una clave olvidada es
 * que su conteo empiece de cero (best effort, como todo este limitador), nunca que se agote la memoria de la instancia.
 */
export const MAXIMO_DE_CLAVES_DEL_LIMITADOR = 5_000;

export function crearLimitadorDeTasa(limite: number, ventanaMs: number, maximoDeClaves = MAXIMO_DE_CLAVES_DEL_LIMITADOR) {
  const ventanas = new Map<string, { conteo: number; venceEn: number }>();

  /** Libera lo vencido y, si aun así hay más claves que el tope, las más viejas (el `Map` conserva el orden de inserción: la primera es la más antigua en entrar). */
  const podar = (ahora: number): void => {
    for (const [clave, v] of ventanas) if (ahora > v.venceEn) ventanas.delete(clave);
    for (const clave of ventanas.keys()) {
      if (ventanas.size <= maximoDeClaves) break;
      ventanas.delete(clave);
    }
  };

  return {
    /** `ahora` es el instante en milisegundos (Pureza 1.3): el limitador no lee el reloj, se lo pasa quien lo usa (`conPermiso`, que fija la hora del pedido). */
    excedeLimite(clave: string, ahora: number): boolean {
      const ventana = ventanas.get(clave);
      if (!ventana || ahora > ventana.venceEn) {
        // Una clave vencida se REEMPLAZA al final del orden de inserción (es la más nueva); y solo al crecer se paga la poda.
        ventanas.delete(clave);
        ventanas.set(clave, { conteo: 1, venceEn: ahora + ventanaMs });
        if (ventanas.size > maximoDeClaves) podar(ahora);
        return false;
      }
      ventana.conteo++;
      return ventana.conteo > limite;
    },
    /**
     * M-19: ¿esta clave YA se pasó del límite en su ventana vigente? Solo MIRA, no cuenta: sirve para cortar un pedido antes de gastar base cuando se sabe quién es (la lectura que cuenta,
     * `excedeLimite`, sigue siendo la de después). Una clave sin ventana, o con la ventana vencida, no está pasada.
     */
    yaExcedida(clave: string, ahora: number): boolean {
      const ventana = ventanas.get(clave);
      return ventana !== undefined && ahora <= ventana.venceEn && ventana.conteo > limite;
    },
    /** Cuántas claves recuerda ahora (para probar que no crece sin límite). */
    clavesRecordadas(): number {
      return ventanas.size;
    },
  };
}

// La instancia de las mutaciones (`limitadorMutaciones`, 300 por minuto) vive en `server/actions/limitador-de-mutaciones.ts` (O.33, paso L.2): acá queda
// solo la fábrica, sin estado de módulo.

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
export function crearLimitadorDeTasa(limite: number, ventanaMs: number) {
  const ventanas = new Map<string, { conteo: number; venceEn: number }>();

  return {
    excedeLimite(clave: string): boolean {
      const ahora = Date.now();
      const ventana = ventanas.get(clave);
      if (!ventana || ahora > ventana.venceEn) {
        ventanas.set(clave, { conteo: 1, venceEn: ahora + ventanaMs });
        return false;
      }
      ventana.conteo++;
      return ventana.conteo > limite;
    },
  };
}

const LIMITE_MUTACIONES_POR_MINUTO = 300;
export const limitadorMutaciones = crearLimitadorDeTasa(LIMITE_MUTACIONES_POR_MINUTO, 60_000);

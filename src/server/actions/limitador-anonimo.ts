import { crearLimitadorDeTasa } from "@/core/permisos/limitador-tasa";

/**
 * Cupo por ORIGEN de las puertas que un ANÓNIMO puede golpear (S-27, T11 del endurecimiento; guard GT-8): hoy `abrirInvitacion`, que con un token de forma válida
 * consulta la base (la invitación por su hash y su empresa). El token es de 256 bits y no se adivina, pero nada impedía que un script sin cuenta mandara miles por minuto desde
 * una sola conexión y le gastara a TODAS las empresas la base que comparten (Neon). Es el mismo mecanismo que el cupo por origen de la consola
 * (`plataforma/src/servidor/limitador-de-pedidos.ts`, S-08), con su propia instancia: lo que gasta un origen acá no le descuenta nada al ingreso de la consola.
 *
 * La INSTANCIA vive acá y no en `core` (que no tiene estado de módulo: `core-sin-estado-de-modulo.test.ts`). BEST EFFORT y declarado: la memoria de UNA instancia
 * (Vercel corre varias, sin estado compartido; se pierde en un arranque en frío), así que no frena a quien rota de IP ni a quien cae en instancias distintas. El cierre real es
 * el firewall de Vercel (E.6 del plan de endurecimiento: límite por IP a los POST con `next-action` sin cookie de sesión). Lo que sí corta es el bucle barato desde un solo origen.
 *
 * Los números dejan pasar lo legítimo: abrir un enlace es UN pedido (más un par de recargas), y aun si todo el personal de un local, detrás de la misma IP, abre sus
 * invitaciones a la vez, son pocas decenas. Es un default a confirmar por el dueño (decisión B15 del carril B), revertible cambiando estas constantes.
 */
export const MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN = 30;
export const VENTANA_DE_APERTURAS_DE_INVITACION_MS = 10 * 60 * 1000;

/** Lo que ve quien se pasó del cupo: no dice nada de la invitación (existe o no, vence o no), solo que espere. */
export const MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION = "Demasiados intentos desde esta conexión. Esperá unos minutos y volvé a abrir el enlace.";

const limitadorDeAperturas =crearLimitadorDeTasa(MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN, VENTANA_DE_APERTURAS_DE_INVITACION_MS);

/**
 * La IP de quien pide: el primer valor de `x-forwarded-for` (Vercel lo fija con la IP del cliente y descarta lo que el cliente haya mandado; fuera de Vercel el primer valor
 * se puede falsear, y por eso esto no es una defensa de verdad). Sin la cabecera (desarrollo local, E2E) no hay origen que contar: `null`.
 */
export function origenDelPedido(cabeceras: Pick<Headers, "get">): string | null {
  const primero = cabeceras.get("x-forwarded-for")?.split(",")[0]?.trim();
  return primero ? primero : null;
}

/** ¿Este origen ya gastó su cupo de aperturas de invitación? Cuenta el pedido que se está atendiendo. Sin origen conocido, nunca. `ahora` en milisegundos: el limitador no lee el reloj. */
export function origenSinCupoParaAbrirInvitacion(origen: string | null, ahora: number): boolean {
  return origen !== null && limitadorDeAperturas.excedeLimite(origen, ahora);
}

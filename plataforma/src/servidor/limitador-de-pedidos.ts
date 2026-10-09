import { crearLimitadorDeTasa } from "@/core/permisos/limitador-tasa";
import { MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN, VENTANA_DE_PEDIDOS_POR_ORIGEN_MS } from "@/core/plataforma/limites";

/**
 * Cupo por ORIGEN de los pedidos de código de ingreso (S-08, T4): complementa el tope por administrador (que se cuenta en la base, bajo el cerrojo de su fila) con
 * uno por la IP de quien pide, para que un anónimo que insiste con el email de un administrador se quede sin pedidos antes de agotarle el cupo al administrador.
 *
 * BEST EFFORT y declarado: vive en la memoria de la instancia (Vercel corre varias, sin estado compartido; se pierde en un arranque en frío), así que no frena a
 * quien tiene muchas IP ni a quien cae en instancias distintas. El cierre de verdad es el firewall de Vercel (E.6 del plan de endurecimiento: límite por IP al
 * `/login` de la consola). Lo que sí garantiza es la parte barata: un bucle desde un solo origen no le agota al administrador su techo de correo.
 *
 * Cuando se excede, la consola responde IGUAL (misma pantalla, misma cookie): solo que no prepara ni manda nada. No se distingue de «el email no es de un administrador».
 */
const limitador = crearLimitadorDeTasa(MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN, VENTANA_DE_PEDIDOS_POR_ORIGEN_MS);

/**
 * La IP de quien pide: el primer valor de `x-forwarded-for` (Vercel lo fija con la IP del cliente). Sin la cabecera (desarrollo local, E2E) no hay origen que
 * contar: `null`.
 */
export function origenDelPedido(cabeceras: Pick<Headers, "get">): string | null {
  const primero = cabeceras.get("x-forwarded-for")?.split(",")[0]?.trim();
  return primero ? primero : null;
}

/** ¿Este origen ya gastó su cupo de pedidos de código? Cuenta el pedido que se está atendiendo. Sin origen conocido, nunca. */
export function origenSinCupoDeCodigos(origen: string | null, ahora: number): boolean {
  return origen !== null && limitador.excedeLimite(origen, ahora);
}

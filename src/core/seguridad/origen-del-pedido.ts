/**
 * De dónde viene un pedido, para los cupos por ORIGEN de las puertas anónimas (invitación) y de la consola (M-18 de la auditoría intermedia).
 *
 * Antes, sin `x-forwarded-for`, el origen era `null` y los cupos decían «sin origen conocido, nunca»: la puerta quedaba SIN cupo. En Vercel esa cabecera la fija la plataforma y no se puede
 * falsear, pero detrás de otro proxy, o con un pedido que llega sin ella, el cupo desaparecía justo para quien más lo necesita. Va contra «denegar por defecto»: ahora todo pedido sin origen
 * cuenta en UN balde común, `ORIGEN_DESCONOCIDO`, con el MISMO cupo que cualquier otro origen (no ilimitado). El costo es que los pedidos sin origen se reparten entre sí un solo cupo: es el
 * lado seguro (el servidor de Next ya completa la cabecera con la IP del socket, así que en la práctica este balde casi no se usa).
 *
 * La clave no puede ser una IP (lleva paréntesis): una cabecera mentirosa no puede pisarla con un valor propio.
 */
export const ORIGEN_DESCONOCIDO = "(sin-origen)";

/** El primer valor de `x-forwarded-for` (recortado), o `ORIGEN_DESCONOCIDO` si la cabecera falta o viene vacía. */
export function origenDeLasCabeceras(cabeceras: Pick<Headers, "get">): string {
  const primero = cabeceras.get("x-forwarded-for")?.split(",")[0]?.trim();
  return primero ? primero : ORIGEN_DESCONOCIDO;
}

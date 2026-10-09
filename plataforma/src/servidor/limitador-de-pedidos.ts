import { crearLimitadorDeTasa } from "@/core/permisos/limitador-tasa";
import { MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN, VENTANA_DE_PEDIDOS_MS } from "@/core/plataforma/limites";
import { ORIGEN_DESCONOCIDO, origenDeLasCabeceras } from "@/core/seguridad/origen-del-pedido";

/**
 * Cupo por ORIGEN de los pedidos de código de ingreso (S-08, T4): complementa el tope por administrador (que se cuenta en la base, bajo el cerrojo de su fila) con
 * uno por la IP de quien pide, para que un anónimo que insiste con el email de un administrador se quede sin pedidos antes de agotarle el cupo al administrador.
 * El valor NO es independiente del techo: se deriva de él (`core/plataforma/limites.ts`), porque con el cupo de antes (6 cada 10 minutos contra un techo de 10 por
 * hora) una sola IP lo agotaba (I-1 de la auditoría intermedia).
 *
 * BEST EFFORT y declarado: vive en la memoria de la instancia (Vercel corre varias, sin estado compartido; se pierde en un arranque en frío), así que no frena a
 * quien tiene muchas IP ni a quien cae en instancias distintas: con muchas IP el techo del administrador SIGUE siendo agotable. El cierre de verdad es el firewall
 * de Vercel (E.6 del plan de endurecimiento: límite por IP al `/login` de la consola) y contar por origen en la base (columna `origen`, [MIG], B10): ninguno está
 * hecho. Lo que sí garantiza es la parte barata: un bucle desde un solo origen no le agota al administrador su techo de correo.
 *
 * Cuando se excede, la consola responde IGUAL (misma pantalla, misma cookie): solo que no prepara ni manda nada. No se distingue de «el email no es de un administrador».
 */
const limitador = crearLimitadorDeTasa(MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN, VENTANA_DE_PEDIDOS_MS);

/**
 * La IP de quien pide: el primer valor de `x-forwarded-for` (Vercel lo fija con la IP del cliente). Sin la cabecera el pedido NO queda sin cupo (M-18): cuenta en el balde común
 * `ORIGEN_DESCONOCIDO` (`core/seguridad/origen-del-pedido.ts`), con el mismo cupo que cualquier origen.
 */
export function origenDelPedido(cabeceras: Pick<Headers, "get">): string {
  return origenDeLasCabeceras(cabeceras);
}

/** ¿Este origen ya gastó su cupo de pedidos de código? Cuenta el pedido que se está atendiendo. Un origen ausente (`null`) cuenta en el balde común de los desconocidos, nunca sin cupo (M-18). */
export function origenSinCupoDeCodigos(origen: string | null, ahora: number): boolean {
  return limitador.excedeLimite(origen ?? ORIGEN_DESCONOCIDO, ahora);
}

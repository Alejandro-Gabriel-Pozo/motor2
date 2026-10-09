import { generarTokenOpaco } from "@/core/seguridad/tokens";
import type { FuenteDeAzar } from "@/core/seguridad/azar";

/**
 * El PEDIDO de un código de ingreso a la consola (S-08, ADR-019): lo que ata un código del mail al navegador que lo pidió.
 *
 * Antes el código era «el último vigente del administrador»: cualquiera que conociera el email de un administrador pedía códigos, y cada pedido invalidaba el
 * anterior y gastaba el cupo por hora del administrador de verdad. Ahora cada pedido genera, SIEMPRE (exista o no el email, para que la respuesta no delate nada),
 * un par `codigoId` + `nonce` que viaja en una cookie del navegador que pidió:
 *  - `codigoId` es el id de la fila del código en la base: la verificación busca ESE código, no «el último»; los intentos que gasta un atacante son los de sus
 *    propios códigos y un pedido ajeno ya no invalida el código vigente de nadie;
 *  - `nonce` (256 bits) entra al contexto del HMAC del código (`ingreso:<admin>:<codigoId>:<nonce>`): el código solo se puede comprobar con la cookie del
 *    navegador que lo pidió. La base guarda el HMAC, no el nonce.
 * Puro: el azar entra por el puerto y la cookie se arma y se lee acá, para que el servidor de la consola y los E2E usen exactamente el mismo formato.
 */
export interface PedidoDeIngreso {
  codigoId: string;
  nonce: string;
}

/** La cookie del pedido: `__Host-` en https (mismo criterio que la de sesión), sin prefijo sin https. `SameSite=Strict`, `httpOnly`, 10 minutos (lo que vive el código). */
export const COOKIE_DE_PEDIDO_HTTPS = "__Host-plataforma.ingreso";
export const COOKIE_DE_PEDIDO_HTTP = "plataforma.ingreso";

const FORMA_DEL_PEDIDO = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;

/** Un pedido nuevo: 128 bits para el id del código y 256 para el nonce. */
export function generarPedidoDeIngreso(azar: FuenteDeAzar): PedidoDeIngreso {
  return { codigoId: Buffer.from(azar.bytes(16)).toString("hex"), nonce: generarTokenOpaco(azar) };
}

/** El valor de la cookie: `<codigoId>.<nonce>`. */
export function serializarPedidoDeIngreso(pedido: PedidoDeIngreso): string {
  return `${pedido.codigoId}.${pedido.nonce}`;
}

/** Lee la cookie. Cualquier valor que no tenga exactamente la forma que se genera (ausente, recortado, con otro largo o alfabeto) es `null`. */
export function leerPedidoDeIngreso(valor: string | null | undefined): PedidoDeIngreso | null {
  const partes = FORMA_DEL_PEDIDO.exec(valor ?? "");
  return partes ? { codigoId: partes[1], nonce: partes[2] } : null;
}

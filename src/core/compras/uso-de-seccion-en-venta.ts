import { USOS_DE_SECCION, type UsoDeSeccion } from "./destino-de-recepcion";

/**
 * Compras, depósitos de uso RECHAZO y CUARENTENA, etapa (ii-a) (docs/diseno-compras-cuarentena-y-rechazo-2026-11-17.md, «Implementación — etapa (ii-a)»; oráculo `docs/oraculo-combinaciones-compras-exclusion-de-venta-2026-11-17.md`): qué usos de depósito
 * sirven para VENDER. Como Pedernal («disponible» solo cuenta depósitos de uso NORMAL; la venta rechaza otro uso), pedido del dueño 2026-11-17 («4.-lo recomendado», «Sí, todo como Pedernal»). Puro: sin base ni Prisma.
 * Todo nace cerrado: un uso que no está declarado acá NO sirve (el tipo obliga a declarar el efecto de cada uso nuevo, y el guardián del oráculo también).
 */

/** El efecto de cada uso de depósito en la venta. Un uso nuevo en `USOS_DE_SECCION` no compila hasta que se lo declara acá. */
export const EFECTO_DE_USO_EN_LA_VENTA: Readonly<Record<UsoDeSeccion, "SIRVE" | "NO_SIRVE">> = {
  NORMAL: "SIRVE",
  CUARENTENA: "NO_SIRVE",
  RECHAZO: "NO_SIRVE",
};

/** Lista de PERMITIDOS: los usos de depósito desde los que se puede vender (el `where` de las lecturas de venta usa `{ in: USOS_QUE_SIRVEN_PARA_VENDER }`). */
export const USOS_QUE_SIRVEN_PARA_VENDER: readonly UsoDeSeccion[] = USOS_DE_SECCION.filter((uso) => EFECTO_DE_USO_EN_LA_VENTA[uso] === "SIRVE");

/** ¿Sirve este depósito para vender? Falla cerrada: cualquier valor que no sea un uso declarado como «sirve» da `false`. */
export function usoSirveParaVender(uso: unknown): boolean {
  return typeof uso === "string" && (USOS_QUE_SIRVEN_PARA_VENDER as readonly string[]).includes(uso);
}

/** PROPUESTO (no aprobado por el dueño; lo ve el cliente de empresa): el rechazo del mostrador cuando la sección elegida es de cuarentena o de rechazo. */
export const MENSAJE_SECCION_NO_SIRVE_PARA_VENDER = "Ese depósito es de cuarentena o de rechazo: no se puede vender desde ahí.";

import type { Prisma } from "@prisma/client";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { InvarianteViolada, primeraInvarianteViolada } from "@/core/permisos/invariantes";
import type { Db } from "@/lib/db-tipos";
import { medirEstadoDeGobierno } from "@/server/lecturas/permisos/gobierno";
import { error, type ResultadoAccion } from "./tipos";

/**
 * Toda acción que cambia usuarios, roles o sucursales corre acá: una transacción SERIALIZABLE con reintento, donde se leen las condiciones, se
 * escribe y se hacen cumplir las invariantes de gobierno (`conInvariantesDeGobierno`). Si una invariante se rompe, la escritura se deshace y la
 * persona recibe el mensaje; cualquier otro error sigue de largo.
 *
 * Como el cuerpo puede reintentarse, adentro NO va ningún efecto externo (un mail, una llamada a otro servicio): eso va después, con el resultado.
 *
 * Dos formas (Hito 3, Fase I): la de las Server Actions, que devuelve el mensaje de la invariante como `error(...)` (`ResultadoAccion`), y la de los
 * casos de uso, que pasan `siSeViola` para devolverlo en SU forma (un `fracaso` con código, que la acción traduce con `aResultadoAccion`). El cuerpo
 * es el mismo: misma transacción, mismo reintento, misma invariante.
 */
export async function conGobierno<T extends ResultadoAccion>(ctx: Pick<ContextoUsuario, "transaccion">, cuerpo: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | ResultadoAccion>;
export async function conGobierno<T, R>(ctx: Pick<ContextoUsuario, "transaccion">, cuerpo: (tx: Prisma.TransactionClient) => Promise<T>, siSeViola: (mensaje: string) => R): Promise<T | R>;
export async function conGobierno<T, R>(
  ctx: Pick<ContextoUsuario, "transaccion">,
  cuerpo: (tx: Prisma.TransactionClient) => Promise<T>,
  siSeViola?: (mensaje: string) => R,
): Promise<T | R | ResultadoAccion> {
  try {
    return await conTransaccionSerializable(ctx.transaccion, cuerpo);
  } catch (e) {
    if (e instanceof InvarianteViolada) return siSeViola ? siSeViola(e.mensaje) : error(e.mensaje);
    throw e;
  }
}

/**
 * Mide el estado de gobierno, corre la escritura y vuelve a medir: si la escritura empeoró (a), (b) o (f), lanza `InvarianteViolada` y la
 * transacción entera se deshace. Va dentro de `conTransaccionSerializable` (o de `conGobierno`): dos pedidos simultáneos que se sacan el último admin
 * el uno al otro no pueden aplicarse los dos.
 *
 * Vivía en `core/permisos/invariantes.ts` (Hito 3, Fase II, II.3 de `docs/plan-hito-3-pureza.md`): se mudó tal cual, con el mismo nombre y firma. Las reglas que
 * compara (`primeraInvarianteViolada`) siguen puras en `core/permisos/invariantes.ts`; la medición (`medirEstadoDeGobierno`) es la lectura de
 * `server/lecturas/permisos/gobierno.ts`. La usan los casos de uso de gobierno (dentro de su transacción) y la aceptación de las invitaciones.
 */
export async function conInvariantesDeGobierno<T>(tx: Db, empresaId: string, escribir: () => Promise<T>): Promise<T> {
  const antes = await medirEstadoDeGobierno(tx, empresaId);
  const resultado = await escribir();
  const mensaje = primeraInvarianteViolada(antes, await medirEstadoDeGobierno(tx, empresaId));
  if (mensaje) throw new InvarianteViolada(mensaje);
  return resultado;
}

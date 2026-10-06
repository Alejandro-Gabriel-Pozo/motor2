import type { Prisma } from "@prisma/client";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { InvarianteViolada } from "@/core/permisos/invariantes";
import { error, type ResultadoAccion } from "./tipos";

/**
 * Toda acción que cambia usuarios, roles o sucursales corre acá: una transacción SERIALIZABLE con reintento, donde se leen las condiciones, se
 * escribe y se hacen cumplir las invariantes de gobierno (`conInvariantesDeGobierno`). Si una invariante se rompe, la escritura se deshace y la
 * persona recibe el mensaje; cualquier otro error sigue de largo.
 *
 * Como el cuerpo puede reintentarse, adentro NO va ningún efecto externo (un mail, una llamada a otro servicio): eso va después, con el resultado.
 */
export async function conGobierno<T extends ResultadoAccion>(ctx: Pick<ContextoUsuario, "transaccion">, cuerpo: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | ResultadoAccion> {
  try {
    return await conTransaccionSerializable(ctx.transaccion, cuerpo);
  } catch (e) {
    if (e instanceof InvarianteViolada) return error(e.mensaje);
    throw e;
  }
}

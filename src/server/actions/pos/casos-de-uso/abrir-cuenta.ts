import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_MESA_NO_ENCONTRADA } from "@/core/features/cuentas/cuenta-apertura.guard";
import type { ComandoAbrirCuenta, ResultadoAbrirCuenta } from "@/core/features/cuentas/cuenta-apertura.schema";
import { esChoqueDeIndiceUnico } from "@/core/movimientos/public-servidor";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { validarComensales } from "@/core/pos/cuenta";
import { exito, fracaso } from "@/core/resultado-caso";
import { abrirCuentaDeMesa } from "@/server/persistencia/pos/cuenta";

/**
 * Caso de uso «abrir la cuenta de una mesa» (Hito 4 de la pureza, bloque 4.1, paso 8 — `docs/plan-hito-4-pureza.md` §5). Es el cuerpo que antes vivía en línea
 * en la Server Action `abrirCuenta` (`src/server/actions/pos/cuenta-apertura.ts`), movido con el mismo orden de chequeos y los mismos mensajes; desde M1 (S-51) la
 * mesa y el límite de su sucursal se leen DENTRO de la transacción SERIALIZABLE (antes, con `actor.db`, afuera); el choque del índice único se atrapa FUERA de la transacción. La Server Action quedó como adaptador (`conPermiso("pos_abrir_cuenta")` → `guardComandoAbrirCuenta` → este caso de uso →
 * `aResultadoAccion`). El criterio de negocio (comensales obligatorios; idempotencia primero; límite de mesas abiertas, D6) está documentado en la Server
 * Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni que el id de la mesa sea un texto (el guard).
 *
 * Orden, igual que antes:
 *  1. en UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento): la mesa, de ESTA sucursal, con el nombre y el límite de su sucursal (M1: leídos acá, con `tx`);
 *  2. en esa misma transacción: si la mesa ya tiene su cuenta abierta → ok sin tocar nada (ni valida los
 *     comensales ni mira el límite: reabrir la MISMA mesa nunca falla); `validarComensales`; el límite (las cuentas abiertas de la sucursal, contadas dentro de
 *     esta misma transacción: dos aperturas a mesas distintas que juntas lo superarían chocan, nunca pasan las dos); la cuenta nueva (`abrirCuentaDeMesa`,
 *     server/persistencia/pos/cuenta.ts);
 *  3. fuera de la transacción: el choque del índice único parcial (`Cuenta_una_abierta_por_mesa_key`) es ok, «ya tenía una cuenta abierta». Medido en el
 *     Hito 4 (`cuenta-concurrencia`, (a)): la carrera la gana la transacción serializable (la que pierde reintenta y ve la cuenta); el `catch` es el respaldo.
 *     Desde B2 (aprobado por el dueño) lo reconoce `esChoqueDeIndiceUnico` (el helper de 1.7: `P2002` o el `DriverAdapterError` crudo con
 *     `UniqueConstraintViolation`, la forma en que puede llegar con el adaptador `pg`); antes era `esErrorDeUnicidad`, solo `P2002`
 *     (`test/pos/choque-de-unicidad-del-driver.test.ts`).
 *
 * @contract Deja la mesa de la sucursal con su cuenta abierta (a nombre de quien la abre y con sus comensales), salvo que se haya alcanzado el límite de mesas abiertas.
 * @idempotency Por estado — si la mesa ya tenía su cuenta abierta responde ok sin escribir (la transacción serializable y el índice único parcial arbitran la carrera).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento): la mesa, el límite de la sucursal, las cuentas abiertas y la cuenta nueva, todo dentro (M1).
 * @sideEffects Ninguno (la cuenta es su propio documento). Refrescar la vista lo hace el cliente (`router.refresh()`).
 * @ficha permiso=pos_abrir_cuenta transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function abrirCuentaCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "transaccion">,
  comando: ComandoAbrirCuenta,
): Promise<ResultadoAbrirCuenta> {
  // M1 (S-51): la mesa y, con ella, el límite de mesas abiertas de la sucursal se leen DENTRO de la transacción SERIALIZABLE, la misma que cuenta las cuentas abiertas y crea la nueva. Antes la mesa
  // (con `maxMesasAbiertas`) se leía con `actor.db`, afuera: si el límite se bajaba entre esa lectura y la apertura, se comparaba contra un valor viejo y la mesa se abría de más.
  let numeroDeMesa: number | null = null;
  try {
    return await conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAbrirCuenta> => {
      const mesa = await tx.mesa.findFirst({ where: { id: comando.mesaId, sucursalId: actor.sucursalId }, include: { sucursal: { select: { nombre: true, maxMesasAbiertas: true } } } });
      if (!mesa) return fracaso("MESA_NO_ENCONTRADA", MENSAJE_MESA_NO_ENCONTRADA);
      numeroDeMesa = mesa.numero;
      const yaAbierta = await tx.cuenta.findFirst({ where: { mesaId: mesa.id, cerradaEn: null }, select: { id: true } });
      if (yaAbierta) return exito(`La mesa ${mesa.numero} ya tenía una cuenta abierta.`, null);

      const val = validarComensales(comando.comensales);
      if (!val.ok) return fracaso("COMENSALES_INVALIDOS", val.mensaje);

      if (mesa.sucursal.maxMesasAbiertas !== null) {
        const abiertas = await tx.cuenta.count({ where: { cerradaEn: null, mesa: { sucursalId: actor.sucursalId } } });
        if (abiertas >= mesa.sucursal.maxMesasAbiertas) {
          return fracaso("LIMITE_DE_MESAS", `Se alcanzó el máximo de ${mesa.sucursal.maxMesasAbiertas} mesas abiertas en «${mesa.sucursal.nombre}». Cerrá o liberá una antes de abrir otra.`);
        }
      }

      await abrirCuentaDeMesa(tx, { mesaId: mesa.id, abiertaPorId: actor.usuarioId, comensales: val.comensales });
      return exito(`Cuenta de la mesa ${mesa.numero} abierta.`, null);
    });
  } catch (e) {
    if (esChoqueDeIndiceUnico(e) && numeroDeMesa !== null) return exito(`La mesa ${numeroDeMesa} ya tenía una cuenta abierta.`, null);
    throw e;
  }
}

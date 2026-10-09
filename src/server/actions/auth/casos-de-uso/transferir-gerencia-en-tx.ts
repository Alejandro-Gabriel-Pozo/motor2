import "server-only";
import type { Prisma } from "@prisma/client";
import { mensajeSiElDestinoNoPuedeRecibirLaGerencia, type ResultadoGerencia } from "@/core/permisos/gerencia";
import { obtenerGerenteDeEmpresa } from "@/server/lecturas/permisos/gerencia";
import { esAdminEfectivoEnAlgunaSucursal } from "@/server/lecturas/permisos/gobierno";
import { bajarGerenciaSiSigue, darGerencia } from "@/server/persistencia/auth/gerencia";

const MENSAJE_GERENCIA_CAMBIO = "La gerencia cambió mientras tanto. Recargá la pantalla y volvé a intentar.";

/**
 * PASO COMPARTIDO (sin ficha: no lo importa ninguna Server Action, lo componen los casos de uso de esta carpeta) — Hito 3, Fase I, I.5d de
 * `docs/plan-hito-3-pureza.md`. Es `transferirGerenciaDeEmpresa`, que vivía en `core/permisos/gerencia.ts`, con el MISMO nombre, la misma firma, las mismas lecturas
 * en el mismo orden y los mismos mensajes; sus dos escrituras pasaron a `server/persistencia/auth/gerencia.ts` y la validación del destino a la función pura
 * `mensajeSiElDestinoNoPuedeRecibirLaGerencia` (I.5d0). Lo usan el caso de uso `transferir-gerencia.ts` y, directo, la huella de gobierno (por su adaptador) y
 * `gerente-unico.test.ts`.
 *
 * Pasa la gerencia de la empresa a `usuarioDestinoId`: el gerente actual deja de serlo y el destino lo es, en un solo paso. La empresa nunca queda sin gerente ni
 * con dos: la baja del actual es condicional («sigue siendo el gerente»), así que dos traspasos simultáneos no pueden aplicarse los dos. Corre DENTRO de una
 * transacción, con el cliente `tx`. NO audita: la fila de auditoría la escribe quien la invoca (ADR-012).
 *
 * Quién puede pedirlo se decide afuera: el gerente actual (`transferirGerencia`) o la plataforma. Desde S-11 (O.60) el paso lo vuelve a comprobar con `gerenteEsperadoId`
 * (obligatorio, M-10: el id del gerente que pide; ya no hay `null`): quien tiene la gerencia al leerla acá dentro tiene que ser ese, y con la cuenta activa; si no, «La gerencia cambió…» y no se toca nada. El destino tiene que ser alguien de la empresa, con cuenta y
 * pertenencia activas y admin activo en alguna sucursal (el gerente está por encima del admin: no se salta el escalón).
 */
export async function transferirGerenciaDeEmpresa(
  tx: Prisma.TransactionClient,
  input: { empresaId: string; usuarioDestinoId: string; gerenteEsperadoId: string },
): Promise<ResultadoGerencia> {
  const { empresaId, usuarioDestinoId, gerenteEsperadoId } = input;

  const destino = await tx.usuarioEmpresa.findUnique({
    where: { usuarioId_empresaId: { usuarioId: usuarioDestinoId, empresaId } },
    select: { id: true, activo: true, rolEmpresa: true, usuario: { select: { email: true, activoGlobal: true } } },
  });
  const rechazoDelDestino = mensajeSiElDestinoNoPuedeRecibirLaGerencia(destino);
  // `!destino` solo para que TypeScript lo sepa: con el destino nulo la función ya devolvió su mensaje (el `??` no se alcanza).
  if (rechazoDelDestino || !destino) return { ok: false, mensaje: rechazoDelDestino ?? "Ese usuario no pertenece a esta empresa." };

  if (!(await esAdminEfectivoEnAlgunaSucursal(tx, empresaId, usuarioDestinoId))) return { ok: false, mensaje: "Para ser gerente primero tiene que ser admin activo en alguna sucursal." };

  const actual = await obtenerGerenteDeEmpresa(tx, empresaId);
  // S-11 (O.60): quien pide el traspaso tiene que SEGUIR siendo el gerente, releído acá dentro. El gate de la acción (`traspasar_gerencia`) corre antes de la transacción: si en
  // el medio la gerencia cambió de manos (o la empresa se quedó sin gerente), el pedido de quien ya no lo es no le saca la gerencia al nuevo.
  // M-10 (auditoría intermedia): (a) el id esperado es OBLIGATORIO —antes `null` saltaba el chequeo entero, y solo lo usaban los tests (la plataforma no pasa por acá)—; un valor que no es un texto no vacío
  // se rechaza como «la gerencia cambió», aunque un llamador armado a mano lo mande; (b) además del rol se relee `activo`: si la cuenta del gerente se apagó entre el gate y la transacción, el pedido no pasa.
  if (typeof gerenteEsperadoId !== "string" || gerenteEsperadoId === "" || actual?.usuarioId !== gerenteEsperadoId || !actual.activo) return { ok: false, mensaje: MENSAJE_GERENCIA_CAMBIO };
  if (actual) {
    const bajas = await bajarGerenciaSiSigue(tx, { pertenenciaId: actual.id });
    if (bajas !== 1) return { ok: false, mensaje: MENSAJE_GERENCIA_CAMBIO };
  }
  await darGerencia(tx, { pertenenciaId: destino.id });

  return { ok: true, mensaje: `«${destino.usuario.email}» es ahora el gerente de la empresa.`, gerenteAnteriorId: actual?.usuarioId ?? null };
}

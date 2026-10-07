import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conInvariantesDeGobierno } from "@/core/permisos/invariantes";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { conGobierno } from "../../con-gobierno";
import { transferirGerenciaDeEmpresa } from "./transferir-gerencia-en-tx";

type ResultadoTransferirGerencia = ResultadoCaso<null, "DESTINO_NO_ES_DE_LA_EMPRESA" | "EMAIL_NO_COINCIDE" | "TRASPASO_RECHAZADO" | "INVARIANTE_DE_GOBIERNO">;

/**
 * Caso de uso «traspasar la gerencia de la empresa a otra persona» (el gerente actual deja de serlo; Hito 3, Fase I, I.5d de `docs/plan-hito-3-pureza.md`). Solo lo
 * pide el gerente actual: `traspasar_gerencia` es una acción de piso gerente, que no pasa por la matriz de permisos (la autoridad de empresa no se delega). Se
 * confirma tipeando el email del destino. La baja del actual y el alta del nuevo van en una sola transacción, y queda en la auditoría de la empresa.
 *
 * Es el cuerpo que antes vivía en línea en la Server Action `transferirGerencia` (`src/server/actions/auth/usuarios.ts`), movido TAL CUAL: mismas consultas, mismo
 * orden, mismos mensajes. La Server Action quedó como adaptador (`conPermisoDeEmpresa("traspasar_gerencia")` → este caso de uso → `aResultadoAccion`), sin guard de
 * formato: recibe un id y el email tipeado, que se compara (recortado y en minúsculas) DENTRO de la transacción, después de resolver al destino (`SIN_GUARD`).
 *
 * En la transacción de gobierno (`conGobierno`, serializable con reintento), igual que antes:
 *  1. «Ese usuario no pertenece a esta empresa» si el destino no tiene pertenencia.
 *  2. El email confirmado tiene que coincidir con el del destino: el gerente que traspasa ya no puede deshacerlo solo.
 *  3. Midiendo las invariantes de gobierno antes y después (`conInvariantesDeGobierno`): el traspaso (`transferirGerenciaDeEmpresa`, el paso compartido
 *     `./transferir-gerencia-en-tx.ts`: destino válido, admin efectivo, baja condicional del actual y alta del nuevo) y, si salió bien, su auditoría
 *     (`UsuarioEmpresa.rolEmpresa`, del email de quien traspasa al del destino, sin sucursal: es de la empresa). Si el paso lo rechaza, vuelve su mensaje.
 *
 * Idempotencia POR_ESTADO: la baja del gerente actual es condicional («sigue siendo el gerente»), así que un segundo pedido igual o dos traspasos simultáneos no
 * se aplican dos veces (el segundo encuentra que el destino «ya es el gerente», o que la gerencia cambió mientras tanto).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint.
 *
 * @contract Deja como gerente de la empresa a la persona elegida (y al gerente actual sin la gerencia), con su registro de auditoría, si su email confirma la elección y el traspaso es válido.
 * @idempotency Por estado — la baja condicional del gerente actual arbitra el reintento y la carrera: la gerencia cambia de manos una sola vez.
 * @transaction conGobierno (conTransaccionSerializable con reintento) + conInvariantesDeGobierno alrededor del traspaso; una invariante violada vuelve como fracaso INVARIANTE_DE_GOBIERNO.
 * @sideEffects registrarCambioAuditado (UsuarioEmpresa.rolEmpresa: del gerente anterior al nuevo).
 * @ficha permiso=traspasar_gerencia transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function transferirGerenciaCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "email" | "empresaId" | "transaccion">,
  comando: { usuarioDestinoId: string; emailConfirmado: string },
): Promise<ResultadoTransferirGerencia> {
  const { usuarioDestinoId, emailConfirmado } = comando;
  return conGobierno(
    actor,
    async (tx): Promise<ResultadoTransferirGerencia> => {
      // Se confirma tipeando el email de quien recibe la gerencia: el gerente que traspasa ya no puede deshacerlo solo.
      const destino = await tx.usuarioEmpresa.findUnique({
        where: { usuarioId_empresaId: { usuarioId: usuarioDestinoId, empresaId: actor.empresaId } },
        select: { usuario: { select: { email: true } } },
      });
      if (!destino) return fracaso("DESTINO_NO_ES_DE_LA_EMPRESA", "Ese usuario no pertenece a esta empresa.");
      if (emailConfirmado.trim().toLowerCase() !== destino.usuario.email.trim().toLowerCase()) {
        return fracaso("EMAIL_NO_COINCIDE", "El email no coincide con el de la persona elegida: no se traspasó la gerencia.");
      }
      return conInvariantesDeGobierno(tx, actor.empresaId, async (): Promise<ResultadoTransferirGerencia> => {
        const r = await transferirGerenciaDeEmpresa(tx, { empresaId: actor.empresaId, usuarioDestinoId });
        if (!r.ok) return fracaso("TRASPASO_RECHAZADO", r.mensaje);
        await registrarCambioAuditado(tx, {
          entidad: "UsuarioEmpresa",
          entidadId: usuarioDestinoId,
          descripcion: "Gerente de la empresa",
          campo: "rolEmpresa",
          valorAnterior: actor.email,
          valorNuevo: destino.usuario.email,
          actorId: actor.usuarioId,
          sucursalId: null,
        });
        return exito(r.mensaje, null);
      });
    },
    (mensaje) => fracaso("INVARIANTE_DE_GOBIERNO", mensaje),
  );
}

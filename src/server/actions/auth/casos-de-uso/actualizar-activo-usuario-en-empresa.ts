import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { mensajeSiNoPuedeGestionar, mensajeSiReactivaAdminSinSerGerente, mensajeSiSeApagaAlGerente } from "@/core/permisos/gestion-de-usuarios";
import { objetivoEnLaEmpresa, reactivaAUnAdmin } from "@/server/lecturas/permisos/gestion-de-usuarios";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { cambiarActivoDeCuentaEnEmpresa } from "@/server/persistencia/permisos/membresias";
import { conGobierno, conInvariantesDeGobierno } from "../../con-gobierno";

type ResultadoActualizarActivoUsuarioEnEmpresa = ResultadoCaso<null, "USUARIO_NO_ENCONTRADO" | "TECHO_DE_PRIVILEGIO" | "REACTIVA_ADMIN_SIN_SER_GERENTE" | "INVARIANTE_DE_GOBIERNO">;

/**
 * Caso de uso «apagar o reactivar la cuenta de una persona EN ESTA EMPRESA» (`UsuarioEmpresa.activo`; Hito 3, Fase I, I.5c de `docs/plan-hito-3-pureza.md`). Es el
 * kill-switch de la cuenta en la empresa — a diferencia de activar/desactivar una membresía (una fila `UsuarioSucursal`, una sucursal a la vez), corta el acceso a
 * TODAS las sucursales de la empresa de una sola vez. La misma persona puede seguir activa en otra empresa: `User.activoGlobal` (cuenta de toda la plataforma) no
 * se toca desde acá, lo decide la plataforma. El corte lo hace `obtenerContextoUsuario`, que solo arma contexto con la pertenencia activa.
 *
 * Es el cuerpo que antes vivía en línea en la Server Action `actualizarActivoUsuarioEnEmpresa` (`src/server/actions/auth/usuarios.ts`), movido TAL CUAL: mismas
 * consultas, mismo orden, mismos mensajes, todo dentro de la transacción de gobierno. La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("apagar_cuenta_empresa")` → este caso de uso → `aResultadoAccion`), sin guard de formato: solo recibe un id y un booleano (`SIN_GUARD`).
 * Es una acción de contexto empresa: quien actúa se mide por ser admin en CUALQUIER sucursal de la empresa (o gerente), y a quien se toca, igual. A los dos se los
 * mide con la MISMA lectura de la base (`objetivoEnLaEmpresa`), dentro de la transacción: O35-B de O.35, quien actúa ya no sale del contexto de la sesión, que
 * se armó al principio del pedido y pudo quedar viejo.
 *
 * En la transacción de gobierno (`conGobierno`, serializable con reintento), igual que antes:
 *  1. «No se encontró ese usuario» si no tiene pertenencia en la empresa (`User` no tiene RLS y `UsuarioEmpresa` la tiene recién desde rls_usuario_empresa: el
 *     `empresaId` de la clave sigue siendo obligatorio).
 *  2. El techo de gestión y, al APAGAR, que el gerente no apague su propia cuenta (`mensajeSiSeApagaAlGerente`).
 *  3. Al REACTIVAR una cuenta apagada: reactivar a un administrador es solo del gerente.
 *  4. Las invariantes de gobierno (`conInvariantesDeGobierno`) alrededor de la escritura (`cambiarActivoDeCuentaEnEmpresa`,
 *     `server/persistencia/permisos/membresias.ts`) y su auditoría (`UsuarioEmpresa.activo`, sin sucursal: es de la empresa).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint.
 *
 * @contract Deja la cuenta de la persona en la empresa activa o apagada, con su registro de auditoría, salvo que quien actúa no pueda gestionarla, que sea el gerente apagándose, que reactive a un admin sin ser el gerente o que se rompa una invariante de gobierno.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo valor (sin fila de auditoría nueva: el valor no cambió); no hay documento ni clave que arbitre el reintento.
 * @transaction conGobierno (conTransaccionSerializable con reintento) + conInvariantesDeGobierno alrededor de la escritura; una invariante violada vuelve como fracaso INVARIANTE_DE_GOBIERNO.
 * @sideEffects registrarCambioAuditado (UsuarioEmpresa.activo, del anterior al nuevo).
 * @ficha permiso=apagar_cuenta_empresa transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivoUsuarioEnEmpresaCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "empresaId" | "transaccion">,
  comando: { usuarioId: string; activo: boolean },
): Promise<ResultadoActualizarActivoUsuarioEnEmpresa> {
  const { usuarioId, activo } = comando;
  return conGobierno(
    actor,
    async (tx): Promise<ResultadoActualizarActivoUsuarioEnEmpresa> => {
      // `User` no tiene RLS (y `UsuarioEmpresa` tiene RLS recién desde la migración rls_usuario_empresa): el `empresaId` de la clave sigue siendo obligatorio.
      const pertenencia = await tx.usuarioEmpresa.findUnique({
        where: { usuarioId_empresaId: { usuarioId, empresaId: actor.empresaId } },
        include: { usuario: true },
      });
      if (!pertenencia) return fracaso("USUARIO_NO_ENCONTRADO", "No se encontró ese usuario.");
      const usuario = pertenencia.usuario;

      const quienActua = await objetivoEnLaEmpresa(tx, actor.empresaId, actor.usuarioId);
      const objetivo = await objetivoEnLaEmpresa(tx, actor.empresaId, usuarioId);
      const rechazo = mensajeSiNoPuedeGestionar(quienActua, objetivo) ?? (activo ? null : mensajeSiSeApagaAlGerente(objetivo));
      if (rechazo) return fracaso("TECHO_DE_PRIVILEGIO", rechazo);
      if (activo && !pertenencia.activo) {
        const rechazoReactivar = mensajeSiReactivaAdminSinSerGerente(quienActua, await reactivaAUnAdmin(tx, actor.empresaId, usuarioId, { cuentaDeEmpresa: pertenencia }));
        if (rechazoReactivar) return fracaso("REACTIVA_ADMIN_SIN_SER_GERENTE", rechazoReactivar);
      }

      await conInvariantesDeGobierno(tx, actor.empresaId, async () => {
        await cambiarActivoDeCuentaEnEmpresa(tx, { pertenenciaId: pertenencia.id, activo });
        await registrarCambioAuditado(tx, {
          entidad: "UsuarioEmpresa", entidadId: usuarioId, campo: "activo", descripcion: `Cuenta de "${usuario.email}" en la empresa`,
          valorAnterior: pertenencia.activo, valorNuevo: activo, actorId: actor.usuarioId, sucursalId: null,
        });
      });
      return exito(`Cuenta de "${usuario.email}" ${activo ? "reactivada" : "desactivada"} en la empresa.`, null);
    },
    (mensaje) => fracaso("INVARIANTE_DE_GOBIERNO", mensaje),
  );
}

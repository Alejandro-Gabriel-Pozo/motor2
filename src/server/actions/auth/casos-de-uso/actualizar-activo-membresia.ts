import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { actorEnSucursal, mensajeSiNoPuedeGestionar, mensajeSiReactivaAdminSinSerGerente, objetivoEnSucursal, reactivaAUnAdmin } from "@/core/permisos/gestion-de-usuarios";
import { conInvariantesDeGobierno } from "@/core/permisos/invariantes";
import { SELECCION_DE_ROL_PARA_JERARQUIA } from "@/core/permisos/jerarquia";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { cambiarActivoDeMembresia } from "@/server/persistencia/permisos/membresias";
import { conGobierno } from "../../con-gobierno";

type ResultadoActualizarActivoMembresia = ResultadoCaso<null, "MEMBRESIA_NO_ENCONTRADA" | "TECHO_DE_PRIVILEGIO" | "REACTIVA_ADMIN_SIN_SER_GERENTE" | "INVARIANTE_DE_GOBIERNO">;

/**
 * Caso de uso «activar o desactivar a un usuario en la sucursal activa» (equivalente de actualizarActivoUsuario, Core.js:1181-1211; Hito 3, Fase I, I.5b de
 * `docs/plan-hito-3-pureza.md`). Es el cuerpo que antes vivía en línea en la Server Action `actualizarActivoMembresia` (`src/server/actions/auth/usuarios.ts`),
 * movido TAL CUAL: mismas consultas, mismo orden, mismos mensajes, todo dentro de la transacción de gobierno. La Server Action quedó como adaptador
 * (`conPermiso("activar_usuario_sucursal")` → este caso de uso → `aResultadoAccion`), sin guard de formato: solo recibe un id y un booleano (`SIN_GUARD`).
 *
 * En la transacción de gobierno (`conGobierno`, serializable con reintento), igual que antes:
 *  1. «No se encontró esa membresía» si no existe o no es de la sucursal activa de quien actúa.
 *  2. El techo de gestión (`mensajeSiNoPuedeGestionar`) sobre la persona de la membresía.
 *  3. Al ACTIVAR: reactivar a un administrador es solo del gerente (`reactivaAUnAdmin` + `mensajeSiReactivaAdminSinSerGerente`).
 *  4. Que la empresa conserve un admin efectivo y el gerente una sucursal activa lo hacen cumplir las invariantes (`conInvariantesDeGobierno`, antes y después),
 *     alrededor de la escritura (`cambiarActivoDeMembresia`, `server/persistencia/permisos/membresias.ts`) y su auditoría (`UsuarioSucursal.activo`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint.
 *
 * @contract Deja la membresía de la sucursal activa activa o inactiva, con su registro de auditoría, salvo que quien actúa no pueda gestionar a esa persona, que reactive a un admin sin ser el gerente o que se rompa una invariante de gobierno.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo valor (sin fila de auditoría nueva: el valor no cambió); no hay documento ni clave que arbitre el reintento.
 * @transaction conGobierno (conTransaccionSerializable con reintento) + conInvariantesDeGobierno alrededor de la escritura; una invariante violada vuelve como fracaso INVARIANTE_DE_GOBIERNO.
 * @sideEffects registrarCambioAuditado (UsuarioSucursal.activo, del anterior al nuevo).
 * @ficha permiso=activar_usuario_sucursal transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivoMembresiaCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "empresaId" | "sucursalId" | "sucursalNombre" | "rolEmpresa" | "membresias" | "transaccion">,
  comando: { membresiaId: string; activo: boolean },
): Promise<ResultadoActualizarActivoMembresia> {
  const { membresiaId, activo } = comando;
  return conGobierno(
    actor,
    async (tx): Promise<ResultadoActualizarActivoMembresia> => {
      const membresia = await tx.usuarioSucursal.findUnique({ where: { id: membresiaId }, include: { rol: { select: SELECCION_DE_ROL_PARA_JERARQUIA } } });
      if (!membresia || membresia.sucursalId !== actor.sucursalId) return fracaso("MEMBRESIA_NO_ENCONTRADA", "No se encontró esa membresía.");

      const quienActua = actorEnSucursal(actor, actor.sucursalId);
      const objetivo = await objetivoEnSucursal(tx, actor.empresaId, membresia.usuarioId, membresia.rol);
      const rechazo = mensajeSiNoPuedeGestionar(quienActua, objetivo);
      if (rechazo) return fracaso("TECHO_DE_PRIVILEGIO", rechazo);
      if (activo) {
        const reactivaAdmin = await reactivaAUnAdmin(tx, actor.empresaId, membresia.usuarioId, { membresia });
        const rechazoReactivar = mensajeSiReactivaAdminSinSerGerente(quienActua, reactivaAdmin);
        if (rechazoReactivar) return fracaso("REACTIVA_ADMIN_SIN_SER_GERENTE", rechazoReactivar);
      }

      // Que la empresa conserve un admin efectivo y que el gerente conserve una sucursal activa lo hacen cumplir las invariantes.
      await conInvariantesDeGobierno(tx, actor.empresaId, async () => {
        await cambiarActivoDeMembresia(tx, { membresiaId, activo });
        const usuario = await tx.user.findUniqueOrThrow({ where: { id: membresia.usuarioId }, select: { email: true } });
        await registrarCambioAuditado(tx, {
          entidad: "UsuarioSucursal", entidadId: membresiaId, campo: "activo", descripcion: `Usuario "${usuario.email}" en la sucursal "${actor.sucursalNombre}": activo`,
          valorAnterior: membresia.activo, valorNuevo: activo, actorId: actor.usuarioId, sucursalId: membresia.sucursalId,
        });
      });
      return exito(`Usuario ${activo ? "activado" : "desactivado"}.`, null);
    },
    (mensaje) => fracaso("INVARIANTE_DE_GOBIERNO", mensaje),
  );
}

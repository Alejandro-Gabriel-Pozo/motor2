import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { invarianteRolDeSistemaIntacto } from "@/core/permisos/invariantes";
import { invarianteRolSinUsuariosActivos } from "@/server/lecturas/permisos/gobierno";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { esRolPropio, hayCupoDeRolPropio } from "@/core/permisos/cupo-de-roles-propios";
import { MENSAJE_PERMISOS_DE_PLATAFORMA } from "@/core/permisos/politica-de-empresa";
import { politicaDeEmpresa } from "@/server/acceso/politica-de-empresa";
import { cambiarActivoDeRol, contarRolesPropiosActivos, tomarCandadoDeRolesPropios } from "@/server/persistencia/permisos/roles";
import { conGobierno } from "../../con-gobierno";

type ResultadoActualizarActivoRol = ResultadoCaso<null, "ROL_NO_ENCONTRADO" | "SALVAGUARDA_DE_GOBIERNO" | "INVARIANTE_DE_GOBIERNO" | "CUPO_DE_ROLES_PROPIOS">;

/**
 * Caso de uso «activar o desactivar un rol» (equivalente de actualizarActivoRol, Core.js:994-1018; Hito 3, Fase I, I.2 de `docs/plan-hito-3-pureza.md`). Es el
 * cuerpo que antes vivía en línea en la Server Action `actualizarActivoRol` (`src/server/actions/permisos/roles.ts`), movido TAL CUAL: mismas consultas, mismo
 * orden, mismos mensajes. La Server Action quedó como adaptador (`conEdicionDePermisos("gestion_roles")` → este caso de uso → `aResultadoAccion`), sin guard de
 * formato: solo recibe un id y un booleano (`SIN_GUARD`, con su motivo).
 *
 * Dos salvaguardas de gobierno (G2), con la regla en `core/permisos/invariantes`: (c) un rol de sistema (con clave: «admin» y «operador») no se desactiva,
 * la empresa lo necesita para gobernarse; (e) un rol con usuarios ACTIVOS asignados (cualquier sucursal) no se desactiva sin reasignarlos antes. Se lee y se
 * escribe en la misma transacción serializable: una alta simultánea con ese rol no cuela a alguien en un rol recién apagado.
 *
 * P2 (roles propios por empresa): reactivar un rol PROPIO archivado exige cupo (`activos < rolesPropiosMax`), con el candado de la empresa; los de sistema nunca cuentan y desactivar siempre se puede (libera cupo).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Escribe `Rol` por `server/persistencia/permisos/roles.ts`, y solo se lo llama dentro de
 * `conEdicionDePermisos` (contrato C5, modo ii de `escrituras-de-permisos-por-politica`).
 *
 * @contract Deja el rol activo o inactivo, salvo que sea de sistema o tenga usuarios activos (al desactivar), junto con su registro de auditoría.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo valor (y una fila más de auditoría); no hay documento ni clave que arbitre el reintento.
 * @transaction conGobierno (conTransaccionSerializable con reintento; una invariante de gobierno violada vuelve como fracaso INVARIANTE_DE_GOBIERNO).
 * @sideEffects registrarCambioAuditado (Rol.activo, del anterior al nuevo). Sin efectos externos.
 * @ficha permiso=gestion_roles transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivoRolCasoDeUso(actor: Pick<ContextoUsuario, "usuarioId" | "empresaId" | "transaccion">, comando: { rolId: string; activo: boolean }): Promise<ResultadoActualizarActivoRol> {
  const { rolId, activo } = comando;
  return conGobierno(
    actor,
    async (tx): Promise<ResultadoActualizarActivoRol> => {
      const rol = await tx.rol.findUnique({ where: { id: rolId } });
      if (!rol) return fracaso("ROL_NO_ENCONTRADO", "No se encontró ese rol.");

      // P2: REACTIVAR un rol propio archivado vuelve a contar en el cupo (`Empresa.rolesPropiosMax`): se toma el candado de la empresa, se cuenta y recién ahí se decide. Activar uno que ya está activo no gasta cupo.
      if (activo && !rol.activo && esRolPropio(rol)) {
        await tomarCandadoDeRolesPropios(tx, actor.empresaId);
        const { rolesPropiosMax } = await politicaDeEmpresa(actor.empresaId, tx);
        if (!hayCupoDeRolPropio(rolesPropiosMax, await contarRolesPropiosActivos(tx))) return fracaso("CUPO_DE_ROLES_PROPIOS", MENSAJE_PERMISOS_DE_PLATAFORMA);
      }

      if (!activo) {
        const rechazo = invarianteRolDeSistemaIntacto(rol) ?? (await invarianteRolSinUsuariosActivos(tx, rol));
        if (rechazo) return fracaso("SALVAGUARDA_DE_GOBIERNO", rechazo);
      }

      await cambiarActivoDeRol(tx, { rolId, activo });

      // Auditoría administrativa (A3, Pivote 6).
      await registrarCambioAuditado(tx, {
        entidad: "Rol", entidadId: rolId, campo: "activo",
        descripcion: `Rol "${rol.nombre}": activo`,
        valorAnterior: rol.activo, valorNuevo: activo, actorId: actor.usuarioId,
      });

      return exito(`Rol "${rol.nombre}" ${activo ? "activado" : "desactivado"}.`, null);
    },
    (mensaje) => fracaso("INVARIANTE_DE_GOBIERNO", mensaje),
  );
}

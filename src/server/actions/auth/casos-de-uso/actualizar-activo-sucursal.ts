import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { gerentesQueQuedaranSinSucursalActiva } from "@/core/permisos/gerencia";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { cambiarActivoDeSucursal } from "@/server/persistencia/auth/sucursales";
import { conGobierno, conInvariantesDeGobierno } from "../../con-gobierno";

type ResultadoActualizarActivoSucursal = ResultadoCaso<null, "SUCURSAL_NO_ENCONTRADA" | "SUCURSAL_ACTUAL" | "GERENTE_SIN_SUCURSAL" | "INVARIANTE_DE_GOBIERNO">;

/**
 * Caso de uso «activar o desactivar una sucursal» (Hito 3, Fase I, I.4 de `docs/plan-hito-3-pureza.md`). Antes no existía ninguna forma de desactivar una
 * sucursal (solo alta) — hallazgo de la auditoría de motor2, con impacto real: `Sucursal.activo` ya se usaba como filtro (el listado de sucursales destino en
 * traspasos) pero no había ningún botón para ponerlo en false. Es el cuerpo que antes vivía en línea en la Server Action `actualizarActivoSucursal`
 * (`src/server/actions/auth/sucursales.ts`), movido TAL CUAL: mismas consultas, mismo orden, mismos mensajes. La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("activar_sucursal")` → este caso de uso → revalidación de la carta pública → `aResultadoAccion`), sin guard de formato: solo recibe un
 * id y un booleano (`SIN_GUARD`, con su motivo).
 *
 * En la transacción de gobierno (`conGobierno`, serializable con reintento), igual que antes:
 *  1. «No se encontró esa sucursal».
 *  2. Nadie desactiva la sucursal en la que está parado: `obtenerContextoUsuario` solo cuenta las membresías de sucursales activas, así que quien desactiva la
 *     suya (y no tiene otra) queda sin contexto en toda la aplicación y ya no puede volver a activarla, solo desde la base de datos.
 *  3. El gerente también necesita contexto: apagar la última sucursal activa donde tiene membresía lo deja sin acceso y a la empresa sin quien la gestione.
 *  4. D9: apagar una sucursal también puede dejar a la empresa sin admin efectivo (a) o sin sucursal al gerente (b): se mide antes y después
 *     (`conInvariantesDeGobierno`), alrededor de la escritura y su auditoría.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Escribe por `server/persistencia/auth/sucursales.ts`.
 *
 * @contract Deja la sucursal activa o inactiva, salvo que sea la del que actúa (al desactivar), deje al gerente sin sucursal activa o rompa una invariante de gobierno, con su registro de auditoría.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo valor (y una fila más de auditoría); no hay documento ni clave que arbitre el reintento.
 * @transaction conGobierno (conTransaccionSerializable con reintento) + conInvariantesDeGobierno alrededor de la escritura; una invariante violada vuelve como fracaso INVARIANTE_DE_GOBIERNO.
 * @sideEffects registrarCambioAuditado (Sucursal.activo, del anterior al nuevo). La revalidación de la carta pública la hace la Server Action.
 * @ficha permiso=activar_sucursal transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivoSucursalCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "empresaId" | "sucursalId" | "transaccion">,
  comando: { sucursalId: string; activo: boolean },
): Promise<ResultadoActualizarActivoSucursal> {
  const { sucursalId, activo } = comando;
  return conGobierno(
    actor,
    async (tx): Promise<ResultadoActualizarActivoSucursal> => {
      const sucursal = await tx.sucursal.findUnique({ where: { id: sucursalId } });
      if (!sucursal) return fracaso("SUCURSAL_NO_ENCONTRADA", "No se encontró esa sucursal.");

      if (!activo && sucursalId === actor.sucursalId) {
        return fracaso(
          "SUCURSAL_ACTUAL",
          `No podés desactivar la sucursal en la que estás ahora ("${sucursal.nombre}"): te quedarías sin acceso a la aplicación. Hacelo desde otra sucursal, o pedile a otro admin.`
        );
      }

      if (!activo && sucursal.activo) {
        const gerentes = await gerentesQueQuedaranSinSucursalActiva(tx, actor.empresaId, sucursalId);
        if (gerentes.length) {
          return fracaso(
            "GERENTE_SIN_SUCURSAL",
            `No se puede desactivar "${sucursal.nombre}": el gerente de la empresa (${gerentes.join(", ")}) se quedaría sin ninguna sucursal activa. Asignale antes otra sucursal activa.`
          );
        }
      }

      await conInvariantesDeGobierno(tx, actor.empresaId, async () => {
        await cambiarActivoDeSucursal(tx, { sucursalId, activo });
        await registrarCambioAuditado(tx, {
          entidad: "Sucursal", entidadId: sucursalId, campo: "activo", descripcion: `Sucursal "${sucursal.nombre}": activa`,
          valorAnterior: sucursal.activo, valorNuevo: activo, actorId: actor.usuarioId, sucursalId: null,
        });
      });
      return exito(`Sucursal "${sucursal.nombre}" ${activo ? "activada" : "desactivada"}.`, null);
    },
    (mensaje) => fracaso("INVARIANTE_DE_GOBIERNO", mensaje),
  );
}

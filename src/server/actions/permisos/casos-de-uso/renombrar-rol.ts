import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { mensajeSiNombreNoPermitidoParaElRol, normalizarNombreDeRol } from "@/core/permisos/nombres-de-rol";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { cambiarNombreDeRol } from "@/server/persistencia/permisos/roles";
import { conGobierno } from "../../con-gobierno";

type ResultadoRenombrarRol = ResultadoCaso<null, "ROL_NO_ENCONTRADO" | "NOMBRE_NO_PERMITIDO" | "NOMBRE_TOMADO" | "INVARIANTE_DE_GOBIERNO">;

/**
 * Caso de uso «renombrar un rol» (G3; Hito 3, Fase I, I.2 de `docs/plan-hito-3-pureza.md`). Cambia el NOMBRE de un rol y nunca su clave: un rol de sistema
 * («admin», «operador») sigue siendo el mismo con otro nombre, porque el código lo reconoce por la clave (ADR-016). Es el cuerpo que antes vivía en línea en la
 * Server Action `renombrarRol` (`src/server/actions/permisos/roles.ts`), movido TAL CUAL: mismas consultas, mismo orden, mismos mensajes. La Server Action quedó
 * como adaptador (`conEdicionDePermisos("renombrar_rol")` → este caso de uso → `aResultadoAccion`), sin guard de formato: la regla del nombre depende de la
 * clave del rol, que se lee acá dentro (`SIN_GUARD`, con su motivo).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Escribe `Rol` por `server/persistencia/permisos/roles.ts`, y solo se lo llama dentro de
 * `conEdicionDePermisos` (contrato C5, modo ii de `escrituras-de-permisos-por-politica`).
 *
 * Orden, igual que antes: el nombre se normaliza; en la transacción de gobierno (`conGobierno`, serializable con reintento) se lee el rol («No se encontró ese
 * rol»), se juzga el nombre para ESE rol (los de fábrica solo los lleva el rol con esa clave), «Ya existe el rol» si otro lo usa, y se escribe con su auditoría
 * (el nombre anterior y el nuevo). Si dos renombrados al mismo nombre se cruzan, la unicidad de la base frena al segundo con el mismo «Ya existe el rol».
 *
 * @contract Le pone al rol el nombre pedido (validado para su clave y libre), sin tocar la clave, junto con su registro de auditoría.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo nombre (y una fila más de auditoría); no hay documento ni clave que arbitre el reintento.
 * @transaction conGobierno (conTransaccionSerializable con reintento; una invariante de gobierno violada vuelve como fracaso INVARIANTE_DE_GOBIERNO).
 * @sideEffects registrarCambioAuditado (Rol.nombre, del anterior al nuevo). Sin efectos externos.
 * @ficha permiso=renombrar_rol transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function renombrarRolCasoDeUso(actor: Pick<ContextoUsuario, "usuarioId" | "transaccion">, comando: { rolId: string; nombre: string }): Promise<ResultadoRenombrarRol> {
  const { rolId } = comando;
  const n = normalizarNombreDeRol(comando.nombre);
  try {
    return await conGobierno(
      actor,
      async (tx): Promise<ResultadoRenombrarRol> => {
        const rol = await tx.rol.findUnique({ where: { id: rolId } });
        if (!rol) return fracaso("ROL_NO_ENCONTRADO", "No se encontró ese rol.");

        const rechazo = mensajeSiNombreNoPermitidoParaElRol(n, rol);
        if (rechazo) return fracaso("NOMBRE_NO_PERMITIDO", rechazo);

        const tomado = await tx.rol.findFirst({ where: { nombre: n, id: { not: rolId } }, select: { id: true } });
        if (tomado) return fracaso("NOMBRE_TOMADO", `Ya existe el rol "${n}".`);

        await cambiarNombreDeRol(tx, { rolId, nombre: n });
        await registrarCambioAuditado(tx, {
          entidad: "Rol", entidadId: rolId, campo: "nombre",
          descripcion: `Rol "${rol.nombre}": nombre`,
          valorAnterior: rol.nombre, valorNuevo: n, actorId: actor.usuarioId,
        });
        return exito(`Rol "${rol.nombre}" renombrado a "${n}".`, null);
      },
      (mensaje) => fracaso("INVARIANTE_DE_GOBIERNO", mensaje),
    );
  } catch (e) {
    if (esErrorDeUnicidad(e)) return fracaso("NOMBRE_TOMADO", `Ya existe el rol "${n}".`);
    throw e;
  }
}

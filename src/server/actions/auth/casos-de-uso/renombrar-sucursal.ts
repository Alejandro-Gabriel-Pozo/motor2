import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { cambiarNombreDeSucursal } from "@/server/persistencia/auth/sucursales";

type ResultadoRenombrarSucursal = ResultadoCaso<null, "SUCURSAL_NO_ENCONTRADA" | "NOMBRE_TOMADO">;

/**
 * Caso de uso «renombrar una sucursal» (antes solo se podía elegir el nombre una vez, al crearla; Hito 3, Fase I, I.4 de `docs/plan-hito-3-pureza.md`). Es el
 * cuerpo que antes vivía en línea en la Server Action `renombrarSucursal` (`src/server/actions/auth/sucursales.ts`), movido TAL CUAL: mismas consultas, mismo
 * orden, mismos mensajes. La Server Action quedó como adaptador (`conPermisoDeEmpresa("renombrar_sucursal")` → `guardComandoRenombrarSucursal` → este caso de
 * uso → revalidación de la carta pública y refresco de la vista → `aResultadoAccion`).
 *
 * Orden, igual que antes: «No se encontró esa sucursal» y «Ya existe una sucursal» (el nombre sin distinguir mayúsculas, en otra sucursal) con `actor.db`,
 * fuera de la transacción; en UNA transacción, el cambio de nombre (`cambiarNombreDeSucursal`, `server/persistencia/auth/sucursales.ts`) y su auditoría.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint.
 *
 * @contract Le pone a la sucursal el nombre pedido (libre en la empresa, sin distinguir mayúsculas), junto con su registro de auditoría.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo nombre (y una fila más de auditoría); no hay documento ni clave que arbitre el reintento.
 * @transaction `actor.transaccion` (READ COMMITTED, la del contexto): cambio y auditoría juntos. Las dos lecturas quedan fuera, como antes.
 * @sideEffects registrarCambioAuditado (Sucursal.nombre, del anterior al nuevo). La revalidación de la carta pública y el refresco de la vista los hace la Server Action.
 * @ficha permiso=renombrar_sucursal transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function renombrarSucursalCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "db" | "transaccion">,
  comando: { sucursalId: string; nombre: string },
): Promise<ResultadoRenombrarSucursal> {
  const { sucursalId, nombre } = comando;
  const sucursal = await actor.db.sucursal.findUnique({ where: { id: sucursalId } });
  if (!sucursal) return fracaso("SUCURSAL_NO_ENCONTRADA", "No se encontró esa sucursal.");

  const existente = await actor.db.sucursal.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" }, id: { not: sucursalId } } });
  if (existente) return fracaso("NOMBRE_TOMADO", `Ya existe una sucursal "${existente.nombre}".`);

  await actor.transaccion(async (tx) => {
    await cambiarNombreDeSucursal(tx, { sucursalId, nombre });
    await registrarCambioAuditado(tx, {
      entidad: "Sucursal", entidadId: sucursalId, campo: "nombre", descripcion: `Sucursal "${sucursal.nombre}": nombre`,
      valorAnterior: sucursal.nombre, valorNuevo: nombre, actorId: actor.usuarioId, sucursalId: null,
    });
  });
  return exito(`Sucursal renombrada a "${nombre}".`, null);
}

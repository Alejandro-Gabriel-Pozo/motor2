import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
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
 * Orden, igual que antes: «No se encontró esa sucursal» y «Ya existe una sucursal» (el nombre sin distinguir mayúsculas, en otra sucursal), y el cambio de nombre
 * (`cambiarNombreDeSucursal`, `server/persistencia/auth/sucursales.ts`) con su auditoría; desde M22 (S-51) TODO en UNA transacción SERIALIZABLE (antes, las dos lecturas iban afuera, con `actor.db`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint.
 *
 * @contract Le pone a la sucursal el nombre pedido (libre en la empresa, sin distinguir mayúsculas), junto con su registro de auditoría.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo nombre (y una fila más de auditoría); no hay documento ni clave que arbitre el reintento.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento; M22 / S-51): las dos lecturas, el cambio y la auditoría, todo junto.
 * @sideEffects registrarCambioAuditado (Sucursal.nombre, del anterior al nuevo). La revalidación de la carta pública y el refresco de la vista los hace la Server Action.
 * @ficha permiso=renombrar_sucursal transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function renombrarSucursalCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "transaccion">,
  comando: { sucursalId: string; nombre: string },
): Promise<ResultadoRenombrarSucursal> {
  const { sucursalId, nombre } = comando;
  // M22 (S-51): la sucursal, el chequeo del nombre, el cambio y la auditoría van en UNA transacción SERIALIZABLE. Antes las dos lecturas iban con `actor.db`, afuera: dos renombres a la vez al mismo
  // nombre pasaban los dos el chequeo y el segundo chocaba con el índice único (`Sucursal_empresaId_nombre_key`) como un 500. Ahora Postgres aborta a uno (40001: leyó la ausencia del nombre y el otro lo
  // escribió), el reintento relee y responde «Ya existe una sucursal». Los rechazos devuelven ANTES de escribir; el cuerpo puede reintentarse: no tiene efectos fuera de la base.
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoRenombrarSucursal> => {
    const sucursal = await tx.sucursal.findUnique({ where: { id: sucursalId } });
    if (!sucursal) return fracaso("SUCURSAL_NO_ENCONTRADA", "No se encontró esa sucursal.");

    const existente = await tx.sucursal.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" }, id: { not: sucursalId } } });
    if (existente) return fracaso("NOMBRE_TOMADO", `Ya existe una sucursal "${existente.nombre}".`);

    await cambiarNombreDeSucursal(tx, { sucursalId, nombre });
    await registrarCambioAuditado(tx, {
      entidad: "Sucursal", entidadId: sucursalId, campo: "nombre", descripcion: `Sucursal "${sucursal.nombre}": nombre`,
      valorAnterior: sucursal.nombre, valorNuevo: nombre, actorId: actor.usuarioId, sucursalId: null,
    });
    return exito(`Sucursal renombrada a "${nombre}".`, null);
  });
}

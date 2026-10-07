import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarCapacidad } from "@/core/features/permisos/capacidad.guard";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { mensajeSiNoPuedeCambiarCapacidades } from "@/core/permisos/matriz";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { objetivoEnLaEmpresa } from "@/server/lecturas/permisos/gestion-de-usuarios";
import { guardarCapacidadSucursal } from "@/server/persistencia/permisos/capacidades";

type ResultadoActualizarCapacidad = ResultadoCaso<{ capacidadId: string }, "SUCURSAL_NO_ENCONTRADA" | "CAPACIDADES_SOLO_DEL_GERENTE">;

/**
 * Caso de uso «prender o apagar una capacidad por sucursal» (equivalente de la escritura detrás de PanelCapacidadesSucursal, Sucursales.js; Hito 3, Fase I,
 * I.1 de `docs/plan-hito-3-pureza.md`). Es el cuerpo que antes vivía en línea en la Server Action `actualizarCapacidad`
 * (`src/server/actions/permisos/capacidades-sucursal.ts`), movido TAL CUAL: mismas consultas, mismo orden, mismos mensajes. La Server Action quedó como
 * adaptador (permiso → guard de formato → este caso de uso → efectos de Next → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea el permiso (eso ya lo hizo `conPermisoDeEmpresa("capacidades_sucursal")`) ni el
 * formato (`guardComandoActualizarCapacidad`, `core/features/permisos/capacidad.guard.ts`: auto-gobierno, sucursal rota, clave fuera del catálogo, valor no
 * booleano): recibe el comando ya pasado por ese guard.
 *
 * Orden, igual que antes: (1) si no es la fila default, que la sucursal exista (con `actor.db`, fuera de la transacción, como antes); (2) en UNA transacción,
 * la escritura (`guardarCapacidadSucursal`, `server/persistencia/permisos/capacidades.ts`) y su auditoría (A3, Pivote 6): o quedan los dos o ninguno (S-26,
 * `test/seguridad/capacidad-auditoria-atomica.test.ts`, que intercepta `registrarCambioAuditado` en `core/permisos/auditoria`: este archivo lo importa de
 * ESA ruta para que el `vi.mock` siga alcanzándolo).
 *
 * O.41 (decisión del dueño del 2026-10-08, «esa perilla solo del gerente»; ADR-027): cambiar una capacidad es SOLO del gerente de la empresa
 * (`mensajeSiNoPuedeCambiarCapacidades`, puro, en `core/permisos/matriz.ts`, junto a la regla hermana de D13/D14). Quien actúa se mide desde la base DENTRO de la
 * transacción (`objetivoEnLaEmpresa`, la misma lectura que usa `guardarPermisos`), ANTES de escribir: un administrador que no es el gerente recibe «Solo el gerente
 * de la empresa puede cambiar las capacidades de una sucursal.» y no se escribe ni la fila ni la auditoría. Sin esto apagaba por sucursal acciones de gobierno de
 * piso administrador (`renombrar_rol`, `alta_sucursal`, `activar_sucursal`, `renombrar_sucursal`, `ver_auditoria`) y se las sacaba también al gerente, que usa el
 * mismo rol. Es una regla del caso de uso: el envoltorio y la clave de la Server Action (`conPermisoDeEmpresa("capacidades_sucursal")`) no cambian. La sucursal
 * inexistente se sigue rechazando primero, como antes (está fuera de la transacción).
 *
 * @contract Deja la capacidad `accionClave` de `sucursalId` (o la default) en `habilitado`, creando la fila si no existía, junto con su registro de auditoría; solo si quien actúa es el gerente de la empresa.
 * @idempotency No aplica — repetir el pedido deja el mismo valor (y una fila más de auditoría); no hay documento ni clave que arbitre el reintento.
 * @transaction `actor.transaccion` (READ COMMITTED, la del contexto): quién actúa (O.41), la escritura y la auditoría juntas. La lectura de la sucursal queda fuera, como antes.
 * @sideEffects registrarCambioAuditado (CapacidadSucursal.habilitado, con el valor anterior o null). La revalidación de la carta pública y el refresco de la vista los hace la Server Action.
 * @ficha permiso=capacidades_sucursal transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarCapacidadCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "empresaId" | "db" | "transaccion">,
  comando: ComandoActualizarCapacidad,
): Promise<ResultadoActualizarCapacidad> {
  const { accionClave, sucursalId, habilitado } = comando;
  if (sucursalId !== null && !(await actor.db.sucursal.findUnique({ where: { id: sucursalId }, select: { id: true } }))) {
    return fracaso("SUCURSAL_NO_ENCONTRADA", "No se encontró la sucursal.");
  }

  return actor.transaccion(async (tx): Promise<ResultadoActualizarCapacidad> => {
    // O.41: la perilla es solo del gerente. Quien actúa se lee acá, dentro de la transacción, y el rechazo sale antes de cualquier escritura.
    const rechazo = mensajeSiNoPuedeCambiarCapacidades(await objetivoEnLaEmpresa(tx, actor.empresaId, actor.usuarioId));
    if (rechazo) return fracaso("CAPACIDADES_SOLO_DEL_GERENTE", rechazo);

    const fila = await guardarCapacidadSucursal(tx, { accionClave, sucursalId, habilitado });
    await registrarCambioAuditado(tx, {
      entidad: "CapacidadSucursal", entidadId: fila.id, campo: "habilitado",
      descripcion: `Capacidad "${accionClave}"${sucursalId ? "" : " (default)"}`,
      valorAnterior: fila.anterior, valorNuevo: habilitado, actorId: actor.usuarioId, sucursalId,
    });
    return exito(`Capacidad de "${accionClave}" actualizada.`, { capacidadId: fila.id });
  });
}

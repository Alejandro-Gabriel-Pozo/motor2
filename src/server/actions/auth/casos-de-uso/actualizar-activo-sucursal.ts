import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { esMostrador } from "@/core/pos/public";
import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { gerentesQueQuedaranSinSucursalActiva } from "@/server/lecturas/permisos/gerencia";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import type { Db } from "@/lib/db-tipos";
import { cambiarActivoDeSucursal } from "@/server/persistencia/auth/sucursales";
import { conGobierno, conInvariantesDeGobierno } from "../../con-gobierno";

type ResultadoActualizarActivoSucursal = ResultadoCaso<null, "SUCURSAL_NO_ENCONTRADA" | "SUCURSAL_ACTUAL" | "GERENTE_SIN_SUCURSAL" | "TIENE_PENDIENTES" | "INVARIANTE_DE_GOBIERNO">;

/**
 * «A, B y C» / «A, B, C, D y 2 más». Copia de `enumerar` de `catalogo/casos-de-uso/actualizar-disponibilidad-producto.ts`: duplicación anotada (mover a un lugar
 * común queda como pendiente, ver `docs/pureza-integracion.md` O.247).
 */
function enumerar(items: string[], tope = 4): string {
  const vistos = items.slice(0, tope);
  const resto = items.length - vistos.length;
  const cola = resto > 0 ? ` y ${resto} más` : "";
  return vistos.length > 1 && resto === 0 ? `${vistos.slice(0, -1).join(", ")} y ${vistos[vistos.length - 1]}` : `${vistos.join(", ")}${cola}`;
}

/** Cuántos traspasos se nombran en el mensaje; el resto se resume en «y N traspasos más». */
const TOPE_DE_TRASPASOS_NOMBRADOS = 4;

/**
 * Lo que impide apagar la sucursal, ya redactado, una parte por traspaso y una más por las mesas. Mismo filtro que `calcularStockEnTransito` (server/consultas/stock/en-transito.ts).
 * `select` explícito en `producto` (campos sensibles, GT-25).
 */
async function describirPendientesDeSucursal(tx: Db, sucursalId: string): Promise<string[]> {
  const traspasos = await tx.traspasoSucursal.findMany({
    where: {
      OR: [
        { estado: "ENVIADA", origenSucursalId: sucursalId },
        { estado: "ENVIADA", destinoSucursalId: sucursalId },
        { estado: "RECHAZADA_DESTINO", origenSucursalId: sucursalId },
      ],
    },
    select: {
      estado: true,
      destinoSucursalId: true,
      cantidad: true,
      producto: { select: { nombre: true, unidadStock: { select: { nombre: true } } } },
      origenSucursal: { select: { nombre: true } },
      destinoSucursal: { select: { nombre: true } },
    },
    orderBy: { creadoEn: "asc" },
  });
  const partes = traspasos.slice(0, TOPE_DE_TRASPASOS_NOMBRADOS).map((t) => {
    const que = `${Number(t.cantidad)} ${t.producto.unidadStock.nombre} de "${t.producto.nombre}"`;
    if (t.estado === "RECHAZADA_DESTINO") return `confirmá el reingreso del traspaso de ${que} que rechazó "${t.destinoSucursal.nombre}"`;
    if (t.destinoSucursalId === sucursalId) return `recibí o rechazá el traspaso de ${que} que mandó "${t.origenSucursal.nombre}"`;
    return `"${t.destinoSucursal.nombre}" tiene que recibir o rechazar el traspaso de ${que}`;
  });
  const sinNombrar = traspasos.length - partes.length;
  if (sinNombrar > 0) partes.push(`y ${sinNombrar} ${sinNombrar === 1 ? "traspaso más" : "traspasos más"}`);

  const cuentas = await tx.cuenta.findMany({
    where: { cerradaEn: null, mesa: { sucursalId } },
    select: { mesa: { select: { numero: true } } },
    orderBy: { mesa: { numero: "asc" } },
  });
  // ADR-039: las cuentas abiertas del puesto mostrador también impiden apagar la sucursal, pero no son «la mesa 0»: se nombran aparte.
  const deMesas = cuentas.filter((c) => !esMostrador(c.mesa.numero));
  const delMostrador = cuentas.length - deMesas.length;
  if (deMesas.length) partes.push(`cerrá o liberá ${deMesas.length === 1 ? "la mesa" : "las mesas"} ${enumerar(deMesas.map((c) => String(c.mesa.numero)))}`);
  if (delMostrador) partes.push(`cerrá o descartá ${delMostrador === 1 ? "la cuenta abierta" : "las cuentas abiertas"} del mostrador`);
  return partes;
}

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
 *  4. P15 (decisión del dueño, 2026-10-11): apagar una sucursal con mercadería en camino o mesas abiertas la deja trabada, porque quien no tiene una sucursal activa no tiene contexto para operarla
 *     (`obtenerContextoUsuario`): el destino no podría recibir ni rechazar lo que le mandaron, el origen no podría confirmar el reingreso de lo que le rechazaron, y la cuenta de una mesa abierta
 *     no se podría cerrar. Por eso se BLOQUEA mientras haya (a) un traspaso ENVIADA con la sucursal como origen o como destino, (b) uno RECHAZADA_DESTINO con la sucursal como origen (la misma
 *     definición que el stock en tránsito, `calcularStockEnTransito`) o (c) una cuenta sin cerrar en una de sus mesas, y el mensaje dice qué falta. Una SOLICITADA pendiente NO bloquea (no movió
 *     stock): `aprobarYEnviarTraspaso` rechaza en cambio si el destino está apagado. Las lecturas van con `tx`, dentro de esta transacción SERIALIZABLE: contra una apertura de mesa o un envío que
 *     crean un pendiente a la vez, Postgres ve el ciclo de lecturas y escrituras y aborta una de las dos; el reintento da el rechazo de negocio (`abrirCuentaCasoDeUso` y los casos de envío leen
 *     la fila de la sucursal por la misma razón). Sólo se mira al APAGAR una sucursal que está activa: reactivar nunca se bloquea y repetir el apagado sobre una ya apagada no hace nada.
 *  5. D9: apagar una sucursal también puede dejar a la empresa sin admin efectivo (a) o sin sucursal al gerente (b): se mide antes y después
 *     (`conInvariantesDeGobierno`), alrededor de la escritura y su auditoría.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Escribe por `server/persistencia/auth/sucursales.ts`.
 *
 * @contract Deja la sucursal activa o inactiva, salvo que sea la del que actúa (al desactivar), deje al gerente sin sucursal activa, tenga traspasos en camino o mesas abiertas (al desactivar) o rompa una invariante de gobierno, con su registro de auditoría.
 * @idempotency No aplica — no hay documento ni clave que arbitre el reintento; repetir el pedido deja el mismo valor y NO suma otra fila de auditoría (`registrarCambioAuditado` no escribe si el valor no cambió).
 * @transaction conGobierno (conTransaccionSerializable con reintento) + conInvariantesDeGobierno alrededor de la escritura; una invariante violada vuelve como fracaso INVARIANTE_DE_GOBIERNO.
 * @sideEffects registrarCambioAuditado (Sucursal.activo, del anterior al nuevo). La revalidación de la carta pública la hace la Server Action.
 * @ficha permiso=activar_sucursal transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivoSucursalCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "empresaId" | "sucursalId" | "db" | "transaccion" | "alcance">,
  comando: { sucursalId: string; activo: boolean },
): Promise<ResultadoActualizarActivoSucursal> {
  const { sucursalId, activo } = comando;
  // P2 (RLS por sucursal): el chequeo de pendientes (paso 4) lee los traspasos y las mesas/cuentas de la sucursal que se APAGA, que no es la activa de quien la apaga: con la RLS por sucursal vería solo los de la suya y dejaría apagar con
  // mercadería en camino (falla ABIERTO). La transacción de gobierno se abre con la base de VERIFICACIÓN (lectura en toda la empresa, escritura como estaba; `Sucursal` es de gobierno y no depende del alcance): sigue siendo UNA transacción
  // SERIALIZABLE con el mismo orden y los mismos mensajes, y el apagado y su auditoría no cambian.
  const verificacion = await lecturaDeVerificacionEnLaEmpresa(actor);
  return conGobierno(
    verificacion,
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

        const pendientes = await describirPendientesDeSucursal(tx, sucursalId);
        if (pendientes.length) {
          return fracaso(
            "TIENE_PENDIENTES",
            `No se puede desactivar "${sucursal.nombre}": todavía tiene mercadería en camino o mesas abiertas. Antes: ${pendientes.join("; ")}.`
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

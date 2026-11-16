import "server-only";
import { decidirCierre, explicacionDesdeTexto, reconocimientosValidos, repiteElCierre } from "@/core/caja/public";
import type { ControlDelDia } from "@/core/caja/public";
import type { ComandoCerrarJornada, ControlDeJornadaVisto, ResultadoCerrarJornada } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { esDiaISOReal } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { leerControlesDeLaJornada } from "@/server/lecturas/caja/controles-de-la-jornada";
import { bloquearJornadaParaCambiar, cargarControlesGuardados, cerrarJornadaEnBase, insertarControles } from "@/server/persistencia/caja/jornada";

/** Un control como lo ve quien cierra (sin el detalle ni las referencias: el detalle lo da la consulta de cada control). */
function aVisto(c: ControlDelDia, reconocido: boolean, texto: string | null): ControlDeJornadaVisto {
  return { clave: c.clave, severidad: c.severidad, cantidad: c.cantidad, reconocido, texto };
}

/**
 * Caso de uso «cerrar el día» (etapa C2, CU8; Pedernal `cierre/casos-de-uso/cerrar-jornada.ts`, decisiones 160, 163, 167 y 168 y e3b §3.3 y §3.7): cierra la jornada de la sucursal activa. TODO O NADA: o el cierre completo (estado, foto de controles y
 * auditoría) o nada. Los controles son los de `src/core/caja/controles-del-dia.ts` (seis de caja y dos de ventas).
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso y validó el formato. En UNA transacción SERIALIZABLE, en este orden:
 *  1. validación de lo pedido: fecha (`FECHA_INVALIDA`), observación (`OBSERVACION_INVALIDA`) y reconocimientos (`RECONOCIMIENTO_INVALIDO`), todos por lista de permitidos;
 *  2. `FOR UPDATE` de la jornada: dos cierres a la vez se serializan y uno solo escribe; sin jornada → `JORNADA_NO_ENCONTRADA`;
 *  3. `CERRADA`: si el pedido es el mismo (huella, observación y reconocimientos) → `yaEstabaCerrada` sin escribir; otro → `JORNADA_CERRADA`; `ABIERTA` → `JORNADA_NO_EN_AUDITORIA`;
 *  4. `EN_AUDITORIA`: recalcula los controles y su huella; distinta de la que se vio → `CONTROLES_CAMBIARON` (con los controles de ahora); con `BLOQUEA` → `CONTROLES_QUE_BLOQUEAN`; con `RECONOCIBLE` sin reconocer → `CONTROLES_SIN_RECONOCER`
 *     (el texto es opcional); reconocer lo que no corresponde → `RECONOCIMIENTO_INVALIDO`;
 *  5. la jornada pasa a `CERRADA` con su huella, se guarda la foto de TODOS los controles (también los de cantidad 0 y los que solo informan) con quién y cuándo reconoció, y se audita. La jornada NUNCA se cierra sola al llegar la hora de corte.
 * Segunda barrera: `JornadaDeSucursal_validar_cambio` (CERRADA queda congelada) y `ControlDeJornadaCerrada_validar` (la foto solo entra con la jornada pasando a CERRADA en esta misma transacción).
 *
 * @contract Cierra la jornada una sola vez con la foto de los controles que se vieron, o no escribe nada.
 * @idempotency Por estado y huella: repetir el mismo pedido sobre la jornada ya cerrada devuelve `yaEstabaCerrada`; otro contenido recibe `JORNADA_CERRADA`; el `FOR UPDATE` serializa dos cierres a la vez.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (estado de la jornada, con la lista de controles con hallazgos y cuáles se reconocieron; sin textos ni datos personales).
 * @ficha permiso=jornada_operar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function cerrarJornadaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "empresaZonaHoraria" | "transaccion" | "ahora">,
  comando: ComandoCerrarJornada,
  azar: FuenteDeAzar,
): Promise<ResultadoCerrarJornada> {
  if (!esDiaISOReal(comando.fechaDeNegocio)) return fracaso("FECHA_INVALIDA", "La fecha del día de negocio no es válida.");
  const observacion = explicacionDesdeTexto(comando.observacion);
  if (!observacion.ok) return fracaso("OBSERVACION_INVALIDA", "La observación tiene caracteres que no se admiten.");
  const reconocimientos = reconocimientosValidos(comando.reconocimientos);
  if (!reconocimientos.ok) return fracaso("RECONOCIMIENTO_INVALIDO", "Hay un reconocimiento que no vale.");

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCerrarJornada> => {
      const jornada = await bloquearJornadaParaCambiar(tx, actor.empresaId, actor.sucursalId, comando.fechaDeNegocio);
      if (jornada === null) return fracaso("JORNADA_NO_ENCONTRADA", "Ese día todavía no tiene actividad.");

      if (jornada.estado === "CERRADA") {
        const guardados = await cargarControlesGuardados(tx, actor.empresaId, jornada.id);
        const repite = repiteElCierre(
          { huellaDeCierre: jornada.huellaDeCierre, observacion: jornada.observacion, reconocidos: guardados.filter((c) => c.reconocido) },
          { huellaVista: comando.huellaVista, observacion: observacion.valor, reconocimientos: reconocimientos.valor },
        );
        if (!repite) return fracaso("JORNADA_CERRADA", "El día de negocio ya está cerrado.");
        return exito("El día ya estaba cerrado.", { controles: guardados.map((g) => ({ clave: g.clave, severidad: g.severidad as ControlDeJornadaVisto["severidad"], cantidad: g.cantidad, reconocido: g.reconocido, texto: g.texto })), yaEstabaCerrada: true });
      }
      if (jornada.estado === "ABIERTA") return fracaso("JORNADA_NO_EN_AUDITORIA", "Para cerrar el día primero hay que empezar el cierre.");

      const { controles, huella } = await leerControlesDeLaJornada(tx, { empresaId: actor.empresaId, sucursalId: actor.sucursalId, fechaDeNegocio: comando.fechaDeNegocio, jornadaId: jornada.id, zonaHoraria: actor.empresaZonaHoraria, ahora: actor.ahora });
      const decision = decidirCierre({ controles, huellaActual: huella, huellaVista: comando.huellaVista, reconocimientos: reconocimientos.valor });
      if (!decision.ok) {
        const e = decision.error;
        if (e.codigo === "CONTROLES_CAMBIARON") return { ...fracaso("CONTROLES_CAMBIARON", "Los controles del día cambiaron: volvé a mirarlos antes de cerrar."), controles: e.controles.map((c) => aVisto(c, false, null)), huellaActual: huella };
        if (e.codigo === "CONTROLES_QUE_BLOQUEAN") return { ...fracaso("CONTROLES_QUE_BLOQUEAN", "Hay controles que impiden cerrar el día."), claves: e.claves };
        if (e.codigo === "CONTROLES_SIN_RECONOCER") return { ...fracaso("CONTROLES_SIN_RECONOCER", "Hay controles que hay que reconocer para cerrar el día."), claves: e.claves };
        return fracaso("RECONOCIMIENTO_INVALIDO", "Hay un reconocimiento que no vale.");
      }

      await cerrarJornadaEnBase(tx, { empresaId: actor.empresaId, id: jornada.id, cerradaEn: actor.ahora, cerradaPorId: actor.usuarioId, huella, observacion: observacion.valor });
      await insertarControles(tx, { empresaId: actor.empresaId, sucursalId: actor.sucursalId, jornadaId: jornada.id, controles: decision.valor, ids: decision.valor.map(() => azar.uuid()), reconocePorId: actor.usuarioId, ahora: actor.ahora });
      const conHallazgos = decision.valor.filter((c) => c.cantidad > 0).map((c) => `${c.clave}=${c.cantidad}${c.reconocido ? " reconocido" : ""}`);
      await registrarCambioAuditado(tx, {
        entidad: "JornadaDeSucursal",
        entidadId: jornada.id,
        descripcion: `Día ${comando.fechaDeNegocio} cerrado`,
        campo: "estado",
        valorAnterior: "EN_AUDITORIA",
        valorNuevo: `CERRADA; huella ${huella}${conHallazgos.length > 0 ? `; ${conHallazgos.join(", ")}` : ""}`,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Día cerrado.", { controles: decision.valor.map((c) => aVisto(c, c.reconocido, c.texto)), yaEstabaCerrada: false });
    },
    undefined,
    undefined,
    true,
  );
}

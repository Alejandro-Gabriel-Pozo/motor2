import "server-only";
import { CONTROL_RECEPCION_EXCEDE_LA_ORDEN, NIVEL_POR_DEFECTO_DEL_CONTROL, ETIQUETA_DE_NIVEL_DE_CONTROL } from "@/core/compras/public";
import type { ComandoConfigurarControlDeExceso, ResultadoConfigurarControlDeExceso } from "@/core/features/compras/orden-de-compra.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarNivelDelControlDeExceso } from "@/server/lecturas/movimientos/ordenes-de-compra";
import { escribirNivelDelControlDeExceso } from "@/server/persistencia/movimientos/escribir-orden-de-compra";

/**
 * Caso de uso «configurar el control de exceso de la recepción contra la orden» (Compras, etapa OC): un gerente o administrador fija el nivel del control `compras.recepcion_excede_la_orden` de la empresa: PERMITIR (lo que se recibe de más pasa), AVISAR (pasa solo
 * si quien carga la compra confirma el exceso renglón por renglón) o BLOQUEAR (nunca pasa). SIN fila es PERMITIR (como Pedernal): nada se configura de fábrica. La base repite el tope al confirmar la recepción (UPDATE condicionado del saldo).
 *
 * `import "server-only"` y SIN `"use server"`: no chequea permisos (la Server Action pidió `compras_configurar`: del módulo `ordenes_de_compra`, piso administrador) ni el formato (`guardComandoConfigurarControlDeExceso`).
 *
 * En UNA transacción SERIALIZABLE: lee el nivel vigente; si ya es ese (la ausencia de fila cuenta como PERMITIR) no escribe nada (`SIN_CAMBIOS`: idempotente por estado, no crea una fila redundante); si no, crea o actualiza la fila (guarda de versión) y audita
 * (`NivelDeControl`, campo `nivel`, del anterior —PERMITIR si no había fila— al nuevo). Una configuración vale para todas las compras que se confirmen después: no reescribe nada de lo ya recibido.
 *
 * @contract Deja el control de exceso de la empresa en el nivel pedido y deja rastro de quién lo cambió, o no cambia nada.
 * @idempotency POR_ESTADO: si ya está en ese nivel, `SIN_CAMBIOS` sin escribir; el cambio concurrente lo decide la guarda de versión y el reintento.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (el cambio de nivel).
 * @ficha permiso=compras_configurar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function configurarControlDeExcesoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "db" | "transaccion" | "ahora">,
  comando: ComandoConfigurarControlDeExceso,
  azar: FuenteDeAzar
): Promise<ResultadoConfigurarControlDeExceso> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoConfigurarControlDeExceso> => {
    const actual = (await cargarNivelDelControlDeExceso(tx)) ?? NIVEL_POR_DEFECTO_DEL_CONTROL;
    if (actual === comando.nivel) return fracaso("SIN_CAMBIOS", `El control ya está en «${ETIQUETA_DE_NIVEL_DE_CONTROL[actual]}»: no hay nada que cambiar.`);
    await escribirNivelDelControlDeExceso(tx, { id: azar.uuid(), nivel: comando.nivel, usuarioId: actor.usuarioId, ahora: actor.ahora });
    await registrarCambioAuditado(tx, {
      entidad: "NivelDeControl",
      entidadId: `${actor.empresaId}:${CONTROL_RECEPCION_EXCEDE_LA_ORDEN}`,
      descripcion: `Control «recibir más de lo pedido en una orden» cambiado de «${ETIQUETA_DE_NIVEL_DE_CONTROL[actual]}» a «${ETIQUETA_DE_NIVEL_DE_CONTROL[comando.nivel]}»`,
      campo: "nivel",
      valorAnterior: actual,
      valorNuevo: comando.nivel,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito(`Control configurado: ahora está en «${ETIQUETA_DE_NIVEL_DE_CONTROL[comando.nivel]}».`, { nivel: comando.nivel });
  });
}

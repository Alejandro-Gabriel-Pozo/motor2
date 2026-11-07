import "server-only";
import type { Prisma } from "@prisma/client";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { MENSAJE_OPERACION_NO_ENCONTRADA } from "@/core/features/compras/compra.guard";
import type { CodigoAnularVenta } from "@/core/features/ventas/venta.schema";
import { copiarVentaConMenosUnidades, evaluarCorreccionPorUnidades, unidadesVendidas, type MotivoDeRechazoDeLaCorreccion } from "@/core/movimientos/public";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarPosterioresDeVentas, cargarVentaParaAnular } from "@/server/persistencia/movimientos/cargar-venta-para-anular";
import { cargarVentaParaQuitarUnidades } from "@/server/persistencia/movimientos/cargar-venta-para-quitar-unidades";
import { escribirVentaCorregida } from "@/server/persistencia/movimientos/escribir-venta-corregida";
import { anularVentaEnTx, type IdempotenciaDeAnulacion } from "./anular-venta";

/**
 * Comando de Movimientos «reemplazar una venta por otra con menos unidades» (E1 de la corrección por ajuste, docs/diseno-correccion-por-ajuste-2026-11-06.md): el cuerpo,
 * dentro de una transacción YA ABIERTA (SERIALIZABLE) de quien lo llama, de «quitar unidades de una línea» de un ticket cerrado. Lo registrado no se edita: la venta A se
 * revierte con su contra-asiento (`anularVentaEnTx`: enlazado, con el motivo y la clave I3), se escribe la venta B con lo que queda (`copiarVentaConMenosUnidades`, enlazada
 * con `reemplazaAOperacionId`: mismos lotes, fecha, precio, lista y costo congelado) y queda la auditoría de las unidades antes y después. Lo usa
 * `quitarUnidadesDeLineaCasoDeUso` (POS), que además emite el ticket corregido en la misma transacción. Un `fracaso(...)` sale ANTES de escribir nada.
 *
 * Las reglas (venta vigente y no reemplazada, lo que la persona vio, promo, adicionales, unidades válidas, D7) son las de `evaluarCorreccionPorUnidades`. Los permisos los pide
 * la Server Action. Quitar todas las unidades responde `ALCANCE_TOTAL`: es anular la línea entera.
 */
export type CodigoReemplazarVentaConMenosUnidades = CodigoAnularVenta | MotivoDeRechazoDeLaCorreccion | "ALCANCE_TOTAL";

export interface DatosVentaReemplazada {
  ventaNuevaId: string;
  unidadesAntes: number;
  unidadesQueQuedan: number;
  /** El contra-asiento de la venta reemplazada: lleva la clave I3, y es donde el caso de uso guarda el mensaje del resultado. */
  reversionId: string;
}

export type ResultadoReemplazarVentaConMenosUnidades = ResultadoCaso<DatosVentaReemplazada, CodigoReemplazarVentaConMenosUnidades>;

export async function reemplazarVentaConMenosUnidadesEnTx(
  tx: Prisma.TransactionClient,
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "ahora">,
  comando: { operacionId: string; unidadesAQuitar: number; unidadesVistas: number; motivo: string },
  idempotencia: IdempotenciaDeAnulacion
): Promise<ResultadoReemplazarVentaConMenosUnidades> {
  const { operacionId, unidadesAQuitar, unidadesVistas, motivo } = comando;
  const paraAnular = await cargarVentaParaAnular(tx, { operacionId, sucursalId: actor.sucursalId });
  const venta = await cargarVentaParaQuitarUnidades(tx, { operacionId, sucursalId: actor.sucursalId });
  if (!paraAnular || !venta) return fracaso("NO_ENCONTRADA", MENSAJE_OPERACION_NO_ENCONTRADA);

  const unidades = unidadesVendidas(venta.lineas);
  const decision = evaluarCorreccionPorUnidades({
    // Los permisos ya los pidió la Server Action; acá se cumplen por construcción.
    permisos: { anularVenta: true, emitirTicketCorregido: true },
    repeticion: "NUEVA",
    venta: {
      proceso: venta.proceso,
      anuladaEn: venta.anuladaEn,
      yaReemplazada: venta.yaReemplazada,
      promoCuentaId: paraAnular.promoCuentaId,
      operacionPadreId: paraAnular.operacionPadreId,
      hijasVigentes: paraAnular.hijasVigentes,
      unidades,
    },
    unidadesVistas,
    unidadesAQuitar,
    posteriores: await cargarPosterioresDeVentas(tx, { ventas: [paraAnular], sucursalId: actor.sucursalId }),
  });
  if (!decision.ok) return fracaso(decision.motivo, decision.mensaje);
  if (decision.alcance === "TOTAL") return fracaso("ALCANCE_TOTAL", "Quitar todas las unidades es anular la línea entera: usá «Corregir línea».");

  const quedan = unidades - unidadesAQuitar;
  const lineasNuevas = copiarVentaConMenosUnidades(venta.lineas, { unidadesOriginales: unidades, unidadesAQuitar, decimalesDe: (productoId) => venta.decimalesPorProducto.get(productoId) ?? 0 });

  const anulada = await anularVentaEnTx(tx, actor, { operacionId, motivo }, idempotencia);
  if (!anulada.ok) return fracaso(anulada.codigo, anulada.mensaje);
  const { ventaNuevaId } = await escribirVentaCorregida(tx, { ventaReemplazadaId: operacionId, sucursalId: actor.sucursalId, cabecera: venta.cabecera, lineas: lineasNuevas });
  await registrarCambioAuditado(tx, {
    entidad: "Operacion",
    entidadId: operacionId,
    descripcion: `Venta corregida quitando ${unidadesAQuitar} unidad(es): la reemplaza la venta ${ventaNuevaId}. Motivo: ${motivo}`,
    campo: "unidadesVendidas",
    valorAnterior: String(unidades),
    valorNuevo: String(quedan),
    actorId: actor.usuarioId,
    sucursalId: actor.sucursalId,
  });
  return exito(anulada.mensaje, { ventaNuevaId, unidadesAntes: unidades, unidadesQueQuedan: quedan, reversionId: anulada.datos.reversionIds[0]! });
}

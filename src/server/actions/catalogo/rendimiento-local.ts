"use server";

import { esNumeroFinito } from "@/core/numero";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conTransaccionSerializable, esConflictoDeEscritura } from "@/core/movimientos/con-reintento";
import { describirCalibracion, describirVueltaAlCentral, normalizarOrigen, type OrigenCalibracionInput } from "@/core/catalogo/public";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

/** Decimal(14,4) del schema — tope defensivo, ver docstring del modelo. */
const TOPE_CANTIDAD = 100_000_000; // 10 dígitos enteros + 4 decimales, con margen
const TOPE_MERMA = 9999.99;

function validarCantidad(c: number | null | undefined): string | null {
  if (c === null || c === undefined) return null;
  if (!esNumeroFinito(c) || !(c > 0)) return "La cantidad tiene que ser un número mayor a 0.";
  if (c >= TOPE_CANTIDAD) return "La cantidad es demasiado grande.";
  return null;
}

function validarMerma(m: number | null | undefined): string | null {
  if (m === null || m === undefined) return null;
  if (!esNumeroFinito(m)) return "La merma no es un número válido.";
  if (m < 0 || m > TOPE_MERMA) return "La merma tiene que estar entre 0 y 9999,99.";
  return null;
}

const INCLUDE_LINEA = {
  recetaVersion: { include: { producto: { select: { nombre: true } } } },
  insumoProducto: { select: { nombre: true } },
  unidad: { select: { nombre: true } },
} as const;

/**
 * D4 (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md): calibra el rendimiento (cantidad y/o merma) de UNA línea
 * de receta EN LA SUCURSAL ACTIVA — nunca recibe `sucursalId` por parámetro, siempre `ctx.sucursalId` (elimina de raíz el
 * bug original del reporte, que navegaba al editor CENTRAL con `?sugerido=`). Valida que la línea siga siendo la VIGENTE
 * de su receta (si cambió mientras se miraba el reporte, se rechaza en vez de calibrar una versión vieja). SERIALIZABLE
 * con reintento: si choca con un `guardarReceta` concurrente que arrastra/descarta esta misma línea, una de las dos
 * transacciones pierde la carrera de forma limpia (D3).
 *
 * DECISIÓN DEL DUEÑO (D4): "cantidad" es SIEMPRE el estimado NETO ya congelado (mismo criterio que hoy escribe la
 * receta), y `origen` (si viene de una sugerencia) trae la merma EFECTIVA que se usó para calcularlo — las dos se
 * guardan juntas ("la merma se congela junto con la cantidad").
 */
export async function fijarRendimientoLocal(
  recetaIngredienteId: string,
  valores: { cantidad: number | null; mermaPorcentaje: number | null },
  origen?: OrigenCalibracionInput
): Promise<ResultadoAccion> {
  return conPermiso("calibrar_rendimiento_local", async (ctx) => {
    const errCantidad = validarCantidad(valores.cantidad);
    if (errCantidad) return error(errCantidad);
    const errMerma = validarMerma(valores.mermaPorcentaje);
    if (errMerma) return error(errMerma);
    if (valores.cantidad === null && valores.mermaPorcentaje === null) {
      return error("Elegí al menos un valor para calibrar (cantidad o merma).");
    }

    // D6(c): el origen es una anotación declarada por el cliente, nunca una prueba — se normaliza y, si la sucursal con
    // la que se armó la sugerencia ya no es la activa, se rechaza (evita escribir en la sucursal equivocada si el
    // usuario cambió de sucursal con el reporte todavía abierto en otra pestaña).
    const origenNormalizado = origen ? normalizarOrigen(origen) : null;
    if (origenNormalizado && origenNormalizado.sucursalCalculoId !== ctx.sucursalId) {
      return error("Cambiaste de sucursal desde que abriste el reporte; recargalo.");
    }

    return conTransaccionSerializable(async (tx) => {
      const ing = await tx.recetaIngrediente.findUnique({ where: { id: recetaIngredienteId }, include: INCLUDE_LINEA });
      if (!ing) return error("No se encontró esa línea de receta.");

      const vigente = await tx.recetaVersion.findFirst({ where: { productoId: ing.recetaVersion.productoId }, orderBy: { version: "desc" }, select: { id: true } });
      if (!vigente || vigente.id !== ing.recetaVersionId) {
        return error("La receta cambió mientras mirabas el reporte; recargá.");
      }

      const existente = await tx.rendimientoLocalIngrediente.findUnique({
        where: { recetaIngredienteId_sucursalId: { recetaIngredienteId, sucursalId: ctx.sucursalId } },
      });
      await tx.rendimientoLocalIngrediente.upsert({
        where: { recetaIngredienteId_sucursalId: { recetaIngredienteId, sucursalId: ctx.sucursalId } },
        create: { recetaIngredienteId, sucursalId: ctx.sucursalId, cantidad: valores.cantidad, mermaPorcentaje: valores.mermaPorcentaje },
        update: { cantidad: valores.cantidad, mermaPorcentaje: valores.mermaPorcentaje },
      });

      // Auditoría (D6(a)): clave ESTABLE (no el id de la fila, que cambia con el arrastre entre versiones) — dos
      // registros, uno por campo, cada uno no-op si ese campo puntual no cambió.
      const entidadId = `${ctx.sucursalId}:${ing.recetaVersion.productoId}:${ing.insumoProductoId}`;
      const central = { cantidad: Number(ing.cantidad), mermaPorcentaje: Number(ing.mermaPorcentaje), unidadNombre: ing.unidad.nombre };
      const args = { productoNombre: ing.recetaVersion.producto.nombre, insumoNombre: ing.insumoProducto.nombre, sucursalNombre: ctx.sucursalNombre, central, origen: origenNormalizado, guardado: valores };

      await registrarCambioAuditado(tx, {
        entidad: "RendimientoLocalIngrediente", entidadId, campo: "cantidad",
        descripcion: describirCalibracion({ ...args, campo: "cantidad" }),
        valorAnterior: existente?.cantidad !== null && existente?.cantidad !== undefined ? Number(existente.cantidad) : null,
        valorNuevo: valores.cantidad,
        actorId: ctx.usuarioId, sucursalId: ctx.sucursalId,
      });
      await registrarCambioAuditado(tx, {
        entidad: "RendimientoLocalIngrediente", entidadId, campo: "mermaPorcentaje",
        descripcion: describirCalibracion({ ...args, campo: "mermaPorcentaje" }),
        valorAnterior: existente?.mermaPorcentaje !== null && existente?.mermaPorcentaje !== undefined ? Number(existente.mermaPorcentaje) : null,
        valorNuevo: valores.mermaPorcentaje,
        actorId: ctx.usuarioId, sucursalId: ctx.sucursalId,
      });

      refrescarVistaSiHaceFalta();
      return ok(`Rendimiento de "${ing.insumoProducto.nombre}" en "${ing.recetaVersion.producto.nombre}" calibrado para «${ctx.sucursalNombre}».`);
    }).catch((e) => {
      // conTransaccionSerializable ya reintenta un conflicto de escritura (esConflictoDeEscritura) — esto solo cubre el
      // caso de agotar los reintentos, con el mismo mensaje de negocio que el choque de versión de más arriba.
      if (esConflictoDeEscritura(e)) return error("La receta cambió mientras mirabas el reporte; recargá.");
      throw e;
    });
  });
}

/** D4: "Volver al valor central" — pone los dos campos en `null` (NO borra la fila, mismo criterio append-only del resto del proyecto) y lo audita. */
export async function volverAlRendimientoCentral(recetaIngredienteId: string): Promise<ResultadoAccion> {
  return conPermiso("calibrar_rendimiento_local", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const ing = await tx.recetaIngrediente.findUnique({ where: { id: recetaIngredienteId }, include: INCLUDE_LINEA });
      if (!ing) return error("No se encontró esa línea de receta.");

      const vigente = await tx.recetaVersion.findFirst({ where: { productoId: ing.recetaVersion.productoId }, orderBy: { version: "desc" }, select: { id: true } });
      if (!vigente || vigente.id !== ing.recetaVersionId) {
        return error("La receta cambió mientras mirabas el reporte; recargá.");
      }

      const existente = await tx.rendimientoLocalIngrediente.findUnique({
        where: { recetaIngredienteId_sucursalId: { recetaIngredienteId, sucursalId: ctx.sucursalId } },
      });
      if (!existente || (existente.cantidad === null && existente.mermaPorcentaje === null)) {
        return ok(`"${ing.insumoProducto.nombre}" en "${ing.recetaVersion.producto.nombre}" ya usa el valor central en «${ctx.sucursalNombre}».`);
      }

      await tx.rendimientoLocalIngrediente.update({
        where: { recetaIngredienteId_sucursalId: { recetaIngredienteId, sucursalId: ctx.sucursalId } },
        data: { cantidad: null, mermaPorcentaje: null },
      });

      const entidadId = `${ctx.sucursalId}:${ing.recetaVersion.productoId}:${ing.insumoProductoId}`;
      const descripcion = describirVueltaAlCentral({ productoNombre: ing.recetaVersion.producto.nombre, insumoNombre: ing.insumoProducto.nombre, sucursalNombre: ctx.sucursalNombre });
      await registrarCambioAuditado(tx, {
        entidad: "RendimientoLocalIngrediente", entidadId, campo: "cantidad", descripcion,
        valorAnterior: existente.cantidad !== null ? Number(existente.cantidad) : null, valorNuevo: null,
        actorId: ctx.usuarioId, sucursalId: ctx.sucursalId,
      });
      await registrarCambioAuditado(tx, {
        entidad: "RendimientoLocalIngrediente", entidadId, campo: "mermaPorcentaje", descripcion,
        valorAnterior: existente.mermaPorcentaje !== null ? Number(existente.mermaPorcentaje) : null, valorNuevo: null,
        actorId: ctx.usuarioId, sucursalId: ctx.sucursalId,
      });

      refrescarVistaSiHaceFalta();
      return ok(`"${ing.insumoProducto.nombre}" en "${ing.recetaVersion.producto.nombre}" vuelve a usar el valor central en «${ctx.sucursalNombre}».`);
    }).catch((e) => {
      if (esConflictoDeEscritura(e)) return error("La receta cambió mientras mirabas el reporte; recargá.");
      throw e;
    });
  });
}

"use server";

import { prisma } from "@/lib/db";
import { esNumeroFinito } from "@/core/numero";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

/**
 * Registra un pago a un proveedor de consignación, para saldar (parcial o
 * totalmente) su "Debido por consignante" (ver core/reportes/consignacion.ts)
 * — antes no existía ninguna acción para esto: el saldo solo podía crecer
 * (hallazgo de la auditoría de motor2). Append-only, igual que el resto
 * del Kardex: nunca se tocan las líneas LIQUIDACION_CONSIGNACION, esto es
 * un registro aparte que el reporte resta.
 */
export async function registrarPagoConsignante(proveedorId: string, importe: number, fecha: Date, notas?: string): Promise<ResultadoAccion> {
  return conPermiso("pagar_consignante", async (ctx) => {
    if (!(importe > 0)) return error("El importe tiene que ser mayor a 0.");
    if (!esNumeroFinito(importe)) return error("El importe no es un número válido.");

    const proveedor = await prisma.proveedor.findUnique({ where: { id: proveedorId } });
    if (!proveedor || !proveedor.activo) return error("No se encontró el proveedor, o está inactivo.");

    await prisma.pagoConsignante.create({
      data: { sucursalId: ctx.sucursalId, proveedorId, importe, fecha, notas: notas || undefined, usuarioId: ctx.usuarioId },
    });
    return ok(`Pago de $${importe.toLocaleString("es-AR")} a "${proveedor.nombre}" registrado.`);
  });
}

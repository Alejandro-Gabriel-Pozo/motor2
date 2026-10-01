import "server-only";

import type { Prisma } from "@prisma/client";
import type { AvisoStockNegativo } from "@/core/movimientos/public-servidor";

/**
 * Toma de pedido en el salón (módulo POS, docs/plan-tomar-pedido-2026-09-25.md). Todas las escrituras corren en una transacción
 * SERIALIZABLE (Postgres arbitra el doble clic y las carreras entre mozos: test/pos/cuenta-concurrencia.test.ts), verifican que la
 * mesa sea de la sucursal activa y que la cuenta siga abierta. Ninguna refresca la vista: sus llamadores (componentes de cliente de
 * src/app/(pos)/mesas/[mesaId]/) hacen `router.refresh()`.
 *
 * Modelo (bloque POS de prisma/schema.prisma): «enviar a cocina» numera los ítems (KOT derivado de `numeroEnvio`); un ítem sin enviar
 * es un borrador y se quita con DELETE físico; uno ya enviado solo se anula con motivo (`anularItemEnviado`, permiso propio).
 */

// Este archivo NO lleva `"use server"` a propósito: son ayudantes compartidos por las acciones de «tomar pedido»
// (cuenta-apertura.ts, cuenta-pedido.ts, cuenta-anulacion.ts, cuenta-cierre.ts), sin guarda propia — todo lo que exporta un
// archivo `"use server"` es un endpoint que se puede invocar directo. `server-only` hace fallar el build si un componente de
// cliente lo importa.

/** Cantidad legible («1», «0,5»), para mensajes y descripciones de auditoría. */
export function formatearCantidad(n: number): string {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(n);
}

export const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** «"Muzzarella" en «Cocina» (tenía 0,5, se consumió 1,5, quedó en -1)»: el detalle de un insumo que quedó en negativo al cerrar una cuenta. */
export function describirAviso(aviso: AvisoStockNegativo): string {
  return `"${aviso.nombre}" en «${aviso.seccionNombre}» (tenía ${formatearCantidad(aviso.actual)}, se consumió ${formatearCantidad(aviso.requerido)}, quedó en ${formatearCantidad(aviso.resultante)})`;
}

export type CuentaAbierta = { id: string; clienteId: string | null; descuentoPorcentaje: Prisma.Decimal | null; mesa: { id: string; numero: number } };

/** La cuenta pedida, si es de una mesa de esta sucursal y sigue abierta; si no, el mensaje de error listo para devolver. */
export async function cuentaAbiertaDeSucursal(tx: Prisma.TransactionClient, cuentaId: string, sucursalId: string): Promise<{ ok: true; cuenta: CuentaAbierta } | { ok: false; mensaje: string }> {
  const cuenta = typeof cuentaId === "string" ? await tx.cuenta.findFirst({ where: { id: cuentaId, mesa: { sucursalId } }, include: { mesa: { select: { id: true, numero: true } } } }) : null;
  if (!cuenta) return { ok: false, mensaje: "No se encontró esa cuenta en esta sucursal." };
  if (cuenta.cerradaEn) return { ok: false, mensaje: `La cuenta de la mesa ${cuenta.mesa.numero} ya está cerrada.` };
  return { ok: true, cuenta };
}

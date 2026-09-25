import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { esNumeroFinito } from "@/core/numero";
import { texto, LARGO_MAXIMO_MOTIVO_ANULACION } from "@/core/texto";
import { redondearACantidadDeUnidad } from "@/core/movimientos/transiciones";
import { totalDeLineas } from "@/core/moneda";
import { nombreDelMesero, tiempoDesde } from "./mesas";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Cuenta de una mesa: núcleo puro y de consulta de «tomar pedido» (módulo POS, docs/plan-tomar-pedido-2026-09-25.md, paso 2).
 * Sin permisos ni escrituras: las Server Actions (src/server/actions/pos/cuenta.ts) y la pantalla de detalle
 * (src/app/(pos)/mesas/[mesaId]/page.tsx) lo usan después de su propia guarda.
 *
 * Dos reglas del modelo (comentario del bloque POS en prisma/schema.prisma):
 * - KOT derivado: un ítem con `numeroEnvio` null está SIN ENVIAR; con 1..n, salió en ese envío a cocina.
 * - Anulación = fila ESPEJO: un CuentaItem con cantidad negativa y `anulaAItemId` al original, que nunca se toca. Lo que queda de un
 *   ítem es `cantidad + Σ espejos` — se calcula, no se guarda.
 */

/** Cantidades de la columna `Decimal(14, 4)`: la suma en coma flotante no deja «1,9999999». */
function redondearCantidad(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Cuánto queda vigente de un ítem original después de sus anulaciones (espejos con cantidad negativa). */
export function restanteDe(item: { cantidad: number }, espejos: readonly { cantidad: number }[]): number {
  return redondearCantidad(espejos.reduce((suma, e) => suma + e.cantidad, item.cantidad));
}

export interface LineaDeVenta {
  productoId: string;
  precioUnitario: number;
  cantidad: number;
}

/**
 * Líneas NETAS para registrar la venta de una cuenta: suma originales y espejos por (producto, precio congelado) — el mismo producto
 * cargado a dos precios distintos (cambió el Precio Local entre una ronda y otra) queda en dos líneas, cada una a su precio. Una línea
 * neta ≤ 0 (anulada entera) se descarta: no se vende. Orden: el de la primera aparición de cada línea.
 */
export function lineasDeVenta(items: readonly { productoId: string; cantidad: number; precioUnitario: number }[]): LineaDeVenta[] {
  const porClave = new Map<string, LineaDeVenta>();
  for (const item of items) {
    const clave = `${item.productoId}|${item.precioUnitario}`;
    const previa = porClave.get(clave);
    if (previa) previa.cantidad = redondearCantidad(previa.cantidad + item.cantidad);
    else porClave.set(clave, { productoId: item.productoId, precioUnitario: item.precioUnitario, cantidad: redondearCantidad(item.cantidad) });
  }
  return [...porClave.values()].filter((l) => l.cantidad > 0);
}

export interface ItemAgrupable {
  id: string;
  cantidad: number;
  numeroEnvio: number | null;
  anulaAItemId: string | null;
}

export type ItemEnEnvio<T> = T & { restante: number; anulaciones: T[] };

export interface ItemsAgrupados<T> {
  /** Ítems todavía sin enviar a cocina (borradores), en el orden recibido. */
  sinEnviar: T[];
  /** Envíos a cocina en orden (1, 2, …): cada ítem original con lo que le queda y sus anulaciones colgadas. */
  envios: { numero: number; items: ItemEnEnvio<T>[] }[];
}

/**
 * «Sin enviar» + un grupo por envío a cocina. Las filas espejo no aparecen sueltas: cuelgan de su ítem original (`anulaciones`),
 * que lleva además su `restante`. Respeta el orden recibido dentro de cada grupo.
 */
export function agruparPorEnvio<T extends ItemAgrupable>(items: readonly T[]): ItemsAgrupados<T> {
  const espejosDe = new Map<string, T[]>();
  for (const item of items) {
    if (item.anulaAItemId === null) continue;
    espejosDe.set(item.anulaAItemId, [...(espejosDe.get(item.anulaAItemId) ?? []), item]);
  }

  const sinEnviar: T[] = [];
  const porEnvio = new Map<number, ItemEnEnvio<T>[]>();
  for (const item of items) {
    if (item.anulaAItemId !== null) continue;
    if (item.numeroEnvio === null) {
      sinEnviar.push(item);
      continue;
    }
    const anulaciones = espejosDe.get(item.id) ?? [];
    const grupo = porEnvio.get(item.numeroEnvio) ?? [];
    grupo.push({ ...item, restante: restanteDe(item, anulaciones), anulaciones });
    porEnvio.set(item.numeroEnvio, grupo);
  }

  return {
    sinEnviar,
    envios: [...porEnvio.entries()].sort(([a], [b]) => a - b).map(([numero, grupo]) => ({ numero, items: grupo })),
  };
}

export const CANTIDAD_MAXIMA_POR_ITEM = 999;

/**
 * Cantidad de un ítem al tomar el pedido (o al anularlo): número finito, mayor que cero y hasta 999, redondeada a los decimales que
 * acepta la unidad de stock del producto (igual que entra al Kardex). Si el redondeo la deja en cero, tampoco sirve.
 */
export function validarCantidadPedido(cantidad: unknown, decimales: number): { ok: true; cantidad: number } | { ok: false; mensaje: string } {
  const n = typeof cantidad === "number" ? cantidad : Number.NaN;
  if (!(n > 0) || !esNumeroFinito(n)) return { ok: false, mensaje: "La cantidad tiene que ser un número mayor que cero." };
  if (n > CANTIDAD_MAXIMA_POR_ITEM) return { ok: false, mensaje: `La cantidad no puede superar ${CANTIDAD_MAXIMA_POR_ITEM}.` };
  const redondeada = redondearACantidadDeUnidad(n, decimales);
  if (!(redondeada > 0)) return { ok: false, mensaje: "La cantidad tiene que ser un número mayor que cero." };
  return { ok: true, cantidad: redondeada };
}

/** Motivo de anulación de un ítem ya enviado: obligatorio (sin espacios sueltos) y de hasta 200 caracteres. */
export function validarMotivoAnulacion(motivo: unknown): { ok: true; motivo: string } | { ok: false; mensaje: string } {
  const v = texto(motivo);
  if (!v) return { ok: false, mensaje: "Escribí el motivo de la anulación." };
  if (v.length > LARGO_MAXIMO_MOTIVO_ANULACION) return { ok: false, mensaje: `El motivo no puede superar los ${LARGO_MAXIMO_MOTIVO_ANULACION} caracteres.` };
  return { ok: true, motivo: v };
}

export interface ItemDeCuenta {
  id: string;
  productoId: string;
  productoNombre: string;
  /** Decimales que acepta la unidad de stock del producto (para la cantidad de una anulación parcial). */
  decimales: number;
  cantidad: number;
  precioUnitario: number;
  numeroEnvio: number | null;
  anulaAItemId: string | null;
  motivoAnulacion: string | null;
  /** Quién cargó el ítem (o quién anuló, en un espejo); null en filas anteriores a «tomar pedido». */
  creadoPor: string | null;
  creadoEn: Date;
}

export interface DetalleDeCuenta {
  id: string;
  abiertaEn: Date;
  mesero: string;
  tiempoAbierta: string;
  /** Σ cantidad × precio de TODAS las filas (espejos incluidos): lo que se cobraría hoy. Mismo cálculo que el mapa. */
  total: number;
  sinEnviar: ItemDeCuenta[];
  envios: { numero: number; items: ItemEnEnvio<ItemDeCuenta>[] }[];
  /** Cantidad de filas de la cuenta (originales + espejos): «Liberar mesa» solo aplica con cero. */
  itemsTotales: number;
}

export interface DetalleDeMesa {
  mesa: { id: string; numero: number };
  cuenta: DetalleDeCuenta | null;
}

/**
 * La mesa pedida con su cuenta abierta (si tiene), agrupada por envío — una sola consulta. `null` si la mesa no existe o no es de
 * esta sucursal (el aislamiento por sucursal vive acá, no en quien llama).
 */
export async function obtenerDetalleDeMesa(sucursalId: string, mesaId: string, db: Db = prisma, ahora: Date = new Date()): Promise<DetalleDeMesa | null> {
  const mesa = await db.mesa.findFirst({
    where: { id: mesaId, sucursalId },
    include: {
      cuentas: {
        where: { cerradaEn: null },
        include: {
          abiertaPor: { select: { name: true, email: true } },
          items: {
            orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
            include: {
              producto: { select: { nombre: true, unidadStock: { select: { decimales: true } } } },
              creadoPor: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
  });
  if (!mesa) return null;

  const fila = mesa.cuentas[0] ?? null; // el índice único parcial garantiza a lo sumo una abierta
  if (!fila) return { mesa: { id: mesa.id, numero: mesa.numero }, cuenta: null };

  const items: ItemDeCuenta[] = fila.items.map((i) => ({
    id: i.id,
    productoId: i.productoId,
    productoNombre: i.producto.nombre,
    decimales: i.producto.unidadStock.decimales,
    cantidad: Number(i.cantidad),
    precioUnitario: Number(i.precioUnitario),
    numeroEnvio: i.numeroEnvio,
    anulaAItemId: i.anulaAItemId,
    motivoAnulacion: i.motivoAnulacion,
    creadoPor: i.creadoPor ? nombreDelMesero(i.creadoPor) : null,
    creadoEn: i.creadoEn,
  }));
  const { sinEnviar, envios } = agruparPorEnvio(items);

  return {
    mesa: { id: mesa.id, numero: mesa.numero },
    cuenta: {
      id: fila.id,
      abiertaEn: fila.abiertaEn,
      mesero: nombreDelMesero(fila.abiertaPor),
      tiempoAbierta: tiempoDesde(fila.abiertaEn, ahora),
      total: totalDeLineas(items),
      sinEnviar,
      envios,
      itemsTotales: items.length,
    },
  };
}

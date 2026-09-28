import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { esNumeroFinito } from "@/core/numero";
import { texto, LARGO_MAXIMO_MOTIVO_ANULACION } from "@/core/texto";
import { importeDeLinea, precioConDescuento, redondearMoneda } from "@/core/moneda";
import { nombreDelMesero, tiempoDesde } from "./mesas";
import { validarCantidadPedido } from "./cantidad-pedido";

// Re-exportada: quien ya la importaba de acá (test/pos/cuenta.test.ts, esta misma Server Action) sigue andando igual. Vive en
// `cantidad-pedido.ts` porque ESTE archivo importa `@/lib/db` a nivel de módulo — un cliente no puede importarlo ni para esto solo.
export { validarCantidadPedido };

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
  /** Task #16 (promo-combo, docs/plan-promo-combo-2026-09-26.md, paso 3): la `PromoCuenta` de la que este componente forma
   *  parte — SOLO presente cuando el ítem que lo originó tenía uno. Ausente = un suelto de siempre, salida IDÉNTICA a antes
   *  de esta Task. Suma a la CLAVE de agrupación (ver abajo) para que un suelto y un componente de promo del MISMO producto
   *  al MISMO precio nunca se mezclen en una sola línea/Operacion (`cerrarCuenta`, paso 8c). */
  promoCuentaId?: string;
}

/**
 * Líneas NETAS para registrar la venta de una cuenta: suma originales y espejos por (producto, precio congelado, promo) — el
 * mismo producto cargado a dos precios distintos (cambió el Precio Local entre una ronda y otra) queda en dos líneas, cada una
 * a su precio; el mismo producto al MISMO precio pero uno suelto y otro como componente de una promo (o de dos promos
 * distintas) también queda en líneas separadas (Task #16, D4: una promo se anula ENTERA, nunca mezclada con un suelto en la
 * misma Operacion). Una línea neta ≤ 0 (anulada entera) se descarta: no se vende. Orden: el de la primera aparición de cada
 * línea. Sin ningún `promoCuentaId` en la entrada, la salida es EXACTAMENTE la de antes de esta Task (mismo criterio aditivo
 * que el resto del plan).
 */
export function lineasDeVenta(items: readonly { productoId: string; cantidad: number; precioUnitario: number; promoCuentaId?: string | null }[]): LineaDeVenta[] {
  const porClave = new Map<string, LineaDeVenta>();
  for (const item of items) {
    const promoCuentaId = item.promoCuentaId ?? undefined;
    const clave = `${item.productoId}|${item.precioUnitario}|${promoCuentaId ?? ""}`;
    const previa = porClave.get(clave);
    if (previa) previa.cantidad = redondearCantidad(previa.cantidad + item.cantidad);
    else porClave.set(clave, { productoId: item.productoId, precioUnitario: item.precioUnitario, cantidad: redondearCantidad(item.cantidad), ...(promoCuentaId ? { promoCuentaId } : {}) });
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

const COMENSALES_MAXIMO = 99;

/**
 * Comensales al abrir la cuenta, o al corregirlos después (docs/plan-comensales-y-limite-mesas-2026-09-26.md): entero entre 1 y
 * {@link COMENSALES_MAXIMO}, SIN valor por defecto — quien llama tiene que mandar un número, nunca se completa solo (ver el
 * docstring de `Cuenta.comensales` en prisma/schema.prisma: un default sesgaría la métrica de rotación que existe para medir).
 * Solo enteros: no tiene sentido "2,5 comensales".
 */
export function validarComensales(valor: unknown): { ok: true; comensales: number } | { ok: false; mensaje: string } {
  const n = typeof valor === "number" ? valor : Number.NaN;
  if (!Number.isInteger(n) || !esNumeroFinito(n) || n < 1 || n > COMENSALES_MAXIMO) {
    return { ok: false, mensaje: `La cantidad de comensales tiene que ser un número entero entre 1 y ${COMENSALES_MAXIMO}.` };
  }
  return { ok: true, comensales: n };
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
  /** Task #16 (docs/plan-promo-combo-2026-09-26.md, paso 10): la promo de la que este ítem es un componente — null en un
   *  suelto de siempre. `promoTitulo` es el snapshot congelado (`PromoCuenta.titulo`), no el título actual de `PromoCarta`. */
  promoCuentaId: string | null;
  promoTitulo: string | null;
}

export interface DetalleDeCuenta {
  id: string;
  abiertaEn: Date;
  mesero: string;
  tiempoAbierta: string;
  /** `null` = cuenta abierta antes de este campo (sin backfill) — ver el docstring de `Cuenta.comensales`. */
  comensales: number | null;
  /** Cliente con descuento asignado (Task #14, docs/plan-clientes-descuento-2026-09-26.md) — `null` = sin cliente, precio de lista. */
  clienteId: string | null;
  cliente: string | null;
  /** El % YA CONGELADO en la cuenta (`Cuenta.descuentoPorcentaje`), no el actual del `Cliente` — ver `asignarClienteACuenta`. */
  descuentoPorcentaje: number | null;
  /** Σ cantidad × precio COBRADO de TODAS las filas (espejos incluidos, con el descuento de cliente ya aplicado si hay uno): lo que
   *  se cobraría si se cerrara AHORA. Mismo cálculo que `cerrarCuenta`/la boleta (`precioConDescuento`, src/core/moneda.ts). */
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
          cliente: { select: { nombre: true } },
          items: {
            orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
            include: {
              producto: { select: { nombre: true, unidadStock: { select: { decimales: true } } } },
              creadoPor: { select: { name: true, email: true } },
              promoCuenta: { select: { id: true, titulo: true } },
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
    promoCuentaId: i.promoCuenta?.id ?? null,
    promoTitulo: i.promoCuenta?.titulo ?? null,
  }));
  const { sinEnviar, envios } = agruparPorEnvio(items);
  const descuentoPorcentaje = fila.descuentoPorcentaje !== null ? Number(fila.descuentoPorcentaje) : null;

  return {
    mesa: { id: mesa.id, numero: mesa.numero },
    cuenta: {
      id: fila.id,
      abiertaEn: fila.abiertaEn,
      mesero: nombreDelMesero(fila.abiertaPor),
      tiempoAbierta: tiempoDesde(fila.abiertaEn, ahora),
      comensales: fila.comensales,
      clienteId: fila.clienteId,
      cliente: fila.cliente?.nombre ?? null,
      descuentoPorcentaje,
      // Σ del importe COBRADO de cada línea (importeDeLinea sobre precioConDescuento), no la suma cruda re-redondeada: así el total
      // en pantalla nunca difiere del que registraría un cierre inmediato (boleta y cerrarCuenta usan el mismo criterio; sin
      // cliente, precioConDescuento devuelve el precio de lista tal cual). redondearMoneda solo limpia el ruido del float.
      total: redondearMoneda(items.reduce((suma, i) => suma + importeDeLinea(i.cantidad, precioConDescuento(i.precioUnitario, descuentoPorcentaje)), 0)),
      sinEnviar,
      envios,
      itemsTotales: items.length,
    },
  };
}

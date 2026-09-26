import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { importeDeLinea, redondearMoneda } from "@/core/moneda";
import { lineasDeVenta } from "./cuenta";
import { nombreDelMesero } from "./mesas";
import type { NumeroDeBoleta } from "./numeracion-boleta";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Boleta de cierre de una cuenta: el documento para el CLIENTE, con precios (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B5/B8).
 * Otro documento que la comanda de cocina (src/core/pos/comanda.ts), con su propio tipo: nunca un «ticket genérico» con banderas.
 *
 * Derivada, sin tabla ni campo nuevo: una cuenta cerrada ya no cambia (`anularItemEnviado`/`quitarItemSinEnviar` la rechazan), así que
 * volver a armar `lineasDeVenta` sobre sus ítems da exactamente las líneas que `cerrarCuenta` registró como venta (una Operacion VENTA
 * por línea neta producto + precio congelado; las líneas con neto ≤ 0 no se venden y no aparecen), y el total, el mismo cálculo.
 * Sin forma de pago ni propina (no existen en el modelo) y sin el aviso de stock negativo (es información interna del Kardex: queda en
 * el aviso de la pantalla y en la auditoría). El NÚMERO de la boleta sí es una fila propia, `EjemplarBoleta`, que emite `cerrarCuenta`
 * (docs/plan-numeracion-boleta-2026-09-25.md): control interno de comandas, no comprobante fiscal.
 */

/** Cuántas cuentas cerradas con venta lista «Cuentas cerradas» en la pantalla de la mesa. */
export const BOLETAS_RECIENTES_POR_MESA = 3;

export interface LineaDeBoleta {
  producto: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

/**
 * Si el último ejemplar impreso sigue valiendo (docs/plan-numeracion-boleta-2026-09-25.md, D6 y paso 6):
 * - «vigente»: ninguna Operacion VENTA de la cuenta se anuló después de imprimirlo (se reimprime tal cual, aunque sea un B);
 * - «desactualizada»: alguna se anuló DESPUÉS (anulación parcial de una línea desde Trazabilidad): hace falta el ejemplar de corrección;
 * - «anulada»: se anularon TODAS: no queda nada que cobrar ni que corregir.
 */
export type EstadoDeBoleta = "vigente" | "desactualizada" | "anulada";

export interface BoletaDeCuenta {
  cuentaId: string;
  cerradaEn: Date;
  /** Quién atendió: el mozo que abrió la cuenta. */
  mesero: string;
  /** Las líneas VIGENTES: sin las de una Operacion VENTA anulada. */
  lineas: LineaDeBoleta[];
  total: number;
  /** ALGUNA Operacion VENTA de la cuenta se anuló (`anularVenta`). Si fueron todas, `estado` es «anulada». */
  ventaAnulada: boolean;
  /** El último ejemplar impreso («566-A», «566-B»…); null en una cuenta cerrada antes de la numeración (sin backfill). */
  numero: NumeroDeBoleta | null;
  /** El ejemplar A que corrige el último ejemplar, si es una corrección (B, C…); null si el último es el A o no hay número. */
  corrigeA: NumeroDeBoleta | null;
  estado: EstadoDeBoleta;
}

/** Un ítem de la cuenta con la anulación de la Operacion VENTA que lo registró (null: vigente, o sin operación). */
export interface ItemConVenta {
  productoId: string;
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  operacionId: string | null;
  anuladaEn: Date | null;
}

/**
 * Líneas y total de la boleta TAL COMO SE VEÍA en el instante `impresaEn` (el reporte de boletas emitidas, Task #17: «como se
 * imprimió» un ejemplar viejo, no como está la cuenta ahora): `armarBoleta` sobre los ítems cuya Operacion VENTA no estaba anulada
 * en ese momento — vigente (`anuladaEn === null`) o anulada DESPUÉS (`anuladaEn > impresaEn`, una anulación posterior a esa
 * impresión no le resta nada a lo que ese papel mostró). Es la misma cuenta que hace `estadoDeBoleta` para decidir «desactualizada».
 */
export function armarBoletaImpresaEn(items: readonly ItemConVenta[], impresaEn: Date): { lineas: LineaDeBoleta[]; total: number } {
  return armarBoleta(items.filter((i) => i.anuladaEn === null || i.anuladaEn > impresaEn));
}

/**
 * Líneas y total de lo que sigue vendido AHORA: el caso «impresaEn = este instante» de `armarBoletaImpresaEn` (ninguna anulación
 * real puede ser posterior a "ahora", así que el filtro se reduce a `anuladaEn === null`). Funciona por línea porque `cerrarCuenta`
 * enlaza a la operación de su línea TODOS los ítems de esa línea (originales y filas espejo).
 */
export function armarBoletaVigente(items: readonly ItemConVenta[]): { lineas: LineaDeBoleta[]; total: number } {
  return armarBoletaImpresaEn(items, new Date());
}

/** Estado del último ejemplar impreso en `impresaEn` (sin número: el cierre de la cuenta), según las Operaciones VENTA de la cuenta. */
export function estadoDeBoleta(items: readonly Pick<ItemConVenta, "operacionId" | "anuladaEn">[], impresaEn: Date): EstadoDeBoleta {
  const anulacionPorOperacion = new Map(items.flatMap((i) => (i.operacionId ? [[i.operacionId, i.anuladaEn] as const] : [])));
  const anulaciones = [...anulacionPorOperacion.values()];
  if (anulaciones.length > 0 && anulaciones.every((a) => a !== null)) return "anulada";
  return anulaciones.some((a) => a !== null && a > impresaEn) ? "desactualizada" : "vigente";
}

/** Líneas netas y total de la boleta, a partir de TODOS los ítems de la cuenta (originales y anulaciones), igual que `cerrarCuenta`. */
export function armarBoleta(items: readonly { productoId: string; productoNombre: string; cantidad: number; precioUnitario: number }[]): { lineas: LineaDeBoleta[]; total: number } {
  const nombres = new Map(items.map((i) => [`${i.productoId}|${i.precioUnitario}`, i.productoNombre]));
  const lineas = lineasDeVenta(items).map((l) => ({
    producto: nombres.get(`${l.productoId}|${l.precioUnitario}`) ?? "",
    cantidad: l.cantidad,
    precioUnitario: l.precioUnitario,
    subtotal: importeDeLinea(l.cantidad, l.precioUnitario),
  }));
  // El total es la suma de los subtotales — el mismo importe por línea que `cerrarCuenta` registra en cada VENTA —, no la suma cruda
  // re-redondeada: así coincide centavo a centavo con lo registrado. redondearMoneda solo limpia el ruido de sumar centavos en float.
  return { lineas, total: redondearMoneda(lineas.reduce((suma, l) => suma + l.subtotal, 0)) };
}

/**
 * Las últimas cuentas cerradas CON VENTA de la mesa (al menos un ítem con `operacionId`: quedan afuera las liberadas sin ítems y las
 * cerradas sin venta), de la más nueva a la más vieja — una sola consulta. Aislada por sucursal: una mesa de otra sucursal no da nada.
 */
export async function obtenerBoletasRecientes(sucursalId: string, mesaId: string, db: Db = prisma, limite: number = BOLETAS_RECIENTES_POR_MESA): Promise<BoletaDeCuenta[]> {
  const cuentas = await db.cuenta.findMany({
    where: { mesaId, mesa: { sucursalId }, cerradaEn: { not: null }, items: { some: { operacionId: { not: null } } } },
    orderBy: [{ cerradaEn: "desc" }, { id: "desc" }],
    take: limite,
    include: {
      abiertaPor: { select: { name: true, email: true } },
      items: {
        orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
        include: { producto: { select: { nombre: true } }, operacion: { select: { anuladaEn: true } } },
      },
      ejemplaresBoleta: {
        orderBy: { ejemplar: "desc" },
        take: 1,
        select: { numero: true, ejemplar: true, emitidoEn: true, corrigeA: { select: { numero: true, ejemplar: true } } },
      },
    },
  });

  return cuentas.map((cuenta) => {
    const cerradaEn = cuenta.cerradaEn ?? new Date(0); // el `where` ya exige cerradaEn no nulo
    const items: ItemConVenta[] = cuenta.items.map((i) => ({
      productoId: i.productoId,
      productoNombre: i.producto.nombre,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precioUnitario),
      operacionId: i.operacionId,
      anuladaEn: i.operacion?.anuladaEn ?? null,
    }));
    const { lineas, total } = armarBoletaVigente(items);
    const ultimo = cuenta.ejemplaresBoleta[0];
    return {
      cuentaId: cuenta.id,
      cerradaEn,
      mesero: nombreDelMesero(cuenta.abiertaPor),
      lineas,
      total,
      ventaAnulada: items.some((i) => i.anuladaEn !== null),
      numero: ultimo ? { numero: ultimo.numero, ejemplar: ultimo.ejemplar } : null,
      corrigeA: ultimo?.corrigeA ?? null,
      estado: estadoDeBoleta(items, ultimo?.emitidoEn ?? cerradaEn),
    };
  });
}

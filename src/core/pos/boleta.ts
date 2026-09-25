import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { importeDeLinea, totalDeLineas } from "@/core/moneda";
import { lineasDeVenta } from "./cuenta";
import { nombreDelMesero } from "./mesas";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Boleta de cierre de una cuenta: el documento para el CLIENTE, con precios (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B5/B8).
 * Otro documento que la comanda de cocina (src/core/pos/comanda.ts), con su propio tipo: nunca un «ticket genérico» con banderas.
 *
 * Derivada, sin tabla ni campo nuevo: una cuenta cerrada ya no cambia (`anularItemEnviado`/`quitarItemSinEnviar` la rechazan), así que
 * volver a armar `lineasDeVenta` sobre sus ítems da exactamente las líneas que `cerrarCuenta` registró como venta (una Operacion VENTA
 * por línea neta producto + precio congelado; las líneas con neto ≤ 0 no se venden y no aparecen), y el total, el mismo cálculo.
 * Sin forma de pago, propina ni número de comprobante (no existen en el modelo) y sin el aviso de stock negativo (es información
 * interna del Kardex: queda en el aviso de la pantalla y en la auditoría).
 */

/** Cuántas cuentas cerradas con venta lista «Cuentas cerradas» en la pantalla de la mesa. */
export const BOLETAS_RECIENTES_POR_MESA = 3;

export interface LineaDeBoleta {
  producto: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface BoletaDeCuenta {
  cuentaId: string;
  cerradaEn: Date;
  /** Quién atendió: el mozo que abrió la cuenta. */
  mesero: string;
  lineas: LineaDeBoleta[];
  total: number;
  /** Alguna Operacion VENTA de la cuenta se anuló (`anularVenta`): la boleta ya no vale y no se reimprime. */
  ventaAnulada: boolean;
}

/** Líneas netas y total de la boleta, a partir de TODOS los ítems de la cuenta (originales y anulaciones), igual que `cerrarCuenta`. */
export function armarBoleta(items: readonly { productoId: string; productoNombre: string; cantidad: number; precioUnitario: number }[]): { lineas: LineaDeBoleta[]; total: number } {
  const nombres = new Map(items.map((i) => [`${i.productoId}|${i.precioUnitario}`, i.productoNombre]));
  const netas = lineasDeVenta(items);
  return {
    lineas: netas.map((l) => ({
      producto: nombres.get(`${l.productoId}|${l.precioUnitario}`) ?? "",
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      subtotal: importeDeLinea(l.cantidad, l.precioUnitario),
    })),
    total: totalDeLineas(netas),
  };
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
    },
  });

  return cuentas.map((cuenta) => {
    const { lineas, total } = armarBoleta(
      cuenta.items.map((i) => ({ productoId: i.productoId, productoNombre: i.producto.nombre, cantidad: Number(i.cantidad), precioUnitario: Number(i.precioUnitario) }))
    );
    return {
      cuentaId: cuenta.id,
      cerradaEn: cuenta.cerradaEn ?? new Date(0), // el `where` ya exige cerradaEn no nulo
      mesero: nombreDelMesero(cuenta.abiertaPor),
      lineas,
      total,
      ventaAnulada: cuenta.items.some((i) => i.operacion?.anuladaEn != null),
    };
  });
}

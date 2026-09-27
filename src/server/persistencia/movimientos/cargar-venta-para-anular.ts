import "server-only";
import type { Prisma } from "@prisma/client";
import type { LineaVendida } from "@/core/movimientos/anulaciones";

/**
 * Carga de una venta para ANULARLA (Task #41, Fase M — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo contrato que
 * `server/persistencia/compras/cargar-compra-para-anular.ts`: `tx` OBLIGATORIO, tipos de dominio con los `Decimal` ya convertidos a
 * `number`, sin reglas de negocio). Son EXACTAMENTE las dos lecturas que antes hacía en línea `anularVenta`
 * (src/server/actions/movimientos/venta.ts), con los mismos filtros y el mismo `include`, y el caso de uso las llama en el mismo orden:
 * primero la venta pedida; recién si pasa las guardas, sus hermanas de promo.
 */

/** Una Operación tal como la necesita el caso de uso `anularVenta`. `proceso` puede no ser VENTA: eso lo rechaza `evaluarAnulacionDeVenta`. */
export interface VentaParaAnular {
  id: string;
  proceso: string;
  anuladaEn: Date | null;
  fecha: Date;
  nroFactura: string | null;
  /** La `PromoCuenta` de la que esta venta es un componente (Task #16), `null` si es una venta suelta. */
  promoCuentaId: string | null;
  lineas: LineaVendida[];
}

type OperacionConLineas = Prisma.OperacionGetPayload<{ include: { movimientos: { include: { producto: true } } } }>;

function aVentaParaAnular(operacion: OperacionConLineas): VentaParaAnular {
  return {
    id: operacion.id,
    proceso: operacion.proceso,
    anuladaEn: operacion.anuladaEn,
    fecha: operacion.fecha,
    nroFactura: operacion.nroFactura,
    promoCuentaId: operacion.promoCuentaId,
    lineas: operacion.movimientos.map((m) => ({
      productoId: m.productoId,
      seccionId: m.seccionId,
      proceso: m.proceso,
      cantidad: Number(m.cantidad),
      cantidadExacta: m.cantidadExacta === null ? null : Number(m.cantidadExacta),
      loteVencimiento: m.loteVencimiento,
      detalle: m.detalle,
      precioTotal: Number(m.precioTotal),
      precioPorUnidadStock: Number(m.precioPorUnidadStock),
    })),
  };
}

/** `null` si no hay ninguna operación con ese id en esta sucursal (la sesión manda: nunca se carga la de otra sucursal). */
export async function cargarVentaParaAnular(
  tx: Prisma.TransactionClient,
  args: { operacionId: string; sucursalId: string }
): Promise<VentaParaAnular | null> {
  const operacion = await tx.operacion.findFirst({
    where: { id: args.operacionId, sucursalId: args.sucursalId },
    include: { movimientos: { include: { producto: true } } },
  });
  return operacion ? aVentaParaAnular(operacion) : null;
}

/**
 * Las hermanas de promo de una venta (Task #16, promo-combo, docs/plan-promo-combo-2026-09-26.md, D4, paso 9): las OTRAS Operaciones de
 * la misma `PromoCuenta` que siguen vigentes (`anuladaEn: null`). Mismo filtro que antes (por `promoCuentaId`, sin repetir sucursal ni
 * proceso: una `PromoCuenta` pertenece a una sola cuenta, y sus componentes se cobran juntos como VENTA) y sin orden explícito.
 */
export async function cargarHermanasDePromo(
  tx: Prisma.TransactionClient,
  args: { promoCuentaId: string; excluirOperacionId: string }
): Promise<VentaParaAnular[]> {
  const hermanas = await tx.operacion.findMany({
    where: { promoCuentaId: args.promoCuentaId, anuladaEn: null, id: { not: args.excluirOperacionId } },
    include: { movimientos: { include: { producto: true } } },
  });
  return hermanas.map(aVentaParaAnular);
}

import "server-only";
import type { Prisma } from "@prisma/client";
import type { LineaVendida, PosterioresALaVenta } from "@/core/movimientos/public";
import { cargarReconciliacionesPosteriores } from "./cargar-reconciliaciones-posteriores";

/**
 * Carga de una venta para ANULARLA (Task #41, Fase M — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo contrato que
 * `server/persistencia/compras/cargar-compra-para-anular.ts`: `tx` OBLIGATORIO, tipos de dominio con los `Decimal` ya convertidos a
 * `number`, sin reglas de negocio). Son EXACTAMENTE las dos lecturas que antes hacía en línea `anularVenta`
 * (src/server/actions/movimientos/venta.ts), con los mismos filtros y el mismo `include`, y el caso de uso las llama en el mismo orden:
 * primero la venta pedida; recién si pasa las guardas, sus hermanas de promo. Desde S-03 (O.52) se suma una tercera lectura, `cargarPosterioresDeVentas`
 * (conteos, ajustes y pagos al consignante POSTERIORES), que el caso de uso llama después de las hermanas y antes de escribir.
 */

/** Una Operación tal como la necesita el caso de uso `anularVenta`. `proceso` puede no ser VENTA: eso lo rechaza `evaluarAnulacionDeVenta`. */
export interface VentaParaAnular {
  id: string;
  proceso: string;
  anuladaEn: Date | null;
  fecha: Date;
  /**
   * Cuándo se ESCRIBIÓ la venta (`Operacion.creadoEn`, el reloj de la base). `fecha` la puede fijar quien carga (un conteo se puede fechar para atrás), así que
   * «después de la venta» (S-03) se mide con ésta, que no se puede falsear.
   */
  creadoEn: Date;
  nroFactura: string | null;
  /** La `PromoCuenta` de la que esta venta es un componente (Task #16), `null` si es una venta suelta. */
  promoCuentaId: string | null;
  lineas: LineaVendida[];
}

type OperacionConLineas = Prisma.OperacionGetPayload<{ include: { movimientos: { include: { producto: true } } } }>;

/**
 * Las líneas de la venta en el orden en que se escribieron (`creadoEn` y, a igualdad, id): de ese orden depende el de las filas de reversión que escribe la
 * anulación. Sin `orderBy` la base las entregaba en su orden físico, que cambia según dónde cayeron las filas (las de una misma `createMany` comparten
 * `creadoEn`), y la reversión salía en otro orden de una corrida a otra (mismo criterio que O.40 (3) en `cargarCuentaParaCerrar`).
 */
const LINEAS_EN_ORDEN_DE_ESCRITURA = {
  movimientos: { include: { producto: true }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] },
} satisfies Prisma.OperacionInclude;

function aVentaParaAnular(operacion: OperacionConLineas): VentaParaAnular {
  return {
    id: operacion.id,
    proceso: operacion.proceso,
    anuladaEn: operacion.anuladaEn,
    fecha: operacion.fecha,
    creadoEn: operacion.creadoEn,
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
    include: LINEAS_EN_ORDEN_DE_ESCRITURA,
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
    include: LINEAS_EN_ORDEN_DE_ESCRITURA,
  });
  return hermanas.map(aVentaParaAnular);
}

/**
 * Lo que pasó DESPUÉS de las ventas que se van a anular (la pedida y sus hermanas de promo) y que anularlas desharía a ciegas (S-03, O.52 de
 * docs/pureza-integracion.md; D7 del plan de endurecimiento de seguridad). Dos lecturas, ambas dentro de la transacción del caso de uso:
 *
 *  1. un CONTROL o un AJUSTE vigente (un conteo físico aplicado, un ajuste manual), o un conteo físico sin movimiento, del mismo producto en la misma sección de alguna línea de la venta
 *     (`cargarReconciliacionesPosteriores`, compartida con cancelar un conteo y anular una compra: qué cuenta y qué no está documentado ahí).
 *  2. un `PagoConsignante` a un proveedor cuya mercadería en consignación consumió alguna de las ventas (líneas LIQUIDACION_CONSIGNACION), en esta sucursal.
 *
 * «Después» se mide con `creadoEn` (el reloj de la base al escribir), nunca con `fecha`: un conteo o un pago se pueden fechar para atrás, y seguirían
 * habiendo reconciliado el stock o saldado la deuda DESPUÉS de la venta. `gte` y no `gt`: en el mismo milisegundo se rechaza (fallo cerrado).
 */
export async function cargarPosterioresDeVentas(
  tx: Prisma.TransactionClient,
  args: { ventas: readonly VentaParaAnular[]; sucursalId: string }
): Promise<PosterioresALaVenta> {
  const { ventas, sucursalId } = args;

  // 1 y 1b. CONTROL / AJUSTE y conteos físicos (con o sin movimiento) posteriores sobre los mismos (producto, sección): la lectura es la misma que usan cancelar un conteo y anular una compra
  //         (`cargarReconciliacionesPosteriores`, D7: una sola regla para las tres).
  const hayConteoPosterior = await cargarReconciliacionesPosteriores(tx, {
    sucursalId,
    alcances: ventas.map((v) => ({ creadoEn: v.creadoEn, pares: [...new Map(v.lineas.map((l) => [`${l.productoId}|${l.seccionId}`, { productoId: l.productoId, seccionId: l.seccionId }])).values()] })),
  });

  // 2. Pago al consignante de una mercadería que consumió la venta.
  const consumosEnConsignacion = ventas.flatMap((v) => v.lineas.filter((l) => l.proceso === "LIQUIDACION_CONSIGNACION").map((l) => ({ productoId: l.productoId, creadoEn: v.creadoEn })));
  let pagosAConsignantes: string[] = [];
  if (consumosEnConsignacion.length) {
    const productos = await tx.producto.findMany({
      where: { id: { in: [...new Set(consumosEnConsignacion.map((c) => c.productoId))] }, proveedorConsignacionId: { not: null } },
      select: { id: true, proveedorConsignacionId: true },
    });
    const consignantePorProducto = new Map(productos.map((p) => [p.id, p.proveedorConsignacionId as string]));
    const desdePorConsignante = new Map<string, Date>();
    for (const c of consumosEnConsignacion) {
      const consignanteId = consignantePorProducto.get(c.productoId);
      if (!consignanteId) continue;
      const previo = desdePorConsignante.get(consignanteId);
      if (!previo || c.creadoEn < previo) desdePorConsignante.set(consignanteId, c.creadoEn);
    }
    if (desdePorConsignante.size) {
      const pagos = await tx.pagoConsignante.findMany({
        where: { sucursalId, OR: [...desdePorConsignante].map(([proveedorId, desde]) => ({ proveedorId, creadoEn: { gte: desde } })) },
        select: { proveedor: { select: { nombre: true } } },
        distinct: ["proveedorId"],
        orderBy: { proveedorId: "asc" },
        take: 20,
      });
      pagosAConsignantes = pagos.map((p) => p.proveedor.nombre);
    }
  }

  return {
    controlesOAjustes: hayConteoPosterior,
    pagosAConsignantes,
  };
}

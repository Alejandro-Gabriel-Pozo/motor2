import "server-only";
import type { Prisma } from "@prisma/client";
import { cuentaConOpciones, configuracionDeItemLeido, armarTicketImpresoEn, type ItemConVenta } from "@/core/pos/public";
import { cargarVersionesDeVentas } from "@/server/lecturas/pos/versiones-de-venta";

/**
 * Lo que el cobro necesita de una cuenta (etapa C1): si está cerrada, de qué sucursal es y su TOTAL a cobrar. El total es el del ticket «como se imprimiría ahora» (`armarTicketImpresoEn` de `core/pos`): el MISMO
 * cálculo que muestra el ticket y el listado de tickets emitidos (líneas vigentes, descuento del cliente congelado en la cuenta, correcciones y anulaciones al día), así el cobro nunca discrepa con lo que ve el cliente.
 * Solo lectura; la regla de qué se puede cobrar es del caso de uso y de la base.
 */
export interface CuentaParaCobrar {
  cuentaId: string;
  sucursalId: string;
  cerrada: boolean;
  /** Total a cobrar en pesos, ya redondeado a 2 decimales por el cálculo del ticket (la caja lo pasa a centavos exactos). */
  total: number;
  conVenta: boolean;
}

export async function cargarCuentaParaCobrar(db: Prisma.TransactionClient, empresaId: string, cuentaId: string, ahora: Date): Promise<CuentaParaCobrar | null> {
  const cuenta = await db.cuenta.findFirst({
    where: { empresaId, id: cuentaId },
    select: {
      id: true,
      cerradaEn: true,
      descuentoPorcentaje: true,
      mesa: { select: { sucursalId: true } },
      ejemplaresTicket: { select: { id: true }, take: 1 },
      items: {
        orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
        select: {
          id: true,
          huellaOpciones: true,
          lineaPadreId: true,
          anulaAItemId: true,
          opcionesElegidas: { orderBy: [{ orden: "asc" }, { id: "asc" }], select: { nombreOpcion: true, tipoGrupo: true, versionDeOpcionId: true, cantidad: true, ocultaEnCarta: true, grupo: { select: { prefijoEnCarta: true } }, opcion: { select: { esNinguna: true } } } },
          productoId: true,
          nombreEnTicket: true,
          producto: { select: { nombre: true, modoDeVenta: true } },
          cantidad: true,
          precioUnitario: true,
          precioCartaUnitario: true,
          operacionId: true,
          operacion: { select: { anuladaEn: true } },
          promoCuenta: { select: { id: true, titulo: true } },
        },
      },
    },
  });
  if (!cuenta) return null;
  const versiones = await cargarVersionesDeVentas(db, cuenta.items.flatMap((i) => (i.operacionId && i.operacion?.anuladaEn ? [i.operacionId] : [])));
  const conOpciones = cuentaConOpciones(cuenta.items);
  const items: ItemConVenta[] = cuenta.items.map((i) => ({
    productoId: i.productoId,
    productoNombre: i.nombreEnTicket ?? i.producto.nombre,
    cantidad: Number(i.cantidad),
    precioUnitario: Number(i.precioUnitario),
    precioCartaUnitario: i.precioCartaUnitario !== null ? Number(i.precioCartaUnitario) : null,
    operacionId: i.operacionId,
    anuladaEn: i.operacion?.anuladaEn ?? null,
    ...(i.operacionId && versiones.has(i.operacionId) ? { versionesDeLaVenta: versiones.get(i.operacionId) } : {}),
    promo: i.promoCuenta ? { promoCuentaId: i.promoCuenta.id, titulo: i.promoCuenta.titulo } : undefined,
    ...configuracionDeItemLeido(conOpciones, i),
  }));
  const descuento = cuenta.descuentoPorcentaje !== null ? Number(cuenta.descuentoPorcentaje) : null;
  const { total } = armarTicketImpresoEn(items, ahora, descuento);
  return { cuentaId: cuenta.id, sucursalId: cuenta.mesa.sucursalId, cerrada: cuenta.cerradaEn !== null, total, conVenta: cuenta.ejemplaresTicket.length > 0 };
}

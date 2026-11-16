import "server-only";
import type { Db } from "@/lib/db-tipos";
import { diaDeColumnaDate, ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { avanceDeRecepcionDeOrden, type AvanceDeRecepcionDeOrden, type EstadoDeOrden, type MotivoDeCierre } from "@/core/compras/public";
import { cargarNivelDelControlDeExceso, listarOrdenesDeCompra, listarOrdenesPedidasDelProveedor, type OrdenDeCompraVista } from "@/server/persistencia/compras/cargar-orden-de-compra";

/**
 * Compras, orden de compra (etapa OC): lo que muestran las pantallas de órdenes y el selector de «Cargar compra». Solo lectura, con `select` (nunca la fila entera) y fechas como texto `AAAA-MM-DD` (día argentino). El DINERO (el precio por unidad de cada
 * línea) solo viaja si `conPrecios` (quien gestiona las órdenes: piso administrador, GT-1): el selector de la compra y quien solo ve las órdenes no lo reciben nunca. Sin guarda de permiso adentro: la página o la Server Action ya pidieron `orden_de_compra_ver`.
 */

export interface LineaDeOrdenParaMostrar {
  numero: number;
  productoNombre: string;
  unidadNombre: string;
  productoId: string;
  decimales: number;
  cantidadPedida: number;
  /** Lo recibido contra la línea; `null` mientras la orden no se pidió. */
  cantidadRecibida: number | null;
  retirada: boolean;
  /** Solo con `conPrecios`. */
  precioPorUnidadStock?: number | null;
}

export interface OrdenParaMostrar {
  id: string;
  numero: number | null;
  estado: EstadoDeOrden;
  proveedorNombre: string;
  sucursalNombre: string | null;
  fechaDeEntregaPrevista: string | null;
  cierreMotivo: MotivoDeCierre | null;
  motivoDeAnulacion: string | null;
  creadaEl: string;
  /** Cómo va la recepción (se calcula del saldo, no se guarda); solo en una orden pedida o cerrada. */
  avance: AvanceDeRecepcionDeOrden | null;
  lineas: LineaDeOrdenParaMostrar[];
}

function aMostrar(o: OrdenDeCompraVista, conPrecios: boolean): OrdenParaMostrar {
  const conSaldo = o.estado === "PEDIDA" || o.estado === "CERRADA";
  return {
    id: o.id,
    numero: o.numero,
    estado: o.estado,
    proveedorNombre: o.proveedorNombre,
    sucursalNombre: o.sucursalNombre,
    fechaDeEntregaPrevista: o.fechaDeEntregaPrevista ? diaDeColumnaDate(o.fechaDeEntregaPrevista) : null,
    cierreMotivo: o.cierreMotivo,
    motivoDeAnulacion: o.motivoDeAnulacion,
    creadaEl: diaDeCalendario(o.creadoEn, ZONA_ARGENTINA),
    avance: conSaldo ? avanceDeRecepcionDeOrden(o.lineas.filter((l) => !l.retirada).map((l) => ({ cantidadPedida: l.cantidadPedida, cantidadRecibida: l.cantidadRecibida ?? 0 }))) : null,
    lineas: o.lineas.map((l) => ({
      numero: l.numero,
      productoId: l.productoId,
      productoNombre: l.productoNombre,
      unidadNombre: l.unidadNombre,
      decimales: l.decimales,
      cantidadPedida: l.cantidadPedida,
      cantidadRecibida: l.cantidadRecibida,
      retirada: l.retirada,
      ...(conPrecios ? { precioPorUnidadStock: l.precioPorUnidadStock } : {}),
    })),
  };
}

/** Las órdenes que ve quien consulta (la RLS por sucursal esconde las destinadas a otra sucursal), las más nuevas primero. */
export async function listarOrdenesParaMostrar(db: Db, conPrecios: boolean): Promise<OrdenParaMostrar[]> {
  return (await listarOrdenesDeCompra(db)).map((o) => aMostrar(o, conPrecios));
}

/** Las órdenes PEDIDAS de un proveedor, sin precios, para elegir una al cargar una compra. */
export async function listarOrdenesPedidasParaElegir(db: Db, proveedorId: string): Promise<OrdenParaMostrar[]> {
  return (await listarOrdenesPedidasDelProveedor(db, proveedorId)).map((o) => aMostrar(o, false));
}

/** El nivel del control de exceso de la empresa (sin fila = PERMITIR, que devuelve la regla pura). */
export { cargarNivelDelControlDeExceso as leerNivelDelControlDeExceso };

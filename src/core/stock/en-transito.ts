import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Cantidad de un producto que YA salió de una sucursal (el Kardex del origen la descontó) y todavía no figura en ninguna: no aparece
 * en el "Teórico" del stock consolidado de nadie, pero existe. Tres situaciones, todas con el stock fuera de las dos sucursales:
 *
 * - `porRecibir`: la sucursal es DESTINO de un traspaso ENVIADO — llega cuando acepte la recepción.
 * - `enviadoPorAceptar`: la sucursal es ORIGEN de un traspaso ENVIADO — salió y el destino todavía no lo aceptó.
 * - `pendienteDeReingreso`: la sucursal es ORIGEN de un traspaso RECHAZADA_DESTINO — el destino lo rechazó, vuelve cuando el origen confirme
 *   el reingreso (hasta entonces el stock no está en ningún lado del sistema).
 *
 * Una SOLICITADA no cuenta: todavía no movió stock. ACEPTADA/CERRADA tampoco: ya se asentaron en el Kardex de alguna sucursal.
 */
export interface FilaStockEnTransito {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  unidadStockNombre: string;
  porRecibir: number;
  enviadoPorAceptar: number;
  pendienteDeReingreso: number;
}

export async function calcularStockEnTransito(sucursalId: string, db: Db): Promise<FilaStockEnTransito[]> {
  const traspasos = await db.traspasoSucursal.findMany({
    where: {
      OR: [
        { estado: "ENVIADA", origenSucursalId: sucursalId },
        { estado: "ENVIADA", destinoSucursalId: sucursalId },
        { estado: "RECHAZADA_DESTINO", origenSucursalId: sucursalId },
      ],
    },
    select: {
      estado: true,
      origenSucursalId: true,
      cantidad: true,
      producto: { select: { id: true, codigo: true, nombre: true, unidadStock: { select: { nombre: true } } } },
    },
  });

  const porProducto = new Map<string, FilaStockEnTransito>();
  for (const t of traspasos) {
    const fila =
      porProducto.get(t.producto.id) ??
      ({
        productoId: t.producto.id,
        productoCodigo: t.producto.codigo,
        productoNombre: t.producto.nombre,
        unidadStockNombre: t.producto.unidadStock.nombre,
        porRecibir: 0,
        enviadoPorAceptar: 0,
        pendienteDeReingreso: 0,
      } satisfies FilaStockEnTransito);
    const cantidad = Number(t.cantidad);
    if (t.estado === "RECHAZADA_DESTINO") fila.pendienteDeReingreso += cantidad;
    else if (t.origenSucursalId === sucursalId) fila.enviadoPorAceptar += cantidad;
    else fila.porRecibir += cantidad;
    porProducto.set(t.producto.id, fila);
  }

  return [...porProducto.values()].sort((a, b) => a.productoNombre.localeCompare(b.productoNombre));
}

import "server-only";
import type { Prisma } from "@prisma/client";
import { versionVigente, type DiferenciaDePrecio, type ModoDePrecioDeMedida, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { GrupoParaVender, OpcionParaVender } from "@/core/pos/public";
import type { EfectoDeConsumoDeOpcion } from "@/core/opciones/public";
import { preciosLocalesDeOpcionVigentes } from "@/server/lecturas/catalogo/precio-local-de-opcion";

/**
 * Las OPCIONES DE VENTA de los productos de un pedido, para venderlas en una sucursal (GO-2b, ADR-030). Es el EMBUDO de lectura de las versiones vigentes de las
 * opciones al vender (lo fija `test/arquitectura/lectores-de-version-de-opcion.test.ts`): la vigente es la de número mayor, elegida con `versionVigente`
 * (`core/opciones`), nunca a mano en otro archivo.
 *
 * - Lectura A (`cargarOpcionesParaVender`), UNA operación para todo el pedido: por producto, los grupos que admite (con las cantidades efectivas: las del producto
 *   si las sobrescribe), sus opciones con la versión vigente y sus consumos, si la opción está apagada en ESTA sucursal (familia `optout`: sin fila, prendida), la
 *   fila del producto para cada opción y si el producto es el ANCLA de un adicional (un ancla que no es un PV sin producción se descarta: la opción queda sin ancla). Una opción sin versión no se puede vender: queda afuera (elegirla es «no
 *   permitida»). La RLS deja ver solo lo de la empresa de la sesión: una opción de otra empresa no aparece y responde igual que una inexistente.
 * - Lectura B (`completarPreciosDeSucursal`): la grilla de la sucursal, SOLO si se eligió una MEDIDA en ABSOLUTO (`preciosLocalesDeOpcionVigentes`, en el lugar
 *   único de la grilla de las opciones, junto al precio local).
 *
 * Dinero: los `Decimal` se pasan a `number` acá (DECIMAL(14,2) y (7,4): exactos como double para los rangos de las columnas); la cuenta exacta la hace el núcleo.
 */

export interface OpcionesDeProducto {
  /** Lo que el producto admite, en el orden del producto (grupo) y del grupo (opción). Vacío = no admite nada. */
  grupos: GrupoParaVender[];
  /** Si el producto es el ancla de un adicional: el id de esa opción (se vende solo como adicional). */
  anclaDeOpcionId: string | null;
}

function diferencia(tipo: string | null, monto: Prisma.Decimal | null, porcentaje: Prisma.Decimal | null): DiferenciaDePrecio | null {
  if (tipo === "MONTO" && monto !== null) return { tipo: "MONTO", monto: Number(monto) };
  if (tipo === "PORCENTAJE" && porcentaje !== null) return { tipo: "PORCENTAJE", porcentaje: Number(porcentaje) };
  return null;
}

/** Lectura A: una sola operación para todos los productos del pedido (los que no existen o no se ven no vuelven). */
export async function cargarOpcionesParaVender(
  tx: Prisma.TransactionClient,
  args: { sucursalId: string; productoIds: readonly string[] }
): Promise<Map<string, OpcionesDeProducto>> {
  const ids = [...new Set(args.productoIds)];
  if (ids.length === 0) return new Map();
  const productos = await tx.producto.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      opcionQueRespalda: { select: { id: true } },
      opcionesAdmitidas: { select: { opcionId: true, cantidadMaxima: true, precioAbsoluto: true, tipoDeDiferencia: true, diferenciaPrecio: true, porcentaje: true, activo: true } },
      gruposAdmitidos: {
        orderBy: [{ orden: "asc" }, { id: "asc" }],
        select: {
          orden: true,
          cantidadMinima: true,
          cantidadMaxima: true,
          modoPrecio: true,
          activo: true,
          grupo: {
            select: {
              id: true,
              nombre: true,
              tipo: true,
              cantidadMinima: true,
              cantidadMaxima: true,
              activo: true,
              opciones: {
                orderBy: [{ orden: "asc" }, { id: "asc" }],
                select: {
                  id: true,
                  nombre: true,
                  orden: true,
                  activa: true,
                  esNinguna: true,
                  productoId: true,
                  producto: { select: { tipo: true, seProduce: true } },
                  apagadasEnSucursal: { where: { sucursalId: args.sucursalId }, select: { apagada: true } },
                  versiones: {
                    orderBy: { numero: "desc" },
                    take: 1,
                    select: {
                      id: true,
                      numero: true,
                      tipoDeDiferencia: true,
                      diferenciaPrecio: true,
                      porcentaje: true,
                      factorEscala: true,
                      consumos: {
                        orderBy: { orden: "asc" },
                        select: { efecto: true, insumoProductoId: true, reemplazaAProductoId: true, cantidad: true, unidadId: true, mermaPorcentaje: true, escalaConLaMedida: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const resultado = new Map<string, OpcionesDeProducto>();
  for (const p of productos) {
    const admitePorOpcion = new Map(p.opcionesAdmitidas.map((a) => [a.opcionId, a]));
    const grupos: GrupoParaVender[] = p.gruposAdmitidos.map((pg) => ({
      grupoId: pg.grupo.id,
      nombre: pg.grupo.nombre,
      tipo: pg.grupo.tipo as TipoDeGrupoDeOpciones,
      activo: pg.grupo.activo,
      admitido: pg.activo,
      cantidadMinima: pg.cantidadMinima ?? pg.grupo.cantidadMinima,
      cantidadMaxima: pg.cantidadMaxima ?? pg.grupo.cantidadMaxima,
      orden: pg.orden,
      modoPrecio: pg.modoPrecio as ModoDePrecioDeMedida | null,
      opciones: pg.grupo.opciones.flatMap((o): OpcionParaVender[] => {
        const vigente = versionVigente(o.versiones);
        if (!vigente) return [];
        const admite = admitePorOpcion.get(o.id) ?? null;
        return [
          {
            opcionId: o.id,
            nombre: o.nombre,
            orden: o.orden,
            activa: o.activa,
            admitida: admite !== null && admite.activo,
            apagadaEnSucursal: o.apagadasEnSucursal[0]?.apagada ?? false,
            cantidadMaxima: admite?.cantidadMaxima ?? 0,
            versionVigenteId: vigente.id,
            esNinguna: o.esNinguna,
            // Solo un PV que no se produce puede respaldar un adicional (la venta lo resta como a cualquier PV sin stock propio): otro ancla es una configuración inválida
            // y se trata como si no tuviera (la línea configurada lo rechaza al pedir, no al cerrar la cuenta).
            productoAnclaId: o.producto && o.producto.tipo === "PV" && !o.producto.seProduce ? o.productoId : null,
            diferenciaDeLaVersion: diferencia(vigente.tipoDeDiferencia, vigente.diferenciaPrecio, vigente.porcentaje) ?? { tipo: "MONTO", monto: 0 },
            factorEscala: vigente.factorEscala === null ? null : Number(vigente.factorEscala),
            consumos: vigente.consumos.map((c) => ({
              efecto: c.efecto as EfectoDeConsumoDeOpcion,
              insumoProductoId: c.insumoProductoId,
              reemplazaAProductoId: c.reemplazaAProductoId,
              cantidad: Number(c.cantidad),
              unidadStockId: c.unidadId,
              mermaPorcentaje: Number(c.mermaPorcentaje),
              escalaConLaMedida: c.escalaConLaMedida,
            })),
            precioAbsoluto: admite?.precioAbsoluto == null ? null : Number(admite.precioAbsoluto),
            diferenciaDelProducto: admite ? diferencia(admite.tipoDeDiferencia, admite.diferenciaPrecio, admite.porcentaje) : null,
            precioDeSucursal: null,
          },
        ];
      }),
    }));
    resultado.set(p.id, { grupos, anclaDeOpcionId: p.opcionQueRespalda?.id ?? null });
  }
  return resultado;
}

/**
 * Lectura B: la grilla de la sucursal para las MEDIDAS en ABSOLUTO que el pedido eligió (y nada más: sin ninguna, no lee nada). Devuelve los grupos de cada producto
 * con `precioDeSucursal` puesto donde rige.
 */
export async function completarPreciosDeSucursal(
  tx: Prisma.TransactionClient,
  sucursalId: string,
  opciones: ReadonlyMap<string, OpcionesDeProducto>,
  elegidas: readonly { productoId: string; opcionIds: readonly string[] }[]
): Promise<Map<string, OpcionesDeProducto>> {
  const pares: { productoId: string; opcionId: string }[] = [];
  for (const { productoId, opcionIds } of elegidas) {
    for (const g of opciones.get(productoId)?.grupos ?? []) {
      if (g.tipo !== "MEDIDA" || g.modoPrecio !== "ABSOLUTO") continue;
      for (const o of g.opciones) if (opcionIds.includes(o.opcionId) && !pares.some((p) => p.productoId === productoId && p.opcionId === o.opcionId)) pares.push({ productoId, opcionId: o.opcionId });
    }
  }
  if (pares.length === 0) return new Map(opciones);
  const grilla = await preciosLocalesDeOpcionVigentes(sucursalId, tx, pares);
  const salida = new Map<string, OpcionesDeProducto>();
  for (const [productoId, op] of opciones) {
    salida.set(productoId, {
      ...op,
      grupos: op.grupos.map((g) =>
        g.tipo === "MEDIDA" && g.modoPrecio === "ABSOLUTO" ? { ...g, opciones: g.opciones.map((o) => ({ ...o, precioDeSucursal: grilla.get(`${productoId}|${o.opcionId}`) ?? null })) } : g
      ),
    });
  }
  return salida;
}

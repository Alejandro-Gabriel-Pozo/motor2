import "server-only";
import type { Db } from "@/lib/db-tipos";
import { armarTicketImpresoEn, estadoDeTicket, claveDeLineaDeVenta, configuracionDeItemLeido, cuentaConOpciones, itemParaLineaDeVenta, lineasDeVenta, nombreDelMesero, type ItemConVenta } from "@/core/pos/public";
import { TAMANO_PAGINA_TICKETS, type FiltroTickets, type LineaTicketEmitido, type FilaTicketEmitido, type PaginaTickets } from "@/core/reportes/public";

/** Las líneas NETAS del ticket «como se imprimió» en `impresaEn`, con el `operacionId` de cada una (misma agrupación que
 *  `armarTicket`/`lineasDeVenta`: por producto, precio congelado Y promo, Task #16). No toca ticket.ts: solo agrega el dato
 *  para el link a Trazabilidad, que ese módulo no necesita.
 *
 * `lineasDeVenta` agrupa por (productoId, precioUnitario, promoCuentaId) — misma clave que `nombres` de `armarTicket` — así que
 * `netas` tiene, EN ORDEN, exactamente una entrada por cada línea de dato de `lineas` (un suelto, o un componente indentado):
 * `armarTicket` inserta la cabecera de una promo COMO EXTRA, sin consumir ningún `componentes`/`netas` — se filtra acá antes de
 * asociar por posición. Una cabecera agrupa VARIAS Operaciones (una por componente): sin una sola que enlazar, queda en `null`.
 */
function lineasConOperacion(items: readonly ItemConVenta[], impresaEn: Date, descuentoPorcentaje: number | null): LineaTicketEmitido[] {
  const { lineas } = armarTicketImpresoEn(items, impresaEn, descuentoPorcentaje);
  const vigentes = items.filter((i) => i.anuladaEn === null || i.anuladaEn > impresaEn);
  // GO-2b: la clave de siempre solo para las líneas SIN opciones; una línea configurada o un adicional toma la operación de sus propios ítems (como los enlazó el cierre).
  const operacionPorClave = new Map<string, string | null>();
  for (const i of vigentes) {
    if (i.huellaOpciones || i.lineaPadreId) continue;
    const clave = claveDeLineaDeVenta({ productoId: i.productoId, precioUnitario: i.precioUnitario, promoCuentaId: i.promo?.promoCuentaId, precioCartaUnitario: i.precioCartaUnitario });
    if (!operacionPorClave.has(clave)) operacionPorClave.set(clave, i.operacionId);
  }
  const operacionPorItem = new Map(vigentes.flatMap((i) => (i.id !== undefined ? [[i.id, i.operacionId] as const] : [])));
  const netas = lineasDeVenta(vigentes.map(itemParaLineaDeVenta));
  let cursor = 0;
  return lineas.map((l): LineaTicketEmitido => {
    const esCabecera = !l.indentado && l.promoCuentaId !== undefined;
    if (esCabecera) return { ...l, operacionId: null };
    const neta = netas[cursor++];
    const operacionId = neta.itemIds ? (operacionPorItem.get(neta.itemIds[0]!) ?? null) : (operacionPorClave.get(claveDeLineaDeVenta(neta)) ?? null);
    return { ...l, operacionId };
  });
}

/**
 * Página de tickets emitidos de la sucursal, una fila por `EjemplarTicket`, más recientes primero (`numero desc, ejemplar desc, id
 * desc` — aprovecha el índice único `(sucursalId, numero, ejemplar)`). Paginado por cursor, mismo patrón que
 * `listarComprasRegistradas` (compras-registradas.ts): `take: N+1`, cursor por id.
 */
export async function listarTicketsEmitidos(sucursalId: string, filtro: FiltroTickets = {}, db: Db): Promise<PaginaTickets> {
  const { desde, hasta, mesaId, cursor } = filtro;

  const ejemplares = await db.ejemplarTicket.findMany({
    where: {
      sucursalId,
      ...(desde || hasta ? { emitidoEn: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } } : {}),
      ...(mesaId ? { cuenta: { mesaId } } : {}),
    },
    orderBy: [{ numero: "desc" }, { ejemplar: "desc" }, { id: "desc" }],
    take: TAMANO_PAGINA_TICKETS + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      emitidoPor: { select: { name: true, email: true } },
      corrigeA: { select: { numero: true, ejemplar: true } },
      cuenta: {
        select: {
          id: true,
          abiertaEn: true,
          cerradaEn: true,
          abiertaPor: { select: { name: true, email: true } },
          mesa: { select: { numero: true } },
          cliente: { select: { nombre: true } },
          descuentoPorcentaje: true,
          items: {
            orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
            select: {
              // GO-2b: el id, la huella, el padre, el original del espejo y la foto, para agrupar las líneas como el cierre (sin opciones, lo de siempre).
              id: true,
              huellaOpciones: true,
              lineaPadreId: true,
              anulaAItemId: true,
              opcionesElegidas: { orderBy: [{ orden: "asc" }, { id: "asc" }], select: { nombreOpcion: true, tipoGrupo: true, versionDeOpcionId: true, cantidad: true, grupo: { select: { prefijoEnCarta: true } }, opcion: { select: { esNinguna: true } } } },
              productoId: true,
              producto: { select: { nombre: true, modoDeVenta: true } },
              cantidad: true,
              precioUnitario: true,
              precioCartaUnitario: true,
              operacionId: true,
              operacion: { select: { anuladaEn: true } },
              promoCuenta: { select: { id: true, titulo: true } },
            },
          },
          ejemplaresTicket: { orderBy: { ejemplar: "desc" }, take: 1, select: { numero: true, ejemplar: true } },
        },
      },
    },
  });

  const hayMas = ejemplares.length > TAMANO_PAGINA_TICKETS;
  const pagina = hayMas ? ejemplares.slice(0, TAMANO_PAGINA_TICKETS) : ejemplares;

  const items: FilaTicketEmitido[] = pagina.map((e) => {
    const conOpciones = cuentaConOpciones(e.cuenta.items);
    const items: ItemConVenta[] = e.cuenta.items.map((i) => ({
      productoId: i.productoId,
      productoNombre: i.producto.nombre,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precioUnitario),
      precioCartaUnitario: i.precioCartaUnitario !== null ? Number(i.precioCartaUnitario) : null,
      operacionId: i.operacionId,
      anuladaEn: i.operacion?.anuladaEn ?? null,
      promo: i.promoCuenta ? { promoCuentaId: i.promoCuenta.id, titulo: i.promoCuenta.titulo } : undefined,
      ...configuracionDeItemLeido(conOpciones, i),
    }));
    // Cliente con descuento (Task #14): `descuentoPorcentaje` es el SNAPSHOT congelado de la cuenta, no el % actual de `Cliente`.
    const descuentoPorcentaje = e.cuenta.descuentoPorcentaje !== null ? Number(e.cuenta.descuentoPorcentaje) : null;
    const { total } = armarTicketImpresoEn(items, e.emitidoEn, descuentoPorcentaje);
    const ultimo = e.cuenta.ejemplaresTicket[0];
    const esUltimoEjemplar = !ultimo || ultimo.ejemplar === e.ejemplar;

    return {
      ejemplarId: e.id,
      cuentaId: e.cuentaId,
      numero: { numero: e.numero, ejemplar: e.ejemplar },
      emitidoEn: e.emitidoEn,
      emitidoPor: nombreDelMesero(e.emitidoPor),
      mesaNumero: e.cuenta.mesa.numero,
      importe: total,
      esUltimoEjemplar,
      correccionDe: e.corrigeA ? { numero: e.corrigeA.numero, ejemplar: e.corrigeA.ejemplar } : null,
      reemplazadaPor: !esUltimoEjemplar && ultimo ? { numero: ultimo.numero, ejemplar: ultimo.ejemplar } : null,
      estado: esUltimoEjemplar ? estadoDeTicket(items, e.emitidoEn) : null,
      detalle: {
        mesero: nombreDelMesero(e.cuenta.abiertaPor),
        abiertaEn: e.cuenta.abiertaEn,
        // e.cuenta.cerradaEn no puede ser null (hay un EjemplarTicket, que solo emite `cerrarCuenta` sobre una cuenta cerrada) —
        // el `?? e.emitidoEn` es solo una defensa de tipos, nunca se ejecuta con datos reales.
        cerradaEn: e.cuenta.cerradaEn ?? e.emitidoEn,
        lineas: lineasConOperacion(items, e.emitidoEn, descuentoPorcentaje),
        cliente: e.cuenta.cliente && descuentoPorcentaje !== null ? { nombre: e.cuenta.cliente.nombre, descuentoPorcentaje } : null,
      },
    };
  });

  return { items, nextCursor: hayMas ? pagina[pagina.length - 1].id : null };
}

/** El número de la mesa filtrada, para el chip «Filtrando por Mesa N» de la página — null si `mesaId` no existe en esta
 *  sucursal (link viejo, mesa borrada). Una consulta chica, aparte de `listarTicketsEmitidos` porque esa lista puede volver
 *  vacía (sin tickets en el rango) y aun así hay que poder mostrar de qué mesa se está filtrando. */
export async function obtenerNumeroDeMesa(sucursalId: string, mesaId: string, db: Db): Promise<number | null> {
  const mesa = await db.mesa.findFirst({ where: { id: mesaId, sucursalId }, select: { numero: true } });
  return mesa?.numero ?? null;
}
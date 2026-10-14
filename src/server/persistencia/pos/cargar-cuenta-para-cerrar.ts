import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Lecturas del CIERRE de una cuenta del salón (Task #41, Fase M12a — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo contrato que
 * `server/persistencia/movimientos/cargar-venta-para-anular.ts`: `tx` OBLIGATORIO, tipos de dominio con los `Decimal` ya convertidos a
 * `number`, sin reglas de negocio). Son EXACTAMENTE las lecturas que antes hacía en línea `cerrarCuenta`
 * (src/server/actions/pos/cuenta-cierre.ts), con los mismos filtros, y el caso de uso las llama en el mismo orden.
 */

/**
 * GO-2b (ADR-030): la FOTO de una opción elegida en una línea, con lo que la venta necesita de la versión CONGELADA (la de la foto, nunca la vigente): sus consumos,
 * si la opción es «ninguna» y el producto ANCLA que la base dice que la respalda.
 */
export interface FotoParaCerrar {
  opcionId: string;
  versionDeOpcionId: string;
  tipoGrupo: string;
  nombreOpcion: string;
  cantidad: number;
  factorEscala: number | null;
  orden: number;
  esNinguna: boolean;
  /** `OpcionDeGrupo.productoId`, leído de la base: el único producto que puede respaldar este adicional. */
  productoAnclaId: string | null;
  consumos: { efecto: string; insumoProductoId: string; reemplazaAProductoId: string | null; cantidad: number; unidadId: string; mermaPorcentaje: number; escalaConLaMedida: boolean }[];
}

/** Un ítem de la cuenta tal como lo necesita el cierre. */
export interface ItemParaCerrar {
  /** GO-2b: SOLO en una cuenta que tiene alguna línea con opciones (para enlazar por id las configuradas y los adicionales). Sin opciones, el ítem de siempre. */
  id?: string;
  productoId: string;
  cantidad: number;
  /** Precio de LISTA congelado al pedir (nunca cambia de semántica con el descuento de cliente, Task #14). */
  precioUnitario: number;
  /** Producto con descuento: el precio de lista antes de ese descuento (`CuentaItem.precioCartaUnitario`); en un componente de promo, el precio de carta. */
  precioCartaUnitario: number | null;
  promoCuentaId: string | null;
  /** `null` = borrador sin enviar a cocina. */
  numeroEnvio: number | null;
  /** GO-2b, SOLO cuando hay datos (sin opciones el ítem sale idéntico al de antes): el original de un espejo (en una cuenta con opciones), la huella, el padre
   *  de un adicional (un espejo repite los de su original) y la foto de lo elegido (los espejos no tienen). */
  anulaAItemId?: string;
  huellaOpciones?: string;
  lineaPadreId?: string;
  fotos?: FotoParaCerrar[];
  /** GO-3b (ADR-032): SOLO en una línea original que cayó en una combinación con receta propia: la versión CONGELADA al agregarla (sus ingredientes, en su orden) y las opciones de los ejes. */
  recetaDeCombinacion?: RecetaDeCombinacionParaCerrar;
}

/** GO-3b: la receta propia congelada de la combinación de una línea (de `CombinacionEnLinea.recetaDeCombinacionVersionId`, nunca la vigente). */
export interface RecetaDeCombinacionParaCerrar {
  versionId: string;
  opcionesDeEjes: string[];
  ingredientes: { insumoProductoId: string; cantidad: number; mermaPorcentaje: number; unidadId: string }[];
}

export interface CuentaParaCerrar {
  id: string;
  mesaNumero: number;
  cerradaEn: Date | null;
  clienteId: string | null;
  clienteNombre: string | null;
  /** SNAPSHOT del % del cliente al asignarlo (D7), `null` sin cliente. */
  descuentoPorcentaje: number | null;
  items: ItemParaCerrar[];
}

/** `null` si no hay ninguna cuenta con ese id en una mesa de esta sucursal (la sesión manda: nunca se carga la de otra sucursal). */
export async function cargarCuentaParaCerrar(tx: Prisma.TransactionClient, args: { cuentaId: string; sucursalId: string }): Promise<CuentaParaCerrar | null> {
  const cuenta = await tx.cuenta.findFirst({
    where: { id: args.cuentaId, mesa: { sucursalId: args.sucursalId } },
    include: {
      mesa: { select: { numero: true } },
      items: {
        orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
        // GO-2b: la foto de cada línea con la versión CONGELADA (sus consumos) y el ancla de la opción, anidada en la MISMA consulta (sin opciones, vacía).
        include: {
          opcionesElegidas: {
            orderBy: [{ orden: "asc" }, { id: "asc" }],
            select: {
              opcionId: true,
              versionDeOpcionId: true,
              tipoGrupo: true,
              nombreOpcion: true,
              cantidad: true,
              factorEscala: true,
              orden: true,
              opcion: { select: { esNinguna: true, productoId: true } },
              versionDeOpcion: {
                select: {
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
      cliente: { select: { nombre: true } },
    },
  });
  if (!cuenta) return null;
  // GO-2b: los campos de las opciones van SOLO cuando hay datos; el `id` (y el original de un espejo), solo si la cuenta tiene alguna línea con opciones: sin ellas,
  // los ítems son exactamente los de antes.
  const conOpciones = cuenta.items.some((i) => i.huellaOpciones !== null || i.lineaPadreId !== null);
  // GO-3b: la receta propia CONGELADA de la combinación de cada línea con opciones (una consulta, solo si la cuenta tiene alguna línea con huella; sin ellas, nada).
  const conHuella = cuenta.items.filter((i) => i.huellaOpciones !== null && i.anulaAItemId === null).map((i) => i.id);
  const recetas = new Map(
    conHuella.length === 0
      ? []
      : (
          await tx.combinacionEnLinea.findMany({
            where: { cuentaItemId: { in: conHuella }, recetaDeCombinacionVersionId: { not: null } },
            select: {
              cuentaItemId: true,
              combinacion: { select: { opcionEje1Id: true, opcionEje2Id: true } },
              recetaDeCombinacionVersion: { select: { id: true, ingredientes: { orderBy: [{ orden: "asc" }, { id: "asc" }], select: { insumoProductoId: true, cantidad: true, mermaPorcentaje: true, unidadId: true } } } },
            },
          })
        ).flatMap((c): [string, RecetaDeCombinacionParaCerrar][] =>
          c.recetaDeCombinacionVersion
            ? [
                [
                  c.cuentaItemId,
                  {
                    versionId: c.recetaDeCombinacionVersion.id,
                    opcionesDeEjes: [c.combinacion.opcionEje1Id, c.combinacion.opcionEje2Id].filter((x): x is string => x !== null),
                    ingredientes: c.recetaDeCombinacionVersion.ingredientes.map((i) => ({ insumoProductoId: i.insumoProductoId, cantidad: Number(i.cantidad), mermaPorcentaje: Number(i.mermaPorcentaje), unidadId: i.unidadId })),
                  },
                ],
              ]
            : []
        )
  );
  return {
    id: cuenta.id,
    mesaNumero: cuenta.mesa.numero,
    cerradaEn: cuenta.cerradaEn,
    clienteId: cuenta.clienteId,
    clienteNombre: cuenta.cliente?.nombre ?? null,
    descuentoPorcentaje: cuenta.descuentoPorcentaje !== null ? Number(cuenta.descuentoPorcentaje) : null,
    items: cuenta.items.map((i) => ({
      productoId: i.productoId,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precioUnitario),
      precioCartaUnitario: i.precioCartaUnitario !== null ? Number(i.precioCartaUnitario) : null,
      promoCuentaId: i.promoCuentaId,
      numeroEnvio: i.numeroEnvio,
      ...(conOpciones ? { id: i.id } : {}),
      ...(conOpciones && i.anulaAItemId !== null ? { anulaAItemId: i.anulaAItemId } : {}),
      ...(i.huellaOpciones !== null ? { huellaOpciones: i.huellaOpciones } : {}),
      ...(i.lineaPadreId !== null ? { lineaPadreId: i.lineaPadreId } : {}),
      ...(i.opcionesElegidas.length > 0 ? { fotos: fotosDe(i.opcionesElegidas) } : {}),
      ...(recetas.has(i.id) ? { recetaDeCombinacion: recetas.get(i.id)! } : {}),
    })),
  };
}

type FotoLeida = { opcionId: string; versionDeOpcionId: string; tipoGrupo: string; nombreOpcion: string; cantidad: number; factorEscala: Prisma.Decimal | null; orden: number; opcion: { esNinguna: boolean; productoId: string | null }; versionDeOpcion: { consumos: { efecto: string; insumoProductoId: string; reemplazaAProductoId: string | null; cantidad: Prisma.Decimal; unidadId: string; mermaPorcentaje: Prisma.Decimal; escalaConLaMedida: boolean }[] } };

function fotosDe(fotos: readonly FotoLeida[]): FotoParaCerrar[] {
  return fotos.map((f) => ({
    opcionId: f.opcionId,
    versionDeOpcionId: f.versionDeOpcionId,
    tipoGrupo: f.tipoGrupo,
    nombreOpcion: f.nombreOpcion,
    cantidad: f.cantidad,
    factorEscala: f.factorEscala !== null ? Number(f.factorEscala) : null,
    orden: f.orden,
    esNinguna: f.opcion.esNinguna,
    productoAnclaId: f.opcion.productoId,
    consumos: f.versionDeOpcion.consumos.map((c) => ({
      efecto: c.efecto,
      insumoProductoId: c.insumoProductoId,
      reemplazaAProductoId: c.reemplazaAProductoId,
      cantidad: Number(c.cantidad),
      unidadId: c.unidadId,
      mermaPorcentaje: Number(c.mermaPorcentaje),
      escalaConLaMedida: c.escalaConLaMedida,
    })),
  }));
}

/**
 * El número de ticket más alto ya emitido en la sucursal (`null` si todavía no hay ninguno). El siguiente lo calcula
 * `siguienteNumeroTicket` (core/pos/numeracion-ticket.ts) — docs/plan-numeracion-ticket-2026-09-25.md, D2: `max + 1` dentro de la
 * transacción serializable, sin tabla contador ni SEQUENCE.
 */
export async function cargarUltimoNumeroDeTicket(tx: Prisma.TransactionClient, sucursalId: string): Promise<number | null> {
  const { _max } = await tx.ejemplarTicket.aggregate({ where: { sucursalId }, _max: { numero: true } });
  return _max.numero;
}

/**
 * La Operacion de la venta que consumió ese insumo en ESA sección (la primera, por `creadoEn` del movimiento y, a igualdad, por su id): a ella se enlaza la fila
 * de auditoría de stock negativo (B6bis). `null` si no aparece — el caso de uso cae entonces a la primera Operacion de la venta, como antes.
 * El desempate por id hace falta: las Operaciones de un mismo cierre se escriben en la misma transacción y pueden compartir `creadoEn` (Prisma 7
 * lo pone en el cliente); sin él, la base devolvía cualquiera de las empatadas según el orden físico de las filas (mismo criterio que O.40 (3)).
 */
export async function cargarOperacionDelConsumo(
  tx: Prisma.TransactionClient,
  args: { operacionIds: readonly string[]; productoId: string; seccionId: string }
): Promise<string | null> {
  const consumo = await tx.movimientoStock.findFirst({
    where: { operacionId: { in: [...args.operacionIds] }, productoId: args.productoId, seccionId: args.seccionId, proceso: "CONSUMO" },
    select: { operacionId: true },
    orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
  });
  return consumo?.operacionId ?? null;
}

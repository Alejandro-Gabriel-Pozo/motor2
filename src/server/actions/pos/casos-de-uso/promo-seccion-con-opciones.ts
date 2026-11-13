import "server-only";
import type { Prisma } from "@prisma/client";
import { redondearMoneda } from "@/core/moneda";
import { armarComponenteDeSeccion } from "@/core/pos/public-servidor";
import type { ComponenteValidado } from "@/core/pos/promo-combo";
import type { LineaConfigurada } from "@/core/pos/linea-configurada";
import type { OpcionesDeProducto } from "@/server/lecturas/opciones/opciones-para-vender";
import type { OrigenDeStockParaVender } from "@/server/lecturas/movimientos/receta-para-vender";
import { resolverPrecioVenta } from "@/server/lecturas/movimientos/precio-venta";

/**
 * Parte de promo «Toda la sección» con OPCIONES, del lado del servidor (diseño 2026-11-11, E1b). Dos pasos de `agregarItemsCasoDeUso`, separados acá para que ese archivo no crezca (tope de 400 líneas por archivo):
 *  - `opcionesDeLasFilasDeSeccion`: de las promos TAL COMO LLEGARON, las opciones que el mozo mandó en cada fila `{ productoId, cantidad, opciones? }` (solo las filas bien formadas: la forma la valida
 *    `validarYAplanarEleccionPromo` después), para pedir la grilla de precios de la sucursal junto con las de los ítems sueltos.
 *  - `armarPlatosDeSeccionConOpciones`: arma, dentro de la transacción, lo que el mozo eligió de cada plato con opciones (opciones elegibles, nunca un adicional, versión vigente, mínimos y máximos del grupo, origen de
 *    stock de lo elegido) y devuelve su precio de lista, que es el que pesa en el reparto (nunca el guardado) y la línea configurada que se escribe. Un plato sin opciones no pasa por acá.
 */

export function opcionesDeLasFilasDeSeccion(promos: readonly { elecciones?: unknown }[]): { productoId: string; opcionIds: string[] }[] {
  return promos.flatMap((p) =>
    (Array.isArray(p?.elecciones) ? (p.elecciones as { elegidos?: unknown }[]) : []).flatMap((e) =>
      (Array.isArray(e?.elegidos) ? (e.elegidos as { productoId?: unknown; opciones?: unknown }[]) : []).flatMap((el) =>
        el !== null && typeof el === "object" && typeof el.productoId === "string" && Array.isArray(el.opciones)
          ? [{ productoId: el.productoId, opcionIds: (el.opciones as ({ opcionId?: unknown } | null)[]).flatMap((o) => (typeof o?.opcionId === "string" ? [o.opcionId] : [])) }]
          : []
      )
    )
  );
}

export type ResultadoDePlatosDeSeccion = { ok: true } | { ok: false; codigo: "OPCION_NO_PERMITIDA_EN_PROMO" | "OPCION_CAMBIO" | "OPCIONES_INVALIDAS" | "ENTRADA_NO_DISPONIBLE"; mensaje: string };

export async function armarPlatosDeSeccionConOpciones(
  tx: Prisma.TransactionClient,
  args: {
    sucursalId: string;
    titulo: string;
    componentes: readonly ComponenteValidado[];
    opcionesLeidas: ReadonlyMap<string, OpcionesDeProducto>;
    origenDeStock: ReadonlyMap<string, OrigenDeStockParaVender>;
    /** El precio de carta guardado de cada elegible de las secciones de la promo (no pesa en un plato con opciones: solo se pasa al núcleo). */
    precioCartaPorProducto: ReadonlyMap<string, number>;
    /** Se COMPLETAN con el precio de lista y la línea configurada de cada plato armado, por `claveComponente`. */
    precioCartaPorClave: Map<string, number>;
    lineaPorClave: Map<string, LineaConfigurada>;
  },
): Promise<ResultadoDePlatosDeSeccion> {
  for (const c of args.componentes) {
    if (c.entradaId !== undefined || c.opciones === undefined || c.claveComponente === undefined) continue;
    const admite = args.opcionesLeidas.get(c.productoId);
    const producto = await tx.producto.findUnique({ where: { id: c.productoId }, select: { nombre: true, tipo: true, precioVenta: true } });
    if (!admite || !producto) return { ok: false, codigo: "ENTRADA_NO_DISPONIBLE", mensaje: `«${args.titulo}»: uno de sus productos ya no está disponible.` };
    const origen = args.origenDeStock.get(c.productoId);
    const precioBase = redondearMoneda(await resolverPrecioVenta(args.sucursalId, c.productoId, Number(producto.precioVenta), tx));
    const armado = armarComponenteDeSeccion(
      {
        productoId: c.productoId,
        producto: { nombre: producto.nombre, tipo: producto.tipo, esAnclaDeAdicional: admite.anclaDeOpcionId !== null, seProduce: origen?.seProduce ?? false, ingredientesDeLaRecetaVigente: origen?.ingredientesDeLaRecetaVigente ?? 0 },
        precioBase,
        precioGuardado: args.precioCartaPorProducto.get(c.productoId) ?? 0,
        gruposDelProducto: admite.grupos,
      },
      c.opciones,
    );
    if (!armado.ok) return { ok: false, codigo: armado.codigo, mensaje: `«${args.titulo}»: ${armado.mensaje}` };
    args.precioCartaPorClave.set(c.claveComponente, armado.precioDeLista);
    if (armado.linea) args.lineaPorClave.set(c.claveComponente, armado.linea);
  }
  return { ok: true };
}

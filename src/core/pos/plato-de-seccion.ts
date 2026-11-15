import type { OpcionElegida } from "@/core/opciones/public";
import { rechazoDeComponenteDeCombo } from "./componente-de-combo";
import { armarConfiguracionDeEntradaAElegir, type EntradaAElegirLeida } from "./configuracion-de-entrada-a-elegir";
import type { GrupoParaVender, LineaConfigurada } from "./linea-configurada";
import { opcionesPermitidasEfectivas } from "./opciones-permitidas-de-entrada";
import type { CupoDePromo } from "./promo-combo";

/**
 * Un plato dentro de una parte de promo «Toda la sección» (diseño 2026-11-11, docs/diseno-promo-parte-de-seccion-2026-11-11.md, alternativa 3α, invariantes I3, I4, I7 e I8). Funciones PURAS: sin lecturas,
 * con lo que la lectura de la promo para agregar (y después `agregarItemsCasoDeUso`, dentro de la transacción) ya leyó de la sucursal.
 *
 *  - `clasificarPlatoDeSeccion`: qué se le ofrece al mozo de ese plato. Un plato con grupos pasa a ser un «a elegir» implícito con TODAS sus opciones que no son adicionales (obligatorias y opcionales: el dueño
 *    lo confirmó el 2026-11-11), calculado con la MISMA función que una entrada «a elegir» (`opcionesPermitidasEfectivas`, pasándole todas como permitidas). Falla CERRADO: un adicional obligatorio, o un grupo
 *    obligatorio sin opción activa (o con menos unidades que su mínimo), dejan el plato SIN OFRECER; nunca se ofrece un adicional (I3: el recargo rompería el precio fijo).
 *  - `armarComponenteDeSeccion`: arma lo que el mozo eligió de ese plato y devuelve el precio de lista que PESA en el reparto: el de la configuración elegida (I8), nunca el `precioVenta` guardado (que no rige en un
 *    plato «que se vende por opción», ADR-035). El precio que se cobra no cambia (I1): solo el reparto.
 */

export type PlatoDeSeccionClasificado =
  /** Sin nada que elegir (sin grupos, o solo adicionales opcionales / grupos opcionales sin opción activa): se pide como siempre, y las opciones que mande el cliente se rechazan. */
  | { tipo: "SIN_OPCIONES" }
  /** El mozo elige entre estos grupos (solo opciones no adicionales, disponibles en la sucursal, con los topes y mínimos del grupo). */
  | { tipo: "CON_OPCIONES"; grupos: GrupoParaVender[] }
  /** No se puede armar con lo que hay hoy: no se ofrece (y si llega elegido, se rechaza). */
  | { tipo: "NO_SE_OFRECE"; motivo: string };

export function clasificarPlatoDeSeccion(gruposDelProducto: readonly GrupoParaVender[]): PlatoDeSeccionClasificado {
  // Permitidas = TODAS las opciones de los grupos que el producto admite y que no son adicionales, con su propio tope (el de la entrada no baja nada): `opcionesPermitidasEfectivas` filtra además las apagadas.
  const permitidas = gruposDelProducto
    .filter((g) => g.admitido && g.tipo !== "ADICIONAL")
    .flatMap((g) => g.opciones.map((o) => ({ opcionId: o.opcionId, cantidad: o.cantidadMaxima })));
  const efectivas = opcionesPermitidasEfectivas(gruposDelProducto, permitidas);
  if (efectivas.ok) return { tipo: "CON_OPCIONES", grupos: efectivas.grupos };
  // No quedó nada para elegir. Si algún grupo que el producto admite era obligatorio (un adicional obligatorio, o un obligatorio sin opciones activas) el plato NO se puede armar: no se ofrece. Si no, no hay nada
  // que elegir y se pide como siempre.
  if (gruposDelProducto.some((g) => g.admitido && g.cantidadMinima > 0)) return { tipo: "NO_SE_OFRECE", motivo: efectivas.motivo };
  return { tipo: "SIN_OPCIONES" };
}

/** Un plato elegible de una parte de sección, tal como lo lee la sucursal (la misma lectura alimenta al selector del mozo y al servidor). */
export interface PlatoDeSeccionLeido {
  productoId: string;
  /** El producto como componente de combo (PV, origen de stock, receta…): sin el precio de referencia, que depende de la configuración elegida. */
  producto: EntradaAElegirLeida["producto"];
  /** El precio base de la sucursal (precio local si rige), redondeado: sobre él se compone cada configuración elegida. */
  precioBase: number;
  /** El precio de carta GUARDADO del plato (el de siempre): es el peso de un plato que se pide sin opciones. Nunca pesa una configuración elegida (I8). */
  precioGuardado: number;
  /** Todo lo que el producto admite en la sucursal (los grupos con todas sus opciones). */
  gruposDelProducto: readonly GrupoParaVender[];
}

export type ResultadoDeComponenteDeSeccion =
  | { ok: true; linea: LineaConfigurada | null; precioDeLista: number }
  | { ok: false; codigo: "OPCION_NO_PERMITIDA_EN_PROMO" | "OPCION_CAMBIO" | "OPCIONES_INVALIDAS" | "ENTRADA_NO_DISPONIBLE"; mensaje: string };

/**
 * Arma lo que el mozo eligió de UN plato de una parte de sección (I4, I6, I7, I8). Falla CERRADO, sin escribir nada:
 *  - el plato no se ofrece (`NO_SE_OFRECE`) → `ENTRADA_NO_DISPONIBLE`;
 *  - un plato sin opciones al que llegan opciones → `OPCION_NO_PERMITIDA_EN_PROMO` (nunca se ignoran en silencio);
 *  - un plato con opciones: las opciones tienen que estar entre las elegibles (no adicionales, activas), y pasan por `armarConfiguracionDeEntradaAElegir` (mínimos y máximos del GRUPO, la versión que vio el mozo
 *    —`OPCION_CAMBIO`—, la lista compuesta, y que la configuración siga siendo un componente válido: precio de referencia y origen de stock). El peso es el precio de lista de ESA configuración;
 *  - sin opciones elegidas en un plato sin nada que elegir: el peso es el precio guardado, y el plato tiene que ser un componente válido (PV, precio de referencia ≥ $0,01, origen de stock).
 */
export function armarComponenteDeSeccion(plato: PlatoDeSeccionLeido, opciones: readonly OpcionElegida[] | undefined): ResultadoDeComponenteDeSeccion {
  const clasificado = clasificarPlatoDeSeccion(plato.gruposDelProducto);
  if (clasificado.tipo === "NO_SE_OFRECE") {
    return { ok: false, codigo: "ENTRADA_NO_DISPONIBLE", mensaje: `«${plato.producto.nombre}» no se puede elegir en esta promo: ${clasificado.motivo}` };
  }
  if (clasificado.tipo === "SIN_OPCIONES") {
    if (opciones !== undefined && opciones.length > 0) {
      return { ok: false, codigo: "OPCION_NO_PERMITIDA_EN_PROMO", mensaje: `«${plato.producto.nombre}» no lleva opciones en esta promo.` };
    }
    const rechazo = rechazoDeComponenteDeCombo({ ...plato.producto, precioDeReferencia: plato.precioGuardado });
    if (rechazo !== null) return { ok: false, codigo: "ENTRADA_NO_DISPONIBLE", mensaje: rechazo.mensaje };
    return { ok: true, linea: null, precioDeLista: plato.precioGuardado };
  }
  const armada = armarConfiguracionDeEntradaAElegir(
    { entradaId: plato.productoId, productoId: plato.productoId, producto: plato.producto, precioBase: plato.precioBase, grupos: clasificado.grupos, gruposDelProducto: plato.gruposDelProducto },
    opciones ?? [],
  );
  if (!armada.ok) return armada;
  return { ok: true, linea: armada.linea, precioDeLista: armada.precioDeLista };
}

/**
 * A cada cupo de SECCIÓN de una promo le pone `conOpciones`: sus elegibles que `clasificarPlatoDeSeccion` da como `CON_OPCIONES` (los que el mozo arma eligiendo opciones). Es la UNA regla de qué se ofrece con opciones, la
 * misma para el selector y para el servidor (I5): `gruposDelProducto` es lo que admite cada producto en la sucursal (`cargarOpcionesParaVender`); un producto que no está en el mapa se trata como sin grupos (y no se
 * elige con opciones). Devuelve cupos NUEVOS (no muta los recibidos); los de entradas (LISTA) pasan tal cual. Un plato que NO se ofrece (`NO_SE_OFRECE`) no entra a `conOpciones`: sigue como hoy, sin opciones,
 * y quien arma la promo lo rechaza (`PROMO_CON_OPCIONES`: «pedilo suelto»).
 */
export function conOpcionesDeLasSecciones(cupos: readonly CupoDePromo[], gruposDelProducto: ReadonlyMap<string, readonly GrupoParaVender[]>): CupoDePromo[] {
  return cupos.map((cupo) => {
    if (!("seccionCartaId" in cupo)) return cupo;
    const conOpciones = new Set<string>();
    for (const productoId of cupo.elegibles) {
      const grupos = gruposDelProducto.get(productoId);
      if (grupos !== undefined && clasificarPlatoDeSeccion(grupos).tipo === "CON_OPCIONES") conOpciones.add(productoId);
    }
    return { ...cupo, conOpciones };
  });
}

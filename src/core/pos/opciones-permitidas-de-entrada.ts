import type { OpcionElegida } from "@/core/opciones/public";
import type { GrupoParaVender } from "./linea-configurada";
import { opcionDisponible } from "./precio-de-configuracion";

/**
 * Las OPCIONES PERMITIDAS EFECTIVAS de una entrada «a elegir» de una promo (`EntradaDeCupo.modoDeOpciones = 'A_ELEGIR'`, docs/diseno-promo-subconjunto-2026-11-04.md §2 nivel 4 e I2/I3/I6/I11). Función PURA y
 * ÚNICA: la usan la lectura que alimenta el selector del mozo (`cargarEntradasDePromoParaVender`), el servidor al agregar la promo (`agregarItemsCasoDeUso`, con lo que esa misma lectura devuelve) y el
 * guardado de la entrada (`validarComponenteEnTx`). Nunca hay dos reglas paralelas que se puedan desincronizar.
 *
 * Efectivas = las que permitió la entrada ∩ las que el producto admite ∩ las que no están apagadas (en la empresa, en el producto o en la sucursal que vende). Cuánto se elige de cada grupo
 * lo fijan los LÍMITES DEL GRUPO (y los que el producto sobrescribe): la promo no tiene un número propio; lo único propio de la entrada es el tope de unidades de cada opción (`cantidad`), que baja
 * el tope del producto (`cantidadMaxima`), nunca lo sube. Falla CERRADO: si algo obligatorio no se puede cumplir (un grupo obligatorio sin ninguna opción activa, o con menos unidades posibles que su
 * mínimo, o un grupo ADICIONAL obligatorio), la entrada no es elegible (`ok: false`, con el motivo para mostrarle al administrador). Sin adicionales (I6): el recargo rompería el precio fijo de la promo,
 * así que un grupo ADICIONAL nunca se ofrece; el guardado además rechaza una entrada que lo permita.
 */

/** Una opción permitida por la entrada: la opción y el tope de unidades (1 a 10, CHECK de la base). */
export interface OpcionPermitidaPorLaEntrada {
  opcionId: string;
  cantidad: number;
}

export type ResultadoDePermitidasEfectivas = { ok: true; grupos: GrupoParaVender[] } | { ok: false; motivo: string };

export function opcionesPermitidasEfectivas(gruposDelProducto: readonly GrupoParaVender[], permitidas: readonly OpcionPermitidaPorLaEntrada[]): ResultadoDePermitidasEfectivas {
  const tope = new Map(permitidas.map((p) => [p.opcionId, p.cantidad] as const));
  const grupos: GrupoParaVender[] = [];
  for (const g of gruposDelProducto) {
    // El producto no admite el grupo: no existe para esta venta (igual que `validarOpcionesElegidas`).
    if (!g.admitido) continue;
    if (g.tipo === "ADICIONAL") {
      if (g.cantidadMinima > 0) return { ok: false, motivo: `«${g.nombre}» es un adicional obligatorio y una promo de precio fijo no lleva adicionales.` };
      continue;
    }
    const opciones = g.opciones
      .filter((o) => tope.has(o.opcionId) && opcionDisponible(o))
      .map((o) => ({ ...o, cantidadMaxima: Math.min(o.cantidadMaxima, tope.get(o.opcionId)!) }));
    if (!g.activo || opciones.length === 0) {
      if (g.cantidadMinima > 0) return { ok: false, motivo: `Para «${g.nombre}» no queda ninguna opción permitida y activa.` };
      continue;
    }
    if (opciones.reduce((suma, o) => suma + o.cantidadMaxima, 0) < g.cantidadMinima) {
      return { ok: false, motivo: `Las opciones permitidas de «${g.nombre}» no alcanzan para el mínimo que pide el grupo (${g.cantidadMinima}).` };
    }
    grupos.push({ ...g, opciones });
  }
  if (grupos.length === 0) return { ok: false, motivo: "No queda nada para elegir: ninguna opción permitida está activa." };
  return { ok: true, grupos };
}

/**
 * Una configuración MÍNIMA válida de los grupos efectivos (por grupo, las primeras opciones —en su orden— hasta llegar al mínimo del grupo; los grupos opcionales, sin nada): sirve para comprobar,
 * al cargar la entrada y al leerla, que existe AL MENOS UNA configuración armable (precio de referencia y origen de stock, D-8/D-9, I8). No es lo que elige el mozo.
 */
export function configuracionMinimaDeGruposEfectivos(grupos: readonly GrupoParaVender[]): OpcionElegida[] {
  const elegidas: OpcionElegida[] = [];
  for (const g of grupos) {
    let faltan = g.cantidadMinima;
    for (const o of [...g.opciones].sort((a, b) => a.orden - b.orden)) {
      if (faltan <= 0) break;
      const cantidad = Math.min(o.cantidadMaxima, faltan);
      elegidas.push({ opcionId: o.opcionId, cantidad });
      faltan -= cantidad;
    }
  }
  return elegidas;
}

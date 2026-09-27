import { esNumeroFinito } from "@/core/numero";
import { importeDeLinea, redondearMoneda, repartirImporte } from "@/core/moneda";

/**
 * Núcleo PURO de las promos armables ("menú fijo"/combo) del POS (Task #16, docs/plan-promo-combo-2026-09-26.md). Sin Prisma:
 * la lectura de cupos/elegibles vive en la capa de consulta (paso 11, `selector-carta-consulta.ts` con su cuarto parámetro),
 * la escritura en las Server Actions del POS (paso 8a/8b/8c) y en `registrarVentaEnTx` (paso 7).
 *
 * Dos funciones:
 *  - `validarEleccionPromo` (D1): cupos con mínimo y máximo, unidades enteras, pertenencia del producto elegido a la sección
 *    del cupo — los mismos elegibles que el selector del POS ofrece en esa sección (D5: sueltos visibles + opciones de ítems
 *    agrupados activos, disponibles en la sucursal, sin "Fuera de carta").
 *  - `prorratearPrecioPromo` (D3): reparte el precio congelado de la promo entre sus componentes elegidos, proporcional al
 *    precio DE CARTA de cada unidad — nunca partes iguales (salvo el caso borde de abajo), nunca proporcional al costo.
 */

export interface CupoPromoDefinicion {
  seccionCartaId: string;
  /** Solo para mensajes de error legibles ("Entradas", "Postres"...). */
  nombreSeccion: string;
  /** D1: mínimo por cupo, 0 por defecto (un cupo puede ser opcional). */
  cantidadMinima: number;
  cantidadMaximaCupo: number;
  /** Los mismos elegibles que el selector del POS ofrece en esta sección (D5). */
  elegibles: ReadonlySet<string>;
}

export interface ProductoElegidoEnCupo {
  productoId: string;
  /** Unidades enteras de este producto dentro del cupo (≥ 1: un producto con 0 simplemente no aparece en la elección). */
  cantidad: number;
}

export interface EleccionDeCupo {
  seccionCartaId: string;
  elegidos: readonly ProductoElegidoEnCupo[];
}

export type ResultadoValidacion = { ok: true } | { ok: false; mensaje: string };

/**
 * D1: valida que la elección de una promo arme TODOS sus cupos dentro de mínimo y máximo, con unidades enteras y productos
 * que de verdad pertenecen a esa sección — la misma fuente que ofrece el selector (D5), nunca una lista propia paralela que
 * pueda desincronizarse (paso 8a: "validar la elegibilidad con una función de core/pos, con un test de paridad contra el
 * selector"). Un cupo ausente de `elecciones` cuenta como "nada elegido" (solo pasa si su mínimo es 0).
 */
export function validarEleccionPromo(cupos: readonly CupoPromoDefinicion[], elecciones: readonly EleccionDeCupo[]): ResultadoValidacion {
  const eleccionPorSeccion = new Map(elecciones.map((e) => [e.seccionCartaId, e]));
  for (const cupo of cupos) {
    const elegidos = eleccionPorSeccion.get(cupo.seccionCartaId)?.elegidos ?? [];
    let total = 0;
    for (const el of elegidos) {
      if (!Number.isInteger(el.cantidad) || el.cantidad <= 0) {
        return { ok: false, mensaje: `La cantidad elegida en "${cupo.nombreSeccion}" tiene que ser un número entero mayor que cero.` };
      }
      if (!cupo.elegibles.has(el.productoId)) {
        return { ok: false, mensaje: `Ese producto no es una opción válida de "${cupo.nombreSeccion}" en esta promo.` };
      }
      total += el.cantidad;
    }
    if (total < cupo.cantidadMinima) {
      return { ok: false, mensaje: `Elegí al menos ${cupo.cantidadMinima} opción(es) de "${cupo.nombreSeccion}".` };
    }
    if (total > cupo.cantidadMaximaCupo) {
      return { ok: false, mensaje: `Como máximo ${cupo.cantidadMaximaCupo} opción(es) de "${cupo.nombreSeccion}".` };
    }
  }
  return { ok: true };
}

/** Todo lo elegido en todos los cupos de una promo ya armada, aplanado — lo que recibe `prorratearPrecioPromo`. */
export function componentesDeEleccion(elecciones: readonly EleccionDeCupo[]): ProductoElegidoEnCupo[] {
  return elecciones.flatMap((e) => e.elegidos);
}

/** Cuántas unidades en total arma una elección (todos los cupos, todos los productos) — lo que exige el piso de $0,01/unidad. */
function totalUnidades(componentes: readonly { cantidad: number }[]): number {
  return componentes.reduce((s, c) => s + c.cantidad, 0);
}

/**
 * Precio mínimo posible de una promo con estos componentes: $0,01 por cada unidad elegida (piso, ver `prorratearPrecioPromo`).
 * Se usa al CONFIGURAR la promo (admin de cupos, paso 5) y de nuevo al prorratear (defensivo: la config pudo cambiar entre
 * medio, ej. se agregó un cupo con más máximo después de fijar el precio).
 */
export function precioMinimoPromo(componentes: readonly { cantidad: number }[]): number {
  return redondearMoneda(0.01 * totalUnidades(componentes));
}

export interface ComponentePromoElegido extends ProductoElegidoEnCupo {
  /** Precio a la carta de UNA unidad de este producto, en el momento de agregar la promo (congelado como `precioCartaUnitario`
   *  en cada `CuentaItem`, paso 2.2). */
  precioCarta: number;
}

export interface FilaPromoProrrateada {
  productoId: string;
  /** Unidades de esta fila — puede ser MENOS que la cantidad total elegida de ese producto si el resto de centavos separó una
   *  unidad en otra fila (D3, "separación de unidades": mismo producto, dos filas, precios distintos). */
  cantidad: number;
  /** Precio prorrateado de CADA unidad de esta fila — nunca menor a $0,01 (piso). */
  precioUnitario: number;
}

export type ResultadoProrrateo = { ok: true; filas: FilaPromoProrrateada[] } | { ok: false; mensaje: string };

/**
 * D3: reparte `precioPromo` (ya congelado en `PromoCuenta.precio`) entre los componentes elegidos, proporcional al precio DE
 * CARTA de cada UNIDAD — la unidad de reparto es cada unidad individual, no cada línea de componente, así que dos unidades del
 * mismo producto pueden terminar en filas de precio distinto cuando el resto de centavos cae justo ahí (D3, "separación de
 * unidades").
 *
 * DOS PASADAS, no una: primero se intenta el prorrateo proporcional PURO (`repartirImporte` sobre el precio de carta de cada
 * unidad, mayor residuo, Decimal exacto) — es el que se usa casi siempre, y el que da el resultado "prolijo" cuando la cuenta
 * cierra redonda (ej. dos componentes a mitad de precio de carta cada uno reparten mitad y mitad del precio de la promo, sin
 * ensuciarlo con el piso). SOLO si esa pasada deja alguna unidad por debajo de $0,01 (un componente carísimo eclipsa a uno
 * casi regalado en la carta) se repite dándole $0,01 fijo a CADA unidad primero y repartiendo el EXCEDENTE (`precioPromo −
 * 0,01 × unidades`) proporcional al precio de carta — así ninguna unidad queda en $0 (el caso que el dueño quiere evitar, la
 * "milanesa a $0 dentro del Menú ejecutivo") sin perder la proporcionalidad en el resto de los componentes. Las dos pasadas
 * dan SIEMPRE una suma exacta de `precioPromo` (invariante de `repartirImporte`). Con la suma de precios de carta en 0 (todos
 * los componentes a $0 en la carta, caso borde), la primera pasada ya reparte en partes iguales por sí sola.
 *
 * Rechaza (en vez de prorratear con violín) cuando `precioPromo < precioMinimoPromo(componentes)`: ni con la segunda pasada
 * alcanza para dar el piso a cada unidad — se valida de nuevo acá aunque el admin de cupos (paso 5) ya lo valide al
 * configurar la promo, porque la composición real de una instancia puede variar dentro de cupos con rango (D1).
 */
export function prorratearPrecioPromo(precioPromo: number, componentes: readonly ComponentePromoElegido[]): ResultadoProrrateo {
  if (!esNumeroFinito(precioPromo) || precioPromo <= 0) {
    return { ok: false, mensaje: "El precio de la promo tiene que ser mayor que cero." };
  }
  const unidades: { productoId: string; peso: number }[] = [];
  for (const c of componentes) {
    if (!Number.isInteger(c.cantidad) || c.cantidad <= 0) {
      return { ok: false, mensaje: `Cantidad inválida para "${c.productoId}".` };
    }
    for (let u = 0; u < c.cantidad; u++) unidades.push({ productoId: c.productoId, peso: c.precioCarta });
  }
  if (!unidades.length) return { ok: false, mensaje: "La promo no tiene ningún componente elegido." };

  const n = unidades.length;
  const minimo = precioMinimoPromo(componentes);
  if (redondearMoneda(precioPromo) < minimo) {
    return { ok: false, mensaje: `El precio de la promo ($${precioPromo}) no alcanza el piso de $0,01 por unidad (${n} unidades: mínimo $${minimo}).` };
  }

  const pesos = unidades.map((u) => u.peso);
  const directo = repartirImporte(precioPromo, pesos);
  const precioPorUnidad = directo.some((v) => v < 0.01)
    ? repartirImporte(redondearMoneda(precioPromo - 0.01 * n), pesos).map((extra) => redondearMoneda(0.01 + extra))
    : directo;

  const filas: FilaPromoProrrateada[] = [];
  const indicePorClave = new Map<string, number>();
  unidades.forEach((u, i) => {
    const precioUnitario = precioPorUnidad[i];
    const clave = `${u.productoId}|${precioUnitario}`;
    const idx = indicePorClave.get(clave);
    if (idx !== undefined) filas[idx].cantidad += 1;
    else {
      indicePorClave.set(clave, filas.length);
      filas.push({ productoId: u.productoId, cantidad: 1, precioUnitario });
    }
  });
  return { ok: true, filas };
}

/** Suma de `importeDeLinea` de todas las filas de un prorrateo — tiene que dar EXACTO el precio de la promo (invariante de
 *  `prorratearPrecioPromo`, chequeado en los tests, no en producción). */
export function totalProrrateado(filas: readonly FilaPromoProrrateada[]): number {
  return redondearMoneda(filas.reduce((s, f) => s + importeDeLinea(f.cantidad, f.precioUnitario), 0));
}

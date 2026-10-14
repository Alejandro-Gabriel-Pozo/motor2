import { esNumeroFinito } from "@/core/numero";
import { importeDeLinea, redondearMoneda, repartirImporte } from "@/core/moneda";
import type { TipoDeCupo } from "@/core/carta/public";

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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// GO-3 (ADR-032, frente D): cupos que no son de una sección de la carta. Todo lo de abajo es ADITIVO: con cupos de sección y elecciones por sección (todo lo de hoy) el resultado de
// `validarYAplanarEleccionPromo` y de `prorratearPrecioPromo` es IDÉNTICO al de antes (lo fija una propiedad contra un oráculo con la versión anterior copiada,
// `test/pos/promo-combo-go3.propiedades.test.ts`), así la huella del POS no cambia.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Una entrada que se puede elegir HOY en un cupo LISTA (una `EntradaDeCupo` activa, disponible en la sucursal, con precio de referencia y origen de stock: lo resuelve la lectura)
 * o DEL_DIA (una `EntradaDelDiaDeCupo` activa de la fecha de hoy en la sucursal). `claveComponente` es la clave por la que el prorrateo agrupa las unidades en filas: el `productoId`
 * cuando la entrada no tiene configuración fija; con configuración, otra distinta por configuración (`claveDeComponenteConfigurado`), así dos configuraciones del mismo producto
 * con el mismo precio no se mezclan en una sola línea.
 */
export interface EntradaElegibleDeCupo {
  entradaId: string;
  productoId: string;
  claveComponente: string;
}

/** Un cupo LISTA o DEL_DIA: se identifica por su id (no tiene sección) y sus elegibles son entradas. Un LISTA con UNA sola entrada y mínimo = máximo es un COMPONENTE FIJO. */
export interface CupoDeEntradasDefinicion {
  cupoId: string;
  tipo: Exclude<TipoDeCupo, "SECCION">;
  /** El nombre del lugar («Entrada», «Plato del día»), para los mensajes. */
  nombre: string;
  cantidadMinima: number;
  cantidadMaximaCupo: number;
  /** Las entradas elegibles hoy, por su id. */
  entradas: ReadonlyMap<string, EntradaElegibleDeCupo>;
}

/** Cualquier cupo de una promo: los de sección de siempre o los de entradas de GO-3. */
export type CupoDePromo = CupoPromoDefinicion | CupoDeEntradasDefinicion;

/** Lo elegido en un cupo de entradas: la entrada (no el producto) y sus unidades. */
export interface EleccionDeCupoPorId {
  cupoId: string;
  elegidos: readonly { entradaId: string; cantidad: number }[];
}

/** Cualquier elección: por sección (la de siempre, sin cambios) o por cupo (GO-3). */
export type EleccionDePromo = EleccionDeCupo | EleccionDeCupoPorId;

/** Un componente ya validado: el producto y sus unidades y, si vino de un cupo de entradas, la entrada y la clave por la que se prorratea. */
export interface ComponenteValidado extends ProductoElegidoEnCupo {
  entradaId?: string;
  claveComponente?: string;
}

/** Los códigos de los rechazos de GO-3 que quien llama necesita distinguir (los de siempre no llevan código: solo el mensaje). */
export type CodigoDeEleccionDePromo = "MENU_DEL_DIA_SIN_CARGAR" | "ENTRADA_NO_DISPONIBLE" | "COMPONENTE_FIJO";

function esCupoDeEntradas(cupo: CupoDePromo): cupo is CupoDeEntradasDefinicion {
  return "cupoId" in cupo && typeof cupo.cupoId === "string" && "entradas" in cupo;
}

/** ¿El cupo es un COMPONENTE FIJO? Un LISTA con exactamente una entrada elegible y mínimo = máximo (de 1 o más): el servidor lo completa solo y el mozo no elige nada. */
export function esCupoFijo(cupo: CupoDePromo): cupo is CupoDeEntradasDefinicion {
  return esCupoDeEntradas(cupo) && cupo.tipo === "LISTA" && cupo.entradas.size === 1 && cupo.cantidadMinima >= 1 && cupo.cantidadMinima === cupo.cantidadMaximaCupo;
}

/**
 * La clave de componente de una entrada con configuración fija: `productoId` más el canónico de la configuración (`claveDeConfiguracion`). Sin configuración (canónico vacío) es el
 * `productoId` solo, que es la clave de siempre.
 */
export function claveDeComponenteConfigurado(productoId: string, claveConfiguracion: string): string {
  return claveConfiguracion === "" ? productoId : `${productoId}#${claveConfiguracion}`;
}

/**
 * El canónico de una configuración fija (`EntradaDeCupo.claveConfiguracion`): los pares `opcionId=cantidad` ordenados por `opcionId` y separados por `;`; vacío sin opciones. Estable:
 * no depende del orden en que se cargaron ni de la versión ni del precio de las opciones (la huella de la línea sí, por eso no sirve como identidad). Una opción repetida, sin id o con
 * una cantidad fuera de 1 a 10 es un error de configuración: `null`.
 */
export function claveDeConfiguracion(opciones: readonly { opcionId: string; cantidad: number }[]): string | null {
  const vistas = new Set<string>();
  for (const o of opciones) {
    if (typeof o.opcionId !== "string" || !/^[^;=\s]+$/.test(o.opcionId) || vistas.has(o.opcionId)) return null;
    if (!Number.isInteger(o.cantidad) || o.cantidad < 1 || o.cantidad > 10) return null;
    vistas.add(o.opcionId);
  }
  return [...opciones]
    .sort((a, b) => (a.opcionId < b.opcionId ? -1 : a.opcionId > b.opcionId ? 1 : 0))
    .map((o) => `${o.opcionId}=${o.cantidad}`)
    .join(";");
}

export type ResultadoValidacion = { ok: true } | { ok: false; mensaje: string; codigo?: CodigoDeEleccionDePromo };

/** Lo que devuelve `validarYAplanarEleccionPromo`: si la elección es válida, los componentes YA validados (copiados campo a campo, sin nada más de lo que mandó el cliente). */
export type ResultadoEleccionValidada = { ok: true; componentes: ComponenteValidado[] } | { ok: false; mensaje: string; codigo?: CodigoDeEleccionDePromo };

/**
 * D1: valida que la elección de una promo arme TODOS sus cupos dentro de mínimo y máximo, con unidades enteras y productos
 * que de verdad pertenecen a esa sección — la misma fuente que ofrece el selector (D5), nunca una lista propia paralela que
 * pueda desincronizarse (paso 8a: "validar la elegibilidad con una función de core/pos, con un test de paridad contra el
 * selector"). Un cupo ausente de `elecciones` cuenta como "nada elegido" (solo pasa si su mínimo es 0).
 *
 * S-01 (O.50 de docs/pureza-integracion.md, tanda T1 del plan de endurecimiento): la elección que llega del cliente se valida ENTERA, no solo
 * la parte que toca un cupo. Antes se recorrían los cupos y la elección de cada uno se tomaba de un `Map` (una sección repetida pisaba a la
 * anterior), pero quien armaba los componentes (`agregarItemsCasoDeUso`) aplanaba TODAS las elecciones recibidas: una sección que no es cupo, o la
 * primera de una sección repetida, entraba sin validar y se prorrateaba a $0,01 la unidad con CUALQUIER producto de la empresa (una MP, uno no
 * disponible). Ahora, ANTES de mirar los cupos, se rechaza (fallo cerrado, sin lanzar nunca):
 *  - la forma rota: una elección que no es un objeto con `seccionCartaId` de texto y `elegidos` lista de objetos con `productoId` de texto;
 *  - una sección que no es cupo de la promo;
 *  - una sección repetida (una sola elección por cupo);
 * y dentro de cada cupo, además de lo de siempre (cantidad entera y positiva, producto elegible, mínimo y máximo), un producto repetido (la
 * cantidad va en una sola fila). Los componentes que sirven para prorratear salen de ESTA función, ya validados: ver `validarYAplanarEleccionPromo`.
 */
export function validarEleccionPromo(cupos: readonly CupoDePromo[], elecciones: readonly EleccionDePromo[]): ResultadoValidacion {
  const r = validarYAplanarEleccionPromo(cupos, elecciones);
  return r.ok ? { ok: true } : r;
}

/**
 * La misma validación que `validarEleccionPromo`, pero si la elección es válida devuelve ADEMÁS los componentes aplanados que salen de la elección ya
 * validada (en el orden de los cupos): es lo que tiene que recibir `prorratearPrecioPromo`. Armar los componentes con `componentesDeEleccion` sobre la
 * entrada cruda del cliente es justo el hueco que S-01 cerró (ver arriba).
 *
 * GO-3: además acepta cupos de ENTRADAS (LISTA y DEL_DIA, por `cupoId`) y elecciones por cupo (`{ cupoId, elegidos: [{ entradaId, cantidad }] }`). Una elección se lee por cupo solo
 * si NO trae `seccionCartaId` (así una elección de hoy se lee siempre como la de hoy). En un cupo de entradas:
 *  - un COMPONENTE FIJO (`esCupoFijo`) lo completa el servidor: sin elección se agrega solo con su única entrada y su cantidad; si el cliente mandó algo distinto, se rechaza
 *    (`COMPONENTE_FIJO`) — nunca se cobra otra cosa que lo que el dueño fijó;
 *  - una entrada que no está entre las elegibles de hoy se rechaza (`ENTRADA_NO_DISPONIBLE`: se desactivó, se quitó del día o ya no tiene origen de stock);
 *  - un DEL_DIA sin ninguna entrada para hoy y con mínimo mayor que 0 se rechaza (`MENU_DEL_DIA_SIN_CARGAR`): falla cerrado, nunca el plato de ayer;
 *  - lo demás (cantidad entera y positiva, sin repetidos, mínimo y máximo) igual que en un cupo de sección.
 * Los componentes de un cupo de entradas llevan `entradaId` y `claveComponente`; los de sección, exactamente lo de siempre.
 */
export function validarYAplanarEleccionPromo(cupos: readonly CupoDePromo[], elecciones: readonly EleccionDePromo[]): ResultadoEleccionValidada {
  const formaRota = { ok: false, mensaje: "La elección de la promo tiene un formato inválido." } as const;
  if (!Array.isArray(elecciones)) return formaRota;
  const seccionesDeCupo = new Set(cupos.filter((c): c is CupoPromoDefinicion => !esCupoDeEntradas(c)).map((c) => c.seccionCartaId));
  const cuposDeEntradas = new Map(cupos.filter(esCupoDeEntradas).map((c) => [c.cupoId, c]));
  const eleccionPorSeccion = new Map<string, EleccionDeCupo>();
  const eleccionPorCupo = new Map<string, EleccionDeCupoPorId>();
  for (const e of elecciones as readonly unknown[]) {
    if (typeof e !== "object" || e === null) return formaRota;
    if ((e as Partial<EleccionDeCupo>).seccionCartaId === undefined && typeof (e as Partial<EleccionDeCupoPorId>).cupoId === "string") {
      const { cupoId, elegidos } = e as EleccionDeCupoPorId;
      if (!Array.isArray(elegidos)) return formaRota;
      for (const el of elegidos as readonly unknown[]) {
        if (typeof el !== "object" || el === null || typeof (el as Partial<EleccionDeCupoPorId["elegidos"][number]>).entradaId !== "string") return formaRota;
      }
      if (!cuposDeEntradas.has(cupoId)) return { ok: false, mensaje: "La elección incluye un lugar que no es parte de esta promo." };
      if (eleccionPorCupo.has(cupoId)) return { ok: false, mensaje: "La elección repite un lugar de la promo: se elige una sola vez por lugar." };
      eleccionPorCupo.set(cupoId, e as EleccionDeCupoPorId);
      continue;
    }
    const { seccionCartaId, elegidos } = e as Partial<EleccionDeCupo>;
    if (typeof seccionCartaId !== "string" || !Array.isArray(elegidos)) return formaRota;
    for (const el of elegidos as readonly unknown[]) {
      if (typeof el !== "object" || el === null || typeof (el as Partial<ProductoElegidoEnCupo>).productoId !== "string") return formaRota;
    }
    if (!seccionesDeCupo.has(seccionCartaId)) return { ok: false, mensaje: "La elección incluye una sección que no es parte de esta promo." };
    if (eleccionPorSeccion.has(seccionCartaId)) return { ok: false, mensaje: "La elección repite una sección de la promo: se elige una sola vez por cupo." };
    eleccionPorSeccion.set(seccionCartaId, e as EleccionDeCupo);
  }

  const componentes: ComponenteValidado[] = [];
  for (const cupo of cupos) {
    if (esCupoDeEntradas(cupo)) {
      const r = aplanarCupoDeEntradas(cupo, eleccionPorCupo.get(cupo.cupoId));
      if (!r.ok) return r;
      componentes.push(...r.componentes);
      continue;
    }
    const elegidos = eleccionPorSeccion.get(cupo.seccionCartaId)?.elegidos ?? [];
    const productosYaElegidos = new Set<string>();
    let total = 0;
    for (const el of elegidos) {
      if (!Number.isInteger(el.cantidad) || el.cantidad <= 0) {
        return { ok: false, mensaje: `La cantidad elegida en "${cupo.nombreSeccion}" tiene que ser un número entero mayor que cero.` };
      }
      if (!cupo.elegibles.has(el.productoId)) {
        return { ok: false, mensaje: `Ese producto no es una opción válida de "${cupo.nombreSeccion}" en esta promo.` };
      }
      if (productosYaElegidos.has(el.productoId)) {
        return { ok: false, mensaje: `Un producto está repetido en "${cupo.nombreSeccion}": la cantidad se elige en una sola fila.` };
      }
      productosYaElegidos.add(el.productoId);
      total += el.cantidad;
      componentes.push({ productoId: el.productoId, cantidad: el.cantidad });
    }
    if (total < cupo.cantidadMinima) {
      return { ok: false, mensaje: `Elegí al menos ${cupo.cantidadMinima} opción(es) de "${cupo.nombreSeccion}".` };
    }
    if (total > cupo.cantidadMaximaCupo) {
      return { ok: false, mensaje: `Como máximo ${cupo.cantidadMaximaCupo} opción(es) de "${cupo.nombreSeccion}".` };
    }
  }
  return { ok: true, componentes };
}

/** GO-3: valida y aplana UN cupo de entradas (ver `validarYAplanarEleccionPromo`). */
function aplanarCupoDeEntradas(cupo: CupoDeEntradasDefinicion, eleccion: EleccionDeCupoPorId | undefined): ResultadoEleccionValidada {
  if (cupo.tipo === "DEL_DIA" && cupo.entradas.size === 0 && cupo.cantidadMinima > 0) {
    return { ok: false, codigo: "MENU_DEL_DIA_SIN_CARGAR", mensaje: `«${cupo.nombre}»: todavía no se cargó el plato de hoy.` };
  }
  let elegidos = eleccion?.elegidos ?? [];
  if (esCupoFijo(cupo)) {
    const [unica] = [...cupo.entradas.keys()];
    const fijo = [{ entradaId: unica!, cantidad: cupo.cantidadMinima }];
    if (eleccion !== undefined && !(elegidos.length === 1 && elegidos[0]!.entradaId === unica && elegidos[0]!.cantidad === cupo.cantidadMinima)) {
      return { ok: false, codigo: "COMPONENTE_FIJO", mensaje: `«${cupo.nombre}» viene fijo en esta promo: no se elige.` };
    }
    elegidos = fijo;
  }
  const componentes: ComponenteValidado[] = [];
  const yaElegidas = new Set<string>();
  let total = 0;
  for (const el of elegidos) {
    if (!Number.isInteger(el.cantidad) || el.cantidad <= 0) {
      return { ok: false, mensaje: `La cantidad elegida en "${cupo.nombre}" tiene que ser un número entero mayor que cero.` };
    }
    const entrada = cupo.entradas.get(el.entradaId);
    if (!entrada) return { ok: false, codigo: "ENTRADA_NO_DISPONIBLE", mensaje: `Esa opción de "${cupo.nombre}" no está disponible hoy en esta promo.` };
    if (yaElegidas.has(el.entradaId)) return { ok: false, mensaje: `Una opción está repetida en "${cupo.nombre}": la cantidad se elige en una sola fila.` };
    yaElegidas.add(el.entradaId);
    total += el.cantidad;
    componentes.push({ productoId: entrada.productoId, cantidad: el.cantidad, entradaId: entrada.entradaId, claveComponente: entrada.claveComponente });
  }
  if (total < cupo.cantidadMinima) return { ok: false, mensaje: `Elegí al menos ${cupo.cantidadMinima} opción(es) de "${cupo.nombre}".` };
  if (total > cupo.cantidadMaximaCupo) return { ok: false, mensaje: `Como máximo ${cupo.cantidadMaximaCupo} opción(es) de "${cupo.nombre}".` };
  return { ok: true, componentes };
}

/**
 * Todo lo elegido en todos los cupos de una promo, aplanado, SIN validar nada: solo sirve para CONTAR líneas antes de abrir la transacción (el tope de
 * `MAXIMO_ITEMS_POR_AGREGADO` del guard). Lo que se prorratea sale de `validarYAplanarEleccionPromo`, nunca de acá (S-01). Tolera la forma rota (una elección
 * que no es un objeto, o sin lista `elegidos`, cuenta como vacía) para que el guard no lance: la rechaza la validación, con un mensaje, y no un 500.
 *
 * GO-3b: también acepta las elecciones por cupo (sus elegidos llevan `entradaId`, no `productoId`); un componente fijo que completa el servidor no cuenta acá (lo cuenta el caso de uso).
 */
export function componentesDeEleccion(elecciones: readonly EleccionDeCupo[]): ProductoElegidoEnCupo[];
export function componentesDeEleccion(elecciones: readonly EleccionDePromo[]): (ProductoElegidoEnCupo | EleccionDeCupoPorId["elegidos"][number])[];
export function componentesDeEleccion(elecciones: readonly EleccionDePromo[]): (ProductoElegidoEnCupo | EleccionDeCupoPorId["elegidos"][number])[] {
  return elecciones.flatMap((e) => (Array.isArray(e?.elegidos) ? e.elegidos : []));
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
  /** GO-3: la clave por la que se agrupan las unidades en filas (por defecto, el `productoId`): dos configuraciones del mismo producto con el mismo precio no se mezclan. */
  claveComponente?: string;
}

export interface FilaPromoProrrateada {
  productoId: string;
  /** GO-3: solo si el componente la trajo: la clave del componente de esta fila (para saber qué configuración lleva). */
  claveComponente?: string;
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
  const unidades: { productoId: string; claveComponente: string | undefined; peso: number }[] = [];
  for (const c of componentes) {
    if (!Number.isInteger(c.cantidad) || c.cantidad <= 0) {
      return { ok: false, mensaje: `Cantidad inválida para "${c.productoId}".` };
    }
    for (let u = 0; u < c.cantidad; u++) unidades.push({ productoId: c.productoId, claveComponente: c.claveComponente, peso: c.precioCarta });
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
    const clave = `${u.claveComponente ?? u.productoId}|${precioUnitario}`;
    const idx = indicePorClave.get(clave);
    if (idx !== undefined) filas[idx].cantidad += 1;
    else {
      indicePorClave.set(clave, filas.length);
      filas.push(u.claveComponente === undefined ? { productoId: u.productoId, cantidad: 1, precioUnitario } : { productoId: u.productoId, claveComponente: u.claveComponente, cantidad: 1, precioUnitario });
    }
  });
  return { ok: true, filas };
}

/** Suma de `importeDeLinea` de todas las filas de un prorrateo — tiene que dar EXACTO el precio de la promo (invariante de
 *  `prorratearPrecioPromo`, chequeado en los tests, no en producción). */
export function totalProrrateado(filas: readonly FilaPromoProrrateada[]): number {
  return redondearMoneda(filas.reduce((s, f) => s + importeDeLinea(f.cantidad, f.precioUnitario), 0));
}

import { redondearACantidadDeUnidad } from "@/core/movimientos/transiciones";

/**
 * De qué sección (y de qué lote) sale cada consumo de una venta — núcleo PURO, sin Prisma ni base (el cargador que arma los datos es
 * `origen-venta-datos.ts`). Ver docs/plan-seccion-habitual-stock-2026-09-25.md (C3).
 *
 * El LIBRO lleva la cuenta de lo que ya se asignó dentro de la MISMA venta: cada pedido descuenta lo que tomaron los anteriores
 * (antes cada línea releía el saldo de la base y dos líneas podían pedir el mismo lote dos veces — H9). Con él se recorre:
 * 1. la sección HABITUAL del producto (si tiene; se usa aunque no sirva de respaldo: la preferencia explícita manda);
 * 2. las secciones de RESPALDO, ordenadas por vencimiento a nivel de sección (el lote con disponible que vence antes de toda la
 *    familia de hermanos del insumo), desempate: más disponible primero, después nombre;
 * 3. dentro de cada sección, FEFO por lote (sin lote al final), desempate: el producto de la receta antes que sus hermanos, después
 *    `productoId`.
 * Si nada alcanza, se toma todo lo disponible y SOLO el resto se carga al producto de la receta en `seccionParaFaltanteId`.
 *
 * La venta de mostrador usa el mismo núcleo en "modo sección fija": `seccionHabitual` = la elegida, `respaldos` = [] — idéntico a
 * antes salvo H9. Toda comparación se hace redondeando a 4 decimales (la precisión real de `MovimientoStock.cantidad`).
 *
 * `asignarConsumosDeVenta` (docs/plan-sustitucion-insumos-receta-2026-09-26.md) suma una segunda pasada, solo para líneas de
 * receta que declararon sustitutos: primero se agota la familia principal de TODAS las líneas de la venta (como arriba), y recién
 * después, entre pedidos diferidos, se prueba cada sustituto declarado en orden — nunca al revés, y nunca a costa de un consumo
 * principal de la misma venta. Ver el docstring de esa función para el detalle.
 */

export interface SeccionCandidata {
  id: string;
  nombre: string;
}

export interface SaldoLote {
  productoId: string;
  seccionId: string;
  loteVencimiento: Date | null;
  saldo: number;
}

export interface ParteAsignada {
  productoId: string;
  seccionId: string;
  loteVencimiento: Date | null;
  cantidad: number;
}

export interface FaltanteDeStock {
  productoId: string;
  seccionId: string;
  /** Saldo del producto en la sección ANTES de esta venta. */
  actual: number;
  /** Todo lo que esta venta le cargó al producto en esa sección. */
  requerido: number;
}

export interface LibroDeStock {
  /** Lo que queda de un lote puntual (o del bucket sin lote): max(0, saldo − lo ya tomado), redondeado a 4. */
  disponible(productoId: string, seccionId: string, lote: Date | null): number;
  /** Saldo total del producto en la sección antes de la venta (todos los lotes). */
  saldoInicial(productoId: string, seccionId: string): number;
  /** Todo lo que esta venta ya le cargó al producto en la sección. */
  cargado(productoId: string, seccionId: string): number;
  /** Lotes conocidos del producto en la sección (con saldo, aunque ya estén agotados por el libro). */
  lotes(productoId: string, seccionId: string): (Date | null)[];
  tomar(parte: ParteAsignada): void;
  /** Pares (producto, sección) a los que se les cargó algo, en el orden en que se cargaron por primera vez. */
  cargados(): { productoId: string; seccionId: string }[];
}

const r4 = (n: number) => redondearACantidadDeUnidad(n, 4);
const clavePS = (productoId: string, seccionId: string) => `${productoId}|${seccionId}`;
const claveLote = (lote: Date | null) => (lote ? String(lote.getTime()) : "sin-lote");

export function crearLibroDeStock(saldos: readonly SaldoLote[]): LibroDeStock {
  const saldoPorLote = new Map<string, Map<string, { lote: Date | null; saldo: number }>>();
  const saldoTotal = new Map<string, number>();
  const tomadoPorLote = new Map<string, number>();
  const cargadoPS = new Map<string, { productoId: string; seccionId: string; cantidad: number }>();

  for (const s of saldos) {
    const ps = clavePS(s.productoId, s.seccionId);
    const lotes = saldoPorLote.get(ps) ?? new Map<string, { lote: Date | null; saldo: number }>();
    const previo = lotes.get(claveLote(s.loteVencimiento));
    lotes.set(claveLote(s.loteVencimiento), { lote: s.loteVencimiento, saldo: (previo?.saldo ?? 0) + s.saldo });
    saldoPorLote.set(ps, lotes);
    saldoTotal.set(ps, (saldoTotal.get(ps) ?? 0) + s.saldo);
  }

  return {
    disponible(productoId, seccionId, lote) {
      const ps = clavePS(productoId, seccionId);
      const saldo = saldoPorLote.get(ps)?.get(claveLote(lote))?.saldo ?? 0;
      const tomado = tomadoPorLote.get(`${ps}|${claveLote(lote)}`) ?? 0;
      return Math.max(0, r4(saldo - tomado));
    },
    saldoInicial(productoId, seccionId) {
      return r4(saldoTotal.get(clavePS(productoId, seccionId)) ?? 0);
    },
    cargado(productoId, seccionId) {
      return cargadoPS.get(clavePS(productoId, seccionId))?.cantidad ?? 0;
    },
    lotes(productoId, seccionId) {
      return Array.from(saldoPorLote.get(clavePS(productoId, seccionId))?.values() ?? [], (l) => l.lote);
    },
    tomar(parte) {
      const ps = clavePS(parte.productoId, parte.seccionId);
      const kl = `${ps}|${claveLote(parte.loteVencimiento)}`;
      tomadoPorLote.set(kl, (tomadoPorLote.get(kl) ?? 0) + parte.cantidad);
      const previo = cargadoPS.get(ps);
      cargadoPS.set(ps, { productoId: parte.productoId, seccionId: parte.seccionId, cantidad: (previo?.cantidad ?? 0) + parte.cantidad });
    },
    cargados() {
      return Array.from(cargadoPS.values(), ({ productoId, seccionId }) => ({ productoId, seccionId }));
    },
  };
}

/** Lo que todavía se puede tomar del producto en la sección: lo disponible por lote, sin pasar nunca el saldo TOTAL que queda (un lote negativo resta). */
function disponibleDeProducto(libro: LibroDeStock, productoId: string, seccionId: string): number {
  const porLotes = r4(libro.lotes(productoId, seccionId).reduce((suma, lote) => suma + libro.disponible(productoId, seccionId, lote), 0));
  const porTotal = Math.max(0, r4(libro.saldoInicial(productoId, seccionId) - libro.cargado(productoId, seccionId)));
  return Math.min(porLotes, porTotal);
}

/** FEFO: con fecha antes que sin fecha; entre fechas, la que vence antes. */
function compararLotes(a: Date | null, b: Date | null): number {
  if (a && b) return a.getTime() - b.getTime();
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/** Respaldo ordenado (B2): por el lote disponible que vence antes en toda la familia dentro de la sección; más disponible; nombre. */
function ordenarRespaldos(libro: LibroDeStock, familia: readonly string[], respaldos: readonly SeccionCandidata[]): SeccionCandidata[] {
  const claves = respaldos.map((seccion) => {
    let primerVencimiento: Date | null = null;
    let conVencimiento = false;
    let total = 0;
    for (const productoId of familia) {
      const disponible = disponibleDeProducto(libro, productoId, seccion.id);
      if (disponible <= 0) continue;
      total += disponible;
      for (const lote of libro.lotes(productoId, seccion.id)) {
        if (!lote || libro.disponible(productoId, seccion.id, lote) <= 0) continue;
        if (!conVencimiento || lote.getTime() < primerVencimiento!.getTime()) primerVencimiento = lote;
        conVencimiento = true;
      }
    }
    return { seccion, vence: conVencimiento ? primerVencimiento!.getTime() : Infinity, total: r4(total) };
  });
  claves.sort((a, b) => (a.vence === b.vence ? 0 : a.vence < b.vence ? -1 : 1) || b.total - a.total || a.seccion.nombre.localeCompare(b.seccion.nombre, "es"));
  return claves.map((c) => c.seccion);
}

function seccionesEnOrden(libro: LibroDeStock, familia: readonly string[], habitual: SeccionCandidata | null, respaldos: readonly SeccionCandidata[]): SeccionCandidata[] {
  const otras = respaldos.filter((s) => s.id !== habitual?.id);
  return [...(habitual ? [habitual] : []), ...ordenarRespaldos(libro, familia, otras)];
}

/**
 * Junta las partes del mismo (producto, sección, lote): una sola fila de Kardex por cada una, como antes. Genérica desde el paso 3
 * (docs/plan-sustitucion-insumos-receta-2026-09-26.md) para que `asignarConsumosDeVenta` la reuse sobre `ParteConsumo[]` sin perder
 * `sustituyeAProductoId` en el tipo de retorno — el dedupe (D8) garantiza que dos partes con el mismo (producto, sección, lote)
 * siempre comparten el mismo valor de esa marca, así que copiarla de la primera (`{ ...p }`) alcanza.
 */
function juntarPartes<T extends ParteAsignada>(partes: T[]): T[] {
  const juntas: T[] = [];
  for (const p of partes) {
    const igual = juntas.find((j) => j.productoId === p.productoId && j.seccionId === p.seccionId && claveLote(j.loteVencimiento) === claveLote(p.loteVencimiento));
    if (igual) igual.cantidad += p.cantidad;
    else juntas.push({ ...p });
  }
  return juntas;
}

/**
 * Núcleo del reparto DENTRO de una familia (hermanos de un mismo Insumo, o los sustitutos de UN sustituto en el paso 3): recorre las
 * secciones candidatas, FEFO por lote dentro de cada una, hasta agotar `cantidad` o las secciones. `preferidoId` es el desempate
 * (el producto de la receta, o el sustituto en cuestión) — no tiene que ser miembro de `familia` para el desempate en sí, pero
 * `asignarConsumo` siempre lo agrega antes de llamar. Extraído tal cual del cuerpo del bucle de `asignarConsumo` (refactor puro,
 * docs/plan-sustitucion-insumos-receta-2026-09-26.md, paso 2): NO cambia ninguna aritmética ni el orden de `restante -= tomar`.
 * No anota faltante ni junta partes — eso es responsabilidad de quien llama (`asignarConsumo`, y desde el paso 3 también
 * `asignarConsumosDeVenta`).
 */
function tomarDeFamilia(
  libro: LibroDeStock,
  pedido: {
    familia: readonly string[];
    /** Desempate FEFO: este producto gana un lote empatado por sobre sus hermanos. */
    preferidoId: string;
    cantidad: number;
    /** Se usa primero aunque no sirva de respaldo. */
    seccionHabitual: SeccionCandidata | null;
    /** Activas que sirven de respaldo (la habitual, si está, se ignora acá). */
    respaldos: readonly SeccionCandidata[];
  }
): { partes: ParteAsignada[]; restante: number } {
  const partes: ParteAsignada[] = [];
  let restante = pedido.cantidad;

  for (const seccion of seccionesEnOrden(libro, pedido.familia, pedido.seccionHabitual, pedido.respaldos)) {
    if (r4(restante) <= 0) break;
    const candidatos = pedido.familia.flatMap((productoId) => libro.lotes(productoId, seccion.id).map((lote) => ({ productoId, lote })));
    candidatos.sort(
      (a, b) =>
        compararLotes(a.lote, b.lote) ||
        Number(b.productoId === pedido.preferidoId) - Number(a.productoId === pedido.preferidoId) ||
        (a.productoId < b.productoId ? -1 : a.productoId > b.productoId ? 1 : 0)
    );
    for (const c of candidatos) {
      if (r4(restante) <= 0) break;
      const tomar = Math.min(restante, libro.disponible(c.productoId, seccion.id, c.lote), disponibleDeProducto(libro, c.productoId, seccion.id));
      if (r4(tomar) <= 0) continue;
      const parte = { productoId: c.productoId, seccionId: seccion.id, loteVencimiento: c.lote, cantidad: tomar };
      libro.tomar(parte);
      partes.push(parte);
      restante -= tomar;
    }
  }
  return { partes, restante };
}

/**
 * Asigna el consumo de UN ingrediente (`productoId`, el de la receta, con su `familia` de hermanos: él mismo incluido) y lo anota en
 * el libro. Devuelve las partes, ya juntadas por (producto, sección, lote).
 */
export function asignarConsumo(
  libro: LibroDeStock,
  pedido: {
    productoId: string;
    familia: readonly string[];
    cantidad: number;
    /** Se usa primero aunque no sirva de respaldo. */
    seccionHabitual: SeccionCandidata | null;
    /** Activas que sirven de respaldo (la habitual, si está, se ignora acá). */
    respaldos: readonly SeccionCandidata[];
    seccionParaFaltanteId: string;
  }
): ParteAsignada[] {
  const familia = pedido.familia.includes(pedido.productoId) ? pedido.familia : [pedido.productoId, ...pedido.familia];
  const { partes, restante } = tomarDeFamilia(libro, {
    familia,
    preferidoId: pedido.productoId,
    cantidad: pedido.cantidad,
    seccionHabitual: pedido.seccionHabitual,
    respaldos: pedido.respaldos,
  });

  if (r4(restante) > 0) {
    const ultimaAhi = partes.findLast((p) => p.productoId === pedido.productoId && p.seccionId === pedido.seccionParaFaltanteId);
    const resto = { productoId: pedido.productoId, seccionId: pedido.seccionParaFaltanteId, loteVencimiento: ultimaAhi?.loteVencimiento ?? null, cantidad: restante };
    libro.tomar(resto);
    partes.push(resto);
  }
  return juntarPartes(partes);
}

/**
 * Una parte de consumo, marcada cuando salió de un INSUMO SUSTITUTO declarado en la línea de receta (docs/plan-sustitucion-insumos-
 * receta-2026-09-26.md, D6/paso 3): `sustituyeAProductoId` es el producto de la receta al que reemplazó. La clave SOLO existe en
 * partes de un sustituto — nunca se agrega `undefined` explícito a una parte de la familia principal (ni de un hermano): así
 * `JSON.stringify`/Prisma la tratan igual que "no vino", y el test diferencial del paso 1 (que compara contra `asignarConsumo`, que
 * nunca conoce esta clave) puede seguir usando `toStrictEqual` sin normalizar nada.
 */
export type ParteConsumo = ParteAsignada & { sustituyeAProductoId?: string };

export interface PedidoDeConsumo {
  productoId: string;
  familia: readonly string[];
  cantidad: number;
  /** Se usa primero aunque no sirva de respaldo. */
  seccionHabitual: SeccionCandidata | null;
  /** Activas que sirven de respaldo (la habitual, si está, se ignora acá). */
  respaldos: readonly SeccionCandidata[];
  seccionParaFaltanteId: string;
  /**
   * Familias YA resueltas de cada sustituto declarado en la línea de receta, EN ORDEN (D3) — el primer elemento de cada una es el
   * propio Insumo sustituto (desempate FEFO, igual criterio que `productoId` en la familia principal), el resto sus hermanos.
   * Ausente o `[]` = sin sustitutos declarados: se resuelve exactamente como `asignarConsumo` (demostración (a) del plan §4).
   */
  sustitutos?: readonly (readonly string[])[];
}

/** Secciones candidatas de un pedido, sin orden ni duplicados — para sumar disponible total (D4), donde el orden no importa. */
function seccionesCandidatas(seccionHabitual: SeccionCandidata | null, respaldos: readonly SeccionCandidata[]): SeccionCandidata[] {
  const vistas = new Set<string>();
  const todas = seccionHabitual ? [seccionHabitual, ...respaldos] : respaldos;
  return todas.filter((s) => (vistas.has(s.id) ? false : (vistas.add(s.id), true)));
}

/**
 * Asigna el consumo de TODA la venta, con sustitutos (docs/plan-sustitucion-insumos-receta-2026-09-26.md, D3/D4/D5): reemplaza a
 * `asignarConsumo` como entrada cuando alguna línea declara sustitutos; para el resto se comporta idéntico (demostración (a), plan
 * §4). Dos pasadas sobre el MISMO libro, en el orden de `pedidos`:
 *
 * 1. La familia PRINCIPAL de cada pedido, en TODAS sus secciones candidatas — exactamente como `asignarConsumo`. Un pedido sin
 *    sustitutos queda resuelto acá mismo (con su faltante, si corresponde). Uno CON sustitutos quiere quedar "diferido": no se le
 *    carga el faltante todavía, para que un hermano de OTRA línea no se quede sin stock por un sustituto de ESTA (D5 — una
 *    sustitución nunca le saca stock a un consumo principal de la misma venta, ver el test de equidad entre líneas).
 * 2. Recién ahí, cada diferido prueba sus sustitutos EN ORDEN, cada uno con su propia familia (D3: secciones y FEFO propios,
 *    desempate por el primer producto de esa familia) — pero solo si la suma de lo disponible de TODOS ellos juntos (ya sin lo que
 *    se solapa con la familia principal, D8) alcanza para cubrir el resto (D4, todo o nada): si no alcanza, no se toca NINGÚN
 *    sustituto y el faltante queda IDÉNTICO al de `asignarConsumo` sin sustitutos. Si alcanza, se reparte sustituto por sustituto
 *    (`tomarDeFamilia`), marcando cada parte con `sustituyeAProductoId`, hasta cubrir el resto; si un redondeo dejara un resto
 *    ínfimo, se cierra con el mismo faltante de siempre.
 */
export function asignarConsumosDeVenta(libro: LibroDeStock, pedidos: readonly PedidoDeConsumo[]): ParteConsumo[][] {
  const resultados: (ParteConsumo[] | undefined)[] = new Array(pedidos.length);
  const diferidos: { indice: number; pedido: PedidoDeConsumo; familiaPropia: readonly string[]; partesPropias: ParteAsignada[]; restante: number }[] = [];

  // Pasada 1: igual que asignarConsumo para todas las líneas — las que no declaran sustitutos quedan resueltas acá.
  for (let i = 0; i < pedidos.length; i++) {
    const pedido = pedidos[i];
    if (!pedido.sustitutos?.length) {
      resultados[i] = asignarConsumo(libro, pedido);
      continue;
    }
    const familiaPropia = pedido.familia.includes(pedido.productoId) ? pedido.familia : [pedido.productoId, ...pedido.familia];
    const { partes, restante } = tomarDeFamilia(libro, {
      familia: familiaPropia,
      preferidoId: pedido.productoId,
      cantidad: pedido.cantidad,
      seccionHabitual: pedido.seccionHabitual,
      respaldos: pedido.respaldos,
    });
    diferidos.push({ indice: i, pedido, familiaPropia, partesPropias: partes, restante });
  }

  // Pasada 2: cada diferido prueba sus sustitutos y después su faltante — corre DESPUÉS de que la 1 terminó para TODAS las líneas.
  for (const { indice, pedido, familiaPropia, partesPropias, restante } of diferidos) {
    const partesFinal: ParteConsumo[] = [...partesPropias];
    let restanteActual = restante;

    if (r4(restanteActual) > 0) {
      const yaEnPrincipal = new Set(familiaPropia);
      const familiasSustitutas = (pedido.sustitutos ?? []).map((familia) => familia.filter((id) => !yaEnPrincipal.has(id)));
      const candidatas = seccionesCandidatas(pedido.seccionHabitual, pedido.respaldos);
      const idsSustitutos = new Set(familiasSustitutas.flat());
      let disponibleTotal = 0;
      for (const productoId of idsSustitutos) {
        for (const seccion of candidatas) disponibleTotal += disponibleDeProducto(libro, productoId, seccion.id);
      }

      if (r4(disponibleTotal) >= r4(restanteActual)) {
        for (const familiaSustituta of familiasSustitutas) {
          if (r4(restanteActual) <= 0) break;
          if (!familiaSustituta.length) continue;
          const { partes: partesSustituto, restante: restanteTrasSustituto } = tomarDeFamilia(libro, {
            familia: familiaSustituta,
            preferidoId: familiaSustituta[0],
            cantidad: restanteActual,
            seccionHabitual: pedido.seccionHabitual,
            respaldos: pedido.respaldos,
          });
          for (const p of partesSustituto) partesFinal.push({ ...p, sustituyeAProductoId: pedido.productoId });
          restanteActual = restanteTrasSustituto;
        }
      }
    }

    if (r4(restanteActual) > 0) {
      const ultimaAhi = partesPropias.findLast((p) => p.productoId === pedido.productoId && p.seccionId === pedido.seccionParaFaltanteId);
      const resto: ParteConsumo = { productoId: pedido.productoId, seccionId: pedido.seccionParaFaltanteId, loteVencimiento: ultimaAhi?.loteVencimiento ?? null, cantidad: restanteActual };
      libro.tomar(resto);
      partesFinal.push(resto);
    }

    resultados[indice] = juntarPartes(partesFinal);
  }

  return resultados as ParteConsumo[][];
}

/**
 * Dónde sale el stock PROPIO de un PV que se produce (pizza al corte). La SECCIÓN: la habitual si ahí alcanza; si no, el primer respaldo (mismo orden) donde alcance; si en
 * ninguna, `seccionSiNingunaAlcanzaId`. Sin repartir entre secciones. Los LOTES, en cambio, sí se reparten (Pureza, Hito 2, O.40 (1)): FEFO dentro de la sección, el lote que vence
 * antes primero y el «sin lote» al final, tomando de cada uno lo que tiene disponible (como `asignarConsumo` con los ingredientes). Antes todo iba al lote que vence antes aunque no
 * alcanzara, y lo dejaba en negativo con stock en otro lote. Lo que NINGÚN lote cubre (la sección no alcanza) queda en el último lote tomado —o sin lote si no se tomó de ninguno—,
 * como el faltante de un ingrediente. Devuelve las partes ya juntadas por lote; su suma es `pedido.cantidad`. Lo anota en el libro.
 */
export function elegirSeccionDeStockPropio(
  libro: LibroDeStock,
  pedido: { productoId: string; cantidad: number; seccionHabitual: SeccionCandidata | null; respaldos: readonly SeccionCandidata[]; seccionSiNingunaAlcanzaId: string }
): ParteAsignada[] {
  const alcanza = seccionesEnOrden(libro, [pedido.productoId], pedido.seccionHabitual, pedido.respaldos).find(
    (s) => disponibleDeProducto(libro, pedido.productoId, s.id) >= r4(pedido.cantidad)
  );
  const seccionId = alcanza?.id ?? pedido.seccionSiNingunaAlcanzaId;
  const lotes = libro
    .lotes(pedido.productoId, seccionId)
    .filter((l) => libro.disponible(pedido.productoId, seccionId, l) > 0)
    .sort(compararLotes);
  const partes: ParteAsignada[] = [];
  let restante = pedido.cantidad;
  for (const lote of lotes) {
    if (r4(restante) <= 0) break;
    const tomar = Math.min(restante, libro.disponible(pedido.productoId, seccionId, lote), disponibleDeProducto(libro, pedido.productoId, seccionId));
    if (r4(tomar) <= 0) continue;
    const parte = { productoId: pedido.productoId, seccionId, loteVencimiento: lote, cantidad: tomar };
    libro.tomar(parte);
    partes.push(parte);
    restante -= tomar;
  }
  if (r4(restante) > 0) {
    const resto = { productoId: pedido.productoId, seccionId, loteVencimiento: partes.at(-1)?.loteVencimiento ?? null, cantidad: restante };
    libro.tomar(resto);
    partes.push(resto);
  }
  return juntarPartes(partes);
}

/** Cada (producto, sección) de `productoIds` al que la venta le cargó más de lo que tenía, en el orden en que se cargó por primera vez. */
export function faltantesDe(libro: LibroDeStock, productoIds: ReadonlySet<string>): FaltanteDeStock[] {
  return libro
    .cargados()
    .filter((c) => productoIds.has(c.productoId))
    .map((c) => ({ ...c, actual: libro.saldoInicial(c.productoId, c.seccionId), requerido: r4(libro.cargado(c.productoId, c.seccionId)) }))
    .filter((f) => f.requerido > f.actual);
}

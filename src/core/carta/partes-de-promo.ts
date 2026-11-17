import { comandoDeProducto, ORIGEN_FUERA_DE_LA_CARTA, productosDelOrigen, type BorradorDeProducto } from "./armar-lugar-de-lista";
import type { EntradaDeLugarAdmin, LugarDeCombo, ProductoParaEntrada } from "./admin-tipos";

/**
 * Las PARTES de una promo en la pantalla de armado «como Pedernal» (E2b de `docs/diseno-promo-parte-de-seccion-2026-11-11.md`). PURO: sin lecturas ni escrituras. Arma las filas (una por sección de la carta, la de «No está en la carta» y las «otras partes»
 * que ya estaban cargadas) a partir de lo guardado, y el comando de `guardarParteDePromo` a partir de lo que se tocó en la fila. El servidor vuelve a validar todo.
 *
 * Una parte «Solo estos platos» de una sección se guarda como una lista con el NOMBRE de la sección (enganche por nombre, alternativa A del diseño: sin columna nueva). Las listas que no se llaman como ninguna sección ni «No está en la carta» (lo que se cargó
 * antes con «Sumar un lugar») se muestran como «otras partes».
 */

/** El nombre de la lista de la parte «No está en la carta» (una lista con nombre propio, siempre «Solo estos platos»). */
export const NOMBRE_DE_LA_PARTE_FUERA_DE_LA_CARTA = "No está en la carta";

export type ModoDeFila = "NO_ENTRA" | "TODA" | "SOLO_ESTOS";

export interface FilaDeParte {
  /** Estable entre guardados: `S:<id de la sección>` o `L:<nombre en minúsculas>`. */
  clave: string;
  /** Cómo se llama la fila (la sección, «No está en la carta» o el nombre de la lista heredada). */
  nombre: string;
  /** Una sección de la carta (puede elegirse «Toda la sección») o una lista con nombre propio (solo «Solo estos platos»). */
  lugar: { tipo: "SECCION"; seccionCartaId: string } | { tipo: "LISTA"; nombre: string };
  /** De dónde se tildan los platos: el id de la sección o `ORIGEN_FUERA_DE_LA_CARTA`. */
  origen: string;
  /** Una sección apagada en la carta se rotula «(apagada)», como en la pantalla de siempre. */
  apagada: boolean;
  modo: ModoDeFila;
  cantidadMinima: number;
  cantidadMaxima: number;
  /** Los platos que la parte lleva hoy (solo «Solo estos platos»; los dados de baja no cuentan). */
  entradas: EntradaDeLugarAdmin[];
}

export interface FilasDeLaPromo {
  deSecciones: FilaDeParte[];
  fueraDeLaCarta: FilaDeParte;
  otras: FilaDeParte[];
}

const clave = (nombre: string) => nombre.trim().toLowerCase();

/**
 * Las filas de la promo: de cada sección, «Toda la sección» si tiene su cupo de sección, «Solo estos platos» si hay una lista con su nombre (y no entra entera), «No entra» si ninguna de las dos (todo nace cerrado). Van todas las secciones (una apagada se ve rotulada, como antes). Lo que sobra son las «otras partes».
 */
export function armarFilasDeLaPromo(args: {
  secciones: readonly { id: string; nombre: string; activa: boolean }[];
  cuposDeSeccion: readonly { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number }[];
  lugares: readonly LugarDeCombo[];
}): FilasDeLaPromo {
  const cupoDe = new Map(args.cuposDeSeccion.map((c) => [c.seccionCartaId, c]));
  const usados = new Set<string>();
  const listaLlamada = (nombre: string) => args.lugares.find((l) => !usados.has(l.id) && clave(l.nombre) === clave(nombre));
  const deSecciones: FilaDeParte[] = [];
  for (const s of args.secciones) {
    const entera = cupoDe.get(s.id);
    // Una sección que ya entra entera no se «engancha» con una lista del mismo nombre (si la hubiera, esa lista se ve entre las otras partes: no se esconde).
    const lista = entera ? undefined : listaLlamada(s.nombre);
    if (lista) usados.add(lista.id);
    deSecciones.push({
      clave: `S:${s.id}`,
      nombre: s.nombre,
      lugar: { tipo: "SECCION", seccionCartaId: s.id },
      origen: s.id,
      apagada: !s.activa,
      modo: entera ? "TODA" : lista ? "SOLO_ESTOS" : "NO_ENTRA",
      cantidadMinima: entera?.cantidadMinima ?? lista?.cantidadMinima ?? 1,
      cantidadMaxima: entera?.cantidadMaxima ?? lista?.cantidadMaxima ?? 1,
      entradas: lista ? lista.entradas.filter((e) => e.activa) : [],
    });
  }
  const fuera = listaLlamada(NOMBRE_DE_LA_PARTE_FUERA_DE_LA_CARTA);
  if (fuera) usados.add(fuera.id);
  const fueraDeLaCarta: FilaDeParte = {
    clave: `L:${clave(NOMBRE_DE_LA_PARTE_FUERA_DE_LA_CARTA)}`,
    nombre: NOMBRE_DE_LA_PARTE_FUERA_DE_LA_CARTA,
    lugar: { tipo: "LISTA", nombre: fuera?.nombre ?? NOMBRE_DE_LA_PARTE_FUERA_DE_LA_CARTA },
    origen: ORIGEN_FUERA_DE_LA_CARTA,
    apagada: false,
    modo: fuera ? "SOLO_ESTOS" : "NO_ENTRA",
    cantidadMinima: fuera?.cantidadMinima ?? 1,
    cantidadMaxima: fuera?.cantidadMaxima ?? 1,
    entradas: fuera ? fuera.entradas.filter((e) => e.activa) : [],
  };
  const otras: FilaDeParte[] = args.lugares
    .filter((l) => !usados.has(l.id))
    .map((l) => ({
      clave: `L:${clave(l.nombre)}`,
      nombre: l.nombre,
      lugar: { tipo: "LISTA" as const, nombre: l.nombre },
      // Lo que se cargó antes puede tener platos de cualquier origen: el origen de lo nuevo es «no está en la carta».
      origen: ORIGEN_FUERA_DE_LA_CARTA,
      apagada: false,
      modo: "SOLO_ESTOS" as const,
      cantidadMinima: l.cantidadMinima,
      cantidadMaxima: l.cantidadMaxima,
      entradas: l.entradas.filter((e) => e.activa),
    }));
  return { deSecciones, fueraDeLaCarta, otras };
}

/** Los platos de una fila que se pueden tildar de nuevo: los de su origen que todavía no están en la lista (un plato que ya está se saca y se vuelve a sumar para cambiarlo). */
export function platosParaTildar(fila: Pick<FilaDeParte, "origen" | "entradas">, productos: readonly ProductoParaEntrada[]): ProductoParaEntrada[] {
  const yaEsta = new Set(fila.entradas.map((e) => e.productoId));
  return productosDelOrigen(productos, fila.origen).filter((p) => !yaEsta.has(p.productoId));
}

export interface ComandoDeFila {
  lugar: FilaDeParte["lugar"];
  modo: ModoDeFila;
  /** Como texto (lo valida el servidor: el campo de la pantalla entrega texto). */
  cantidadMinima?: string;
  cantidadMaxima?: string;
  entradas?: { productoId: string; modoDeOpciones: "FIJAS" | "A_ELEGIR"; opciones: { opcionId: string; cantidad: number }[] }[];
}

export type ResultadoComandoDeFila = { ok: true; comando: ComandoDeFila } | { ok: false; motivo: string };

/**
 * Lo que se manda a `guardarParteDePromo` por una fila: el modo, las cantidades (como números; «cantidad exacta» = mín. y máx. iguales) y el conjunto FINAL de platos: los que ya estaban y siguen tildados (tal cual se guardaron) más los recién tildados con
 * su configuración (`comandoDeProducto`). Un plato nuevo a medio configurar frena con su motivo; es una comodidad de la pantalla, el servidor vuelve a validar y manda.
 */
export function comandoDeLaFila(args: {
  fila: Pick<FilaDeParte, "lugar" | "entradas">;
  modo: ModoDeFila;
  /** Lo que tiene el campo: «cantidad exacta» = mín. y máx. iguales. */
  cantidadMinima: string;
  cantidadMaxima: string;
  /** Ids de las entradas que ya estaban y se dejan tildadas. */
  mantenidas: ReadonlySet<string>;
  /** Los platos recién tildados: producto y su borrador. */
  nuevos: readonly { producto: ProductoParaEntrada; borrador: BorradorDeProducto }[];
}): ResultadoComandoDeFila {
  if (args.modo === "NO_ENTRA") return { ok: true, comando: { lugar: args.fila.lugar, modo: "NO_ENTRA" } };
  const minimo = args.cantidadMinima.trim();
  const maximo = args.cantidadMaxima.trim();
  // Solo dígitos (1 a 3): lo que el servidor acepta de un campo entero de cantidad; el resto lo decide el servidor.
  const formaValida = /^[0-9]{1,3}$/.test(minimo) && /^[0-9]{1,3}$/.test(maximo);
  if (!formaValida || Number(maximo) < 1 || Number(minimo) > Number(maximo)) {
    return { ok: false, motivo: "Poné una cantidad entera de 1 o más (y, si es un rango, el mínimo no puede pasar al máximo)." };
  }
  const base = { lugar: args.fila.lugar, modo: args.modo, cantidadMinima: minimo, cantidadMaxima: maximo };
  if (args.modo === "TODA") return { ok: true, comando: base };
  const entradas: NonNullable<ComandoDeFila["entradas"]> = args.fila.entradas
    .filter((e) => args.mantenidas.has(e.id))
    .map((e) => ({ productoId: e.productoId, modoDeOpciones: e.modoDeOpciones, opciones: e.opciones.map((o) => ({ opcionId: o.opcionId, cantidad: o.cantidad })) }));
  for (const { producto, borrador } of args.nuevos) {
    const c = comandoDeProducto(producto, borrador);
    if (!c.ok) return { ok: false, motivo: `«${producto.nombreParaMostrar}»: ${c.motivo}` };
    entradas.push({ productoId: producto.productoId, modoDeOpciones: c.modoDeOpciones, opciones: c.opciones });
  }
  if (entradas.length === 0 && Number(minimo) > 0) return { ok: false, motivo: "Tildá al menos un plato: «Solo estos platos» sin ninguno no se puede guardar." };
  return { ok: true, comando: { ...base, entradas } };
}

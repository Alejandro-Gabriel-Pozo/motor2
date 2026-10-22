import { esImporteDeColumna, esPorcentajeDeDiferencia } from "@/core/datos/importe";
import { componerPrecioDeLinea, type OpcionParaPrecio } from "./componer-precio-de-linea";
import {
  CANTIDAD_MAXIMA_DE_OPCION,
  EFECTOS_DE_CONSUMO_DE_OPCION,
  FACTOR_DE_ESCALA_MAXIMO,
  IMPORTE_MINIMO,
  MODOS_DE_PRECIO_DE_MEDIDA,
  TIPOS_DE_DIFERENCIA,
  type DiferenciaDePrecio,
  type EfectoDeConsumoDeOpcion,
  type ModoDePrecioDeMedida,
  type TipoDeGrupoDeOpciones,
} from "./tipos";

/**
 * Las reglas PURAS de la CONFIGURACIÓN del catálogo de opciones de venta (GO-2a): qué grupo, qué opción, qué versión, qué consumos y qué admisión por producto se pueden
 * guardar. Sin base, sin reloj, sin azar: el caso de uso lee lo que haga falta DENTRO de su transacción y le pasa los datos ya resueltos; acá solo se decide, con un código
 * cerrado y un mensaje que se le puede mostrar a quien administra. La forma del resultado es la de `validar-opciones-elegidas.ts`.
 *
 * Son las mismas reglas que la venta aplica después (`validarOpcionesElegidas`, `componerPrecioDeLinea`, `consumoDeLineaConfigurada`) y los CHECK de GO-1, pero ANTES de escribir:
 * la base redondea sin avisar (`numeric(14,2)` guarda 0,005 como 0,01) y un CHECK que falla es un 500, no un mensaje. Lo que ya garantiza un CHECK se repite acá a propósito.
 *
 * Supuestos de GO-2a (ADR-030, «Supuestos de GO-2a»):
 * - D-2: la opción «ninguna» va SOLO en una VARIANTE o en una INCLUIDA (nunca en una MEDIDA, que fija el precio, ni en un ADICIONAL, que es otra línea). Lleva una versión en
 *   MONTO 0 (la foto exige `versionDeOpcionId`), sin factor y sin consumos.
 * - El ADICIONAL lleva un producto ancla; las demás, nunca.
 * - INCLUIDA: su diferencia es siempre MONTO 0 (va dentro del precio sin recargo). ADICIONAL: solo MONTO de 0,01 o más. PORCENTAJE: solo MEDIDA y VARIANTE. Factor: solo MEDIDA.
 * - Consumos: SUMA sin insumo reemplazado, REEMPLAZA con él; un ADICIONAL solo SUMA y nunca escala con la medida; un insumo de la base se reemplaza a lo sumo una vez por
 *   versión; cantidad mayor que 0 con hasta 4 decimales; merma de 0 a 100 con hasta 2. El orden lo da la posición en la lista (0, 1, 2…).
 * - Admisión: cantidades EFECTIVAS (las del producto si las sobrescribe, si no las del grupo) coherentes con el tipo; la MEDIDA con modo de precio obligatorio y, en ABSOLUTO,
 *   un precio absoluto de 0,01 o más en cada opción admitida activa; el mínimo se tiene que poder alcanzar con las opciones activas que el producto admite.
 */

export const CODIGOS_DE_ERROR_DE_CONFIGURACION = [
  "CANTIDADES_INVALIDAS",
  "NINGUNA_NO_PERMITIDA",
  "ANCLA_OBLIGATORIA",
  "ANCLA_NO_PERMITIDA",
  "DIFERENCIA_INVALIDA",
  "FACTOR_INVALIDO",
  "CONSUMO_INVALIDO",
  "MODO_DE_PRECIO_INVALIDO",
  "PRECIO_DE_OPCION_INVALIDO",
  "OPCION_DE_OTRO_GRUPO",
  "OPCION_REPETIDA",
  "MINIMO_INALCANZABLE",
  "PRECIO_DE_LISTA_INVALIDO",
] as const;
export type CodigoDeErrorDeConfiguracion = (typeof CODIGOS_DE_ERROR_DE_CONFIGURACION)[number];

export type ResultadoDeConfiguracion = { ok: true } | { ok: false; codigo: CodigoDeErrorDeConfiguracion; mensaje: string; opcionId?: string };

/** Tope de líneas de consumo de UNA versión de una opción (una opción real tiene 1 a 5). */
export const MAXIMO_CONSUMOS_POR_VERSION = 50;
/** Tope de la merma de un consumo (`ConsumoDeOpcion_merma_chk`: de 0 a 100). */
export const MERMA_MAXIMA_DE_CONSUMO = 100;
/** Tope de una cantidad de consumo (`DECIMAL(14,4)`: 10 dígitos enteros). */
const CANTIDAD_MAXIMA_DE_CONSUMO = 1e10;

const OK: ResultadoDeConfiguracion = { ok: true };

function falla(codigo: CodigoDeErrorDeConfiguracion, mensaje: string, opcionId?: string): ResultadoDeConfiguracion {
  return { ok: false, codigo, mensaje, ...(opcionId === undefined ? {} : { opcionId }) };
}

/** `n` tiene a lo sumo `decimales` decimales (comparado contra su propio redondeo, así 0,07 no falla por ruido binario y 1,005 con 2 se rechaza). */
function conDecimales(n: number, decimales: number): boolean {
  const factor = 10 ** decimales;
  return Math.round(Math.abs(n) * factor) / factor === Math.abs(n);
}

function esEnteroEntre(n: number, minimo: number, maximo: number): boolean {
  return Number.isInteger(n) && n >= minimo && n <= maximo;
}

/**
 * Un monto de `DECIMAL(14,2)` (finito, con hasta 2 decimales y por debajo de 10^12 en valor absoluto; admite negativos) y un porcentaje de `DECIMAL(7,4)` (finito, mayor que
 * -100, hasta 999,9999 y con hasta 4 decimales, `VersionDeOpcion_porcentaje_chk`): son el núcleo de `core/datos/importe.ts` TAL CUAL, sin regla propia (Fase 2, C2; la
 * equivalencia con los de antes la fija `test/core/datos-importe-nucleo.propiedades.test.ts`). Se reexportan con su nombre de siempre para los tests de esta configuración.
 */
export { esImporteDeColumna as esMontoValido, esPorcentajeDeDiferencia as esPorcentajeValido } from "@/core/datos/importe";

/** Un factor de escala de `DECIMAL(8,4)`: mayor que 0, hasta 10 y con hasta 4 decimales (`VersionDeOpcion_factor_chk`). */
export function esFactorValido(f: number): boolean {
  return Number.isFinite(f) && f > 0 && f <= FACTOR_DE_ESCALA_MAXIMO && conDecimales(f, 4);
}

function esDiferenciaBienFormada(d: DiferenciaDePrecio): boolean {
  if (!(TIPOS_DE_DIFERENCIA as readonly string[]).includes(d.tipo)) return false;
  return d.tipo === "MONTO" ? esImporteDeColumna(d.monto) : esPorcentajeDeDiferencia(d.porcentaje);
}

function cuantas(n: number): string {
  return n === 1 ? "1 opción" : `${n} opciones`;
}

// ───────────────────────────── Grupo ─────────────────────────────

export interface DatosDeGrupo {
  tipo: TipoDeGrupoDeOpciones;
  cantidadMinima: number;
  cantidadMaxima: number;
}

/** Las cantidades de un grupo según su tipo (`GrupoDeOpciones_cantidades_chk`, `_medida_chk`, `_incluida_chk`): 0 ≤ mínimo ≤ máximo, máximo de 1 a 10; MEDIDA 1 y 1; INCLUIDA mínimo 1 o más. */
export function validarGrupo(g: DatosDeGrupo): ResultadoDeConfiguracion {
  if (!esEnteroEntre(g.cantidadMaxima, 1, CANTIDAD_MAXIMA_DE_OPCION)) {
    return falla("CANTIDADES_INVALIDAS", `El máximo de opciones del grupo tiene que ser un número entero entre 1 y ${CANTIDAD_MAXIMA_DE_OPCION}.`);
  }
  if (!esEnteroEntre(g.cantidadMinima, 0, g.cantidadMaxima)) {
    return falla("CANTIDADES_INVALIDAS", "El mínimo de opciones del grupo tiene que ser un número entero entre 0 y el máximo.");
  }
  if (g.tipo === "MEDIDA" && (g.cantidadMinima !== 1 || g.cantidadMaxima !== 1)) {
    return falla("CANTIDADES_INVALIDAS", "Un grupo de medida (tamaño, duración) se elige siempre una vez: mínimo 1 y máximo 1.");
  }
  if (g.tipo === "INCLUIDA" && g.cantidadMinima < 1) {
    return falla("CANTIDADES_INVALIDAS", "Un grupo de opciones incluidas es obligatorio: el mínimo tiene que ser 1 o más.");
  }
  return OK;
}

// ───────────────────────────── Opción ─────────────────────────────

export interface DatosDeOpcionNueva {
  tipoDeGrupo: TipoDeGrupoDeOpciones;
  esNinguna: boolean;
  /** Si el alta trae el producto ancla (solo el ADICIONAL lo lleva). */
  conAncla: boolean;
}

/** D-2 y el ancla: la «ninguna» solo en VARIANTE o INCLUIDA; el ADICIONAL con su ancla y las demás sin ella. */
export function validarOpcionNueva(o: DatosDeOpcionNueva): ResultadoDeConfiguracion {
  if (o.esNinguna && o.tipoDeGrupo !== "VARIANTE" && o.tipoDeGrupo !== "INCLUIDA") {
    return falla("NINGUNA_NO_PERMITIDA", "La opción «ninguna» solo va en un grupo de variantes o de opciones incluidas.");
  }
  if (o.tipoDeGrupo === "ADICIONAL" && !o.conAncla) {
    return falla("ANCLA_OBLIGATORIA", "Un adicional se vende en una línea aparte: necesita su producto de respaldo.");
  }
  if (o.tipoDeGrupo !== "ADICIONAL" && o.conAncla) {
    return falla("ANCLA_NO_PERMITIDA", "Solo un adicional lleva producto de respaldo.");
  }
  return OK;
}

// ───────────────────────────── Versión ─────────────────────────────

export interface DatosDePrecioDeVersion {
  diferencia: DiferenciaDePrecio;
  /** Solo MEDIDA; `null` = no escala (equivale a 1). */
  factorEscala: number | null;
}

/** La diferencia y el factor de una versión según el tipo del grupo (y si la opción es la «ninguna»). */
export function validarVersion(tipoDeGrupo: TipoDeGrupoDeOpciones, esNinguna: boolean, v: DatosDePrecioDeVersion): ResultadoDeConfiguracion {
  if (!esDiferenciaBienFormada(v.diferencia)) {
    return falla(
      "DIFERENCIA_INVALIDA",
      v.diferencia.tipo === "PORCENTAJE"
        ? "El porcentaje tiene que ser mayor que -100 y hasta 999,9999, con hasta 4 decimales."
        : "La diferencia de precio tiene que ser un monto con hasta 2 decimales."
    );
  }
  if (v.factorEscala !== null) {
    if (tipoDeGrupo !== "MEDIDA") return falla("FACTOR_INVALIDO", "Solo una medida (tamaño, duración) escala el consumo.");
    if (!esFactorValido(v.factorEscala)) {
      return falla("FACTOR_INVALIDO", `El factor de escala tiene que ser mayor que 0 y hasta ${FACTOR_DE_ESCALA_MAXIMO}, con hasta 4 decimales.`);
    }
  }
  const montoCero = v.diferencia.tipo === "MONTO" && v.diferencia.monto === 0;
  if (esNinguna && !montoCero) return falla("DIFERENCIA_INVALIDA", "La opción «ninguna» no cambia el precio: su diferencia es 0.");
  if (tipoDeGrupo === "INCLUIDA" && !montoCero) return falla("DIFERENCIA_INVALIDA", "Una opción incluida va dentro del precio: su diferencia es 0.");
  // Con esto el PORCENTAJE queda solo para la MEDIDA y la VARIANTE: la INCLUIDA (arriba) y el ADICIONAL (acá) ya lo rechazan.
  if (tipoDeGrupo === "ADICIONAL" && (v.diferencia.tipo !== "MONTO" || v.diferencia.monto < IMPORTE_MINIMO)) {
    return falla("DIFERENCIA_INVALIDA", "Un adicional se cobra con un monto fijo de 0,01 o más.");
  }
  return OK;
}

// ───────────────────────────── Consumos ─────────────────────────────

export interface ConsumoDeConfiguracion {
  efecto: EfectoDeConsumoDeOpcion;
  insumoProductoId: string;
  /** El insumo de la base que reemplaza: obligatorio con REEMPLAZA, `null` con SUMA. */
  reemplazaAProductoId: string | null;
  /** Por unidad vendida, en la unidad de stock del insumo. */
  cantidad: number;
  mermaPorcentaje: number;
  escalaConLaMedida: boolean;
}

/** Los consumos de una versión (`ConsumoDeOpcion_*_chk` y el único del reemplazo por insumo). `indice` del mensaje: la línea, contando desde 1. */
export function validarConsumos(tipoDeGrupo: TipoDeGrupoDeOpciones, esNinguna: boolean, consumos: readonly ConsumoDeConfiguracion[]): ResultadoDeConfiguracion {
  if (consumos.length > MAXIMO_CONSUMOS_POR_VERSION) return falla("CONSUMO_INVALIDO", `Una opción tiene como máximo ${MAXIMO_CONSUMOS_POR_VERSION} líneas de consumo.`);
  if (esNinguna && consumos.length > 0) return falla("CONSUMO_INVALIDO", "La opción «ninguna» no consume nada.");
  const reemplazados = new Set<string>();
  for (const [i, c] of consumos.entries()) {
    const linea = `La línea ${i + 1} del consumo`;
    if (!(EFECTOS_DE_CONSUMO_DE_OPCION as readonly string[]).includes(c.efecto)) return falla("CONSUMO_INVALIDO", `${linea} no dice si suma o reemplaza.`);
    if (c.efecto === "SUMA" && c.reemplazaAProductoId !== null) return falla("CONSUMO_INVALIDO", `${linea} suma un insumo: no reemplaza a otro.`);
    if (c.efecto === "REEMPLAZA" && c.reemplazaAProductoId === null) return falla("CONSUMO_INVALIDO", `${linea} reemplaza un insumo: falta cuál.`);
    if (tipoDeGrupo === "ADICIONAL" && (c.efecto !== "SUMA" || c.escalaConLaMedida)) {
      return falla("CONSUMO_INVALIDO", `${linea}: un adicional solo suma insumos, y no escala con el tamaño.`);
    }
    if (!Number.isFinite(c.cantidad) || c.cantidad <= 0 || c.cantidad >= CANTIDAD_MAXIMA_DE_CONSUMO || !conDecimales(c.cantidad, 4)) {
      return falla("CONSUMO_INVALIDO", `${linea}: la cantidad tiene que ser mayor que 0, con hasta 4 decimales.`);
    }
    if (!Number.isFinite(c.mermaPorcentaje) || c.mermaPorcentaje < 0 || c.mermaPorcentaje > MERMA_MAXIMA_DE_CONSUMO || !conDecimales(c.mermaPorcentaje, 2)) {
      return falla("CONSUMO_INVALIDO", `${linea}: la merma tiene que estar entre 0 y ${MERMA_MAXIMA_DE_CONSUMO}, con hasta 2 decimales.`);
    }
    if (c.reemplazaAProductoId !== null) {
      if (reemplazados.has(c.reemplazaAProductoId)) return falla("CONSUMO_INVALIDO", `${linea} reemplaza un insumo que otra línea ya reemplaza.`);
      reemplazados.add(c.reemplazaAProductoId);
    }
  }
  return OK;
}

/** Lo que una versión fija: la diferencia, el factor y los consumos (en orden). */
export interface ContenidoDeVersion extends DatosDePrecioDeVersion {
  consumos: readonly ConsumoDeConfiguracion[];
}

/**
 * ¿Dos versiones fijan exactamente lo mismo? Sirve para la idempotencia de «agregar una versión»: si la vigente ya es la que se quería crear (la misma diferencia, el mismo
 * factor y los mismos consumos en el mismo orden), repetir el pedido no agrega otra.
 */
export function contenidoDeVersionIgual(a: ContenidoDeVersion, b: ContenidoDeVersion): boolean {
  if (a.diferencia.tipo !== b.diferencia.tipo) return false;
  const valorA = a.diferencia.tipo === "MONTO" ? a.diferencia.monto : a.diferencia.porcentaje;
  const valorB = b.diferencia.tipo === "MONTO" ? b.diferencia.monto : b.diferencia.porcentaje;
  if (valorA !== valorB || a.factorEscala !== b.factorEscala || a.consumos.length !== b.consumos.length) return false;
  return a.consumos.every((c, i) => {
    const d = b.consumos[i]!;
    return (
      c.efecto === d.efecto &&
      c.insumoProductoId === d.insumoProductoId &&
      c.reemplazaAProductoId === d.reemplazaAProductoId &&
      c.cantidad === d.cantidad &&
      c.mermaPorcentaje === d.mermaPorcentaje &&
      c.escalaConLaMedida === d.escalaConLaMedida
    );
  });
}

// ───────────────────────────── Admisión por producto ─────────────────────────────

export interface GrupoParaAdmitir {
  tipo: TipoDeGrupoDeOpciones;
  cantidadMinima: number;
  cantidadMaxima: number;
}

/** Una opción del grupo, tal como está en el catálogo de la empresa. */
export interface OpcionDelGrupo {
  opcionId: string;
  nombre: string;
  activa: boolean;
  esNinguna: boolean;
}

/** La fila de `ProductoAdmiteGrupo` que se quiere dejar (sin `orden` ni `version`, que no entran en las reglas). */
export interface AdmisionDeGrupo {
  /** `null` = la del grupo. */
  cantidadMinima: number | null;
  /** `null` = la del grupo. */
  cantidadMaxima: number | null;
  modoPrecio: ModoDePrecioDeMedida | null;
  activo: boolean;
}

/** Una fila de `ProductoAdmiteOpcion` que se quiere dejar. */
export interface AdmisionDeOpcion {
  opcionId: string;
  cantidadMaxima: number;
  precioAbsoluto: number | null;
  /** `null` = la de la versión vigente de la opción. */
  diferencia: DiferenciaDePrecio | null;
  activo: boolean;
}

export interface EntradaDeAdmision {
  grupo: GrupoParaAdmitir;
  opcionesDelGrupo: readonly OpcionDelGrupo[];
  admision: AdmisionDeGrupo;
  opciones: readonly AdmisionDeOpcion[];
}

/** Las cantidades EFECTIVAS de un grupo en un producto: las del producto si las sobrescribe, si no las del grupo. */
export function cantidadesEfectivas(grupo: GrupoParaAdmitir, admision: Pick<AdmisionDeGrupo, "cantidadMinima" | "cantidadMaxima">): { cantidadMinima: number; cantidadMaxima: number } {
  return { cantidadMinima: admision.cantidadMinima ?? grupo.cantidadMinima, cantidadMaxima: admision.cantidadMaxima ?? grupo.cantidadMaxima };
}

/**
 * Lo que un producto admite de UN grupo: las cantidades efectivas, el modo de precio de la medida, cada opción (del mismo grupo, sin repetir, con su tope y su precio según
 * el tipo) y que el mínimo se pueda alcanzar con las opciones activas que el producto admite (si la admisión queda activa: una admisión apagada no se vende).
 */
export function validarAdmisionDeGrupo(e: EntradaDeAdmision): ResultadoDeConfiguracion {
  const { grupo, admision } = e;
  const tipo = grupo.tipo;

  if (admision.cantidadMinima !== null && !esEnteroEntre(admision.cantidadMinima, 0, CANTIDAD_MAXIMA_DE_OPCION)) {
    return falla("CANTIDADES_INVALIDAS", `El mínimo de este producto tiene que ser un número entero entre 0 y ${CANTIDAD_MAXIMA_DE_OPCION}.`);
  }
  if (admision.cantidadMaxima !== null && !esEnteroEntre(admision.cantidadMaxima, 1, CANTIDAD_MAXIMA_DE_OPCION)) {
    return falla("CANTIDADES_INVALIDAS", `El máximo de este producto tiene que ser un número entero entre 1 y ${CANTIDAD_MAXIMA_DE_OPCION}.`);
  }
  const efectivas = cantidadesEfectivas(grupo, admision);
  const conCantidades = validarGrupo({ tipo, ...efectivas });
  if (!conCantidades.ok) return conCantidades;

  if (admision.modoPrecio !== null && !(MODOS_DE_PRECIO_DE_MEDIDA as readonly string[]).includes(admision.modoPrecio)) {
    return falla("MODO_DE_PRECIO_INVALIDO", "El modo de precio no es válido.");
  }
  if (tipo === "MEDIDA" && admision.modoPrecio === null) return falla("MODO_DE_PRECIO_INVALIDO", "Elegí cómo se cobra la medida en este producto: precio propio o diferencia.");
  if (tipo !== "MEDIDA" && admision.modoPrecio !== null) return falla("MODO_DE_PRECIO_INVALIDO", "Solo una medida (tamaño, duración) tiene modo de precio.");

  const delGrupo = new Map(e.opcionesDelGrupo.map((o) => [o.opcionId, o]));
  const vistas = new Set<string>();
  for (const o of e.opciones) {
    const opcion = delGrupo.get(o.opcionId);
    if (!opcion) return falla("OPCION_DE_OTRO_GRUPO", "Una de las opciones no es de este grupo.", o.opcionId);
    if (vistas.has(o.opcionId)) return falla("OPCION_REPETIDA", `La opción «${opcion.nombre}» está repetida.`, o.opcionId);
    vistas.add(o.opcionId);

    if (!esEnteroEntre(o.cantidadMaxima, 1, CANTIDAD_MAXIMA_DE_OPCION)) {
      return falla("CANTIDADES_INVALIDAS", `El tope de «${opcion.nombre}» tiene que ser un número entero entre 1 y ${CANTIDAD_MAXIMA_DE_OPCION}.`, o.opcionId);
    }
    if (tipo === "MEDIDA" && o.cantidadMaxima !== 1) return falla("CANTIDADES_INVALIDAS", `«${opcion.nombre}» es una medida: se elige una sola vez (tope 1).`, o.opcionId);

    const absoluta = tipo === "MEDIDA" && admision.modoPrecio === "ABSOLUTO";
    if (o.precioAbsoluto !== null && !absoluta) {
      return falla("PRECIO_DE_OPCION_INVALIDO", `«${opcion.nombre}» no lleva precio propio: solo una medida con precio propio lo tiene.`, o.opcionId);
    }
    if (absoluta) {
      if (o.diferencia !== null) return falla("PRECIO_DE_OPCION_INVALIDO", `«${opcion.nombre}» tiene precio propio: no lleva diferencia.`, o.opcionId);
      const precio = o.precioAbsoluto;
      const valido = precio !== null && esImporteDeColumna(precio) && precio >= IMPORTE_MINIMO;
      if (!valido && (o.activo || precio !== null)) {
        return falla("PRECIO_DE_OPCION_INVALIDO", `«${opcion.nombre}» necesita un precio propio de 0,01 o más, con hasta 2 decimales.`, o.opcionId);
      }
    }
    if (o.diferencia !== null) {
      if (!esDiferenciaBienFormada(o.diferencia)) return falla("PRECIO_DE_OPCION_INVALIDO", `La diferencia de precio de «${opcion.nombre}» no es válida.`, o.opcionId);
      if (opcion.esNinguna || tipo === "INCLUIDA") return falla("PRECIO_DE_OPCION_INVALIDO", `«${opcion.nombre}» no cambia el precio: no lleva diferencia.`, o.opcionId);
      if (tipo === "ADICIONAL" && (o.diferencia.tipo !== "MONTO" || o.diferencia.monto < IMPORTE_MINIMO)) {
        return falla("PRECIO_DE_OPCION_INVALIDO", `«${opcion.nombre}» es un adicional: se cobra con un monto fijo de 0,01 o más.`, o.opcionId);
      }
    }
  }

  if (admision.activo) {
    // Por grupo se cuentan UNIDADES (`validarOpcionesElegidas`): el mínimo se alcanza si la suma de los topes de las opciones activas y admitidas llega.
    const alcanzable = e.opciones.filter((o) => o.activo && delGrupo.get(o.opcionId)!.activa).reduce((suma, o) => suma + o.cantidadMaxima, 0);
    if (alcanzable < efectivas.cantidadMinima) {
      return falla(
        "MINIMO_INALCANZABLE",
        `Este producto pide elegir al menos ${cuantas(efectivas.cantidadMinima)} del grupo, y con las opciones activas que admite no se llega.`
      );
    }
  }
  return OK;
}

// ───────────────────────────── Precio de lista ─────────────────────────────

/** Una opción admitida con su diferencia YA resuelta (la del producto si la sobrescribe, si no la de la versión vigente). */
export interface OpcionParaControlDePrecio {
  opcionId: string;
  nombre: string;
  /** La versión vigente (la foto la necesita; acá solo viaja). */
  versionDeOpcionId: string;
  factorEscala: number | null;
  precioAbsoluto: number | null;
  diferencia: DiferenciaDePrecio | null;
}

/**
 * El control de precio de lista de una admisión: cada opción, elegida SOLA sobre el precio de venta del producto, tiene que dar un precio de lista de 0,01 o más (o un recargo
 * válido, si es un adicional). Es la misma cuenta que hará la venta (`componerPrecioDeLinea`); se adelanta para que el producto no quede con una opción que no se puede vender.
 * El precio de la sucursal puede ser otro: la venta igual falla cerrado si allá no da.
 */
export function controlarPrecioDeLista(
  tipo: TipoDeGrupoDeOpciones,
  modoPrecio: ModoDePrecioDeMedida | null,
  precioDeVenta: number,
  opciones: readonly OpcionParaControlDePrecio[]
): ResultadoDeConfiguracion {
  for (const o of opciones) {
    const paraPrecio: OpcionParaPrecio = {
      opcionId: o.opcionId,
      versionDeOpcionId: o.versionDeOpcionId,
      nombre: o.nombre,
      tipo,
      cantidad: 1,
      factorEscala: tipo === "MEDIDA" ? o.factorEscala : null,
      modoPrecio: tipo === "MEDIDA" ? modoPrecio : null,
      precioAbsoluto: tipo === "MEDIDA" ? o.precioAbsoluto : null,
      // La INCLUIDA y la «ninguna» van con diferencia 0 o sin ella; el compositor rechaza una distinta de 0.
      diferencia: o.diferencia,
    };
    const r = componerPrecioDeLinea({ precioBase: precioDeVenta, cantidad: 1, opciones: [paraPrecio] });
    if (!r.ok) return falla("PRECIO_DE_LISTA_INVALIDO", `Con «${o.nombre}» este producto no se puede vender: ${r.mensaje}`, o.opcionId);
  }
  return OK;
}

// ───────────────────────────── Antes y después ─────────────────────────────

export interface CambioDeColumna<K extends string> {
  campo: K;
  antes: string | number | boolean | null;
  despues: string | number | boolean | null;
}

/**
 * De la tabla de columnas de una edición (`[{ campo: "nombre", antes, despues }, …]`, escrita como literal en el caso de uso para que el guardián `auditoria-por-columna` vea cada
 * columna), las que CAMBIAN: el antes y el después de la auditoría por columna. `null` y `undefined` son «sin valor»; un número se compara exacto (los decimales de la base ya vienen
 * convertidos a `number` en el borde). Lista vacía = no cambió nada: no se escribe, no se sube la versión y no queda fila de auditoría.
 */
export function cambiosPorColumna<K extends string>(tabla: readonly CambioDeColumna<K>[]): CambioDeColumna<K>[] {
  return tabla.map((c) => ({ campo: c.campo, antes: c.antes ?? null, despues: c.despues ?? null })).filter((c) => c.antes !== c.despues);
}

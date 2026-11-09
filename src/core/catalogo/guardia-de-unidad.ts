import { PARES_DE_UNIDADES, formatear } from "./lectura-de-cantidad";

/**
 * Guardia de unidad de las recetas (`docs/diseno-guardia-de-unidad-receta-2026-11-09.md`, pedida por el dueño el 2026-11-09). La receta se carga SIEMPRE en la unidad de STOCK de la materia prima
 * (U7 / D3): quien escribe 100 pensando en gramos para un insumo con stock en kg deja «100 kg por unidad vendida». Esta guardia de PLAUSIBILIDAD (no un tope duro: se puede confirmar) rechaza el
 * guardado cuando la cantidad de un ingrediente por unidad vendida es desproporcionada para su unidad de stock, mostrando la equivalencia. PURO: sin base, sin reloj, sin React.
 */

/**
 * Umbrales de «desproporcionada», POR MAGNITUD de la unidad de stock, en la unidad MAYOR de la magnitud (kg, l, unidad): una cantidad IGUAL O MAYOR por unidad vendida es desproporcionada
 * (PROPUESTA del dueño a corregir mirando las capturas: 5 kg o 5 l; 50 unidades). Es el único lugar donde viven: ajustar acá. Una magnitud que no figura (una nueva) no se juzga; el test
 * guardián (`test/catalogo/guardia-de-unidad.test.ts`) falla si aparece una magnitud sin declarar.
 */
export const UMBRALES_DE_CANTIDAD: Readonly<Record<string, number>> = {
  PESO: 5,
  VOLUMEN: 5,
  CANTIDAD: 50,
};

/** Lo que la guardia necesita saber de la unidad de stock del ingrediente (`Unidad.nombre` y `Unidad.magnitud`). */
export interface UnidadParaGuardia {
  nombre: string;
  magnitud: string;
}

const clave = (nombre: string) => nombre.trim().toLowerCase();

/**
 * El umbral de una unidad de stock, o `null` si su magnitud no está declarada. Si la unidad es la MENOR de un par sembrado («g» de «kg», «ml» de «l»: mismo criterio que la lectura en vivo) el
 * umbral se multiplica por su factor (5000 g, 5000 ml): el mismo peso en gramos no tiene que dar falso positivo.
 */
export function umbralDeCantidad(unidad: UnidadParaGuardia): number | null {
  const base = UMBRALES_DE_CANTIDAD[unidad.magnitud];
  if (base === undefined) return null;
  const esMenor = PARES_DE_UNIDADES.find((p) => p.menor === clave(unidad.nombre) && p.magnitud === unidad.magnitud);
  return esMenor ? base * esMenor.factor : base;
}

/** ¿La cantidad (ya válida: finita y mayor que 0) por unidad vendida es desproporcionada para esta unidad de stock? Justo en el umbral cuenta como desproporcionada. */
export function esCantidadDesproporcionada(cantidad: number, unidad: UnidadParaGuardia): boolean {
  const umbral = umbralDeCantidad(unidad);
  return umbral !== null && cantidad >= umbral;
}

/** «unidad» en plural cuando corresponde (la unidad sembrada de la magnitud CANTIDAD); el resto de los nombres va tal cual, como están en el catálogo. */
function unidadEnTexto(cantidad: number, nombre: string): string {
  return clave(nombre) === "unidad" && cantidad !== 1 ? "unidades" : nombre;
}

/**
 * El mensaje de la guardia, con la equivalencia. En kg o l agrega la pista de «querías gramos / mililitros» (0,1 en kg son 100 g); en las demás unidades (g, ml, unidades…) no hay una
 * unidad menor para sugerir y solo pide confirmar.
 */
export function mensajeDeCantidadDesproporcionada(datos: { cantidad: number; unidad: UnidadParaGuardia; insumo: string; producto: string }): string {
  const { cantidad, unidad, insumo, producto } = datos;
  const dicho = `${formatear(cantidad)} ${unidadEnTexto(cantidad, unidad.nombre)}`;
  const descuenta = `Esto descuenta ${dicho} de ${insumo} por cada unidad vendida de ${producto}.`;
  const par = PARES_DE_UNIDADES.find((p) => p.mayor === clave(unidad.nombre) && p.magnitud === unidad.magnitud);
  if (!par) return `${descuenta} Si de verdad es así, confirmalo.`;
  return `${descuenta} Si querías ${formatear(cantidad)} ${par.menorEnPalabras}, escribí ${formatear(cantidad / par.factor)} (la receta se carga en ${unidad.nombre}). Si de verdad es ${dicho}, confirmalo.`;
}

/** Un ingrediente a juzgar: lo que la guardia mira de cada línea que llega. */
export interface IngredienteParaGuardia {
  insumoProductoId: string;
  cantidad: number;
  unidadId: string;
}

/** Cómo estaba cada ingrediente en la versión vigente de la serie (por `insumoProductoId`): para juzgar solo lo nuevo o cambiado. */
export type IngredientesVigentesParaGuardia = ReadonlyMap<string, { cantidad: number; unidadId: string }>;

export interface DatosParaGuardiaDeUnidad {
  items: readonly IngredienteParaGuardia[];
  /** El producto de la receta: una receta «Se produce» no se juzga (tandas con cantidades grandes legítimas). */
  producto: { nombre: string; seProduce: boolean };
  /** Los ingredientes de la versión vigente de la serie donde se guarda (vacío si no hay). */
  vigentes: IngredientesVigentesParaGuardia;
  /** Las materias primas de los ingredientes, por id, con su unidad de stock. */
  productos: ReadonlyMap<string, { nombre: string; unidadStockId: string }>;
  /** Las unidades de stock, por id. */
  unidades: ReadonlyMap<string, UnidadParaGuardia>;
  /** La confirmación explícita que viajó con el pedido: solo un `true` estricto confirma. */
  confirmada: unknown;
  /** Rutas de carga en bloque o de copia de lo ya aceptado (ver el diseño, R5): no se juzga nada. */
  omitir: boolean;
}

/**
 * El mensaje de la guardia para el pedido, o `null` si pasa. Se juzgan los ingredientes NUEVOS o con la cantidad o la unidad CAMBIADA respecto de la versión vigente (lo ya guardado no se
 * re-juzga); el primero desproporcionado da el mensaje. Una receta «Se produce», una ruta que omite la guardia o una confirmación estricta (`true`) la dejan pasar.
 */
export function juzgarCantidadesDeIngredientes(datos: DatosParaGuardiaDeUnidad): string | null {
  if (datos.omitir || datos.producto.seProduce || datos.confirmada === true) return null;
  for (const item of datos.items) {
    const anterior = datos.vigentes.get(item.insumoProductoId);
    if (anterior && anterior.cantidad === item.cantidad && anterior.unidadId === item.unidadId) continue;
    const mp = datos.productos.get(item.insumoProductoId);
    const unidad = mp ? datos.unidades.get(mp.unidadStockId) : undefined;
    if (!mp || !unidad) continue; // lo reportan `validarIngredientes` y `validarUnidadDeIngredientes`, antes.
    if (esCantidadDesproporcionada(item.cantidad, unidad)) {
      return mensajeDeCantidadDesproporcionada({ cantidad: item.cantidad, unidad, insumo: mp.nombre, producto: datos.producto.nombre });
    }
  }
  return null;
}

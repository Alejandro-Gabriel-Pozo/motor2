import { rechazoSinOrigenDeStock } from "@/core/movimientos/public";

/**
 * ¿Un producto puede ser COMPONENTE de un combo o un plato del día? (GO-3b, ADR-032: D-8 y D-9 del dueño). Puro: lo mismo se pregunta al CARGARLO (una entrada de una lista, un plato del día)
 * y otra vez al VENDER (por si algo cambió entre medio: la receta se desactivó, el precio se borró). Un componente es:
 *  - un producto de venta (PV), que no se vende solo como adicional de otro (el ancla de un adicional no entra a un combo: no tiene receta propia ni precio de lista);
 *  - con PRECIO DE REFERENCIA de $ 0,01 o más (D-8): el prorrateo reparte el precio del combo en proporción al precio de lista de cada unidad, así que sin precio no hay con qué repartir
 *    (`COMPONENTE_SIN_PRECIO_DE_REFERENCIA`), aunque el producto no se venda suelto;
 *  - con ORIGEN DE STOCK (D-9 y ADR-033): receta vigente en la sucursal con algún ingrediente, o stock propio (`seProduce`), o —con configuración fija— opciones que descuentan algún insumo. Si no, `COMPONENTE_SIN_RECETA`, con un mensaje que nombra el producto
 *    y manda a Catálogo → Recetas: para cocinar algo nuevo se da de alta el PV y se arma su receta.
 * El orden de los chequeos es ese (el primero que falla gana).
 */

/** El precio de referencia mínimo: el piso de $ 0,01 por unidad del prorrateo. */
const PRECIO_DE_REFERENCIA_MINIMO = 0.01;

export type CodigoDeComponenteDeCombo = "PRODUCTO_INVALIDO" | "COMPONENTE_SIN_PRECIO_DE_REFERENCIA" | "COMPONENTE_SIN_RECETA";

export interface ProductoComoComponente {
  nombre: string;
  /** `Producto.tipo` (PV, MP…). */
  tipo: string;
  /** ¿Es el producto ancla de algún adicional? */
  esAnclaDeAdicional: boolean;
  /** El precio de lista con que pesa en el prorrateo: el de la sucursal si la venta lo resuelve así, o el de la empresa al cargar una entrada de la lista; con configuración fija, la lista compuesta. */
  precioDeReferencia: number;
  seProduce: boolean;
  /** Ingredientes de la receta vigente en la sucursal (0 = sin receta). */
  ingredientesDeLaRecetaVigente: number;
  /**
   * Solo en una entrada con CONFIGURACIÓN FIJA («Gaseosa · Coca»): lo que esas opciones descuentan sin la receta de la base (`LineaConfigurada.insumosSinLaBase`) y sus nombres. Con la base sin receta,
   * el componente vale si las opciones suman algún insumo (ventas con opciones, 2026-10-29). Ausente = la regla de siempre.
   */
  opcionesQueDescuentan?: { insumos: number; nombres: readonly string[] };
}

export type RechazoDeComponente = { codigo: CodigoDeComponenteDeCombo; mensaje: string };

/** El mensaje de un componente sin receta: nombra el producto y dice dónde se arregla. */
function mensajeComponenteSinReceta(nombre: string): string {
  return `«${nombre}» no tiene receta: armala en Catálogo → Recetas para poder sumarlo al menú o al combo.`;
}

/** Por qué el producto NO puede ser componente de un combo (el primero de los chequeos que falla), o `null` si puede. */
export function rechazoDeComponenteDeCombo(p: ProductoComoComponente): RechazoDeComponente | null {
  if (p.tipo !== "PV") return { codigo: "PRODUCTO_INVALIDO", mensaje: `«${p.nombre}» no puede entrar a un combo: solo productos de venta (PV).` };
  if (p.esAnclaDeAdicional) return { codigo: "PRODUCTO_INVALIDO", mensaje: `«${p.nombre}» se vende solo como adicional de otro producto: no puede entrar a un combo.` };
  if (!Number.isFinite(p.precioDeReferencia) || p.precioDeReferencia < PRECIO_DE_REFERENCIA_MINIMO) {
    return {
      codigo: "COMPONENTE_SIN_PRECIO_DE_REFERENCIA",
      mensaje: `«${p.nombre}» no tiene precio de venta: cargale uno en Catálogo (aunque no se venda suelto), así el combo puede repartir su precio.`,
    };
  }
  const sinReceta = rechazoSinOrigenDeStock({
    nombre: p.nombre,
    seProduce: p.seProduce,
    esAnclaDeAdicional: false,
    ingredientesDeLaRecetaVigente: p.ingredientesDeLaRecetaVigente,
    ...(p.opcionesQueDescuentan ? { opciones: p.opcionesQueDescuentan } : {}),
  });
  // Con opciones elegidas el mensaje de la regla ya nombra la opción que falta completar; sin ellas, el de siempre.
  if (sinReceta !== null) return { codigo: "COMPONENTE_SIN_RECETA", mensaje: p.opcionesQueDescuentan && p.opcionesQueDescuentan.nombres.length > 0 ? sinReceta : mensajeComponenteSinReceta(p.nombre) };
  return null;
}

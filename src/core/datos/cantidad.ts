import { numeroDeEntrada, tieneALoSumoDecimales } from "./numero-tecleado";
import { aceptar, enMinuscula, rechazar, type ResultadoDato } from "./resultado";

/** Tope de las columnas `Decimal(14,4)` de cantidades: la cantidad tiene que ser menor. */
export const CANTIDAD_MAXIMA = 1e10;

/** Lo que hace falta de la unidad (`Unidad.nombre` y `Unidad.decimales`, entero de 0 a 6). */
export interface UnidadDeCantidad {
  nombre: string;
  decimales: number;
}

export interface OpcionesCantidad {
  /** Sujeto del mensaje, en mayúscula ("La cantidad", `El peso real de "Harina"`). Los mensajes no dependen del género. */
  etiqueta: string;
  /** Vacío → error "Falta …" en vez de `null`. Default: false. */
  obligatorio?: boolean;
  /** Default: false. */
  permitirNegativo?: boolean;
  /** Default: false (una cantidad en 0 no mueve nada). */
  permitirCero?: boolean;
}

/**
 * Cantidad de ENTRADA en una unidad: tiene que respetar los decimales de ESA unidad (se rechaza, no se redondea: 2,5 en una unidad
 * entera es un error de carga, no un 3). El redondeo de lo CALCULADO (una conversión de unidades) sigue siendo
 * `redondearACantidadDeUnidad`.
 */
export function validarCantidad(valor: unknown, unidad: UnidadDeCantidad, opciones: OpcionesCantidad): ResultadoDato<number | null> {
  const { etiqueta, obligatorio = false, permitirNegativo = false, permitirCero = false } = opciones;
  const numero = numeroDeEntrada(valor);
  if (!numero.ok) return rechazar("formato", `${etiqueta} no es un número válido.`);
  const n = numero.valor;
  if (n === null) return obligatorio ? rechazar("vacio", `Falta ${enMinuscula(etiqueta)}.`) : aceptar(null);
  if (n < 0 && !permitirNegativo) {
    return rechazar("negativo", permitirCero ? `${etiqueta} no puede ser menor que cero.` : `${etiqueta} tiene que ser mayor que cero.`);
  }
  if (n === 0 && !permitirCero) return rechazar("cero", `${etiqueta} tiene que ser mayor que cero.`);
  if (Math.abs(n) >= CANTIDAD_MAXIMA) return rechazar("rango", `${etiqueta} es demasiado grande.`);
  if (!tieneALoSumoDecimales(n, unidad.decimales)) {
    // Sin nombre de unidad (la pantalla no siempre la conoce), el mensaje no la menciona.
    const nombre = unidad.nombre.trim();
    return rechazar(
      "decimales",
      unidad.decimales === 0
        ? `${etiqueta} tiene que ser un número entero${nombre ? ` (la unidad "${nombre}" no admite decimales)` : ""}.`
        : `${etiqueta} admite como máximo ${unidad.decimales} decimales${nombre ? ` (unidad "${nombre}")` : ""}.`
    );
  }
  return aceptar(n);
}

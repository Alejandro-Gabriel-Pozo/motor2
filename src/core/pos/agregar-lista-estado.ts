import { CONTEXTO_CANTIDAD_SIN_UNIDAD, interpretarNumeroTecleado, textoParaEscribir } from "@/core/datos/numero-tecleado";
import { CANTIDAD_MAXIMA_POR_ITEM, validarCantidadPedido } from "./cantidad-pedido";

/**
 * Lista «Por agregar» de `AgregarItems` (docs/plan-pos-agregar-varios-2026-09-26.md): reductor PURO, testeable en Vitest sin DOM
 * (test/pos/agregar-lista-estado.test.ts) — nunca toca el servidor. Tocar un producto en la grilla de carta o elegirlo en el
 * buscador lo SUMA acá (cantidad 1, o +1 si ya estaba); recién al confirmar (`AgregarItems`) se manda todo junto en un solo
 * `agregarItems(cuentaId, líneas)`. Es un estado NUEVO y separado del de `selector-carta-estado.ts` (que sigue manejando qué
 * sección/agrupado/carpeta está a la vista): coexisten, no se reemplazan.
 *
 * Cada línea guarda el texto crudo que se ve en el campo (`cantidadTexto`, tal cual se tipea) y la cantidad vigente para el
 * subtotal (`cantidad`, la última interpretación válida). Al SALIR del campo (`normalizarCantidad`) se vuelve a interpretar con el
 * MISMO parser que usa el resto del proyecto (`interpretarNumeroTecleado`, nunca `Number(...)` a secas) y se normaliza con la MISMA función
 * que usará el servidor al confirmar (`validarCantidadPedido`, de `cantidad-pedido.ts`): así lo que se ve en el campo después de
 * salir es EXACTAMENTE lo que se va a guardar (ej.: "1,4" en una unidad entera queda en "1", mostrado, no oculto) — o, si no es una
 * cantidad válida, el mensaje que lo explica (bloquea confirmar hasta corregirlo, `puedeConfirmarListaPorAgregar`).
 */

export interface LineaPorAgregar {
  productoId: string;
  /** Lo que se ve en el campo: crudo mientras se tipea, con la coma como decimal (`textoParaEscribir`) después de normalizar. */
  cantidadTexto: string;
  /** La cantidad vigente para el subtotal en pantalla: la última interpretación positiva de `cantidadTexto` (puede no ser todavía
   *  la normalizada del servidor — eso pasa en `normalizarCantidad`, al salir del campo). */
  cantidad: number;
  /** Mensaje de `validarCantidadPedido` (o del parser) si `cantidadTexto` no es una cantidad válida; bloquea confirmar. */
  error: string | null;
  /**
   * GO-2d: SOLO en una línea de un producto con opciones, la clave de su configuración (`claveDeConfiguracion`: el producto y lo elegido) y lo elegido, tal cual se pide. Cada
   * configuración es su propia línea; la misma se acumula. Ausentes = la línea de siempre (un producto sin opciones, identificado por `productoId`).
   */
  clave?: string;
  opciones?: { opcionId: string; cantidad: number; versionDeOpcionId: string }[];
}

export interface EstadoListaPorAgregar {
  lineas: LineaPorAgregar[];
}

export type AccionListaPorAgregar =
  /** `tope`: MAXIMO_ITEMS_POR_AGREGADO, para no duplicar la constante en el reductor (viaja en la acción, no como parámetro extra —
   *  `useReducer` solo llama al reductor con `(estado, acción)`). */
  | { tipo: "sumarProducto"; productoId: string; tope: number }
  | { tipo: "incrementar"; productoId: string; clave?: string }
  | { tipo: "decrementar"; productoId: string; clave?: string }
  | { tipo: "cambiarCantidadTexto"; productoId: string; texto: string; clave?: string }
  /** `pasoVenta`/`tieneStockReal` (Task #25, docs/plan-venta-fraccionada-2026-09-26.md): OPCIONALES — sin `pasoVenta` (o `null`), el
   *  comportamiento es IDÉNTICO al de siempre (redondea a `decimales`). Con `pasoVenta`, `validarCantidadPedido` rechaza lo que no
   *  sea un múltiplo exacto en vez de redondear. */
  | { tipo: "normalizarCantidad"; productoId: string; decimales: number; pasoVenta?: number | null; tieneStockReal?: boolean; clave?: string }
  /** GO-2d: suma una CONFIGURACIÓN de un producto con opciones (desde el diálogo «Elegir opciones» o «Otro igual»): a su línea si ya está, si no una línea nueva. */
  | { tipo: "sumarConfiguracion"; productoId: string; clave: string; opciones: { opcionId: string; cantidad: number; versionDeOpcionId: string }[]; cantidad: number; tope: number }
  | { tipo: "quitarLinea"; productoId: string; clave?: string }
  | { tipo: "vaciar" };

/**
 * El contexto de lo que el mozo teclea: el máximo de decimales (4), no los de la unidad. Así «2.000» no se adivina (ambiguo: error) y «1,4» en una unidad entera sigue llegando a
 * `validarCantidadPedido`, que lo MUESTRA redondeado a 1 (el comportamiento de siempre: nunca un redondeo oculto) en vez de rechazarlo.
 */
const CONTEXTO_POS = CONTEXTO_CANTIDAD_SIN_UNIDAD;

export function estadoInicialListaPorAgregar(): EstadoListaPorAgregar {
  return { lineas: [] };
}

/** true si ya hay una línea para ese producto (tocarlo de nuevo lo ACUMULA en la misma línea, nunca abre una segunda). */
export function estaEnListaPorAgregar(estado: EstadoListaPorAgregar, productoId: string): boolean {
  return estado.lineas.some((l) => l.productoId === productoId);
}

/** Tope de PRODUCTOS DISTINTOS (`MAXIMO_ITEMS_POR_AGREGADO`, el mismo del servidor): sumar uno que ya está en la lista SIEMPRE se
 *  puede (se acumula en su línea), así que en la práctica casi nunca se llega acá. */
export function listaPorAgregarLlena(estado: EstadoListaPorAgregar, tope: number): boolean {
  return estado.lineas.length >= tope;
}

/** Puede confirmarse: al menos una línea y ninguna con la cantidad todavía inválida. */
export function puedeConfirmarListaPorAgregar(estado: EstadoListaPorAgregar): boolean {
  return estado.lineas.length > 0 && estado.lineas.every((l) => l.error === null);
}

/** Lo que se manda a `agregarItems`: un `{ productoId, cantidad }` por línea, en el orden en que se agregaron (GO-2d: con sus `opciones`, solo si las tiene). */
export function itemsDeListaPorAgregar(estado: EstadoListaPorAgregar): { productoId: string; cantidad: number; opciones?: { opcionId: string; cantidad: number; versionDeOpcionId: string }[] }[] {
  return estado.lineas.map((l) => (l.opciones ? { productoId: l.productoId, cantidad: l.cantidad, opciones: l.opciones } : { productoId: l.productoId, cantidad: l.cantidad }));
}

/**
 * GO-2d: si una línea es la que nombra una acción. Con `clave`, la línea de esa configuración; sin ella, la línea de SIEMPRE del producto (la que no tiene opciones). Sin líneas con
 * opciones, es exactamente la comparación por `productoId` de antes.
 */
function esLaLinea(l: LineaPorAgregar, accion: { productoId: string; clave?: string }): boolean {
  return accion.clave !== undefined ? l.clave === accion.clave : l.clave === undefined && l.productoId === accion.productoId;
}

function conCantidad(linea: LineaPorAgregar, cantidad: number): LineaPorAgregar {
  const redondeada = Math.round(cantidad * 10_000) / 10_000; // mismo ruido de coma flotante que `redondearCantidad` en core/pos/cuenta.ts
  return { ...linea, cantidad: redondeada, cantidadTexto: textoParaEscribir(redondeada), error: null };
}

export function reducirListaPorAgregar(estado: EstadoListaPorAgregar, accion: AccionListaPorAgregar): EstadoListaPorAgregar {
  switch (accion.tipo) {
    case "sumarProducto": {
      const existente = estado.lineas.find((l) => esLaLinea(l, accion));
      if (existente) {
        const nueva = Math.min(existente.cantidad + 1, CANTIDAD_MAXIMA_POR_ITEM);
        return { lineas: estado.lineas.map((l) => (esLaLinea(l, accion) ? conCantidad(l, nueva) : l)) };
      }
      if (estado.lineas.length >= accion.tope) return estado; // defensivo: la UI ya deshabilita sumar un producto NUEVO en el tope
      return { lineas: [...estado.lineas, { productoId: accion.productoId, cantidad: 1, cantidadTexto: "1", error: null }] };
    }
    case "incrementar":
      return {
        lineas: estado.lineas.map((l) => (esLaLinea(l, accion) ? conCantidad(l, Math.min(l.cantidad + 1, CANTIDAD_MAXIMA_POR_ITEM)) : l)),
      };
    case "decrementar": {
      const linea = estado.lineas.find((l) => esLaLinea(l, accion));
      if (!linea) return estado;
      if (linea.cantidad - 1 <= 0) return { lineas: estado.lineas.filter((l) => !esLaLinea(l, accion)) };
      return { lineas: estado.lineas.map((l) => (esLaLinea(l, accion) ? conCantidad(l, l.cantidad - 1) : l)) };
    }
    case "cambiarCantidadTexto":
      return {
        lineas: estado.lineas.map((l) => {
          if (!esLaLinea(l, accion)) return l;
          // Mientras se tipea no se marca error (un "," o un campo vacío a medio tipear no tienen por qué romper nada): el
          // subtotal sigue con la última cantidad válida hasta que el mozo termine de escribir (`normalizarCantidad`, al blur).
          const r = interpretarNumeroTecleado(accion.texto, CONTEXTO_POS);
          const candidata = r.ok && r.valor !== null && r.valor > 0 ? r.valor : l.cantidad;
          return { ...l, cantidadTexto: accion.texto, cantidad: candidata };
        }),
      };
    case "normalizarCantidad":
      return {
        lineas: estado.lineas.map((l) => {
          if (!esLaLinea(l, accion)) return l;
          const r = interpretarNumeroTecleado(l.cantidadTexto, CONTEXTO_POS);
          if (!r.ok) return { ...l, error: r.mensaje };
          if (r.valor === null) return { ...l, error: "La cantidad tiene que ser un número mayor que cero." };
          const paso = accion.pasoVenta != null ? { pasoVenta: accion.pasoVenta, tieneStockReal: Boolean(accion.tieneStockReal) } : null;
          const v = validarCantidadPedido(r.valor, accion.decimales, paso);
          if (!v.ok) return { ...l, error: v.mensaje };
          // Se ve EXACTAMENTE lo que se va a guardar (ej. "1,4" en una unidad entera queda mostrado como "1"): nunca un redondeo
          // silencioso, ver docstring del módulo.
          return { ...l, cantidad: v.cantidad, cantidadTexto: textoParaEscribir(v.cantidad), error: null };
        }),
      };
    case "quitarLinea":
      return { lineas: estado.lineas.filter((l) => !esLaLinea(l, accion)) };
    case "sumarConfiguracion": {
      const existente = estado.lineas.find((l) => l.clave === accion.clave);
      if (existente) return { lineas: estado.lineas.map((l) => (l.clave === accion.clave ? conCantidad(l, Math.min(l.cantidad + accion.cantidad, CANTIDAD_MAXIMA_POR_ITEM)) : l)) };
      if (estado.lineas.length >= accion.tope) return estado; // defensivo: la UI ya deshabilita sumar una línea NUEVA en el tope
      const cantidad = Math.min(accion.cantidad, CANTIDAD_MAXIMA_POR_ITEM);
      return { lineas: [...estado.lineas, { productoId: accion.productoId, cantidad, cantidadTexto: textoParaEscribir(cantidad), error: null, clave: accion.clave, opciones: accion.opciones.map((o) => ({ ...o })) }] };
    }
    case "vaciar":
      return { lineas: [] };
  }
}

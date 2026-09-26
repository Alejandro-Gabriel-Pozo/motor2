import { interpretarNumero, textoCanonico } from "@/core/datos/numero-tecleado";
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
 * MISMO parser que usa el resto del proyecto (`interpretarNumero`, nunca `Number(...)` a secas) y se normaliza con la MISMA función
 * que usará el servidor al confirmar (`validarCantidadPedido`, de `cantidad-pedido.ts`): así lo que se ve en el campo después de
 * salir es EXACTAMENTE lo que se va a guardar (ej.: "1,4" en una unidad entera queda en "1", mostrado, no oculto) — o, si no es una
 * cantidad válida, el mensaje que lo explica (bloquea confirmar hasta corregirlo, `puedeConfirmarListaPorAgregar`).
 */

export interface LineaPorAgregar {
  productoId: string;
  /** Lo que se ve en el campo: crudo mientras se tipea, canónico (`textoCanonico`) después de normalizar. */
  cantidadTexto: string;
  /** La cantidad vigente para el subtotal en pantalla: la última interpretación positiva de `cantidadTexto` (puede no ser todavía
   *  la normalizada del servidor — eso pasa en `normalizarCantidad`, al salir del campo). */
  cantidad: number;
  /** Mensaje de `validarCantidadPedido` (o del parser) si `cantidadTexto` no es una cantidad válida; bloquea confirmar. */
  error: string | null;
}

export interface EstadoListaPorAgregar {
  lineas: LineaPorAgregar[];
}

export type AccionListaPorAgregar =
  /** `tope`: MAXIMO_ITEMS_POR_AGREGADO, para no duplicar la constante en el reductor (viaja en la acción, no como parámetro extra —
   *  `useReducer` solo llama al reductor con `(estado, acción)`). */
  | { tipo: "sumarProducto"; productoId: string; tope: number }
  | { tipo: "incrementar"; productoId: string }
  | { tipo: "decrementar"; productoId: string }
  | { tipo: "cambiarCantidadTexto"; productoId: string; texto: string }
  | { tipo: "normalizarCantidad"; productoId: string; decimales: number }
  | { tipo: "quitarLinea"; productoId: string }
  | { tipo: "vaciar" };

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

/** Lo que se manda a `agregarItems`: un `{ productoId, cantidad }` por línea, en el orden en que se agregaron. */
export function itemsDeListaPorAgregar(estado: EstadoListaPorAgregar): { productoId: string; cantidad: number }[] {
  return estado.lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad }));
}

function conCantidad(linea: LineaPorAgregar, cantidad: number): LineaPorAgregar {
  const redondeada = Math.round(cantidad * 10_000) / 10_000; // mismo ruido de coma flotante que `redondearCantidad` en core/pos/cuenta.ts
  return { ...linea, cantidad: redondeada, cantidadTexto: textoCanonico(redondeada), error: null };
}

export function reducirListaPorAgregar(estado: EstadoListaPorAgregar, accion: AccionListaPorAgregar): EstadoListaPorAgregar {
  switch (accion.tipo) {
    case "sumarProducto": {
      const existente = estado.lineas.find((l) => l.productoId === accion.productoId);
      if (existente) {
        const nueva = Math.min(existente.cantidad + 1, CANTIDAD_MAXIMA_POR_ITEM);
        return { lineas: estado.lineas.map((l) => (l.productoId === accion.productoId ? conCantidad(l, nueva) : l)) };
      }
      if (estado.lineas.length >= accion.tope) return estado; // defensivo: la UI ya deshabilita sumar un producto NUEVO en el tope
      return { lineas: [...estado.lineas, { productoId: accion.productoId, cantidad: 1, cantidadTexto: "1", error: null }] };
    }
    case "incrementar":
      return {
        lineas: estado.lineas.map((l) => (l.productoId === accion.productoId ? conCantidad(l, Math.min(l.cantidad + 1, CANTIDAD_MAXIMA_POR_ITEM)) : l)),
      };
    case "decrementar": {
      const linea = estado.lineas.find((l) => l.productoId === accion.productoId);
      if (!linea) return estado;
      if (linea.cantidad - 1 <= 0) return { lineas: estado.lineas.filter((l) => l.productoId !== accion.productoId) };
      return { lineas: estado.lineas.map((l) => (l.productoId === accion.productoId ? conCantidad(l, l.cantidad - 1) : l)) };
    }
    case "cambiarCantidadTexto":
      return {
        lineas: estado.lineas.map((l) => {
          if (l.productoId !== accion.productoId) return l;
          // Mientras se tipea no se marca error (un "," o un campo vacío a medio tipear no tienen por qué romper nada): el
          // subtotal sigue con la última cantidad válida hasta que el mozo termine de escribir (`normalizarCantidad`, al blur).
          const r = interpretarNumero(accion.texto);
          const candidata = r.ok && r.valor !== null && r.valor > 0 ? r.valor : l.cantidad;
          return { ...l, cantidadTexto: accion.texto, cantidad: candidata };
        }),
      };
    case "normalizarCantidad":
      return {
        lineas: estado.lineas.map((l) => {
          if (l.productoId !== accion.productoId) return l;
          const r = interpretarNumero(l.cantidadTexto);
          if (!r.ok) return { ...l, error: r.mensaje };
          if (r.valor === null) return { ...l, error: "La cantidad tiene que ser un número mayor que cero." };
          const v = validarCantidadPedido(r.valor, accion.decimales);
          if (!v.ok) return { ...l, error: v.mensaje };
          // Se ve EXACTAMENTE lo que se va a guardar (ej. "1,4" en una unidad entera queda mostrado como "1"): nunca un redondeo
          // silencioso, ver docstring del módulo.
          return { ...l, cantidad: v.cantidad, cantidadTexto: textoCanonico(v.cantidad), error: null };
        }),
      };
    case "quitarLinea":
      return { lineas: estado.lineas.filter((l) => l.productoId !== accion.productoId) };
    case "vaciar":
      return { lineas: [] };
  }
}

import type { CombinacionesParaMostrar } from "./combinacion-elegida";
import type { GrupoParaVender } from "./linea-configurada";
import { opcionDisponible } from "./precio-de-configuracion";

/**
 * El estado PURO del diálogo «Elegir opciones» del POS (GO-2d): qué opción y cuántas eligió el mozo en cada grupo, y cuántas unidades del producto. Reductor sin DOM, testeable en
 * Vitest (`test/pos/elegir-opciones-estado.test.ts`); nunca toca el servidor ni decide un precio: la vista previa la da `vistaPreviaDeConfiguracion` (la misma regla que la venta) y,
 * al pedir, el servidor vuelve a armar la línea con lo vigente.
 *
 * Reglas de la pantalla (las mismas que valida el servidor, `validarOpcionesElegidas`):
 * - en un grupo de una sola elección (máximo 1: un tamaño, una variante, una guarnición) elegir una opción reemplaza a la anterior (como un radio);
 * - en uno de varias (adicionales, o lo incluido con máximo mayor que 1) se suma de a uno, sin pasar el tope de la opción ni el máximo del grupo;
 * - solo se elige lo disponible hoy (`opcionDisponible`): una opción agotada en la sucursal no se puede elegir;
 * - el producto se pide en cantidades enteras (los productos con opciones no se fraccionan), de 1 a `CANTIDAD_MAXIMA_DEL_DIALOGO`.
 */

/** Tope de unidades del producto desde el diálogo (el de una línea, `CANTIDAD_MAXIMA_POR_ITEM`, lo sigue validando la lista y el servidor). */
const CANTIDAD_MAXIMA_DEL_DIALOGO = 99;

export interface EstadoElegirOpciones {
  /** opcionId → cuántas (solo las elegidas, siempre de 1 o más). */
  elegidas: Readonly<Record<string, number>>;
  /** Unidades del producto. */
  cantidad: number;
}

export type AccionElegirOpciones =
  | { tipo: "elegir"; grupo: GrupoParaVender; opcionId: string }
  | { tipo: "sumar"; grupo: GrupoParaVender; opcionId: string }
  | { tipo: "restar"; opcionId: string }
  | { tipo: "cantidad"; delta: 1 | -1 }
  /** «Lo más pedido» u «Otro igual»: arranca con esa elección (solo lo que hoy se puede elegir). */
  | { tipo: "precargar"; grupos: readonly GrupoParaVender[]; elegidas: readonly { opcionId: string; cantidad: number }[] };

export function estadoInicialElegirOpciones(): EstadoElegirOpciones {
  return { elegidas: {}, cantidad: 1 };
}

/** Si el grupo se elige de a una (como un radio). */
export function esDeUnaSolaEleccion(grupo: Pick<GrupoParaVender, "cantidadMaxima">): boolean {
  return grupo.cantidadMaxima === 1;
}

function totalDelGrupo(estado: EstadoElegirOpciones, grupo: GrupoParaVender): number {
  return grupo.opciones.reduce((n, o) => n + (estado.elegidas[o.opcionId] ?? 0), 0);
}

function sinElGrupo(elegidas: Readonly<Record<string, number>>, grupo: GrupoParaVender): Record<string, number> {
  const ids = new Set(grupo.opciones.map((o) => o.opcionId));
  return Object.fromEntries(Object.entries(elegidas).filter(([id]) => !ids.has(id)));
}

export function reducirElegirOpciones(estado: EstadoElegirOpciones, accion: AccionElegirOpciones): EstadoElegirOpciones {
  switch (accion.tipo) {
    case "elegir": {
      const opcion = accion.grupo.opciones.find((o) => o.opcionId === accion.opcionId);
      if (!opcion || !opcionDisponible(opcion)) return estado;
      return { ...estado, elegidas: { ...sinElGrupo(estado.elegidas, accion.grupo), [accion.opcionId]: 1 } };
    }
    case "sumar": {
      const opcion = accion.grupo.opciones.find((o) => o.opcionId === accion.opcionId);
      if (!opcion || !opcionDisponible(opcion)) return estado;
      const actual = estado.elegidas[accion.opcionId] ?? 0;
      if (actual >= opcion.cantidadMaxima || totalDelGrupo(estado, accion.grupo) >= accion.grupo.cantidadMaxima) return estado;
      return { ...estado, elegidas: { ...estado.elegidas, [accion.opcionId]: actual + 1 } };
    }
    case "restar": {
      const actual = estado.elegidas[accion.opcionId] ?? 0;
      if (actual === 0) return estado;
      const resto = Object.fromEntries(Object.entries(estado.elegidas).filter(([id]) => id !== accion.opcionId));
      return { ...estado, elegidas: actual === 1 ? resto : { ...estado.elegidas, [accion.opcionId]: actual - 1 } };
    }
    case "cantidad": {
      const cantidad = Math.min(CANTIDAD_MAXIMA_DEL_DIALOGO, Math.max(1, estado.cantidad + accion.delta));
      return cantidad === estado.cantidad ? estado : { ...estado, cantidad };
    }
    case "precargar": {
      const disponibles = new Map(accion.grupos.flatMap((g) => g.opciones.filter(opcionDisponible).map((o) => [o.opcionId, o.cantidadMaxima] as const)));
      const elegidas: Record<string, number> = {};
      for (const e of accion.elegidas) {
        const tope = disponibles.get(e.opcionId);
        if (tope !== undefined && Number.isInteger(e.cantidad) && e.cantidad >= 1) elegidas[e.opcionId] = Math.min(e.cantidad, tope);
      }
      return { ...estado, elegidas };
    }
  }
}

/** Lo elegido como lo manda el pedido: en el orden del producto (grupo y opción), con la versión que el mozo vio (la vigente). */
export function elegidasParaPedir(estado: EstadoElegirOpciones, grupos: readonly GrupoParaVender[]): { opcionId: string; cantidad: number; versionDeOpcionId: string }[] {
  return grupos.flatMap((g) =>
    g.opciones.flatMap((o) => {
      const cantidad = estado.elegidas[o.opcionId];
      return cantidad ? [{ opcionId: o.opcionId, cantidad, versionDeOpcionId: o.versionVigenteId }] : [];
    })
  );
}

/** Los grupos obligatorios (de los vigentes) que todavía no llegan a su mínimo, en orden: «Falta elegir: Tamaño». */
export function gruposQueFaltan(estado: EstadoElegirOpciones, grupos: readonly GrupoParaVender[]): GrupoParaVender[] {
  return grupos.filter((g) => g.admitido && g.activo && g.cantidadMinima > 0 && totalDelGrupo(estado, g) < g.cantidadMinima);
}

/** Si el grupo ya no admite más: tiene su elección (uno de una sola elección) o llegó a su máximo. Con eso el diálogo lleva la vista al grupo siguiente. */
export function grupoCompleto(estado: EstadoElegirOpciones, grupo: GrupoParaVender): boolean {
  return totalDelGrupo(estado, grupo) >= grupo.cantidadMaxima;
}

/**
 * La CLAVE de una configuración en la lista «Por agregar» del cliente: el producto y lo elegido, ordenado por opción. La misma configuración se acumula en una sola línea; otra
 * configuración del mismo producto es otra línea. No es la huella del servidor (esa es de las versiones e importes que se congelan): solo identifica la línea en pantalla.
 */
export function claveDeConfiguracion(productoId: string, elegidas: readonly { opcionId: string; cantidad: number }[]): string {
  const partes = [...elegidas].sort((a, b) => (a.opcionId < b.opcionId ? -1 : a.opcionId > b.opcionId ? 1 : 0)).map((e) => `${e.opcionId}x${e.cantidad}`);
  return `${productoId}|${partes.join(",")}`;
}

/**
 * Cómo se lee una configuración en la lista y en la cuenta: «Café · Mediano · Con leche» y, aparte, los adicionales «+ Huevo frito ×2» (por unidad del producto). Una «ninguna»
 * dentro del precio se lee con su nombre («Sin guarnición»); la de un adicional no se nombra (no se agrega nada).
 */
export function resumenDeConfiguracion(nombreProducto: string, grupos: readonly GrupoParaVender[], elegidas: readonly { opcionId: string; cantidad: number }[]): { titulo: string; adicionales: string[] } {
  const cuantas = new Map(elegidas.map((e) => [e.opcionId, e.cantidad]));
  const partes: string[] = [];
  const adicionales: string[] = [];
  for (const g of grupos) {
    for (const o of g.opciones) {
      const n = cuantas.get(o.opcionId);
      if (!n) continue;
      if (g.tipo === "ADICIONAL") {
        if (!o.esNinguna) adicionales.push(`+ ${o.nombre} ×${n}`);
      } else partes.push(n > 1 ? `${o.nombre} ×${n}` : o.nombre);
    }
  }
  return { titulo: [nombreProducto, ...partes].join(" · "), adicionales };
}

/**
 * «Lo más pedido acá» (modelo 3): de las configuraciones más pedidas en la sucursal (por huella, de mayor a menor), las `maximo` primeras que HOY se pueden elegir, juntando la misma
 * elección pedida con dos versiones de precio. Cada una con su etiqueta («Mediano · Con leche»), en el orden de los grupos del producto. Una con alguna opción que ya no está
 * (dada de baja, no admitida, agotada hoy) no se ofrece: el botón precargaría otra cosa que la que dice.
 */
export function masPedidasParaElDialogo(
  grupos: readonly GrupoParaVender[],
  pedidas: readonly { elegidas: readonly { opcionId: string; cantidad: number }[]; unidades: number }[],
  maximo = 3
): { etiqueta: string; elegidas: { opcionId: string; cantidad: number }[] }[] {
  const disponibles = new Map(grupos.filter((g) => g.admitido && g.activo).flatMap((g) => g.opciones.filter(opcionDisponible).map((o) => [o.opcionId, o] as const)));
  const juntas = new Map<string, { elegidas: { opcionId: string; cantidad: number }[]; unidades: number; orden: number }>();
  pedidas.forEach((p, orden) => {
    if (p.elegidas.length === 0 || !p.elegidas.every((e) => disponibles.has(e.opcionId))) return;
    const clave = claveDeConfiguracion("", p.elegidas);
    const antes = juntas.get(clave);
    juntas.set(clave, { elegidas: antes?.elegidas ?? p.elegidas.map((e) => ({ opcionId: e.opcionId, cantidad: e.cantidad })), unidades: (antes?.unidades ?? 0) + p.unidades, orden: antes?.orden ?? orden });
  });
  return [...juntas.values()]
    .sort((a, b) => b.unidades - a.unidades || a.orden - b.orden)
    .slice(0, maximo)
    .map(({ elegidas }) => {
      const cuantas = new Map(elegidas.map((e) => [e.opcionId, e.cantidad]));
      const partes = grupos.flatMap((g) => g.opciones.flatMap((o) => (cuantas.has(o.opcionId) ? [cuantas.get(o.opcionId)! > 1 ? `${o.nombre} ×${cuantas.get(o.opcionId)}` : o.nombre] : [])));
      return { etiqueta: partes.join(" · "), elegidas };
    });
}

/**
 * En una promo (v1) un componente no lleva opciones: el servidor rechaza el que tiene un grupo obligatorio (`PROMO_CON_OPCIONES`). El aviso para `ArmarPromo`, o `null` si el
 * producto entra en la promo (sin opciones, o solo con grupos opcionales: entra sin elegir nada).
 */
export function avisoEnPromo(grupos: readonly Pick<GrupoParaVender, "admitido" | "cantidadMinima" | "tipo">[]): string | null {
  const obligatorios = grupos.filter((g) => g.admitido && g.cantidadMinima > 0);
  if (obligatorios.length === 0) return null;
  return obligatorios.some((g) => g.tipo === "MEDIDA") ? "Con tamaño: pedilo suelto" : "Lleva opciones: pedilo suelto";
}

/**
 * Lo que el selector del POS sabe de un producto CON opciones (lo arma el servidor, `server/consultas/pos/opciones-del-selector.ts`): sus grupos tal como los lee la venta (con el
 * precio de cada opción ya resuelto para la sucursal y SIN los consumos: el mozo no los necesita), el precio base y el descuento de producto que rigen hoy, el «desde», si se puede
 * vender y, de cada opción, los insumos que el sistema registra en 0 (el aviso discreto: vender sigue permitido).
 */
export interface ConfiguracionDelSelector {
  grupos: GrupoParaVender[];
  /** El precio base del producto en la sucursal (precio local vigente o el de venta), SIN el descuento. */
  precioBase: number;
  /** El % de descuento de producto que rige hoy en la sucursal (`null` = ninguno). */
  descuentoDeProducto: number | null;
  desde: number | null;
  hayVariacion: boolean;
  vendible: boolean;
  /** opcionId → nombres de los insumos de su consumo que el sistema registra en 0 o menos en la sucursal. */
  sinStock: Readonly<Record<string, string[]>>;
  /** «Lo más pedido acá» (hasta 3, de mayor a menor): botones que precargan esa elección; igual se confirma viendo el precio. */
  masPedidas: { etiqueta: string; elegidas: { opcionId: string; cantidad: number }[] }[];
  /** GO-3b (ADR-032): SOLO en un producto con ejes, sus combinaciones (forma serializable): la vista previa cobra lo que cobra la venta y una combinación apagada se deshabilita. */
  combinaciones?: CombinacionesParaMostrar;
}

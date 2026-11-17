/**
 * El HISTORIAL DE PRECIOS de un producto en la ficha (pestaña «Precios»; Frente 6, paso 7 del plan; dueño, 2026-11-17: «A» = quien ve el catálogo ve fechas y precios, SIN el nombre de quien cambió el
 * precio, eso sigue siendo de «Ver auditoría»). PURO: arma las líneas que se muestran a partir de las filas de auditoría del precio (`RegistroAuditoria`, que ya existe: sin tablas ni migración).
 *
 * Qué muestra: los CAMBIOS del precio de lista (global, entidad `Producto.precioVenta`) y los del precio de ESTA sucursal (`PrecioLocalProducto.precio`), el más reciente primero, con su fecha y «de $X a $Y».
 * Qué NO muestra (declarado): el precio con el que nació el producto (el alta no deja fila de auditoría: no hay valor anterior), los precios por opción (otra entidad), quién hizo el cambio, el
 * «habilitado» del precio local, ni las filas en que el precio no cambió.
 */

/** Una fila de auditoría del precio, como sale de la lectura (SIN el actor: la lectura no lo trae). */
export interface FilaDeAuditoriaDePrecio {
  creadoEn: Date;
  /** `"Producto"` (precio de lista) o `"PrecioLocalProducto"` (precio de la sucursal activa). */
  entidad: string;
  valorAnterior: string | null;
  valorNuevo: string | null;
}

/** Lo que se dibuja: una línea del historial. */
export interface LineaDelHistorialDePrecios {
  creadoEn: Date;
  alcance: "lista" | "sucursal";
  /** `null` = el primer precio propio de la sucursal (no hay «de $X»). */
  anterior: number | null;
  nuevo: number;
}

/** Cuántos cambios se leen y se muestran como máximo (los más recientes). */
export const CAMBIOS_DE_PRECIO_A_MOSTRAR = 50;

/** Un valor de auditoría como número: solo una cifra decimal simple y finita («12000», «12000.50»; sin signo); cualquier otra cosa (texto, vacío, «NaN», «1e3») no es un precio. */
function comoPrecio(valor: string | null): number | null {
  const limpio = valor?.trim() ?? "";
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

const centavos = (n: number) => Math.round(n * 100);

/**
 * Las líneas del historial, en el orden en que llegan (más reciente primero). Una fila sin precio nuevo legible, o en que el precio no cambió (mismos centavos), no es un cambio y no figura.
 * Con un precio nuevo y SIN anterior en el precio de la sucursal figura como «primer precio de la sucursal»; en el de lista una fila sin anterior no figura (el alta no deja fila).
 */
export function armarHistorialDePrecios(filas: readonly FilaDeAuditoriaDePrecio[]): LineaDelHistorialDePrecios[] {
  const cambios: LineaDelHistorialDePrecios[] = [];
  for (const f of filas) {
    const alcance = f.entidad === "Producto" ? "lista" : f.entidad === "PrecioLocalProducto" ? "sucursal" : null;
    if (alcance === null) continue;
    const nuevo = comoPrecio(f.valorNuevo);
    if (nuevo === null) continue;
    const anterior = comoPrecio(f.valorAnterior);
    if (anterior === null && (alcance === "lista" || f.valorAnterior !== null)) continue;
    if (anterior !== null && centavos(anterior) === centavos(nuevo)) continue;
    cambios.push({ creadoEn: f.creadoEn, alcance, anterior, nuevo });
  }
  return cambios;
}

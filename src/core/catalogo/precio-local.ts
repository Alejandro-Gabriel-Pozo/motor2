export interface PrecioLocalFila {
  productoId: string;
  precio: number;
  habilitado: boolean;
}

export interface PrecioLocalVigente {
  precio: number;
  habilitado: true;
}

/**
 * La regla única del Precio Local: rige solo si la sucursal tiene la capacidad `precio_local` Y la fila está habilitada.
 * Sin la capacidad el precio efectivo es el central aunque exista una fila habilitada (la fila no se borra: al reactivar la
 * capacidad vuelve a aplicar). Sin fila, o con la fila deshabilitada, también es el central.
 */
export function filtrarPreciosLocalesVigentes(filas: readonly PrecioLocalFila[], capacidadActiva: boolean): Map<string, PrecioLocalVigente> {
  const vigentes = new Map<string, PrecioLocalVigente>();
  if (!capacidadActiva) return vigentes;
  for (const f of filas) if (f.habilitado) vigentes.set(f.productoId, { precio: f.precio, habilitado: true });
  return vigentes;
}

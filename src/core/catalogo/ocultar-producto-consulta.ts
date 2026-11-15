/**
 * El criterio de «NO oculto en esta sucursal» como `where` de Prisma (docs/diseno-ocultar-como-pedernal-2026-11-15.md, I-12 y §8.4): PURO (objetos planos, sin base), el ÚNICO lugar donde se escribe.
 * Un producto está oculto en la sucursal S si hay una marca `oculto` de la EMPRESA (`sucursalId` nulo) o de S (`ocultoPor`, `ocultar-producto.ts`); sin marca = visible. Los lectores que consultan la tabla
 * (`productoOcultoEn`, `productosOcultosEn`) viven en `server/lecturas/catalogo/ocultamiento.ts`. Ninguna pantalla escribe `{ ocultamientos: { none: ... } }` a mano: lo fija
 * `test/arquitectura/ocultar-en-un-solo-lugar.test.ts`. Se devuelve un objeto plano (sin tipos de Prisma) para que este archivo no arrastre el cliente de base (sin `as const`: un `OR` de solo lectura no entra en el `where` de Prisma).
 *
 * Con la RLS por sucursal (`OcultamientoProducto`, PROPIA_O_EMPRESA): la marca de la empresa solo se ve con un alcance fijado; quien consulta con la base de la sesión o de la carta pública ya lo tiene.
 */
export function whereNoOcultoEn(sucursalId: string) {
  return { ocultamientos: { none: { oculto: true, OR: [{ sucursalId: null }, { sucursalId }] } } };
}

/** El texto del rechazo de una línea NUEVA (o de una anulación) de un producto oculto: el aprobado por el dueño (O-5, «Este producto está oculto.»). */
export const MENSAJE_PRODUCTO_OCULTO = "Este producto está oculto.";

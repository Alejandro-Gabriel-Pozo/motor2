import type { Prisma } from "@prisma/client";

/**
 * Una promo (`PromoCarta`) es de la EMPRESA y cada sucursal la prende o la apaga con su `PromoCartaSucursal` (decisión del dueño,
 * 2026-10-01). Se ofrece en una sucursal (carta pública y POS) solo si la promo está activa en la empresa Y su fila de esa
 * sucursal existe y está activa. Una sola definición del criterio, para que la carta, el selector del POS y el alta a la cuenta
 * nunca discrepen. Pura: solo arma el filtro, sin tocar la base.
 */
export function wherePromoOfrecidaEn(sucursalId: string): Prisma.PromoCartaWhereInput {
  return { activa: true, sucursales: { some: { sucursalId, activa: true } } };
}

/** El `include`/`select` de la fila de la sucursal, para leer su precio local junto con la promo. */
export function seleccionDeSucursalDePromo(sucursalId: string) {
  return { where: { sucursalId }, select: { activa: true, precioLocal: true } } as const;
}

/**
 * El precio de la promo EN la sucursal: el local si lo tiene Y la sucursal tiene prendida la capacidad `precio_local`; si no, el de la empresa
 * (mismo patrón que `precioDeCarta`). Apagar `precio_local` NO borra el precio local de la promo: queda guardado y vuelve a regir al reactivarla
 * (decisión del dueño, 2026-10-01, R1). `precioLocalActivo` sale de `precioLocalActivoEn`.
 */
export function precioDePromo(
  precioEmpresa: { toString(): string } | number,
  filaDeSucursal: { precioLocal: { toString(): string } | number | null } | undefined,
  precioLocalActivo: boolean
): number {
  const local = precioLocalActivo ? filaDeSucursal?.precioLocal : null;
  return Number(local ?? precioEmpresa);
}

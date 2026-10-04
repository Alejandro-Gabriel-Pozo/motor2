import type { Db } from "@/lib/db-tipos";

/**
 * «Hasta la primera factura autorizada» (decisión del dueño, 2026-10-04, ADR-021): el CUIT de una empresa lo puede corregir la plataforma mientras NO exista una factura
 * autorizada por ARCA en PRODUCCIÓN (un CAE real). Las de homologación NO cuentan: para los certificados de ambos ambientes hace falta el CUIT real, y es justamente con
 * el certificado de homologación que se verifica y, si hace falta, se corrige.
 *
 * Hoy NO existe el circuito fiscal (ni comprobantes ni credenciales): no hay nada que pueda estar autorizado y el predicado da siempre `false`. Cuando exista, hay que
 * sumar a `FUENTES_DE_FACTURAS_AUTORIZADAS` la consulta de «cuántos comprobantes AUTORIZADOS de PRODUCCIÓN tiene la empresa»; `test/arquitectura/cuit-inmutable-cableado.test.ts`
 * falla si aparece una tabla fiscal en el schema y la lista sigue vacía. Cada fuente devuelve la cantidad.
 */
export type FuenteDeFacturasAutorizadas = (db: Db, empresaId: string) => Promise<number>;

export const FUENTES_DE_FACTURAS_AUTORIZADAS: readonly FuenteDeFacturasAutorizadas[] = [];

export const MENSAJE_CUIT_INMUTABLE = "La empresa ya tiene una factura autorizada por ARCA en producción: su CUIT ya no se puede cambiar.";

/** ¿Alguna de las `fuentes` cuenta al menos una factura autorizada? Separado de la lista para poder probarlo con fuentes falsas. */
export async function hayFacturaEnAlgunaFuente(fuentes: readonly FuenteDeFacturasAutorizadas[], db: Db, empresaId: string): Promise<boolean> {
  for (const fuente of fuentes) if ((await fuente(db, empresaId)) > 0) return true;
  return false;
}

export function empresaTieneFacturaAutorizada(db: Db, empresaId: string): Promise<boolean> {
  return hayFacturaEnAlgunaFuente(FUENTES_DE_FACTURAS_AUTORIZADAS, db, empresaId);
}

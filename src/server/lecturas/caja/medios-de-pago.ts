import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * Lectura «medios de pago activos de la empresa» (etapa C1, PR-B), para elegir con qué se cobra. SOLO LECTURA. Los medios son de la EMPRESA (no de la sucursal); se filtra por la empresa recibida (la del contexto) además de la RLS. En C1 el único medio
 * que existe es el EFECTIVO, que nace solo la primera vez que se abre una caja (el alta de los demás medios es de otra etapa): antes de la primera apertura la lista puede venir vacía.
 */
export interface MedioDePagoActivo {
  id: string;
  /** EFECTIVO | TARJETA_DEBITO | TARJETA_CREDITO | TRANSFERENCIA | QR | OTRO. */
  tipo: string;
  nombre: string | null;
}

export async function listarMediosDePagoActivos(empresaId: string, db: Db): Promise<MedioDePagoActivo[]> {
  return db.medioDePago.findMany({ where: { empresaId, activo: true }, orderBy: [{ tipo: "asc" }, { creadoEn: "asc" }, { id: "asc" }], select: { id: true, tipo: true, nombre: true } });
}

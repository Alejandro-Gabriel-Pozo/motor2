import "server-only";
import type { Db } from "@/lib/db-tipos";

/** MAQUETA (rama temporal): las notas de crédito de proveedor de la empresa, las más nuevas primero, con sus líneas. Solo lectura. */
export interface NotaDeCreditoListada {
  id: string;
  numero: string;
  fecha: Date;
  proveedorNombre: string;
  total: number;
  motivo: string;
  tipo: string;
  creadaPor: string;
  creadaEn: Date;
  anuladaEn: Date | null;
  lineas: Array<{ descripcion: string; importe: number }>;
}

export async function listarNotasDeCredito(db: Db, proveedorId?: string): Promise<NotaDeCreditoListada[]> {
  const notas = await db.notaCreditoProveedor.findMany({
    where: proveedorId ? { proveedorId } : {},
    include: { proveedor: { select: { nombre: true } }, creadoPor: { select: { email: true } }, lineas: { orderBy: { orden: "asc" }, select: { descripcion: true, importe: true } } },
    orderBy: [{ fecha: "desc" }, { creadoEn: "desc" }],
    take: 20,
  });
  return notas.map((n) => ({
    id: n.id,
    numero: n.nroComprobante,
    fecha: n.fecha,
    proveedorNombre: n.proveedor.nombre,
    total: Number(n.importeTotal),
    motivo: n.motivo,
    tipo: n.tipo,
    creadaPor: n.creadoPor.email ?? "—",
    creadaEn: n.creadoEn,
    anuladaEn: n.anuladaEn,
    lineas: n.lineas.map((l) => ({ descripcion: l.descripcion ?? "", importe: Number(l.importe) })),
  }));
}

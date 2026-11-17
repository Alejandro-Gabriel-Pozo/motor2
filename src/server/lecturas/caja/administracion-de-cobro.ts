import "server-only";
import { DATOS_DEL_COBRO, type DatoDelCobro } from "@/core/caja/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Lecturas de ADMINISTRACIÓN de la caja (etapa B; docs/diseno-caja-cuentas-de-cobro-y-medios-acciones-y-permisos-2026-11-17.md §5): las cuentas de cobro y los medios de pago COMPLETOS, activos e inactivos, para la pantalla que los administra (a diferencia de `listarMediosDePagoActivos`,
 * que es solo para elegir con cuál se cobra). SOLO LECTURA. Los datos salen como texto, números y booleanos de la fila (nunca el objeto crudo de Prisma). Las cuentas se filtran por la empresa recibida (la del contexto) además de la RLS por empresa y por sucursal (solo las del alcance del pedido);
 * los medios son de la EMPRESA.
 */
export interface CuentaDeCobroDeAdministracion {
  id: string;
  /** TERMINAL | QR | CUENTA_BANCARIA. */
  tipo: string;
  nombre: string;
  /** El número de terminal o el alias; `null` = sin dato. */
  identificadorExterno: string | null;
  /** Para el control de versión de la edición. */
  version: number;
  sucursalId: string;
  sucursalNombre: string;
  activa: boolean;
}

export interface MedioDePagoDeAdministracion {
  id: string;
  /** EFECTIVO | TARJETA_DEBITO | TARJETA_CREDITO | TRANSFERENCIA | QR | OTRO. */
  tipo: string;
  nombre: string | null;
  activo: boolean;
  /** Para el control de versión de la edición. */
  version: number;
  /** Qué datos pide al cobrar (`cupon`, `ultimos4`, `marca`, `cuotas`, `dni`), en el orden del catálogo. */
  datosQuePide: DatoDelCobro[];
}

export async function listarCuentasDeCobroDeAdministracion(empresaId: string, db: Db): Promise<CuentaDeCobroDeAdministracion[]> {
  const filas = await db.cuentaDeCobro.findMany({
    where: { empresaId },
    orderBy: [{ activa: "desc" }, { nombre: "asc" }, { id: "asc" }],
    select: { id: true, tipo: true, nombre: true, identificadorExterno: true, version: true, sucursalId: true, activa: true, sucursal: { select: { nombre: true } } },
  });
  return filas.map((f) => ({ id: f.id, tipo: f.tipo, nombre: f.nombre, identificadorExterno: f.identificadorExterno, version: f.version, sucursalId: f.sucursalId, sucursalNombre: f.sucursal.nombre, activa: f.activa }));
}

export async function listarMediosDePagoDeAdministracion(empresaId: string, db: Db): Promise<MedioDePagoDeAdministracion[]> {
  const filas = await db.medioDePago.findMany({
    where: { empresaId },
    orderBy: [{ activo: "desc" }, { tipo: "asc" }, { creadoEn: "asc" }, { id: "asc" }],
    select: { id: true, tipo: true, nombre: true, activo: true, version: true, pideCupon: true, pideUltimos4: true, pideMarca: true, pideCuotas: true, pideDni: true },
  });
  return filas.map((f) => {
    const pide: Record<DatoDelCobro, boolean> = { cupon: f.pideCupon, ultimos4: f.pideUltimos4, marca: f.pideMarca, cuotas: f.pideCuotas, dni: f.pideDni };
    return { id: f.id, tipo: f.tipo, nombre: f.nombre, activo: f.activo, version: f.version, datosQuePide: DATOS_DEL_COBRO.filter((d) => pide[d]) };
  });
}

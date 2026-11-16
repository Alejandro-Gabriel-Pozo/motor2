import "server-only";
import { centavosDeImporte } from "@/core/caja/public";
import type { Db } from "@/lib/db-tipos";
import { cargarCuentaParaCobrar } from "@/server/lecturas/caja/total-de-cuenta";

/**
 * Consulta «cuentas cerradas con venta sin cobrar» de la sucursal (etapa C1, PR-B). SOLO LECTURA. «Sin cobrar» se DERIVA: la cuenta está cerrada, tuvo venta (emitió ticket) y NO existe una `Cobranza` suya (no hay una marca que se pueda
 * desfasar). El total sale del MISMO cálculo que usa el cobro (`cargarCuentaParaCobrar`: el ticket «como se imprimiría ahora», con el descuento del cliente congelado en la cuenta), así lo que se lista es lo que después se cobra. Más recientes
 * primero (cerrada en, luego id), paginadas por cursor de a `TAMANO_PAGINA_DE_CUENTAS_SIN_COBRAR` como `listarTicketsEmitidos`. Siempre filtra por la sucursal recibida (la del contexto) además de la RLS. Sin datos del cliente: solo la cuenta, su
 * mesa, cuándo se cerró y el total en CENTAVOS (texto). Una cuenta con total 0 se lista con «0» (no se puede cobrar: el caso de uso responde `NADA_PARA_COBRAR`).
 */
export const TAMANO_PAGINA_DE_CUENTAS_SIN_COBRAR = 30;

export interface CuentaSinCobrar {
  cuentaId: string;
  mesaNumero: number;
  /** SALON | MOSTRADOR. */
  tipoMesa: string;
  cerradaEn: Date;
  /** El total a cobrar en centavos (texto), o `null` si no entra en una columna de importe. */
  totalEnCentavos: string | null;
}

export interface PaginaDeCuentasSinCobrar {
  items: CuentaSinCobrar[];
  nextCursor: string | null;
}

export async function listarCuentasSinCobrar(args: { empresaId: string; sucursalId: string; ahora: Date; cursor?: string }, db: Db): Promise<PaginaDeCuentasSinCobrar> {
  const filas = await db.cuenta.findMany({
    where: { mesa: { sucursalId: args.sucursalId }, cerradaEn: { not: null }, ejemplaresTicket: { some: {} }, cobranza: { is: null } },
    orderBy: [{ cerradaEn: "desc" }, { id: "desc" }],
    take: TAMANO_PAGINA_DE_CUENTAS_SIN_COBRAR + 1,
    ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    select: { id: true, cerradaEn: true, tipoMesa: true, mesa: { select: { numero: true } } },
  });
  const hayMas = filas.length > TAMANO_PAGINA_DE_CUENTAS_SIN_COBRAR;
  const pagina = hayMas ? filas.slice(0, TAMANO_PAGINA_DE_CUENTAS_SIN_COBRAR) : filas;

  const items: CuentaSinCobrar[] = [];
  for (const f of pagina) {
    const cuenta = await cargarCuentaParaCobrar(db, args.empresaId, f.id, args.ahora);
    if (!cuenta || f.cerradaEn === null) continue;
    items.push({ cuentaId: f.id, mesaNumero: f.mesa.numero, tipoMesa: f.tipoMesa, cerradaEn: f.cerradaEn, totalEnCentavos: centavosDeImporte(cuenta.total)?.toString() ?? null });
  }
  return { items, nextCursor: hayMas ? pagina[pagina.length - 1]!.id : null };
}

import "server-only";
import type { Db } from "@/lib/db-tipos";
import { centavosDeDecimal } from "./centavos-de-decimal";

/**
 * Lectura «cuentas cobradas de una sesión de caja» (etapa C1, PR-B). SOLO LECTURA. Cada cobranza con sus renglones (medio e importe, en el orden en que se cargaron) y el total congelado al cobrar, en CENTAVOS (texto). SIN datos personales: ni el
 * cliente de la cuenta ni el nombre de quien cobró (solo su id); la mesa y el momento alcanzan para reconocerla. Siempre filtra por la sucursal recibida (la del contexto) además de la RLS: una sesión de otra sucursal devuelve vacío. Más
 * recientes primero, hasta `LIMITE_DE_COBRANZAS_DE_SESION` (una sesión real no se acerca; el tope evita una respuesta sin cota).
 */
export const LIMITE_DE_COBRANZAS_DE_SESION = 200;

export interface RenglonCobrado {
  orden: number;
  medioDePagoId: string;
  tipoDeMedio: string;
  nombreDeMedio: string | null;
  importeEnCentavos: string;
}

export interface CobranzaDeSesion {
  cobranzaId: string;
  cuentaId: string;
  mesaNumero: number;
  totalEnCentavos: string;
  cobradaEn: Date;
  cobradaPorId: string;
  renglones: readonly RenglonCobrado[];
}

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function listarCobranzasDeSesion(args: { sucursalId: string; sesionId: string }, db: Db): Promise<CobranzaDeSesion[]> {
  // El id de una sesión es un UUID: otra cosa no puede ser una sesión (y la columna `uuid` haría lanzar a la base). Vacío, como una sesión que no es de esta sucursal.
  if (!REGEX_UUID.test(args.sesionId)) return [];
  const filas = await db.cobranza.findMany({
    where: { sucursalId: args.sucursalId, sesionId: args.sesionId },
    orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
    take: LIMITE_DE_COBRANZAS_DE_SESION,
    select: {
      id: true,
      cuentaId: true,
      total: true,
      creadoEn: true,
      creadoPorId: true,
      cuenta: { select: { mesa: { select: { numero: true } } } },
      cobros: { orderBy: { orden: "asc" }, select: { orden: true, medioDePagoId: true, importe: true, medioDePago: { select: { tipo: true, nombre: true } } } },
    },
  });
  return filas.map((f) => ({
    cobranzaId: f.id,
    cuentaId: f.cuentaId,
    mesaNumero: f.cuenta.mesa.numero,
    totalEnCentavos: centavosDeDecimal(f.total).toString(),
    cobradaEn: f.creadoEn,
    cobradaPorId: f.creadoPorId,
    renglones: f.cobros.map((c) => ({ orden: c.orden, medioDePagoId: c.medioDePagoId, tipoDeMedio: c.medioDePago.tipo, nombreDeMedio: c.medioDePago.nombre, importeEnCentavos: centavosDeDecimal(c.importe).toString() })),
  }));
}

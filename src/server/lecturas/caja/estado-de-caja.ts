import "server-only";
import type { Db } from "@/lib/db-tipos";
import { estadoDeSesion } from "@/core/caja/public";
import { centavosDeDecimal } from "./centavos-de-decimal";

/**
 * Lectura «estado de la caja de la sucursal» (etapa C1, PR-B). SOLO LECTURA: la llama la Server Action de lectura `leerEstadoDeCaja` (`actions/caja/lecturas-de-caja.ts`, que exige `caja_ver` en la sucursal activa). Siempre filtra por la sucursal recibida (que sale
 * del contexto de la sesión, nunca del navegador) además de la RLS de la base: la caja de otra sucursal nunca aparece. Los importes salen como CENTAVOS en texto con signo («12345», «-500»): la pantalla los formatea.
 *
 * Devuelve la sesión sin cerrar, ABIERTA o EN_CIERRE (C1b: `estado` las distingue) (o `null`: la caja está cerrada o nunca se abrió), con quién y cuándo la abrió, el efectivo esperado (Σ de los movimientos en efectivo, con signo), lo esperado por medio y los movimientos en orden de creación.
 * Un movimiento se marca `anulado` si otro de clase ANULACION lo anula (la anulación es otro movimiento: nada se borra). El «esperado» incluye las anulaciones (son contrapartidas), así que es la suma de TODOS los movimientos.
 */
export interface MovimientoDeCajaVista {
  id: string;
  /** FONDO_INICIAL | COBRO | INGRESO_MANUAL | EGRESO_MANUAL | ANULACION. */
  clase: string;
  medioDePagoId: string;
  /** Con signo, en centavos (texto). */
  importeEnCentavos: string;
  motivo: string | null;
  /** El movimiento que esta anulación anula (solo en las de clase ANULACION). */
  anulaAId: string | null;
  /** Otro movimiento de clase ANULACION lo anula. */
  anulado: boolean;
  creadoEn: Date;
  creadoPorId: string;
  /** El nombre de quien lo hizo, o `null` si esa persona no cargó su nombre (la pantalla dice «Sin nombre»: el correo no sale de acá). */
  creadoPorNombre: string | null;
}

export interface EsperadoPorMedio {
  medioDePagoId: string;
  /** EFECTIVO | TARJETA_DEBITO | TARJETA_CREDITO | TRANSFERENCIA | QR | OTRO. */
  tipo: string;
  nombre: string | null;
  esperadoEnCentavos: string;
}

export interface SesionDeCajaVista {
  id: string;
  /** C1b: ABIERTA (entra plata) o EN_CIERRE (se está contando el efectivo: no entra plata). El nombre del campo `sesionAbierta` es de C1 y significa «la sesión sin cerrar». */
  estado: "ABIERTA" | "EN_CIERRE";
  /** Con EN_CIERRE: cuándo se inició el cierre; `null` con ABIERTA. */
  cierreIniciadoEn: Date | null;
  /** El día de negocio sellado al abrir, «AAAA-MM-DD». */
  fechaDeNegocio: string;
  zonaHoraria: string;
  abiertaEn: Date;
  abiertaPorId: string;
  /** El nombre de quien abrió la caja, o `null` si no cargó su nombre (el correo no sale de acá). */
  abiertaPorNombre: string | null;
  efectivoEsperadoEnCentavos: string;
  esperadoPorMedio: readonly EsperadoPorMedio[];
  movimientos: readonly MovimientoDeCajaVista[];
}

export interface EstadoDeCaja {
  sesionAbierta: SesionDeCajaVista | null;
}

/** El nombre recortado, o `null` si está vacío: nunca se cae al correo (dato personal que esta lectura no devuelve). */
const nombreVisible = (nombre: string | null): string | null => nombre?.trim() || null;

export async function consultarEstadoDeCaja(sucursalId: string, db: Db): Promise<EstadoDeCaja> {
  const sesion = await db.sesionCaja.findFirst({
    where: { sucursalId, estado: { in: ["ABIERTA", "EN_CIERRE"] } },
    select: { id: true, estado: true, cierreIniciadoEn: true, fechaDeNegocio: true, zonaHoraria: true, abiertaEn: true, abiertaPorId: true, abiertaPor: { select: { name: true } } },
  });
  if (!sesion) return { sesionAbierta: null };

  const filas = await db.movimientoCaja.findMany({
    where: { sucursalId, sesionId: sesion.id },
    orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
    select: {
      id: true,
      clase: true,
      medioDePagoId: true,
      importe: true,
      motivo: true,
      anulaAId: true,
      creadoEn: true,
      creadoPorId: true,
      creadoPor: { select: { name: true } },
      medioDePago: { select: { tipo: true, nombre: true } },
    },
  });

  const anulados = new Set(filas.flatMap((f) => (f.anulaAId ? [f.anulaAId] : [])));
  const esperado = new Map<string, { tipo: string; nombre: string | null; centavos: bigint }>();
  for (const f of filas) {
    const previo = esperado.get(f.medioDePagoId);
    esperado.set(f.medioDePagoId, { tipo: f.medioDePago.tipo, nombre: f.medioDePago.nombre, centavos: (previo?.centavos ?? BigInt(0)) + centavosDeDecimal(f.importe) });
  }
  const esperadoPorMedio: EsperadoPorMedio[] = [...esperado]
    .map(([medioDePagoId, e]) => ({ medioDePagoId, tipo: e.tipo, nombre: e.nombre, esperadoEnCentavos: e.centavos.toString() }))
    // El efectivo primero; los demás por tipo y por id (orden estable).
    .sort((a, b) => (a.tipo === "EFECTIVO" ? -1 : b.tipo === "EFECTIVO" ? 1 : a.tipo < b.tipo ? -1 : a.tipo > b.tipo ? 1 : a.medioDePagoId < b.medioDePagoId ? -1 : 1));
  const efectivo = [...esperado.values()].filter((e) => e.tipo === "EFECTIVO").reduce((suma, e) => suma + e.centavos, BigInt(0));

  return {
    sesionAbierta: {
      id: sesion.id,
      estado: estadoDeSesion(sesion.estado) === "EN_CIERRE" ? "EN_CIERRE" : "ABIERTA",
      cierreIniciadoEn: sesion.cierreIniciadoEn,
      fechaDeNegocio: sesion.fechaDeNegocio.toISOString().slice(0, 10),
      zonaHoraria: sesion.zonaHoraria,
      abiertaEn: sesion.abiertaEn,
      abiertaPorId: sesion.abiertaPorId,
      abiertaPorNombre: nombreVisible(sesion.abiertaPor.name),
      efectivoEsperadoEnCentavos: efectivo.toString(),
      esperadoPorMedio,
      movimientos: filas.map((f) => ({
        id: f.id,
        clase: f.clase,
        medioDePagoId: f.medioDePagoId,
        importeEnCentavos: centavosDeDecimal(f.importe).toString(),
        motivo: f.motivo,
        anulaAId: f.anulaAId,
        anulado: anulados.has(f.id),
        creadoEn: f.creadoEn,
        creadoPorId: f.creadoPorId,
        creadoPorNombre: nombreVisible(f.creadoPor.name),
      })),
    },
  };
}

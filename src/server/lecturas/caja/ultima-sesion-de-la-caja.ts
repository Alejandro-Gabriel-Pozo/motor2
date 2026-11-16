import "server-only";
import type { Db } from "@/lib/db-tipos";
import { centavosDeDecimal } from "./centavos-de-decimal";

/**
 * Lectura «última sesión cerrada de la caja» (etapa C1, PR-B): el resumen que muestra la pantalla «Caja» cuando está cerrada. SOLO LECTURA. La última sesión CERRADA de la sucursal recibida (la del contexto; además de la RLS) con su arqueo por
 * medio (esperado, contado, «conforme» y la DIFERENCIA = contado − esperado, que se CALCULA acá y nadie escribe: positiva sobra, negativa falta; `null` en los medios que se dieron por conformes sin contar), los billetes contados por
 * denominación (en pesos) y las monedas. Importes en CENTAVOS como texto. `null` si la caja nunca se cerró.
 */
export interface ArqueoDeMedioVisto {
  medioDePagoId: string;
  tipo: string;
  nombre: string | null;
  esperadoEnCentavos: string;
  contadoEnCentavos: string | null;
  conforme: boolean;
  diferenciaEnCentavos: string | null;
}

export interface UltimaSesionDeLaCaja {
  sesionId: string;
  /** «AAAA-MM-DD». */
  fechaDeNegocio: string;
  abiertaEn: Date;
  cerradaEn: Date;
  observacion: string | null;
  arqueos: readonly ArqueoDeMedioVisto[];
  /** Cantidad de billetes por denominación en pesos, de mayor a menor. */
  billetes: readonly { denominacion: number; cantidad: number }[];
  monedasEnCentavos: string;
}

export async function consultarUltimaSesionDeLaCaja(sucursalId: string, db: Db): Promise<UltimaSesionDeLaCaja | null> {
  const s = await db.sesionCaja.findFirst({
    where: { sucursalId, estado: "CERRADA" },
    orderBy: [{ cerradaEn: "desc" }, { id: "desc" }],
    select: {
      id: true,
      fechaDeNegocio: true,
      abiertaEn: true,
      cerradaEn: true,
      observacion: true,
      arqueos: { select: { medioDePagoId: true, esperado: true, contado: true, contadoMonedas: true, conforme: true, medioDePago: { select: { tipo: true, nombre: true } } } },
      billetes: { select: { denominacion: true, cantidad: true }, orderBy: { denominacion: "desc" } },
    },
  });
  if (!s || s.cerradaEn === null) return null;
  const arqueos: ArqueoDeMedioVisto[] = s.arqueos
    .map((a) => {
      const esperado = centavosDeDecimal(a.esperado);
      const contado = a.contado === null ? null : centavosDeDecimal(a.contado);
      return {
        medioDePagoId: a.medioDePagoId,
        tipo: a.medioDePago.tipo,
        nombre: a.medioDePago.nombre,
        esperadoEnCentavos: esperado.toString(),
        contadoEnCentavos: contado === null ? null : contado.toString(),
        conforme: a.conforme,
        diferenciaEnCentavos: contado === null ? null : (contado - esperado).toString(),
      };
    })
    // El efectivo primero; los demás por tipo y por id (orden estable).
    .sort((a, b) => (a.tipo === "EFECTIVO" ? -1 : b.tipo === "EFECTIVO" ? 1 : a.tipo < b.tipo ? -1 : a.tipo > b.tipo ? 1 : a.medioDePagoId < b.medioDePagoId ? -1 : 1));
  const monedas = s.arqueos.reduce((suma, a) => (a.contadoMonedas === null ? suma : suma + centavosDeDecimal(a.contadoMonedas)), BigInt(0));
  return {
    sesionId: s.id,
    fechaDeNegocio: s.fechaDeNegocio.toISOString().slice(0, 10),
    abiertaEn: s.abiertaEn,
    cerradaEn: s.cerradaEn,
    observacion: s.observacion,
    arqueos,
    billetes: s.billetes,
    monedasEnCentavos: monedas.toString(),
  };
}

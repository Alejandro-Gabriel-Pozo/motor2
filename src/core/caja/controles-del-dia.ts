import { armarControl, type ControlDelDia, type Severidad } from "./cierre";
import { lineaPorExplicar, type LineaDeConciliacion } from "./conciliacion";
import { textoDeCentavos } from "./dinero-de-caja";

/**
 * Los controles que la jornada entrega al cierre del día (Pedernal `caja/dominio/controles.ts` y `controles-del-dia.ts`, E3b §4.2; `ventas/aporte-al-cierre.ts`), calculados SOLO con datos que llegan ya leídos: sin reloj ni azar, así que con los
 * mismos datos dan la misma huella en cualquier orden de llegada (todo se ordena en `armarControl`). La clave es `modulo.control` en minúsculas y guion bajo; la severidad es fija por control (decisión 167 de Pedernal: impiden cerrar solo lo que
 * impide contar o cerrar bien).
 * Previene: un control que cambia de resultado según el orden de las filas (el cierre fallaría con `CONTROLES_CAMBIARON` sin que nada cambie), un detalle que cambia sin que la huella lo note y un hallazgo que no impide contar y bloquea el cierre (o al revés).
 */
export const CONTROLES_DEL_DIA = {
  /** Impide cerrar (también es un impedimento de iniciar el cierre): hay dinero todavía sin contar. */
  SESIONES_SIN_CERRAR: { modulo: "caja", clave: "caja.sesiones_sin_cerrar", severidad: "BLOQUEA" },
  DIFERENCIA_DE_ARQUEO: { modulo: "caja", clave: "caja.diferencia_de_arqueo", severidad: "RECONOCIBLE" },
  CONCILIACION_POR_MEDIO: { modulo: "caja", clave: "caja.conciliacion_por_medio", severidad: "RECONOCIBLE" },
  COBRADO_CONTRA_TICKET: { modulo: "caja", clave: "caja.cobrado_contra_ticket", severidad: "RECONOCIBLE" },
  COBROS_CORREGIDOS: { modulo: "caja", clave: "caja.cobros_corregidos", severidad: "INFORMA" },
  AJUSTES_A_JORNADAS_CERRADAS: { modulo: "caja", clave: "caja.ajustes_a_jornadas_cerradas", severidad: "INFORMA" },
  /** Una cuenta abierta no se puede cerrar ni cobrar mientras se cierra el día (Pedernal: la salida es anularla). */
  CUENTAS_ABIERTAS: { modulo: "ventas", clave: "ventas.cuentas_abiertas", severidad: "BLOQUEA" },
  TICKETS_POR_COBRAR: { modulo: "ventas", clave: "ventas.tickets_por_cobrar", severidad: "RECONOCIBLE" },
} as const satisfies Readonly<Record<string, { modulo: string; clave: string; severidad: Severidad }>>;

interface SesionParaControles {
  readonly id: string;
  readonly estado: string;
  /** Contado − esperado del efectivo al cerrarla; `null` si todavía no se cerró. */
  readonly diferenciaDeEfectivoEnCentavos: bigint | null;
}

interface CobradoContraTicket {
  readonly cobranzaId: string;
  readonly cuentaId: string;
  readonly cobradoEnCentavos: bigint;
  readonly totalDelTicketEnCentavos: bigint;
}

interface CorreccionParaControles {
  readonly id: string;
  readonly cobroId: string;
  readonly secuencia: number;
  readonly importeEnCentavos: bigint;
  readonly medioAntesId: string;
  readonly medioDespuesId: string;
}

interface AjusteParaControles {
  readonly id: string;
  readonly corrigeJornada: string;
  readonly importeEnCentavos: bigint;
  readonly medioDePagoId: string;
}

export interface DatosParaLosControles {
  readonly sesiones: readonly SesionParaControles[];
  readonly conciliacion: readonly LineaDeConciliacion[];
  /** Todas las cobranzas de la jornada con su total cobrado y el total vigente de su cuenta; el control cuenta las que difieren. */
  readonly cobradoContraTicket: readonly CobradoContraTicket[];
  readonly correcciones: readonly CorreccionParaControles[];
  /** Los ajustes de ESTA jornada que corrigen una jornada ya cerrada. */
  readonly ajustes: readonly AjusteParaControles[];
  /** Cuentas abiertas de la sucursal. */
  readonly cuentasAbiertas: readonly string[];
  /** Cuentas cerradas con venta y sin cobro cuya fecha de negocio es la de la jornada. */
  readonly cuentasPorCobrar: readonly string[];
}

const texto = (c: bigint | null): string | null => (c === null ? null : textoDeCentavos(c));

/** Los ocho controles del día (seis de caja y dos de ventas), en el orden de `CONTROLES_DEL_DIA`. */
export function controlesDelDia(d: DatosParaLosControles): readonly ControlDelDia[] {
  const abiertas = d.sesiones.filter((s) => s.estado !== "CERRADA");
  const conDiferencia = d.sesiones.filter((s) => s.diferenciaDeEfectivoEnCentavos !== null && s.diferenciaDeEfectivoEnCentavos !== BigInt(0));
  const porExplicar = d.conciliacion.filter(lineaPorExplicar);
  const difieren = d.cobradoContraTicket.filter((t) => t.cobradoEnCentavos !== t.totalDelTicketEnCentavos);
  return [
    armarControl(CONTROLES_DEL_DIA.SESIONES_SIN_CERRAR, abiertas.map((s) => [s.id, s.estado]), abiertas.map((s) => s.id)),
    armarControl(CONTROLES_DEL_DIA.DIFERENCIA_DE_ARQUEO, conDiferencia.map((s) => [s.id, texto(s.diferenciaDeEfectivoEnCentavos)]), conDiferencia.map((s) => s.id)),
    // El detalle es TODA la conciliación (lo que muestra la pantalla); la cantidad, solo lo que hay que explicar.
    armarControl(
      CONTROLES_DEL_DIA.CONCILIACION_POR_MEDIO,
      d.conciliacion.map((l) => [l.medioDePagoId, l.estado, textoDeCentavos(l.registradoEnCentavos), textoDeCentavos(l.correccionesEnCentavos), texto(l.declaradoEnCentavos), texto(l.diferenciaEnCentavos), l.conformePorId, l.conformeEn === null ? null : l.conformeEn.toISOString()]),
      porExplicar.map((l) => l.medioDePagoId),
      porExplicar.length,
    ),
    armarControl(CONTROLES_DEL_DIA.COBRADO_CONTRA_TICKET, difieren.map((t) => [t.cobranzaId, t.cuentaId, textoDeCentavos(t.cobradoEnCentavos), textoDeCentavos(t.totalDelTicketEnCentavos), textoDeCentavos(t.cobradoEnCentavos - t.totalDelTicketEnCentavos)]), difieren.map((t) => t.cuentaId)),
    armarControl(CONTROLES_DEL_DIA.COBROS_CORREGIDOS, d.correcciones.map((c) => [c.id, c.cobroId, c.secuencia, textoDeCentavos(c.importeEnCentavos), c.medioAntesId, c.medioDespuesId]), d.correcciones.map((c) => c.cobroId)),
    armarControl(CONTROLES_DEL_DIA.AJUSTES_A_JORNADAS_CERRADAS, d.ajustes.map((a) => [a.id, a.corrigeJornada, textoDeCentavos(a.importeEnCentavos), a.medioDePagoId]), d.ajustes.map((a) => a.id)),
    armarControl(CONTROLES_DEL_DIA.CUENTAS_ABIERTAS, d.cuentasAbiertas.map((id) => [id]), d.cuentasAbiertas),
    armarControl(CONTROLES_DEL_DIA.TICKETS_POR_COBRAR, d.cuentasPorCobrar.map((id) => [id]), d.cuentasPorCobrar),
  ];
}

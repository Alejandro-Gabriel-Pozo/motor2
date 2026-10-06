import { type EstadoDeTicket, type LineaDeTicket, type NumeroDeTicket } from "@/core/pos/public";
import { diaDeCalendario, finDelDia, inicioDelDia } from "@/core/tiempo/zona-horaria";

/**
 * Reporte de tickets emitidos (Task #17 del backlog): el hallazgo que lo motiva es que `TICKETS_RECIENTES_POR_MESA` (ticket.ts) ya
 * limita «Cuentas cerradas», en la pantalla de la mesa, a las 3 últimas — pero los tickets más viejas quedaban totalmente
 * inaccesibles: sin ninguna pantalla desde donde verlas, reimprimirlas (fuera de alcance acá, ver docstring de la página) o
 * corregirlas. Este reporte lista, de solo lectura, una fila por EJEMPLAR (no por Cuenta): así se ven la A, la B y sus
 * correcciones por separado, más recientes primero.
 *
 * Una cuenta cerrada ANTES de la numeración de tickets (sin ningún `EjemplarTicket`) no aparece: es esperado (ver el texto de la
 * página), no una falla del filtro.
 */

export const TAMANO_PAGINA_TICKETS = 30;

export interface FiltroTickets {
  /** Instante UTC desde el cual filtrar `emitidoEn` (inclusive) — ya resuelto: `leerFiltroTickets` lo calcula con `inicioDelDia` en la zona de la empresa. */
  desde?: Date;
  /** Instante UTC hasta el cual filtrar `emitidoEn` (inclusive) — ya resuelto con `finDelDia` en la zona de la empresa. */
  hasta?: Date;
  mesaId?: string;
  // clienteId?: string; — el modelo Cliente ya existe (Task #14), pero el FILTRO por cliente sigue fuera de alcance de esta v1
  // (ver docs/plan-reporte-tickets-emitidos-2026-09-26.md): agregarlo acá y al `where` de `listarTicketsEmitidos` no toca el resto
  // del filtro ni la firma de `leerFiltroTickets`/`serializarFiltroTickets`. Lo que SÍ se sumó ya (independiente del filtro): cada
  // fila muestra su cliente si tiene uno, y `importe` refleja lo COBRADO (con descuento), no el precio de lista — ver `detalle.cliente`.
  cursor?: string;
}

export interface LineaTicketEmitido extends LineaDeTicket {
  /** La Operacion VENTA que registró esta línea — null si la cuenta es tan vieja que el ítem no llegó a enlazarse (no debería
   *  pasar en una cuenta con `EjemplarTicket`, pero el tipo lo deja explícito en vez de asumirlo). Para el link a Trazabilidad. */
  operacionId: string | null;
}

export interface FilaTicketEmitido {
  ejemplarId: string;
  cuentaId: string;
  numero: NumeroDeTicket;
  emitidoEn: Date;
  emitidoPor: string;
  mesaNumero: number;
  /** El importe «como se imprimió» ese ejemplar (`armarTicketImpresoEn`), no el importe actual de la cuenta. */
  importe: number;
  /** Es el ÚLTIMO ejemplar de su cuenta (el más nuevo): solo sobre ella tiene sentido mostrar `estado` — una corrección vieja que
   *  ya fue reemplazada no está ni «vigente» ni «desactualizada», dejó de ser el ticket actual. */
  esUltimoEjemplar: boolean;
  /** Si este ejemplar es una corrección (B, C…): el N.º del ejemplar A que corrige (siempre el A, ver `emitirTicketCorregido`). */
  correccionDe: NumeroDeTicket | null;
  /** Si esta NO es la última: el N.º del último ejemplar de la cuenta, que la reemplazó. */
  reemplazadaPor: NumeroDeTicket | null;
  /** Solo con `esUltimoEjemplar`; null en cualquier otra fila (ver su docstring). */
  estado: EstadoDeTicket | null;
  detalle: {
    mesero: string;
    abiertaEn: Date;
    cerradaEn: Date;
    lineas: LineaTicketEmitido[];
    /** Cliente con descuento de la cuenta (Task #14), con el % congelado; null si no tiene ninguno asignado. */
    cliente: { nombre: string; descuentoPorcentaje: number } | null;
  };
}

export interface PaginaTickets {
  items: FilaTicketEmitido[];
  nextCursor: string | null;
}

/** Los filtros del reporte, leídos y validados desde los `searchParams` (string) de la página — con el mismo criterio en toda la
 *  fecha (formato de un `<input type="date">`, o vacío). Ver el docstring de la página sobre el default de «hoy». */
export interface FiltroTicketsLeido {
  /** El valor "YYYY-MM-DD" a mostrar en el input `desde` (vacío = sin límite). */
  desde: string;
  /** Igual que `desde`, para `hasta`. */
  hasta: string;
  mesaId: string;
  filtro: FiltroTickets;
}

function fechaValida(valor: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(new Date(valor).getTime());
}

/**
 * Lee `desde`/`hasta`/`mesaId`/`cursor` de los `searchParams` de `/reportes/tickets` (Task #17):
 * - SIN PARÁMETROS de fecha en absoluto (primera entrada a la pantalla, o desde el menú) → default «hoy» en la zona horaria de la empresa.
 * - Con el campo presente pero VACÍO (el form se mandó con «Vaciar fechas») → sin límite para ese lado del rango: el cursor de
 *   paginación lo aguanta igual (paso 4 del plan).
 * - Con un valor: se usa tal cual si es una fecha válida, y se descarta (como si estuviera vacío) si no.
 *
 * El día se corta en la zona de la empresa (`zonaHoraria`): el servicio de la noche cruza la medianoche UTC. `ahora` es un parámetro para
 * poder testear el default de «hoy» sin depender del reloj real.
 */
export function leerFiltroTickets(sp: { desde?: string; hasta?: string; mesaId?: string; cursor?: string }, zonaHoraria: string, ahora: Date): FiltroTicketsLeido {
  const sinParametrosDeFecha = sp.desde === undefined && sp.hasta === undefined;
  const hoy = diaDeCalendario(ahora, zonaHoraria);
  const desdeCrudo = sinParametrosDeFecha ? hoy : sp.desde ?? "";
  const hastaCrudo = sinParametrosDeFecha ? hoy : sp.hasta ?? "";
  const desde = fechaValida(desdeCrudo) ? desdeCrudo : "";
  const hasta = fechaValida(hastaCrudo) ? hastaCrudo : "";
  const mesaId = sp.mesaId || "";

  return {
    desde,
    hasta,
    mesaId,
    filtro: {
      desde: desde ? inicioDelDia(desde, zonaHoraria) : undefined,
      hasta: hasta ? finDelDia(hasta, zonaHoraria) : undefined,
      mesaId: mesaId || undefined,
      cursor: sp.cursor,
    },
  };
}

/**
 * El querystring de un link a esta pantalla con los filtros ya resueltos (para «Página siguiente», siempre con el cursor
 * nuevo). `desde`/`hasta` van SIEMPRE explícitos (aunque estén vacíos): así el link nunca vuelve a aplicar el default de «hoy» de
 * `leerFiltroTickets` (que solo aplica cuando la clave está ausente del todo).
 */
export function serializarFiltroTickets({ desde, hasta, mesaId, cursor }: { desde: string; hasta: string; mesaId?: string; cursor?: string | null }): URLSearchParams {
  const params = new URLSearchParams();
  params.set("desde", desde);
  params.set("hasta", hasta);
  if (mesaId) params.set("mesaId", mesaId);
  if (cursor) params.set("cursor", cursor);
  return params;
}
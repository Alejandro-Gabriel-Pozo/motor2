import { prisma } from "@/lib/db";
import type { Db } from "./comun";
import { armarBoletaImpresaEn, estadoDeBoleta, type EstadoDeBoleta, type ItemConVenta, type LineaDeBoleta } from "@/core/pos/boleta";
import { lineasDeVenta } from "@/core/pos/cuenta";
import { nombreDelMesero } from "@/core/pos/mesas";
import type { NumeroDeBoleta } from "@/core/pos/numeracion-boleta";
import { finDelDiaArgentina, hoyEnArgentina, inicioDelDiaArgentina } from "./rango-dia-argentina";

/**
 * Reporte de boletas emitidas (Task #17 del backlog): el hallazgo que lo motiva es que `BOLETAS_RECIENTES_POR_MESA` (boleta.ts) ya
 * limita «Cuentas cerradas», en la pantalla de la mesa, a las 3 últimas — pero las boletas más viejas quedaban totalmente
 * inaccesibles: sin ninguna pantalla desde donde verlas, reimprimirlas (fuera de alcance acá, ver docstring de la página) o
 * corregirlas. Este reporte lista, de solo lectura, una fila por EJEMPLAR (no por Cuenta): así se ven la A, la B y sus
 * correcciones por separado, más recientes primero.
 *
 * Una cuenta cerrada ANTES de la numeración de boletas (sin ningún `EjemplarBoleta`) no aparece: es esperado (ver el texto de la
 * página), no una falla del filtro.
 */

export const TAMANO_PAGINA_BOLETAS = 30;

export interface FiltroBoletas {
  /** Instante UTC desde el cual filtrar `emitidoEn` (inclusive) — ya resuelto: la página lo calcula con `inicioDelDiaArgentina`. */
  desde?: Date;
  /** Instante UTC hasta el cual filtrar `emitidoEn` (inclusive) — ya resuelto con `finDelDiaArgentina`. */
  hasta?: Date;
  mesaId?: string;
  // clienteId?: string; — el modelo Cliente ya existe (Task #14), pero el FILTRO por cliente sigue fuera de alcance de esta v1
  // (ver docs/plan-reporte-boletas-emitidas-2026-09-26.md): agregarlo acá y al `where` de `listarBoletasEmitidas` no toca el resto
  // del filtro ni la firma de `leerFiltroBoletas`/`serializarFiltroBoletas`. Lo que SÍ se sumó ya (independiente del filtro): cada
  // fila muestra su cliente si tiene uno, y `importe` refleja lo COBRADO (con descuento), no el precio de lista — ver `detalle.cliente`.
  cursor?: string;
}

export interface LineaBoletaEmitida extends LineaDeBoleta {
  /** La Operacion VENTA que registró esta línea — null si la cuenta es tan vieja que el ítem no llegó a enlazarse (no debería
   *  pasar en una cuenta con `EjemplarBoleta`, pero el tipo lo deja explícito en vez de asumirlo). Para el link a Trazabilidad. */
  operacionId: string | null;
}

export interface FilaBoletaEmitida {
  ejemplarId: string;
  cuentaId: string;
  numero: NumeroDeBoleta;
  emitidoEn: Date;
  emitidoPor: string;
  mesaNumero: number;
  /** El importe «como se imprimió» ese ejemplar (`armarBoletaImpresaEn`), no el importe actual de la cuenta. */
  importe: number;
  /** Es el ÚLTIMO ejemplar de su cuenta (el más nuevo): solo sobre ella tiene sentido mostrar `estado` — una corrección vieja que
   *  ya fue reemplazada no está ni «vigente» ni «desactualizada», dejó de ser la boleta actual. */
  esUltimoEjemplar: boolean;
  /** Si este ejemplar es una corrección (B, C…): el N.º del ejemplar A que corrige (siempre el A, ver `emitirBoletaCorregida`). */
  correccionDe: NumeroDeBoleta | null;
  /** Si esta NO es la última: el N.º del último ejemplar de la cuenta, que la reemplazó. */
  reemplazadaPor: NumeroDeBoleta | null;
  /** Solo con `esUltimoEjemplar`; null en cualquier otra fila (ver su docstring). */
  estado: EstadoDeBoleta | null;
  detalle: {
    mesero: string;
    abiertaEn: Date;
    cerradaEn: Date;
    lineas: LineaBoletaEmitida[];
    /** Cliente con descuento de la cuenta (Task #14), con el % congelado; null si no tiene ninguno asignado. */
    cliente: { nombre: string; descuentoPorcentaje: number } | null;
  };
}

export interface PaginaBoletas {
  items: FilaBoletaEmitida[];
  nextCursor: string | null;
}

/** Las líneas NETAS de la boleta «como se imprimió» en `impresaEn`, con el `operacionId` de cada una (misma agrupación que
 *  `armarBoleta`/`lineasDeVenta`: por producto y precio congelado). No toca boleta.ts: solo agrega el dato para el link a
 *  Trazabilidad, que ese módulo no necesita. */
function lineasConOperacion(items: readonly ItemConVenta[], impresaEn: Date, descuentoPorcentaje: number | null): LineaBoletaEmitida[] {
  const { lineas } = armarBoletaImpresaEn(items, impresaEn, descuentoPorcentaje);
  const vigentes = items.filter((i) => i.anuladaEn === null || i.anuladaEn > impresaEn);
  const operacionPorClave = new Map<string, string | null>();
  for (const i of vigentes) {
    const clave = `${i.productoId}|${i.precioUnitario}`;
    if (!operacionPorClave.has(clave)) operacionPorClave.set(clave, i.operacionId);
  }
  // lineasDeVenta agrupa por (productoId, precioUnitario) — misma clave que arriba y que `nombres` de armarBoleta — así que
  // `lineas` (ya sin productoId) se puede volver a asociar por posición: mismo orden, mismo largo, misma clave subyacente.
  const netas = lineasDeVenta(vigentes);
  return lineas.map((l, i) => ({ ...l, operacionId: operacionPorClave.get(`${netas[i].productoId}|${netas[i].precioUnitario}`) ?? null }));
}

/**
 * Página de boletas emitidas de la sucursal, una fila por `EjemplarBoleta`, más recientes primero (`numero desc, ejemplar desc, id
 * desc` — aprovecha el índice único `(sucursalId, numero, ejemplar)`). Paginado por cursor, mismo patrón que
 * `listarComprasRegistradas` (compras-registradas.ts): `take: N+1`, cursor por id.
 */
export async function listarBoletasEmitidas(sucursalId: string, filtro: FiltroBoletas = {}, db: Db = prisma): Promise<PaginaBoletas> {
  const { desde, hasta, mesaId, cursor } = filtro;

  const ejemplares = await db.ejemplarBoleta.findMany({
    where: {
      sucursalId,
      ...(desde || hasta ? { emitidoEn: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } } : {}),
      ...(mesaId ? { cuenta: { mesaId } } : {}),
    },
    orderBy: [{ numero: "desc" }, { ejemplar: "desc" }, { id: "desc" }],
    take: TAMANO_PAGINA_BOLETAS + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      emitidoPor: { select: { name: true, email: true } },
      corrigeA: { select: { numero: true, ejemplar: true } },
      cuenta: {
        select: {
          id: true,
          abiertaEn: true,
          cerradaEn: true,
          abiertaPor: { select: { name: true, email: true } },
          mesa: { select: { numero: true } },
          cliente: { select: { nombre: true } },
          descuentoPorcentaje: true,
          items: {
            orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
            select: {
              productoId: true,
              producto: { select: { nombre: true } },
              cantidad: true,
              precioUnitario: true,
              operacionId: true,
              operacion: { select: { anuladaEn: true } },
            },
          },
          ejemplaresBoleta: { orderBy: { ejemplar: "desc" }, take: 1, select: { numero: true, ejemplar: true } },
        },
      },
    },
  });

  const hayMas = ejemplares.length > TAMANO_PAGINA_BOLETAS;
  const pagina = hayMas ? ejemplares.slice(0, TAMANO_PAGINA_BOLETAS) : ejemplares;

  const items: FilaBoletaEmitida[] = pagina.map((e) => {
    const items: ItemConVenta[] = e.cuenta.items.map((i) => ({
      productoId: i.productoId,
      productoNombre: i.producto.nombre,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precioUnitario),
      operacionId: i.operacionId,
      anuladaEn: i.operacion?.anuladaEn ?? null,
    }));
    // Cliente con descuento (Task #14): `descuentoPorcentaje` es el SNAPSHOT congelado de la cuenta, no el % actual de `Cliente`.
    const descuentoPorcentaje = e.cuenta.descuentoPorcentaje !== null ? Number(e.cuenta.descuentoPorcentaje) : null;
    const { total } = armarBoletaImpresaEn(items, e.emitidoEn, descuentoPorcentaje);
    const ultimo = e.cuenta.ejemplaresBoleta[0];
    const esUltimoEjemplar = !ultimo || ultimo.ejemplar === e.ejemplar;

    return {
      ejemplarId: e.id,
      cuentaId: e.cuentaId,
      numero: { numero: e.numero, ejemplar: e.ejemplar },
      emitidoEn: e.emitidoEn,
      emitidoPor: nombreDelMesero(e.emitidoPor),
      mesaNumero: e.cuenta.mesa.numero,
      importe: total,
      esUltimoEjemplar,
      correccionDe: e.corrigeA ? { numero: e.corrigeA.numero, ejemplar: e.corrigeA.ejemplar } : null,
      reemplazadaPor: !esUltimoEjemplar && ultimo ? { numero: ultimo.numero, ejemplar: ultimo.ejemplar } : null,
      estado: esUltimoEjemplar ? estadoDeBoleta(items, e.emitidoEn) : null,
      detalle: {
        mesero: nombreDelMesero(e.cuenta.abiertaPor),
        abiertaEn: e.cuenta.abiertaEn,
        // e.cuenta.cerradaEn no puede ser null (hay un EjemplarBoleta, que solo emite `cerrarCuenta` sobre una cuenta cerrada) —
        // el `?? e.emitidoEn` es solo una defensa de tipos, nunca se ejecuta con datos reales.
        cerradaEn: e.cuenta.cerradaEn ?? e.emitidoEn,
        lineas: lineasConOperacion(items, e.emitidoEn, descuentoPorcentaje),
        cliente: e.cuenta.cliente && descuentoPorcentaje !== null ? { nombre: e.cuenta.cliente.nombre, descuentoPorcentaje } : null,
      },
    };
  });

  return { items, nextCursor: hayMas ? pagina[pagina.length - 1].id : null };
}

/** El número de la mesa filtrada, para el chip «Filtrando por Mesa N» de la página — null si `mesaId` no existe en esta
 *  sucursal (link viejo, mesa borrada). Una consulta chica, aparte de `listarBoletasEmitidas` porque esa lista puede volver
 *  vacía (sin boletas en el rango) y aun así hay que poder mostrar de qué mesa se está filtrando. */
export async function obtenerNumeroDeMesa(sucursalId: string, mesaId: string, db: Db = prisma): Promise<number | null> {
  const mesa = await db.mesa.findFirst({ where: { id: mesaId, sucursalId }, select: { numero: true } });
  return mesa?.numero ?? null;
}

/** Los filtros del reporte, leídos y validados desde los `searchParams` (string) de la página — con el mismo criterio en toda la
 *  fecha (formato de un `<input type="date">`, o vacío). Ver el docstring de la página sobre el default de «hoy». */
export interface FiltroBoletasLeido {
  /** El valor "YYYY-MM-DD" a mostrar en el input `desde` (vacío = sin límite). */
  desde: string;
  /** Igual que `desde`, para `hasta`. */
  hasta: string;
  mesaId: string;
  filtro: FiltroBoletas;
}

function fechaValida(valor: string): boolean {
  return valor !== "" && !Number.isNaN(new Date(valor).getTime());
}

/**
 * Lee `desde`/`hasta`/`mesaId`/`cursor` de los `searchParams` de `/reportes/boletas` (Task #17):
 * - SIN PARÁMETROS de fecha en absoluto (primera entrada a la pantalla, o desde el menú) → default «hoy» en hora Argentina.
 * - Con el campo presente pero VACÍO (el form se mandó con «Vaciar fechas») → sin límite para ese lado del rango: el cursor de
 *   paginación lo aguanta igual (paso 4 del plan).
 * - Con un valor: se usa tal cual si es una fecha válida, y se descarta (como si estuviera vacío) si no.
 *
 * `ahora` es un parámetro para poder testear el default de «hoy» sin depender del reloj real.
 */
export function leerFiltroBoletas(sp: { desde?: string; hasta?: string; mesaId?: string; cursor?: string }, ahora: Date = new Date()): FiltroBoletasLeido {
  const sinParametrosDeFecha = sp.desde === undefined && sp.hasta === undefined;
  const hoy = hoyEnArgentina(ahora);
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
      desde: desde ? inicioDelDiaArgentina(desde) : undefined,
      hasta: hasta ? finDelDiaArgentina(hasta) : undefined,
      mesaId: mesaId || undefined,
      cursor: sp.cursor,
    },
  };
}

/**
 * El querystring de un link a esta pantalla con los filtros ya resueltos (para «Página siguiente», siempre con el cursor
 * nuevo). `desde`/`hasta` van SIEMPRE explícitos (aunque estén vacíos): así el link nunca vuelve a aplicar el default de «hoy» de
 * `leerFiltroBoletas` (que solo aplica cuando la clave está ausente del todo).
 */
export function serializarFiltroBoletas({ desde, hasta, mesaId, cursor }: { desde: string; hasta: string; mesaId?: string; cursor?: string | null }): URLSearchParams {
  const params = new URLSearchParams();
  params.set("desde", desde);
  params.set("hasta", hasta);
  if (mesaId) params.set("mesaId", mesaId);
  if (cursor) params.set("cursor", cursor);
  return params;
}

import { prisma } from "@/lib/db";
import { redondearCantidad, type Db } from "./comun";

export interface FilaLoteProximoAVencer {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  seccionId: string;
  seccionNombre: string;
  loteVencimiento: Date;
  diasParaVencer: number;
  saldo: number;
  unidadStockNombre: string;
}

/**
 * Port de generarReporteLotesProximosAVencer_ (Reportes.js:573-592) — a
 * diferencia del original (filtrar `calcularStockActual_` entero en
 * memoria), acá el WHERE `loteVencimiento IS NOT NULL` ya va en el
 * `groupBy` de Postgres.
 */
export async function generarReporteLotesProximosAVencer(sucursalId: string, dias: number, db: Db = prisma): Promise<FilaLoteProximoAVencer[]> {
  const limiteDias = dias > 0 ? dias : 7;
  const hoy = new Date();
  hoy.setUTCHours(0, 0, 0, 0);
  const fechaLimite = new Date(hoy.getTime() + limiteDias * 86400000);

  const grupos = await db.movimientoStock.groupBy({
    by: ["productoId", "seccionId", "loteVencimiento"],
    where: { seccion: { sucursalId }, loteVencimiento: { not: null } },
    _sum: { cantidad: true },
  });

  const productoIds = Array.from(new Set(grupos.map((g) => g.productoId)));
  const seccionIds = Array.from(new Set(grupos.map((g) => g.seccionId)));
  const [productos, secciones] = await Promise.all([
    db.producto.findMany({ where: { id: { in: productoIds } }, include: { unidadStock: true } }),
    db.seccion.findMany({ where: { id: { in: seccionIds } } }),
  ]);
  const productoPorId = new Map(productos.map((p) => [p.id, p]));
  const seccionPorId = new Map(secciones.map((s) => [s.id, s]));

  const filas: FilaLoteProximoAVencer[] = [];
  for (const g of grupos) {
    const lote = g.loteVencimiento!;
    const saldo = Number(g._sum.cantidad ?? 0);
    if (saldo <= 0 || lote > fechaLimite) continue;
    const producto = productoPorId.get(g.productoId);
    const seccion = seccionPorId.get(g.seccionId);
    if (!producto || !seccion) continue;

    filas.push({
      productoId: producto.id,
      productoCodigo: producto.codigo,
      productoNombre: producto.nombre,
      seccionId: seccion.id,
      seccionNombre: seccion.nombre,
      loteVencimiento: lote,
      diasParaVencer: Math.round((lote.getTime() - hoy.getTime()) / 86400000),
      saldo: redondearCantidad(saldo),
      unidadStockNombre: producto.unidadStock.nombre,
    });
  }

  return filas.sort((a, b) => a.diasParaVencer - b.diasParaVencer);
}

export interface FilaConciliacionVencimiento {
  productoNombre: string;
  seccionNombre: string;
  loteVencimiento: Date;
  cantidadDesaparecida: number;
  conteoAnteriorFecha: string;
  conteoActualFecha: string;
  ventasPeriodo: number;
  estado: "consistente" | "revisar";
}

function diaDe(f: Date): string {
  return f.toISOString().slice(0, 10);
}

/**
 * Port de sumarVentasYConsumosDeProducto_ (Reportes.js:595-618) — suma
 * cuánto se vendió/consumió (Venta + Consumo, ambas signoStock −1) de un
 * producto entre dos días (inclusive). `cantidad` ya viene con signo
 * aplicado (ver MovimientoStock), así que la magnitud es `Math.abs(SUM)`.
 */
async function sumarVentasYConsumosDeProducto(sucursalId: string, productoId: string, diaInicio: string, diaFin: string, db: Db): Promise<number> {
  const desde = new Date(`${diaInicio}T00:00:00.000Z`);
  const hasta = new Date(`${diaFin}T23:59:59.999Z`);

  const suma = await db.movimientoStock.aggregate({
    where: {
      productoId,
      seccion: { sucursalId },
      proceso: { in: ["VENTA", "CONSUMO"] },
      operacion: { fecha: { gte: desde, lte: hasta } },
    },
    _sum: { cantidad: true },
  });
  return Math.abs(Number(suma._sum.cantidad ?? 0));
}

/**
 * Port de generarConciliacionVencimientos_ (Reportes.js:625-680) — compara,
 * sección por sección, los conteos físicos POR LOTE de dos jornadas
 * consecutivas: si un lote que se contaba con saldo > 0 ya no aparece (o
 * aparece en 0) en el conteo siguiente, cruza el volumen de ventas+consumos
 * del período contra lo que tenía ese lote.
 *
 * Limitación a propósito (igual que el original): solo cubre lotes
 * contados CON Fecha VTO específica — si nunca se contó por lote, no hay
 * con qué comparar la desaparición puntual.
 */
export async function generarConciliacionVencimientos(sucursalId: string, db: Db = prisma): Promise<FilaConciliacionVencimiento[]> {
  const conteos = await db.conteoFisico.findMany({
    where: { sucursalId, loteVencimiento: { not: null } },
    include: { producto: true, seccion: true },
    orderBy: [{ fecha: "asc" }, { creadoEn: "asc" }],
  });
  if (!conteos.length) return [];

  type Registro = (typeof conteos)[number];
  const porSeccion = new Map<string, Map<string, Map<string, Registro>>>(); // seccionNombre -> dia -> lotKey -> registro

  for (const c of conteos) {
    const sec = c.seccion.nombre;
    const dia = diaDe(c.fecha);
    const lotKey = `${c.productoId}||${c.loteVencimiento!.toISOString().slice(0, 10)}`;
    if (!porSeccion.has(sec)) porSeccion.set(sec, new Map());
    const sesionesDia = porSeccion.get(sec)!;
    if (!sesionesDia.has(dia)) sesionesDia.set(dia, new Map());
    sesionesDia.get(dia)!.set(lotKey, c); // si se contó 2 veces ese día, se queda con la última (orden asc de fecha, luego creadoEn ya viene en orden natural)
  }

  const resultados: FilaConciliacionVencimiento[] = [];

  for (const [seccion, sesionesPorDia] of porSeccion) {
    const dias = Array.from(sesionesPorDia.keys()).sort();

    for (let i = 1; i < dias.length; i++) {
      const diaAnterior = dias[i - 1];
      const diaActual = dias[i];
      const lotesAnterior = sesionesPorDia.get(diaAnterior)!;
      const lotesActual = sesionesPorDia.get(diaActual)!;

      for (const [lotKey, infoAnterior] of lotesAnterior) {
        if (Number(infoAnterior.conteoReal) <= 0) continue; // no había nada que pudiera "desaparecer"

        const infoActual = lotesActual.get(lotKey);
        const desaparecio = !infoActual || Number(infoActual.conteoReal) === 0;
        if (!desaparecio) continue;

        const ventasPeriodo = await sumarVentasYConsumosDeProducto(sucursalId, infoAnterior.productoId, diaAnterior, diaActual, db);
        const conteoReal = Number(infoAnterior.conteoReal);
        const estado: "consistente" | "revisar" = ventasPeriodo >= conteoReal ? "consistente" : "revisar";

        resultados.push({
          productoNombre: infoAnterior.producto.nombre,
          seccionNombre: seccion,
          loteVencimiento: infoAnterior.loteVencimiento!,
          cantidadDesaparecida: redondearCantidad(conteoReal),
          conteoAnteriorFecha: diaAnterior,
          conteoActualFecha: diaActual,
          ventasPeriodo: redondearCantidad(ventasPeriodo),
          estado,
        });
      }
    }
  }

  return resultados.sort((a, b) => (a.estado === "revisar" ? -1 : 1) - (b.estado === "revisar" ? -1 : 1));
}

/** Port de obtenerReporteVencimientosDatos (Reportes.js:683-689). */
export async function obtenerReporteVencimientosDatos(sucursalId: string, dias: number, db: Db = prisma) {
  const [proximosAVencer, conciliacion] = await Promise.all([
    generarReporteLotesProximosAVencer(sucursalId, dias || 7, db),
    generarConciliacionVencimientos(sucursalId, db),
  ]);
  return { proximosAVencer, conciliacion, diasUsados: dias > 0 ? dias : 7 };
}

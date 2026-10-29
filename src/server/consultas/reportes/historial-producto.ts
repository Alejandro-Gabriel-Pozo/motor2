import { Prisma } from "@prisma/client";
import { ZONA_ARGENTINA, rangoDeDias } from "@/core/tiempo/zona-horaria";
import { tieneStockReal } from "@/core/movimientos/public";
import { rendimientoEfectivo } from "@/core/catalogo/public";
import { alcanceDeSucursal } from "@/core/catalogo/public";
import { cargarRecetaVigente } from "@/server/lecturas/catalogo/recetas-vigentes";
import type { Db } from "@/lib/db-tipos";
import { redondearCantidad } from "@/core/reportes/public";
import type { EventoHistorialProducto, HistorialProducto, IngredienteRecetaVigente } from "@/core/reportes/public";

/** La fila del `$queryRaw` de movimientos de `obtenerHistorialProducto` (Fase 6, tramo 6b: vivía en `core/reportes/historial-producto.ts` con `Prisma.Decimal`; este es su único lector). */
interface FilaMovimientoHistorial {
  id: string;
  operacionId: string;
  proceso: string;
  cantidad: Prisma.Decimal;
  loteVencimiento: Date | null;
  detalle: string;
  precioTotal: Prisma.Decimal;
  precioPorUnidadStock: Prisma.Decimal;
  seccionNombre: string;
  fecha: Date;
  nroFactura: string | null;
  anuladaEn: Date | null;
  proveedorNombre: string | null;
  sustituyeANombre: string | null;
}

/**
 * Port de obtenerHistorialProducto (Reportes.js:1241-1331). `seccionId`
 * vacío = todas las secciones (el saldo corriente mezcla entradas/salidas
 * de todas, mismo criterio que Conteo Físico: sección opcional).
 * `desde`/`hasta` son SOLO para qué se MUESTRA: el saldo corriente siempre
 * arranca del primer movimiento real del producto, nunca se "resetea" a 0
 * en la fecha de inicio del filtro. `desde`/`hasta` llegan como fecha "de solo día" (00:00 UTC del día elegido) y se expanden a días COMPLETOS en `zona` (la de la
 * empresa, `ctx.empresaZonaHoraria`; por defecto la argentina): los DOS lados, y el saldo inicial usa el mismo límite que el detalle, así que los números cierran.
 *
 * A diferencia de Apps Script (que reconstruía el signo con
 * signoDeProceso_/esDeltaConSignoLibre_ al leer), acá `cantidad` ya viene
 * con el signo aplicado (ver docstring de MovimientoStock) — el saldo
 * corriente es, directo, la suma acumulada en orden cronológico.
 */
export async function obtenerHistorialProducto(
  sucursalId: string,
  productoId: string,
  seccionId: string | undefined,
  desde: Date | undefined,
  hasta: Date | undefined,
  db: Db,
  zona: string = ZONA_ARGENTINA
): Promise<HistorialProducto | null> {
  const producto = await db.producto.findUnique({ where: { id: productoId }, include: { unidadStock: true } });
  if (!producto) return null;

  const whereMov = { productoId, seccion: { sucursalId }, ...(seccionId ? { seccionId } : {}) };
  const whereConteo = { productoId, sucursalId, ...(seccionId ? { seccionId } : {}) };

  // Rango [desde 00:00, hasta 23:59:59.999] en la zona de la empresa — el mismo corte que Tickets.
  const inicioDia = desde ? rangoDeDias(desde, desde, zona).desde : undefined;
  const finDia = hasta ? rangoDeDias(hasta, hasta, zona).hasta : undefined;
  const filtroFechaConteo = inicioDia || finDia ? { fecha: { ...(inicioDia ? { gte: inicioDia } : {}), ...(finDia ? { lte: finDia } : {}) } } : {};

  // Optimización (Pivote 5, docs/auditoria-motor2-pivotes-2026-09-16.md
  // §11 Plan 3): antes, esta función cargaba TODO el historial del
  // producto sin filtrar por fecha en la query, sin importar qué rango
  // pidiera el usuario — crecía sin límite con productos longevos. Ahora
  // el detalle SOLO trae lo que cae dentro de [desde,hasta] (si se pidió
  // alguno), y "saldoInicial" (agregado, no el detalle) captura el efecto
  // de todo lo anterior a `desde` — la cuenta final da EXACTO lo mismo que
  // sumar el historial completo hasta ese punto, sin cargarlo entero.
  // saldoActual/totalMovimientos/totalConteos siguen siendo el total real
  // (de siempre, no del rango) — invariante documentada arriba y en la UI
  // (reportes/historial/page.tsx: "no del rango elegido") — se calculan
  // aparte, sin filtro de fecha, nunca a partir del detalle recortado.
  const [saldoInicial, saldoActualAgg, totalMovimientos, totalConteos, movimientos, conteos] = await Promise.all([
    inicioDia
      ? db.movimientoStock.aggregate({ where: { ...whereMov, operacion: { fecha: { lt: inicioDia } } }, _sum: { cantidad: true } }).then((r) => Number(r._sum.cantidad ?? 0))
      : Promise.resolve(0),
    db.movimientoStock.aggregate({ where: whereMov, _sum: { cantidad: true } }).then((r) => Number(r._sum.cantidad ?? 0)),
    db.movimientoStock.count({ where: whereMov }),
    db.conteoFisico.count({ where: whereConteo }),
    // Un solo SQL con los JOIN, no `findMany` + `include`: Prisma 7 resuelve cada relación con un `IN` de todos los ids y con ~60k
    // movimientos superaba el límite de parámetros. La sucursal fija la empresa (`Seccion` y `Operacion` la comparten por FK
    // compuesta); el aislamiento entre empresas lo sigue haciendo el `db` recibido (RLS, A6). Mismo orden de siempre por fecha;
    // el desempate por `m."id"` lo hace determinista.
    db.$queryRaw<FilaMovimientoHistorial[]>`
      SELECT m."id", m."operacionId", m."proceso", m."cantidad", m."loteVencimiento", m."detalle", m."precioTotal", m."precioPorUnidadStock",
             s."nombre" AS "seccionNombre", o."fecha", o."nroFactura", o."anuladaEn", p."nombre" AS "proveedorNombre", sp."nombre" AS "sustituyeANombre"
      FROM "MovimientoStock" m
      JOIN "Seccion" s ON s."id" = m."seccionId"
      JOIN "Operacion" o ON o."id" = m."operacionId"
      LEFT JOIN "Proveedor" p ON p."id" = o."proveedorId"
      LEFT JOIN "Producto" sp ON sp."id" = m."sustituyeAProductoId"
      WHERE m."productoId" = ${productoId} AND s."sucursalId" = ${sucursalId}
        ${seccionId ? Prisma.sql`AND m."seccionId" = ${seccionId}` : Prisma.empty}
        ${inicioDia ? Prisma.sql`AND o."fecha" >= ${inicioDia}` : Prisma.empty}
        ${finDia ? Prisma.sql`AND o."fecha" <= ${finDia}` : Prisma.empty}
      ORDER BY o."fecha", m."id"
    `,
    db.conteoFisico.findMany({
      where: { ...whereConteo, ...filtroFechaConteo },
      include: { seccion: true },
    }),
  ]);

  const eventosMovimiento: EventoHistorialProducto[] = movimientos.map((m) => ({
    tipo: "movimiento",
    fecha: m.fecha,
    detalle: m.detalle,
    seccionNombre: m.seccionNombre,
    proceso: m.proceso,
    loteVencimiento: m.loteVencimiento,
    proveedorNombre: m.proveedorNombre,
    nroFactura: m.nroFactura,
    idOperacion: m.operacionId,
    cantidadConSigno: Number(m.cantidad),
    precioTotal: Number(m.precioTotal),
    precioPorUnidadStock: Number(m.precioPorUnidadStock),
    anulada: m.anuladaEn !== null,
    sustituyeANombre: m.sustituyeANombre,
  }));

  const eventosConteo: EventoHistorialProducto[] = conteos.map((c) => ({
    tipo: "conteo",
    fecha: c.fecha,
    detalle: `Conteo físico: ${c.accion}${c.detalle ? " — " + c.detalle : ""}`,
    seccionNombre: c.seccion.nombre,
    saldoSistema: Number(c.saldoSistema),
    conteoReal: Number(c.conteoReal),
    diferencia: Number(c.diferencia),
    estado: c.estado,
  }));

  // Orden cronológico ASCENDENTE de lo que cae en el rango pedido — el
  // saldo corriente arranca de saldoInicial (todo lo anterior a `desde`
  // ya resumido en un número), nunca de 0.
  const eventosVisibles = [...eventosMovimiento, ...eventosConteo].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  let saldo = saldoInicial;
  for (const ev of eventosVisibles) {
    if (ev.tipo !== "movimiento") continue;
    saldo += ev.cantidadConSigno!;
    ev.saldoCorriente = redondearCantidad(saldo);
  }

  return {
    productoId: producto.id,
    codigo: producto.codigo,
    producto: producto.nombre,
    tipo: producto.tipo,
    unidadStockNombre: producto.unidadStock.nombre,
    saldoActual: redondearCantidad(saldoActualAgg),
    eventos: eventosVisibles,
    totalMovimientos,
    totalConteos,
    tieneStockPropio: tieneStockReal(producto.tipo, producto.seProduce),
  };
}

/**
 * Ingredientes de la receta VIGENTE de un producto (MAX(version) — mismo
 * criterio derivado que ya usan venta.ts, movimientos.ts y comun.ts). Sirve
 * al cartel "Producto de reventa" de un PV sin stock propio (§4, decisión
 * 8): en vez de un saldo sin sentido, explica de qué está hecho y enlaza a
 * su receta.
 *
 * NO reusa `obtenerRecetaVigente` de `server/actions/catalogo/recetas.ts`:
 * esa función exige el permiso `guardar_receta`, que le negaría esta
 * pantalla a un usuario con solo `reporte_historial`.
 *
 * `sucursalId` (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, R3): con ella, `cantidad` sale EFECTIVA (con la
 * calibración de esa sucursal si la hay); sin ella, queda en el valor central.
 */
export async function obtenerIngredientesRecetaVigente(productoId: string, db: Db, sucursalId?: string): Promise<IngredienteRecetaVigente[]> {
  const version = await cargarRecetaVigente(db, alcanceDeSucursal(sucursalId), productoId, {
    include: {
      ingredientes: {
        include: {
          insumoProducto: { select: { nombre: true } },
          unidad: { select: { nombre: true } },
          rendimientosLocales: { where: { sucursalId: sucursalId ?? "" } },
        },
      },
    },
  });
  if (!version) return [];
  return version.ingredientes.map((i) => {
    const cantidadCentral = Number(i.cantidad);
    const cantidad = sucursalId
      ? rendimientoEfectivo(
          { cantidad: cantidadCentral, mermaPorcentaje: 0 },
          i.rendimientosLocales.map((r) => ({ sucursalId: r.sucursalId, cantidad: r.cantidad !== null ? Number(r.cantidad) : null, mermaPorcentaje: null })),
          sucursalId
        ).cantidad
      : cantidadCentral;
    return { nombre: i.insumoProducto.nombre, cantidad, unidad: i.unidad.nombre };
  });
}
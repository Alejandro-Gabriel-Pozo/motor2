import { prisma } from "@/lib/db";
import { tieneStockReal } from "@/core/movimientos/public";
import { disponibilidadDeProductos } from "@/core/catalogo/public-servidor";
import { rendimientoEfectivo } from "@/core/catalogo/public";
import { redondearCantidad, type Db } from "./comun";

export interface FilaBusquedaProducto {
  productoId: string;
  codigo: string;
  nombre: string;
  tipo: "MP" | "PV";
  /** Disponible EN `sucursalId` (docs/plan-disponibilidad-por-sucursal-2026-09-23.md) — ya no es `Producto.activo` global. */
  disponible: boolean;
}

/**
 * Port de buscarProductoParaHistorial (Reportes.js:1217-1230) — a
 * diferencia de otros buscadores del proyecto (compra, conteo, precio
 * local), incluye NO DISPONIBLES a propósito: se puede querer ver el
 * historial de algo que ya se discontinuó en esta sucursal.
 */
export async function buscarProductoParaHistorial(sucursalId: string, termino: string, db: Db = prisma): Promise<FilaBusquedaProducto[]> {
  const q = termino.trim();
  const productos = await db.producto.findMany({
    where: q ? { OR: [{ nombre: { contains: q, mode: "insensitive" } }, { codigo: { contains: q, mode: "insensitive" } }] } : {},
    take: 20,
    orderBy: { nombre: "asc" },
  });
  const disponibilidad = await disponibilidadDeProductos(sucursalId, productos.map((p) => p.id), db);
  return productos.map((p) => ({ productoId: p.id, codigo: p.codigo, nombre: p.nombre, tipo: p.tipo, disponible: disponibilidad.get(p.id) === true }));
}

export interface EventoHistorialProducto {
  tipo: "movimiento" | "conteo";
  fecha: Date;
  detalle: string;
  seccionNombre: string;
  // Solo `tipo === "movimiento"`:
  proceso?: string;
  loteVencimiento?: Date | null;
  proveedorNombre?: string | null;
  nroFactura?: string | null;
  idOperacion?: string;
  cantidadConSigno?: number;
  saldoCorriente?: number;
  /** Importe real de la línea (0 si no representa un hecho financiero propio — ver docstring de MovimientoStock.precioTotal). Para "Cómo se vendió" (§4). */
  precioTotal?: number;
  /** Precio por unidad de stock (0 en líneas sin hecho financiero propio). Para "Cómo se compró" — variación contra la compra anterior (§4, decisión 3). */
  precioPorUnidadStock?: number;
  /** La Operación de esta línea está anulada — mismo criterio que ItemPeriodo.anulada (periodo.ts): el Kardex la sigue mostrando (append-only, auditoría), pero "Cómo se compró"/"Cómo se vendió" la excluyen (una compra/venta anulada no ocurrió). */
  anulada?: boolean;
  /** D6 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): solo en un CONSUMO que salió de un insumo SUSTITUTO — el nombre del
   * producto de la receta al que reemplazó. Ausente/null en todo lo demás (incluido un consumo de un hermano del mismo Insumo). */
  sustituyeANombre?: string | null;
  // Solo `tipo === "conteo"`:
  saldoSistema?: number;
  conteoReal?: number;
  diferencia?: number;
  estado?: string;
}

export interface HistorialProducto {
  productoId: string;
  codigo: string;
  producto: string;
  tipo: "MP" | "PV";
  unidadStockNombre: string;
  saldoActual: number;
  eventos: EventoHistorialProducto[];
  totalMovimientos: number;
  totalConteos: number;
  /**
   * `tieneStockReal(tipo, seProduce)` — mismo predicado que ya filtra
   * consolidado/valuación/alertas/conteo/traspasos/catálogo (docs/grounding-
   * historial-producto-mp-pv-2026-09-22.md §1.3: esta pantalla era la única
   * superficie de stock del proyecto que no lo consultaba). `false` para un
   * PV que no se produce: el saldo corriente de ese producto es un
   * artefacto contable (unidades vendidas acumuladas, sin sentido físico de
   * stock) — la UI usa este flag para mostrar el cartel "Producto de
   * reventa" en vez del saldo (§4, decisiones 7-8).
   */
  tieneStockPropio: boolean;
}

/**
 * Port de obtenerHistorialProducto (Reportes.js:1241-1331). `seccionId`
 * vacío = todas las secciones (el saldo corriente mezcla entradas/salidas
 * de todas, mismo criterio que Conteo Físico: sección opcional).
 * `desde`/`hasta` son SOLO para qué se MUESTRA: el saldo corriente siempre
 * arranca del primer movimiento real del producto, nunca se "resetea" a 0
 * en la fecha de inicio del filtro.
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
  db: Db = prisma
): Promise<HistorialProducto | null> {
  const producto = await db.producto.findUnique({ where: { id: productoId }, include: { unidadStock: true } });
  if (!producto) return null;

  const whereMov = { productoId, seccion: { sucursalId }, ...(seccionId ? { seccionId } : {}) };
  const whereConteo = { productoId, sucursalId, ...(seccionId ? { seccionId } : {}) };

  // Rango [desde 00:00, hasta 23:59:59.999] — mismo criterio UTC que
  // reportes/periodo.ts.
  const finDia = hasta ? new Date(hasta) : undefined;
  finDia?.setUTCHours(23, 59, 59, 999);
  const filtroFechaMov = desde || finDia ? { operacion: { fecha: { ...(desde ? { gte: desde } : {}), ...(finDia ? { lte: finDia } : {}) } } } : {};
  const filtroFechaConteo = desde || finDia ? { fecha: { ...(desde ? { gte: desde } : {}), ...(finDia ? { lte: finDia } : {}) } } : {};

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
    desde
      ? db.movimientoStock.aggregate({ where: { ...whereMov, operacion: { fecha: { lt: desde } } }, _sum: { cantidad: true } }).then((r) => Number(r._sum.cantidad ?? 0))
      : Promise.resolve(0),
    db.movimientoStock.aggregate({ where: whereMov, _sum: { cantidad: true } }).then((r) => Number(r._sum.cantidad ?? 0)),
    db.movimientoStock.count({ where: whereMov }),
    db.conteoFisico.count({ where: whereConteo }),
    db.movimientoStock.findMany({
      where: { ...whereMov, ...filtroFechaMov },
      include: { seccion: true, operacion: { include: { proveedor: true } }, sustituyeAProducto: { select: { nombre: true } } },
    }),
    db.conteoFisico.findMany({
      where: { ...whereConteo, ...filtroFechaConteo },
      include: { seccion: true },
    }),
  ]);

  const eventosMovimiento: EventoHistorialProducto[] = movimientos.map((m) => ({
    tipo: "movimiento",
    fecha: m.operacion.fecha,
    detalle: m.detalle,
    seccionNombre: m.seccion.nombre,
    proceso: m.proceso,
    loteVencimiento: m.loteVencimiento,
    proveedorNombre: m.operacion.proveedor?.nombre ?? null,
    nroFactura: m.operacion.nroFactura,
    idOperacion: m.operacionId,
    cantidadConSigno: Number(m.cantidad),
    precioTotal: Number(m.precioTotal),
    precioPorUnidadStock: Number(m.precioPorUnidadStock),
    anulada: m.operacion.anuladaEn !== null,
    sustituyeANombre: m.sustituyeAProducto?.nombre ?? null,
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

export interface IngredienteRecetaVigente {
  nombre: string;
  cantidad: number;
  unidad: string;
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
 * pantalla a un usuario con solo `ver_reportes_operativos`.
 *
 * `sucursalId` (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, R3): con ella, `cantidad` sale EFECTIVA (con la
 * calibración de esa sucursal si la hay); sin ella, queda en el valor central.
 */
export async function obtenerIngredientesRecetaVigente(productoId: string, db: Db = prisma, sucursalId?: string): Promise<IngredienteRecetaVigente[]> {
  const version = await db.recetaVersion.findFirst({
    where: { productoId },
    orderBy: { version: "desc" },
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

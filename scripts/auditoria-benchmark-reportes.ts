/**
 * Pivote 5 (Escalabilidad de saldos y reportes) — benchmark con un
 * escenario representativo acordado con el negocio: 500 movimientos/día,
 * 8 sucursales, 3 años de historial (extremo bajo del rango "500-1000
 * mov/día, 5-10 sucursales, 3-5 años" para mantener el tiempo de
 * generación manejable en esta sesión — documentado como límite de
 * alcance, no como el volumen máximo esperado).
 *
 * Genera datos vía SQL bulk (generate_series), no vía los Server Actions
 * reales — acá interesa medir el costo de LEER un Kardex de ese tamaño,
 * no el costo de escribirlo movimiento por movimiento.
 *
 * Corre UNA vez contra motor2_test (DATABASE_URL de .env), deja los datos
 * generados al final para poder inspeccionarlos con `db:studio` si hace
 * falta — correr `npx tsx scripts/auditoria-benchmark-reportes.ts --limpiar`
 * para borrar todo lo generado por este script al terminar.
 *
 * Uso: npx tsx scripts/auditoria-benchmark-reportes.ts
 */
import "dotenv/config";
import { prisma } from "./demo-seed/cliente";
import { calcularSaldoTotal } from "../src/server/lecturas/movimientos/saldos";
import { calcularStockConsolidado } from "../src/server/consultas/stock/consolidado";
import { calcularStockPorFamilia } from "../src/server/consultas/stock/por-familia";
import { calcularAlertasStock } from "../src/server/consultas/stock/alertas";
import { obtenerHistorialProducto } from "../src/server/consultas/reportes/historial-producto";
import { obtenerReportePorPeriodo } from "../src/server/consultas/reportes/periodo";

const N_SUCURSALES = 8;
const N_SECCIONES_POR_SUCURSAL = 5;
const N_PRODUCTOS = 300;
const MOVIMIENTOS_POR_DIA = 500;
const DIAS_HISTORIAL = 3 * 365; // 3 años
const TOTAL_MOVIMIENTOS_OBJETIVO = MOVIMIENTOS_POR_DIA * DIAS_HISTORIAL; // 547.500

async function medir<T>(etiqueta: string, fn: () => Promise<T>): Promise<T> {
  const inicio = performance.now();
  const resultado = await fn();
  const ms = performance.now() - inicio;
  console.log(`  ${etiqueta}: ${ms.toFixed(1)}ms`);
  return resultado;
}

async function main() {
  console.log(`=== Benchmark Pivote 5 — ${new Date().toISOString()} ===`);
  console.log(`Escenario: ${MOVIMIENTOS_POR_DIA} mov/día × ${DIAS_HISTORIAL} días × ${N_SUCURSALES} sucursales ≈ ${TOTAL_MOVIMIENTOS_OBJETIVO.toLocaleString("es-AR")} movimientos objetivo\n`);

  console.log("--- Generando catálogo base ---");
  const unidad = await prisma.unidad.create({ data: { nombre: "u_benchmark", magnitud: "PESO", decimales: 2 } });
  const insumo = await prisma.insumo.create({ data: { nombre: "insumo_benchmark" } });

  const sucursales: { id: string }[] = [];
  for (let i = 0; i < N_SUCURSALES; i++) sucursales.push(await prisma.sucursal.create({ data: { nombre: `Bench Sucursal ${i}` } }));

  const secciones: { id: string; sucursalId: string }[] = [];
  for (const suc of sucursales) {
    for (let s = 0; s < N_SECCIONES_POR_SUCURSAL; s++) {
      secciones.push(await prisma.seccion.create({ data: { sucursalId: suc.id, nombre: `Bench Sección ${s}` } }));
    }
  }

  const productos: { id: string }[] = [];
  const productosData = Array.from({ length: N_PRODUCTOS }, (_, i) => ({
    codigo: `BENCH_${i}`,
    nombre: `Producto Benchmark ${i}`,
    tipo: "MP" as const,
    unidadStockId: unidad.id,
    insumoId: insumo.id,
  }));
  await prisma.producto.createMany({ data: productosData });
  const productosCreados = await prisma.producto.findMany({ where: { codigo: { startsWith: "BENCH_" } }, select: { id: true } });
  productos.push(...productosCreados);

  const usuario = await prisma.user.create({ data: { email: "benchmark@test.com" } });

  console.log(`Catálogo: ${sucursales.length} sucursales, ${secciones.length} secciones, ${productos.length} productos\n`);

  console.log("--- Generando Operaciones + MovimientoStock vía SQL bulk (generate_series) ---");
  const inicioGen = performance.now();

  // 1 Operacion por día por sucursal (simplificación: agrupa todos los
  // movimientos de ese día/sucursal bajo una sola Operacion COMPRA — lo
  // que importa para el benchmark es el volumen de MovimientoStock, la
  // cardinalidad de Operacion es secundaria).
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Operacion" (id, "sucursalId", proceso, fecha, "usuarioId", "creadoEn")
    SELECT
      'bench_op_' || suc.idx || '_' || dia,
      suc.id,
      'COMPRA',
      now() - (dia || ' days')::interval,
      '${usuario.id}',
      now()
    FROM generate_series(0, ${DIAS_HISTORIAL - 1}) AS dia
    CROSS JOIN (SELECT id, row_number() OVER () - 1 AS idx FROM "Sucursal" WHERE nombre LIKE 'Bench Sucursal%') AS suc
  `);

  const opsCreadas = await prisma.operacion.count({ where: { id: { startsWith: "bench_op_" } } });
  console.log(`  Operaciones creadas: ${opsCreadas.toLocaleString("es-AR")}`);

  // MOVIMIENTOS_POR_DIA / N_SUCURSALES movimientos por Operacion, cada uno
  // sobre un producto/sección pseudo-aleatorio (determinístico vía módulo).
  const movsPorOperacion = Math.round(MOVIMIENTOS_POR_DIA / N_SUCURSALES);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "MovimientoStock" (id, "operacionId", "productoId", "seccionId", proceso, cantidad, detalle, "precioTotal", "precioPorUnidadStock", "creadoEn")
    SELECT
      'bench_mov_' || op.id || '_' || m,
      op.id,
      prod.id,
      secc.id,
      'COMPRA',
      (1 + (m % 20))::decimal,
      'Benchmark',
      0,
      0,
      op."creadoEn"
    FROM "Operacion" op
    CROSS JOIN generate_series(0, ${movsPorOperacion - 1}) AS m
    JOIN LATERAL (
      SELECT id FROM "Producto" WHERE codigo LIKE 'BENCH_%'
      OFFSET (abs(hashtext(op.id || m::text)) % ${N_PRODUCTOS}) LIMIT 1
    ) AS prod ON true
    JOIN LATERAL (
      SELECT s.id FROM "Seccion" s WHERE s."sucursalId" = op."sucursalId"
      OFFSET (abs(hashtext(op.id || m::text || 'x')) % ${N_SECCIONES_POR_SUCURSAL}) LIMIT 1
    ) AS secc ON true
    WHERE op.id LIKE 'bench_op_%'
  `);

  const totalMovs = await prisma.movimientoStock.count({ where: { id: { startsWith: "bench_mov_" } } });
  const ms = performance.now() - inicioGen;
  console.log(`  MovimientoStock creados: ${totalMovs.toLocaleString("es-AR")} en ${(ms / 1000).toFixed(1)}s\n`);

  // Producto "caliente" — el que más movimientos acumuló entre los
  // repartidos pseudo-aleatoriamente (~2.000 en 3 años, no alcanza para
  // estresar de verdad obtenerHistorialProducto).
  const [productoCaliente] = await prisma.$queryRawUnsafe<{ productoId: string; n: bigint }[]>(`
    SELECT "productoId", count(*) as n FROM "MovimientoStock" WHERE id LIKE 'bench_mov_%' GROUP BY "productoId" ORDER BY n DESC LIMIT 1
  `);
  console.log(`Producto más movido (reparto general): ${productoCaliente.productoId} (${productoCaliente.n} movimientos)`);

  // Producto "longevo" — caso de estrés real para obtenerHistorialProducto:
  // un producto puntual con MUCHOS más movimientos concentrados que el
  // promedio (simula, ej., un insumo de uso diario en una sucursal con
  // años de antigüedad) — acá sí se nota la diferencia entre cargar todo
  // el historial vs. solo el rango pedido.
  const productoLongevo = await prisma.producto.create({
    data: { codigo: "BENCH_LONGEVO", nombre: "Producto Longevo Benchmark", tipo: "MP", unidadStockId: unidad.id, insumoId: insumo.id },
  });
  const N_MOVS_LONGEVO = 30000;
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Operacion" (id, "sucursalId", proceso, fecha, "usuarioId", "creadoEn")
    SELECT 'bench_op_longevo_' || n, '${sucursales[0]!.id}', 'COMPRA', now() - ((n % ${DIAS_HISTORIAL}) || ' days')::interval, '${usuario.id}', now()
    FROM generate_series(0, ${N_MOVS_LONGEVO - 1}) AS n
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "MovimientoStock" (id, "operacionId", "productoId", "seccionId", proceso, cantidad, detalle, "precioTotal", "precioPorUnidadStock", "creadoEn")
    SELECT 'bench_mov_longevo_' || op.id, op.id, '${productoLongevo.id}', '${secciones[0]!.id}', 'COMPRA', 1, 'Benchmark longevo', 0, 0, op."creadoEn"
    FROM "Operacion" op WHERE op.id LIKE 'bench_op_longevo_%'
  `);
  console.log(`Producto longevo creado: ${productoLongevo.id} (${N_MOVS_LONGEVO.toLocaleString("es-AR")} movimientos concentrados en 1 producto+sección, distribuidos en los ${DIAS_HISTORIAL} días del historial)\n`);

  console.log("--- Mediciones (8 puntos del plan) ---\n");

  console.log("1) Saldo por producto y sección (calcularSaldoTotal):");
  await medir("calcularSaldoTotal (producto caliente, sección arbitraria)", () => calcularSaldoTotal(productoCaliente.productoId, secciones[0]!.id, secciones[0]!.sucursalId, prisma));

  console.log("\n2) Stock consolidado (calcularStockConsolidado, TODA la sucursal):");
  await medir("calcularStockConsolidado", () => calcularStockConsolidado(sucursales[0]!.id, prisma));

  console.log("\n3) Stock por familia (calcularStockPorFamilia):");
  await medir("calcularStockPorFamilia", () => calcularStockPorFamilia(sucursales[0]!.id, prisma));

  console.log("\n4) Alertas de mínimos (calcularAlertasStock):");
  await medir("calcularAlertasStock", () => calcularAlertasStock(sucursales[0]!.id, prisma));

  console.log("\n5) Historial de producto — CASO NORMAL (producto con pocos movimientos):");
  const productoFrio = productos[0]!.id;
  await medir("obtenerHistorialProducto (producto frío, sin filtro de fecha)", () =>
    obtenerHistorialProducto(sucursales[0]!.id, productoFrio, undefined, undefined, undefined, prisma)
  );

  console.log("\n5b) Historial de producto — producto 'caliente' del reparto general, filtrando solo el último mes:");
  const haceUnMes = new Date();
  haceUnMes.setDate(haceUnMes.getDate() - 30);
  await medir("obtenerHistorialProducto (producto caliente, desde=hace 1 mes)", () =>
    obtenerHistorialProducto(sucursales[0]!.id, productoCaliente.productoId, undefined, haceUnMes, new Date(), prisma)
  );

  console.log("\n5c) Historial de producto — CASO DE ESTRÉS REAL: producto longevo (30.000 movimientos), filtrando solo el último mes:");
  await medir(`obtenerHistorialProducto (producto longevo, ${N_MOVS_LONGEVO.toLocaleString("es-AR")} movimientos totales, desde=hace 1 mes)`, () =>
    obtenerHistorialProducto(sucursales[0]!.id, productoLongevo.id, undefined, haceUnMes, new Date(), prisma)
  );

  console.log("\n5d) Historial de producto — mismo producto longevo, SIN filtro de fecha (siempre carga todo, antes y después):");
  await medir("obtenerHistorialProducto (producto longevo, sin filtro de fecha)", () =>
    obtenerHistorialProducto(sucursales[0]!.id, productoLongevo.id, undefined, undefined, undefined, prisma)
  );

  console.log("\n6) Reporte por período (obtenerReportePorPeriodo, rango amplio: 3 años completos):");
  const hace3Anios = new Date();
  hace3Anios.setFullYear(hace3Anios.getFullYear() - 3);
  await medir("obtenerReportePorPeriodo (3 años, toda la sucursal)", () => obtenerReportePorPeriodo(sucursales[0]!.id, hace3Anios, new Date(), undefined, prisma, new Date()));

  console.log("\n7) Reporte por período — rango angosto (últimos 7 días, para comparar):");
  const hace7Dias = new Date();
  hace7Dias.setDate(hace7Dias.getDate() - 7);
  await medir("obtenerReportePorPeriodo (7 días)", () => obtenerReportePorPeriodo(sucursales[0]!.id, hace7Dias, new Date(), undefined, prisma, new Date()));

  console.log("\n8) Query plan de la agregación base (SUM sobre el índice compuesto):");
  const plan = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
    `EXPLAIN ANALYZE SELECT sum(cantidad) FROM "MovimientoStock" WHERE "productoId" = '${productoCaliente.productoId}' AND "seccionId" = '${secciones[0]!.id}'`
  );
  console.log(plan.map((r) => r["QUERY PLAN"]).join("\n"));

  console.log("\n--- Memoria del proceso Node tras las mediciones ---");
  const mem = process.memoryUsage();
  console.log(`  heapUsed: ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB, rss: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);

  if (process.argv.includes("--limpiar")) {
    console.log("\n--- Limpiando datos del benchmark ---");
    await prisma.movimientoStock.deleteMany({ where: { id: { startsWith: "bench_mov_" } } });
    await prisma.operacion.deleteMany({ where: { id: { startsWith: "bench_op_" } } });
    await prisma.producto.deleteMany({ where: { codigo: { startsWith: "BENCH_" } } });
    await prisma.seccion.deleteMany({ where: { sucursalId: { in: sucursales.map((s) => s.id) } } });
    await prisma.sucursal.deleteMany({ where: { id: { in: sucursales.map((s) => s.id) } } });
    await prisma.insumo.delete({ where: { id: insumo.id } });
    await prisma.unidad.delete({ where: { id: unidad.id } });
    await prisma.user.delete({ where: { id: usuario.id } });
    console.log("  Listo.");
  } else {
    console.log("\n(Datos del benchmark NO borrados — correr con --limpiar para borrarlos.)");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

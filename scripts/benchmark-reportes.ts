/**
 * Benchmark de MEDICIÓN PURA de los reportes de `src/core/reportes/`, en particular del efecto real de la
 * optimización de `costo-historico.ts` (ventana acotada + "semilla" de última compra anterior al rango, en
 * vez de traer todo el histórico de compras) y de la carga única de catálogo en `periodo.ts`
 * (`obtenerReportePorPeriodo`).
 *
 * NO es parte de ninguna suite (`npm test` / `npm run test:e2e`): vive en `scripts/`, no en `test/`, y no hace
 * NINGUNA aserción de performance — solo imprime números. La única aserción real es de EQUIVALENCIA (que el
 * código viejo y el nuevo devuelvan el mismo resultado): si no, no tendría sentido comparar sus tiempos.
 *
 * Corre contra una base Postgres LOCAL Y APARTE (`MOTOR2_BENCH_DATABASE_URL` en .env, ver .env.example) —
 * NUNCA `motor2_dev` (la que usa Vitest vía `limpiarBaseDeTest()` en cada test) ni Neon. Los guards de abajo
 * abortan sin conectarse si la URL no cumple el patrón esperado.
 *
 * Simplificación deliberada respecto de un benchmark "de catálogo" completo: una sola escala (no perfiles
 * chico/medio/grande) — 150 insumos × 1 compra cada 3 días × 3 años ≈ 54.750 compras, suficiente para que la
 * diferencia entre "traer todo el histórico" y "ventana + semilla" sea inequívoca sin que la generación tarde
 * minutos. Un "chequeo de aislamiento" externo (que motor2_dev no cambió) se hace antes/después con `psql`,
 * documentado en el commit de este pendiente, no acá adentro.
 *
 * Uso:
 *   MOTOR2_BENCH_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/motor2_bench" \
 *     npx tsx scripts/benchmark-reportes.ts            # genera datos frescos y mide
 *   ... npx tsx scripts/benchmark-reportes.ts --limpiar # borra todo lo generado por este script, no mide
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const N_MP = 150;
const N_PV = 20;
const DIAS_HISTORIAL = Number(process.env.MOTOR2_BENCH_DIAS_HISTORIAL) || 3 * 365; // 3 años por defecto; con ~55k compras, Prisma 7 excede su límite de parámetros en comun.ts (obtenerCostoActualPorMP)
const INTERVALO_COMPRA_DIAS = 3; // 1 compra por (producto, día) cada 3 días — sin empates, ver docstring de arriba.
const DIAS_VENTANA_VENTAS = 10; // ventas reales (para el chequeo de periodo.ts), concentradas en los últimos N días.
const VENTAS_POR_DIA_POR_PV = 3;

function requerirUrlDeBenchmark(): string {
  const url = process.env.MOTOR2_BENCH_DATABASE_URL;
  if (!url) {
    console.error("Falta MOTOR2_BENCH_DATABASE_URL (ver .env.example). No se conecta a nada.");
    process.exit(1);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error("MOTOR2_BENCH_DATABASE_URL no es una URL válida.");
    process.exit(1);
  }
  const host = parsed.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    console.error(`Host rechazado (${host}): el benchmark solo corre contra un Postgres LOCAL.`);
    process.exit(1);
  }
  const prohibidos = ["neon.tech", "vercel", "supabase", "amazonaws", "pooler"];
  if (prohibidos.some((p) => url.includes(p))) {
    console.error("MOTOR2_BENCH_DATABASE_URL parece apuntar a un proveedor gestionado — rechazado.");
    process.exit(1);
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!dbName.endsWith("_bench")) {
    console.error(`El nombre de la base ("${dbName}") tiene que terminar en "_bench".`);
    process.exit(1);
  }
  const urlPrincipal = process.env.DATABASE_URL;
  if (urlPrincipal) {
    try {
      const dbPrincipal = new URL(urlPrincipal).pathname.replace(/^\//, "");
      if (dbPrincipal === dbName) {
        console.error(`MOTOR2_BENCH_DATABASE_URL apunta a la MISMA base que DATABASE_URL ("${dbName}") — rechazado.`);
        process.exit(1);
      }
    } catch {
      // DATABASE_URL mal formada: no es problema de este script, seguir.
    }
  }
  console.log(`Base de benchmark: ${host}/${dbName}`);
  return url;
}

async function medir<T>(etiqueta: string, fn: () => Promise<T>, corridas = 5): Promise<{ resultado: T; medianaMs: number; minimoMs: number }> {
  await fn(); // calentamiento, descartado
  const tiempos: number[] = [];
  let resultado!: T;
  for (let i = 0; i < corridas; i++) {
    const inicio = performance.now();
    resultado = await fn();
    tiempos.push(performance.now() - inicio);
  }
  tiempos.sort((a, b) => a - b);
  const medianaMs = tiempos[Math.floor(tiempos.length / 2)];
  const minimoMs = tiempos[0];
  console.log(`  ${etiqueta}: mediana ${medianaMs.toFixed(1)}ms, mínimo ${minimoMs.toFixed(1)}ms (indicativo, depende de la máquina)`);
  return { resultado, medianaMs, minimoMs };
}

async function filasLeidas(db: PrismaClient, fn: () => Promise<unknown>): Promise<number> {
  await db.$executeRaw`SELECT pg_stat_force_next_flush()`;
  const antes = await db.$queryRaw<{ tup_returned: bigint }[]>`SELECT tup_returned FROM pg_stat_database WHERE datname = current_database()`;
  await fn();
  await db.$executeRaw`SELECT pg_stat_force_next_flush()`;
  const despues = await db.$queryRaw<{ tup_returned: bigint }[]>`SELECT tup_returned FROM pg_stat_database WHERE datname = current_database()`;
  return Number(despues[0].tup_returned - antes[0].tup_returned);
}

function mapasIguales(a: Map<string, number | null>, b: Map<string, number | null>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (!b.has(k)) return false;
    const otro = b.get(k)!;
    if (v === null || otro === null) {
      if (v !== otro) return false;
    } else if (Math.abs(v - otro) > 1e-9) {
      return false;
    }
  }
  return true;
}

async function limpiar(db: PrismaClient) {
  console.log("--- Limpiando datos del benchmark ---");
  await db.movimientoStock.deleteMany({ where: { id: { startsWith: "bench_" } } });
  await db.operacion.deleteMany({ where: { id: { startsWith: "bench_" } } });
  await db.recetaIngrediente.deleteMany({ where: { recetaVersion: { producto: { codigo: { startsWith: "BENCH_" } } } } });
  await db.recetaVersion.deleteMany({ where: { producto: { codigo: { startsWith: "BENCH_" } } } });
  await db.producto.deleteMany({ where: { codigo: { startsWith: "BENCH_" } } });
  await db.seccion.deleteMany({ where: { sucursal: { nombre: "Bench Sucursal" } } });
  await db.sucursal.deleteMany({ where: { nombre: "Bench Sucursal" } });
  await db.unidad.deleteMany({ where: { nombre: "bench_kg" } });
  await db.user.deleteMany({ where: { email: "bench@test.com" } });
  console.log("  Listo.");
}

async function generar(db: PrismaClient) {
  await limpiar(db); // idempotente: siempre arranca de una base limpia de restos de bench_/BENCH_.

  console.log("\n--- Generando catálogo ---");
  const unidad = await db.unidad.create({ data: { nombre: "bench_kg", magnitud: "PESO", decimales: 2 } });
  const sucursal = await db.sucursal.create({ data: { nombre: "Bench Sucursal" } });
  const seccion = await db.seccion.create({ data: { sucursalId: sucursal.id, nombre: "Bench Sección" } });
  const usuario = await db.user.create({ data: { email: "bench@test.com" } });

  await db.producto.createMany({
    data: Array.from({ length: N_MP }, (_, i) => ({
      codigo: `BENCH_MP_${i}`, nombre: `Bench MP ${i}`, tipo: "MP" as const, unidadStockId: unidad.id,
    })),
  });
  const mps = await db.producto.findMany({ where: { codigo: { startsWith: "BENCH_MP_" } }, orderBy: { codigo: "asc" }, select: { id: true } });

  await db.producto.createMany({
    data: Array.from({ length: N_PV }, (_, i) => ({
      codigo: `BENCH_PV_${i}`, nombre: `Bench PV ${i}`, tipo: "PV" as const, unidadStockId: unidad.id, precioVenta: 100,
    })),
  });
  const pvs = await db.producto.findMany({ where: { codigo: { startsWith: "BENCH_PV_" } }, orderBy: { codigo: "asc" }, select: { id: true } });

  // Cada PV tiene una receta con 4 MP (distribución determinística, no aleatoria) — sin receta, resolverCostoRecetaCompleta
  // devuelve null para todo y el reporte no ejercita nada real.
  for (let i = 0; i < pvs.length; i++) {
    await db.recetaVersion.create({
      data: {
        productoId: pvs[i].id, version: 1,
        ingredientes: { create: Array.from({ length: 4 }, (_, j) => ({ insumoProductoId: mps[(i * 4 + j) % mps.length].id, cantidad: 1, unidadId: unidad.id })) },
      },
    });
  }
  console.log(`Catálogo: 1 sucursal, 1 sección, ${mps.length} MP, ${pvs.length} PV con receta (4 ingredientes c/u).`);

  console.log(`\n--- Generando compras vía SQL bulk (${N_MP} insumos × 1 compra cada ${INTERVALO_COMPRA_DIAS} días × ${DIAS_HISTORIAL} días) ---`);
  const inicioGen = performance.now();
  // 1 Operacion por compra (simplificación: cardinalidad de Operacion no es lo que se mide). El desfasaje
  // `dia % 3 = idx % 3` reparte los DIAS_HISTORIAL días en 3 grupos disjuntos → cada producto compra
  // exactamente 1 vez cada 3 días, NUNCA dos compras el mismo día para el mismo producto (invariante que
  // exige el chequeo de equivalencia semilla/ventana: el desempate `id DESC` de la semilla no debe entrar
  // en juego para que los dos brazos den exactamente lo mismo).
  await db.$executeRawUnsafe(`
    INSERT INTO "Operacion" (id, "sucursalId", proceso, fecha, "usuarioId", "creadoEn")
    SELECT 'bench_op_compra_' || prod.idx || '_' || dia, '${sucursal.id}', 'COMPRA',
           now() - (dia || ' days')::interval, '${usuario.id}', now()
    FROM (SELECT id, row_number() OVER (ORDER BY codigo) - 1 AS idx FROM "Producto" WHERE codigo LIKE 'BENCH_MP_%') AS prod
    CROSS JOIN generate_series(0, ${DIAS_HISTORIAL - 1}) AS dia
    WHERE dia % ${INTERVALO_COMPRA_DIAS} = prod.idx % ${INTERVALO_COMPRA_DIAS}
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "MovimientoStock" (id, "operacionId", "productoId", "seccionId", proceso, cantidad, detalle, "precioTotal", "precioPorUnidadStock", "creadoEn")
    SELECT 'bench_mov_' || op.id, op.id, prod.id, '${seccion.id}', 'COMPRA', 10,
           'Bench compra', (10 + (extract(day from now() - op.fecha) / 30.0) * 0.2) * 10, 10 + (extract(day from now() - op.fecha) / 30.0) * 0.2,
           op."creadoEn"
    FROM "Operacion" op
    JOIN "Producto" prod ON prod.codigo = 'BENCH_MP_' || split_part(replace(op.id, 'bench_op_compra_', ''), '_', 1)
    WHERE op.id LIKE 'bench_op_compra_%'
  `);
  const totalCompras = await db.movimientoStock.count({ where: { id: { startsWith: "bench_mov_" }, proceso: "COMPRA" } });
  console.log(`  Compras generadas: ${totalCompras.toLocaleString("es-AR")} en ${((performance.now() - inicioGen) / 1000).toFixed(1)}s`);

  console.log(`\n--- Generando ventas reales (últimos ${DIAS_VENTANA_VENTAS} días, costoUnitarioVenta NULL) ---`);
  await db.$executeRawUnsafe(`
    INSERT INTO "Operacion" (id, "sucursalId", proceso, fecha, "usuarioId", "creadoEn")
    SELECT 'bench_op_venta_' || dia || '_' || n, '${sucursal.id}', 'VENTA', now() - (dia || ' days')::interval, '${usuario.id}', now()
    FROM generate_series(0, ${DIAS_VENTANA_VENTAS - 1}) AS dia
    CROSS JOIN generate_series(0, ${VENTAS_POR_DIA_POR_PV * N_PV - 1}) AS n
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO "MovimientoStock" (id, "operacionId", "productoId", "seccionId", proceso, cantidad, detalle, "precioTotal", "precioPorUnidadStock", "costoUnitarioVenta", "creadoEn")
    SELECT 'bench_mov_' || op.id, op.id, pv.id, '${seccion.id}', 'VENTA', -1, 'Bench venta', 100, 100, NULL, op."creadoEn"
    FROM "Operacion" op
    JOIN LATERAL (SELECT id FROM "Producto" WHERE codigo LIKE 'BENCH_PV_%' OFFSET (abs(hashtext(op.id)) % ${N_PV}) LIMIT 1) AS pv ON true
    WHERE op.id LIKE 'bench_op_venta_%'
  `);
  const totalVentas = await db.movimientoStock.count({ where: { id: { startsWith: "bench_mov_" }, proceso: "VENTA" } });
  console.log(`  Ventas generadas: ${totalVentas.toLocaleString("es-AR")}`);

  return { sucursal, seccion, mps, pvs, usuario };
}

async function main() {
  const url = requerirUrlDeBenchmark();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  if (process.argv.includes("--limpiar")) {
    await limpiar(db);
    await db.$disconnect();
    return;
  }

  const { sucursal } = await generar(db);

  // Imports dinámicos DESPUÉS de resolver la URL del bench: si fueran estáticos, el hoisting de ESM los
  // evaluaría antes de este punto y algún módulo transitivo podría tocar el singleton de `src/lib/db.ts`
  // antes de que el guard de arriba corriera.
  const { costosDeInsumosPorDia, diaUtc } = await import("../src/core/reportes/costo-historico");
  const { reconstruirCostosDeVenta } = await import("../src/server/consultas/reportes/costo-historico");
  const { obtenerReportePorPeriodo } = await import("../src/server/consultas/reportes/periodo");
  const { construirIndiceRecetas, construirMapaProductos } = await import("../src/server/lecturas/reportes/comun");
  const { resolverCostoRecetaCompleta } = await import("../src/core/reportes/costos");

  // Réplica LITERAL del `reconstruirCostosDeVenta` previo a la optimización (commit 878da7e^) — trae TODA la
  // historia de compras hasta el último día pedido, sin ventana ni semilla. Reusa las mismas funciones puras
  // (`costosDeInsumosPorDia`, `resolverCostoRecetaCompleta`, `construirMapaProductos`, `construirIndiceRecetas`)
  // que el código actual sigue exportando: lo único que cambia entre los dos brazos es la consulta.
  async function reconstruirCostosDeVentaLegacy(sucursalId: string, ventas: { productoId: string; fecha: Date }[]) {
    const resultado = new Map<string, number | null>();
    if (!ventas.length) return resultado;
    const dias = ventas.map((v) => diaUtc(v.fecha));
    const ultimoDia = [...dias].sort().at(-1)!;
    const [productos, { recetaPorProducto }, compras] = await Promise.all([
      construirMapaProductos(sucursalId, db),
      construirIndiceRecetas(db),
      db.movimientoStock.findMany({
        where: {
          proceso: "COMPRA", seccion: { sucursalId }, precioPorUnidadStock: { gt: 0 },
          operacion: { fecha: { lt: new Date(new Date(`${ultimoDia}T00:00:00Z`).getTime() + 86_400_000) } },
        },
        select: { productoId: true, precioPorUnidadStock: true, operacion: { select: { fecha: true } } },
      }),
    ]);
    const costosPorDia = costosDeInsumosPorDia(
      compras.map((c) => ({ productoId: c.productoId, fecha: c.operacion.fecha, precioPorUnidadStock: Number(c.precioPorUnidadStock) })),
      dias
    );
    for (const v of ventas) {
      const clave = `${v.productoId}|${diaUtc(v.fecha)}`;
      if (resultado.has(clave)) continue;
      resultado.set(clave, resolverCostoRecetaCompleta(v.productoId, productos, recetaPorProducto, costosPorDia.get(diaUtc(v.fecha)) ?? new Map()));
    }
    return resultado;
  }

  console.log("\n=== A/B: reconstruirCostosDeVenta (costo-historico.ts) ===\n");

  const ventasReales = await db.movimientoStock.findMany({
    where: { id: { startsWith: "bench_mov_" }, proceso: "VENTA" },
    select: { productoId: true, operacion: { select: { fecha: true } } },
  });
  const ventasVentanaCorta = ventasReales.map((v) => ({ productoId: v.productoId, fecha: v.operacion.fecha }));
  console.log(`Caso "ventana corta" (${DIAS_VENTANA_VENTAS} días, ventas reales generadas arriba): ${ventasVentanaCorta.length} ventas.`);

  const pvsIds = (await db.producto.findMany({ where: { codigo: { startsWith: "BENCH_PV_" } }, select: { id: true } })).map((p) => p.id);
  const ventasVentanaLarga = Array.from({ length: 240 }, (_, i) => ({
    productoId: pvsIds[i % pvsIds.length],
    fecha: new Date(Date.now() - (i * (DIAS_HISTORIAL - 5) / 240) * 86_400_000),
  }));
  console.log(`Caso "ventana larga" (~${DIAS_HISTORIAL} días, sintético — mismos productos, fechas repartidas en todo el histórico): ${ventasVentanaLarga.length} ventas.\n`);

  const soloContexto = process.argv.includes("--solo-contexto"); // salta el A/B de costo-historico (su brazo legacy excede el límite de parámetros de Prisma 7 con ~55k compras) y mide solo el sobrecosto de A5
  for (const [nombre, ventas] of soloContexto ? [] : ([["ventana corta", ventasVentanaCorta], ["ventana larga", ventasVentanaLarga]] as const)) {
    console.log(`--- Caso: ${nombre} ---`);
    const filasLegacy = await filasLeidas(db, () => reconstruirCostosDeVentaLegacy(sucursal.id, ventas));
    const filasNuevo = await filasLeidas(db, () => reconstruirCostosDeVenta(sucursal.id, ventas, db));
    const signoFilas = filasNuevo <= filasLegacy ? "menos" : "MÁS (ver EXPLAIN abajo)";
    console.log(`  Filas procesadas por Postgres (pg_stat_database.tup_returned) — antes: ${filasLegacy.toLocaleString("es-AR")}, después: ${filasNuevo.toLocaleString("es-AR")} (${(Math.max(filasNuevo, filasLegacy) / Math.max(Math.min(filasNuevo, filasLegacy), 1)).toFixed(1)}× ${signoFilas})`);

    const { resultado: resultadoLegacy, medianaMs: medianaLegacy } = await medir("tiempo antes (legacy)", () => reconstruirCostosDeVentaLegacy(sucursal.id, ventas));
    const { resultado: resultadoNuevo, medianaMs: medianaNuevo } = await medir("tiempo después (actual)", () => reconstruirCostosDeVenta(sucursal.id, ventas, db));
    console.log(`  Ratio de tiempo mediana: ${(medianaLegacy / medianaNuevo).toFixed(1)}×`);

    const iguales = mapasIguales(resultadoLegacy, resultadoNuevo);
    console.log(`  Chequeo de equivalencia (mismo resultado en los dos brazos): ${iguales ? "OK" : "❌ DISTINTO — los números de arriba no son comparables"}`);
    if (!iguales) throw new Error(`Los dos brazos de reconstruirCostosDeVenta dieron resultados distintos para el caso "${nombre}" — benchmark inválido.`);
    console.log();
  }

  // EXPLAIN de la query de la "semilla" (el brazo NUEVO) — evidencia de si el ahorro de filas hidratadas en
  // Node (arriba) se traduce o no en menos I/O real de Postgres. Si esto muestra un Seq Scan completo de
  // MovimientoStock, la conclusión NO es que la optimización esté mal — el chequeo de equivalencia y el
  // tiempo de pared ya la validan — es que un índice nuevo por "proceso" sería un paso SEPARADO, que
  // requeriría su propia migración autorizada (nunca decidido acá).
  if (!soloContexto) {
    console.log("--- EXPLAIN (ANALYZE, BUFFERS) de la query de la semilla (ventana corta) ---");
    const primerDiaCorta = [...ventasVentanaCorta.map((v) => diaUtc(v.fecha))].sort()[0];
    const explainSemilla = await db.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`
      EXPLAIN (ANALYZE, BUFFERS) SELECT DISTINCT ON (m."productoId") m."productoId", m."precioPorUnidadStock", o."fecha"
      FROM "MovimientoStock" m
      JOIN "Operacion" o ON o."id" = m."operacionId"
      JOIN "Seccion" s ON s."id" = m."seccionId"
      WHERE m."proceso" = 'COMPRA' AND s."sucursalId" = '${sucursal.id}'
        AND m."precioPorUnidadStock" > 0 AND o."fecha" < '${primerDiaCorta}T00:00:00Z'::timestamp
      ORDER BY m."productoId", o."fecha" DESC, m."id" DESC
    `);
    console.log(explainSemilla.map((r) => `  ${r["QUERY PLAN"]}`).join("\n"));
    console.log();
  }

  console.log("=== periodo.ts: carga única de catálogo en obtenerReportePorPeriodo ===\n");
  let llamadasAProductoFindMany = 0;
  const dbConContador = db.$extends({
    query: {
      producto: {
        async findMany(...args: [{ query: (a: unknown) => Promise<unknown>; args: unknown }]) {
          llamadasAProductoFindMany++;
          return args[0].query(args[0].args);
        },
      },
    },
  }) as unknown as PrismaClient;

  const hoy = new Date();
  const haceDiezDias = new Date(hoy.getTime() - DIAS_VENTANA_VENTAS * 86_400_000);
  await obtenerReportePorPeriodo(sucursal.id, haceDiezDias, hoy, {}, dbConContador); // calentamiento, no cuenta.
  llamadasAProductoFindMany = 0;
  await obtenerReportePorPeriodo(sucursal.id, haceDiezDias, hoy, {}, dbConContador); // 1 sola corrida, para contar exacto.
  console.log(`  Llamadas a producto.findMany en 1 sola corrida de obtenerReportePorPeriodo: ${llamadasAProductoFindMany}`);
  if (llamadasAProductoFindMany > 1) {
    console.log(
      `  ⚠️  REGRESIÓN: obtenerReportePorPeriodo volvió a cargar el catálogo más de una vez (debe ser 1). Alguna función que usa el ` +
        `catálogo (calcularImpactoRecetasPorPeriodo, calcularCostosYMargenes, reconstruirCostosDeVenta u otra nueva) no recibe el ` +
        `mapa que periodo.ts ya cargó y llama a construirMapaProductos por su cuenta. Está fijado por ` +
        `test/reportes/catalogo-una-sola-carga.test.ts: si aparece acá es que alguien lo rompió y ese test no lo cubre.`
    );
  }
  const { medianaMs: medianaPeriodo } = await medir("obtenerReportePorPeriodo (10 días)", () => obtenerReportePorPeriodo(sucursal.id, haceDiezDias, hoy, {}, dbConContador), 3);
  console.log(`  Tiempo mediana del reporte completo: ${medianaPeriodo.toFixed(1)}ms\n`);

  // Sobrecosto del contexto de empresa (ADR-007, A5). Réplica LITERAL de `dbDeEmpresa` (src/core/auth/base.ts) sobre el cliente del
  // bench —el real usa el singleton de `src/lib/db.ts`, que apunta a DATABASE_URL—: cada operación pasa a ser una transacción
  // `[set_config('app.empresa_id', $1, true), operación]`. Mismo reporte, sin y con la extensión.
  console.log("=== Sobrecosto de dbDeEmpresa (set_config por operación, ADR-007 A5) ===\n");
  const { id: empresaId } = await db.empresa.findFirstOrThrow({ where: { id: process.env.EMPRESA_ID ?? "empresa_principal" }, select: { id: true } });
  const dbConEmpresa = db.$extends({
    query: {
      async $allOperations({ args, query }) {
        const [, resultado] = await db.$transaction([db.$executeRaw`SELECT set_config('app.empresa_id', ${empresaId}, true)`, query(args)]);
        return resultado;
      },
    },
  }) as unknown as PrismaClient;

  const { medianaMs: reporteSin } = await medir("obtenerReportePorPeriodo sin contexto", () => obtenerReportePorPeriodo(sucursal.id, haceDiezDias, hoy, {}, db), 7);
  const { medianaMs: reporteCon } = await medir("obtenerReportePorPeriodo con contexto", () => obtenerReportePorPeriodo(sucursal.id, haceDiezDias, hoy, {}, dbConEmpresa), 7);
  console.log(`  Reporte completo: +${(reporteCon - reporteSin).toFixed(1)}ms (${((reporteCon / reporteSin - 1) * 100).toFixed(1)}%)\n`);

  const LECTURAS = 200;
  const { medianaMs: lecturasSin } = await medir(`${LECTURAS} lecturas simples en serie sin contexto`, async () => {
    for (let i = 0; i < LECTURAS; i++) await db.sucursal.findUnique({ where: { id: sucursal.id } });
  }, 5);
  const { medianaMs: lecturasCon } = await medir(`${LECTURAS} lecturas simples en serie con contexto`, async () => {
    for (let i = 0; i < LECTURAS; i++) await dbConEmpresa.sucursal.findUnique({ where: { id: sucursal.id } });
  }, 5);
  console.log(`  Por operación: +${((lecturasCon - lecturasSin) / LECTURAS).toFixed(2)}ms (${(lecturasSin / LECTURAS).toFixed(2)}ms -> ${(lecturasCon / LECTURAS).toFixed(2)}ms; en red real suma ~1 ida y vuelta por operación)\n`);

  console.log("=== Memoria del proceso Node ===");
  const mem = process.memoryUsage();
  console.log(`  heapUsed: ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB, rss: ${(mem.rss / 1024 / 1024).toFixed(1)} MB\n`);

  console.log("(Datos del benchmark NO borrados — correr con --limpiar para borrarlos antes de la próxima corrida si hace falta.)");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

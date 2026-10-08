import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID } from "../setup/empresa-de-prueba";
import { analizarDespuesDeCargaMasiva, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion, vaciarOperacionesPorVolumen } from "../setup/test-db";
import { cargarDeudaDeRedondeo } from "../../src/server/lecturas/movimientos/deuda-de-redondeo";
import { seccionesConStock } from "../../src/server/lecturas/movimientos/saldos";

/**
 * `EXPLAIN` de los índices de saldo del Kardex (Hito 5, pieza 5.4, A7; O.13 de `docs/pureza-integracion.md`). Solo `EXPLAIN` (sin `ANALYZE`) sobre la base LOCAL de tests;
 * nunca contra producción ni contra otra base.
 *
 * La Fase 5 (migraciones) va a tocar la tabla del Kardex (un candado de solo-agregar, quizás un índice nuevo) y necesita saber qué índice sirve hoy a las dos lecturas
 * de saldo más caras de la venta: `seccionesConStock` (`server/lecturas/movimientos/saldos.ts`, un `groupBy` por sección con el filtro `seccion.sucursalId`) y
 * `cargarDeudaDeRedondeo` (`server/lecturas/movimientos/deuda-de-redondeo.ts`, un `groupBy` por producto sobre las filas con `cantidadExacta`). El índice es
 * `MovimientoStock_productoId_seccionId_loteVencimiento_idx` (migración `init`); ninguna de las dos tiene uno propio por `(seccionId, productoId)`.
 *
 * Cómo se mide: el SQL REAL de cada lectura se captura con un `PrismaClient` aparte con `log` de queries (nada de reescribir la consulta a mano: si el código cambia el SQL,
 * esto lo ve) y se le pide el plan con `EXPLAIN` dentro de una transacción con `app.empresa_id` fijado (`set_config(…, true)`, para que el RLS vea la empresa de prueba) y
 * `SET LOCAL enable_seqscan = off` (mismo recurso que `indice-compras-por-producto.test.ts`). Todo es local de la transacción: no deja ningún ajuste en la base.
 *
 * HALLAZGO que obliga a sembrar un volumen: con la tabla VACÍA, aun con el escaneo secuencial apagado, el planner NO elige el índice de saldo en ninguna de las dos:
 * con las estadísticas de una tabla sin filas cree que el predicado del RLS (`"empresaId" = (SELECT app_empresa_actual())`) ya deja ~1 fila y recorre `MovimientoStock_empresaId_id_key`
 * (el único índice que empieza por `empresaId`) filtrando por producto después (es el mismo efecto que documenta `analizarDespuesDeCargaMasiva` en `test/setup/test-db.ts`).
 * Por eso este test siembra ~24.000 líneas de Kardex por SQL (20 productos × 2 secciones, la mitad con `cantidadExacta`, el mismo recurso de los tests `*-volumen`), corre el `ANALYZE`
 * del dueño y deja la base como la encontró. Con ese volumen los dos planes son un `Bitmap Index Scan` sobre el índice de saldo con la condición `"productoId" = …` (solo la primera columna del
 * índice: el filtro por `empresaId` del RLS, por `cantidadExacta` y por `seccion.sucursalId` se aplica DESPUÉS, sobre el heap y sobre un `Hash Join` con `Seccion`). Lo que sigue SIN medirse es
 * cuánto cuestan con millones de filas: el `EXPLAIN ANALYZE` con datos del tamaño de producción queda para la simulación de la Fase 5, base por base.
 */
const INDICE_DE_SALDO = "MovimientoStock_productoId_seccionId_loteVencimiento_idx";
const PRODUCTOS = 20;
const LINEAS_POR_PRODUCTO = 1_200;

interface ConsultaCapturada {
  query: string;
  params: unknown[];
}

describe("índice de saldo del Kardex: lo que usan seccionesConStock y la deuda de redondeo", () => {
  const consultas: ConsultaCapturada[] = [];
  let capturador: PrismaClient<{ log: [{ emit: "event"; level: "query" }] }>;
  let sucursalId: string;
  let productoId: string;

  beforeAll(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    const secciones = [(await sembrarSeccion(sucursalId)).id, (await sembrarSeccion(sucursalId, "Cocina")).id];
    const usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    const productos = await Promise.all(
      Array.from({ length: PRODUCTOS }, (_, i) =>
        prisma.producto.create({ data: { codigo: `MP_${i}`, nombre: `Insumo ${i}`, tipo: "MP", unidadStockId: catalogo.kg.id } })
      )
    );
    productoId = productos[0].id;

    // Volumen directo con SQL, sin pasar por la aplicación (el recurso de los tests `*-volumen`): una Operacion y una línea por cada fila.
    const total = PRODUCTOS * LINEAS_POR_PRODUCTO;
    await prisma.$executeRaw`
      INSERT INTO "Operacion" ("id", "sucursalId", "proceso", "fecha", "usuarioId")
      SELECT 'op' || g, ${sucursalId}, 'COMPRA'::"Proceso", '2025-01-01'::timestamp + (g || ' minutes')::interval, ${usuarioId}
      FROM generate_series(1, ${total}::int) g`;
    await prisma.$executeRaw`
      INSERT INTO "MovimientoStock" ("id", "operacionId", "productoId", "seccionId", "proceso", "cantidad", "cantidadExacta", "detalle")
      SELECT 'mv' || g, 'op' || g, (${productos.map((p) => p.id)}::text[])[1 + (g % ${PRODUCTOS}::int)], (${secciones}::text[])[1 + (g % 2)],
             'CONSUMO'::"Proceso", -1, CASE WHEN g % 2 = 0 THEN -0.75 ELSE NULL END, 'volumen'
      FROM generate_series(1, ${total}::int) g`;
    await analizarDespuesDeCargaMasiva();

    // Un cliente aparte (mismo rol y misma empresa de prueba que el resto de los tests) con el log de queries: el SQL que llega a Postgres, con sus `$n`.
    capturador = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "", options: `-c app.empresa_id=${EMPRESA_DE_PRUEBA_ID}` }),
      log: [{ emit: "event", level: "query" }],
    });
    capturador.$on("query", (e) => {
      consultas.push({ query: e.query, params: JSON.parse(e.params) as unknown[] });
    });
  }, 120_000);

  afterAll(async () => {
    await capturador?.$disconnect();
    await vaciarOperacionesPorVolumen();
    await limpiarBaseDeTest();
  });

  /** El SQL de lectura del Kardex que dejó una lectura (ignora BEGIN/COMMIT y lo que no toca `MovimientoStock`). */
  async function sqlDe(lectura: () => Promise<unknown>): Promise<ConsultaCapturada> {
    consultas.length = 0;
    await lectura();
    const lecturas = consultas.filter((c) => /\bSELECT\b/i.test(c.query) && c.query.includes('"MovimientoStock"'));
    expect(lecturas, "la lectura no leyó el Kardex (¿cambió el SQL o dejó de capturarse?)").toHaveLength(1);
    return lecturas[0];
  }

  /** El plan de la consulta, con el escaneo secuencial apagado y la empresa de prueba fijada, todo local de la transacción. */
  async function planDe(c: ConsultaCapturada): Promise<string> {
    const filas = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', ${EMPRESA_DE_PRUEBA_ID}, true)`;
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(`EXPLAIN ${c.query}`, ...c.params);
    });
    return filas.map((f) => f["QUERY PLAN"]).join("\n");
  }

  it("el índice existe con las columnas (productoId, seccionId, loteVencimiento) y no hay uno por (seccionId, productoId)", async () => {
    const indices = await prisma.$queryRaw<Array<{ nombre: string; definicion: string }>>`
      SELECT indexname AS nombre, indexdef AS definicion FROM pg_indexes WHERE tablename = 'MovimientoStock'`;
    const saldo = indices.find((i) => i.nombre === INDICE_DE_SALDO);
    expect(saldo, "falta el índice de saldo del Kardex").toBeDefined();
    expect(saldo!.definicion).toContain('("productoId", "seccionId", "loteVencimiento")');
    expect(indices.filter((i) => /\("seccionId", "productoId"/.test(i.definicion)).map((i) => i.nombre)).toEqual([]);
  });

  it("seccionesConStock (groupBy por sección de un producto en una sucursal) se resuelve con el índice de saldo", async () => {
    const c = await sqlDe(() => seccionesConStock(productoId, sucursalId, capturador));
    expect(c.query).toMatch(/GROUP BY/i);
    expect(await planDe(c)).toContain(INDICE_DE_SALDO);
  });

  it("la deuda de redondeo (groupBy por producto de las filas con cantidadExacta de una sucursal) se resuelve con el índice de saldo", async () => {
    const c = await sqlDe(() => capturador.$transaction((tx) => cargarDeudaDeRedondeo(tx, sucursalId, [productoId])));
    expect(c.query).toMatch(/GROUP BY/i);
    expect(await planDe(c)).toContain(INDICE_DE_SALDO);
  });
});

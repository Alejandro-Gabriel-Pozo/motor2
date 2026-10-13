import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { cerrarConexiones, conexionComoApp, conexionDelDuenio, datosDeConcepto, datosDeRenglonSinStock, esperarBloqueo, intentar, pidDe, TIPOS_DE_COSTO } from "../setup/gasto";
import { datosDeFactura, datosDeRenglon, sembrarAjeno, sembrarEscenarioDeFactura, type EscenarioDeFactura } from "../setup/factura-proveedor";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 3, M4.2 — migración 20261016111000_renglon_sin_stock: el RENGLÓN SIN STOCK de la factura de proveedor (un gasto: concepto y tipo de costo en vez de producto, cantidad y precio por unidad), sobre la tabla de M3.
 *
 * Primera parte (base real, fixtures y clientes `pg` como `motor2_app`): el pareo de las DOS naturalezas en los dos sentidos; un SIN_STOCK de cero pesos se rechaza; el concepto de OTRA empresa da 23503 (clave foránea compuesta, probada como
 * dueño); una MERCADERIA con concepto se rechaza; los cinco tipos de costo; el renglón sigue sin UPDATE ni DELETE para la app (la naturaleza no se reclasifica: se anula y se vuelve a cargar); la carga repetida o simultánea del mismo renglón no duplica.
 *
 * Segunda parte (base TEMPORAL armada migración por migración): un renglón de MERCADERIA cargado ANTES de M4.2 sigue válido después; la reversa ABORTA sin dejar nada a medias si ya hay un renglón sin stock, y cuando no hay deja los dos CHECK de M3 con su
 * nombre y su definición EXACTA; subir otra vez anda.
 *
 * Mutaciones demostradas (ver el informe del paso): sacar `AND "precioTotal" > 0` del pareo, sacar el índice `(empresaId, id, naturaleza)`, sacar la clave foránea compuesta del concepto, sacar `SIN_STOCK` de la naturaleza, o quitar la guarda del down.sql.
 */
afterAll(() => prismaAdmin.$disconnect());

const M4_1 = "20261016110000_concepto_de_gasto";
const M4_2 = "20261016111000_renglon_sin_stock";
const ULTIMA_DE_M3 = "20261016104000_proveedor_condicion_iva_y_puntos_de_venta";
const leer = (migracion: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(__dirname, "../../prisma/migrations", migracion, archivo), "utf8");

const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

describe("el renglón sin stock en la base real", () => {
  let e: EscenarioDeFactura;
  let conceptoId: string;
  let facturaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeFactura();
    conceptoId = (await prisma.conceptoDeGasto.create({ data: datosDeConcepto() })).id;
    facturaId = (await prisma.facturaProveedor.create({ data: datosDeFactura(e) as never })).id;
  });
  afterEach(cerrarConexiones);

  const sinStock = (extra: Record<string, unknown> = {}) => prisma.facturaProveedorRenglon.create({ data: datosDeRenglonSinStock({ facturaProveedorId: facturaId, conceptoGastoId: conceptoId }, extra) as never });
  const mercaderia = (extra: Record<string, unknown> = {}) => prisma.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: facturaId, productoId: e.productoId }, extra) as never });

  it("la migración suma conceptoGastoId y tipoDeCosto (TEXT NULL) al final del renglón, con su clave foránea compuesta RESTRICT, su índice y el índice único del discriminador", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ columna: string; tipo: string; es_nulable: string }>>`
      SELECT column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'FacturaProveedorRenglon' ORDER BY ordinal_position`;
    expect(columnas.slice(-2).map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`)).toEqual(["conceptoGastoId:text:YES", "tipoDeCosto:text:YES"]);
    const [fk] = await prismaAdmin.$queryRaw<Array<{ definicion: string }>>`SELECT pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conname = 'FacturaProveedorRenglon_empresaId_conceptoGastoId_fkey'`;
    expect(fk!.definicion).toBe('FOREIGN KEY ("empresaId", "conceptoGastoId") REFERENCES "ConceptoDeGasto"("empresaId", id) ON UPDATE CASCADE ON DELETE RESTRICT');
    const indices = await prismaAdmin.$queryRaw<Array<{ nombre: string; definicion: string }>>`SELECT indexname::text AS nombre, indexdef AS definicion FROM pg_indexes WHERE tablename = 'FacturaProveedorRenglon' AND indexname IN ('FacturaProveedorRenglon_empresaId_id_naturaleza_key', 'FacturaProveedorRenglon_conceptoGastoId_idx') ORDER BY 1`;
    expect(indices.map((i) => i.nombre)).toEqual(["FacturaProveedorRenglon_conceptoGastoId_idx", "FacturaProveedorRenglon_empresaId_id_naturaleza_key"]);
    expect(indices[1]!.definicion).toMatch(/CREATE UNIQUE INDEX .* \("empresaId", id, naturaleza\)/);
  });

  it("los CHECK de M3 se REEMPLAZARON: ya no existe `..._pareo_mercaderia_chk`, la naturaleza admite las dos y el pareo nuevo nombra las dos", async () => {
    const checks = await prismaAdmin.$queryRaw<Array<{ nombre: string; validada: boolean; definicion: string }>>`
      SELECT conname::text AS nombre, convalidated AS validada, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"FacturaProveedorRenglon"'::regclass AND contype = 'c' ORDER BY 1`;
    const nombres = checks.map((c) => c.nombre);
    expect(nombres).not.toContain("FacturaProveedorRenglon_pareo_mercaderia_chk");
    expect(nombres).toContain("FacturaProveedorRenglon_pareo_naturaleza_chk");
    expect(nombres).toContain("FacturaProveedorRenglon_tipo_de_costo_chk");
    expect(checks.every((c) => c.validada)).toBe(true);
    const de = (n: string) => checks.find((c) => c.nombre === n)!.definicion;
    expect(de("FacturaProveedorRenglon_naturaleza_chk")).toMatch(/MERCADERIA.*SIN_STOCK/);
    expect(de("FacturaProveedorRenglon_pareo_naturaleza_chk")).toMatch(/"precioTotal" > \(0\)::numeric|"precioTotal" > 0/);
  });

  it("el CHECK del tipo de costo del renglón lista EXACTAMENTE los cinco valores de D2", async () => {
    const [{ definicion }] = await prismaAdmin.$queryRaw<Array<{ definicion: string }>>`SELECT pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conname = 'FacturaProveedorRenglon_tipo_de_costo_chk'`;
    expect([...definicion.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]!).sort()).toEqual([...TIPOS_DE_COSTO].sort());
  });

  it("un renglón SIN_STOCK válido se guarda (concepto, tipo de costo, 100,00 con IVA, sin ningún campo de mercadería) y no genera ninguna Operacion ni línea del Kardex", async () => {
    const antes = { operaciones: await prismaAdmin.operacion.count(), movimientos: await prismaAdmin.movimientoStock.count() };
    const r = await sinStock();
    expect([r.naturaleza, r.conceptoGastoId, r.tipoDeCosto, r.productoId, r.cantidadStock, r.precioPorUnidadStock, r.detalle, r.loteVencimiento]).toEqual(["SIN_STOCK", conceptoId, "GASTO_OPERATIVO", null, null, null, null, null]);
    expect(r.precioTotal.toFixed(2)).toBe("100.00");
    expect(r.importeIvaComputable.toFixed(2)).toBe("0.00");
    expect({ operaciones: await prismaAdmin.operacion.count(), movimientos: await prismaAdmin.movimientoStock.count() }).toEqual(antes);
  });

  it("un renglón de MERCADERIA válido sigue guardándose igual que en M3 (regresión: el pareo nuevo no lo rompe)", async () => {
    const r = await mercaderia();
    expect([r.naturaleza, r.conceptoGastoId, r.tipoDeCosto, r.productoId]).toEqual(["MERCADERIA", null, null, e.productoId]);
  });

  it("el pareo de SIN_STOCK, en un sentido: sin concepto, sin tipo de costo, con producto, cantidad, precio por unidad, texto de conversión o lote se rechaza (…_pareo_naturaleza_chk)", async () => {
    const rotos: Array<Record<string, unknown>> = [
      { conceptoGastoId: null }, { tipoDeCosto: null }, { productoId: e.productoId }, { cantidadStock: "1" }, { precioPorUnidadStock: "1" }, { detalle: "1 kg" }, { loteVencimiento: new Date("2099-01-01T00:00:00Z") },
    ];
    for (const roto of rotos) await expect(sinStock(roto), JSON.stringify(roto)).rejects.toThrow(/FacturaProveedorRenglon_pareo_naturaleza_chk/);
  });

  it("el pareo de MERCADERIA, en el otro sentido: con concepto de gasto o con tipo de costo se rechaza, y sin producto, cantidad, precio por unidad o texto de conversión también", async () => {
    for (const roto of [{ conceptoGastoId: conceptoId }, { tipoDeCosto: "GASTO_OPERATIVO" }, { productoId: null }, { cantidadStock: null }, { precioPorUnidadStock: null }, { detalle: null }]) {
      await expect(mercaderia(roto), JSON.stringify(roto)).rejects.toThrow(/FacturaProveedorRenglon_pareo_naturaleza_chk/);
    }
  });

  it("un SIN_STOCK de cero pesos (o negativo) se rechaza: un gasto de cero no es un gasto; una MERCADERIA de cero sigue permitida (como en M3)", async () => {
    await expect(sinStock({ precioTotal: "0.00" })).rejects.toThrow(/FacturaProveedorRenglon_pareo_naturaleza_chk/);
    await expect(sinStock({ precioTotal: "-0.01" })).rejects.toThrow(/FacturaProveedorRenglon_(pareo_naturaleza|precio_total_no_negativo)_chk/);
    expect((await sinStock({ precioTotal: "0.01" })).precioTotal.toFixed(2)).toBe("0.01");
    expect((await mercaderia({ orden: 5, precioPorUnidadStock: "0", precioTotal: "0.00" })).precioTotal.toFixed(2)).toBe("0.00");
  });

  it("acepta los CINCO tipos de costo (D2) y rechaza cualquier otro (…_tipo_de_costo_chk)", async () => {
    let orden = 1;
    for (const tipo of TIPOS_DE_COSTO) expect((await sinStock({ orden: orden++, tipoDeCosto: tipo })).tipoDeCosto, tipo).toBe(tipo);
    for (const malo of ["RUBRO", "gasto_operativo", ""]) await expect(sinStock({ orden: orden++, tipoDeCosto: malo }), JSON.stringify(malo)).rejects.toThrow(/FacturaProveedorRenglon_(tipo_de_costo|pareo_naturaleza)_chk/);
  });

  it("la naturaleza fuera de la lista se rechaza (…_naturaleza_chk), y el concepto inexistente da 23503 sobre la clave foránea", async () => {
    await expect(sinStock({ naturaleza: "OTRA" })).rejects.toThrow(/FacturaProveedorRenglon_naturaleza_chk/);
    await expect(sinStock({ conceptoGastoId: "no-existe" })).rejects.toThrow(/FacturaProveedorRenglon_empresaId_conceptoGastoId_fkey/);
  });

  it("el concepto de OTRA empresa da 23503 (clave foránea compuesta con empresaId), aun escribiendo como dueño y con el empresaId explícito", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const conceptoAjeno = await ajeno.testigo.conceptoDeGasto.create({ data: datosDeConcepto() });
    const duenio = await conexionDelDuenio();
    const insertar = (empresaId: string, concepto: string) =>
      intentar(duenio, `INSERT INTO "FacturaProveedorRenglon" ("id","empresaId","facturaProveedorId","orden","naturaleza","conceptoGastoId","tipoDeCosto","precioTotal") VALUES ($1,$2,$3,7,'SIN_STOCK',$4,'GASTO_OPERATIVO',50.00)`, [randomUUID(), empresaId, facturaId, concepto]);
    expect(await insertar("empresa_principal", conceptoAjeno.id)).toEqual({ codigo: "23503", restriccion: "FacturaProveedorRenglon_empresaId_conceptoGastoId_fkey" });
    expect(await insertar("empresa_principal", conceptoId)).toBeNull();
  });

  it("un concepto con renglones no se puede borrar ni siquiera como dueño (RESTRICT), y la app no tiene DELETE sobre el concepto", async () => {
    await sinStock();
    const duenio = await conexionDelDuenio();
    expect(await intentar(duenio, `DELETE FROM "ConceptoDeGasto" WHERE "id" = $1`, [conceptoId])).toEqual({ codigo: "23503", restriccion: "FacturaProveedorRenglon_empresaId_conceptoGastoId_fkey" });
  });

  it("IVA: un renglón sin stock puede traer su desglose (neto + IVA = total) y su IVA computable, con los mismos CHECK de M3d (el computable no pasa del IVA)", async () => {
    const r = await sinStock({ alicuotaIva: "IVA_21", importeNeto: "82.64", importeIva: "17.36", importeIvaComputable: "17.36" });
    expect([r.importeNeto!.toFixed(2), r.importeIva!.toFixed(2), r.importeIvaComputable.toFixed(2)]).toEqual(["82.64", "17.36", "17.36"]);
    await expect(sinStock({ orden: 2, alicuotaIva: "IVA_21", importeNeto: "82.64", importeIva: "17.36", importeIvaComputable: "17.37" })).rejects.toThrow(/FacturaProveedorRenglon_iva_computable_chk/);
    await expect(sinStock({ orden: 3, alicuotaIva: "IVA_21", importeNeto: "82.64", importeIva: "17.35" })).rejects.toThrow(/FacturaProveedorRenglon_neto_mas_iva_chk/);
  });

  it("como motor2_app: carga un renglón sin stock (con la empresa del contexto), pero NO puede modificarlo ni borrarlo (la naturaleza no se reclasifica: se anula la factura y se vuelve a cargar)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    const insertar = (id: string, orden: number) =>
      intentar(app, `INSERT INTO "FacturaProveedorRenglon" ("id","facturaProveedorId","orden","naturaleza","conceptoGastoId","tipoDeCosto","precioTotal") VALUES ($1,$2,$3,'SIN_STOCK',$4,'GASTO_OPERATIVO',100.00)`, [id, facturaId, orden, conceptoId]);
    const id = randomUUID();
    expect(await insertar(id, 1)).toBeNull();
    for (const columna of ["naturaleza", "conceptoGastoId", "tipoDeCosto", "precioTotal", "importeIvaComputable"]) {
      const valor = columna === "naturaleza" ? "'MERCADERIA'" : columna === "conceptoGastoId" ? "NULL" : columna === "tipoDeCosto" ? "'INVERSION'" : "1";
      expect(await intentar(app, `UPDATE "FacturaProveedorRenglon" SET "${columna}" = ${valor} WHERE "id" = $1`, [id]), columna).toMatchObject({ codigo: "42501" });
    }
    expect(await intentar(app, `DELETE FROM "FacturaProveedorRenglon" WHERE "id" = $1`, [id])).toMatchObject({ codigo: "42501" });
    const [f] = await prismaAdmin.$queryRaw<Array<{ naturaleza: string; tipo: string }>>`SELECT "naturaleza", "tipoDeCosto" AS tipo FROM "FacturaProveedorRenglon" WHERE "id" = ${id}`;
    expect(f).toEqual({ naturaleza: "SIN_STOCK", tipo: "GASTO_OPERATIVO" });
  });

  it("la carga repetida o simultánea del MISMO renglón no duplica: dos clientes a la vez con el mismo (factura, orden) → una gana y la otra recibe 23505; repetir el mismo id también", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await Promise.all([conexionComoApp(), conexionComoApp()]);
    const sentencia = (id: string, orden: number) => ({
      texto: `INSERT INTO "FacturaProveedorRenglon" ("id","facturaProveedorId","orden","naturaleza","conceptoGastoId","tipoDeCosto","precioTotal") VALUES ($1,$2,$3,'SIN_STOCK',$4,'GASTO_OPERATIVO',100.00)`,
      params: [id, facturaId, orden, conceptoId],
    });
    const cargar = (c: typeof a, id: string, orden: number) => intentar(c, sentencia(id, orden).texto, sentencia(id, orden).params);
    const resultados = await Promise.all([cargar(a, randomUUID(), 1), cargar(b, randomUUID(), 1)]);
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r !== null)).toEqual([{ codigo: "23505", restriccion: "FacturaProveedorRenglon_facturaProveedorId_orden_key" }]);
    const repetido = randomUUID();
    expect(await cargar(a, repetido, 2)).toBeNull();
    expect(await cargar(a, repetido, 3)).toEqual({ codigo: "23505", restriccion: "FacturaProveedorRenglon_pkey" });
    expect(Number((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "FacturaProveedorRenglon" WHERE "facturaProveedorId" = ${facturaId}`)[0]!.n)).toBe(2);
  });

  it("el segundo INSERT del mismo (factura, orden) ESPERA al primero: si éste hace ROLLBACK entra, y no queda nada reservado", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await Promise.all([conexionComoApp(), conexionComoApp()]);
    const texto = `INSERT INTO "FacturaProveedorRenglon" ("id","facturaProveedorId","orden","naturaleza","conceptoGastoId","tipoDeCosto","precioTotal") VALUES ($1,$2,1,'SIN_STOCK',$3,'GASTO_OPERATIVO',100.00)`;
    await a.query("BEGIN");
    await a.query(texto, [randomUUID(), facturaId, conceptoId]);
    await b.query("BEGIN");
    const pidDeB = await pidDe(b);
    const segundo = b.query(texto, [randomUUID(), facturaId, conceptoId]);
    await esperarBloqueo(pidDeB);
    await a.query("ROLLBACK");
    expect((await segundo).rowCount).toBe(1);
    await b.query("COMMIT");
    expect(Number((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "FacturaProveedorRenglon" WHERE "facturaProveedorId" = ${facturaId}`)[0]!.n)).toBe(1);
  });

  it("el migration.sql y el down.sql avisan que requieren autorización, que reemplazan dos CHECK de M3 y que la reversa aborta si hay datos", () => {
    const subida = leer(M4_2, "migration.sql");
    expect(subida.split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(subida).toMatch(/REEMPLAZA DOS CHECK DE M3/);
    const bajada = leer(M4_2, "down.sql");
    expect(bajada).toMatch(/ABORTA/);
    expect(bajada).toContain("RAISE EXCEPTION");
    expect(bajada).toMatch(/ANTES M4\.3/);
  });
});

describe("sobre una base temporal: el renglón de M3 sigue válido y la reversa vuelve a M3 sin perder nada", () => {
  let base: BaseTemporalMigrada;
  const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);
  const E = "empresa_m42";
  const checksDelRenglon = () =>
    q(`SELECT conname::text AS nombre, convalidated AS validada, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"FacturaProveedorRenglon"'::regclass AND contype = 'c' ORDER BY 1`);
  const columnasDelRenglon = () => q<{ column_name: string }>(`SELECT column_name::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'FacturaProveedorRenglon' ORDER BY ordinal_position`);

  let checksDeM3: Awaited<ReturnType<typeof checksDelRenglon>>;
  let columnasDeM3: Awaited<ReturnType<typeof columnasDelRenglon>>;

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarHasta(ULTIMA_DE_M3);
    // Una factura CON un renglón de mercadería cargada en M3, antes de que exista M4.
    await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
    await q(`INSERT INTO "User" ("id","email") VALUES ('u_m42','m42@ejemplo.test')`);
    await q(`INSERT INTO "Proveedor" ("id","empresaId","codigo","nombre") VALUES ('prov_m42',$1,'PRV_M42','Proveedor')`, [E]);
    await q(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('uni_m42',$1,'kg','PESO')`, [E]);
    await q(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId") VALUES ('pro_m42',$1,'MP_M42','Harina','MP','uni_m42')`, [E]);
    await q(`INSERT INTO "FacturaProveedor" ("id","empresaId","proveedorId","fecha","importeTotal","estado","confirmadaEn","confirmadaPorId","creadoPorId") VALUES ('fac_m42',$1,'prov_m42','2026-09-01T15:00:00Z',200.00,'CONFIRMADA',now(),'u_m42','u_m42')`, [E]);
    await q(`INSERT INTO "FacturaProveedorRenglon" ("id","empresaId","facturaProveedorId","orden","naturaleza","productoId","cantidadStock","precioPorUnidadStock","detalle","precioTotal") VALUES ('ren_vieja',$1,'fac_m42',1,'MERCADERIA','pro_m42',10,10,'10 kg',100.00)`, [E]);
    checksDeM3 = await checksDelRenglon();
    columnasDeM3 = await columnasDelRenglon();
    await base.cliente.query(leer(M4_1, "migration.sql"));
    await base.cliente.query(leer(M4_2, "migration.sql"));
  }, 180_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("M3 deja los dos CHECK con los nombres que M4.2 espera (`..._naturaleza_chk` y `..._pareo_mercaderia_chk`)", () => {
    const nombres = checksDeM3.map((c) => c.nombre);
    expect(nombres).toContain("FacturaProveedorRenglon_naturaleza_chk");
    expect(nombres).toContain("FacturaProveedorRenglon_pareo_mercaderia_chk");
  });

  it("el renglón de MERCADERIA cargado ANTES de M4.2 sigue ahí, sin concepto ni tipo de costo, y todos los CHECK nuevos quedaron validados contra él", async () => {
    expect(await q(`SELECT "naturaleza", "conceptoGastoId", "tipoDeCosto" FROM "FacturaProveedorRenglon" WHERE id = 'ren_vieja'`)).toEqual([{ naturaleza: "MERCADERIA", conceptoGastoId: null, tipoDeCosto: null }]);
    expect((await checksDelRenglon()).every((c) => c.validada)).toBe(true);
    expect(await q(`SELECT 1 FROM "FacturaProveedorRenglon" WHERE "naturaleza" = 'MERCADERIA' AND "productoId" IS NOT NULL AND "conceptoGastoId" IS NULL AND "tipoDeCosto" IS NULL`)).toHaveLength(1);
  });

  it("la reversa ABORTA si hay un renglón SIN_STOCK, con un mensaje explícito y sin dejar NADA a medias (los CHECK y las columnas quedan como estaban)", async () => {
    await q(`INSERT INTO "ConceptoDeGasto" ("id","empresaId","codigo","nombre","tipoDeCostoPorDefecto") VALUES ('con_m42',$1,'ALQUILER','Alquiler','GASTO_OPERATIVO')`, [E]);
    await q(`INSERT INTO "FacturaProveedorRenglon" ("id","empresaId","facturaProveedorId","orden","naturaleza","conceptoGastoId","tipoDeCosto","precioTotal") VALUES ('ren_gasto',$1,'fac_m42',2,'SIN_STOCK','con_m42','GASTO_OPERATIVO',100.00)`, [E]);
    const checksArriba = await checksDelRenglon();
    const columnasArriba = await columnasDelRenglon();
    await expect(base.cliente.query(leer(M4_2, "down.sql"))).rejects.toThrow(/No se puede bajar M4\.2: hay 1 renglón/);
    expect(await checksDelRenglon()).toEqual(checksArriba);
    expect(await columnasDelRenglon()).toEqual(columnasArriba);
    expect(await q(`SELECT count(*)::int AS n FROM "FacturaProveedorRenglon"`)).toEqual([{ n: 2 }]);
  });

  it("también aborta si SOLO queda un concepto o un tipo de costo en un renglón de mercadería (no cabe en el esquema de M3)", async () => {
    // (el pareo lo impediría por INSERT; se prueba la guarda aflojando el CHECK un instante, como dueño y dentro de una transacción que se descarta)
    await base.cliente.query("BEGIN");
    try {
      await base.cliente.query(`DELETE FROM "FacturaProveedorRenglon" WHERE id = 'ren_gasto'`);
      await base.cliente.query(`ALTER TABLE "FacturaProveedorRenglon" DROP CONSTRAINT "FacturaProveedorRenglon_pareo_naturaleza_chk"`);
      await base.cliente.query(`UPDATE "FacturaProveedorRenglon" SET "tipoDeCosto" = 'INVERSION' WHERE id = 'ren_vieja'`);
      await expect(base.cliente.query(leer(M4_2, "down.sql"))).rejects.toThrow(/No se puede bajar M4\.2/);
    } finally {
      await base.cliente.query("ROLLBACK");
    }
    expect(await q(`SELECT "tipoDeCosto" FROM "FacturaProveedorRenglon" WHERE id = 'ren_vieja'`)).toEqual([{ tipoDeCosto: null }]);
  });

  it("sin renglones sin stock, la reversa deja los DOS CHECK de M3 con su nombre y su definición EXACTA, sin las columnas nuevas, y el renglón de mercadería intacto", async () => {
    await q(`DELETE FROM "FacturaProveedorRenglon" WHERE id = 'ren_gasto'`);
    await base.cliente.query(leer(M4_2, "down.sql"));
    expect(await checksDelRenglon()).toEqual(checksDeM3);
    expect(await columnasDelRenglon()).toEqual(columnasDeM3);
    expect(await q(`SELECT 1 FROM pg_indexes WHERE indexname IN ('FacturaProveedorRenglon_empresaId_id_naturaleza_key', 'FacturaProveedorRenglon_conceptoGastoId_idx')`)).toHaveLength(0);
    expect(await q(`SELECT 1 FROM pg_constraint WHERE conname = 'FacturaProveedorRenglon_empresaId_conceptoGastoId_fkey'`)).toHaveLength(0);
    expect(await q(`SELECT id FROM "FacturaProveedorRenglon"`)).toEqual([{ id: "ren_vieja" }]);
  });

  it("la reversa es idempotente (correrla otra vez no falla ni cambia nada) y subir otra vez deja lo mismo que la primera vez", async () => {
    await base.cliente.query(leer(M4_2, "down.sql"));
    expect(await checksDelRenglon()).toEqual(checksDeM3);
    await base.cliente.query(leer(M4_2, "migration.sql"));
    const arriba = await checksDelRenglon();
    expect(arriba.map((c) => c.nombre)).toContain("FacturaProveedorRenglon_pareo_naturaleza_chk");
    expect(arriba.every((c) => c.validada)).toBe(true);
    await expect(q(`INSERT INTO "FacturaProveedorRenglon" ("id","empresaId","facturaProveedorId","orden","naturaleza","conceptoGastoId","tipoDeCosto","precioTotal") VALUES ('ren_gasto2',$1,'fac_m42',3,'SIN_STOCK','con_m42','INVERSION',0)`, [E])).rejects.toThrow(/FacturaProveedorRenglon_pareo_naturaleza_chk/);
    expect(await q(`SELECT 1 FROM "FacturaProveedorRenglon" WHERE id = 'ren_vieja'`)).toHaveLength(1);
  });
});

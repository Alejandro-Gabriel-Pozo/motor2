import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, conexionDelDuenio, datosDeConcepto, datosDeRenglonSinStock, esperarBloqueo, intentar, pidDe, sembrarEscenarioDeGasto, type EscenarioDeGasto } from "../setup/gasto";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 3, M4.3 — migración 20261016112000_imputacion_de_gasto: la imputación por sucursal de un renglón SIN STOCK (cuánto del gasto le toca a cada sucursal y cuánto de eso es IVA computable), contra la base real.
 *
 * Qué se mide: el dinero (`importe` > 0; `importeIvaComputable` entre 0 y el importe; DECIMAL(14,2)); UNA parte por (renglón, sucursal) con la carga repetida y simultánea (gana una; la otra recibe 23505; el segundo INSERT espera al primero);
 * la clave foránea CON DISCRIMINADOR (imputar un renglón de MERCADERIA da 23503, aun para el dueño; la naturaleza de un renglón imputado no se puede cambiar); las claves foráneas compuestas (una sucursal o un renglón de OTRA empresa dan 23503);
 * solo agregar (UPDATE, DELETE y TRUNCATE de `motor2_app` dan 42501); y la atomicidad de la carga de un gasto (renglón e imputaciones en una transacción: todo o nada).
 *
 * Mutaciones demostradas (ver el informe del paso): sacar `naturalezaRenglon` de la clave foránea, sacar el único (renglón, sucursal), sacar el CHECK del computable o del importe, dar UPDATE o DELETE a `motor2_app`.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261016112000_imputacion_de_gasto");
const FK_DISCRIMINADOR = "ImputacionDeGasto_empresaId_facturaProveedorRenglonId_natu_fkey";
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

let e: EscenarioDeGasto;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeGasto();
});
afterEach(cerrarConexiones);

const imputar = (extra: Record<string, unknown> = {}) =>
  prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: e.renglonId, sucursalId: e.sucursalA, importe: "100.00", ...extra } as never });
const cuantas = async (filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "ImputacionDeGasto" WHERE ${filtro}`))[0]!.n);

describe("la migración deja la tabla, los índices, las claves foráneas, las reglas, la RLS y los privilegios puestos", () => {
  it("tiene las columnas esperadas, con su tipo y su nulabilidad; el dinero es NUMERIC(14,2) (nunca float) y la naturaleza arranca en SIN_STOCK", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ columna: string; tipo: string; es_nulable: string; por_defecto: string | null; precision: number | null; escala: number | null }>>`
      SELECT column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, column_default AS por_defecto, numeric_precision::int AS precision, numeric_scale::int AS escala
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ImputacionDeGasto' ORDER BY ordinal_position`;
    expect(columnas.map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`)).toEqual([
      "id:text:NO", "empresaId:text:NO", "facturaProveedorRenglonId:text:NO", "naturalezaRenglon:text:NO", "sucursalId:text:NO", "importe:numeric:NO", "importeIvaComputable:numeric:NO", "creadoEn:timestamp without time zone:NO",
    ]);
    const de = (n: string) => columnas.find((c) => c.columna === n)!;
    expect([de("importe").precision, de("importe").escala, de("importeIvaComputable").precision, de("importeIvaComputable").escala]).toEqual([14, 2, 14, 2]);
    expect(de("naturalezaRenglon").por_defecto).toMatch(/'SIN_STOCK'/);
    expect(de("importeIvaComputable").por_defecto).toBe("0");
    expect(de("empresaId").por_defecto).toMatch(/app_empresa_actual\(\)/);
  });

  it("los índices únicos y de consulta son los esperados", async () => {
    const indices = await prismaAdmin.$queryRaw<Array<{ nombre: string; unico: boolean }>>`
      SELECT ic.relname::text AS nombre, i.indisunique AS unico FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid WHERE c.relname = 'ImputacionDeGasto' AND NOT i.indisprimary ORDER BY 1`;
    expect(indices).toEqual([
      { nombre: "ImputacionDeGasto_empresaId_id_key", unico: true },
      { nombre: "ImputacionDeGasto_facturaProveedorRenglonId_sucursalId_key", unico: true },
      { nombre: "ImputacionDeGasto_sucursalId_idx", unico: false },
    ]);
  });

  it("las claves foráneas son RESTRICT y compuestas con empresaId; la del renglón lleva el DISCRIMINADOR (empresaId, renglón, naturalezaRenglon) y ON UPDATE RESTRICT", async () => {
    const fks = await prismaAdmin.$queryRaw<Array<{ nombre: string; definicion: string }>>`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"ImputacionDeGasto"'::regclass AND contype = 'f' ORDER BY 1`;
    expect(fks.map((f) => f.nombre)).toEqual([FK_DISCRIMINADOR, "ImputacionDeGasto_empresaId_fkey", "ImputacionDeGasto_empresaId_sucursalId_fkey"].sort());
    for (const f of fks) expect(f.definicion, f.nombre).toMatch(/ON DELETE RESTRICT/);
    expect(fks.find((f) => f.nombre === FK_DISCRIMINADOR)!.definicion).toBe(
      'FOREIGN KEY ("empresaId", "facturaProveedorRenglonId", "naturalezaRenglon") REFERENCES "FacturaProveedorRenglon"("empresaId", id, naturaleza) ON UPDATE RESTRICT ON DELETE RESTRICT',
    );
    expect(fks.find((f) => f.nombre === "ImputacionDeGasto_empresaId_sucursalId_fkey")!.definicion).toMatch(/FOREIGN KEY \("empresaId", "sucursalId"\) REFERENCES "Sucursal"\("empresaId", id\)/);
  });

  it("los tres CHECK están puestos y validados", async () => {
    const checks = await prismaAdmin.$queryRaw<Array<{ nombre: string; validada: boolean }>>`SELECT conname::text AS nombre, convalidated AS validada FROM pg_constraint WHERE conrelid = '"ImputacionDeGasto"'::regclass AND contype = 'c' ORDER BY 1`;
    expect(checks).toEqual([
      { nombre: "ImputacionDeGasto_importe_positivo_chk", validada: true }, { nombre: "ImputacionDeGasto_iva_computable_chk", validada: true }, { nombre: "ImputacionDeGasto_naturaleza_chk", validada: true },
    ]);
  });

  it("la RLS por empresa está puesta y sin FORCE (las cuatro políticas de sucursal las mide `imputacion-de-gasto-rls`)", async () => {
    const rls = await prismaAdmin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '"ImputacionDeGasto"'::regclass`;
    expect(rls).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
    const [p] = await prismaAdmin.$queryRaw<Array<{ qual: string; with_check: string }>>`SELECT qual, with_check FROM pg_policies WHERE tablename = 'ImputacionDeGasto' AND policyname = 'aislamiento_empresa'`;
    expect([p!.qual, p!.with_check].every((x) => /app_empresa_actual/.test(x))).toBe(true);
  });

  it("SOLO se agrega: motor2_app tiene SELECT e INSERT y NINGÚN UPDATE (ni por columna) ni DELETE; motor2_plataforma, nada", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const filas = await prismaAdmin.$queryRaw<Array<{ rol: string; privilegio: string }>>`
      SELECT grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'ImputacionDeGasto' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`;
    expect(filas.map((f) => `${f.rol}|${f.privilegio}`)).toEqual(["motor2_app|INSERT", "motor2_app|SELECT"]);
    const conUpdate = await prismaAdmin.$queryRaw<Array<{ columna: string }>>`
      SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"ImputacionDeGasto"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE')`;
    expect(conUpdate).toEqual([]);
  });

  it("el migration.sql y el down.sql avisan que requieren autorización, que la reversa puede perder datos y en qué orden se baja", () => {
    expect(readFileSync(join(CARPETA, "migration.sql"), "utf8").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    const reversa = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(reversa).toMatch(/DESTRUCTIVA/);
    expect(reversa).toMatch(/ANTES M4\.4/);
    expect(reversa).toContain('DROP TABLE IF EXISTS "ImputacionDeGasto"');
  });
});

describe("el dinero de la imputación", () => {
  it("una imputación válida se guarda con el importe exacto en centavos y el computable en 0 por defecto", async () => {
    const i = await imputar({ importe: "1234567890.10" });
    expect([i.importe.toFixed(2), i.importeIvaComputable.toFixed(2), i.naturalezaRenglon]).toEqual(["1234567890.10", "0.00", "SIN_STOCK"]);
  });

  it("el importe tiene que ser MAYOR que cero: cero y negativo se rechazan (…_importe_positivo_chk)", async () => {
    for (const malo of ["0.00", "-0.01", "-100"]) await expect(imputar({ importe: malo }), malo).rejects.toThrow(/ImputacionDeGasto_importe_positivo_chk/);
    expect((await imputar({ importe: "0.01" })).importe.toFixed(2)).toBe("0.01");
  });

  it("el IVA computable está entre 0 y el importe, ambos inclusive (…_iva_computable_chk): negativo o mayor que el importe se rechaza", async () => {
    await expect(imputar({ importeIvaComputable: "-0.01" })).rejects.toThrow(/ImputacionDeGasto_iva_computable_chk/);
    await expect(imputar({ importeIvaComputable: "100.01" })).rejects.toThrow(/ImputacionDeGasto_iva_computable_chk/);
    expect((await imputar({ importeIvaComputable: "100.00" })).importeIvaComputable.toFixed(2)).toBe("100.00");
    expect((await imputar({ sucursalId: e.sucursalB, importeIvaComputable: "0" })).importeIvaComputable.toFixed(2)).toBe("0.00");
  });

  it("un importe que no entra en NUMERIC(14,2) se rechaza en vez de redondearse en silencio", async () => {
    await expect(imputar({ importe: "1000000000000.00" })).rejects.toThrow(/out of range|numeric field overflow|too large/i);
  });

  it("la naturaleza guardada es siempre SIN_STOCK: cualquier otra se rechaza (…_naturaleza_chk)", async () => {
    await expect(imputar({ naturalezaRenglon: "MERCADERIA" })).rejects.toThrow(/ImputacionDeGasto_naturaleza_chk/);
    await expect(imputar({ naturalezaRenglon: "OTRA" })).rejects.toThrow(/ImputacionDeGasto_naturaleza_chk/);
  });
});

describe("la clave foránea con discriminador: la base impide imputar mercadería", () => {
  it("imputar un renglón de MERCADERIA da 23503 sobre la clave foránea del discriminador, aun escribiendo como DUEÑO", async () => {
    const duenio = await conexionDelDuenio();
    const insertar = (renglonId: string) =>
      intentar(duenio, `INSERT INTO "ImputacionDeGasto" ("id","empresaId","facturaProveedorRenglonId","sucursalId","importe") VALUES ($1,$2,$3,$4,50.00)`, [randomUUID(), EMPRESA_DE_PRUEBA_ID, renglonId, e.sucursalA]);
    expect(await insertar(e.renglonMercaderiaId)).toEqual({ codigo: "23503", restriccion: FK_DISCRIMINADOR });
    expect(await insertar(e.renglonId)).toBeNull();
    expect(await insertar("no-existe")).toEqual({ codigo: "23503", restriccion: FK_DISCRIMINADOR });
  });

  it("la naturaleza de un renglón con imputaciones NO se puede cambiar (ON UPDATE RESTRICT) ni se puede borrar el renglón, ni como dueño", async () => {
    await imputar();
    const duenio = await conexionDelDuenio();
    // Un UPDATE que cumple el pareo de MERCADERIA, para que la que frene sea la clave foránea y no el CHECK.
    const comoMercaderia = await intentar(
      duenio,
      `UPDATE "FacturaProveedorRenglon" SET "naturaleza" = 'MERCADERIA', "conceptoGastoId" = NULL, "tipoDeCosto" = NULL, "productoId" = $2, "cantidadStock" = 1, "precioPorUnidadStock" = 200, "detalle" = '1 kg' WHERE "id" = $1`,
      [e.renglonId, e.productoId],
    );
    expect(comoMercaderia).toEqual({ codigo: "23503", restriccion: FK_DISCRIMINADOR });
    expect(await intentar(duenio, `DELETE FROM "FacturaProveedorRenglon" WHERE "id" = $1`, [e.renglonId])).toEqual({ codigo: "23503", restriccion: FK_DISCRIMINADOR });
    const [r] = await prismaAdmin.$queryRaw<Array<{ naturaleza: string }>>`SELECT "naturaleza" FROM "FacturaProveedorRenglon" WHERE "id" = ${e.renglonId}`;
    expect(r!.naturaleza).toBe("SIN_STOCK");
  });

  it("una sucursal con imputaciones no se puede borrar (RESTRICT)", async () => {
    // Una sucursal sin secciones ni otras filas, para que la única que la frene sea la imputación.
    const sur = await prisma.sucursal.create({ data: { nombre: "Sur" } });
    await imputar({ sucursalId: sur.id });
    const duenio = await conexionDelDuenio();
    expect(await intentar(duenio, `DELETE FROM "Sucursal" WHERE "id" = $1`, [sur.id])).toMatchObject({ codigo: "23503", restriccion: "ImputacionDeGasto_empresaId_sucursalId_fkey" });
  });
});

describe("aislamiento entre empresas (claves foráneas compuestas con empresaId)", () => {
  it("una sucursal o un renglón de OTRA empresa dan 23503, aun escribiendo como dueño con el empresaId explícito", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const conceptoAjeno = await ajeno.testigo.conceptoDeGasto.create({ data: datosDeConcepto() });
    const renglonAjeno = await ajeno.testigo.facturaProveedorRenglon.create({ data: datosDeRenglonSinStock({ facturaProveedorId: ajeno.factura.id, conceptoGastoId: conceptoAjeno.id }, { orden: 2 }) as never });
    const duenio = await conexionDelDuenio();
    const insertar = (empresaId: string, renglonId: string, sucursalId: string) =>
      intentar(duenio, `INSERT INTO "ImputacionDeGasto" ("id","empresaId","facturaProveedorRenglonId","sucursalId","importe") VALUES ($1,$2,$3,$4,50.00)`, [randomUUID(), empresaId, renglonId, sucursalId]);
    expect(await insertar(EMPRESA_DE_PRUEBA_ID, e.renglonId, ajeno.sucursal.id)).toEqual({ codigo: "23503", restriccion: "ImputacionDeGasto_empresaId_sucursalId_fkey" });
    expect(await insertar(EMPRESA_DE_PRUEBA_ID, renglonAjeno.id, e.sucursalA)).toEqual({ codigo: "23503", restriccion: FK_DISCRIMINADOR });
    expect(await insertar(EMPRESA_TESTIGO_ID, renglonAjeno.id, ajeno.sucursal.id)).toBeNull();
    expect(await insertar(EMPRESA_TESTIGO_ID, e.renglonId, ajeno.sucursal.id)).toEqual({ codigo: "23503", restriccion: FK_DISCRIMINADOR });
  });

  it("como motor2_app, la empresa B no ve las imputaciones de A y un INSERT con el empresaId de A da 42501", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await imputar();
    const ajeno = await sembrarAjeno(e.usuarioId);
    const b = await conexionComoApp(EMPRESA_TESTIGO_ID, { lectura: [ajeno.sucursal.id], escritura: [ajeno.sucursal.id] });
    expect((await b.query(`SELECT 1 FROM "ImputacionDeGasto"`)).rowCount).toBe(0);
    expect(await intentar(b, `INSERT INTO "ImputacionDeGasto" ("id","empresaId","facturaProveedorRenglonId","sucursalId","importe") VALUES ($1,$2,$3,$4,10.00)`, [randomUUID(), EMPRESA_DE_PRUEBA_ID, e.renglonId, ajeno.sucursal.id])).toMatchObject({ codigo: "42501" });
    expect(await cuantas()).toBe(1);
  });
});

describe("una parte por (renglón, sucursal): la carga repetida o simultánea no duplica", () => {
  const sentencia = (renglonId: string, sucursalId: string, id = randomUUID()) => ({
    texto: `INSERT INTO "ImputacionDeGasto" ("id","facturaProveedorRenglonId","sucursalId","importe") VALUES ($1,$2,$3,100.00)`,
    params: [id, renglonId, sucursalId],
  });
  const alcanceDeAmbas = () => ({ lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] });

  it("repetir la misma parte da 23505 sobre el único (renglón, sucursal) y la cuenta sigue en 1; otra sucursal u otro renglón entran", async () => {
    await imputar();
    await expect(imputar()).rejects.toMatchObject({ code: "P2002" });
    await expect(imputar()).rejects.toThrow(/ImputacionDeGasto_facturaProveedorRenglonId_sucursalId_key|Unique constraint/);
    expect(await cuantas()).toBe(1);
    await imputar({ sucursalId: e.sucursalB });
    expect(await cuantas()).toBe(2);
    const otro = await prisma.facturaProveedorRenglon.create({ data: datosDeRenglonSinStock({ facturaProveedorId: e.facturaId, conceptoGastoId: e.conceptoId }, { orden: 3 }) as never });
    await imputar({ facturaProveedorRenglonId: otro.id });
    expect(await cuantas()).toBe(3);
  });

  it("dos clientes a la vez con la misma parte: exactamente una confirma y la otra recibe 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await Promise.all([conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcanceDeAmbas()), conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcanceDeAmbas())]);
    const s1 = sentencia(e.renglonId, e.sucursalA);
    const s2 = sentencia(e.renglonId, e.sucursalA);
    const resultados = await Promise.all([intentar(a, s1.texto, s1.params), intentar(b, s2.texto, s2.params)]);
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r !== null)).toEqual([{ codigo: "23505", restriccion: "ImputacionDeGasto_facturaProveedorRenglonId_sucursalId_key" }]);
    expect(await cuantas()).toBe(1);
  });

  it("ocho clientes a la vez: una sola parte queda guardada y las otras siete reciben 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const clientes = await Promise.all(Array.from({ length: 8 }, () => conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcanceDeAmbas())));
    const resultados = await Promise.all(clientes.map((c) => { const s = sentencia(e.renglonId, e.sucursalB); return intentar(c, s.texto, s.params); }));
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r?.codigo === "23505" && r.restriccion === "ImputacionDeGasto_facturaProveedorRenglonId_sucursalId_key")).toHaveLength(7);
    expect(await cuantas()).toBe(1);
  });

  it("el segundo INSERT ESPERA al primero: si éste hace ROLLBACK, entra; si CONFIRMA, recibe 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await Promise.all([conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcanceDeAmbas()), conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcanceDeAmbas())]);
    const pidDeB = await pidDe(b);
    // 1) ROLLBACK de la primera.
    await a.query("BEGIN");
    const primera = sentencia(e.renglonId, e.sucursalA);
    await a.query(primera.texto, primera.params);
    await b.query("BEGIN");
    const segunda = sentencia(e.renglonId, e.sucursalA);
    const esperando = b.query(segunda.texto, segunda.params);
    await esperarBloqueo(pidDeB);
    await a.query("ROLLBACK");
    expect((await esperando).rowCount).toBe(1);
    await b.query("COMMIT");
    expect(await cuantas()).toBe(1);
    // 2) COMMIT de la primera, sobre otra sucursal.
    await a.query("BEGIN");
    const tercera = sentencia(e.renglonId, e.sucursalB);
    await a.query(tercera.texto, tercera.params);
    await b.query("BEGIN");
    const cuarta = sentencia(e.renglonId, e.sucursalB);
    const perdedora = b.query(cuarta.texto, cuarta.params).then(() => "entró" as const, (error: { code?: string; constraint?: string }) => `${error.code}|${error.constraint}`);
    await esperarBloqueo(pidDeB);
    await a.query("COMMIT");
    expect(await perdedora).toBe("23505|ImputacionDeGasto_facturaProveedorRenglonId_sucursalId_key");
    await b.query("ROLLBACK");
    expect(await cuantas()).toBe(2);
  });

  it("ATOMICIDAD: dos cargas simultáneas del MISMO gasto (renglón + sus dos imputaciones en una transacción) dejan UNA sola, completa; la perdedora no deja ni una fila suelta", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await Promise.all([conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcanceDeAmbas()), conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcanceDeAmbas())]);
    const cargarGasto = async (c: typeof a) => {
      const renglonId = randomUUID();
      try {
        await c.query("BEGIN");
        await c.query(
          `INSERT INTO "FacturaProveedorRenglon" ("id","facturaProveedorId","orden","naturaleza","conceptoGastoId","tipoDeCosto","precioTotal") VALUES ($1,$2,9,'SIN_STOCK',$3,'GASTO_OPERATIVO',200.00)`,
          [renglonId, e.facturaId, e.conceptoId],
        );
        await c.query(`INSERT INTO "ImputacionDeGasto" ("id","facturaProveedorRenglonId","sucursalId","importe") VALUES ($1,$2,$3,120.00)`, [randomUUID(), renglonId, e.sucursalA]);
        await c.query(`INSERT INTO "ImputacionDeGasto" ("id","facturaProveedorRenglonId","sucursalId","importe") VALUES ($1,$2,$3,80.00)`, [randomUUID(), renglonId, e.sucursalB]);
        await c.query("COMMIT");
        return "ok" as const;
      } catch (error) {
        await c.query("ROLLBACK").catch(() => undefined);
        return `${(error as { code?: string }).code}|${(error as { constraint?: string }).constraint}`;
      }
    };
    const resultados = await Promise.all([cargarGasto(a), cargarGasto(b)]);
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r !== "ok")).toEqual(["23505|FacturaProveedorRenglon_facturaProveedorId_orden_key"]);
    expect(Number((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "FacturaProveedorRenglon" WHERE "orden" = 9`)[0]!.n)).toBe(1);
    expect(await cuantas()).toBe(2);
    const [suma] = await prismaAdmin.$queryRaw<Array<{ s: string }>>`SELECT sum("importe")::text AS s FROM "ImputacionDeGasto"`;
    expect(suma!.s).toBe("200.00");
  });

  it("ATOMICIDAD: si la última imputación de la carga falla, no queda NADA de la carga (ni el renglón ni las imputaciones anteriores)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const a = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcanceDeAmbas());
    await a.query("BEGIN");
    const renglonId = randomUUID();
    await a.query(`INSERT INTO "FacturaProveedorRenglon" ("id","facturaProveedorId","orden","naturaleza","conceptoGastoId","tipoDeCosto","precioTotal") VALUES ($1,$2,8,'SIN_STOCK',$3,'GASTO_OPERATIVO',200.00)`, [renglonId, e.facturaId, e.conceptoId]);
    await a.query(`INSERT INTO "ImputacionDeGasto" ("id","facturaProveedorRenglonId","sucursalId","importe") VALUES ($1,$2,$3,120.00)`, [randomUUID(), renglonId, e.sucursalA]);
    await expect(a.query(`INSERT INTO "ImputacionDeGasto" ("id","facturaProveedorRenglonId","sucursalId","importe") VALUES ($1,$2,$3,0)`, [randomUUID(), renglonId, e.sucursalB])).rejects.toMatchObject({ code: "23514" });
    await a.query("ROLLBACK");
    expect(Number((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "FacturaProveedorRenglon" WHERE "orden" = 8`)[0]!.n)).toBe(0);
    expect(await cuantas()).toBe(0);
  });
});

describe("solo se agrega: la app no modifica ni borra una imputación (la anulación se lee desde FacturaProveedor.anuladaEn)", () => {
  it("UPDATE de cualquier columna, DELETE y TRUNCATE de una imputación propia dan 42501", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const propia = await imputar();
    const app = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, { lectura: [e.sucursalA], escritura: [e.sucursalA] });
    for (const set of [`"importe" = 1`, `"importeIvaComputable" = 1`, `"sucursalId" = '${e.sucursalB}'`, `"facturaProveedorRenglonId" = '${e.renglonMercaderiaId}'`, `"naturalezaRenglon" = 'MERCADERIA'`, `"empresaId" = 'empresa_testigo'`]) {
      expect(await intentar(app, `UPDATE "ImputacionDeGasto" SET ${set} WHERE "id" = $1`, [propia.id]), set).toMatchObject({ codigo: "42501" });
    }
    expect(await intentar(app, `DELETE FROM "ImputacionDeGasto" WHERE "id" = $1`, [propia.id])).toMatchObject({ codigo: "42501" });
    expect(await intentar(app, `TRUNCATE "ImputacionDeGasto"`)).toMatchObject({ codigo: "42501" });
    const relida = await prismaAdmin.imputacionDeGasto.findUniqueOrThrow({ where: { id: propia.id } });
    expect([relida.importe.toFixed(2), relida.sucursalId, relida.facturaProveedorRenglonId]).toEqual(["100.00", e.sucursalA, e.renglonId]);
  });

  it("la anulación de la factura NO toca las imputaciones: siguen ahí (historia) y quien lee decide por FacturaProveedor.anuladaEn", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await imputar();
    const app = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, { lectura: [e.sucursalA], escritura: [e.sucursalA] });
    expect(await intentar(app, `UPDATE "FacturaProveedor" SET "anuladaEn" = now(), "anuladaPorId" = $2 WHERE "id" = $1`, [e.facturaId, e.usuarioId])).toBeNull();
    expect(await cuantas()).toBe(1);
    const leidas = await app.query(`SELECT i."id", f."anuladaEn" FROM "ImputacionDeGasto" i JOIN "FacturaProveedorRenglon" r ON r."id" = i."facturaProveedorRenglonId" JOIN "FacturaProveedor" f ON f."id" = r."facturaProveedorId"`);
    expect(leidas.rows).toHaveLength(1);
    expect(leidas.rows[0].anuladaEn).toBeInstanceOf(Date);
  });
});

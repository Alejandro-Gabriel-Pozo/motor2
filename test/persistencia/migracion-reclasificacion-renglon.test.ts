import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import {
  cerrarConexiones, conexionComoApp, conexionDelDuenio, datosDeConcepto, datosDeReclasificacion, datosDeRenglonSinStock, intentar, sembrarEscenarioDeGasto, sentenciaDeReclasificacion, TIPOS_DE_COSTO, type EscenarioDeGasto,
} from "../setup/gasto";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 4, M5 — migración 20261017100000_reclasificacion_renglon: la reclasificación versionada (concepto y tipo de costo) de un renglón SIN STOCK de la factura de proveedor, contra la base real.
 *
 * Qué se mide: la estructura exacta (columnas, índices, claves foráneas, CHECK, RLS, privilegios; ninguna columna de dinero); las reglas (los cinco tipos de costo, `numero` ≥ 1, el motivo con un carácter visible y hasta 200, la naturaleza fija);
 * la clave foránea CON DISCRIMINADOR (reclasificar mercadería da 23503, aun para el dueño); las claves foráneas compuestas (un renglón o un concepto de OTRA empresa dan 23503); la RLS por empresa (tabla DE EMPRESA: la ve cualquier sucursal);
 * solo agregar (UPDATE, DELETE y TRUNCATE de `motor2_app` dan 42501); que reclasificar no toca un solo importe; y cuál es la versión vigente (la de `numero` mayor; sin ninguna, el renglón).
 * La concurrencia, la idempotencia y la atomicidad las mide `reclasificacion-renglon-concurrencia`; subir, bajar y subir, `paquete-3-m4-subir-bajar-subir`.
 *
 * Mutaciones demostradas (ver las filas O.282 a O.285 de docs/pureza-integracion.md): clave foránea de dos columnas sin el discriminador, GRANT UPDATE a `motor2_app`, sacar `RESULTADO_FINANCIERO` del CHECK, ampliar el motivo a 300, sacar el ENABLE ROW LEVEL SECURITY.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261017100000_reclasificacion_renglon");
const FK_DISCRIMINADOR = "ReclasificacionRenglon_empresaId_facturaProveedorRenglonId_fkey";
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

let e: EscenarioDeGasto;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeGasto();
});
afterEach(cerrarConexiones);

const reclasificar = (extra: Record<string, unknown> = {}) => prisma.reclasificacionRenglon.create({ data: datosDeReclasificacion(e, extra) as never });
const cuantas = async (filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "ReclasificacionRenglon" WHERE ${filtro}`))[0]!.n);
/** Los valores listados en la definición de un CHECK de tipo de costo, ordenados. */
const valoresDelCheck = (definicion: string) => [...definicion.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]!).sort();

describe("la migración deja la tabla, los índices, las claves foráneas, las reglas, la RLS y los privilegios puestos", () => {
  it("tiene las columnas esperadas, con su tipo y su nulabilidad; NINGUNA es de dinero (no hay numeric ni float) y la naturaleza arranca en SIN_STOCK", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ columna: string; tipo: string; es_nulable: string; por_defecto: string | null }>>`
      SELECT column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, column_default AS por_defecto
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ReclasificacionRenglon' ORDER BY ordinal_position`;
    expect(columnas.map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`)).toEqual([
      "id:text:NO", "empresaId:text:NO", "facturaProveedorRenglonId:text:NO", "naturalezaRenglon:text:NO", "numero:integer:NO", "conceptoGastoId:text:NO", "tipoDeCosto:text:NO", "motivo:text:NO",
      "claveIdempotencia:text:NO", "payloadHash:text:NO", "resultadoMensaje:text:NO", "creadoPorId:text:NO", "creadoEn:timestamp without time zone:NO",
    ]);
    expect(columnas.filter((c) => /numeric|double|real|money/.test(c.tipo))).toEqual([]);
    const de = (n: string) => columnas.find((c) => c.columna === n)!;
    expect(de("naturalezaRenglon").por_defecto).toMatch(/'SIN_STOCK'/);
    expect(de("empresaId").por_defecto).toMatch(/app_empresa_actual\(\)/);
    expect(de("creadoEn").por_defecto).toMatch(/CURRENT_TIMESTAMP/);
  });

  it("los índices únicos y de consulta son los esperados", async () => {
    const indices = await prismaAdmin.$queryRaw<Array<{ nombre: string; unico: boolean }>>`
      SELECT ic.relname::text AS nombre, i.indisunique AS unico FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid WHERE c.relname = 'ReclasificacionRenglon' AND NOT i.indisprimary ORDER BY 1`;
    expect(indices).toEqual([
      { nombre: "ReclasificacionRenglon_claveIdempotencia_key", unico: true },
      { nombre: "ReclasificacionRenglon_conceptoGastoId_idx", unico: false },
      { nombre: "ReclasificacionRenglon_empresaId_id_key", unico: true },
      { nombre: "ReclasificacionRenglon_facturaProveedorRenglonId_numero_key", unico: true },
    ]);
  });

  it("las cuatro claves foráneas son RESTRICT; la del renglón lleva el DISCRIMINADOR (empresaId, renglón, naturalezaRenglon) y ON UPDATE RESTRICT", async () => {
    const fks = await prismaAdmin.$queryRaw<Array<{ nombre: string; definicion: string }>>`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"ReclasificacionRenglon"'::regclass AND contype = 'f' ORDER BY 1`;
    expect(fks.map((f) => f.nombre)).toEqual([FK_DISCRIMINADOR, "ReclasificacionRenglon_creadoPorId_fkey", "ReclasificacionRenglon_empresaId_conceptoGastoId_fkey", "ReclasificacionRenglon_empresaId_fkey"].sort());
    for (const f of fks) expect(f.definicion, f.nombre).toMatch(/ON DELETE RESTRICT/);
    expect(fks.find((f) => f.nombre === FK_DISCRIMINADOR)!.definicion).toBe(
      'FOREIGN KEY ("empresaId", "facturaProveedorRenglonId", "naturalezaRenglon") REFERENCES "FacturaProveedorRenglon"("empresaId", id, naturaleza) ON UPDATE RESTRICT ON DELETE RESTRICT',
    );
    expect(fks.find((f) => f.nombre === "ReclasificacionRenglon_empresaId_conceptoGastoId_fkey")!.definicion).toMatch(/FOREIGN KEY \("empresaId", "conceptoGastoId"\) REFERENCES "ConceptoDeGasto"\("empresaId", id\)/);
    expect(fks.find((f) => f.nombre === "ReclasificacionRenglon_creadoPorId_fkey")!.definicion).toMatch(/FOREIGN KEY \("creadoPorId"\) REFERENCES "User"\(id\)/);
  });

  it("los cuatro CHECK están puestos y validados", async () => {
    const checks = await prismaAdmin.$queryRaw<Array<{ nombre: string; validada: boolean }>>`SELECT conname::text AS nombre, convalidated AS validada FROM pg_constraint WHERE conrelid = '"ReclasificacionRenglon"'::regclass AND contype = 'c' ORDER BY 1`;
    expect(checks).toEqual([
      { nombre: "ReclasificacionRenglon_motivo_chk", validada: true },
      { nombre: "ReclasificacionRenglon_naturaleza_chk", validada: true },
      { nombre: "ReclasificacionRenglon_numero_chk", validada: true },
      { nombre: "ReclasificacionRenglon_tipo_de_costo_chk", validada: true },
    ]);
  });

  it("la RLS por empresa está puesta, sin FORCE, y `aislamiento_empresa` es la ÚNICA política (la tabla es DE EMPRESA: no tiene políticas de sucursal)", async () => {
    const rls = await prismaAdmin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '"ReclasificacionRenglon"'::regclass`;
    expect(rls).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
    const politicas = await prismaAdmin.$queryRaw<Array<{ nombre: string; qual: string; with_check: string }>>`SELECT policyname::text AS nombre, qual, with_check FROM pg_policies WHERE tablename = 'ReclasificacionRenglon'`;
    expect(politicas.map((p) => p.nombre)).toEqual(["aislamiento_empresa"]);
    expect([politicas[0]!.qual, politicas[0]!.with_check].every((x) => /app_empresa_actual/.test(x))).toBe(true);
  });

  it("SOLO se agrega: motor2_app tiene SELECT e INSERT y NINGÚN UPDATE (ni por columna) ni DELETE; motor2_plataforma, nada", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const filas = await prismaAdmin.$queryRaw<Array<{ rol: string; privilegio: string }>>`
      SELECT grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'ReclasificacionRenglon' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`;
    expect(filas.map((f) => `${f.rol}|${f.privilegio}`)).toEqual(["motor2_app|INSERT", "motor2_app|SELECT"]);
    const conUpdate = await prismaAdmin.$queryRaw<Array<{ columna: string }>>`
      SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"ReclasificacionRenglon"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE')`;
    expect(conUpdate).toEqual([]);
  });

  it("el migration.sql y el down.sql avisan que requieren autorización y que la reversa aborta con filas, y no se disfrazan de migración de políticas de sucursal", () => {
    const subida = readFileSync(join(CARPETA, "migration.sql"), "utf8");
    expect(subida.split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    const reversa = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(reversa).toMatch(/ABORTA/);
    expect(reversa).toContain('DROP TABLE IF EXISTS "ReclasificacionRenglon"');
    for (const sql of [subida, reversa]) {
      expect(sql).not.toContain("alcance_sucursal_");
      expect(sql).not.toContain("app_sucursales_");
    }
  });
});

describe("las reglas de la reclasificación", () => {
  it("los cinco tipos de costo entran (una versión cada uno) y cualquier otro valor da 23514", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    for (const [i, tipo] of TIPOS_DE_COSTO.entries()) {
      const s = sentenciaDeReclasificacion(e, { numero: i + 1, tipoDeCosto: tipo });
      expect(await intentar(app, s.texto, s.params), tipo).toBeNull();
    }
    expect(await cuantas()).toBe(5);
    for (const malo of ["OTRO", "gasto_operativo", "", "COSTO_DE_VENTAS "]) {
      const s = sentenciaDeReclasificacion(e, { numero: 6, tipoDeCosto: malo });
      expect(await intentar(app, s.texto, s.params), malo).toEqual({ codigo: "23514", restriccion: "ReclasificacionRenglon_tipo_de_costo_chk" });
    }
    expect(await cuantas()).toBe(5);
  });

  it("el CHECK del tipo de costo lista EXACTAMENTE `TIPOS_DE_COSTO`, y es la misma lista que la del concepto y la del renglón", async () => {
    const definiciones = await prismaAdmin.$queryRaw<Array<{ nombre: string; definicion: string }>>`
      SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
       WHERE conname IN ('ConceptoDeGasto_tipo_de_costo_chk', 'FacturaProveedorRenglon_tipo_de_costo_chk', 'ReclasificacionRenglon_tipo_de_costo_chk') ORDER BY 1`;
    expect(definiciones).toHaveLength(3);
    const esperado = [...TIPOS_DE_COSTO].sort();
    for (const d of definiciones) expect(valoresDelCheck(d.definicion), d.nombre).toEqual(esperado);
  });

  it("`numero` es 1 o más: 0 y -1 dan 23514, y el 1 entra", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    for (const malo of [0, -1]) {
      const s = sentenciaDeReclasificacion(e, { numero: malo });
      expect(await intentar(app, s.texto, s.params), String(malo)).toEqual({ codigo: "23514", restriccion: "ReclasificacionRenglon_numero_chk" });
    }
    const bueno = sentenciaDeReclasificacion(e, { numero: 1 });
    expect(await intentar(app, bueno.texto, bueno.params)).toBeNull();
  });

  it("el motivo exige un carácter visible y hasta 200: vacío, blancos, tabulador y salto, y 201 dan 23514; 200 entra; NULL da 23502", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    for (const malo of ["", "   ", "\t\n", "x".repeat(201)]) {
      const s = sentenciaDeReclasificacion(e, { motivo: malo });
      expect(await intentar(app, s.texto, s.params), JSON.stringify(malo.slice(0, 5)) + malo.length).toEqual({ codigo: "23514", restriccion: "ReclasificacionRenglon_motivo_chk" });
    }
    const sinMotivo = sentenciaDeReclasificacion(e, { motivo: null });
    expect(await intentar(app, sinMotivo.texto, sinMotivo.params)).toMatchObject({ codigo: "23502" });
    const justo = sentenciaDeReclasificacion(e, { numero: 1, motivo: "x".repeat(200) });
    expect(await intentar(app, justo.texto, justo.params)).toBeNull();
    const conBlancosAlRededor = sentenciaDeReclasificacion(e, { numero: 2, motivo: "  ok  " });
    expect(await intentar(app, conBlancosAlRededor.texto, conBlancosAlRededor.params)).toBeNull();
    expect(await cuantas()).toBe(2);
  });

  it("la naturaleza guardada es siempre SIN_STOCK: cualquier otra se rechaza (…_naturaleza_chk)", async () => {
    await expect(reclasificar({ naturalezaRenglon: "MERCADERIA" })).rejects.toThrow(/ReclasificacionRenglon_naturaleza_chk/);
    await expect(reclasificar({ naturalezaRenglon: "OTRA" })).rejects.toThrow(/ReclasificacionRenglon_naturaleza_chk/);
    const ok = await reclasificar();
    expect([ok.naturalezaRenglon, ok.numero, ok.tipoDeCosto, ok.conceptoGastoId]).toEqual(["SIN_STOCK", 1, "EXTRAORDINARIO", e.conceptoId]);
  });
});

describe("la clave foránea con discriminador: la base impide reclasificar mercadería", () => {
  it("reclasificar un renglón de MERCADERIA o inexistente da 23503 sobre la clave foránea del discriminador, aun escribiendo como DUEÑO", async () => {
    const duenio = await conexionDelDuenio();
    const insertar = (renglonId: string) => {
      const s = sentenciaDeReclasificacion({ ...e, renglonId }, { empresaId: EMPRESA_DE_PRUEBA_ID });
      return intentar(duenio, s.texto, s.params);
    };
    expect(await insertar(e.renglonMercaderiaId)).toEqual({ codigo: "23503", restriccion: FK_DISCRIMINADOR });
    expect(await insertar(e.renglonId)).toBeNull();
    expect(await insertar("no-existe")).toEqual({ codigo: "23503", restriccion: FK_DISCRIMINADOR });
  });

  it("la naturaleza de un renglón reclasificado NO se puede cambiar (ON UPDATE RESTRICT) ni se puede borrar el renglón, ni como dueño", async () => {
    await reclasificar();
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

  it("un concepto o un usuario con reclasificaciones no se pueden borrar (RESTRICT), ni como dueño", async () => {
    const otro = await prisma.conceptoDeGasto.create({ data: datosDeConcepto({ codigo: "LUZ", nombre: "Luz" }) });
    const autor = await prisma.user.create({ data: { email: "contador@test.com" } });
    await reclasificar({ conceptoGastoId: otro.id, creadoPorId: autor.id });
    const duenio = await conexionDelDuenio();
    expect(await intentar(duenio, `DELETE FROM "ConceptoDeGasto" WHERE "id" = $1`, [otro.id])).toEqual({ codigo: "23503", restriccion: "ReclasificacionRenglon_empresaId_conceptoGastoId_fkey" });
    expect(await intentar(duenio, `DELETE FROM "User" WHERE "id" = $1`, [autor.id])).toEqual({ codigo: "23503", restriccion: "ReclasificacionRenglon_creadoPorId_fkey" });
    expect(await cuantas()).toBe(1);
  });
});

describe("aislamiento entre empresas (claves foráneas compuestas con empresaId y RLS)", () => {
  it("un renglón o un concepto de OTRA empresa dan 23503, aun escribiendo como dueño con el empresaId explícito", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const conceptoAjeno = await ajeno.testigo.conceptoDeGasto.create({ data: datosDeConcepto() });
    const renglonAjeno = await ajeno.testigo.facturaProveedorRenglon.create({ data: datosDeRenglonSinStock({ facturaProveedorId: ajeno.factura.id, conceptoGastoId: conceptoAjeno.id }, { orden: 2 }) as never });
    const duenio = await conexionDelDuenio();
    const insertar = (empresaId: string, renglonId: string, conceptoId: string) => {
      const s = sentenciaDeReclasificacion({ ...e, renglonId, conceptoId }, { empresaId });
      return intentar(duenio, s.texto, s.params);
    };
    expect(await insertar(EMPRESA_DE_PRUEBA_ID, renglonAjeno.id, e.conceptoId)).toEqual({ codigo: "23503", restriccion: FK_DISCRIMINADOR });
    expect(await insertar(EMPRESA_DE_PRUEBA_ID, e.renglonId, conceptoAjeno.id)).toEqual({ codigo: "23503", restriccion: "ReclasificacionRenglon_empresaId_conceptoGastoId_fkey" });
    expect(await insertar(EMPRESA_TESTIGO_ID, renglonAjeno.id, conceptoAjeno.id)).toBeNull();
    expect(await insertar(EMPRESA_TESTIGO_ID, e.renglonId, conceptoAjeno.id)).toEqual({ codigo: "23503", restriccion: FK_DISCRIMINADOR });
  });

  it("como motor2_app, la empresa B no ve las reclasificaciones de A y un INSERT con el empresaId de A da 42501", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await reclasificar();
    await sembrarAjeno(e.usuarioId);
    const b = await conexionComoApp(EMPRESA_TESTIGO_ID);
    expect((await b.query(`SELECT 1 FROM "ReclasificacionRenglon"`)).rowCount).toBe(0);
    const s = sentenciaDeReclasificacion(e, { empresaId: EMPRESA_DE_PRUEBA_ID, numero: 2 });
    expect(await intentar(b, s.texto, s.params)).toMatchObject({ codigo: "42501" });
    expect(await cuantas()).toBe(1);
  });
});

describe("la tabla es DE EMPRESA: se ve desde cualquier sucursal (igual que el renglón), no solo desde las sucursales imputadas", () => {
  it("con el alcance de la sucursal A, y también sin alcance, se ve la reclasificación de un renglón imputado SOLO a la sucursal B", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: e.renglonId, sucursalId: e.sucursalB, importe: "200.00" } as never });
    const creada = await reclasificar();
    const soloA = baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalA] }).db;
    // Contraste: la imputación (PROPIA) no se ve desde A, el renglón y la reclasificación (DE EMPRESA) sí.
    expect(await soloA.imputacionDeGasto.findMany()).toEqual([]);
    expect((await soloA.facturaProveedorRenglon.findMany({ where: { naturaleza: "SIN_STOCK" } })).map((r) => r.id)).toEqual([e.renglonId]);
    expect((await soloA.reclasificacionRenglon.findMany()).map((r) => r.id)).toEqual([creada.id]);
    expect((await baseDeTest.db.reclasificacionRenglon.findMany()).map((r) => r.id)).toEqual([creada.id]);
  });
});

describe("solo se agrega: la app no modifica ni borra una reclasificación", () => {
  it("UPDATE de cualquier columna, DELETE y TRUNCATE dan 42501 y la fila queda intacta", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const propia = await reclasificar();
    const app = await conexionComoApp();
    const columnas: Array<[string, string]> = [
      ["facturaProveedorRenglonId", `'${e.renglonMercaderiaId}'`], ["naturalezaRenglon", `'MERCADERIA'`], ["numero", "7"], ["conceptoGastoId", `'${e.conceptoId}'`], ["tipoDeCosto", `'INVERSION'`], ["motivo", `'otro'`],
      ["claveIdempotencia", `'${randomUUID()}'`], ["payloadHash", `'otra'`], ["resultadoMensaje", `'otro'`], ["creadoPorId", `'${e.usuarioId}'`], ["creadoEn", "now()"], ["empresaId", `'${EMPRESA_TESTIGO_ID}'`], ["id", `'${randomUUID()}'`],
    ];
    for (const [columna, valor] of columnas) {
      expect(await intentar(app, `UPDATE "ReclasificacionRenglon" SET "${columna}" = ${valor} WHERE "id" = $1`, [propia.id]), columna).toMatchObject({ codigo: "42501" });
    }
    expect(await intentar(app, `DELETE FROM "ReclasificacionRenglon" WHERE "id" = $1`, [propia.id])).toMatchObject({ codigo: "42501" });
    expect(await intentar(app, `TRUNCATE "ReclasificacionRenglon"`)).toMatchObject({ codigo: "42501" });
    const relida = await prismaAdmin.reclasificacionRenglon.findUniqueOrThrow({ where: { id: propia.id } });
    expect(relida).toEqual(propia);
  });

  it("DINERO INTACTO: tres reclasificaciones no cambian ni el precio, ni el IVA computable, ni el concepto y el tipo de costo del renglón, ni las imputaciones", async () => {
    await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: e.renglonId, sucursalId: e.sucursalA, importe: "120.00", importeIvaComputable: "20.00" } as never });
    await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: e.renglonId, sucursalId: e.sucursalB, importe: "80.00" } as never });
    const foto = async () => ({
      renglon: await prismaAdmin.$queryRaw`SELECT "id", "precioTotal"::text AS "precioTotal", "importeIvaComputable"::text AS "importeIvaComputable", "tipoDeCosto", "conceptoGastoId", "naturaleza" FROM "FacturaProveedorRenglon" ORDER BY "id"`,
      imputaciones: await prismaAdmin.$queryRaw`SELECT "id", "importe"::text AS "importe", "importeIvaComputable"::text AS "importeIvaComputable", "sucursalId" FROM "ImputacionDeGasto" ORDER BY "id"`,
      sumas: await prismaAdmin.$queryRaw`SELECT sum("importe")::text AS "importe", sum("importeIvaComputable")::text AS "iva" FROM "ImputacionDeGasto"`,
    });
    const antes = await foto();
    const otro = await prisma.conceptoDeGasto.create({ data: datosDeConcepto({ codigo: "LUZ", nombre: "Luz" }) });
    await reclasificar({ numero: 1, tipoDeCosto: "INVERSION" });
    await reclasificar({ numero: 2, conceptoGastoId: otro.id, tipoDeCosto: "COSTO_DE_VENTAS" });
    await reclasificar({ numero: 3, tipoDeCosto: "GASTO_OPERATIVO" });
    expect(await cuantas()).toBe(3);
    expect(await foto()).toEqual(antes);
    expect(antes.sumas).toEqual([{ importe: "200.00", iva: "20.00" }]);
  });
});

describe("la versión vigente", () => {
  const vigentes = () =>
    prismaAdmin.$queryRaw<Array<{ renglon: string; numero: number; concepto: string; tipo: string }>>`
      SELECT DISTINCT ON ("facturaProveedorRenglonId") "facturaProveedorRenglonId" AS renglon, "numero", "conceptoGastoId" AS concepto, "tipoDeCosto" AS tipo
        FROM "ReclasificacionRenglon" ORDER BY "facturaProveedorRenglonId", "numero" DESC`;

  it("con las versiones 1, 2 y 3 (cargadas en cualquier orden) la vigente es la de número mayor", async () => {
    const otro = await prisma.conceptoDeGasto.create({ data: datosDeConcepto({ codigo: "LUZ", nombre: "Luz" }) });
    await reclasificar({ numero: 2, tipoDeCosto: "INVERSION" });
    await reclasificar({ numero: 1, tipoDeCosto: "EXTRAORDINARIO" });
    expect(await vigentes()).toEqual([{ renglon: e.renglonId, numero: 2, concepto: e.conceptoId, tipo: "INVERSION" }]);
    await reclasificar({ numero: 3, conceptoGastoId: otro.id, tipoDeCosto: "RESULTADO_FINANCIERO" });
    expect(await vigentes()).toEqual([{ renglon: e.renglonId, numero: 3, concepto: otro.id, tipo: "RESULTADO_FINANCIERO" }]);
  });

  it("un renglón sin reclasificaciones no tiene filas: su vigente es el renglón mismo (versión 0), que no cambia", async () => {
    expect(await vigentes()).toEqual([]);
    const [renglon] = await prismaAdmin.$queryRaw<Array<{ concepto: string; tipo: string }>>`SELECT "conceptoGastoId" AS concepto, "tipoDeCosto" AS tipo FROM "FacturaProveedorRenglon" WHERE "id" = ${e.renglonId}`;
    expect(renglon).toEqual({ concepto: e.conceptoId, tipo: "GASTO_OPERATIVO" });
    await reclasificar({ numero: 1, tipoDeCosto: "INVERSION" });
    const [despues] = await prismaAdmin.$queryRaw<Array<{ concepto: string; tipo: string }>>`SELECT "conceptoGastoId" AS concepto, "tipoDeCosto" AS tipo FROM "FacturaProveedorRenglon" WHERE "id" = ${e.renglonId}`;
    expect(despues).toEqual(renglon);
  });
});

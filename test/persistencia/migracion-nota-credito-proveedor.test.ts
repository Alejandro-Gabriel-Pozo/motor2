import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALICUOTAS_IVA, CONDICIONES_IVA } from "../../src/core/fiscal/iva";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, conexionDelDuenio, datosDeConcepto, datosDeRenglonSinStock, intentar, TIPOS_DE_COSTO } from "../setup/gasto";
import {
  comoDuenio, datosDeImputacion, datosDeLinea, datosDeLineaDeGasto, datosDeNota, datosDeTributo, sembrarDevolucion, sembrarEscenarioDeNota, sentenciaDeInsercion, type EscenarioDeNota,
} from "../setup/nota-credito";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 4, M6.1 — migración 20261018100000_nota_credito_proveedor: la NOTA DE CRÉDITO DE PROVEEDOR (cabecera, línea, imputación por sucursal y tributo), contra la base real. Sin código de `src/` todavía: las tablas nacen vacías.
 *
 * Qué se mide (A del plan de M6):
 *  1. La estructura exacta: columnas, tipos y nulabilidad (todo dinero `numeric(14,2)`, la cantidad `numeric(14,4)`), defaults, índices (con la definición del parcial), claves foráneas con su definición exacta (las seis de tres columnas con ON UPDATE y
 *     ON DELETE RESTRICT), CHECK validados, RLS sin FORCE y privilegios exactos (tabla y columna: en la cabecera, UPDATE solo de la anulación y la recepción; nada para `motor2_plataforma`).
 *  2. Las reglas: cada CHECK con su caso límite.
 *  3. Lo que ni el dueño puede romper (23503): una línea suelta en una nota con factura, un renglón de otra factura, mercadería sobre un renglón sin stock, una nota de otro proveedor, una devolución en una línea de gasto, borrar lo referenciado, y
 *     corregir el proveedor de una factura con notas (como `motor2_app`).
 *  4. Solo se agrega (UPDATE, DELETE y TRUNCATE dan 42501; anular por columna anda; anular sin motivo da 23514; una nota anulada libera su número).
 *  5. El aislamiento entre empresas (claves foráneas compuestas con `empresaId`).
 * La concurrencia, la idempotencia y la atomicidad las mide `nota-credito-proveedor-concurrencia`; el dinero, `nota-credito-proveedor-dinero`; la RLS, `nota-credito-proveedor-rls`; subir, bajar y subir, `paquete-3-m4-subir-bajar-subir`.
 *
 * Mutaciones demostradas (ver las filas O.286 a O.299 de docs/pureza-integracion.md): clave foránea de la línea a la nota sin `tipoNota`, sin `_renglon_factura_fkey` ni `_renglon_naturaleza_fkey`, clave foránea de la factura sin `proveedorId`, sin el único parcial o
 * sin su `WHERE`, `GRANT UPDATE ("importeTotal")` o `DELETE`, `_devolucion_chk` sin `lineaAdmiteDevolucion`, `importe >= 0`.
 */
afterAll(() => prismaAdmin.$disconnect());

const RAIZ = join(__dirname, "../../prisma/migrations");
const M6_1 = "20261018100000_nota_credito_proveedor";
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);
const TABLAS = ["NotaCreditoProveedor", "NotaCreditoProveedorLinea", "NotaCreditoProveedorImputacion", "NotaCreditoProveedorTributo"] as const;

let e: EscenarioDeNota;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeNota();
});
afterEach(cerrarConexiones);

const nota = (extra: Record<string, unknown> = {}) => prisma.notaCreditoProveedor.create({ data: datosDeNota(e, extra) as never });
const linea = (notaId: string, extra: Record<string, unknown> = {}) => prisma.notaCreditoProveedorLinea.create({ data: datosDeLinea(e, notaId, extra) as never });
const lineaDeGasto = (notaId: string, extra: Record<string, unknown> = {}) => prisma.notaCreditoProveedorLinea.create({ data: datosDeLineaDeGasto(e, notaId, extra) as never });
const imputacion = (lineaId: string, extra: Record<string, unknown> = {}) => prisma.notaCreditoProveedorImputacion.create({ data: datosDeImputacion(e, lineaId, extra) as never });
const cuantas = async (tabla: string, filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);
/** Los valores listados en la definición de un CHECK de lista cerrada, ordenados. */
const valoresDelCheck = (definicion: string) => [...definicion.matchAll(/'([A-Za-z0-9_]+)'::text/g)].map((m) => m[1]!).sort();
const definicionDelCheck = async (nombre: string) => (await prismaAdmin.$queryRaw<Array<{ d: string }>>`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname::text = ${nombre}`)[0]!.d;
/** Una nota sin líneas sobre una factura nueva y vacía (sin renglones ni partes) del mismo proveedor: para probar el borrado de la factura. */
const facturaVacia = async () => prisma.facturaProveedor.create({ data: { proveedorId: e.proveedorId, fecha: new Date("2026-09-01T15:00:00.000Z"), importeTotal: "100.00", estado: "CONFIRMADA", confirmadaEn: new Date("2026-09-01T15:00:00.000Z"), confirmadaPorId: e.usuarioId, creadoPorId: e.usuarioId } });

describe("la migración deja las cuatro tablas, los índices, las claves foráneas, las reglas, la RLS y los privilegios puestos", () => {
  it("tienen las columnas esperadas, con su tipo y su nulabilidad; el dinero es NUMERIC(14,2) y la cantidad NUMERIC(14,4) (nunca float); los defaults son los pensados", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string; tipo: string; es_nulable: string; por_defecto: string | null; precision: number | null; escala: number | null }>>`
      SELECT table_name::text AS tabla, column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, column_default AS por_defecto, numeric_precision::int AS precision, numeric_scale::int AS escala
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY(${[...TABLAS]}::text[]) ORDER BY table_name, ordinal_position`;
    const de = (tabla: string) => columnas.filter((c) => c.tabla === tabla);
    const resumen = (tabla: string) => de(tabla).map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`);
    expect(resumen("NotaCreditoProveedor")).toEqual([
      "id:text:NO", "empresaId:text:NO", "proveedorId:text:NO", "tipo:text:NO", "facturaProveedorId:text:YES", "nroComprobante:text:NO", "nroComprobanteNormalizado:text:NO", "letra:text:YES",
      "fecha:timestamp without time zone:NO", "fechaComprobante:date:YES", "importeTotal:numeric:NO", "condicionIvaEmpresa:text:YES", "importeNeto:numeric:YES", "importeIva:numeric:YES", "motivo:text:NO",
      "estado:text:NO", "origen:text:NO", "recibidaEnAdministracionEn:date:YES", "claveIdempotencia:text:NO", "payloadHash:text:NO", "resultadoMensaje:text:NO", "creadoPorId:text:NO",
      "creadoEn:timestamp without time zone:NO", "anuladaEn:timestamp without time zone:YES", "anuladaPorId:text:YES", "motivoAnulacion:text:YES",
    ]);
    expect(resumen("NotaCreditoProveedorLinea")).toEqual([
      "id:text:NO", "empresaId:text:NO", "notaCreditoProveedorId:text:NO", "tipoNota:text:NO", "facturaProveedorId:text:YES", "orden:integer:NO", "facturaProveedorRenglonId:text:YES", "naturaleza:text:NO",
      "admiteDevolucion:boolean:NO", "origenImporte:text:NO", "descripcion:text:YES", "conceptoGastoId:text:YES", "tipoDeCosto:text:YES", "importe:numeric:NO", "alicuotaIva:text:YES", "importeNeto:numeric:YES",
      "importeIva:numeric:YES", "importeIvaComputable:numeric:NO", "creadoEn:timestamp without time zone:NO",
    ]);
    expect(resumen("NotaCreditoProveedorImputacion")).toEqual([
      "id:text:NO", "empresaId:text:NO", "notaCreditoProveedorLineaId:text:NO", "lineaAdmiteDevolucion:boolean:NO", "sucursalId:text:NO", "importe:numeric:NO", "importeIvaComputable:numeric:NO",
      "cantidadStock:numeric:YES", "operacionDevolucionId:text:YES", "creadoEn:timestamp without time zone:NO",
    ]);
    expect(resumen("NotaCreditoProveedorTributo")).toEqual([
      "id:text:NO", "empresaId:text:NO", "notaCreditoProveedorId:text:NO", "tipo:text:NO", "descripcion:text:YES", "importe:numeric:NO", "creadoEn:timestamp without time zone:NO",
    ]);
    expect(columnas.filter((c) => /double|real|money/.test(c.tipo)), "ninguna columna de punto flotante").toEqual([]);
    for (const c of columnas.filter((x) => x.tipo === "numeric")) {
      const esperado = c.columna === "cantidadStock" ? [14, 4] : [14, 2];
      expect([c.precision, c.escala], `${c.tabla}.${c.columna}`).toEqual(esperado);
    }
    const defecto = (tabla: string, columna: string) => de(tabla).find((c) => c.columna === columna)!.por_defecto;
    expect(defecto("NotaCreditoProveedor", "estado")).toMatch(/'CONFIRMADA'/);
    expect(defecto("NotaCreditoProveedor", "origen")).toMatch(/'CARGA'/);
    expect(defecto("NotaCreditoProveedorLinea", "importeIvaComputable")).toBe("0");
    expect(defecto("NotaCreditoProveedorImputacion", "importeIvaComputable")).toBe("0");
    for (const t of TABLAS) {
      expect(defecto(t, "empresaId"), t).toMatch(/app_empresa_actual\(\)/);
      expect(defecto(t, "creadoEn"), t).toMatch(/CURRENT_TIMESTAMP/);
    }
  });

  it("los índices son los esperados; el del número es ÚNICO y PARCIAL (solo las vigentes) e incluye la letra; los dos destinos nuevos en las tablas de la factura existen", async () => {
    const indices = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; unico: boolean; definicion: string }>>`
      SELECT c.relname::text AS tabla, ic.relname::text AS nombre, i.indisunique AS unico, pg_get_indexdef(i.indexrelid) AS definicion
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid WHERE c.relname = ANY(${[...TABLAS]}::text[]) AND NOT i.indisprimary ORDER BY 1, 2`;
    expect(indices.map((i) => `${i.nombre}|${i.unico}`).sort()).toEqual([
      "NotaCreditoProveedor_claveIdempotencia_key|true", "NotaCreditoProveedor_empresaId_id_facturaProveedorId_key|true", "NotaCreditoProveedor_empresaId_id_key|true", "NotaCreditoProveedor_empresaId_id_tipo_key|true",
      "NotaCreditoProveedor_empresaId_proveedorId_fecha_idx|false", "NotaCreditoProveedor_facturaProveedorId_idx|false", "NotaCreditoProveedor_unica_vigente_key|true",
      "NotaCreditoProveedorImputacion_devolucion_key|true", "NotaCreditoProveedorImputacion_empresaId_id_key|true", "NotaCreditoProveedorImputacion_linea_sucursal_key|true", "NotaCreditoProveedorImputacion_sucursalId_idx|false",
      "NotaCreditoProveedorLinea_conceptoGastoId_idx|false", "NotaCreditoProveedorLinea_empresaId_id_admiteDevolucion_key|true", "NotaCreditoProveedorLinea_empresaId_id_key|true",
      "NotaCreditoProveedorLinea_facturaProveedorRenglonId_idx|false", "NotaCreditoProveedorLinea_notaCreditoProveedorId_orden_key|true",
      "NotaCreditoProveedorTributo_empresaId_id_key|true", "NotaCreditoProveedorTributo_notaCreditoProveedorId_idx|false",
    ].sort());
    const vigente = indices.find((i) => i.nombre === "NotaCreditoProveedor_unica_vigente_key")!.definicion;
    expect(vigente).toMatch(/\("empresaId", "proveedorId", COALESCE\(letra, ''::text\), "nroComprobanteNormalizado"\)/);
    expect(vigente).toMatch(/WHERE \("anuladaEn" IS NULL\)$/);
    const destinos = await prismaAdmin.$queryRaw<Array<{ nombre: string; unico: boolean }>>`
      SELECT ic.relname::text AS nombre, i.indisunique AS unico FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE ic.relname IN ('FacturaProveedor_empresaId_id_proveedorId_key', 'FacturaProveedorRenglon_empresaId_facturaProveedorId_id_key') ORDER BY 1`;
    expect(destinos.map((d) => `${d.nombre}|${d.unico}`).sort()).toEqual(["FacturaProveedor_empresaId_id_proveedorId_key|true", "FacturaProveedorRenglon_empresaId_facturaProveedorId_id_key|true"].sort());
  });

  it("las claves foráneas son RESTRICT; las seis de TRES columnas, con su definición exacta y ON UPDATE RESTRICT; las demás, compuestas con empresaId o simples hacia Empresa y User", async () => {
    const fks = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; definicion: string }>>`
      SELECT c.relname::text AS tabla, k.conname::text AS nombre, pg_get_constraintdef(k.oid) AS definicion
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid WHERE c.relname = ANY(${[...TABLAS]}::text[]) AND k.contype = 'f' ORDER BY 1, 2`;
    expect(fks.map((f) => f.nombre)).toEqual([
      "NotaCreditoProveedor_anuladaPorId_fkey", "NotaCreditoProveedor_creadoPorId_fkey", "NotaCreditoProveedor_empresaId_fkey", "NotaCreditoProveedor_empresaId_proveedorId_fkey", "NotaCreditoProveedor_factura_fkey",
      "NotaCreditoProveedorImputacion_devolucion_fkey", "NotaCreditoProveedorImputacion_empresaId_fkey", "NotaCreditoProveedorImputacion_empresaId_sucursalId_fkey", "NotaCreditoProveedorImputacion_linea_fkey",
      "NotaCreditoProveedorLinea_empresaId_conceptoGastoId_fkey", "NotaCreditoProveedorLinea_empresaId_fkey", "NotaCreditoProveedorLinea_nota_factura_fkey", "NotaCreditoProveedorLinea_nota_tipo_fkey",
      "NotaCreditoProveedorLinea_renglon_factura_fkey", "NotaCreditoProveedorLinea_renglon_naturaleza_fkey", "NotaCreditoProveedorTributo_empresaId_fkey", "NotaCreditoProveedorTributo_nota_fkey",
    ]);
    for (const f of fks) expect(f.definicion, f.nombre).toMatch(/ON DELETE RESTRICT/);
    const de = (nombre: string) => fks.find((f) => f.nombre === nombre)!.definicion;
    expect(de("NotaCreditoProveedor_factura_fkey")).toBe('FOREIGN KEY ("empresaId", "facturaProveedorId", "proveedorId") REFERENCES "FacturaProveedor"("empresaId", id, "proveedorId") ON UPDATE RESTRICT ON DELETE RESTRICT');
    expect(de("NotaCreditoProveedorLinea_nota_tipo_fkey")).toBe('FOREIGN KEY ("empresaId", "notaCreditoProveedorId", "tipoNota") REFERENCES "NotaCreditoProveedor"("empresaId", id, tipo) ON UPDATE RESTRICT ON DELETE RESTRICT');
    expect(de("NotaCreditoProveedorLinea_nota_factura_fkey")).toBe('FOREIGN KEY ("empresaId", "notaCreditoProveedorId", "facturaProveedorId") REFERENCES "NotaCreditoProveedor"("empresaId", id, "facturaProveedorId") ON UPDATE RESTRICT ON DELETE RESTRICT');
    expect(de("NotaCreditoProveedorLinea_renglon_factura_fkey")).toBe('FOREIGN KEY ("empresaId", "facturaProveedorId", "facturaProveedorRenglonId") REFERENCES "FacturaProveedorRenglon"("empresaId", "facturaProveedorId", id) ON UPDATE RESTRICT ON DELETE RESTRICT');
    expect(de("NotaCreditoProveedorLinea_renglon_naturaleza_fkey")).toBe('FOREIGN KEY ("empresaId", "facturaProveedorRenglonId", naturaleza) REFERENCES "FacturaProveedorRenglon"("empresaId", id, naturaleza) ON UPDATE RESTRICT ON DELETE RESTRICT');
    expect(de("NotaCreditoProveedorImputacion_linea_fkey")).toBe('FOREIGN KEY ("empresaId", "notaCreditoProveedorLineaId", "lineaAdmiteDevolucion") REFERENCES "NotaCreditoProveedorLinea"("empresaId", id, "admiteDevolucion") ON UPDATE RESTRICT ON DELETE RESTRICT');
    expect(de("NotaCreditoProveedorImputacion_devolucion_fkey")).toBe('FOREIGN KEY ("empresaId", "operacionDevolucionId") REFERENCES "Operacion"("empresaId", id) ON UPDATE RESTRICT ON DELETE RESTRICT');
    expect(de("NotaCreditoProveedor_empresaId_proveedorId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "proveedorId"\) REFERENCES "Proveedor"\("empresaId", id\)/);
    expect(de("NotaCreditoProveedorImputacion_empresaId_sucursalId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "sucursalId"\) REFERENCES "Sucursal"\("empresaId", id\)/);
    expect(de("NotaCreditoProveedorLinea_empresaId_conceptoGastoId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "conceptoGastoId"\) REFERENCES "ConceptoDeGasto"\("empresaId", id\)/);
    expect(de("NotaCreditoProveedorTributo_nota_fkey")).toMatch(/FOREIGN KEY \("empresaId", "notaCreditoProveedorId"\) REFERENCES "NotaCreditoProveedor"\("empresaId", id\)/);
    expect(de("NotaCreditoProveedor_creadoPorId_fkey")).toMatch(/FOREIGN KEY \("creadoPorId"\) REFERENCES "User"\(id\)/);
    expect(de("NotaCreditoProveedor_anuladaPorId_fkey")).toMatch(/FOREIGN KEY \("anuladaPorId"\) REFERENCES "User"\(id\)/);
  });

  it("los CHECK son los esperados y están todos validados", async () => {
    const checks = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; validada: boolean }>>`
      SELECT c.relname::text AS tabla, k.conname::text AS nombre, k.convalidated AS validada
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid WHERE c.relname = ANY(${[...TABLAS]}::text[]) AND k.contype = 'c' ORDER BY 1, 2`;
    const de = (tabla: string) => checks.filter((c) => c.tabla === tabla).map((c) => c.nombre).sort();
    expect(de("NotaCreditoProveedor")).toEqual([
      "anulacion_pareo", "condicion_iva_empresa", "desglose_dentro_del_total", "desglose_no_negativo", "desglose_pareo", "estado", "importe_total_positivo", "letra", "motivo", "motivo_anulacion", "nro", "origen", "tipo",
    ].map((s) => `NotaCreditoProveedor_${s}_chk`).sort());
    expect(de("NotaCreditoProveedorLinea")).toEqual([
      "admite_devolucion", "alicuota_iva", "alicuota_sin_iva", "desglose_no_negativo", "desglose_pareo", "importe_positivo", "iva_computable", "naturaleza", "neto_mas_iva", "orden", "pareo_suelta", "referencia", "tipo_de_costo", "tipo_nota",
    ].map((s) => `NotaCreditoProveedorLinea_${s}_chk`).sort());
    expect(de("NotaCreditoProveedorImputacion")).toEqual(["cantidad_positiva", "devolucion", "importe_positivo", "iva_computable"].map((s) => `NotaCreditoProveedorImputacion_${s}_chk`).sort());
    expect(de("NotaCreditoProveedorTributo")).toEqual(["importe_positivo", "tipo"].map((s) => `NotaCreditoProveedorTributo_${s}_chk`).sort());
    expect(checks.every((c) => c.validada)).toBe(true);
  });

  it("la RLS por empresa está puesta, sin FORCE; la cabecera, las líneas y los tributos tienen UNA política (`aislamiento_empresa`) y la imputación, esa más las cuatro de sucursal (M6.2)", async () => {
    const rls = await prismaAdmin.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`SELECT relname::text AS relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY(${[...TABLAS]}::text[]) ORDER BY 1`;
    expect(rls).toHaveLength(4);
    expect(rls.every((r) => r.relrowsecurity && !r.relforcerowsecurity)).toBe(true);
    const politicas = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; qual: string | null; with_check: string | null }>>`SELECT tablename::text AS tabla, policyname::text AS nombre, qual, with_check FROM pg_policies WHERE tablename = ANY(${[...TABLAS]}::text[]) ORDER BY 1, 2`;
    const de = (tabla: string) => politicas.filter((p) => p.tabla === tabla).map((p) => p.nombre);
    for (const t of ["NotaCreditoProveedor", "NotaCreditoProveedorLinea", "NotaCreditoProveedorTributo"]) expect(de(t), t).toEqual(["aislamiento_empresa"]);
    expect(de("NotaCreditoProveedorImputacion")).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
    for (const p of politicas.filter((x) => x.nombre === "aislamiento_empresa")) expect([p.qual, p.with_check].every((x) => /app_empresa_actual/.test(x ?? "")), p.tabla).toBe(true);
  });

  it("SOLO se agrega: motor2_app tiene SELECT e INSERT en las cuatro; UPDATE por columna solo de la anulación y la recepción en la CABECERA (nada del dinero); nunca DELETE; motor2_plataforma, nada", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const filas = await prismaAdmin.$queryRaw<Array<{ tabla: string; rol: string; privilegio: string }>>`
      SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = ANY(${[...TABLAS]}::text[]) AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`;
    expect(filas.map((f) => `${f.tabla}|${f.rol}|${f.privilegio}`).sort()).toEqual(TABLAS.flatMap((tabla) => [`${tabla}|motor2_app|INSERT`, `${tabla}|motor2_app|SELECT`]).sort());
    const conUpdate = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string }>>`
      SELECT c.relname::text AS tabla, a.attname::text AS columna FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = ANY(${[...TABLAS]}::text[]) AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1, 2`;
    expect(conUpdate.map((c) => `${c.tabla}.${c.columna}`)).toEqual(["anuladaEn", "anuladaPorId", "motivoAnulacion", "recibidaEnAdministracionEn"].map((c) => `NotaCreditoProveedor.${c}`));
    const plataforma = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string }>>`
      SELECT c.relname::text AS tabla, a.attname::text AS columna FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = ANY(${[...TABLAS]}::text[]) AND a.attnum > 0 AND NOT a.attisdropped AND (has_column_privilege('motor2_plataforma', a.attrelid, a.attnum, 'SELECT') OR has_column_privilege('motor2_plataforma', a.attrelid, a.attnum, 'INSERT'))`;
    if (await hayRol("motor2_plataforma")) expect(plataforma).toEqual([]);
  });

  it("el migration.sql y el down.sql avisan que requieren autorización y que la reversa aborta con filas; ni M6.1, ni M6.3, ni M6.4 se disfrazan de migración de políticas de sucursal (B7)", () => {
    const subida = readFileSync(join(RAIZ, M6_1, "migration.sql"), "utf8");
    expect(subida.split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(subida).toMatch(/SET lock_timeout = '5s'/);
    expect(subida).toMatch(/FOR UPDATE/);
    const reversa = readFileSync(join(RAIZ, M6_1, "down.sql"), "utf8");
    expect(reversa).toMatch(/ABORTA/);
    for (const tabla of TABLAS) expect(reversa).toContain(`DROP TABLE IF EXISTS "${tabla}"`);
    for (const indice of ["FacturaProveedorRenglon_empresaId_facturaProveedorId_id_key", "FacturaProveedor_empresaId_id_proveedorId_key"]) expect(reversa).toContain(`DROP INDEX IF EXISTS "${indice}"`);
    for (const migracion of [M6_1, "20261018102000_anulacion_coherente_admite_devolucion", "20261018103000_permisos_notas_de_credito"]) {
      const sql = readFileSync(join(RAIZ, migracion, "migration.sql"), "utf8");
      expect(sql, migracion).not.toContain("alcance_sucursal_");
      expect(sql, migracion).not.toContain("app_sucursales_");
    }
  });
});

describe("las reglas de la nota (cada CHECK con su caso límite)", () => {
  it("el motivo: 200 caracteres entra; 201, vacío o solo espacios y saltos dan 23514 (…_motivo_chk); y es obligatorio (23502)", async () => {
    expect((await nota({ motivo: "x".repeat(200) })).motivo).toHaveLength(200);
    const duenio = await conexionDelDuenio();
    for (const malo of ["x".repeat(201), "", "  ", "\t\n"]) {
      const s = sentenciaDeInsercion("NotaCreditoProveedor", comoDuenio(datosDeNota(e, { motivo: malo })));
      expect(await intentar(duenio, s.texto, s.params), JSON.stringify(malo)).toEqual({ codigo: "23514", restriccion: "NotaCreditoProveedor_motivo_chk" });
    }
    const sin = sentenciaDeInsercion("NotaCreditoProveedor", comoDuenio(datosDeNota(e, { motivo: null })));
    expect(await intentar(duenio, sin.texto, sin.params)).toMatchObject({ codigo: "23502" });
  });

  it("el importe total tiene que ser MAYOR que cero (…_importe_total_positivo_chk): cero y negativo dan 23514, 0,01 entra, y un importe que no entra en NUMERIC(14,2) se rechaza", async () => {
    const duenio = await conexionDelDuenio();
    for (const malo of ["0.00", "-0.01", "-100"]) {
      const s = sentenciaDeInsercion("NotaCreditoProveedor", comoDuenio(datosDeNota(e, { importeTotal: malo })));
      expect(await intentar(duenio, s.texto, s.params), malo).toEqual({ codigo: "23514", restriccion: "NotaCreditoProveedor_importe_total_positivo_chk" });
    }
    expect((await nota({ importeTotal: "0.01" })).importeTotal.toFixed(2)).toBe("0.01");
    expect((await nota({ importeTotal: "1234567890.10" })).importeTotal.toFixed(2)).toBe("1234567890.10");
    await expect(nota({ importeTotal: "1000000000000.00" })).rejects.toThrow(/out of range|numeric field overflow|too large/i);
  });

  it("el desglose: neto e IVA van juntos, no son negativos y su suma no pasa del total (neto + IVA = total entra); la condición de la empresa es EXACTAMENTE `CONDICIONES_IVA`", async () => {
    await expect(nota({ importeNeto: "80.00" })).rejects.toThrow(/NotaCreditoProveedor_desglose_pareo_chk/);
    await expect(nota({ importeIva: "21.00" })).rejects.toThrow(/NotaCreditoProveedor_desglose_pareo_chk/);
    await expect(nota({ importeNeto: "-1.00", importeIva: "1.00" })).rejects.toThrow(/NotaCreditoProveedor_desglose_no_negativo_chk/);
    await expect(nota({ importeNeto: "80.00", importeIva: "20.01" })).rejects.toThrow(/NotaCreditoProveedor_desglose_dentro_del_total_chk/);
    expect((await nota({ importeNeto: "82.64", importeIva: "17.36" })).importeIva?.toFixed(2)).toBe("17.36");
    expect((await nota({ importeNeto: "70.00", importeIva: "10.00" })).importeNeto?.toFixed(2), "el resto del total son tributos, no gravado y exento").toBe("70.00");
    expect(valoresDelCheck(await definicionDelCheck("NotaCreditoProveedor_condicion_iva_empresa_chk"))).toEqual([...CONDICIONES_IVA].sort());
    for (const condicion of CONDICIONES_IVA) expect((await nota({ condicionIvaEmpresa: condicion })).condicionIvaEmpresa).toBe(condicion);
    await expect(nota({ condicionIvaEmpresa: "OTRA" })).rejects.toThrow(/NotaCreditoProveedor_condicion_iva_empresa_chk/);
  });

  it("el tipo va en pareo con la factura: SOBRE_FACTURA exige la factura, SUELTA no puede tenerla (…_tipo_chk); cualquier otro tipo, la letra, el estado y el origen fuera de lista dan 23514", async () => {
    await expect(nota({ tipo: "SOBRE_FACTURA", facturaProveedorId: null })).rejects.toThrow(/NotaCreditoProveedor_tipo_chk/);
    await expect(nota({ tipo: "SUELTA" })).rejects.toThrow(/NotaCreditoProveedor_tipo_chk/);
    await expect(nota({ tipo: "OTRA", facturaProveedorId: null })).rejects.toThrow(/NotaCreditoProveedor_tipo_chk/);
    expect((await nota({ tipo: "SUELTA", facturaProveedorId: null })).tipo).toBe("SUELTA");
    for (const letra of ["A", "B", "C", "E", "M", "X"]) expect((await nota({ tipo: "SUELTA", facturaProveedorId: null, letra })).letra).toBe(letra);
    await expect(nota({ letra: "Z" })).rejects.toThrow(/NotaCreditoProveedor_letra_chk/);
    await expect(nota({ letra: "a" })).rejects.toThrow(/NotaCreditoProveedor_letra_chk/);
    await expect(nota({ estado: "ANULADA" })).rejects.toThrow(/NotaCreditoProveedor_estado_chk/);
    await expect(nota({ origen: "MIGRACION" })).rejects.toThrow(/NotaCreditoProveedor_origen_chk/);
    const n = await nota();
    expect([n.estado, n.origen]).toEqual(["CONFIRMADA", "CARGA"]);
  });

  it("el número y su clave normalizada no pueden estar vacíos (…_nro_chk)", async () => {
    await expect(nota({ nroComprobante: "  " })).rejects.toThrow(/NotaCreditoProveedor_nro_chk/);
    await expect(nota({ nroComprobanteNormalizado: "" })).rejects.toThrow(/NotaCreditoProveedor_nro_chk/);
  });

  it("la anulación va entera o no va: las tres columnas juntas (…_anulacion_pareo_chk) y el motivo con un carácter visible y hasta 200 (…_motivo_anulacion_chk)", async () => {
    const duenio = await conexionDelDuenio();
    const n = await nota();
    const actualizar = (set: string, params: unknown[] = []) => intentar(duenio, `UPDATE "NotaCreditoProveedor" SET ${set} WHERE "id" = $1`, [n.id, ...params]);
    expect(await actualizar(`"anuladaEn" = now()`)).toEqual({ codigo: "23514", restriccion: "NotaCreditoProveedor_anulacion_pareo_chk" });
    expect(await actualizar(`"anuladaEn" = now(), "anuladaPorId" = $2`, [e.usuarioId])).toEqual({ codigo: "23514", restriccion: "NotaCreditoProveedor_anulacion_pareo_chk" });
    expect(await actualizar(`"motivoAnulacion" = 'solo el motivo'`)).toEqual({ codigo: "23514", restriccion: "NotaCreditoProveedor_anulacion_pareo_chk" });
    expect(await actualizar(`"anuladaEn" = now(), "anuladaPorId" = $2, "motivoAnulacion" = $3`, [e.usuarioId, "  "])).toEqual({ codigo: "23514", restriccion: "NotaCreditoProveedor_motivo_anulacion_chk" });
    expect(await actualizar(`"anuladaEn" = now(), "anuladaPorId" = $2, "motivoAnulacion" = $3`, [e.usuarioId, "x".repeat(201)])).toEqual({ codigo: "23514", restriccion: "NotaCreditoProveedor_motivo_anulacion_chk" });
    expect(await actualizar(`"anuladaEn" = now(), "anuladaPorId" = $2, "motivoAnulacion" = $3`, [e.usuarioId, "x".repeat(200)])).toBeNull();
  });

  it("la línea: el importe es mayor que cero, el orden desde 1, y neto + IVA = importe EXACTO (…_neto_mas_iva_chk); el IVA computable va entre 0 y el IVA; con alícuota sin IVA el IVA es 0; la alícuota es EXACTAMENTE `ALICUOTAS_IVA`", async () => {
    const n = await nota();
    await expect(linea(n.id, { importe: "0.00" })).rejects.toThrow(/NotaCreditoProveedorLinea_importe_positivo_chk/);
    await expect(linea(n.id, { importe: "-1.00" })).rejects.toThrow(/NotaCreditoProveedorLinea_importe_positivo_chk/);
    await expect(linea(n.id, { orden: 0 })).rejects.toThrow(/NotaCreditoProveedorLinea_orden_chk/);
    await expect(linea(n.id, { importeNeto: "40.00", importeIva: "10.01" })).rejects.toThrow(/NotaCreditoProveedorLinea_neto_mas_iva_chk/);
    await expect(linea(n.id, { importeNeto: "50.00" })).rejects.toThrow(/NotaCreditoProveedorLinea_desglose_pareo_chk/);
    await expect(linea(n.id, { importeNeto: "-10.00", importeIva: "60.00" })).rejects.toThrow(/NotaCreditoProveedorLinea_desglose_no_negativo_chk/);
    await expect(linea(n.id, { alicuotaIva: "IVA_21", importeNeto: "41.32", importeIva: "8.68", importeIvaComputable: "8.69" })).rejects.toThrow(/NotaCreditoProveedorLinea_iva_computable_chk/);
    await expect(linea(n.id, { importeIvaComputable: "0.01" })).rejects.toThrow(/NotaCreditoProveedorLinea_iva_computable_chk/);
    await expect(linea(n.id, { importeIvaComputable: "-0.01" })).rejects.toThrow(/NotaCreditoProveedorLinea_iva_computable_chk/);
    await expect(linea(n.id, { alicuotaIva: "EXENTO", importeNeto: "40.00", importeIva: "10.00" })).rejects.toThrow(/NotaCreditoProveedorLinea_alicuota_sin_iva_chk/);
    await expect(linea(n.id, { alicuotaIva: "IVA_99" })).rejects.toThrow(/NotaCreditoProveedorLinea_alicuota_iva_chk/);
    expect(valoresDelCheck(await definicionDelCheck("NotaCreditoProveedorLinea_alicuota_iva_chk"))).toEqual([...ALICUOTAS_IVA].sort());
    const ok = await linea(n.id, { alicuotaIva: "IVA_21", importeNeto: "41.32", importeIva: "8.68", importeIvaComputable: "8.68" });
    expect([ok.importe.toFixed(2), ok.importeIva?.toFixed(2), ok.importeIvaComputable.toFixed(2)]).toEqual(["50.00", "8.68", "8.68"]);
    for (const [i, alicuota] of ALICUOTAS_IVA.entries()) {
      const sinIva = ["IVA_0", "EXENTO", "NO_GRAVADO"].includes(alicuota);
      await prisma.notaCreditoProveedorLinea.create({
        data: datosDeLinea(e, n.id, { orden: 10 + i, alicuotaIva: alicuota, importeNeto: sinIva ? "50.00" : "41.32", importeIva: sinIva ? "0.00" : "8.68" }) as never,
      });
    }
    expect(await cuantas("NotaCreditoProveedorLinea")).toBe(1 + ALICUOTAS_IVA.length);
  });

  it("la línea sobre factura: lleva factura y renglón y su origen es RENGLON o REPARTO_DEL_TOTAL, y no copia ni concepto ni tipo de costo (…_referencia_chk); admiteDevolucion = (sobre factura Y mercadería) (…_admite_devolucion_chk)", async () => {
    const n = await nota();
    await expect(linea(n.id, { origenImporte: "SIN_FACTURA" })).rejects.toThrow(/NotaCreditoProveedorLinea_referencia_chk/);
    await expect(linea(n.id, { origenImporte: "OTRO" })).rejects.toThrow(/NotaCreditoProveedorLinea_referencia_chk/);
    await expect(linea(n.id, { facturaProveedorRenglonId: null, naturaleza: "SIN_STOCK", admiteDevolucion: false })).rejects.toThrow(/NotaCreditoProveedorLinea_referencia_chk/);
    await expect(lineaDeGasto(n.id, { conceptoGastoId: e.conceptoId })).rejects.toThrow(/NotaCreditoProveedorLinea_referencia_chk/);
    await expect(lineaDeGasto(n.id, { tipoDeCosto: "GASTO_OPERATIVO" })).rejects.toThrow(/NotaCreditoProveedorLinea_referencia_chk/);
    await expect(linea(n.id, { admiteDevolucion: false })).rejects.toThrow(/NotaCreditoProveedorLinea_admite_devolucion_chk/);
    await expect(lineaDeGasto(n.id, { admiteDevolucion: true })).rejects.toThrow(/NotaCreditoProveedorLinea_admite_devolucion_chk/);
    await expect(linea(n.id, { naturaleza: "OTRA", admiteDevolucion: false })).rejects.toThrow(/NotaCreditoProveedorLinea_naturaleza_chk/);
    expect((await linea(n.id, { origenImporte: "REPARTO_DEL_TOTAL" })).origenImporte).toBe("REPARTO_DEL_TOTAL");
    expect((await lineaDeGasto(n.id)).admiteDevolucion).toBe(false);
  });

  it("la línea SUELTA declara su naturaleza: sin concepto ni tipo de costo no puede ser un gasto (23514), el tipo de costo es EXACTAMENTE `TIPOS_DE_COSTO`, y una mercadería suelta no lleva concepto", async () => {
    const suelta = await nota({ tipo: "SUELTA", facturaProveedorId: null });
    const datosSuelta = (extra: Record<string, unknown>) => ({ notaCreditoProveedorId: suelta.id, tipoNota: "SUELTA", orden: 1, naturaleza: "SIN_STOCK", admiteDevolucion: false, origenImporte: "SIN_FACTURA", importe: "30.00", ...extra });
    const crear = (extra: Record<string, unknown>) => prisma.notaCreditoProveedorLinea.create({ data: datosSuelta(extra) as never });
    await expect(crear({})).rejects.toThrow(/NotaCreditoProveedorLinea_pareo_suelta_chk/);
    await expect(crear({ conceptoGastoId: e.conceptoId })).rejects.toThrow(/NotaCreditoProveedorLinea_pareo_suelta_chk/);
    await expect(crear({ tipoDeCosto: "GASTO_OPERATIVO" })).rejects.toThrow(/NotaCreditoProveedorLinea_pareo_suelta_chk/);
    await expect(crear({ naturaleza: "MERCADERIA", conceptoGastoId: e.conceptoId, tipoDeCosto: "GASTO_OPERATIVO" })).rejects.toThrow(/NotaCreditoProveedorLinea_pareo_suelta_chk/);
    await expect(crear({ conceptoGastoId: e.conceptoId, tipoDeCosto: "OTRO" })).rejects.toThrow(/NotaCreditoProveedorLinea_tipo_de_costo_chk/);
    await expect(crear({ conceptoGastoId: e.conceptoId, tipoDeCosto: "gasto_operativo" })).rejects.toThrow(/NotaCreditoProveedorLinea_tipo_de_costo_chk/);
    expect(valoresDelCheck(await definicionDelCheck("NotaCreditoProveedorLinea_tipo_de_costo_chk"))).toEqual([...TIPOS_DE_COSTO].sort());
    for (const [i, tipo] of TIPOS_DE_COSTO.entries()) expect((await crear({ orden: i + 1, conceptoGastoId: e.conceptoId, tipoDeCosto: tipo })).tipoDeCosto).toBe(tipo);
    expect((await crear({ orden: 9, naturaleza: "MERCADERIA" })).admiteDevolucion, "una mercadería suelta no admite devolución").toBe(false);
    await expect(crear({ orden: 10, naturaleza: "MERCADERIA", admiteDevolucion: true })).rejects.toThrow(/NotaCreditoProveedorLinea_admite_devolucion_chk/);
  });

  it("la imputación: importe mayor que cero, IVA computable entre 0 y el importe; la CANTIDAD va solo con una devolución y la devolución solo con una línea que la admite (…_devolucion_chk)", async () => {
    const n = await nota();
    const l = await linea(n.id);
    const { operacionId } = await sembrarDevolucion(e, "A");
    await expect(imputacion(l.id, { importe: "0.00" })).rejects.toThrow(/NotaCreditoProveedorImputacion_importe_positivo_chk/);
    await expect(imputacion(l.id, { importe: "-1.00" })).rejects.toThrow(/NotaCreditoProveedorImputacion_importe_positivo_chk/);
    await expect(imputacion(l.id, { importeIvaComputable: "50.01" })).rejects.toThrow(/NotaCreditoProveedorImputacion_iva_computable_chk/);
    await expect(imputacion(l.id, { importeIvaComputable: "-0.01" })).rejects.toThrow(/NotaCreditoProveedorImputacion_iva_computable_chk/);
    await expect(imputacion(l.id, { cantidadStock: "2" })).rejects.toThrow(/NotaCreditoProveedorImputacion_devolucion_chk/);
    await expect(imputacion(l.id, { operacionDevolucionId: operacionId })).rejects.toThrow(/NotaCreditoProveedorImputacion_devolucion_chk/);
    await expect(imputacion(l.id, { operacionDevolucionId: operacionId, cantidadStock: "0" })).rejects.toThrow(/NotaCreditoProveedorImputacion_cantidad_positiva_chk/);
    await expect(imputacion(l.id, { operacionDevolucionId: operacionId, cantidadStock: "-1" })).rejects.toThrow(/NotaCreditoProveedorImputacion_cantidad_positiva_chk/);
    const ok = await imputacion(l.id, { operacionDevolucionId: operacionId, cantidadStock: "2.5000", importeIvaComputable: "50.00" });
    expect([ok.importe.toFixed(2), ok.cantidadStock?.toFixed(4), ok.operacionDevolucionId, ok.lineaAdmiteDevolucion]).toEqual(["50.00", "2.5000", operacionId, true]);
    const sinDevolucion = await imputacion(l.id, { sucursalId: e.sucursalB });
    expect([sinDevolucion.cantidadStock, sinDevolucion.operacionDevolucionId, sinDevolucion.importeIvaComputable.toFixed(2)]).toEqual([null, null, "0.00"]);
  });

  it("el tributo: el tipo es de la lista de seis y el importe mayor que cero", async () => {
    const n = await nota();
    for (const tipo of ["PERCEPCION_IVA", "PERCEPCION_IIBB", "PERCEPCION_GANANCIAS", "IMPUESTO_INTERNO", "IMPUESTO_MUNICIPAL", "OTRO"]) expect((await prisma.notaCreditoProveedorTributo.create({ data: datosDeTributo(n.id, { tipo }) as never })).tipo).toBe(tipo);
    await expect(prisma.notaCreditoProveedorTributo.create({ data: datosDeTributo(n.id, { tipo: "OTRA" }) as never })).rejects.toThrow(/NotaCreditoProveedorTributo_tipo_chk/);
    await expect(prisma.notaCreditoProveedorTributo.create({ data: datosDeTributo(n.id, { importe: "0.00" }) as never })).rejects.toThrow(/NotaCreditoProveedorTributo_importe_positivo_chk/);
    await expect(prisma.notaCreditoProveedorTributo.create({ data: datosDeTributo(n.id, { importe: "-1.00" }) as never })).rejects.toThrow(/NotaCreditoProveedorTributo_importe_positivo_chk/);
  });
});

describe("lo que ni siquiera el dueño puede romper: las claves foráneas de tres columnas (23503)", () => {
  const insertar = async (tabla: Parameters<typeof sentenciaDeInsercion>[0], datos: Record<string, unknown>) => {
    const duenio = await conexionDelDuenio();
    const s = sentenciaDeInsercion(tabla, comoDuenio(datos));
    return intentar(duenio, s.texto, s.params);
  };

  it("una línea SUELTA en una nota con factura, y una línea sobre factura en una nota suelta, dan 23503 sobre la clave foránea del tipo", async () => {
    const conFactura = await nota();
    const suelta = await nota({ tipo: "SUELTA", facturaProveedorId: null });
    const lineaSuelta = { tipoNota: "SUELTA", facturaProveedorId: null, facturaProveedorRenglonId: null, naturaleza: "SIN_STOCK", admiteDevolucion: false, origenImporte: "SIN_FACTURA", conceptoGastoId: e.conceptoId, tipoDeCosto: "GASTO_OPERATIVO", orden: 1, importe: "10.00" };
    expect(await insertar("NotaCreditoProveedorLinea", { ...lineaSuelta, notaCreditoProveedorId: conFactura.id })).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedorLinea_nota_tipo_fkey" });
    expect(await insertar("NotaCreditoProveedorLinea", { ...lineaSuelta, notaCreditoProveedorId: suelta.id })).toBeNull();
    // Una línea sobre factura en una nota suelta incumple a la vez el tipo y la factura de la nota (la nota no tiene factura): Postgres informa la primera que dispara, y el orden entre las dos no es parte del contrato.
    const enSuelta = await insertar("NotaCreditoProveedorLinea", datosDeLinea(e, suelta.id, { orden: 2 }));
    expect(enSuelta).toMatchObject({ codigo: "23503" });
    expect(enSuelta?.restriccion).toMatch(/^NotaCreditoProveedorLinea_nota_(tipo|factura)_fkey$/);
    expect(await insertar("NotaCreditoProveedorLinea", datosDeLinea(e, conFactura.id))).toBeNull();
  });

  it("la factura de la línea es la de su nota (…_nota_factura_fkey) y el renglón es de ESA factura (…_renglon_factura_fkey): un renglón de OTRA factura da 23503, aun del mismo proveedor", async () => {
    const n = await nota();
    const otra = await prisma.facturaProveedor.create({ data: { proveedorId: e.proveedorId, fecha: new Date("2026-09-01T15:00:00.000Z"), importeTotal: "100.00", estado: "CONFIRMADA", confirmadaEn: new Date("2026-09-01T15:00:00.000Z"), confirmadaPorId: e.usuarioId, creadoPorId: e.usuarioId } });
    const renglonDeOtra = await prisma.facturaProveedorRenglon.create({ data: { facturaProveedorId: otra.id, orden: 1, naturaleza: "MERCADERIA", productoId: e.productoId, cantidadStock: "10", precioPorUnidadStock: "10", detalle: "10 kg", precioTotal: "100.00" } });
    // El renglón de otra factura, con la factura de la nota: la pertenencia no cierra.
    expect(await insertar("NotaCreditoProveedorLinea", datosDeLinea(e, n.id, { facturaProveedorRenglonId: renglonDeOtra.id }))).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedorLinea_renglon_factura_fkey" });
    // La factura y el renglón de la otra, en la nota de ésta: la factura de la línea no es la de su nota.
    expect(await insertar("NotaCreditoProveedorLinea", datosDeLinea({ facturaId: otra.id, renglonMercaderiaId: renglonDeOtra.id }, n.id))).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedorLinea_nota_factura_fkey" });
    // Un renglón que no existe incumple la pertenencia y la naturaleza a la vez: da 23503 por cualquiera de las dos.
    const inexistente = await insertar("NotaCreditoProveedorLinea", datosDeLinea(e, n.id, { facturaProveedorRenglonId: "no-existe" }));
    expect(inexistente).toMatchObject({ codigo: "23503" });
    expect(inexistente?.restriccion).toMatch(/^NotaCreditoProveedorLinea_renglon_(factura|naturaleza)_fkey$/);
    expect(await insertar("NotaCreditoProveedorLinea", datosDeLinea(e, n.id))).toBeNull();
  });

  it("una línea MERCADERIA sobre un renglón SIN_STOCK (y al revés) da 23503 sobre la clave foránea de la naturaleza", async () => {
    const n = await nota();
    expect(await insertar("NotaCreditoProveedorLinea", datosDeLinea({ facturaId: e.facturaId, renglonMercaderiaId: e.renglonId }, n.id))).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedorLinea_renglon_naturaleza_fkey" });
    expect(await insertar("NotaCreditoProveedorLinea", datosDeLineaDeGasto({ facturaId: e.facturaId, renglonId: e.renglonMercaderiaId }, n.id))).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedorLinea_renglon_naturaleza_fkey" });
    expect(await insertar("NotaCreditoProveedorLinea", datosDeLineaDeGasto(e, n.id))).toBeNull();
  });

  it("una nota de OTRO proveedor sobre la factura da 23503 (…_factura_fkey): la nota es del mismo proveedor que su factura", async () => {
    const otro = await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Otro proveedor" } });
    expect(await insertar("NotaCreditoProveedor", datosDeNota(e, { proveedorId: otro.id }))).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedor_factura_fkey" });
    expect(await insertar("NotaCreditoProveedor", datosDeNota(e, { proveedorId: otro.id, tipo: "SUELTA", facturaProveedorId: null }))).toBeNull();
    expect(await insertar("NotaCreditoProveedor", datosDeNota(e))).toBeNull();
  });

  it("una imputación con devolución de una línea de GASTO da 23503 por la clave foránea (si se falsea `lineaAdmiteDevolucion`, 23514 por el CHECK de la devolución)", async () => {
    const n = await nota();
    const gasto = await lineaDeGasto(n.id);
    const { operacionId } = await sembrarDevolucion(e, "A");
    expect(await insertar("NotaCreditoProveedorImputacion", datosDeImputacion(e, gasto.id, { operacionDevolucionId: operacionId, cantidadStock: "2" }))).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedorImputacion_linea_fkey" });
    expect(await insertar("NotaCreditoProveedorImputacion", datosDeImputacion(e, gasto.id, { lineaAdmiteDevolucion: false, operacionDevolucionId: operacionId, cantidadStock: "2" }))).toEqual({ codigo: "23514", restriccion: "NotaCreditoProveedorImputacion_devolucion_chk" });
    expect(await insertar("NotaCreditoProveedorImputacion", datosDeImputacion(e, gasto.id, { lineaAdmiteDevolucion: false }))).toBeNull();
    // La copia del discriminador tiene que coincidir con la línea: una línea de gasto no se imputa como si admitiera devolución, ni una de mercadería como si no.
    const mercaderia = await linea(n.id);
    expect(await insertar("NotaCreditoProveedorImputacion", datosDeImputacion(e, mercaderia.id, { lineaAdmiteDevolucion: false }))).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedorImputacion_linea_fkey" });
  });

  it("no se puede borrar lo referenciado: la factura con notas, el renglón con líneas, la nota con líneas o tributos, la línea con imputaciones y la Operacion de una devolución acreditada (23503, ni como dueño)", async () => {
    const duenio = await conexionDelDuenio();
    const borrar = (tabla: string, id: string) => intentar(duenio, `DELETE FROM "${tabla}" WHERE "id" = $1`, [id]);
    // La factura: una vacía (sin renglones ni partes) con una nota, para que la única que la frene sea la nota.
    const vacia = await facturaVacia();
    await nota({ facturaProveedorId: vacia.id });
    expect(await borrar("FacturaProveedor", vacia.id)).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedor_factura_fkey" });
    // El renglón: uno sin stock nuevo, sin imputaciones, con una línea de nota.
    const n = await nota();
    const sinStock = await prisma.facturaProveedorRenglon.create({ data: datosDeRenglonSinStock({ facturaProveedorId: e.facturaId, conceptoGastoId: e.conceptoId }, { orden: 7 }) as never });
    await lineaDeGasto(n.id, { facturaProveedorRenglonId: sinStock.id });
    expect((await borrar("FacturaProveedorRenglon", sinStock.id))?.restriccion).toMatch(/^NotaCreditoProveedorLinea_renglon_(factura|naturaleza)_fkey$/);
    // La nota con una línea y la línea con una imputación; la nota con un tributo.
    const l = await linea(n.id);
    await imputacion(l.id);
    expect(await borrar("NotaCreditoProveedorLinea", l.id)).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedorImputacion_linea_fkey" });
    expect((await borrar("NotaCreditoProveedor", n.id))?.restriccion).toMatch(/^NotaCreditoProveedorLinea_nota_(tipo|factura)_fkey$/);
    const aparte = await nota();
    await prisma.notaCreditoProveedorTributo.create({ data: datosDeTributo(aparte.id) as never });
    expect(await borrar("NotaCreditoProveedor", aparte.id)).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedorTributo_nota_fkey" });
    // La Operacion de la devolución (sin líneas de Kardex, para que la única que la frene sea la imputación).
    const devolucion = await prisma.operacion.create({ data: { sucursalId: e.sucursalB, fecha: new Date(), usuarioId: e.usuarioId, proceso: "DEVOLUCION_PROVEEDOR", proveedorId: e.proveedorId } });
    await imputacion(l.id, { sucursalId: e.sucursalB, operacionDevolucionId: devolucion.id, cantidadStock: "1" });
    expect(await borrar("Operacion", devolucion.id)).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedorImputacion_devolucion_fkey" });
  });

  it("como motor2_app, corregir el proveedor de una factura que tiene notas da 23503 (K1b: la decide la base); sin notas, sí se puede", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const otro = await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Otro proveedor" } });
    const app = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] });
    const sinNotas = await facturaVacia();
    expect(await intentar(app, `UPDATE "FacturaProveedor" SET "proveedorId" = $2 WHERE "id" = $1`, [sinNotas.id, otro.id]), "sin notas se puede corregir").toBeNull();
    await nota();
    expect(await intentar(app, `UPDATE "FacturaProveedor" SET "proveedorId" = $2 WHERE "id" = $1`, [e.facturaId, otro.id])).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedor_factura_fkey" });
    expect((await prismaAdmin.facturaProveedor.findUniqueOrThrow({ where: { id: e.facturaId } })).proveedorId).toBe(e.proveedorId);
  });
});

describe("solo se agrega: la app no modifica el dinero ni borra, y anular es un UPDATE por columna", () => {
  const alcance = () => ({ lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] });

  it("UPDATE de cualquier columna de dinero o de identidad, DELETE y TRUNCATE dan 42501 en las cuatro tablas", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const n = await nota();
    const l = await linea(n.id);
    const i = await imputacion(l.id);
    const t = await prisma.notaCreditoProveedorTributo.create({ data: datosDeTributo(n.id) as never });
    const app = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcance());
    const casos: Array<[string, string, string[]]> = [
      ["NotaCreditoProveedor", n.id, [`"importeTotal" = 1`, `"importeNeto" = 1, "importeIva" = 0`, `"proveedorId" = '${e.proveedorId}'`, `"motivo" = 'otro'`, `"claveIdempotencia" = 'otra'`, `"nroComprobante" = 'otro'`, `"tipo" = 'SUELTA'`, `"facturaProveedorId" = NULL`, `"empresaId" = 'empresa_testigo'`]],
      ["NotaCreditoProveedorLinea", l.id, [`"importe" = 1`, `"importeIvaComputable" = 0`, `"naturaleza" = 'SIN_STOCK'`, `"facturaProveedorRenglonId" = NULL`, `"orden" = 5`]],
      ["NotaCreditoProveedorImputacion", i.id, [`"importe" = 1`, `"importeIvaComputable" = 0`, `"cantidadStock" = 1`, `"operacionDevolucionId" = NULL`, `"sucursalId" = '${e.sucursalB}'`]],
      ["NotaCreditoProveedorTributo", t.id, [`"importe" = 1`, `"tipo" = 'OTRO'`]],
    ];
    for (const [tabla, id, sets] of casos) {
      for (const set of sets) expect(await intentar(app, `UPDATE "${tabla}" SET ${set} WHERE "id" = $1`, [id]), `${tabla}: ${set}`).toMatchObject({ codigo: "42501" });
      expect(await intentar(app, `DELETE FROM "${tabla}" WHERE "id" = $1`, [id]), `${tabla}: DELETE`).toMatchObject({ codigo: "42501" });
      expect(await intentar(app, `TRUNCATE "${tabla}"`), `${tabla}: TRUNCATE`).toMatchObject({ codigo: "42501" });
    }
    expect((await prismaAdmin.notaCreditoProveedor.findUniqueOrThrow({ where: { id: n.id } })).importeTotal.toFixed(2)).toBe("100.00");
    expect((await prismaAdmin.notaCreditoProveedorImputacion.findUniqueOrThrow({ where: { id: i.id } })).importe.toFixed(2)).toBe("50.00");
  });

  it("anular por columna ANDA (las tres a la vez, con la guarda `anuladaEn IS NULL`) y la recepción en administración también; anular sin motivo da 23514", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const n = await nota();
    const app = await conexionComoApp(EMPRESA_DE_PRUEBA_ID, alcance());
    const anular = `UPDATE "NotaCreditoProveedor" SET "anuladaEn" = now(), "anuladaPorId" = $2, "motivoAnulacion" = $3 WHERE "id" = $1 AND "anuladaEn" IS NULL`;
    expect(await intentar(app, anular, [n.id, e.usuarioId, null])).toEqual({ codigo: "23514", restriccion: "NotaCreditoProveedor_anulacion_pareo_chk" });
    expect(await intentar(app, anular, [n.id, e.usuarioId, "  "])).toEqual({ codigo: "23514", restriccion: "NotaCreditoProveedor_motivo_anulacion_chk" });
    expect(await intentar(app, anular, [n.id, e.usuarioId, "Cargada dos veces"])).toBeNull();
    const [anulada] = await prismaAdmin.$queryRaw<Array<{ anuladaEn: Date | null; anuladaPorId: string | null; motivoAnulacion: string | null }>>`SELECT "anuladaEn", "anuladaPorId", "motivoAnulacion" FROM "NotaCreditoProveedor" WHERE id = ${n.id}`;
    expect([anulada!.anuladaEn instanceof Date, anulada!.anuladaPorId, anulada!.motivoAnulacion]).toEqual([true, e.usuarioId, "Cargada dos veces"]);
    // Anular dos veces no hace nada (la guarda deja 0 filas).
    expect((await app.query(anular, [n.id, e.usuarioId, "Otra vez"])).rowCount).toBe(0);
    const otra = await nota();
    expect((await app.query(`UPDATE "NotaCreditoProveedor" SET "recibidaEnAdministracionEn" = '2026-09-12' WHERE "id" = $1`, [otra.id])).rowCount).toBe(1);
  });

  it("una nota anulada LIBERA su número (el único parcial solo cuenta las vigentes); dos vigentes con el mismo número dan 23505; otro proveedor, otra letra o la misma letra vacía (NULL = '') se comportan como se espera", async () => {
    const duenio = await conexionDelDuenio();
    const insertar = (extra: Record<string, unknown>) => {
      const s = sentenciaDeInsercion("NotaCreditoProveedor", comoDuenio(datosDeNota(e, { tipo: "SUELTA", facturaProveedorId: null, nroComprobante: "0001-00000077", nroComprobanteNormalizado: "0001-00000077", ...extra })));
      return intentar(duenio, s.texto, s.params);
    };
    const primera = await nota({ tipo: "SUELTA", facturaProveedorId: null, nroComprobante: "0001-00000077", nroComprobanteNormalizado: "0001-00000077" });
    expect(await insertar({})).toEqual({ codigo: "23505", restriccion: "NotaCreditoProveedor_unica_vigente_key" });
    expect(await insertar({ letra: "A" }), "otra letra").toBeNull();
    expect(await insertar({ letra: "A" }), "la misma letra A").toEqual({ codigo: "23505", restriccion: "NotaCreditoProveedor_unica_vigente_key" });
    const otro = await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Otro proveedor" } });
    expect(await insertar({ proveedorId: otro.id }), "otro proveedor").toBeNull();
    await prismaAdmin.$executeRaw`UPDATE "NotaCreditoProveedor" SET "anuladaEn" = now(), "anuladaPorId" = ${e.usuarioId}, "motivoAnulacion" = 'Mal cargada' WHERE id = ${primera.id}`;
    expect(await insertar({}), "la anulada libera el número").toBeNull();
    expect(await insertar({}), "pero la nueva vigente lo ocupa").toEqual({ codigo: "23505", restriccion: "NotaCreditoProveedor_unica_vigente_key" });
    expect(await cuantas("NotaCreditoProveedor", `"nroComprobanteNormalizado" = '0001-00000077'`)).toBe(4);
  });
});

describe("aislamiento entre empresas (claves foráneas compuestas con empresaId)", () => {
  it("un proveedor, una factura o un renglón de OTRA empresa dan 23503, aun escribiendo como dueño con el empresaId explícito; la otra empresa sí puede con lo suyo", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const conceptoAjeno = await ajeno.testigo.conceptoDeGasto.create({ data: datosDeConcepto() });
    const renglonAjeno = await ajeno.testigo.facturaProveedorRenglon.create({ data: datosDeRenglonSinStock({ facturaProveedorId: ajeno.factura.id, conceptoGastoId: conceptoAjeno.id }, { orden: 2 }) as never });
    const duenio = await conexionDelDuenio();
    const insertar = (empresaId: string, tabla: Parameters<typeof sentenciaDeInsercion>[0], datos: Record<string, unknown>) => {
      const s = sentenciaDeInsercion(tabla, { empresaId, ...datos });
      return intentar(duenio, s.texto, s.params);
    };
    // Cabecera: proveedor ajeno, factura ajena.
    expect(await insertar(EMPRESA_DE_PRUEBA_ID, "NotaCreditoProveedor", datosDeNota(e, { proveedorId: ajeno.proveedor.id, tipo: "SUELTA", facturaProveedorId: null }))).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedor_empresaId_proveedorId_fkey" });
    expect(await insertar(EMPRESA_DE_PRUEBA_ID, "NotaCreditoProveedor", datosDeNota({ ...e, facturaId: ajeno.factura.id }, { proveedorId: ajeno.proveedor.id }))).toMatchObject({ codigo: "23503" });
    expect(await insertar(EMPRESA_DE_PRUEBA_ID, "NotaCreditoProveedor", datosDeNota({ ...e, facturaId: ajeno.factura.id }))).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedor_factura_fkey" });
    // Lo suyo, en la otra empresa: entra (y queda para la línea).
    const deB = datosDeNota({ ...e, facturaId: ajeno.factura.id }, { proveedorId: ajeno.proveedor.id });
    const idB = randomUUID();
    expect(await insertar(EMPRESA_TESTIGO_ID, "NotaCreditoProveedor", { ...deB, id: idB })).toBeNull();
    // Línea de la empresa B con un renglón de A, y línea de A sobre la nota de B.
    const lineaDeB = { notaCreditoProveedorId: idB, tipoNota: "SOBRE_FACTURA", facturaProveedorId: ajeno.factura.id, orden: 1, origenImporte: "RENGLON", naturaleza: "SIN_STOCK", admiteDevolucion: false, importe: "10.00" };
    const renglonDeA = await insertar(EMPRESA_TESTIGO_ID, "NotaCreditoProveedorLinea", { ...lineaDeB, facturaProveedorRenglonId: e.renglonId });
    expect(renglonDeA).toMatchObject({ codigo: "23503" });
    expect(renglonDeA?.restriccion).toMatch(/^NotaCreditoProveedorLinea_renglon_(factura|naturaleza)_fkey$/);
    expect(await insertar(EMPRESA_DE_PRUEBA_ID, "NotaCreditoProveedorLinea", { ...lineaDeB, facturaProveedorRenglonId: renglonAjeno.id })).toMatchObject({ codigo: "23503" });
    expect(await insertar(EMPRESA_TESTIGO_ID, "NotaCreditoProveedorLinea", { ...lineaDeB, facturaProveedorRenglonId: renglonAjeno.id })).toBeNull();
    // Imputación: una sucursal de la otra empresa.
    const l = await linea((await nota()).id);
    expect(await insertar(EMPRESA_DE_PRUEBA_ID, "NotaCreditoProveedorImputacion", datosDeImputacion({ sucursalA: ajeno.sucursal.id }, l.id))).toEqual({ codigo: "23503", restriccion: "NotaCreditoProveedorImputacion_empresaId_sucursalId_fkey" });
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { datosDeFactura, datosDePendiente, datosDeRenglon, sembrarAjeno, sembrarEscenarioDeFactura, type EscenarioDeFactura } from "../setup/factura-proveedor";

/**
 * Paquete 3, M3b: la factura de proveedor como documento de la empresa (migración 20261016101000_factura_proveedor). Tres mitades: (1) la migración deja las tres tablas, la columna del Kardex, sus índices, claves
 * foráneas, reglas, RLS y privilegios puestos; (2) cada regla rechaza, con el nombre de su restricción, una fila que la rompe; (3) lo que protege el dinero y la historia: las tablas SOLO se agregan (la app no puede
 * borrar nada ni modificar el dinero), el total se guarda exacto y una empresa no ve ni toca las facturas de otra. La unicidad del número y la concurrencia están en `factura-proveedor-concurrencia.test.ts`; el reparto
 * exacto del dinero en `factura-proveedor-dinero.test.ts`; las políticas de SUCURSAL de las partes (M3c) en `test/aislamiento/factura-proveedor-rls.test.ts`.
 *
 * Mutación: sacar un CHECK, un índice único, el REVOKE de DELETE o de UPDATE del dinero, o la política de empresa de la migración deja en rojo solo sus casos.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261016101000_factura_proveedor");
const TABLAS = ["FacturaProveedor", "FacturaProveedorRenglon", "FacturaProveedorSucursal"] as const;

const CHECKS_DE_CABECERA = [
  "FacturaProveedor_nro_pareo_chk", "FacturaProveedor_letra_chk", "FacturaProveedor_importe_total_no_negativo_chk", "FacturaProveedor_estado_chk", "FacturaProveedor_confirmacion_coherente_chk",
  "FacturaProveedor_origen_chk", "FacturaProveedor_pendiente_solo_carga_chk", "FacturaProveedor_condicion_pago_chk", "FacturaProveedor_medio_pago_chk", "FacturaProveedor_pago_declarado_solo_contado_chk",
  "FacturaProveedor_idempotencia_pareo_chk", "FacturaProveedor_anulacion_pareo_chk",
];
const CHECKS_DE_RENGLON = [
  "FacturaProveedorRenglon_orden_chk", "FacturaProveedorRenglon_naturaleza_chk", "FacturaProveedorRenglon_pareo_mercaderia_chk", "FacturaProveedorRenglon_cantidad_positiva_chk",
  "FacturaProveedorRenglon_precio_unidad_no_negativo_chk", "FacturaProveedorRenglon_precio_total_no_negativo_chk",
];
const CHECKS = [...CHECKS_DE_CABECERA, ...CHECKS_DE_RENGLON, "FacturaProveedorSucursal_porcentaje_chk", "MovimientoStock_renglon_solo_compra_chk"];

/** Lo único que `motor2_app` puede modificar de una cabecera: el estado y la anulación, y los datos que identifican la factura (D4). El dinero no está. */
const COLUMNAS_ACTUALIZABLES = [
  "anuladaEn", "anuladaPorId", "confirmadaEn", "confirmadaPorId", "detalleLibre", "estado", "fechaComprobante", "fechaPagoDeclarada", "letra", "medioPagoDeclarado", "nroFactura", "nroFacturaNormalizado",
  "proveedorId", "recibidaEnAdministracionEn", "resultadoMensaje",
];

let e: EscenarioDeFactura;

beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeFactura();
});

const cabecera = (extra: Record<string, unknown> = {}) => prisma.facturaProveedor.create({ data: datosDeFactura(e, extra) as never });
const pendiente = (extra: Record<string, unknown> = {}) => prisma.facturaProveedor.create({ data: datosDePendiente(e, extra) as never });
const renglon = (facturaProveedorId: string, extra: Record<string, unknown> = {}) => prisma.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId, productoId: e.productoId }, extra) as never });
const parte = (facturaProveedorId: string, sucursalId: string, extra: Record<string, unknown> = {}) =>
  prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId, sucursalId, porcentajeDeclaradoBp: 10000, ...extra } as never });
const operacionDeCompra = (sucursalId: string) => prisma.operacion.create({ data: { sucursalId, fecha: new Date(), usuarioId: e.usuarioId, proceso: "COMPRA" } });

const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

describe("la migración deja las tres tablas, la columna del Kardex, los índices, las claves foráneas, las reglas, la RLS y los privilegios puestos", () => {
  it("la cabecera tiene las columnas esperadas con sus tipos y su nulabilidad, y el dinero es NUMERIC(14,2) (nunca float)", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ columna: string; tipo: string; es_nulable: string; precision: number | null; escala: number | null }>>`
      SELECT column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, numeric_precision::int AS precision, numeric_scale::int AS escala
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'FacturaProveedor' ORDER BY ordinal_position`;
    expect(columnas.map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`)).toEqual([
      "id:text:NO", "empresaId:text:NO", "proveedorId:text:NO", "nroFactura:text:YES", "nroFacturaNormalizado:text:YES", "letra:text:YES", "fecha:timestamp without time zone:NO", "fechaComprobante:date:YES",
      "importeTotal:numeric:NO", "estado:text:NO", "confirmadaEn:timestamp without time zone:YES", "confirmadaPorId:text:YES", "origen:text:NO", "condicionPago:text:NO", "recibidaEnAdministracionEn:date:YES",
      "fechaPagoDeclarada:date:YES", "medioPagoDeclarado:text:YES", "detalleLibre:text:YES", "claveIdempotencia:text:YES", "payloadHash:text:YES", "resultadoMensaje:text:YES", "creadoPorId:text:NO",
      "creadoEn:timestamp without time zone:NO", "anuladaEn:timestamp without time zone:YES", "anuladaPorId:text:YES",
    ]);
    const total = columnas.find((c) => c.columna === "importeTotal")!;
    expect([total.precision, total.escala]).toEqual([14, 2]);
  });

  it("el renglón y la parte tienen las columnas esperadas, y las cantidades (14,4) y los importes (14,2) son exactos", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string; tipo: string; es_nulable: string; precision: number | null; escala: number | null }>>`
      SELECT table_name::text AS tabla, column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, numeric_precision::int AS precision, numeric_scale::int AS escala
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('FacturaProveedorRenglon', 'FacturaProveedorSucursal') ORDER BY table_name, ordinal_position`;
    const de = (tabla: string) => columnas.filter((c) => c.tabla === tabla);
    expect(de("FacturaProveedorRenglon").map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`)).toEqual([
      "id:text:NO", "empresaId:text:NO", "facturaProveedorId:text:NO", "orden:integer:NO", "naturaleza:text:NO", "descripcion:text:YES", "productoId:text:YES", "cantidadStock:numeric:YES",
      "precioPorUnidadStock:numeric:YES", "loteVencimiento:date:YES", "detalle:text:YES", "precioTotal:numeric:NO", "creadoEn:timestamp without time zone:NO",
    ]);
    const exactitud = Object.fromEntries(de("FacturaProveedorRenglon").filter((c) => c.precision !== null).map((c) => [c.columna, [c.precision, c.escala]]));
    expect(exactitud).toEqual({ orden: [32, 0], cantidadStock: [14, 4], precioPorUnidadStock: [14, 4], precioTotal: [14, 2] });
    expect(de("FacturaProveedorSucursal").map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`)).toEqual([
      "id:text:NO", "empresaId:text:NO", "facturaProveedorId:text:NO", "sucursalId:text:NO", "porcentajeDeclaradoBp:integer:NO", "operacionId:text:YES", "creadoEn:timestamp without time zone:NO",
    ]);
  });

  it("MovimientoStock gana facturaProveedorRenglonId (TEXT NULL, indexada) y nada más", async () => {
    const r = await prismaAdmin.$queryRaw<Array<{ tipo: string; es_nulable: string; indice: string | null }>>`
      SELECT c.data_type AS tipo, c.is_nullable AS es_nulable, (SELECT indexname::text FROM pg_indexes WHERE tablename = 'MovimientoStock' AND indexname = 'MovimientoStock_facturaProveedorRenglonId_idx') AS indice
      FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'MovimientoStock' AND c.column_name = 'facturaProveedorRenglonId'`;
    expect(r).toEqual([{ tipo: "text", es_nulable: "YES", indice: "MovimientoStock_facturaProveedorRenglonId_idx" }]);
  });

  it("los CHECK están todos puestos y validados", async () => {
    const checks = await prismaAdmin.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`SELECT conname::text AS conname, convalidated FROM pg_constraint WHERE contype = 'c' AND conname::text = ANY(${CHECKS}::text[])`;
    expect(checks.map((c) => c.conname).sort()).toEqual([...CHECKS].sort());
    expect(checks.every((c) => c.convalidated)).toBe(true);
  });

  it("los índices únicos son los esperados, y el de la unicidad del número es PARCIAL (no anuladas, con número) e incluye la letra (D5)", async () => {
    const unicos = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; definicion: string }>>`
      SELECT c.relname::text AS tabla, ic.relname::text AS nombre, pg_get_indexdef(i.indexrelid) AS definicion
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE c.relname = ANY(${[...TABLAS]}::text[]) AND i.indisunique AND NOT i.indisprimary ORDER BY 1, 2`;
    expect(unicos.map((u) => u.nombre).sort()).toEqual([
      "FacturaProveedor_claveIdempotencia_key", "FacturaProveedor_empresaId_id_key", "FacturaProveedor_unica_vigente_key",
      "FacturaProveedorRenglon_empresaId_id_key", "FacturaProveedorRenglon_facturaProveedorId_orden_key",
      "FacturaProveedorSucursal_empresaId_id_key", "FacturaProveedorSucursal_empresaId_operacionId_key", "FacturaProveedorSucursal_facturaProveedorId_sucursalId_key",
    ].sort());
    const vigente = unicos.find((u) => u.nombre === "FacturaProveedor_unica_vigente_key")!.definicion;
    expect(vigente).toMatch(/\("empresaId", "proveedorId", COALESCE\(letra, ''::text\), "nroFacturaNormalizado"\)/);
    expect(vigente).toMatch(/WHERE \(\("nroFacturaNormalizado" IS NOT NULL\) AND \("anuladaEn" IS NULL\)\)/);
  });

  it("las claves foráneas son RESTRICT y compuestas (empresaId, x) hacia las tablas de empresa", async () => {
    const fks = await prismaAdmin.$queryRaw<Array<{ conname: string; definicion: string }>>`
      SELECT conname::text AS conname, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
      WHERE contype = 'f' AND ((SELECT relname::text FROM pg_class WHERE oid = conrelid) = ANY(${[...TABLAS]}::text[]) OR conname::text = 'MovimientoStock_empresaId_facturaProveedorRenglonId_fkey') ORDER BY 1`;
    expect(fks.map((f) => f.conname).sort()).toEqual([
      "FacturaProveedor_anuladaPorId_fkey", "FacturaProveedor_confirmadaPorId_fkey", "FacturaProveedor_creadoPorId_fkey", "FacturaProveedor_empresaId_fkey", "FacturaProveedor_empresaId_proveedorId_fkey",
      "FacturaProveedorRenglon_empresaId_facturaProveedorId_fkey", "FacturaProveedorRenglon_empresaId_fkey", "FacturaProveedorRenglon_empresaId_productoId_fkey",
      "FacturaProveedorSucursal_empresaId_facturaProveedorId_fkey", "FacturaProveedorSucursal_empresaId_fkey", "FacturaProveedorSucursal_empresaId_operacionId_fkey", "FacturaProveedorSucursal_empresaId_sucursalId_fkey",
      "MovimientoStock_empresaId_facturaProveedorRenglonId_fkey",
    ].sort());
    for (const f of fks) expect(f.definicion, f.conname).toMatch(/ON DELETE RESTRICT/);
    for (const f of fks.filter((x) => /_empresaId_\w+Id_fkey$/.test(x.conname))) expect(f.definicion, f.conname).toMatch(/FOREIGN KEY \("empresaId", "\w+"\) REFERENCES "\w+"\("empresaId", id\)/);
  });

  it("la RLS por empresa está puesta en las tres (una política aislamiento_empresa con USING y WITH CHECK) y sin FORCE", async () => {
    for (const tabla of TABLAS) {
      const rls = await prismaAdmin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '"${tabla}"'::regclass`);
      expect(rls, tabla).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
      const politicas = await prismaAdmin.$queryRaw<Array<{ qual: string | null; with_check: string | null }>>`SELECT qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = ${tabla} AND policyname = 'aislamiento_empresa'`;
      expect(politicas, tabla).toHaveLength(1);
      expect(politicas[0]!.qual, tabla).toMatch(/app_empresa_actual/);
      expect(politicas[0]!.with_check, tabla).toMatch(/app_empresa_actual/);
    }
  });

  it("SOLO se agrega: motor2_app tiene SELECT e INSERT en las tres y nada más a nivel tabla; motor2_plataforma no tiene nada", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const filas = await prismaAdmin.$queryRaw<Array<{ tabla: string; rol: string; privilegio: string }>>`
      SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = ANY(${[...TABLAS]}::text[]) AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`;
    expect(filas.map((f) => `${f.tabla}|${f.rol}|${f.privilegio}`).sort()).toEqual(TABLAS.flatMap((tabla) => [`${tabla}|motor2_app|INSERT`, `${tabla}|motor2_app|SELECT`]).sort());
  });

  it("el UPDATE de la cabecera es POR COLUMNA y solo de la lista cerrada: el dinero, la fecha, el origen, la condición de pago y la clave de idempotencia NO se pueden modificar", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const columnas = await prismaAdmin.$queryRaw<Array<{ columna: string; puede: boolean }>>`
      SELECT a.attname::text AS columna, has_column_privilege('motor2_app', '"FacturaProveedor"'::regclass, a.attnum, 'UPDATE') AS puede
      FROM pg_attribute a WHERE a.attrelid = '"FacturaProveedor"'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`;
    expect(columnas.filter((c) => c.puede).map((c) => c.columna).sort()).toEqual([...COLUMNAS_ACTUALIZABLES].sort());
    for (const dinero of ["importeTotal", "fecha", "origen", "condicionPago", "claveIdempotencia", "payloadHash", "empresaId", "creadoPorId", "creadoEn"]) {
      expect(columnas.find((c) => c.columna === dinero)?.puede, dinero).toBe(false);
    }
    for (const tabla of ["FacturaProveedorRenglon", "FacturaProveedorSucursal"]) {
      const r = await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM pg_attribute a WHERE a.attrelid = '"${tabla}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE')`);
      expect(Number(r[0]!.n), `${tabla}: ninguna columna con UPDATE`).toBe(0);
    }
  });

  it("el migration.sql y el down.sql avisan que requieren autorización, que la reversa puede perder datos y en qué orden se baja", () => {
    expect(readFileSync(join(CARPETA, "migration.sql"), "utf8").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    const reversa = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(reversa).toMatch(/DESTRUCTIVA/);
    expect(reversa).toMatch(/ANTES M3d/);
    for (const nombre of ["MovimientoStock_renglon_solo_compra_chk", "MovimientoStock_empresaId_facturaProveedorRenglonId_fkey", "MovimientoStock_facturaProveedorRenglonId_idx", "facturaProveedorRenglonId", '"FacturaProveedorSucursal"', '"FacturaProveedorRenglon"', '"FacturaProveedor"']) {
      expect(reversa, `el down.sql saca ${nombre}`).toContain(nombre);
    }
  });
});

describe("FacturaProveedor: reglas de la cabecera", () => {
  it("una cabecera mínima se guarda con los valores por defecto (CONFIRMADA, CARGA, CONTADO_PAGADA) y el total exacto en centavos", async () => {
    const f = await cabecera({ importeTotal: "1234567890.10" });
    expect([f.estado, f.origen, f.condicionPago, f.letra, f.nroFactura, f.anuladaEn]).toEqual(["CONFIRMADA", "CARGA", "CONTADO_PAGADA", null, null, null]);
    expect((await prismaAdmin.facturaProveedor.findUniqueOrThrow({ where: { id: f.id } })).importeTotal.toFixed(2)).toBe("1234567890.10");
  });

  it("el número y su clave normalizada van juntos y con texto (FacturaProveedor_nro_pareo_chk)", async () => {
    await expect(cabecera({ nroFactura: "0001-00000001" })).rejects.toThrow(/FacturaProveedor_nro_pareo_chk/);
    await expect(cabecera({ nroFacturaNormalizado: "0001-00000001" })).rejects.toThrow(/FacturaProveedor_nro_pareo_chk/);
    await expect(cabecera({ nroFactura: "  ", nroFacturaNormalizado: "0001-00000001" })).rejects.toThrow(/FacturaProveedor_nro_pareo_chk/);
    await expect(cabecera({ nroFactura: "0001-00000001", nroFacturaNormalizado: "" })).rejects.toThrow(/FacturaProveedor_nro_pareo_chk/);
    expect((await cabecera({ nroFactura: "0001-00000001", nroFacturaNormalizado: "0001-00000001" })).nroFactura).toBe("0001-00000001");
  });

  it("la letra es una de A, B, C, E, M o X, o ninguna (FacturaProveedor_letra_chk)", async () => {
    for (const letra of ["A", "B", "C", "E", "M", "X"]) expect((await cabecera({ letra })).letra).toBe(letra);
    for (const letra of ["Z", "a", "AA", ""]) await expect(cabecera({ letra }), letra).rejects.toThrow(/FacturaProveedor_letra_chk/);
  });

  it("el total no puede ser negativo, y cero sí (FacturaProveedor_importe_total_no_negativo_chk)", async () => {
    await expect(cabecera({ importeTotal: "-0.01" })).rejects.toThrow(/FacturaProveedor_importe_total_no_negativo_chk/);
    expect((await cabecera({ importeTotal: "0.00" })).importeTotal.toFixed(2)).toBe("0.00");
  });

  it("el estado es PENDIENTE_DE_REPARTO o CONFIRMADA (FacturaProveedor_estado_chk)", async () => {
    await expect(cabecera({ estado: "BORRADOR", confirmadaEn: null, confirmadaPorId: null })).rejects.toThrow(/FacturaProveedor_estado_chk/);
  });

  it("hay confirmación si y solo si el estado es CONFIRMADA (FacturaProveedor_confirmacion_coherente_chk)", async () => {
    await expect(cabecera({ confirmadaEn: null, confirmadaPorId: null })).rejects.toThrow(/FacturaProveedor_confirmacion_coherente_chk/);
    await expect(cabecera({ confirmadaEn: null })).rejects.toThrow(/FacturaProveedor_confirmacion_coherente_chk/);
    await expect(cabecera({ confirmadaPorId: null })).rejects.toThrow(/FacturaProveedor_confirmacion_coherente_chk/);
    await expect(pendiente({ confirmadaEn: new Date() })).rejects.toThrow(/FacturaProveedor_confirmacion_coherente_chk/);
    await expect(pendiente({ confirmadaPorId: e.usuarioId })).rejects.toThrow(/FacturaProveedor_confirmacion_coherente_chk/);
    expect((await pendiente()).estado).toBe("PENDIENTE_DE_REPARTO");
  });

  it("lo migrado nace confirmado: una pendiente solo puede ser de CARGA (FacturaProveedor_pendiente_solo_carga_chk), y el origen es CARGA o MIGRACION (FacturaProveedor_origen_chk)", async () => {
    await expect(pendiente({ origen: "MIGRACION" })).rejects.toThrow(/FacturaProveedor_pendiente_solo_carga_chk/);
    expect((await cabecera({ origen: "MIGRACION" })).origen).toBe("MIGRACION");
    await expect(cabecera({ origen: "IMPORTADA" })).rejects.toThrow(/FacturaProveedor_origen_chk/);
  });

  it("la condición de pago es CONTADO_PAGADA (FacturaProveedor_condicion_pago_chk) y el medio de pago declarado, uno de la lista (FacturaProveedor_medio_pago_chk)", async () => {
    await expect(cabecera({ condicionPago: "CUENTA_CORRIENTE" })).rejects.toThrow(/FacturaProveedor_condicion_pago_chk/);
    for (const medio of ["TRANSFERENCIA", "EFECTIVO", "CHEQUE", "TARJETA", "OTRO"]) expect((await cabecera({ medioPagoDeclarado: medio, fechaPagoDeclarada: new Date("2026-10-13") })).medioPagoDeclarado).toBe(medio);
    await expect(cabecera({ medioPagoDeclarado: "BITCOIN" })).rejects.toThrow(/FacturaProveedor_medio_pago_chk/);
  });

  it("los datos de pago declarados solo valen con contado pagada (FacturaProveedor_pago_declarado_solo_contado_chk)", async () => {
    // Hoy CONTADO_PAGADA es la única condición posible, así que la regla se prueba sobre su definición: M4 o los pagos la van a necesitar cuando exista otra condición.
    const def = await prismaAdmin.$queryRaw<Array<{ d: string }>>`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'FacturaProveedor_pago_declarado_solo_contado_chk'`;
    expect(def[0]!.d).toMatch(/"fechaPagoDeclarada" IS NULL/);
    expect(def[0]!.d).toMatch(/"medioPagoDeclarado" IS NULL/);
    expect(def[0]!.d).toMatch(/"condicionPago" = 'CONTADO_PAGADA'/);
  });

  it("la clave de idempotencia y la huella van juntas (FacturaProveedor_idempotencia_pareo_chk), y la clave es única global", async () => {
    await expect(cabecera({ claveIdempotencia: "clave-1" })).rejects.toThrow(/FacturaProveedor_idempotencia_pareo_chk/);
    await expect(cabecera({ payloadHash: "hash" })).rejects.toThrow(/FacturaProveedor_idempotencia_pareo_chk/);
    await cabecera({ claveIdempotencia: "clave-1", payloadHash: "hash" });
    await expect(cabecera({ claveIdempotencia: "clave-1", payloadHash: "hash" })).rejects.toMatchObject({ code: "P2002" });
    // Las sin clave no chocan entre sí.
    await cabecera();
    await cabecera();
  });

  it("la anulación (cuándo y quién) va junta (FacturaProveedor_anulacion_pareo_chk)", async () => {
    await expect(cabecera({ anuladaEn: new Date() })).rejects.toThrow(/FacturaProveedor_anulacion_pareo_chk/);
    await expect(cabecera({ anuladaPorId: e.usuarioId })).rejects.toThrow(/FacturaProveedor_anulacion_pareo_chk/);
    expect((await cabecera({ anuladaEn: new Date(), anuladaPorId: e.usuarioId })).anuladaPorId).toBe(e.usuarioId);
  });

  it("el proveedor, el creador, el confirmador y el anulador tienen que existir (claves foráneas)", async () => {
    await expect(cabecera({ proveedorId: "no-existe" })).rejects.toThrow(/FacturaProveedor_empresaId_proveedorId_fkey/);
    await expect(cabecera({ creadoPorId: "no-existe" })).rejects.toThrow(/FacturaProveedor_creadoPorId_fkey/);
    await expect(cabecera({ confirmadaPorId: "no-existe" })).rejects.toThrow(/FacturaProveedor_confirmadaPorId_fkey/);
    await expect(cabecera({ anuladaEn: new Date(), anuladaPorId: "no-existe" })).rejects.toThrow(/FacturaProveedor_anuladaPorId_fkey/);
  });

  it("un proveedor con facturas no se puede borrar (RESTRICT): la historia no se pierde", async () => {
    await cabecera();
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "Proveedor" WHERE id = '${e.proveedorId}'`)).rejects.toThrow(/FacturaProveedor_empresaId_proveedorId_fkey/);
  });
});

describe("FacturaProveedorRenglon: reglas del renglón", () => {
  it("un renglón de mercadería se guarda con cantidad y precio por unidad exactos (4 decimales) y el importe en centavos", async () => {
    const f = await cabecera({ importeTotal: "33.33" });
    const r = await renglon(f.id, { cantidadStock: "3.3333", precioPorUnidadStock: "9.9999", precioTotal: "33.33" });
    const releido = await prismaAdmin.facturaProveedorRenglon.findUniqueOrThrow({ where: { id: r.id } });
    expect([releido.cantidadStock?.toFixed(4), releido.precioPorUnidadStock?.toFixed(4), releido.precioTotal.toFixed(2)]).toEqual(["3.3333", "9.9999", "33.33"]);
  });

  it("el orden es de 1 en adelante y único por factura (FacturaProveedorRenglon_orden_chk y el índice único)", async () => {
    const f = await cabecera();
    await expect(renglon(f.id, { orden: 0 })).rejects.toThrow(/FacturaProveedorRenglon_orden_chk/);
    await renglon(f.id, { orden: 1 });
    await expect(renglon(f.id, { orden: 1 })).rejects.toMatchObject({ code: "P2002" });
    await renglon(f.id, { orden: 2 });
    const otra = await cabecera();
    await renglon(otra.id, { orden: 1 });
  });

  it("la naturaleza es MERCADERIA por ahora (FacturaProveedorRenglon_naturaleza_chk)", async () => {
    const f = await cabecera();
    await expect(renglon(f.id, { naturaleza: "SIN_STOCK" })).rejects.toThrow(/FacturaProveedorRenglon_naturaleza_chk/);
  });

  it("los campos de mercadería van en pareo: una mercadería sin producto, cantidad, precio por unidad o texto de conversión se rechaza (FacturaProveedorRenglon_pareo_mercaderia_chk)", async () => {
    const f = await cabecera();
    for (const roto of [{ productoId: null }, { cantidadStock: null }, { precioPorUnidadStock: null }, { detalle: null }]) {
      await expect(renglon(f.id, roto), JSON.stringify(roto)).rejects.toThrow(/FacturaProveedorRenglon_pareo_mercaderia_chk/);
    }
  });

  it("la cantidad es mayor que cero y los precios no son negativos (cero sí, en el importe y en el precio por unidad)", async () => {
    const f = await cabecera();
    await expect(renglon(f.id, { cantidadStock: "0" })).rejects.toThrow(/FacturaProveedorRenglon_cantidad_positiva_chk/);
    await expect(renglon(f.id, { cantidadStock: "-1" })).rejects.toThrow(/FacturaProveedorRenglon_cantidad_positiva_chk/);
    await expect(renglon(f.id, { precioPorUnidadStock: "-0.0001" })).rejects.toThrow(/FacturaProveedorRenglon_precio_unidad_no_negativo_chk/);
    await expect(renglon(f.id, { precioTotal: "-0.01" })).rejects.toThrow(/FacturaProveedorRenglon_precio_total_no_negativo_chk/);
    expect((await renglon(f.id, { precioPorUnidadStock: "0", precioTotal: "0.00" })).precioTotal.toFixed(2)).toBe("0.00");
  });

  it("el producto y la cabecera tienen que existir (claves foráneas), y una cabecera con renglones no se puede borrar (RESTRICT)", async () => {
    const f = await cabecera();
    await expect(renglon(f.id, { productoId: "no-existe" })).rejects.toThrow(/FacturaProveedorRenglon_empresaId_productoId_fkey/);
    await expect(renglon("no-existe")).rejects.toThrow(/FacturaProveedorRenglon_empresaId_facturaProveedorId_fkey/);
    await renglon(f.id);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "FacturaProveedor" WHERE id = '${f.id}'`)).rejects.toThrow(/FacturaProveedorRenglon_empresaId_facturaProveedorId_fkey/);
  });
});

describe("FacturaProveedorSucursal: la parte de cada sucursal", () => {
  it("una parte lleva el porcentaje declarado en puntos básicos, de 1 a 10000 (FacturaProveedorSucursal_porcentaje_chk)", async () => {
    const f = await cabecera();
    await expect(parte(f.id, e.sucursalA, { porcentajeDeclaradoBp: 0 })).rejects.toThrow(/FacturaProveedorSucursal_porcentaje_chk/);
    await expect(parte(f.id, e.sucursalA, { porcentajeDeclaradoBp: 10001 })).rejects.toThrow(/FacturaProveedorSucursal_porcentaje_chk/);
    expect((await parte(f.id, e.sucursalA, { porcentajeDeclaradoBp: 1 })).porcentajeDeclaradoBp).toBe(1);
    expect((await parte(f.id, e.sucursalB, { porcentajeDeclaradoBp: 9999 })).porcentajeDeclaradoBp).toBe(9999);
  });

  it("una sola parte por (factura, sucursal), y la misma sucursal puede tener parte en otra factura", async () => {
    const f = await cabecera();
    await parte(f.id, e.sucursalA);
    await expect(parte(f.id, e.sucursalA)).rejects.toMatchObject({ code: "P2002" });
    await parte((await cabecera()).id, e.sucursalA);
  });

  it("una Operacion es la parte de a lo sumo UNA factura, y varias partes pueden quedar sin operación (los gastos de M4)", async () => {
    const f1 = await cabecera();
    const f2 = await cabecera();
    const op = await operacionDeCompra(e.sucursalA);
    const p = await parte(f1.id, e.sucursalA, { operacionId: op.id });
    expect(p.operacionId).toBe(op.id);
    await expect(parte(f2.id, e.sucursalA, { operacionId: op.id })).rejects.toMatchObject({ code: "P2002" });
    await parte(f2.id, e.sucursalA);
    await parte(f2.id, e.sucursalB);
    const conParte = await prisma.operacion.findUniqueOrThrow({ where: { id: op.id }, include: { facturaProveedorParte: true } });
    expect(conParte.facturaProveedorParte?.id).toBe(p.id);
  });

  it("la factura, la sucursal y la operación tienen que existir (claves foráneas), y ninguna de las tres se puede borrar con partes colgadas (RESTRICT)", async () => {
    const f = await cabecera();
    await expect(parte("no-existe", e.sucursalA)).rejects.toThrow(/FacturaProveedorSucursal_empresaId_facturaProveedorId_fkey/);
    await expect(parte(f.id, "no-existe")).rejects.toThrow(/FacturaProveedorSucursal_empresaId_sucursalId_fkey/);
    await expect(parte(f.id, e.sucursalA, { operacionId: "no-existe" })).rejects.toThrow(/FacturaProveedorSucursal_empresaId_operacionId_fkey/);
    const op = await operacionDeCompra(e.sucursalA);
    await parte(f.id, e.sucursalA, { operacionId: op.id });
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "Operacion" WHERE id = '${op.id}'`)).rejects.toThrow(/FacturaProveedorSucursal_empresaId_operacionId_fkey/);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "Sucursal" WHERE id = '${e.sucursalA}'`)).rejects.toThrow(/FacturaProveedorSucursal_empresaId_sucursalId_fkey|_fkey/);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "FacturaProveedor" WHERE id = '${f.id}'`)).rejects.toThrow(/_fkey/);
  });
});

describe("MovimientoStock.facturaProveedorRenglonId: de qué renglón salió una línea de compra", () => {
  async function movimiento(proceso: "COMPRA" | "AJUSTE", renglonId: string | null, operacionId?: string) {
    const op = operacionId ?? (await operacionDeCompra(e.sucursalA)).id;
    return prisma.movimientoStock.create({ data: { operacionId: op, productoId: e.productoId, seccionId: e.seccionA, proceso, cantidad: 1, detalle: "d", precioTotal: "10.00", precioPorUnidadStock: "10", facturaProveedorRenglonId: renglonId } });
  }

  it("una línea de COMPRA cuelga de su renglón, y las anteriores (o los AJUSTE de una anulación) quedan con NULL", async () => {
    const r = await renglon((await cabecera()).id);
    const m = await movimiento("COMPRA", r.id);
    const vieja = await movimiento("COMPRA", null);
    const ajuste = await movimiento("AJUSTE", null);
    expect([m.facturaProveedorRenglonId, vieja.facturaProveedorRenglonId, ajuste.facturaProveedorRenglonId]).toEqual([r.id, null, null]);
    const conLineas = await prisma.facturaProveedorRenglon.findUniqueOrThrow({ where: { id: r.id }, include: { movimientos: true } });
    expect(conLineas.movimientos.map((x) => x.id)).toEqual([m.id]);
  });

  it("solo una COMPRA sale de un renglón: cualquier otro proceso se rechaza (MovimientoStock_renglon_solo_compra_chk)", async () => {
    const r = await renglon((await cabecera()).id);
    await expect(movimiento("AJUSTE", r.id)).rejects.toThrow(/MovimientoStock_renglon_solo_compra_chk/);
  });

  it("apuntar a un renglón que no existe se rechaza, y un renglón con líneas del Kardex no se puede borrar (RESTRICT)", async () => {
    await expect(movimiento("COMPRA", "no-existe")).rejects.toThrow(/MovimientoStock_empresaId_facturaProveedorRenglonId_fkey/);
    const r = await renglon((await cabecera()).id);
    await movimiento("COMPRA", r.id);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "FacturaProveedorRenglon" WHERE id = '${r.id}'`)).rejects.toThrow(/MovimientoStock_empresaId_facturaProveedorRenglonId_fkey/);
  });
});

describe("aislamiento entre empresas", () => {
  it("una cabecera de la empresa A no puede ser de un proveedor de la B, ni un renglón llevar un producto o colgar de una cabecera de la B, ni una parte de una sucursal o factura de la B (la clave foránea es (empresaId, id))", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    await expect(cabecera({ proveedorId: ajeno.proveedor.id })).rejects.toThrow(/FacturaProveedor_empresaId_proveedorId_fkey/);
    const propia = await cabecera();
    await expect(renglon(propia.id, { productoId: ajeno.producto.id })).rejects.toThrow(/FacturaProveedorRenglon_empresaId_productoId_fkey/);
    await expect(renglon(ajeno.factura.id, { orden: 2 })).rejects.toThrow(/FacturaProveedorRenglon_empresaId_facturaProveedorId_fkey/);
    await expect(parte(propia.id, ajeno.sucursal.id)).rejects.toThrow(/FacturaProveedorSucursal_empresaId_sucursalId_fkey/);
    await expect(parte(ajeno.factura.id, e.sucursalA)).rejects.toThrow(/FacturaProveedorSucursal_empresaId_facturaProveedorId_fkey/);
    const opAjena = await ajeno.testigo.operacion.create({ data: { sucursalId: ajeno.sucursal.id, fecha: new Date(), usuarioId: e.usuarioId, proceso: "COMPRA" } });
    await expect(parte(propia.id, e.sucursalA, { operacionId: opAjena.id })).rejects.toThrow(/FacturaProveedorSucursal_empresaId_operacionId_fkey/);
    await expect(prisma.movimientoStock.create({ data: { operacionId: (await operacionDeCompra(e.sucursalA)).id, productoId: e.productoId, seccionId: e.seccionA, proceso: "COMPRA", cantidad: 1, detalle: "d", facturaProveedorRenglonId: ajeno.renglon.id } })).rejects.toThrow(/MovimientoStock_empresaId_facturaProveedorRenglonId_fkey/);
  });

  it("la RLS: la empresa A no ve la cabecera, el renglón ni la parte de la B, y no puede escribir una con la empresa de la B", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const propia = await cabecera();
    const r = await renglon(propia.id);
    expect((await prisma.facturaProveedor.findMany()).map((f) => f.id)).toEqual([propia.id]);
    expect((await prisma.facturaProveedorRenglon.findMany()).map((x) => x.id)).toEqual([r.id]);
    expect(await prisma.facturaProveedor.findUnique({ where: { id: ajeno.factura.id } })).toBeNull();
    expect(await prisma.facturaProveedorRenglon.findUnique({ where: { id: ajeno.renglon.id } })).toBeNull();
    // El WITH CHECK rechaza una fila de otra empresa aunque la clave foránea sea válida para ella.
    await expect(prisma.facturaProveedor.create({ data: { ...datosDeFactura(e), empresaId: ajeno.factura.empresaId, proveedorId: ajeno.proveedor.id } as never })).rejects.toThrow(/row-level security|violates/i);
    expect(await prismaAdmin.facturaProveedor.count()).toBe(2);
  });
});

describe("solo se agrega (la app real no puede borrar, ni modificar el dinero)", () => {
  it("por el rol de la app se puede INSERTAR y LEER una cabecera, un renglón y una parte, pero no DELETE (permission denied)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const db = baseDeTest.db;
    const f = await db.facturaProveedor.create({ data: datosDeFactura(e, { importeTotal: "12.34" }) as never });
    const r = await db.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: f.id, productoId: e.productoId }) as never });
    const p = await db.facturaProveedorSucursal.create({ data: { facturaProveedorId: f.id, sucursalId: e.sucursalA, porcentajeDeclaradoBp: 10000 } });
    expect((await db.facturaProveedor.findUniqueOrThrow({ where: { id: f.id } })).importeTotal.toFixed(2)).toBe("12.34");
    await expect(db.facturaProveedor.delete({ where: { id: f.id } })).rejects.toThrow(/permission denied/i);
    await expect(db.facturaProveedorRenglon.delete({ where: { id: r.id } })).rejects.toThrow(/permission denied/i);
    await expect(db.facturaProveedorSucursal.delete({ where: { id: p.id } })).rejects.toThrow(/permission denied/i);
    await expect(db.facturaProveedor.deleteMany()).rejects.toThrow(/permission denied/i);
  });

  it("el dinero y la historia no se modifican: UPDATE del total, de la fecha, del origen, del renglón y de la parte da permission denied, y el valor no cambió", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const db = baseDeTest.db;
    const f = await db.facturaProveedor.create({ data: datosDeFactura(e, { importeTotal: "100.00" }) as never });
    const r = await db.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: f.id, productoId: e.productoId }) as never });
    const p = await db.facturaProveedorSucursal.create({ data: { facturaProveedorId: f.id, sucursalId: e.sucursalA, porcentajeDeclaradoBp: 10000 } });
    await expect(db.facturaProveedor.update({ where: { id: f.id }, data: { importeTotal: "0.01" } })).rejects.toThrow(/permission denied/i);
    await expect(db.facturaProveedor.update({ where: { id: f.id }, data: { fecha: new Date() } })).rejects.toThrow(/permission denied/i);
    await expect(db.facturaProveedor.update({ where: { id: f.id }, data: { origen: "MIGRACION" } })).rejects.toThrow(/permission denied/i);
    await expect(db.facturaProveedor.update({ where: { id: f.id }, data: { condicionPago: "CONTADO_PAGADA" } })).rejects.toThrow(/permission denied/i);
    await expect(db.facturaProveedor.updateMany({ data: { importeTotal: "0.01" } })).rejects.toThrow(/permission denied/i);
    await expect(db.facturaProveedorRenglon.update({ where: { id: r.id }, data: { precioTotal: "0.01" } })).rejects.toThrow(/permission denied/i);
    await expect(db.facturaProveedorSucursal.update({ where: { id: p.id }, data: { porcentajeDeclaradoBp: 5000 } })).rejects.toThrow(/permission denied/i);
    const hoy = await prismaAdmin.facturaProveedor.findUniqueOrThrow({ where: { id: f.id } });
    expect(hoy.importeTotal.toFixed(2)).toBe("100.00");
    expect((await prismaAdmin.facturaProveedorRenglon.findUniqueOrThrow({ where: { id: r.id } })).precioTotal.toFixed(2)).toBe("100.00");
  });

  it("lo que SÍ se puede: anular, confirmar una pendiente y corregir los datos que identifican la factura (la lista cerrada de D4)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const db = baseDeTest.db;
    const pend = await db.facturaProveedor.create({ data: datosDePendiente(e) as never });
    const confirmada = await db.facturaProveedor.update({ where: { id: pend.id }, data: { estado: "CONFIRMADA", confirmadaEn: new Date(), confirmadaPorId: e.usuarioId, resultadoMensaje: "Repartida" } });
    expect([confirmada.estado, confirmada.resultadoMensaje]).toEqual(["CONFIRMADA", "Repartida"]);
    const corregida = await db.facturaProveedor.update({
      where: { id: pend.id },
      data: { nroFactura: "0002-00000010", nroFacturaNormalizado: "0002-00000010", letra: "A", detalleLibre: "corregido", fechaComprobante: new Date("2026-10-01"), recibidaEnAdministracionEn: new Date("2026-10-02"), medioPagoDeclarado: "EFECTIVO", fechaPagoDeclarada: new Date("2026-10-03") },
    });
    expect([corregida.nroFactura, corregida.letra, corregida.detalleLibre, corregida.medioPagoDeclarado]).toEqual(["0002-00000010", "A", "corregido", "EFECTIVO"]);
    const anulada = await db.facturaProveedor.update({ where: { id: pend.id }, data: { anuladaEn: new Date(), anuladaPorId: e.usuarioId } });
    expect(anulada.anuladaPorId).toBe(e.usuarioId);
    // El importe quedó como se cargó.
    expect((await prismaAdmin.facturaProveedor.findUniqueOrThrow({ where: { id: pend.id } })).importeTotal.toFixed(2)).toBe("100.00");
  });

  it("las reglas siguen rigiendo en un UPDATE: confirmar sin confirmador, o anular sin quién, se rechaza", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const db = baseDeTest.db;
    const pend = await db.facturaProveedor.create({ data: datosDePendiente(e) as never });
    await expect(db.facturaProveedor.update({ where: { id: pend.id }, data: { estado: "CONFIRMADA" } })).rejects.toThrow(/FacturaProveedor_confirmacion_coherente_chk/);
    await expect(db.facturaProveedor.update({ where: { id: pend.id }, data: { anuladaEn: new Date() } })).rejects.toThrow(/FacturaProveedor_anulacion_pareo_chk/);
  });
});

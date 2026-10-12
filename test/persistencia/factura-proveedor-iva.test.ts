import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ALICUOTAS_IVA, CONDICIONES_IVA } from "../../src/core/fiscal/iva";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { datosDeFactura, datosDeRenglon, sembrarAjeno, sembrarEscenarioDeFactura, type EscenarioDeFactura } from "../setup/factura-proveedor";

/**
 * Paquete 3, M3d: el IVA y los tributos de la factura de proveedor y la PERILLA de IVA de la empresa (migración 20261016103000_factura_proveedor_iva).
 *
 * Qué fija: (a) la perilla `Empresa.llevaIvaDeCompras` es BOOLEAN NOT NULL y nace APAGADA; (b) con la perilla apagada una factura se carga SIN neto, IVA ni alícuota, todo con IVA incluido: la base NO exige el
 * desglose (no puede leer la empresa desde un CHECK), así que las columnas son NULLABLES y no hay ningún CHECK de obligatoriedad; (c) lo que SÍ hay en la base son los CHECK de coherencia cuando hay valores: neto + IVA = total
 * del renglón EXACTO en centavos, alícuota y condición de las listas cerradas de `src/core/fiscal/iva.ts` (la misma lista que el CHECK, comparada acá), importes no negativos, IVA computable entre 0 y el IVA, y tributos mayores
 * que cero; (d) los tributos cuelgan de la cabecera, son DE EMPRESA y solo se agregan; (e) las columnas nuevas del dinero no se pueden modificar.
 *
 * La exigencia SEGÚN LA PERILLA Y LA LETRA (qué se pide con la perilla prendida) la hace la Etapa C en el servidor: acá se comprueba que la base NO la impone, para que nadie la dé por hecha.
 *
 * Mutación: sacar un CHECK de la migración, ampliar la lista de alícuotas en TS sin ampliar el CHECK, poner NOT NULL a una columna de desglose o darle UPDATE a una columna nueva deja en rojo solo sus casos.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261016103000_factura_proveedor_iva");
const CHECKS = [
  "FacturaProveedor_condicion_iva_empresa_chk", "FacturaProveedor_desglose_pareo_chk", "FacturaProveedor_desglose_no_negativo_chk", "FacturaProveedor_desglose_dentro_del_total_chk",
  "FacturaProveedorRenglon_alicuota_iva_chk", "FacturaProveedorRenglon_desglose_pareo_chk", "FacturaProveedorRenglon_desglose_no_negativo_chk", "FacturaProveedorRenglon_neto_mas_iva_chk",
  "FacturaProveedorRenglon_alicuota_sin_iva_chk", "FacturaProveedorRenglon_iva_computable_chk", "FacturaProveedorTributo_tipo_chk", "FacturaProveedorTributo_importe_positivo_chk",
];
const TIPOS_DE_TRIBUTO = ["PERCEPCION_IVA", "PERCEPCION_IIBB", "PERCEPCION_GANANCIAS", "IMPUESTO_INTERNO", "IMPUESTO_MUNICIPAL", "OTRO"];

let e: EscenarioDeFactura;

beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeFactura();
});

const cabecera = (extra: Record<string, unknown> = {}) => prisma.facturaProveedor.create({ data: datosDeFactura(e, extra) as never });
const renglon = (facturaProveedorId: string, extra: Record<string, unknown> = {}) => prisma.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId, productoId: e.productoId }, extra) as never });
const tributo = (facturaProveedorId: string, extra: Record<string, unknown> = {}) => prisma.facturaProveedorTributo.create({ data: { facturaProveedorId, tipo: "PERCEPCION_IIBB", importe: "5.00", ...extra } as never });

const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);
/** Los códigos entre comillas de un CHECK `IN (...)`, tal como los guarda Postgres. */
async function codigosDelCheck(nombre: string): Promise<string[]> {
  const r = await prismaAdmin.$queryRaw<Array<{ d: string }>>`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = ${nombre}`;
  return [...r[0]!.d.matchAll(/'([A-Z0-9_]+)'::text/g)].map((m) => m[1]!);
}

describe("la perilla de IVA de la empresa", () => {
  it("Empresa.llevaIvaDeCompras es BOOLEAN NOT NULL con default false: toda empresa nace con la perilla APAGADA", async () => {
    const col = await prismaAdmin.$queryRaw<Array<{ tipo: string; es_nulable: string; defecto: string | null }>>`
      SELECT data_type AS tipo, is_nullable AS es_nulable, column_default AS defecto FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Empresa' AND column_name = 'llevaIvaDeCompras'`;
    expect(col).toEqual([{ tipo: "boolean", es_nulable: "NO", defecto: "false" }]);
    const empresas = await prismaAdmin.empresa.findMany({ select: { id: true, llevaIvaDeCompras: true } });
    expect(empresas.length).toBeGreaterThan(0);
    expect(empresas.every((x) => x.llevaIvaDeCompras === false)).toBe(true);
  });

  it("la perilla no cambia lo que la base acepta: con la perilla apagada y con la prendida, la misma factura sin desglose se guarda (la exigencia es del servidor, Etapa C)", async () => {
    const principal = await prismaAdmin.empresa.findFirstOrThrow({ where: { id: "empresa_principal" } });
    expect(principal.llevaIvaDeCompras).toBe(false);
    const sinDesglose = await cabecera();
    await renglon(sinDesglose.id);
    await prismaAdmin.$executeRawUnsafe(`UPDATE "Empresa" SET "llevaIvaDeCompras" = true WHERE id = 'empresa_principal'`);
    try {
      const otra = await cabecera();
      const r = await renglon(otra.id);
      expect([r.alicuotaIva, r.importeNeto, r.importeIva]).toEqual([null, null, null]);
      expect(r.importeIvaComputable.toFixed(2)).toBe("0.00");
    } finally {
      await prismaAdmin.$executeRawUnsafe(`UPDATE "Empresa" SET "llevaIvaDeCompras" = false WHERE id = 'empresa_principal'`);
    }
  });
});

describe("la migración deja las columnas, las reglas y la tabla de tributos puestas", () => {
  it("las columnas de desglose son NULLABLES (sin CHECK de obligatoriedad), el computable es NOT NULL DEFAULT 0 y el dinero es NUMERIC(14,2)", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string; tipo: string; es_nulable: string; defecto: string | null; precision: number | null; escala: number | null }>>`
      SELECT table_name::text AS tabla, column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, column_default AS defecto, numeric_precision::int AS precision, numeric_scale::int AS escala
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('FacturaProveedor', 'FacturaProveedorRenglon')
        AND column_name IN ('condicionIvaEmpresa', 'importeNeto', 'importeIva', 'alicuotaIva', 'importeIvaComputable') ORDER BY table_name, column_name`;
    expect(columnas.map((c) => `${c.tabla}.${c.columna}:${c.tipo}:${c.es_nulable}:${c.defecto}:${c.precision ?? "-"},${c.escala ?? "-"}`)).toEqual([
      "FacturaProveedor.condicionIvaEmpresa:text:YES:null:-,-",
      "FacturaProveedor.importeIva:numeric:YES:null:14,2",
      "FacturaProveedor.importeNeto:numeric:YES:null:14,2",
      "FacturaProveedorRenglon.alicuotaIva:text:YES:null:-,-",
      "FacturaProveedorRenglon.importeIva:numeric:YES:null:14,2",
      "FacturaProveedorRenglon.importeIvaComputable:numeric:NO:0:14,2",
      "FacturaProveedorRenglon.importeNeto:numeric:YES:null:14,2",
    ]);
  });

  it("los 12 CHECK nuevos están puestos y validados", async () => {
    const checks = await prismaAdmin.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`SELECT conname::text AS conname, convalidated FROM pg_constraint WHERE contype = 'c' AND conname::text = ANY(${CHECKS}::text[])`;
    expect(checks.map((c) => c.conname).sort()).toEqual([...CHECKS].sort());
    expect(checks.every((c) => c.convalidated)).toBe(true);
  });

  it("NINGÚN CHECK depende de la perilla ni de la letra: la base no puede leer Empresa y no impone obligatoriedad", async () => {
    const defs = await prismaAdmin.$queryRaw<Array<{ conname: string; d: string }>>`SELECT conname::text AS conname, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE contype = 'c' AND conname::text = ANY(${CHECKS}::text[])`;
    for (const { conname, d } of defs) {
      expect(d, `${conname}: no menciona la perilla`).not.toMatch(/llevaIvaDeCompras/);
      expect(d, `${conname}: no menciona la letra`).not.toMatch(/letra/);
      expect(d, `${conname}: no exige una columna de desglose NOT NULL a secas`).not.toMatch(/^CHECK \(\("?(importeNeto|importeIva|alicuotaIva)"? IS NOT NULL\)\)$/);
    }
  });

  it("las listas cerradas de los CHECK son EXACTAMENTE las de src/core/fiscal/iva.ts (alícuotas y condiciones) y las de tributos", async () => {
    expect((await codigosDelCheck("FacturaProveedorRenglon_alicuota_iva_chk")).sort()).toEqual([...ALICUOTAS_IVA].sort());
    expect((await codigosDelCheck("FacturaProveedor_condicion_iva_empresa_chk")).sort()).toEqual([...CONDICIONES_IVA].sort());
    expect((await codigosDelCheck("FacturaProveedorTributo_tipo_chk")).sort()).toEqual([...TIPOS_DE_TRIBUTO].sort());
  });

  it("la tabla de tributos tiene RLS por empresa, claves foráneas compuestas RESTRICT y solo SELECT e INSERT para motor2_app (nada para motor2_plataforma)", async (ctx) => {
    const rls = await prismaAdmin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '"FacturaProveedorTributo"'::regclass`;
    expect(rls).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
    const politicas = await prismaAdmin.$queryRaw<Array<{ policyname: string }>>`SELECT policyname::text AS policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'FacturaProveedorTributo'`;
    expect(politicas.map((p) => p.policyname)).toEqual(["aislamiento_empresa"]);
    const fks = await prismaAdmin.$queryRaw<Array<{ conname: string; d: string }>>`SELECT conname::text AS conname, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE contype = 'f' AND conrelid = '"FacturaProveedorTributo"'::regclass ORDER BY 1`;
    expect(fks.map((f) => f.conname)).toEqual(["FacturaProveedorTributo_empresaId_facturaProveedorId_fkey", "FacturaProveedorTributo_empresaId_fkey"]);
    for (const f of fks) expect(f.d, f.conname).toMatch(/ON DELETE RESTRICT/);
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const filas = await prismaAdmin.$queryRaw<Array<{ rol: string; privilegio: string }>>`
      SELECT grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'FacturaProveedorTributo' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`;
    expect(filas).toEqual([{ rol: "motor2_app", privilegio: "INSERT" }, { rol: "motor2_app", privilegio: "SELECT" }]);
  });

  it("las columnas nuevas del dinero NO tienen UPDATE para motor2_app (el desglose, como el total, no se corrige)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const r = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string }>>`
      SELECT c.relname::text AS tabla, a.attname::text AS columna FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname IN ('FacturaProveedor', 'FacturaProveedorRenglon') AND a.attname IN ('condicionIvaEmpresa', 'importeNeto', 'importeIva', 'alicuotaIva', 'importeIvaComputable') AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE')`;
    expect(r).toEqual([]);
  });

  it("el migration.sql y el down.sql avisan que requieren autorización, que la reversa puede perder datos y qué sacan", () => {
    expect(readFileSync(join(CARPETA, "migration.sql"), "utf8").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    const reversa = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(reversa).toMatch(/DESTRUCTIVA/);
    for (const nombre of ["llevaIvaDeCompras", "FacturaProveedorTributo", "importeIvaComputable", "alicuotaIva", "condicionIvaEmpresa", ...CHECKS.filter((c) => !c.startsWith("FacturaProveedorTributo"))]) expect(reversa, `el down.sql saca ${nombre}`).toContain(nombre);
  });
});

describe("el renglón: el desglose de IVA, cuando hay valores, es coherente", () => {
  it("sin desglose (perilla apagada) el renglón se guarda con todo con IVA incluido", async () => {
    const r = await renglon((await cabecera()).id);
    expect([r.alicuotaIva, r.importeNeto, r.importeIva, r.importeIvaComputable.toFixed(2)]).toEqual([null, null, null, "0.00"]);
  });

  it("con desglose: neto + IVA = total del renglón EXACTO; un centavo de diferencia se rechaza (FacturaProveedorRenglon_neto_mas_iva_chk)", async () => {
    const f = await cabecera({ importeTotal: "121.00" });
    const ok = await renglon(f.id, { precioTotal: "121.00", alicuotaIva: "IVA_21", importeNeto: "100.00", importeIva: "21.00", importeIvaComputable: "21.00" });
    expect([ok.importeNeto?.toFixed(2), ok.importeIva?.toFixed(2), ok.importeIvaComputable.toFixed(2)]).toEqual(["100.00", "21.00", "21.00"]);
    await expect(renglon(f.id, { orden: 2, precioTotal: "121.00", alicuotaIva: "IVA_21", importeNeto: "100.00", importeIva: "20.99" })).rejects.toThrow(/FacturaProveedorRenglon_neto_mas_iva_chk/);
    await expect(renglon(f.id, { orden: 2, precioTotal: "121.00", alicuotaIva: "IVA_21", importeNeto: "100.01", importeIva: "21.00" })).rejects.toThrow(/FacturaProveedorRenglon_neto_mas_iva_chk/);
  });

  it("PROPIEDAD: cualquier partición en centavos de un total en neto + IVA se guarda, y moverla un centavo se rechaza", async () => {
    const f = await cabecera();
    let orden = 1;
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 9_999_999_999 }), fc.integer({ min: 0, max: 9_999_999_999 }), async (netoCentavos, ivaCentavos) => {
        const texto = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
        const total = texto(netoCentavos + ivaCentavos);
        const o = ++orden;
        await renglon(f.id, { orden: o, precioTotal: total, precioPorUnidadStock: "0", importeNeto: texto(netoCentavos), importeIva: texto(ivaCentavos), importeIvaComputable: texto(ivaCentavos) });
        await expect(renglon(f.id, { orden: ++orden, precioTotal: total, precioPorUnidadStock: "0", importeNeto: texto(netoCentavos + 1), importeIva: texto(ivaCentavos) })).rejects.toThrow(/neto_mas_iva_chk/);
      }),
      { numRuns: 15 },
    );
  }, 120_000);

  it("el neto y el IVA van juntos (FacturaProveedorRenglon_desglose_pareo_chk) y no son negativos (..._desglose_no_negativo_chk)", async () => {
    const f = await cabecera();
    await expect(renglon(f.id, { importeNeto: "100.00" })).rejects.toThrow(/FacturaProveedorRenglon_desglose_pareo_chk/);
    await expect(renglon(f.id, { importeIva: "0.00" })).rejects.toThrow(/FacturaProveedorRenglon_desglose_pareo_chk/);
    await expect(renglon(f.id, { precioTotal: "-0.00", importeNeto: "-10.00", importeIva: "10.00" })).rejects.toThrow(/FacturaProveedorRenglon_(desglose_no_negativo|precio_total_no_negativo)_chk/);
    await expect(renglon(f.id, { precioTotal: "110.00", importeNeto: "120.00", importeIva: "-10.00" })).rejects.toThrow(/FacturaProveedorRenglon_desglose_no_negativo_chk/);
  });

  it("la alícuota es de la lista cerrada (FacturaProveedorRenglon_alicuota_iva_chk): las 8 entran, un código inventado, el porcentaje suelto y las minúsculas no", async () => {
    const f = await cabecera();
    let orden = 0;
    for (const alicuota of ALICUOTAS_IVA) expect((await renglon(f.id, { orden: ++orden, alicuotaIva: alicuota })).alicuotaIva).toBe(alicuota);
    for (const mala of ["IVA_20", "21", "iva_21", "", "NO_CORRESPONDE"]) await expect(renglon(f.id, { orden: ++orden, alicuotaIva: mala }), mala).rejects.toThrow(/FacturaProveedorRenglon_alicuota_iva_chk/);
  });

  it("con una alícuota que no genera IVA (0 %, exento, no gravado) el IVA discriminado es cero (FacturaProveedorRenglon_alicuota_sin_iva_chk)", async () => {
    const f = await cabecera();
    let orden = 0;
    for (const alicuota of ["IVA_0", "EXENTO", "NO_GRAVADO"]) {
      await expect(renglon(f.id, { orden: ++orden, alicuotaIva: alicuota, importeNeto: "90.00", importeIva: "10.00" }), alicuota).rejects.toThrow(/FacturaProveedorRenglon_alicuota_sin_iva_chk/);
      expect((await renglon(f.id, { orden: ++orden, alicuotaIva: alicuota, importeNeto: "100.00", importeIva: "0.00" })).importeIva?.toFixed(2)).toBe("0.00");
    }
  });

  it("el IVA computable va de cero al IVA del renglón; sin IVA discriminado es cero (FacturaProveedorRenglon_iva_computable_chk)", async () => {
    const f = await cabecera({ importeTotal: "121.00" });
    const desglose = { precioTotal: "121.00", alicuotaIva: "IVA_21", importeNeto: "100.00", importeIva: "21.00" };
    expect((await renglon(f.id, { orden: 1, ...desglose, importeIvaComputable: "0.00" })).importeIvaComputable.toFixed(2)).toBe("0.00");
    expect((await renglon(f.id, { orden: 2, ...desglose, importeIvaComputable: "10.50" })).importeIvaComputable.toFixed(2)).toBe("10.50");
    expect((await renglon(f.id, { orden: 3, ...desglose, importeIvaComputable: "21.00" })).importeIvaComputable.toFixed(2)).toBe("21.00");
    await expect(renglon(f.id, { orden: 4, ...desglose, importeIvaComputable: "21.01" })).rejects.toThrow(/FacturaProveedorRenglon_iva_computable_chk/);
    await expect(renglon(f.id, { orden: 4, ...desglose, importeIvaComputable: "-0.01" })).rejects.toThrow(/FacturaProveedorRenglon_iva_computable_chk/);
    await expect(renglon(f.id, { orden: 4, importeIvaComputable: "1.00" })).rejects.toThrow(/FacturaProveedorRenglon_iva_computable_chk/);
  });
});

describe("la cabecera: la condición de IVA de la empresa y los totales del desglose", () => {
  it("la condición es una de las tres de la lista (o ninguna) (FacturaProveedor_condicion_iva_empresa_chk)", async () => {
    for (const condicion of CONDICIONES_IVA) expect((await cabecera({ condicionIvaEmpresa: condicion })).condicionIvaEmpresa).toBe(condicion);
    expect((await cabecera({ condicionIvaEmpresa: null })).condicionIvaEmpresa).toBeNull();
    for (const mala of ["CONSUMIDOR_FINAL", "responsable_inscripto", ""]) await expect(cabecera({ condicionIvaEmpresa: mala }), mala).rejects.toThrow(/FacturaProveedor_condicion_iva_empresa_chk/);
  });

  it("el neto y el IVA del comprobante van juntos, no son negativos y, sumados, no superan el total (el resto son tributos)", async () => {
    const f = await cabecera({ importeTotal: "121.00", importeNeto: "100.00", importeIva: "21.00" });
    expect([f.importeNeto?.toFixed(2), f.importeIva?.toFixed(2)]).toEqual(["100.00", "21.00"]);
    expect((await cabecera({ importeTotal: "126.00", importeNeto: "100.00", importeIva: "21.00" })).importeTotal.toFixed(2)).toBe("126.00");
    await expect(cabecera({ importeTotal: "121.00", importeNeto: "100.00" })).rejects.toThrow(/FacturaProveedor_desglose_pareo_chk/);
    await expect(cabecera({ importeTotal: "121.00", importeIva: "21.00" })).rejects.toThrow(/FacturaProveedor_desglose_pareo_chk/);
    await expect(cabecera({ importeTotal: "121.00", importeNeto: "-1.00", importeIva: "21.00" })).rejects.toThrow(/FacturaProveedor_desglose_no_negativo_chk/);
    await expect(cabecera({ importeTotal: "120.99", importeNeto: "100.00", importeIva: "21.00" })).rejects.toThrow(/FacturaProveedor_desglose_dentro_del_total_chk/);
  });

  it("sin desglose (perilla apagada) la cabecera se guarda como siempre: sin condición, neto ni IVA", async () => {
    const f = await cabecera();
    expect([f.condicionIvaEmpresa, f.importeNeto, f.importeIva]).toEqual([null, null, null]);
  });
});

describe("los tributos de la factura", () => {
  it("un tributo cuelga de su cabecera, con tipo de la lista y un importe exacto mayor que cero", async () => {
    const f = await cabecera();
    for (const tipo of TIPOS_DE_TRIBUTO) expect((await tributo(f.id, { tipo, importe: "1234.56" })).tipo).toBe(tipo);
    expect((await prismaAdmin.facturaProveedorTributo.findFirstOrThrow({ where: { facturaProveedorId: f.id } })).importe.toFixed(2)).toBe("1234.56");
    const conTributos = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: f.id }, include: { tributos: true } });
    expect(conTributos.tributos).toHaveLength(TIPOS_DE_TRIBUTO.length);
  });

  it("el tipo inventado (FacturaProveedorTributo_tipo_chk) y el importe en cero o negativo (FacturaProveedorTributo_importe_positivo_chk) se rechazan", async () => {
    const f = await cabecera();
    await expect(tributo(f.id, { tipo: "PERCEPCION_INVENTADA" })).rejects.toThrow(/FacturaProveedorTributo_tipo_chk/);
    await expect(tributo(f.id, { importe: "0.00" })).rejects.toThrow(/FacturaProveedorTributo_importe_positivo_chk/);
    await expect(tributo(f.id, { importe: "-1.00" })).rejects.toThrow(/FacturaProveedorTributo_importe_positivo_chk/);
  });

  it("la cabecera tiene que existir, una cabecera con tributos no se puede borrar (RESTRICT) y un tributo no puede colgar de la cabecera de otra empresa", async () => {
    await expect(tributo("no-existe")).rejects.toThrow(/FacturaProveedorTributo_empresaId_facturaProveedorId_fkey/);
    const f = await cabecera();
    await tributo(f.id);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "FacturaProveedor" WHERE id = '${f.id}'`)).rejects.toThrow(/FacturaProveedorTributo_empresaId_facturaProveedorId_fkey/);
    const ajeno = await sembrarAjeno(e.usuarioId);
    await expect(tributo(ajeno.factura.id)).rejects.toThrow(/FacturaProveedorTributo_empresaId_facturaProveedorId_fkey/);
  });

  it("la RLS: la empresa A no ve los tributos de la B", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    await ajeno.testigo.facturaProveedorTributo.create({ data: { facturaProveedorId: ajeno.factura.id, tipo: "OTRO", importe: "3.00" } });
    const propia = await cabecera();
    const mio = await tributo(propia.id);
    expect((await prisma.facturaProveedorTributo.findMany()).map((t) => t.id)).toEqual([mio.id]);
    expect(await prismaAdmin.facturaProveedorTributo.count()).toBe(2);
  });

  it("solo se agrega: motor2_app puede INSERTAR y LEER un tributo pero no modificarlo ni borrarlo (permission denied)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const db = baseDeTest.db;
    const f = await db.facturaProveedor.create({ data: datosDeFactura(e) as never });
    const t = await db.facturaProveedorTributo.create({ data: { facturaProveedorId: f.id, tipo: "PERCEPCION_IVA", importe: "10.00" } });
    expect((await db.facturaProveedorTributo.findUniqueOrThrow({ where: { id: t.id } })).importe.toFixed(2)).toBe("10.00");
    await expect(db.facturaProveedorTributo.update({ where: { id: t.id }, data: { importe: "0.01" } })).rejects.toThrow(/permission denied/i);
    await expect(db.facturaProveedorTributo.delete({ where: { id: t.id } })).rejects.toThrow(/permission denied/i);
    await expect(db.facturaProveedor.update({ where: { id: f.id }, data: { importeNeto: "1.00", importeIva: "0.00" } as never })).rejects.toThrow(/permission denied/i);
  });
});

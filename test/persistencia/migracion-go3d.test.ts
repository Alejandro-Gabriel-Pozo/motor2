import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { TIPOS_DE_CUPO } from "../../src/core/carta/cupos-de-promo";
import { EMPRESA_DE_PRUEBA_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, conexionDelDuenio, intentar } from "../setup/gasto";
import { sembrarEscenarioDeCombos, sentenciaDeCupo, sentenciaDeEntrada, sentenciaDeOpcionDeEntrada, sentenciaDePlatoDelDia, type EscenarioDeCombos } from "../setup/opciones";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * GO-3d — migración 20261021100000_go3d_combos_y_menu_del_dia (ADR-032, frente D: combos y menú del día), contra la base real. Las columnas nuevas de `PromoCarta` (vigencia) y de `PromoCartaCupo`
 * (tipo, nombre, baja lógica; `seccionCartaId` nulable), las tablas `EntradaDeCupo` y `OpcionDeEntradaDeCupo` (DE LA EMPRESA) y `EntradaDelDiaDeCupo` (PROPIA de la sucursal, con las 4 políticas
 * de GO-3d-rls, 20261021101000).
 *
 * Qué se mide: la estructura exacta (columnas, dinero sin float, índices, claves foráneas RESTRICT, CHECK validados, RLS y políticas, privilegios de tabla y por columna); cada CHECK con su caso
 * NULL o vacío que pasa y el que lo rompe; los únicos (también el parcial por nombre sin mayúsculas, y que el de sección sigue valiendo); la paridad de los tipos de cupo con el núcleo; que la app
 * solo cambia lo editable y no borra nada; el alcance por sucursal del plato del día (escribir en otra sucursal da 42501, lo de otra sucursal no se ve, sin alcance no se ve nada); y la pertenencia
 * (claves foráneas compuestas con la empresa, también como dueño).
 *
 * Mutaciones demostradas (filas de docs/pureza-integracion.md): sacar el CHECK de los días de la semana de la base (cae «la máscara va de 1 a 127»), sacar `EntradaDelDiaDeCupo` de
 * `ALCANCE_PROPIA` (cae `alcance-de-sucursal`) y quitar la política de INSERT del plato del día (cae «escribir en otra sucursal da 42501»).
 */
afterAll(() => prismaAdmin.$disconnect());

const SUBIDA = join(__dirname, "../../prisma/migrations/20261021100000_go3d_combos_y_menu_del_dia");
const POLITICAS = join(__dirname, "../../prisma/migrations/20261021101000_go3d_rls_sucursal_menu_del_dia");
const TABLAS = ["EntradaDeCupo", "OpcionDeEntradaDeCupo", "EntradaDelDiaDeCupo"] as const;
const HOY = "2026-10-14";

let e: EscenarioDeCombos;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeCombos();
});
afterEach(cerrarConexiones);

const cuantos = async (tabla: string, filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);
const probar = (c: Parameters<typeof intentar>[0], s: { texto: string; params: unknown[] }) => intentar(c, s.texto, s.params);
const alcanceA = () => ({ lectura: [e.sucursalA], escritura: [e.sucursalA] });
const plato = (extra: Record<string, unknown> = {}) => sentenciaDePlatoDelDia({ cupoId: e.cupoDelDiaId, sucursalId: e.sucursalA, productoId: e.milanesaId, usuarioId: e.usuarioId, fecha: HOY }, extra);
const entrada = (extra: Record<string, unknown> = {}) => sentenciaDeEntrada({ cupoId: e.cupoListaId, productoId: e.cafeId }, extra);
const listaTabla = (nombres: readonly string[]) => nombres.map((t) => `'${t}'`).join(", ");

describe("la migración deja las columnas, las tablas, los índices, las claves foráneas, las reglas, la RLS y los privilegios puestos", () => {
  it("columnas: la vigencia de la promo (DATE y SMALLINT, nulables), el tipo, el nombre y la baja lógica del cupo (con su valor por defecto) y `seccionCartaId` nulable; las tres tablas nuevas, sin float", async () => {
    const columnas = await prismaAdmin.$queryRawUnsafe<Array<{ tabla: string; columna: string; tipo: string; es_nulable: string; por_defecto: string | null }>>(
      `SELECT table_name::text AS tabla, column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, column_default AS por_defecto
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('PromoCarta', 'PromoCartaCupo', ${listaTabla(TABLAS)}) ORDER BY table_name, ordinal_position`,
    );
    const forma = (tabla: string, nombres?: string[]) => columnas.filter((c) => c.tabla === tabla && (!nombres || nombres.includes(c.columna))).map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`);
    const T = "timestamp without time zone";
    expect(forma("PromoCarta", ["vigenteDesde", "vigenteHasta", "diasDeSemana", "version"])).toEqual(["vigenteDesde:date:YES", "vigenteHasta:date:YES", "diasDeSemana:smallint:YES", "version:integer:NO"]);
    expect(forma("PromoCartaCupo", ["seccionCartaId", "tipo", "nombre", "activo"])).toEqual(["seccionCartaId:text:YES", "tipo:text:NO", "nombre:text:YES", "activo:boolean:NO"]);
    const defecto = (tabla: string, columna: string) => columnas.find((c) => c.tabla === tabla && c.columna === columna)!.por_defecto;
    expect(defecto("PromoCarta", "version"), "control optimista: toda promo de hoy queda en la versión 1").toBe("1");
    expect(defecto("PromoCartaCupo", "tipo")).toBe("'SECCION'::text");
    expect(defecto("PromoCartaCupo", "activo")).toBe("true");
    expect(forma("EntradaDeCupo")).toEqual(["id:text:NO", "empresaId:text:NO", "cupoId:text:NO", "productoId:text:NO", "claveConfiguracion:text:NO", "orden:integer:NO", "activa:boolean:NO", `creadoEn:${T}:NO`, `actualizadoEn:${T}:NO`]);
    expect(forma("OpcionDeEntradaDeCupo")).toEqual(["id:text:NO", "empresaId:text:NO", "entradaId:text:NO", "opcionId:text:NO", "cantidad:integer:NO", `creadoEn:${T}:NO`]);
    expect(forma("EntradaDelDiaDeCupo")).toEqual([
      "id:text:NO", "empresaId:text:NO", "cupoId:text:NO", "sucursalId:text:NO", "fecha:date:NO", "productoId:text:NO", "activa:boolean:NO", "actualizadoPorId:text:NO", `creadoEn:${T}:NO`, `actualizadoEn:${T}:NO`,
    ]);
    expect(defecto("EntradaDeCupo", "claveConfiguracion")).toBe("''::text");
    for (const tabla of TABLAS) expect(defecto(tabla, "empresaId"), tabla).toMatch(/app_empresa_actual\(\)/);
    expect(columnas.filter((c) => /double|real|money/.test(c.tipo))).toEqual([]);
  });

  it("los índices nuevos (con el parcial por nombre sin mayúsculas) y que el único de sección de siempre sigue en pie", async () => {
    const indices = await prismaAdmin.$queryRawUnsafe<Array<{ nombre: string; definicion: string }>>(
      `SELECT indexname::text AS nombre, indexdef AS definicion FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('PromoCartaCupo', ${listaTabla(TABLAS)}) AND indexname NOT LIKE '%_pkey' ORDER BY 1`,
    );
    expect(indices.map((i) => i.nombre)).toEqual([
      "EntradaDeCupo_cupoId_productoId_claveConfiguracion_key", "EntradaDeCupo_empresaId_id_key", "EntradaDeCupo_productoId_idx",
      "EntradaDelDiaDeCupo_cupoId_sucursalId_fecha_productoId_key", "EntradaDelDiaDeCupo_empresaId_id_key", "EntradaDelDiaDeCupo_productoId_idx", "EntradaDelDiaDeCupo_sucursalId_fecha_idx",
      "OpcionDeEntradaDeCupo_empresaId_id_key", "OpcionDeEntradaDeCupo_entradaId_opcionId_key", "OpcionDeEntradaDeCupo_opcionId_idx",
      "PromoCartaCupo_empresaId_id_key", "PromoCartaCupo_nombre_lower_key", "PromoCartaCupo_promoCartaId_seccionCartaId_key",
    ]);
    expect(indices.find((i) => i.nombre === "PromoCartaCupo_nombre_lower_key")!.definicion).toMatch(/UNIQUE INDEX .* \("promoCartaId", lower\(nombre\)\) WHERE \(tipo <> 'SECCION'::text\)/);
  });

  it("las claves foráneas son compuestas con la empresa y todas RESTRICT; los CHECK nuevos existen, validados", async () => {
    const fks = await prismaAdmin.$queryRawUnsafe<Array<{ nombre: string; definicion: string }>>(
      `SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN (${TABLAS.map((t) => `'"${t}"'`).join(", ")}) ORDER BY 1`,
    );
    expect(fks.map((f) => f.nombre)).toEqual([
      "EntradaDeCupo_empresaId_cupoId_fkey", "EntradaDeCupo_empresaId_fkey", "EntradaDeCupo_empresaId_productoId_fkey",
      "EntradaDelDiaDeCupo_actualizadoPorId_fkey", "EntradaDelDiaDeCupo_empresaId_cupoId_fkey", "EntradaDelDiaDeCupo_empresaId_fkey", "EntradaDelDiaDeCupo_empresaId_productoId_fkey", "EntradaDelDiaDeCupo_empresaId_sucursalId_fkey",
      "OpcionDeEntradaDeCupo_empresaId_entradaId_fkey", "OpcionDeEntradaDeCupo_empresaId_fkey", "OpcionDeEntradaDeCupo_empresaId_opcionId_fkey",
    ]);
    for (const f of fks) expect(f.definicion, f.nombre).toMatch(/ON DELETE RESTRICT/);
    expect(fks.find((f) => f.nombre === "EntradaDeCupo_empresaId_cupoId_fkey")!.definicion).toMatch(/FOREIGN KEY \("empresaId", "cupoId"\) REFERENCES "PromoCartaCupo"\("empresaId", id\)/);
    expect(fks.find((f) => f.nombre === "EntradaDelDiaDeCupo_empresaId_sucursalId_fkey")!.definicion).toMatch(/FOREIGN KEY \("empresaId", "sucursalId"\) REFERENCES "Sucursal"\("empresaId", id\)/);
    const checks = await prismaAdmin.$queryRawUnsafe<Array<{ nombre: string; validada: boolean }>>(
      `SELECT conname::text AS nombre, convalidated AS validada FROM pg_constraint WHERE contype = 'c' AND conrelid::regclass::text IN ('"PromoCarta"', '"PromoCartaCupo"', ${TABLAS.map((t) => `'"${t}"'`).join(", ")}) ORDER BY 1`,
    );
    expect(checks).toEqual([
      { nombre: "EntradaDeCupo_clave_configuracion_chk", validada: true },
      { nombre: "EntradaDeCupo_orden_chk", validada: true },
      { nombre: "OpcionDeEntradaDeCupo_cantidad_chk", validada: true },
      { nombre: "PromoCartaCupo_nombre_chk", validada: true },
      { nombre: "PromoCartaCupo_seccion_solo_en_seccion_chk", validada: true },
      { nombre: "PromoCartaCupo_tipo_chk", validada: true },
      { nombre: "PromoCarta_dias_de_semana_chk", validada: true },
      { nombre: "PromoCarta_version_chk", validada: true },
      { nombre: "PromoCarta_vigencia_chk", validada: true },
    ]);
  });

  it("paridad: los tipos del CHECK de `PromoCartaCupo.tipo` son exactamente `TIPOS_DE_CUPO` del núcleo, en el mismo orden", async () => {
    const [def] = await prismaAdmin.$queryRaw<Array<{ d: string }>>`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'PromoCartaCupo_tipo_chk'`;
    expect([...def!.d.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1])).toEqual([...TIPOS_DE_CUPO]);
  });

  it("RLS por empresa sin FORCE en las tres; `aislamiento_empresa` en las tres y, solo en el plato del día, las 4 de sucursal (RESTRICTIVE, TO motor2_app) de GO-3d-rls", async () => {
    const rls = await prismaAdmin.$queryRawUnsafe<Array<{ tabla: string; rls: boolean; forzado: boolean }>>(
      `SELECT relname::text AS tabla, relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN (${listaTabla(TABLAS)}) ORDER BY 1`,
    );
    expect(rls).toEqual(["EntradaDeCupo", "EntradaDelDiaDeCupo", "OpcionDeEntradaDeCupo"].map((tabla) => ({ tabla, rls: true, forzado: false })));
    const politicas = await prismaAdmin.$queryRawUnsafe<Array<{ tabla: string; nombre: string; permissive: string; roles: string }>>(
      `SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles FROM pg_policies WHERE tablename IN (${listaTabla(TABLAS)}) ORDER BY 1, 2`,
    );
    expect(politicas.filter((p) => p.tabla === "EntradaDeCupo").map((p) => p.nombre)).toEqual(["aislamiento_empresa"]);
    expect(politicas.filter((p) => p.tabla === "OpcionDeEntradaDeCupo").map((p) => p.nombre)).toEqual(["aislamiento_empresa"]);
    const delDia = politicas.filter((p) => p.tabla === "EntradaDelDiaDeCupo");
    expect(delDia.map((p) => p.nombre)).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
    for (const p of delDia.filter((x) => x.nombre.startsWith("alcance_"))) expect([p.permissive, p.roles], p.nombre).toEqual(["RESTRICTIVE", "{motor2_app}"]);
  });

  it("privilegios EXACTOS de motor2_app: SELECT e INSERT en las tres; UPDATE solo de orden/activa/actualizadoEn (entrada) y de activa/actualizadoPorId/actualizadoEn (plato del día); ningún UPDATE de la configuración ni DELETE; motor2_plataforma, nada", async () => {
    const filas = await prismaAdmin.$queryRawUnsafe<Array<{ tabla: string; rol: string; privilegio: string }>>(
      `SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN (${listaTabla(TABLAS)}) AND grantee IN ('motor2_app', 'motor2_plataforma')`,
    );
    expect(filas.map((f) => `${f.tabla}|${f.rol}|${f.privilegio}`).sort()).toEqual(TABLAS.flatMap((t) => ["INSERT", "SELECT"].map((p) => `${t}|motor2_app|${p}`)).sort());
    const actualizables = async (tabla: string) =>
      (await prismaAdmin.$queryRawUnsafe<Array<{ columna: string }>>(
        `SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"${tabla}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`,
      )).map((c) => c.columna);
    expect(await actualizables("EntradaDeCupo")).toEqual(["activa", "actualizadoEn", "orden"]);
    expect(await actualizables("OpcionDeEntradaDeCupo")).toEqual([]);
    expect(await actualizables("EntradaDelDiaDeCupo")).toEqual(["activa", "actualizadoEn", "actualizadoPorId"]);
  });

  it("el migration.sql y el down.sql avisan que requieren autorización, que la reversa ABORTA con datos y que el código anterior necesita los lectores tolerantes; la migración de esquema no crea políticas de sucursal", () => {
    const subida = readFileSync(join(SUBIDA, "migration.sql"), "utf8");
    const reversa = readFileSync(join(SUBIDA, "down.sql"), "utf8");
    expect(subida.split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(subida).toContain("lock_timeout");
    expect(subida).toMatch(/EXPANDIR Y CONTRAER/);
    expect(reversa).toMatch(/ABORTA/);
    for (const t of TABLAS) expect(reversa).toContain(`DROP TABLE IF EXISTS "${t}"`);
    for (const sql of [subida, reversa]) {
      expect(sql).not.toContain("alcance_sucursal_");
      expect(sql).not.toContain("app_sucursales_");
    }
    expect(readFileSync(join(POLITICAS, "migration.sql"), "utf8").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
  });
});

describe("el control optimista de la promo (PromoCarta.version)", () => {
  it("la versión es obligatoria y de 1 o más (0 y negativos dan 23514; NULL, 23502); toda promo de hoy queda en 1; la app la sube con `WHERE version = esperada` y con la versión vieja no toca nada", async () => {
    expect((await prismaAdmin.promoCarta.findUniqueOrThrow({ where: { id: e.promoId } })).version).toBe(1);
    const duenio = await conexionDelDuenio();
    for (const malo of ["0", "-1"]) expect(await intentar(duenio, `UPDATE "PromoCarta" SET "version" = ${malo} WHERE "id" = $1`, [e.promoId]), malo).toEqual({ codigo: "23514", restriccion: "PromoCarta_version_chk" });
    expect(await intentar(duenio, `UPDATE "PromoCarta" SET "version" = NULL WHERE "id" = $1`, [e.promoId])).toMatchObject({ codigo: "23502" });
    const app = await conexionComoApp(undefined, alcanceA());
    const editar = (esperada: number) => app.query(`UPDATE "PromoCarta" SET "precio" = 9900.00, "version" = "version" + 1 WHERE "id" = $1 AND "version" = $2`, [e.promoId, esperada]);
    expect((await editar(1)).rowCount, "con la versión vigente, edita").toBe(1);
    expect((await editar(1)).rowCount, "con la versión vieja (otro editor ya guardó), 0 filas: VERSION_DESACTUALIZADA").toBe(0);
    const promo = await prismaAdmin.promoCarta.findUniqueOrThrow({ where: { id: e.promoId } });
    expect([promo.version, promo.precio.toFixed(2)]).toEqual([2, "9900.00"]);
  });
});

describe("las reglas de la vigencia y de los cupos", () => {
  it("la máscara de días va de 1 a 127 (NULL = todos los días); desde <= hasta, con cualquiera de las dos en NULL", async () => {
    const duenio = await conexionDelDuenio();
    const poner = (columnas: string) => intentar(duenio, `UPDATE "PromoCarta" SET ${columnas} WHERE "id" = $1`, [e.promoId]);
    for (const malo of [0, 128, -1]) expect(await poner(`"diasDeSemana" = ${malo}`), `máscara ${malo}`).toEqual({ codigo: "23514", restriccion: "PromoCarta_dias_de_semana_chk" });
    for (const bueno of ["NULL", "1", "31", "127"]) expect(await poner(`"diasDeSemana" = ${bueno}`), `máscara ${bueno}`).toBeNull();
    expect(await poner(`"vigenteDesde" = '2026-10-15', "vigenteHasta" = '2026-10-14'`)).toEqual({ codigo: "23514", restriccion: "PromoCarta_vigencia_chk" });
    for (const bueno of [`'2026-10-14', '2026-10-14'`, `'2026-10-01', '2026-10-31'`, `NULL, '2026-10-31'`, `'2026-10-01', NULL`, "NULL, NULL"]) {
      const [desde, hasta] = bueno.split(", ");
      expect(await poner(`"vigenteDesde" = ${desde}, "vigenteHasta" = ${hasta}`), bueno).toBeNull();
    }
  });

  it("el tipo es SECCION, LISTA o DEL_DIA; la sección va si y solo si es SECCION; fuera de SECCION el nombre es obligatorio, visible y de hasta 80", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const cupo = (extra: Record<string, unknown>) => sentenciaDeCupo({ promoId: e.promoId }, extra);
    expect(await probar(app, cupo({ tipo: "OTRO" }))).toEqual({ codigo: "23514", restriccion: "PromoCartaCupo_tipo_chk" });
    expect(await probar(app, cupo({ tipo: "SECCION", nombre: null }))).toEqual({ codigo: "23514", restriccion: "PromoCartaCupo_seccion_solo_en_seccion_chk" });
    expect(await probar(app, cupo({ seccionCartaId: e.seccionCartaId }))).toEqual({ codigo: "23514", restriccion: "PromoCartaCupo_seccion_solo_en_seccion_chk" });
    expect(await probar(app, cupo({ nombre: null }))).toEqual({ codigo: "23514", restriccion: "PromoCartaCupo_nombre_chk" });
    expect(await probar(app, cupo({ tipo: "DEL_DIA", nombre: "   " }))).toEqual({ codigo: "23514", restriccion: "PromoCartaCupo_nombre_chk" });
    expect(await probar(app, cupo({ nombre: "x".repeat(81) }))).toEqual({ codigo: "23514", restriccion: "PromoCartaCupo_nombre_chk" });
    expect(await probar(app, cupo({ nombre: "x".repeat(80) }))).toBeNull();
    expect(await probar(app, cupo({ tipo: "DEL_DIA", nombre: "Guarnición del día" }))).toBeNull();
    // Un cupo de sección de siempre (sin tipo, sin nombre: los valores por defecto) sigue entrando.
    const otraSeccion = (await prismaAdmin.seccionCarta.create({ data: { empresaId: EMPRESA_DE_PRUEBA_ID, nombre: "Bebidas" } })).id;
    expect(await intentar(app, `INSERT INTO "PromoCartaCupo" ("id", "promoCartaId", "seccionCartaId", "cantidadMaxima") VALUES ('cupo-de-siempre', $1, $2, 1)`, [e.promoId, otraSeccion])).toBeNull();
    const deSiempre = await prismaAdmin.promoCartaCupo.findUniqueOrThrow({ where: { id: "cupo-de-siempre" } });
    expect([deSiempre.tipo, deSiempre.nombre, deSiempre.activo]).toEqual(["SECCION", null, true]);
  });

  it("el nombre de un cupo que no es de sección es único por promo SIN importar mayúsculas (23505); en otra promo entra; los de sección no se ven afectados y el único (promo, sección) sigue valiendo", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, sentenciaDeCupo({ promoId: e.promoId }, { nombre: "ENTRADA" }))).toEqual({ codigo: "23505", restriccion: "PromoCartaCupo_nombre_lower_key" });
    expect(await probar(app, sentenciaDeCupo({ promoId: e.promoId }, { tipo: "DEL_DIA", nombre: "plato del día" }))).toEqual({ codigo: "23505", restriccion: "PromoCartaCupo_nombre_lower_key" });
    const otra = (await prismaAdmin.promoCarta.create({ data: { empresaId: EMPRESA_DE_PRUEBA_ID, seccionCartaId: e.seccionCartaId, titulo: "Ejecutivo", precio: "12000.00" } })).id;
    expect(await probar(app, sentenciaDeCupo({ promoId: otra }, { nombre: "Entrada" }))).toBeNull();
    expect(await probar(app, sentenciaDeCupo({ promoId: e.promoId }, { tipo: "SECCION", nombre: null, seccionCartaId: e.seccionCartaId }))).toEqual({ codigo: "23505", restriccion: "PromoCartaCupo_promoCartaId_seccionCartaId_key" });
    // El dado de baja sigue ocupando su nombre: se reactiva, no se duplica.
    await prismaAdmin.promoCartaCupo.update({ where: { id: e.cupoListaId }, data: { activo: false } });
    expect(await probar(app, sentenciaDeCupo({ promoId: e.promoId }, { nombre: "Entrada" }))).toEqual({ codigo: "23505", restriccion: "PromoCartaCupo_nombre_lower_key" });
  });
});

describe("las reglas de las entradas y del plato del día", () => {
  it("la clave de configuración es vacía o pares `opcionId=cantidad` (1 a 10) separados por `;`; el orden no es negativo", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    for (const mala of ["x", "a=0", "a=11", "a=1;", ";a=1", "a=1;;b=2", "a b=1", "a=1=2"]) {
      expect(await probar(app, entrada({ claveConfiguracion: mala })), `clave «${mala}»`).toEqual({ codigo: "23514", restriccion: "EntradaDeCupo_clave_configuracion_chk" });
    }
    for (const buena of ["", `${e.medianoId}=1`, `${e.medianoId}=1;${e.vacaId}=10`]) expect(await probar(app, entrada({ claveConfiguracion: buena })), `clave «${buena}»`).toBeNull();
    expect(await probar(app, entrada({ claveConfiguracion: `${e.grandeId}=1`, orden: -1 }))).toEqual({ codigo: "23514", restriccion: "EntradaDeCupo_orden_chk" });
  });

  it("una entrada por (cupo, producto, configuración): repetirla da 23505; el mismo producto con OTRA configuración, o en otro cupo, entra", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, entrada())).toBeNull();
    expect(await probar(app, entrada({ orden: 3 }))).toEqual({ codigo: "23505", restriccion: "EntradaDeCupo_cupoId_productoId_claveConfiguracion_key" });
    expect(await probar(app, entrada({ claveConfiguracion: `${e.medianoId}=1` }))).toBeNull();
    expect(await probar(app, sentenciaDeEntrada({ cupoId: e.cupoDelDiaId, productoId: e.cafeId }))).toBeNull();
    expect(await cuantos("EntradaDeCupo")).toBe(3);
  });

  it("la opción de una configuración: de 1 a 10 unidades y una sola vez por entrada", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const alta = entrada({ claveConfiguracion: `${e.medianoId}=1` });
    expect(await probar(app, alta)).toBeNull();
    const opcion = (extra: Record<string, unknown>) => sentenciaDeOpcionDeEntrada({ entradaId: alta.id, opcionId: e.medianoId }, extra);
    for (const mala of [0, 11]) expect(await probar(app, opcion({ cantidad: mala })), `cantidad ${mala}`).toEqual({ codigo: "23514", restriccion: "OpcionDeEntradaDeCupo_cantidad_chk" });
    expect(await probar(app, opcion({}))).toBeNull();
    expect(await probar(app, opcion({ cantidad: 2 }))).toEqual({ codigo: "23505", restriccion: "OpcionDeEntradaDeCupo_entradaId_opcionId_key" });
  });

  it("un plato del día por (cupo, sucursal, fecha, producto): repetirlo da 23505; otra fecha u otro producto entran; la fecha es un día (sin hora)", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, plato())).toBeNull();
    expect(await probar(app, plato({ activa: false }))).toEqual({ codigo: "23505", restriccion: "EntradaDelDiaDeCupo_cupoId_sucursalId_fecha_productoId_key" });
    expect(await probar(app, plato({ fecha: "2026-10-15" }))).toBeNull();
    expect(await probar(app, plato({ productoId: e.cafeId }))).toBeNull();
    expect(await probar(app, plato({ actualizadoPorId: "no-existe", fecha: "2026-10-16" }))).toEqual({ codigo: "23503", restriccion: "EntradaDelDiaDeCupo_actualizadoPorId_fkey" });
    const [f] = await prismaAdmin.$queryRaw<Array<{ fecha: string }>>`SELECT "fecha"::text AS fecha FROM "EntradaDelDiaDeCupo" ORDER BY "fecha" LIMIT 1`;
    expect(f!.fecha).toBe(HOY);
  });
});

describe("solo cambian lo editable: la app no modifica la identidad ni borra nada", () => {
  it("UPDATE de la identidad de la entrada, de su configuración o del plato del día da 42501; el de lo editable anda", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const alta = entrada();
    const delDia = plato();
    expect(await probar(app, alta)).toBeNull();
    expect(await probar(app, delDia)).toBeNull();
    const opcion = sentenciaDeOpcionDeEntrada({ entradaId: alta.id, opcionId: e.medianoId });
    expect(await probar(app, opcion)).toBeNull();
    for (const [tabla, id, columna, valor] of [
      ["EntradaDeCupo", alta.id, "productoId", `'${e.milanesaId}'`],
      ["EntradaDeCupo", alta.id, "cupoId", `'${e.cupoDelDiaId}'`],
      ["EntradaDeCupo", alta.id, "claveConfiguracion", `'${e.grandeId}=1'`],
      ["OpcionDeEntradaDeCupo", opcion.id, "cantidad", "2"],
      ["EntradaDelDiaDeCupo", delDia.id, "fecha", "'2026-10-20'"],
      ["EntradaDelDiaDeCupo", delDia.id, "productoId", `'${e.cafeId}'`],
      ["EntradaDelDiaDeCupo", delDia.id, "sucursalId", `'${e.sucursalB}'`],
    ] as const) {
      expect(await intentar(app, `UPDATE "${tabla}" SET "${columna}" = ${valor} WHERE "id" = $1`, [id]), `${tabla}.${columna}`).toMatchObject({ codigo: "42501" });
    }
    expect(await intentar(app, `UPDATE "EntradaDeCupo" SET "activa" = false, "orden" = 4, "actualizadoEn" = now() WHERE "id" = $1`, [alta.id])).toBeNull();
    expect(await intentar(app, `UPDATE "EntradaDelDiaDeCupo" SET "activa" = false, "actualizadoPorId" = $2, "actualizadoEn" = now() WHERE "id" = $1`, [delDia.id, e.usuarioId])).toBeNull();
    expect((await prismaAdmin.entradaDeCupo.findUniqueOrThrow({ where: { id: alta.id } })).activa).toBe(false);
  });

  it("DELETE y TRUNCATE de las tres dan 42501 y las filas quedan", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const alta = entrada();
    expect(await probar(app, alta)).toBeNull();
    expect(await probar(app, sentenciaDeOpcionDeEntrada({ entradaId: alta.id, opcionId: e.medianoId }))).toBeNull();
    expect(await probar(app, plato())).toBeNull();
    for (const tabla of TABLAS) {
      expect(await intentar(app, `DELETE FROM "${tabla}"`), `DELETE ${tabla}`).toMatchObject({ codigo: "42501" });
      expect(await intentar(app, `TRUNCATE "${tabla}"`), `TRUNCATE ${tabla}`).toMatchObject({ codigo: "42501" });
    }
    expect([await cuantos("EntradaDeCupo"), await cuantos("OpcionDeEntradaDeCupo"), await cuantos("EntradaDelDiaDeCupo")]).toEqual([1, 1, 1]);
  });
});

describe("el alcance por sucursal del plato del día (GO-3d-rls)", () => {
  it("con alcance en A: cargar en B da 42501; lo cargado en B no se ve desde A ni se puede cambiar; sin alcance no se ve ni se escribe nada", async () => {
    const duenio = await conexionDelDuenio();
    const propia = { empresaId: EMPRESA_DE_PRUEBA_ID };
    expect(await probar(duenio, plato({ ...propia, sucursalId: e.sucursalB, id: "plato-de-b" }))).toBeNull();
    expect(await probar(duenio, plato({ ...propia, id: "plato-de-a" }))).toBeNull();
    const enA = await conexionComoApp(undefined, alcanceA());
    expect(await probar(enA, plato({ sucursalId: e.sucursalB, fecha: "2026-10-15" }))).toMatchObject({ codigo: "42501" });
    expect((await enA.query(`SELECT "id" FROM "EntradaDelDiaDeCupo" ORDER BY "id"`)).rows).toEqual([{ id: "plato-de-a" }]);
    await enA.query(`UPDATE "EntradaDelDiaDeCupo" SET "activa" = false WHERE "id" = 'plato-de-b'`);
    expect((await prismaAdmin.entradaDelDiaDeCupo.findUniqueOrThrow({ where: { id: "plato-de-b" } })).activa, "el UPDATE desde A no alcanza la fila de B").toBe(true);
    expect(await intentar(enA, `UPDATE "EntradaDelDiaDeCupo" SET "sucursalId" = $1 WHERE "id" = 'plato-de-a'`, [e.sucursalB])).toMatchObject({ codigo: "42501" });
    const sinAlcance = await conexionComoApp();
    expect((await sinAlcance.query(`SELECT "id" FROM "EntradaDelDiaDeCupo"`)).rows).toEqual([]);
    expect(await probar(sinAlcance, plato({ fecha: "2026-10-17" }))).toMatchObject({ codigo: "42501" });
    // Las entradas de lista son de la empresa: se ven desde cualquier sucursal (y aun sin alcance).
    expect(await probar(duenio, entrada({ ...propia, id: "entrada-de-empresa" }))).toBeNull();
    expect((await sinAlcance.query(`SELECT "id" FROM "EntradaDeCupo"`)).rows).toEqual([{ id: "entrada-de-empresa" }]);
  });
});

describe("la pertenencia: claves foráneas compuestas con empresaId", () => {
  it("una entrada, una opción o un plato del día con el cupo, el producto, la opción o la sucursal de OTRA empresa da 23503, aun como DUEÑO con el empresaId explícito", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const grupoAjeno = await ajeno.testigo.grupoDeOpciones.create({ data: { nombre: "Grupo testigo", tipo: "VARIANTE" } });
    const opcionAjena = await ajeno.testigo.opcionDeGrupo.create({ data: { grupoId: grupoAjeno.id, nombre: "Opción testigo" } });
    const duenio = await conexionDelDuenio();
    const propia = { empresaId: EMPRESA_DE_PRUEBA_ID };
    expect(await probar(duenio, entrada({ ...propia, productoId: ajeno.producto.id }))).toEqual({ codigo: "23503", restriccion: "EntradaDeCupo_empresaId_productoId_fkey" });
    expect(await probar(duenio, plato({ ...propia, sucursalId: ajeno.sucursal.id }))).toEqual({ codigo: "23503", restriccion: "EntradaDelDiaDeCupo_empresaId_sucursalId_fkey" });
    expect(await probar(duenio, plato({ ...propia, productoId: ajeno.producto.id }))).toEqual({ codigo: "23503", restriccion: "EntradaDelDiaDeCupo_empresaId_productoId_fkey" });
    const alta = entrada(propia);
    expect(await probar(duenio, alta)).toBeNull();
    expect(await probar(duenio, sentenciaDeOpcionDeEntrada({ entradaId: alta.id, opcionId: opcionAjena.id }, propia))).toEqual({ codigo: "23503", restriccion: "OpcionDeEntradaDeCupo_empresaId_opcionId_fkey" });
    // Y un cupo de esta empresa no se puede usar desde la otra.
    expect(await probar(duenio, entrada({ empresaId: ajeno.sucursal.empresaId, productoId: ajeno.producto.id }))).toEqual({ codigo: "23503", restriccion: "EntradaDeCupo_empresaId_cupoId_fkey" });
  });

  it("un cupo, un producto, una opción o una sucursal con entradas o platos del día no se pueden borrar (RESTRICT), ni como dueño", async () => {
    const duenio = await conexionDelDuenio();
    const propia = { empresaId: EMPRESA_DE_PRUEBA_ID };
    const alta = entrada(propia);
    expect(await probar(duenio, alta)).toBeNull();
    expect(await probar(duenio, sentenciaDeOpcionDeEntrada({ entradaId: alta.id, opcionId: e.medianoId }, propia))).toBeNull();
    expect(await probar(duenio, plato(propia))).toBeNull();
    for (const [tabla, id] of [["PromoCartaCupo", e.cupoListaId], ["PromoCartaCupo", e.cupoDelDiaId], ["Producto", e.cafeId], ["Producto", e.milanesaId], ["OpcionDeGrupo", e.medianoId], ["Sucursal", e.sucursalA], ["EntradaDeCupo", alta.id]] as const) {
      expect(await intentar(duenio, `DELETE FROM "${tabla}" WHERE "id" = $1`, [id]), `${tabla} ${id}`).toMatchObject({ codigo: "23503" });
    }
  });
});

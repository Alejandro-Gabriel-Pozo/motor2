import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { componerPrecioDeLinea } from "../../src/core/opciones/componer-precio-de-linea";
import {
  CANTIDAD_MAXIMA_DE_OPCION,
  EFECTOS_DE_CONSUMO_DE_OPCION,
  FACTOR_DE_ESCALA_MAXIMO,
  IMPORTE_MINIMO,
  MODOS_DE_PRECIO_DE_MEDIDA,
  TIPOS_DE_DIFERENCIA,
  TIPOS_DE_GRUPO_DE_OPCIONES,
} from "../../src/core/opciones/tipos";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, conexionDelDuenio, intentar } from "../setup/gasto";
import {
  sembrarEscenarioDeOpciones,
  sentenciaDeAdmiteGrupo,
  sentenciaDeAdmiteOpcion,
  sentenciaDeConsumo,
  sentenciaDeGrupo,
  sentenciaDeOpcion,
  sentenciaDeVersionDeOpcion,
  type EscenarioDeOpciones,
} from "../setup/opciones";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * GO-1b — migración 20261020110000_go1b_grupos_y_opciones: el CATÁLOGO de los grupos de opciones de venta (el «elemento configurable»), seis tablas DE EMPRESA, contra la base real.
 *
 * Qué se mide: la estructura exacta (columnas con el tipo EXACTO del dinero —`numeric(14,2)`, `(7,4)`, `(8,4)`, nunca float—, índices incluidos los parciales y los de `lower`, claves foráneas, CHECK validados, RLS sin FORCE con una sola
 * política, privilegios de tabla y por columna); la PARIDAD con `core` (cada lista cerrada de un CHECK es exactamente la de `src/core/opciones/tipos.ts`, los topes son los mismos y en los bordes del porcentaje la base y `componerPrecioDeLinea`
 * dicen lo mismo); las reglas (cada CHECK en su borde, los únicos, la «ninguna» única, el ancla única, el reemplazo único por insumo); que las versiones y los consumos SOLO se agregan y que la app no cambia lo inmutable ni borra nada; el aislamiento entre
 * empresas (una clave foránea hacia otra empresa da 23503 aun como dueño); y que la versión vigente sale de la de número mayor.
 * Las tablas por sucursal las mide `migracion-opciones-por-sucursal`; la línea con opciones y la foto, `migracion-linea-con-opciones`; la concurrencia, `opciones-concurrencia`; el dinero, `opciones-dinero`.
 *
 * Mutaciones demostradas (ver las filas O.320 a O.328 de docs/pureza-integracion.md): `GRANT UPDATE` sobre `VersionDeOpcion`, cambiar -100 por -101 en `_porcentaje_chk`, sacar un `ENABLE ROW LEVEL SECURITY`.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261020110000_go1b_grupos_y_opciones");
const TABLAS = ["GrupoDeOpciones", "OpcionDeGrupo", "VersionDeOpcion", "ConsumoDeOpcion", "ProductoAdmiteGrupo", "ProductoAdmiteOpcion"] as const;
const LISTA_DE_TABLAS = TABLAS.map((t) => `'"${t}"'::regclass`).join(", ");

let e: EscenarioDeOpciones;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeOpciones();
});
afterEach(cerrarConexiones);

const cuantos = async (tabla: string, filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);
/** Corre una sentencia armada con las ayudas de `test/setup/opciones.ts` en su propia transacción: `null` si anduvo, o el SQLSTATE y la restricción con que se rechazó. */
const probar = (c: Parameters<typeof intentar>[0], s: { texto: string; params: unknown[] }) => intentar(c, s.texto, s.params);
const rechazo = (restriccion: string, codigo = "23514") => ({ codigo, restriccion });
/** Los valores entre comillas de la definición de un CHECK de lista cerrada, ordenados. */
const valoresDe = async (restriccion: string) => {
  const r = await prismaAdmin.$queryRaw<Array<{ definicion: string }>>`SELECT pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conname = ${restriccion}`;
  return [...r[0]!.definicion.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]!).sort();
};
const definicionDe = async (restriccion: string) => (await prismaAdmin.$queryRaw<Array<{ definicion: string }>>`SELECT pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conname = ${restriccion}`)[0]!.definicion;

describe("la migración deja las tablas, los índices, las claves foráneas, las reglas, la RLS y los privilegios puestos", () => {
  it("tiene las columnas esperadas de las seis tablas, con su tipo EXACTO y su nulabilidad; ningún float en ninguna", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string; tipo: string; es_nulable: string; por_defecto: string | null }>>`
      SELECT table_name::text AS tabla, column_name::text AS columna,
             CASE WHEN data_type = 'numeric' THEN 'numeric(' || numeric_precision || ',' || numeric_scale || ')' ELSE data_type END AS tipo,
             is_nullable AS es_nulable, column_default AS por_defecto
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('GrupoDeOpciones', 'OpcionDeGrupo', 'VersionDeOpcion', 'ConsumoDeOpcion', 'ProductoAdmiteGrupo', 'ProductoAdmiteOpcion') ORDER BY table_name, ordinal_position`;
    const de = (tabla: string) => columnas.filter((c) => c.tabla === tabla);
    const forma = (tabla: string) => de(tabla).map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`);
    const T = "timestamp without time zone";
    expect(forma("GrupoDeOpciones")).toEqual([
      "id:text:NO", "empresaId:text:NO", "nombre:text:NO", "tipo:text:NO", "cantidadMinima:integer:NO", "cantidadMaxima:integer:NO", "activo:boolean:NO", "version:integer:NO", `creadoEn:${T}:NO`, `actualizadoEn:${T}:NO`,
      // Fase 4 de la ola «precio y carta» (ADR-035): «se lee en la carta como», nulable.
      "prefijoEnCarta:text:YES",
    ]);
    expect(forma("OpcionDeGrupo")).toEqual([
      "id:text:NO", "empresaId:text:NO", "grupoId:text:NO", "nombre:text:NO", "orden:integer:NO", "activa:boolean:NO", "esNinguna:boolean:NO", "productoId:text:YES", "version:integer:NO", `creadoEn:${T}:NO`, `actualizadoEn:${T}:NO`,
    ]);
    expect(forma("VersionDeOpcion")).toEqual([
      "id:text:NO", "empresaId:text:NO", "opcionId:text:NO", "numero:integer:NO", "tipoDeDiferencia:text:NO", "diferenciaPrecio:numeric(14,2):YES", "porcentaje:numeric(7,4):YES", "factorEscala:numeric(8,4):YES", "creadoPorId:text:NO", `creadoEn:${T}:NO`,
    ]);
    expect(forma("ConsumoDeOpcion")).toEqual([
      "id:text:NO", "empresaId:text:NO", "versionDeOpcionId:text:NO", "efecto:text:NO", "insumoProductoId:text:NO", "reemplazaAProductoId:text:YES", "cantidad:numeric(14,4):NO", "unidadId:text:NO", "mermaPorcentaje:numeric(6,2):NO", "escalaConLaMedida:boolean:NO", "orden:integer:NO",
    ]);
    expect(forma("ProductoAdmiteGrupo")).toEqual([
      "id:text:NO", "empresaId:text:NO", "productoId:text:NO", "grupoId:text:NO", "orden:integer:NO", "cantidadMinima:integer:YES", "cantidadMaxima:integer:YES", "modoPrecio:text:YES", "activo:boolean:NO", "version:integer:NO", `creadoEn:${T}:NO`, `actualizadoEn:${T}:NO`,
      // GO-3a (ADR-032): el eje de las combinaciones del producto, nulable.
      "ejeDeCombinacion:smallint:YES",
    ]);
    expect(forma("ProductoAdmiteOpcion")).toEqual([
      "id:text:NO", "empresaId:text:NO", "productoId:text:NO", "opcionId:text:NO", "cantidadMaxima:integer:NO", "precioAbsoluto:numeric(14,2):YES", "tipoDeDiferencia:text:YES", "diferenciaPrecio:numeric(14,2):YES", "porcentaje:numeric(7,4):YES",
      "activo:boolean:NO", "version:integer:NO", `creadoEn:${T}:NO`, `actualizadoEn:${T}:NO`,
    ]);
    expect(columnas.filter((c) => /double|real|money/.test(c.tipo)), "ningún importe, porcentaje ni factor es float").toEqual([]);
    for (const tabla of TABLAS) expect(de(tabla).find((c) => c.columna === "empresaId")!.por_defecto, tabla).toMatch(/app_empresa_actual\(\)/);
    expect(de("GrupoDeOpciones").find((c) => c.columna === "cantidadMaxima")!.por_defecto).toBe("1");
    expect(de("GrupoDeOpciones").find((c) => c.columna === "cantidadMinima")!.por_defecto).toBe("0");
    expect(de("VersionDeOpcion").find((c) => c.columna === "tipoDeDiferencia")!.por_defecto, "`tipoDeDiferencia` se elige siempre, sin valor por defecto").toBeNull();
    expect(de("ConsumoDeOpcion").find((c) => c.columna === "mermaPorcentaje")!.por_defecto).toBe("0");
    for (const tabla of ["GrupoDeOpciones", "OpcionDeGrupo", "ProductoAdmiteGrupo", "ProductoAdmiteOpcion"]) expect(de(tabla).find((c) => c.columna === "version")!.por_defecto, tabla).toBe("1");
  });

  it("los índices únicos, parciales y de consulta son los esperados; los de nombre son sobre lower() y los dos parciales llevan su condición", async () => {
    const indices = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; unico: boolean; definicion: string }>>`
      SELECT c.relname::text AS tabla, ic.relname::text AS nombre, i.indisunique AS unico, pg_get_indexdef(i.indexrelid) AS definicion
        FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
       WHERE c.relname IN ('GrupoDeOpciones', 'OpcionDeGrupo', 'VersionDeOpcion', 'ConsumoDeOpcion', 'ProductoAdmiteGrupo', 'ProductoAdmiteOpcion') AND NOT i.indisprimary ORDER BY 1, 2`;
    expect(indices.map((i) => `${i.tabla}|${i.nombre}|${i.unico}`)).toEqual([
      "ConsumoDeOpcion|ConsumoDeOpcion_empresaId_id_key|true",
      "ConsumoDeOpcion|ConsumoDeOpcion_insumoProductoId_idx|false",
      "ConsumoDeOpcion|ConsumoDeOpcion_un_reemplazo_por_insumo_key|true",
      "ConsumoDeOpcion|ConsumoDeOpcion_versionDeOpcionId_orden_key|true",
      "GrupoDeOpciones|GrupoDeOpciones_empresaId_id_key|true",
      "GrupoDeOpciones|GrupoDeOpciones_empresaId_nombre_key|true",
      "GrupoDeOpciones|GrupoDeOpciones_nombre_lower_key|true",
      "OpcionDeGrupo|OpcionDeGrupo_empresaId_id_key|true",
      "OpcionDeGrupo|OpcionDeGrupo_empresaId_productoId_key|true",
      "OpcionDeGrupo|OpcionDeGrupo_grupoId_nombre_key|true",
      "OpcionDeGrupo|OpcionDeGrupo_nombre_lower_key|true",
      "OpcionDeGrupo|OpcionDeGrupo_una_ninguna_por_grupo_key|true",
      "ProductoAdmiteGrupo|ProductoAdmiteGrupo_empresaId_id_key|true",
      "ProductoAdmiteGrupo|ProductoAdmiteGrupo_grupoId_idx|false",
      "ProductoAdmiteGrupo|ProductoAdmiteGrupo_productoId_grupoId_key|true",
      "ProductoAdmiteGrupo|ProductoAdmiteGrupo_un_grupo_por_eje_key|true", // GO-3a (ADR-032): un grupo por eje de combinación (parcial; lo mide migracion-go3a)
      "ProductoAdmiteOpcion|ProductoAdmiteOpcion_empresaId_id_key|true",
      "ProductoAdmiteOpcion|ProductoAdmiteOpcion_opcionId_idx|false",
      "ProductoAdmiteOpcion|ProductoAdmiteOpcion_productoId_opcionId_key|true",
      "VersionDeOpcion|VersionDeOpcion_creadoPorId_idx|false",
      "VersionDeOpcion|VersionDeOpcion_empresaId_id_key|true",
      "VersionDeOpcion|VersionDeOpcion_opcionId_numero_key|true",
    ]);
    const definicion = (n: string) => indices.find((i) => i.nombre === n)!.definicion;
    expect(definicion("GrupoDeOpciones_nombre_lower_key")).toMatch(/\("empresaId", lower\(nombre\)\)/);
    expect(definicion("OpcionDeGrupo_nombre_lower_key")).toMatch(/\("grupoId", lower\(nombre\)\)/);
    expect(definicion("OpcionDeGrupo_una_ninguna_por_grupo_key")).toMatch(/\("grupoId"\) WHERE "esNinguna"/);
    expect(definicion("ConsumoDeOpcion_un_reemplazo_por_insumo_key")).toMatch(/\("versionDeOpcionId", "reemplazaAProductoId"\) WHERE \("reemplazaAProductoId" IS NOT NULL\)/);
    expect(definicion("OpcionDeGrupo_empresaId_productoId_key"), "el ancla es única por empresa (los NULL no chocan)").toMatch(/\("empresaId", "productoId"\)/);
    expect(definicion("VersionDeOpcion_opcionId_numero_key"), "el árbitro de dos versiones a la vez").toMatch(/\("opcionId", numero\)/);
  });

  it("las claves foráneas son compuestas con empresaId (salvo la de la empresa y la del usuario), todas ON DELETE RESTRICT", async () => {
    const fks = await prismaAdmin.$queryRawUnsafe<Array<{ nombre: string; definicion: string }>>(
      `SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid IN (${LISTA_DE_TABLAS}) AND contype = 'f' ORDER BY 1`,
    );
    expect(fks.map((f) => f.nombre)).toEqual([
      "ConsumoDeOpcion_empresaId_fkey", "ConsumoDeOpcion_empresaId_insumoProductoId_fkey", "ConsumoDeOpcion_empresaId_reemplazaAProductoId_fkey", "ConsumoDeOpcion_empresaId_unidadId_fkey", "ConsumoDeOpcion_empresaId_versionDeOpcionId_fkey",
      "GrupoDeOpciones_empresaId_fkey",
      "OpcionDeGrupo_empresaId_fkey", "OpcionDeGrupo_empresaId_grupoId_fkey", "OpcionDeGrupo_empresaId_productoId_fkey",
      "ProductoAdmiteGrupo_empresaId_fkey", "ProductoAdmiteGrupo_empresaId_grupoId_fkey", "ProductoAdmiteGrupo_empresaId_productoId_fkey",
      "ProductoAdmiteOpcion_empresaId_fkey", "ProductoAdmiteOpcion_empresaId_opcionId_fkey", "ProductoAdmiteOpcion_empresaId_productoId_fkey",
      "VersionDeOpcion_creadoPorId_fkey", "VersionDeOpcion_empresaId_fkey", "VersionDeOpcion_empresaId_opcionId_fkey",
    ]);
    for (const f of fks) expect(f.definicion, f.nombre).toMatch(/ON DELETE RESTRICT/);
    const def = (n: string) => fks.find((f) => f.nombre === n)!.definicion;
    expect(def("OpcionDeGrupo_empresaId_grupoId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "grupoId"\) REFERENCES "GrupoDeOpciones"\("empresaId", id\)/);
    expect(def("OpcionDeGrupo_empresaId_productoId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "productoId"\) REFERENCES "Producto"\("empresaId", id\)/);
    expect(def("VersionDeOpcion_empresaId_opcionId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "opcionId"\) REFERENCES "OpcionDeGrupo"\("empresaId", id\)/);
    expect(def("VersionDeOpcion_creadoPorId_fkey")).toMatch(/FOREIGN KEY \("creadoPorId"\) REFERENCES "User"\(id\)/);
    expect(def("ConsumoDeOpcion_empresaId_versionDeOpcionId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "versionDeOpcionId"\) REFERENCES "VersionDeOpcion"\("empresaId", id\)/);
    expect(def("ConsumoDeOpcion_empresaId_reemplazaAProductoId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "reemplazaAProductoId"\) REFERENCES "Producto"\("empresaId", id\)/);
    expect(def("ConsumoDeOpcion_empresaId_unidadId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "unidadId"\) REFERENCES "Unidad"\("empresaId", id\)/);
    expect(def("ProductoAdmiteOpcion_empresaId_opcionId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "opcionId"\) REFERENCES "OpcionDeGrupo"\("empresaId", id\)/);
  });

  it("los CHECK están puestos y validados", async () => {
    const checks = await prismaAdmin.$queryRawUnsafe<Array<{ nombre: string; validada: boolean }>>(
      `SELECT conname::text AS nombre, convalidated AS validada FROM pg_constraint WHERE conrelid IN (${LISTA_DE_TABLAS}) AND contype = 'c' ORDER BY 1`,
    );
    expect(checks.every((c) => c.validada)).toBe(true);
    expect(checks.map((c) => c.nombre)).toEqual([
      "ConsumoDeOpcion_cantidad_chk", "ConsumoDeOpcion_efecto_chk", "ConsumoDeOpcion_merma_chk", "ConsumoDeOpcion_orden_chk", "ConsumoDeOpcion_reemplazo_chk",
      "GrupoDeOpciones_cantidades_chk", "GrupoDeOpciones_incluida_chk", "GrupoDeOpciones_medida_chk", "GrupoDeOpciones_nombre_chk", "GrupoDeOpciones_prefijo_en_carta_chk" /* Fase 4 */, "GrupoDeOpciones_tipo_chk", "GrupoDeOpciones_version_chk",
      "OpcionDeGrupo_nombre_chk", "OpcionDeGrupo_ninguna_sin_producto_chk", "OpcionDeGrupo_orden_chk", "OpcionDeGrupo_version_chk",
      "ProductoAdmiteGrupo_cantidades_chk", "ProductoAdmiteGrupo_eje_de_combinacion_chk" /* GO-3a */, "ProductoAdmiteGrupo_modo_precio_chk", "ProductoAdmiteGrupo_orden_chk", "ProductoAdmiteGrupo_version_chk",
      "ProductoAdmiteOpcion_absoluto_o_diferencia_chk", "ProductoAdmiteOpcion_cantidad_maxima_chk", "ProductoAdmiteOpcion_diferencia_chk", "ProductoAdmiteOpcion_porcentaje_chk", "ProductoAdmiteOpcion_precio_absoluto_chk", "ProductoAdmiteOpcion_tipo_de_diferencia_chk", "ProductoAdmiteOpcion_version_chk",
      "VersionDeOpcion_diferencia_chk", "VersionDeOpcion_factor_chk", "VersionDeOpcion_numero_chk", "VersionDeOpcion_porcentaje_chk", "VersionDeOpcion_tipo_de_diferencia_chk",
    ].sort());
  });

  it("la RLS por empresa está puesta en las seis, sin FORCE, con UNA sola política `aislamiento_empresa` cada una (son de empresa: sin políticas de sucursal)", async () => {
    const rls = await prismaAdmin.$queryRawUnsafe<Array<{ tabla: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
      `SELECT relname::text AS tabla, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid IN (${LISTA_DE_TABLAS}) ORDER BY 1`,
    );
    expect(rls).toEqual([...TABLAS].sort().map((tabla) => ({ tabla, relrowsecurity: true, relforcerowsecurity: false })));
    const politicas = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; qual: string; with_check: string }>>`
      SELECT tablename::text AS tabla, policyname::text AS nombre, qual, with_check FROM pg_policies
       WHERE tablename IN ('GrupoDeOpciones', 'OpcionDeGrupo', 'VersionDeOpcion', 'ConsumoDeOpcion', 'ProductoAdmiteGrupo', 'ProductoAdmiteOpcion') ORDER BY 1, 2`;
    expect(politicas.map((p) => `${p.tabla}|${p.nombre}`)).toEqual([...TABLAS].sort().map((t) => `${t}|aislamiento_empresa`));
    expect(politicas.every((p) => /app_empresa_actual/.test(p.qual) && /app_empresa_actual/.test(p.with_check))).toBe(true);
  });

  it("privilegios EXACTOS: motor2_app tiene SELECT e INSERT en las seis, ningún DELETE y UPDATE solo de las columnas listadas (`tipo`, `grupoId`, `productoId` y `esNinguna` inmutables; versiones y consumos, ninguna); motor2_plataforma, nada", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ tabla: string; rol: string; privilegio: string }>>`
      SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name IN ('GrupoDeOpciones', 'OpcionDeGrupo', 'VersionDeOpcion', 'ConsumoDeOpcion', 'ProductoAdmiteGrupo', 'ProductoAdmiteOpcion') AND grantee IN ('motor2_app', 'motor2_plataforma')`;
    expect(filas.map((f) => `${f.tabla}|${f.rol}|${f.privilegio}`).sort()).toEqual(TABLAS.flatMap((t) => ["INSERT", "SELECT"].map((p) => `${t}|motor2_app|${p}`)).sort());
    const actualizables = async (tabla: string) =>
      (await prismaAdmin.$queryRawUnsafe<Array<{ columna: string }>>(
        `SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"${tabla}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`,
      )).map((c) => c.columna);
    // La Fase 4 de la ola «precio y carta» (ADR-035) suma `prefijoEnCarta` («se lee en la carta como», editable).
    expect(await actualizables("GrupoDeOpciones")).toEqual(["activo", "actualizadoEn", "cantidadMaxima", "cantidadMinima", "nombre", "prefijoEnCarta", "version"]);
    expect(await actualizables("OpcionDeGrupo")).toEqual(["activa", "actualizadoEn", "nombre", "orden", "version"]);
    // GO-3a (ADR-032) suma `ejeDeCombinacion` (el eje de las combinaciones, editable).
    expect(await actualizables("ProductoAdmiteGrupo")).toEqual(["activo", "actualizadoEn", "cantidadMaxima", "cantidadMinima", "ejeDeCombinacion", "modoPrecio", "orden", "version"]);
    expect(await actualizables("ProductoAdmiteOpcion")).toEqual(["activo", "actualizadoEn", "cantidadMaxima", "diferenciaPrecio", "porcentaje", "precioAbsoluto", "tipoDeDiferencia", "version"]);
    expect(await actualizables("VersionDeOpcion")).toEqual([]);
    expect(await actualizables("ConsumoDeOpcion")).toEqual([]);
    for (const t of TABLAS) {
      const r = await prismaAdmin.$queryRawUnsafe<Array<{ tiene: boolean }>>(`SELECT has_table_privilege('motor2_plataforma', '"${t}"', 'SELECT') AS tiene`);
      expect(r[0]!.tiene, `motor2_plataforma no ve ${t}`).toBe(false);
    }
  });

  it("el migration.sql y el down.sql avisan que requieren autorización y que la reversa aborta con filas, y no se disfrazan de migración de políticas de sucursal", () => {
    const subida = readFileSync(join(CARPETA, "migration.sql"), "utf8");
    expect(subida.split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    const reversa = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(reversa).toMatch(/ABORTA/);
    for (const t of TABLAS) expect(reversa).toContain(`DROP TABLE IF EXISTS "${t}"`);
    for (const sql of [subida, reversa]) {
      expect(sql).not.toContain("alcance_sucursal_");
      expect(sql).not.toContain("app_sucursales_");
    }
  });
});

describe("paridad con el núcleo (`src/core/opciones`): las listas cerradas y los topes de la base son los del código", () => {
  it("el CHECK de cada lista cerrada contiene EXACTAMENTE los valores de su lista de `tipos.ts`", async () => {
    expect(await valoresDe("GrupoDeOpciones_tipo_chk")).toEqual([...TIPOS_DE_GRUPO_DE_OPCIONES].sort());
    expect(await valoresDe("ConsumoDeOpcion_efecto_chk")).toEqual([...EFECTOS_DE_CONSUMO_DE_OPCION].sort());
    expect(await valoresDe("ProductoAdmiteGrupo_modo_precio_chk")).toEqual([...MODOS_DE_PRECIO_DE_MEDIDA].sort());
    expect(await valoresDe("VersionDeOpcion_tipo_de_diferencia_chk")).toEqual([...TIPOS_DE_DIFERENCIA].sort());
    expect(await valoresDe("ProductoAdmiteOpcion_tipo_de_diferencia_chk")).toEqual([...TIPOS_DE_DIFERENCIA].sort());
  });

  it("los topes (10 de cantidad, 10 de factor, 0,01 de importe) son los mismos que las constantes del núcleo", async () => {
    expect(await definicionDe("GrupoDeOpciones_cantidades_chk")).toContain(`"cantidadMaxima" <= ${CANTIDAD_MAXIMA_DE_OPCION}`);
    expect(await definicionDe("ProductoAdmiteGrupo_cantidades_chk")).toContain(`"cantidadMaxima" <= ${CANTIDAD_MAXIMA_DE_OPCION}`);
    expect(await definicionDe("ProductoAdmiteGrupo_cantidades_chk")).toContain(`"cantidadMinima" <= ${CANTIDAD_MAXIMA_DE_OPCION}`);
    expect(await definicionDe("ProductoAdmiteOpcion_cantidad_maxima_chk")).toContain(`"cantidadMaxima" <= ${CANTIDAD_MAXIMA_DE_OPCION}`);
    expect(await definicionDe("VersionDeOpcion_factor_chk")).toContain(`"factorEscala" <= (${FACTOR_DE_ESCALA_MAXIMO})::numeric`);
    expect(await definicionDe("ProductoAdmiteOpcion_precio_absoluto_chk")).toContain(`"precioAbsoluto" >= ${IMPORTE_MINIMO}`);
  });

  it("en los bordes del porcentaje la base y `componerPrecioDeLinea` dicen lo mismo: -100 se rechaza, -99,9999 entra, 999,9999 entra y 1000 se rechaza (en la base, 22003)", async () => {
    const app = await conexionComoApp();
    const casos: Array<[number, boolean]> = [[-100, false], [-99.9999, true], [999.9999, true], [1000, false]];
    let numero = 10;
    for (const [porcentaje, entra] of casos) {
      const enNucleo = componerPrecioDeLinea({
        precioBase: 100000,
        cantidad: 1,
        opciones: [{ opcionId: "o", versionDeOpcionId: "v", nombre: "X", tipo: "VARIANTE", cantidad: 1, factorEscala: null, modoPrecio: null, precioAbsoluto: null, diferencia: { tipo: "PORCENTAJE", porcentaje } }],
      });
      expect(enNucleo.ok, `núcleo ${porcentaje}`).toBe(entra);
      const enVersion = await probar(app, sentenciaDeVersionDeOpcion({ opcionId: e.chicoId, usuarioId: e.usuarioId }, { numero: numero++, tipoDeDiferencia: "PORCENTAJE", diferenciaPrecio: null, porcentaje: String(porcentaje) }));
      const enProducto = await probar(app, sentenciaDeAdmiteOpcion({ productoId: e.anclaDelShotId, opcionId: e.azucarId }, { tipoDeDiferencia: "PORCENTAJE", porcentaje: String(porcentaje) }));
      if (entra) {
        expect(enVersion, `versión ${porcentaje}`).toBeNull();
        expect(enProducto, `producto ${porcentaje}`).toBeNull();
        await prismaAdmin.productoAdmiteOpcion.deleteMany({ where: { productoId: e.anclaDelShotId, opcionId: e.azucarId } });
      } else if (porcentaje === 1000) {
        expect(enVersion, `versión ${porcentaje}`).toMatchObject({ codigo: "22003" });
        expect(enProducto, `producto ${porcentaje}`).toMatchObject({ codigo: "22003" });
      } else {
        expect(enVersion, `versión ${porcentaje}`).toEqual(rechazo("VersionDeOpcion_porcentaje_chk"));
        expect(enProducto, `producto ${porcentaje}`).toEqual(rechazo("ProductoAdmiteOpcion_porcentaje_chk"));
      }
    }
  });
});

describe("las reglas del catálogo, cada CHECK en su borde", () => {
  it("GrupoDeOpciones: cantidades (mínima 0 a máxima, máxima 1 a 10), MEDIDA exactamente una, INCLUIDA con mínimo 1, tipo cerrado y versión desde 1", async () => {
    const app = await conexionComoApp();
    const grupo = (extra: Record<string, unknown>) => sentenciaDeGrupo(extra);
    for (const [min, max] of [[-1, 1], [2, 1], [0, 0], [0, 11], [11, 11]]) {
      expect(await probar(app, grupo({ cantidadMinima: min, cantidadMaxima: max })), `${min} a ${max}`).toEqual(rechazo("GrupoDeOpciones_cantidades_chk"));
    }
    expect(await probar(app, grupo({ cantidadMinima: 0, cantidadMaxima: 10 }))).toBeNull();
    for (const [min, max] of [[0, 1], [1, 2], [2, 2]]) {
      expect(await probar(app, grupo({ tipo: "MEDIDA", cantidadMinima: min, cantidadMaxima: max })), `MEDIDA ${min} a ${max}`).toEqual(rechazo("GrupoDeOpciones_medida_chk"));
    }
    expect(await probar(app, grupo({ tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 }))).toBeNull();
    expect(await probar(app, grupo({ tipo: "INCLUIDA", cantidadMinima: 0, cantidadMaxima: 2 }))).toEqual(rechazo("GrupoDeOpciones_incluida_chk"));
    expect(await probar(app, grupo({ tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 2 }))).toBeNull();
    expect(await probar(app, grupo({ tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 3 }))).toBeNull();
    expect(await probar(app, grupo({ tipo: "OTRO" }))).toEqual(rechazo("GrupoDeOpciones_tipo_chk"));
    expect(await probar(app, grupo({ tipo: "medida" })), "las listas son en mayúsculas").toEqual(rechazo("GrupoDeOpciones_tipo_chk"));
    expect(await probar(app, grupo({ version: 0 }))).toEqual(rechazo("GrupoDeOpciones_version_chk"));
    expect(await probar(app, grupo({ tipo: null }))).toMatchObject({ codigo: "23502" });
  });

  it("el nombre de un grupo y de una opción exige un carácter visible (también rechaza el tabulador) y hasta 80; el mismo nombre con otras mayúsculas es un duplicado (23505)", async () => {
    const app = await conexionComoApp();
    for (const malo of ["", "   ", "\t", "\t\n", "x".repeat(81)]) {
      expect(await probar(app, sentenciaDeGrupo({ nombre: malo })), `grupo ${malo.length}`).toEqual(rechazo("GrupoDeOpciones_nombre_chk"));
      expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoVarianteId }, { nombre: malo })), `opción ${malo.length}`).toEqual(rechazo("OpcionDeGrupo_nombre_chk"));
    }
    expect(await probar(app, sentenciaDeGrupo({ nombre: "x".repeat(80) }))).toBeNull();
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoVarianteId }, { nombre: "y".repeat(80) }))).toBeNull();
    expect(await probar(app, sentenciaDeGrupo({ nombre: "TAMAÑO" })), "mismas letras, otras mayúsculas").toEqual({ codigo: "23505", restriccion: "GrupoDeOpciones_nombre_lower_key" });
    expect(await probar(app, sentenciaDeGrupo({ nombre: "Tamaño" }))).toEqual({ codigo: "23505", restriccion: "GrupoDeOpciones_empresaId_nombre_key" });
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoMedidaId }, { nombre: "GRANDE" }))).toEqual({ codigo: "23505", restriccion: "OpcionDeGrupo_nombre_lower_key" });
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoMedidaId }, { nombre: "Grande" }))).toEqual({ codigo: "23505", restriccion: "OpcionDeGrupo_grupoId_nombre_key" });
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoVarianteId }, { nombre: "Grande" })), "el mismo nombre en OTRO grupo sí entra").toBeNull();
  });

  it("OpcionDeGrupo: la «ninguna» no lleva producto, un grupo tiene a lo sumo UNA, un producto ancla respalda a una sola opción, y orden y versión no son negativos", async () => {
    const app = await conexionComoApp();
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoVarianteId }, { esNinguna: true, productoId: e.cafeId }))).toEqual(rechazo("OpcionDeGrupo_ninguna_sin_producto_chk"));
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoVarianteId }, { esNinguna: true, nombre: "Ninguna" }))).toBeNull();
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoVarianteId }, { esNinguna: true, nombre: "Sin nada" })), "una segunda «ninguna» en el mismo grupo").toEqual({ codigo: "23505", restriccion: "OpcionDeGrupo_una_ninguna_por_grupo_key" });
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoIncluidaId }, { esNinguna: true, nombre: "Ninguna" })), "en OTRO grupo sí").toBeNull();
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoAdicionalId }, { productoId: e.anclaDelShotId }))).toEqual({ codigo: "23505", restriccion: "OpcionDeGrupo_empresaId_productoId_key" });
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoAdicionalId }))).toBeNull();
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoAdicionalId }))).toBeNull(); // dos sin ancla no chocan
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoVarianteId }, { orden: -1 }))).toEqual(rechazo("OpcionDeGrupo_orden_chk"));
    expect(await probar(app, sentenciaDeOpcion({ grupoId: e.grupoVarianteId }, { version: 0 }))).toEqual(rechazo("OpcionDeGrupo_version_chk"));
  });

  it("VersionDeOpcion: número desde 1 y único por opción, tipo de diferencia cerrado, exactamente UNA de monto o porcentaje según el tipo, y el factor mayor que 0 y hasta 10", async () => {
    const app = await conexionComoApp();
    const v = (extra: Record<string, unknown>) => sentenciaDeVersionDeOpcion({ opcionId: e.vacaId, usuarioId: e.usuarioId }, { numero: 2, ...extra });
    expect(await probar(app, v({ numero: 0 }))).toEqual(rechazo("VersionDeOpcion_numero_chk"));
    expect(await probar(app, v({ numero: 1 })), "la versión 1 de la opción ya existe").toEqual({ codigo: "23505", restriccion: "VersionDeOpcion_opcionId_numero_key" });
    // Un tipo fuera de la lista rompe a la vez `_diferencia_chk` y `_tipo_de_diferencia_chk`; Postgres informa el primero por nombre.
    expect(await probar(app, v({ tipoDeDiferencia: "OTRO" }))).toEqual(rechazo("VersionDeOpcion_diferencia_chk"));
    expect(await probar(app, v({ tipoDeDiferencia: null }))).toMatchObject({ codigo: "23502" });
    expect(await probar(app, v({ diferenciaPrecio: null }))).toEqual(rechazo("VersionDeOpcion_diferencia_chk"));
    expect(await probar(app, v({ porcentaje: "5.0000" })), "MONTO con porcentaje").toEqual(rechazo("VersionDeOpcion_diferencia_chk"));
    expect(await probar(app, v({ tipoDeDiferencia: "PORCENTAJE", diferenciaPrecio: null, porcentaje: null }))).toEqual(rechazo("VersionDeOpcion_diferencia_chk"));
    expect(await probar(app, v({ tipoDeDiferencia: "PORCENTAJE", porcentaje: "5.0000" })), "PORCENTAJE con monto").toEqual(rechazo("VersionDeOpcion_diferencia_chk"));
    for (const malo of ["0", "-1", "10.0001"]) expect(await probar(app, v({ numero: 2, factorEscala: malo })), `factor ${malo}`).toEqual(rechazo("VersionDeOpcion_factor_chk"));
    expect(await probar(app, v({ numero: 2, factorEscala: "10.0000", diferenciaPrecio: "-25.50" })), "el monto puede ser negativo y el factor llegar a 10").toBeNull();
    expect(await probar(app, v({ numero: 3, tipoDeDiferencia: "PORCENTAJE", diferenciaPrecio: null, porcentaje: "-99.5000" }))).toBeNull();
    expect(await probar(app, v({ numero: 4, creadoPorId: "no-existe" }))).toEqual(rechazo("VersionDeOpcion_creadoPorId_fkey", "23503"));
  });

  it("ConsumoDeOpcion: efecto cerrado, REEMPLAZA exige el producto que reemplaza y SUMA lo prohíbe, cantidad mayor que 0, merma de 0 a 100, un reemplazo por insumo y versión y un orden único", async () => {
    const app = await conexionComoApp();
    const base = { versionDeOpcionId: e.versionDe[e.vacaId]!, insumoProductoId: e.lecheId, unidadId: e.unidadId };
    const c = (extra: Record<string, unknown>) => sentenciaDeConsumo(base, extra);
    expect(await probar(app, c({ efecto: "OTRO" }))).toEqual(rechazo("ConsumoDeOpcion_efecto_chk"));
    expect(await probar(app, c({ efecto: "SUMA", reemplazaAProductoId: e.almendrasInsumoId }))).toEqual(rechazo("ConsumoDeOpcion_reemplazo_chk"));
    expect(await probar(app, c({ efecto: "REEMPLAZA" }))).toEqual(rechazo("ConsumoDeOpcion_reemplazo_chk"));
    expect(await probar(app, c({ cantidad: "0.0000" }))).toEqual(rechazo("ConsumoDeOpcion_cantidad_chk"));
    expect(await probar(app, c({ cantidad: "-1.0000" }))).toEqual(rechazo("ConsumoDeOpcion_cantidad_chk"));
    for (const malo of ["-0.01", "100.01"]) expect(await probar(app, c({ orden: 5, mermaPorcentaje: malo })), `merma ${malo}`).toEqual(rechazo("ConsumoDeOpcion_merma_chk"));
    expect(await probar(app, c({ orden: -1 }))).toEqual(rechazo("ConsumoDeOpcion_orden_chk"));
    expect(await probar(app, c({ orden: 0, mermaPorcentaje: "100.00" })), "100 de merma entra").toBeNull();
    expect(await probar(app, c({ orden: 0 })), "el mismo orden en la misma versión").toEqual({ codigo: "23505", restriccion: "ConsumoDeOpcion_versionDeOpcionId_orden_key" });
    expect(await probar(app, c({ orden: 1 })), "dos SUMA del mismo insumo no chocan").toBeNull();
    expect(await probar(app, c({ orden: 2, efecto: "REEMPLAZA", reemplazaAProductoId: e.almendrasInsumoId }))).toBeNull();
    expect(await probar(app, c({ orden: 3, efecto: "REEMPLAZA", reemplazaAProductoId: e.almendrasInsumoId })), "dos reemplazos del MISMO ingrediente en la misma versión").toEqual({
      codigo: "23505",
      restriccion: "ConsumoDeOpcion_un_reemplazo_por_insumo_key",
    });
    expect(await probar(app, sentenciaDeConsumo({ ...base, versionDeOpcionId: e.versionDe[e.almendrasId]! }, { orden: 9, efecto: "REEMPLAZA", reemplazaAProductoId: e.almendrasInsumoId })), "el mismo reemplazo en OTRA versión sí").toBeNull();
  });

  it("ProductoAdmiteGrupo y ProductoAdmiteOpcion: límites propios, modo de precio, precio absoluto desde 0,01, diferencia coherente, absoluto o diferencia (nunca los dos) y una fila por par", async () => {
    const app = await conexionComoApp();
    const g = (extra: Record<string, unknown>) => sentenciaDeAdmiteGrupo({ productoId: e.anclaDelShotId, grupoId: e.grupoVarianteId }, extra);
    for (const [min, max] of [[-1, null], [11, null], [null, 0], [null, 11], [3, 2]]) {
      expect(await probar(app, g({ cantidadMinima: min, cantidadMaxima: max })), `${min} a ${max}`).toEqual(rechazo("ProductoAdmiteGrupo_cantidades_chk"));
    }
    expect(await probar(app, g({ modoPrecio: "OTRO" }))).toEqual(rechazo("ProductoAdmiteGrupo_modo_precio_chk"));
    expect(await probar(app, g({ orden: -1 }))).toEqual(rechazo("ProductoAdmiteGrupo_orden_chk"));
    expect(await probar(app, g({ version: 0 }))).toEqual(rechazo("ProductoAdmiteGrupo_version_chk"));
    expect(await probar(app, g({ cantidadMinima: 0, cantidadMaxima: 10, modoPrecio: "DIFERENCIA" }))).toBeNull();
    expect(await probar(app, g({}))).toEqual({ codigo: "23505", restriccion: "ProductoAdmiteGrupo_productoId_grupoId_key" });

    const o = (extra: Record<string, unknown>) => sentenciaDeAdmiteOpcion({ productoId: e.anclaDelShotId, opcionId: e.vacaId }, extra);
    for (const malo of [0, 11]) expect(await probar(app, o({ cantidadMaxima: malo })), `máxima ${malo}`).toEqual(rechazo("ProductoAdmiteOpcion_cantidad_maxima_chk"));
    expect(await probar(app, o({ precioAbsoluto: "0.00" }))).toEqual(rechazo("ProductoAdmiteOpcion_precio_absoluto_chk"));
    expect(await probar(app, o({ precioAbsoluto: "-5.00" }))).toEqual(rechazo("ProductoAdmiteOpcion_precio_absoluto_chk"));
    expect(await probar(app, o({ tipoDeDiferencia: "OTRO" })), "un tipo fuera de la lista rompe también `_diferencia_chk`, que Postgres informa primero").toEqual(rechazo("ProductoAdmiteOpcion_diferencia_chk"));
    expect(await probar(app, o({ tipoDeDiferencia: "MONTO" })), "MONTO sin monto").toEqual(rechazo("ProductoAdmiteOpcion_diferencia_chk"));
    expect(await probar(app, o({ diferenciaPrecio: "5.00" })), "monto sin tipo").toEqual(rechazo("ProductoAdmiteOpcion_diferencia_chk"));
    expect(await probar(app, o({ tipoDeDiferencia: "MONTO", diferenciaPrecio: "5.00", porcentaje: "1.0000" }))).toEqual(rechazo("ProductoAdmiteOpcion_diferencia_chk"));
    expect(await probar(app, o({ tipoDeDiferencia: "PORCENTAJE", diferenciaPrecio: "5.00", porcentaje: "1.0000" }))).toEqual(rechazo("ProductoAdmiteOpcion_diferencia_chk"));
    expect(await probar(app, o({ precioAbsoluto: "10.00", tipoDeDiferencia: "MONTO", diferenciaPrecio: "5.00" })), "un precio absoluto y una diferencia a la vez").toEqual(rechazo("ProductoAdmiteOpcion_absoluto_o_diferencia_chk"));
    expect(await probar(app, o({ version: 0 }))).toEqual(rechazo("ProductoAdmiteOpcion_version_chk"));
    expect(await probar(app, o({ precioAbsoluto: "0.01" }))).toBeNull();
    expect(await probar(app, o({}))).toEqual({ codigo: "23505", restriccion: "ProductoAdmiteOpcion_productoId_opcionId_key" });
  });
});

describe("solo se agrega: las versiones y los consumos no se modifican, y la app no cambia lo inmutable ni borra nada", () => {
  it("como motor2_app, UPDATE de cualquier columna de una versión o de un consumo da 42501", async () => {
    const app = await conexionComoApp();
    const versionId = e.versionDe[e.almendrasId]!;
    for (const [columna, valor] of [["diferenciaPrecio", "1.00"], ["porcentaje", "1.0000"], ["tipoDeDiferencia", "'PORCENTAJE'"], ["factorEscala", "2.0000"], ["numero", "9"], ["creadoPorId", "'otro'"]] as const) {
      expect(await intentar(app, `UPDATE "VersionDeOpcion" SET "${columna}" = ${valor} WHERE "id" = $1`, [versionId]), `VersionDeOpcion.${columna}`).toMatchObject({ codigo: "42501" });
    }
    const consumo = await prismaAdmin.consumoDeOpcion.findFirstOrThrow();
    for (const [columna, valor] of [["cantidad", "9.0000"], ["efecto", "'SUMA'"], ["mermaPorcentaje", "5.00"], ["orden", "7"], ["escalaConLaMedida", "true"]] as const) {
      expect(await intentar(app, `UPDATE "ConsumoDeOpcion" SET "${columna}" = ${valor} WHERE "id" = $1`, [consumo.id]), `ConsumoDeOpcion.${columna}`).toMatchObject({ codigo: "42501" });
    }
    expect((await prismaAdmin.versionDeOpcion.findUniqueOrThrow({ where: { id: versionId } })).diferenciaPrecio?.toFixed(2)).toBe("150.00");
  });

  it("como motor2_app, UPDATE de `tipo`, `grupoId`, `productoId`, `esNinguna` o `empresaId` da 42501; UPDATE de lo editable anda", async () => {
    const app = await conexionComoApp();
    const prohibidas: Array<[string, string, string, string]> = [
      ["GrupoDeOpciones", e.grupoVarianteId, "tipo", "'ADICIONAL'"],
      ["GrupoDeOpciones", e.grupoVarianteId, "empresaId", `'${EMPRESA_TESTIGO_ID}'`],
      ["GrupoDeOpciones", e.grupoVarianteId, "creadoEn", "now()"],
      ["OpcionDeGrupo", e.vacaId, "grupoId", `'${e.grupoMedidaId}'`],
      ["OpcionDeGrupo", e.vacaId, "productoId", `'${e.cafeId}'`],
      ["OpcionDeGrupo", e.vacaId, "esNinguna", "true"],
      ["ProductoAdmiteGrupo", (await prismaAdmin.productoAdmiteGrupo.findFirstOrThrow()).id, "grupoId", `'${e.grupoMedidaId}'`],
      ["ProductoAdmiteOpcion", (await prismaAdmin.productoAdmiteOpcion.findFirstOrThrow()).id, "opcionId", `'${e.chicoId}'`],
    ];
    for (const [tabla, id, columna, valor] of prohibidas) {
      expect(await intentar(app, `UPDATE "${tabla}" SET "${columna}" = ${valor} WHERE "id" = $1`, [id]), `${tabla}.${columna}`).toMatchObject({ codigo: "42501" });
    }
    expect(await intentar(app, `UPDATE "GrupoDeOpciones" SET "nombre" = 'Leche o bebida', "cantidadMaxima" = 2, "activo" = false, "version" = "version" + 1, "actualizadoEn" = now() WHERE "id" = $1`, [e.grupoVarianteId])).toBeNull();
    expect(await intentar(app, `UPDATE "OpcionDeGrupo" SET "nombre" = 'Vaca', "orden" = 5, "activa" = false, "version" = "version" + 1, "actualizadoEn" = now() WHERE "id" = $1`, [e.vacaId])).toBeNull();
    const grupo = await prismaAdmin.grupoDeOpciones.findUniqueOrThrow({ where: { id: e.grupoVarianteId } });
    expect([grupo.nombre, grupo.tipo, grupo.cantidadMaxima, grupo.activo, grupo.version]).toEqual(["Leche o bebida", "VARIANTE", 2, false, 2]);
  });

  it("DELETE y TRUNCATE de las seis dan 42501 y las filas quedan", async () => {
    const app = await conexionComoApp();
    const antes = await Promise.all(TABLAS.map((t) => cuantos(t)));
    for (const tabla of TABLAS) {
      expect(await intentar(app, `DELETE FROM "${tabla}"`), `DELETE ${tabla}`).toMatchObject({ codigo: "42501" });
      expect(await intentar(app, `TRUNCATE "${tabla}"`), `TRUNCATE ${tabla}`).toMatchObject({ codigo: "42501" });
    }
    expect(await Promise.all(TABLAS.map((t) => cuantos(t)))).toEqual(antes);
    expect(antes.every((n) => n > 0)).toBe(true);
  });

  it("nada que se use se puede borrar ni como dueño: un grupo con opciones, una opción con versiones, una versión con consumos, un producto ancla y una unidad con consumos (RESTRICT)", async () => {
    const duenio = await conexionDelDuenio();
    for (const [tabla, id] of [
      ["GrupoDeOpciones", e.grupoMedidaId],
      ["OpcionDeGrupo", e.almendrasId],
      ["VersionDeOpcion", e.versionDe[e.almendrasId]!],
      ["Producto", e.anclaDelShotId],
      ["Producto", e.lecheId],
      ["Unidad", e.unidadId],
      ["User", e.usuarioId],
    ] as const) {
      expect(await intentar(duenio, `DELETE FROM "${tabla}" WHERE "id" = $1`, [id]), tabla).toMatchObject({ codigo: "23503" });
    }
  });
});

describe("aislamiento entre empresas", () => {
  it("una clave foránea hacia OTRA empresa da 23503 en cada tabla, aun escribiendo como DUEÑO con el empresaId explícito", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const grupoAjeno = await ajeno.testigo.grupoDeOpciones.create({ data: { nombre: "Grupo testigo", tipo: "VARIANTE" } });
    const opcionAjena = await ajeno.testigo.opcionDeGrupo.create({ data: { grupoId: grupoAjeno.id, nombre: "Opción testigo" } });
    const versionAjena = await ajeno.testigo.versionDeOpcion.create({ data: { opcionId: opcionAjena.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "1.00", creadoPorId: e.usuarioId } });
    const unidadAjena = ajeno.producto.unidadStockId;
    const duenio = await conexionDelDuenio();
    const propia = { empresaId: EMPRESA_DE_PRUEBA_ID };
    expect(await probar(duenio, sentenciaDeOpcion({ grupoId: grupoAjeno.id }, propia))).toEqual(rechazo("OpcionDeGrupo_empresaId_grupoId_fkey", "23503"));
    expect(await probar(duenio, sentenciaDeOpcion({ grupoId: e.grupoVarianteId }, { ...propia, productoId: ajeno.producto.id }))).toEqual(rechazo("OpcionDeGrupo_empresaId_productoId_fkey", "23503"));
    expect(await probar(duenio, sentenciaDeVersionDeOpcion({ opcionId: opcionAjena.id, usuarioId: e.usuarioId }, { ...propia, numero: 2 }))).toEqual(rechazo("VersionDeOpcion_empresaId_opcionId_fkey", "23503"));
    expect(await probar(duenio, sentenciaDeConsumo({ versionDeOpcionId: versionAjena.id, insumoProductoId: e.lecheId, unidadId: e.unidadId }, propia))).toEqual(rechazo("ConsumoDeOpcion_empresaId_versionDeOpcionId_fkey", "23503"));
    expect(await probar(duenio, sentenciaDeConsumo({ versionDeOpcionId: e.versionDe[e.vacaId]!, insumoProductoId: ajeno.producto.id, unidadId: e.unidadId }, { ...propia, orden: 7 }))).toEqual(rechazo("ConsumoDeOpcion_empresaId_insumoProductoId_fkey", "23503"));
    expect(await probar(duenio, sentenciaDeConsumo({ versionDeOpcionId: e.versionDe[e.vacaId]!, insumoProductoId: e.lecheId, unidadId: unidadAjena }, { ...propia, orden: 7 }))).toEqual(rechazo("ConsumoDeOpcion_empresaId_unidadId_fkey", "23503"));
    expect(
      await probar(duenio, sentenciaDeConsumo({ versionDeOpcionId: e.versionDe[e.vacaId]!, insumoProductoId: e.lecheId, unidadId: e.unidadId }, { ...propia, orden: 7, efecto: "REEMPLAZA", reemplazaAProductoId: ajeno.producto.id })),
    ).toEqual(rechazo("ConsumoDeOpcion_empresaId_reemplazaAProductoId_fkey", "23503"));
    expect(await probar(duenio, sentenciaDeAdmiteGrupo({ productoId: e.anclaDelShotId, grupoId: grupoAjeno.id }, propia))).toEqual(rechazo("ProductoAdmiteGrupo_empresaId_grupoId_fkey", "23503"));
    expect(await probar(duenio, sentenciaDeAdmiteGrupo({ productoId: ajeno.producto.id, grupoId: e.grupoVarianteId }, propia))).toEqual(rechazo("ProductoAdmiteGrupo_empresaId_productoId_fkey", "23503"));
    expect(await probar(duenio, sentenciaDeAdmiteOpcion({ productoId: e.anclaDelShotId, opcionId: opcionAjena.id }, propia))).toEqual(rechazo("ProductoAdmiteOpcion_empresaId_opcionId_fkey", "23503"));
    expect(await probar(duenio, sentenciaDeAdmiteOpcion({ productoId: ajeno.producto.id, opcionId: e.vacaId }, propia))).toEqual(rechazo("ProductoAdmiteOpcion_empresaId_productoId_fkey", "23503"));
  });

  it("la empresa B no ve nada del catálogo de A, y un INSERT de B con el empresaId de A da 42501 (la política lo rechaza)", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const comoB = await conexionComoApp(EMPRESA_TESTIGO_ID);
    for (const tabla of TABLAS) {
      const r = await comoB.query<{ n: string }>(`SELECT count(*) AS n FROM "${tabla}"`);
      expect(Number(r.rows[0]!.n), `B ve ${tabla} de A`).toBe(0);
    }
    expect(await ajeno.testigo.grupoDeOpciones.findMany()).toEqual([]);
    expect(await probar(comoB, sentenciaDeGrupo({ empresaId: EMPRESA_DE_PRUEBA_ID }))).toMatchObject({ codigo: "42501" });
    expect(await probar(comoB, sentenciaDeGrupo())).toBeNull();
    expect(await cuantos("GrupoDeOpciones", `"empresaId" = '${EMPRESA_TESTIGO_ID}'`)).toBe(1);
    const comoA = await conexionComoApp();
    expect((await comoA.query(`SELECT 1 FROM "GrupoDeOpciones"`)).rowCount).toBe(4);
  });

  it("dos empresas pueden tener un grupo con el MISMO nombre (los únicos son por empresa)", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const mismo = await ajeno.testigo.grupoDeOpciones.create({ data: { nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 } });
    expect(mismo.empresaId).toBe(EMPRESA_TESTIGO_ID);
    expect(await cuantos("GrupoDeOpciones", `"nombre" = 'Tamaño'`)).toBe(2);
  });
});

describe("la versión vigente de una opción es la de número mayor", () => {
  it("con las versiones 1, 2 y 3, `DISTINCT ON` devuelve la 3; y para varias opciones a la vez, una fila por opción", async () => {
    const app = await conexionComoApp();
    for (const numero of [2, 3]) {
      expect(await probar(app, sentenciaDeVersionDeOpcion({ opcionId: e.chicoId, usuarioId: e.usuarioId }, { numero, diferenciaPrecio: `-${numero}0.00` }))).toBeNull();
    }
    const r = await app.query<{ opcionId: string; numero: number; diferenciaPrecio: string }>(
      `SELECT DISTINCT ON ("opcionId") "opcionId", "numero", "diferenciaPrecio" FROM "VersionDeOpcion" WHERE "opcionId" = ANY($1) ORDER BY "opcionId", "numero" DESC`,
      [[e.chicoId, e.medianoId]],
    );
    expect(Object.fromEntries(r.rows.map((f) => [f.opcionId, [f.numero, f.diferenciaPrecio]]))).toEqual({ [e.chicoId]: [3, "-30.00"], [e.medianoId]: [1, "0.00"] });
  });
});

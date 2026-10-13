import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, conexionDelDuenio, intentar } from "../setup/gasto";
import { sembrarEscenarioDeOpciones, sentenciaDeApagado, sentenciaDePrecioLocal, type EscenarioDeOpciones } from "../setup/opciones";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * GO-1c — migración 20261020120000_go1c_opciones_por_sucursal: lo que decide una SUCURSAL sobre las opciones de venta (`PrecioLocalDeOpcion`, la grilla local, y `OpcionApagadaEnSucursal`, lo apagado), contra la base real. Las dos son PROPIAS
 * de la sucursal; sus 4 políticas de alcance las agrega 20261020121000 (GO-1c-rls) y las mide `opciones-rls`.
 *
 * Qué se mide: la estructura exacta (columnas con el dinero en `numeric(14,2)`, índices, claves foráneas, CHECK, RLS y las políticas de sucursal que suma la migración siguiente, privilegios de tabla y por columna); las reglas (precio de 0,01 o más,
 * `apagada` obligatorio, un precio por (sucursal, producto, opción) y un apagado por (sucursal, opción)); el `ON CONFLICT DO UPDATE` del apagado como `motor2_app`; que la app solo cambia lo editable y no borra nada; y la pertenencia (claves foráneas
 * compuestas con la empresa).
 *
 * Mutaciones demostradas (ver las filas O.320 a O.328 de docs/pureza-integracion.md): sacar una tabla de `ALCANCE_PROPIA` (rompe `alcance-de-sucursal`) y cambiar un byte de la migración de políticas (rompe B7).
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261020120000_go1c_opciones_por_sucursal");
const TABLAS = ["PrecioLocalDeOpcion", "OpcionApagadaEnSucursal"] as const;

let e: EscenarioDeOpciones;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeOpciones();
});
afterEach(cerrarConexiones);

const cuantos = async (tabla: string, filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);
const probar = (c: Parameters<typeof intentar>[0], s: { texto: string; params: unknown[] }) => intentar(c, s.texto, s.params);
const alcanceA = () => ({ lectura: [e.sucursalA], escritura: [e.sucursalA] });
const precio = (extra: Record<string, unknown> = {}) => sentenciaDePrecioLocal({ sucursalId: e.sucursalA, productoId: e.cafeId, opcionId: e.grandeId }, extra);
const apagado = (extra: Record<string, unknown> = {}) => sentenciaDeApagado({ sucursalId: e.sucursalA, opcionId: e.shotId, usuarioId: e.usuarioId }, extra);

describe("la migración deja las dos tablas, los índices, las claves foráneas, las reglas, la RLS y los privilegios puestos", () => {
  it("tiene las columnas esperadas, con el dinero en numeric(14,2) y `apagada` obligatoria y sin valor por defecto", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string; tipo: string; es_nulable: string; por_defecto: string | null }>>`
      SELECT table_name::text AS tabla, column_name::text AS columna,
             CASE WHEN data_type = 'numeric' THEN 'numeric(' || numeric_precision || ',' || numeric_scale || ')' ELSE data_type END AS tipo,
             is_nullable AS es_nulable, column_default AS por_defecto
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('PrecioLocalDeOpcion', 'OpcionApagadaEnSucursal') ORDER BY table_name, ordinal_position`;
    const de = (tabla: string) => columnas.filter((c) => c.tabla === tabla);
    const forma = (tabla: string) => de(tabla).map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`);
    const T = "timestamp without time zone";
    expect(forma("PrecioLocalDeOpcion")).toEqual(["id:text:NO", "empresaId:text:NO", "sucursalId:text:NO", "productoId:text:NO", "opcionId:text:NO", "precio:numeric(14,2):NO", "habilitado:boolean:NO", `actualizadoEn:${T}:NO`]);
    expect(forma("OpcionApagadaEnSucursal")).toEqual(["id:text:NO", "empresaId:text:NO", "sucursalId:text:NO", "opcionId:text:NO", "apagada:boolean:NO", "actualizadoPorId:text:NO", `actualizadoEn:${T}:NO`]);
    expect(columnas.filter((c) => /double|real|money/.test(c.tipo))).toEqual([]);
    for (const tabla of TABLAS) expect(de(tabla).find((c) => c.columna === "empresaId")!.por_defecto, tabla).toMatch(/app_empresa_actual\(\)/);
    expect(de("PrecioLocalDeOpcion").find((c) => c.columna === "habilitado")!.por_defecto).toBe("true");
    expect(de("OpcionApagadaEnSucursal").find((c) => c.columna === "apagada")!.por_defecto, "`apagada` se elige siempre").toBeNull();
  });

  it("los índices, las claves foráneas y los CHECK son los esperados (todas las claves RESTRICT; el precio de 0,01 o más)", async () => {
    const indices = await prismaAdmin.$queryRaw<Array<{ nombre: string; unico: boolean }>>`
      SELECT ic.relname::text AS nombre, i.indisunique AS unico FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
       WHERE c.relname IN ('PrecioLocalDeOpcion', 'OpcionApagadaEnSucursal') AND NOT i.indisprimary ORDER BY 1`;
    expect(indices.map((i) => `${i.nombre}|${i.unico}`)).toEqual([
      "OpcionApagadaEnSucursal_empresaId_id_key|true",
      "OpcionApagadaEnSucursal_sucursalId_opcionId_key|true",
      "PrecioLocalDeOpcion_empresaId_id_key|true",
      "PrecioLocalDeOpcion_sucursalId_productoId_opcionId_key|true",
    ]);
    const fks = await prismaAdmin.$queryRaw<Array<{ nombre: string; definicion: string }>>`
      SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
       WHERE conrelid IN ('"PrecioLocalDeOpcion"'::regclass, '"OpcionApagadaEnSucursal"'::regclass) AND contype = 'f' ORDER BY 1`;
    expect(fks.map((f) => f.nombre)).toEqual([
      "OpcionApagadaEnSucursal_actualizadoPorId_fkey", "OpcionApagadaEnSucursal_empresaId_fkey", "OpcionApagadaEnSucursal_empresaId_opcionId_fkey", "OpcionApagadaEnSucursal_empresaId_sucursalId_fkey",
      "PrecioLocalDeOpcion_empresaId_fkey", "PrecioLocalDeOpcion_empresaId_opcionId_fkey", "PrecioLocalDeOpcion_empresaId_productoId_fkey", "PrecioLocalDeOpcion_empresaId_sucursalId_fkey",
    ]);
    for (const f of fks) expect(f.definicion, f.nombre).toMatch(/ON DELETE RESTRICT/);
    expect(fks.find((f) => f.nombre === "PrecioLocalDeOpcion_empresaId_sucursalId_fkey")!.definicion).toMatch(/FOREIGN KEY \("empresaId", "sucursalId"\) REFERENCES "Sucursal"\("empresaId", id\)/);
    expect(fks.find((f) => f.nombre === "PrecioLocalDeOpcion_empresaId_opcionId_fkey")!.definicion).toMatch(/FOREIGN KEY \("empresaId", "opcionId"\) REFERENCES "OpcionDeGrupo"\("empresaId", id\)/);
    expect(fks.find((f) => f.nombre === "OpcionApagadaEnSucursal_actualizadoPorId_fkey")!.definicion).toMatch(/FOREIGN KEY \("actualizadoPorId"\) REFERENCES "User"\(id\)/);
    const checks = await prismaAdmin.$queryRaw<Array<{ nombre: string; validada: boolean; definicion: string }>>`
      SELECT conname::text AS nombre, convalidated AS validada, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
       WHERE conrelid IN ('"PrecioLocalDeOpcion"'::regclass, '"OpcionApagadaEnSucursal"'::regclass) AND contype = 'c'`;
    expect(checks.map((c) => [c.nombre, c.validada])).toEqual([["PrecioLocalDeOpcion_precio_chk", true]]);
    expect(checks[0]!.definicion).toContain("precio >= 0.01");
  });

  it("la RLS por empresa está puesta, sin FORCE; cada tabla tiene 5 políticas: `aislamiento_empresa` y las 4 de sucursal (RESTRICTIVE, TO motor2_app) de la migración siguiente", async () => {
    const rls = await prismaAdmin.$queryRaw<Array<{ tabla: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relname::text AS tabla, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid IN ('"PrecioLocalDeOpcion"'::regclass, '"OpcionApagadaEnSucursal"'::regclass) ORDER BY 1`;
    expect(rls).toEqual([
      { tabla: "OpcionApagadaEnSucursal", relrowsecurity: true, relforcerowsecurity: false },
      { tabla: "PrecioLocalDeOpcion", relrowsecurity: true, relforcerowsecurity: false },
    ]);
    const politicas = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; permissive: string; roles: string }>>`
      SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles FROM pg_policies WHERE tablename IN ('PrecioLocalDeOpcion', 'OpcionApagadaEnSucursal') ORDER BY 1, 2`;
    for (const tabla of TABLAS) {
      const de = politicas.filter((p) => p.tabla === tabla);
      expect(de.map((p) => p.nombre), tabla).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
      for (const p of de.filter((x) => x.nombre.startsWith("alcance_sucursal_"))) expect([p.permissive, p.roles], `${tabla}.${p.nombre}`).toEqual(["RESTRICTIVE", "{motor2_app}"]);
    }
  });

  it("privilegios EXACTOS: motor2_app tiene SELECT e INSERT, ningún DELETE y UPDATE solo de `precio`, `habilitado` y `actualizadoEn` (precio) y de `apagada`, `actualizadoPorId` y `actualizadoEn` (apagado); motor2_plataforma, nada", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ tabla: string; rol: string; privilegio: string }>>`
      SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name IN ('PrecioLocalDeOpcion', 'OpcionApagadaEnSucursal') AND grantee IN ('motor2_app', 'motor2_plataforma')`;
    expect(filas.map((f) => `${f.tabla}|${f.rol}|${f.privilegio}`).sort()).toEqual(TABLAS.flatMap((t) => ["INSERT", "SELECT"].map((p) => `${t}|motor2_app|${p}`)).sort());
    const actualizables = async (tabla: string) =>
      (await prismaAdmin.$queryRawUnsafe<Array<{ columna: string }>>(
        `SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"${tabla}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`,
      )).map((c) => c.columna);
    expect(await actualizables("PrecioLocalDeOpcion")).toEqual(["actualizadoEn", "habilitado", "precio"]);
    expect(await actualizables("OpcionApagadaEnSucursal")).toEqual(["actualizadoEn", "actualizadoPorId", "apagada"]);
  });

  it("el migration.sql y el down.sql avisan que requieren autorización y que la reversa aborta con filas, y NO crean las políticas de sucursal (eso es de la migración siguiente)", () => {
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

describe("las reglas de las dos tablas", () => {
  it("el precio local es de 0,01 o más: 0,00 y los negativos dan 23514; 0,01 entra; sin precio da 23502", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    for (const malo of ["0.00", "-1.00", "-0.01"]) {
      expect(await probar(app, precio({ precio: malo })), `precio ${malo}`).toEqual({ codigo: "23514", restriccion: "PrecioLocalDeOpcion_precio_chk" });
    }
    expect(await probar(app, precio({ precio: null }))).toMatchObject({ codigo: "23502" });
    expect(await probar(app, precio({ precio: "0.01" }))).toBeNull();
    expect(await cuantos("PrecioLocalDeOpcion")).toBe(1);
  });

  it("hay UN precio por (sucursal, producto, opción) y UN apagado por (sucursal, opción): repetirlos da 23505, aunque cambie el valor; en OTRA sucursal sí entran", async () => {
    const app = await conexionComoApp(undefined, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] });
    expect(await probar(app, precio())).toBeNull();
    expect(await probar(app, precio({ precio: "999.00" }))).toEqual({ codigo: "23505", restriccion: "PrecioLocalDeOpcion_sucursalId_productoId_opcionId_key" });
    expect(await probar(app, precio({ sucursalId: e.sucursalB }))).toBeNull();
    expect(await probar(app, apagado())).toBeNull();
    expect(await probar(app, apagado({ apagada: false }))).toEqual({ codigo: "23505", restriccion: "OpcionApagadaEnSucursal_sucursalId_opcionId_key" });
    expect(await probar(app, apagado({ sucursalId: e.sucursalB }))).toBeNull();
  });

  it("`apagada` es obligatoria (23502) y quien la cambió tiene que existir (23503)", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, apagado({ apagada: null }))).toMatchObject({ codigo: "23502" });
    expect(await probar(app, apagado({ actualizadoPorId: "no-existe" }))).toEqual({ codigo: "23503", restriccion: "OpcionApagadaEnSucursal_actualizadoPorId_fkey" });
  });

  it("el apagado se crea y se cambia con `ON CONFLICT DO UPDATE` como motor2_app: una sola fila, con el último valor, y sin poder mover la fila de sucursal", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const alta = (apagada: boolean) => ({
      texto: `INSERT INTO "OpcionApagadaEnSucursal" ("id", "sucursalId", "opcionId", "apagada", "actualizadoPorId") VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
              ON CONFLICT ("sucursalId", "opcionId") DO UPDATE SET "apagada" = EXCLUDED."apagada", "actualizadoPorId" = EXCLUDED."actualizadoPorId", "actualizadoEn" = now()`,
      params: [e.sucursalA, e.shotId, apagada, e.usuarioId],
    });
    expect(await probar(app, alta(true))).toBeNull();
    expect(await probar(app, alta(false))).toBeNull();
    expect(await probar(app, alta(true))).toBeNull();
    const filas = await prismaAdmin.opcionApagadaEnSucursal.findMany();
    expect(filas.map((f) => [f.sucursalId, f.opcionId, f.apagada])).toEqual([[e.sucursalA, e.shotId, true]]);
    expect(
      await intentar(app, `INSERT INTO "OpcionApagadaEnSucursal" ("id", "sucursalId", "opcionId", "apagada", "actualizadoPorId") VALUES ('x', $1, $2, true, $3) ON CONFLICT ("sucursalId", "opcionId") DO UPDATE SET "sucursalId" = $4`, [
        e.sucursalA, e.shotId, e.usuarioId, e.sucursalB,
      ]),
      "el `DO UPDATE` no puede tocar la sucursal",
    ).toMatchObject({ codigo: "42501" });
  });
});

describe("solo cambian lo editable: la app no modifica el resto ni borra nada", () => {
  it("UPDATE de `sucursalId`, `productoId`, `opcionId` o `empresaId` da 42501; UPDATE de `precio`, `habilitado`, `apagada` y `actualizadoPorId` anda", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, precio())).toBeNull();
    expect(await probar(app, apagado())).toBeNull();
    const idPrecio = (await prismaAdmin.precioLocalDeOpcion.findFirstOrThrow()).id;
    const idApagado = (await prismaAdmin.opcionApagadaEnSucursal.findFirstOrThrow()).id;
    for (const [tabla, id, columna, valor] of [
      ["PrecioLocalDeOpcion", idPrecio, "sucursalId", `'${e.sucursalB}'`],
      ["PrecioLocalDeOpcion", idPrecio, "productoId", `'${e.anclaDelShotId}'`],
      ["PrecioLocalDeOpcion", idPrecio, "opcionId", `'${e.chicoId}'`],
      ["PrecioLocalDeOpcion", idPrecio, "empresaId", `'${EMPRESA_TESTIGO_ID}'`],
      ["OpcionApagadaEnSucursal", idApagado, "sucursalId", `'${e.sucursalB}'`],
      ["OpcionApagadaEnSucursal", idApagado, "opcionId", `'${e.chicoId}'`],
    ] as const) {
      expect(await intentar(app, `UPDATE "${tabla}" SET "${columna}" = ${valor} WHERE "id" = $1`, [id]), `${tabla}.${columna}`).toMatchObject({ codigo: "42501" });
    }
    expect(await intentar(app, `UPDATE "PrecioLocalDeOpcion" SET "precio" = 150.50, "habilitado" = false, "actualizadoEn" = now() WHERE "id" = $1`, [idPrecio])).toBeNull();
    expect(await intentar(app, `UPDATE "OpcionApagadaEnSucursal" SET "apagada" = false, "actualizadoPorId" = $2, "actualizadoEn" = now() WHERE "id" = $1`, [idApagado, e.usuarioId])).toBeNull();
    const fila = await prismaAdmin.precioLocalDeOpcion.findUniqueOrThrow({ where: { id: idPrecio } });
    expect([fila.precio.toFixed(2), fila.habilitado]).toEqual(["150.50", false]);
  });

  it("DELETE y TRUNCATE de las dos dan 42501 y las filas quedan", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, precio())).toBeNull();
    expect(await probar(app, apagado())).toBeNull();
    for (const tabla of TABLAS) {
      expect(await intentar(app, `DELETE FROM "${tabla}"`), `DELETE ${tabla}`).toMatchObject({ codigo: "42501" });
      expect(await intentar(app, `TRUNCATE "${tabla}"`), `TRUNCATE ${tabla}`).toMatchObject({ codigo: "42501" });
    }
    expect([await cuantos("PrecioLocalDeOpcion"), await cuantos("OpcionApagadaEnSucursal")]).toEqual([1, 1]);
  });
});

describe("la pertenencia: claves foráneas compuestas con empresaId", () => {
  it("una fila con la sucursal, el producto o la opción de OTRA empresa da 23503, aun escribiendo como DUEÑO con el empresaId explícito", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const grupoAjeno = await ajeno.testigo.grupoDeOpciones.create({ data: { nombre: "Grupo testigo", tipo: "VARIANTE" } });
    const opcionAjena = await ajeno.testigo.opcionDeGrupo.create({ data: { grupoId: grupoAjeno.id, nombre: "Opción testigo" } });
    const duenio = await conexionDelDuenio();
    const propia = { empresaId: EMPRESA_DE_PRUEBA_ID };
    expect(await probar(duenio, precio({ ...propia, sucursalId: ajeno.sucursal.id }))).toEqual({ codigo: "23503", restriccion: "PrecioLocalDeOpcion_empresaId_sucursalId_fkey" });
    expect(await probar(duenio, precio({ ...propia, productoId: ajeno.producto.id }))).toEqual({ codigo: "23503", restriccion: "PrecioLocalDeOpcion_empresaId_productoId_fkey" });
    expect(await probar(duenio, precio({ ...propia, opcionId: opcionAjena.id }))).toEqual({ codigo: "23503", restriccion: "PrecioLocalDeOpcion_empresaId_opcionId_fkey" });
    expect(await probar(duenio, apagado({ ...propia, sucursalId: ajeno.sucursal.id }))).toEqual({ codigo: "23503", restriccion: "OpcionApagadaEnSucursal_empresaId_sucursalId_fkey" });
    expect(await probar(duenio, apagado({ ...propia, opcionId: opcionAjena.id }))).toEqual({ codigo: "23503", restriccion: "OpcionApagadaEnSucursal_empresaId_opcionId_fkey" });
    expect(await cuantos("PrecioLocalDeOpcion")).toBe(0);
  });

  it("una sucursal, un producto, una opción o un usuario con precio o apagado cargado no se pueden borrar (RESTRICT), ni como dueño", async () => {
    const duenio = await conexionDelDuenio();
    const propia = { empresaId: EMPRESA_DE_PRUEBA_ID }; // el dueño no tiene empresa en contexto: la fila lleva la suya explícita
    expect(await probar(duenio, precio(propia))).toBeNull();
    expect(await probar(duenio, apagado(propia))).toBeNull();
    for (const [tabla, id] of [["Sucursal", e.sucursalA], ["Producto", e.cafeId], ["OpcionDeGrupo", e.grandeId], ["OpcionDeGrupo", e.shotId], ["User", e.usuarioId]] as const) {
      expect(await intentar(duenio, `DELETE FROM "${tabla}" WHERE "id" = $1`, [id]), tabla).toMatchObject({ codigo: "23503" });
    }
  });
});

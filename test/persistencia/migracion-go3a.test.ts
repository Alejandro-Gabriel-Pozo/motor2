import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORIGENES_DE_PRECIO_DE_COMBINACION, entradaConPrecioDeCombinacion, resolverPrecioDeCombinacion } from "../../src/core/opciones/combinaciones";
import { componerPrecioDeLinea } from "../../src/core/opciones/componer-precio-de-linea";
import { EMPRESA_DE_PRUEBA_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, conexionDelDuenio, intentar } from "../setup/gasto";
import {
  sembrarEscenarioDeOpciones,
  sembrarLineaConOpciones,
  sentenciaDeCombinacion,
  sentenciaDeCombinacionEnLinea,
  sentenciaDeFoto,
  sentenciaDeGrupoDePrecio,
  sentenciaDeIngredienteDeCombinacion,
  sentenciaDePrecioLocalDeCombinacion,
  sentenciaDeRecetaDeCombinacion,
  type EscenarioDeOpciones,
} from "../setup/opciones";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * GO-3a — migración 20261021110000_go3a_combinaciones (ADR-032, frentes A y B: precio y receta por combinación), contra la base real. La columna `ProductoAdmiteGrupo.ejeDeCombinacion`, los grupos de
 * precio, las combinaciones, el precio local de combinación o de grupo (PROPIA, con las políticas de GO-3a-rls, 20261021111000), las recetas de combinación con sus ingredientes y la foto de la
 * combinación vendida (HEREDADA de `CuentaItem`).
 *
 * Qué se mide: la estructura exacta (columnas con el dinero en `numeric(14,2)` y las cantidades en `(14,4)`/`(6,2)`, índices —el único por expresión y el parcial de los ejes—, claves foráneas compuestas
 * RESTRICT salvo la foto, CHECK validados, RLS, políticas, privilegios de tabla y por columna); cada CHECK en su borde, con el caso NULL que pasa; que la app solo cambia lo editable y no borra nada;
 * el alcance por sucursal (precio local y foto); que el disparador de GO-1 sigue aceptando la MEDIDA de un eje fotografiada como «ABSOLUTO P»; la cascada del borrador; y la pertenencia.
 *
 * Mutaciones demostradas (filas de docs/pureza-integracion.md): reemplazar el único por expresión por uno común `(productoId, opcionEje1Id, opcionEje2Id)` (cae «dos combinaciones con el eje 2
 * NULL»), sacar `CombinacionEnLinea_origen_coherente_chk` (cae «el origen es coherente») y cambiar el CASCADE de la foto por RESTRICT (cae «la cascada del borrador»).
 */
afterAll(() => prismaAdmin.$disconnect());

const SUBIDA = join(__dirname, "../../prisma/migrations/20261021110000_go3a_combinaciones");
const TABLAS = ["GrupoDePrecio", "CombinacionDeProducto", "PrecioLocalDeCombinacion", "RecetaDeCombinacionVersion", "RecetaDeCombinacionIngrediente", "CombinacionEnLinea"] as const;
const PROPIA = { empresaId: EMPRESA_DE_PRUEBA_ID };

let e: EscenarioDeOpciones;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeOpciones();
});
afterEach(cerrarConexiones);

const cuantos = async (tabla: string, filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);
const probar = (c: Parameters<typeof intentar>[0], s: { texto: string; params: unknown[] }) => intentar(c, s.texto, s.params);
const alcanceA = () => ({ lectura: [e.sucursalA], escritura: [e.sucursalA] });
const lista = (nombres: readonly string[]) => nombres.map((t) => `'${t}'`).join(", ");
const regclases = (nombres: readonly string[]) => nombres.map((t) => `'"${t}"'`).join(", ");
const combinacion = (extra: Record<string, unknown> = {}) => sentenciaDeCombinacion({ productoId: e.cafeId, opcionEje1Id: e.grandeId }, extra);

describe("la migración deja la columna, las seis tablas, los índices, las claves foráneas, las reglas, la RLS y los privilegios puestos", () => {
  it("columnas, con el dinero en numeric(14,2), la cantidad en (14,4) y la merma en (6,2), sin float", async () => {
    const columnas = await prismaAdmin.$queryRawUnsafe<Array<{ tabla: string; columna: string; tipo: string; es_nulable: string }>>(
      `SELECT table_name::text AS tabla, column_name::text AS columna,
              CASE WHEN data_type = 'numeric' THEN 'numeric(' || numeric_precision || ',' || numeric_scale || ')' ELSE data_type END AS tipo, is_nullable AS es_nulable
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('ProductoAdmiteGrupo', ${lista(TABLAS)}) ORDER BY table_name, ordinal_position`,
    );
    const forma = (tabla: string) => columnas.filter((c) => c.tabla === tabla).map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`);
    const T = "timestamp without time zone";
    expect(forma("ProductoAdmiteGrupo").at(-1)).toBe("ejeDeCombinacion:smallint:YES");
    expect(forma("GrupoDePrecio")).toEqual(["id:text:NO", "empresaId:text:NO", "nombre:text:NO", "precio:numeric(14,2):NO", "activo:boolean:NO", "version:integer:NO", `creadoEn:${T}:NO`, `actualizadoEn:${T}:NO`]);
    expect(forma("CombinacionDeProducto")).toEqual([
      "id:text:NO", "empresaId:text:NO", "productoId:text:NO", "opcionEje1Id:text:NO", "opcionEje2Id:text:YES", "activa:boolean:NO", "precio:numeric(14,2):YES", "grupoDePrecioId:text:YES", "version:integer:NO", `creadoEn:${T}:NO`, `actualizadoEn:${T}:NO`,
    ]);
    expect(forma("PrecioLocalDeCombinacion")).toEqual(["id:text:NO", "empresaId:text:NO", "sucursalId:text:NO", "combinacionId:text:YES", "grupoDePrecioId:text:YES", "precio:numeric(14,2):NO", "habilitado:boolean:NO", `actualizadoEn:${T}:NO`]);
    expect(forma("RecetaDeCombinacionVersion")).toEqual(["id:text:NO", "empresaId:text:NO", "combinacionId:text:NO", "numero:integer:NO", "creadoPorId:text:NO", `creadoEn:${T}:NO`]);
    expect(forma("RecetaDeCombinacionIngrediente")).toEqual(["id:text:NO", "empresaId:text:NO", "versionId:text:NO", "insumoProductoId:text:NO", "cantidad:numeric(14,4):NO", "unidadId:text:NO", "mermaPorcentaje:numeric(6,2):NO", "orden:integer:NO"]);
    expect(forma("CombinacionEnLinea")).toEqual([
      "id:text:NO", "empresaId:text:NO", "cuentaItemId:text:NO", "combinacionId:text:NO", "origenPrecio:text:NO", "precioDeSucursal:boolean:NO", "grupoDePrecioId:text:YES", "nombreGrupoDePrecio:text:YES", "precio:numeric(14,2):YES",
      "recetaDeCombinacionVersionId:text:YES", `creadoEn:${T}:NO`,
    ]);
    expect(columnas.filter((c) => /double|real|money/.test(c.tipo))).toEqual([]);
  });

  it("los índices: el único por expresión de la combinación, el parcial de un grupo por eje y los únicos comunes del precio local", async () => {
    const indices = await prismaAdmin.$queryRawUnsafe<Array<{ nombre: string; definicion: string }>>(
      `SELECT indexname::text AS nombre, indexdef AS definicion FROM pg_indexes WHERE schemaname = 'public' AND tablename IN (${lista(TABLAS)}) AND indexname NOT LIKE '%_pkey' ORDER BY 1`,
    );
    expect(indices.map((i) => i.nombre)).toEqual([
      "CombinacionDeProducto_empresaId_id_key", "CombinacionDeProducto_grupoDePrecioId_idx", "CombinacionDeProducto_identidad_key",
      "CombinacionEnLinea_combinacionId_idx", "CombinacionEnLinea_cuentaItemId_key", "CombinacionEnLinea_empresaId_id_key",
      "GrupoDePrecio_empresaId_id_key", "GrupoDePrecio_empresaId_nombre_key", "GrupoDePrecio_nombre_lower_key",
      "PrecioLocalDeCombinacion_empresaId_id_key", "PrecioLocalDeCombinacion_sucursalId_combinacionId_key", "PrecioLocalDeCombinacion_sucursalId_grupoDePrecioId_key",
      "RecetaDeCombinacionIngrediente_empresaId_id_key", "RecetaDeCombinacionIngrediente_insumoProductoId_idx", "RecetaDeCombinacionIngrediente_versionId_orden_key",
      "RecetaDeCombinacionVersion_combinacionId_numero_key", "RecetaDeCombinacionVersion_creadoPorId_idx", "RecetaDeCombinacionVersion_empresaId_id_key",
    ]);
    const def = (n: string) => indices.find((i) => i.nombre === n)!.definicion;
    expect(def("CombinacionDeProducto_identidad_key")).toMatch(/UNIQUE INDEX .* \("productoId", "opcionEje1Id", COALESCE\("opcionEje2Id", ''::text\)\)/);
    const [eje] = await prismaAdmin.$queryRaw<Array<{ d: string }>>`SELECT indexdef AS d FROM pg_indexes WHERE indexname = 'ProductoAdmiteGrupo_un_grupo_por_eje_key'`;
    expect(eje!.d).toMatch(/UNIQUE INDEX .* \("productoId", "ejeDeCombinacion"\) WHERE \("ejeDeCombinacion" IS NOT NULL\)/);
  });

  it("claves foráneas compuestas con la empresa, todas RESTRICT salvo la foto hacia su línea (CASCADE); los CHECK nuevos existen, validados", async () => {
    const fks = await prismaAdmin.$queryRawUnsafe<Array<{ nombre: string; definicion: string }>>(
      `SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN (${regclases(TABLAS)}) ORDER BY 1`,
    );
    expect(fks).toHaveLength(22);
    for (const f of fks) {
      if (f.nombre === "CombinacionEnLinea_empresaId_cuentaItemId_fkey") expect(f.definicion).toBe('FOREIGN KEY ("empresaId", "cuentaItemId") REFERENCES "CuentaItem"("empresaId", id) ON UPDATE CASCADE ON DELETE CASCADE');
      else expect(f.definicion, f.nombre).toMatch(/ON DELETE RESTRICT/);
      if (!f.nombre.endsWith("_empresaId_fkey") && !/creadoPorId/.test(f.nombre)) expect(f.definicion, `${f.nombre}: compuesta con la empresa`).toMatch(/^FOREIGN KEY \("empresaId", /);
    }
    const checks = (
      await prismaAdmin.$queryRawUnsafe<Array<{ nombre: string; validada: boolean }>>(
        `SELECT conname::text AS nombre, convalidated AS validada FROM pg_constraint WHERE contype = 'c' AND conrelid::regclass::text IN ('"ProductoAdmiteGrupo"', ${regclases(TABLAS)}) ORDER BY 1`,
      )
    ).filter((c) => !c.nombre.startsWith("ProductoAdmiteGrupo_") || c.nombre === "ProductoAdmiteGrupo_eje_de_combinacion_chk");
    expect(checks.filter((c) => !c.validada)).toEqual([]);
    expect(checks.map((c) => c.nombre)).toEqual([
      "CombinacionDeProducto_ejes_distintos_chk", "CombinacionDeProducto_precio_chk", "CombinacionDeProducto_precio_o_grupo_chk", "CombinacionDeProducto_version_chk",
      "CombinacionEnLinea_nombre_grupo_chk", "CombinacionEnLinea_origen_coherente_chk", "CombinacionEnLinea_origen_precio_chk", "CombinacionEnLinea_precio_chk",
      "GrupoDePrecio_nombre_chk", "GrupoDePrecio_precio_chk", "GrupoDePrecio_version_chk",
      "PrecioLocalDeCombinacion_de_una_cosa_chk", "PrecioLocalDeCombinacion_precio_chk",
      "ProductoAdmiteGrupo_eje_de_combinacion_chk",
      "RecetaDeCombinacionIngrediente_cantidad_chk", "RecetaDeCombinacionIngrediente_merma_chk", "RecetaDeCombinacionIngrediente_orden_chk",
      "RecetaDeCombinacionVersion_numero_chk",
    ]);
  });

  it("RLS sin FORCE en las seis; `aislamiento_empresa` en todas y las 4 de sucursal (RESTRICTIVE, TO motor2_app) solo en el precio local y en la foto", async () => {
    const politicas = await prismaAdmin.$queryRawUnsafe<Array<{ tabla: string; nombre: string; permissive: string; roles: string }>>(
      `SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles FROM pg_policies WHERE tablename IN (${lista(TABLAS)}) ORDER BY 1, 2`,
    );
    const rls = await prismaAdmin.$queryRawUnsafe<Array<{ rls: boolean; forzado: boolean }>>(`SELECT relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE relname IN (${lista(TABLAS)})`);
    expect(rls).toEqual(TABLAS.map(() => ({ rls: true, forzado: false })));
    for (const t of TABLAS) {
      const de = politicas.filter((p) => p.tabla === t).map((p) => p.nombre);
      const deSucursal = t === "PrecioLocalDeCombinacion" || t === "CombinacionEnLinea";
      expect(de, t).toEqual(deSucursal ? ["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"] : ["aislamiento_empresa"]);
    }
    for (const p of politicas.filter((x) => x.nombre.startsWith("alcance_"))) expect([p.permissive, p.roles], `${p.tabla}.${p.nombre}`).toEqual(["RESTRICTIVE", "{motor2_app}"]);
  });

  it("privilegios EXACTOS de motor2_app: SELECT e INSERT en las seis; UPDATE por columna solo de lo editable (grupo, combinación, precio local y el eje del grupo admitido); las recetas y la foto solo se agregan; motor2_plataforma, nada", async () => {
    const filas = await prismaAdmin.$queryRawUnsafe<Array<{ tabla: string; rol: string; privilegio: string }>>(
      `SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN (${lista(TABLAS)}) AND grantee IN ('motor2_app', 'motor2_plataforma')`,
    );
    expect(filas.map((f) => `${f.tabla}|${f.rol}|${f.privilegio}`).sort()).toEqual(TABLAS.flatMap((t) => ["INSERT", "SELECT"].map((p) => `${t}|motor2_app|${p}`)).sort());
    const actualizables = async (tabla: string) =>
      (await prismaAdmin.$queryRawUnsafe<Array<{ columna: string }>>(
        `SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"${tabla}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`,
      )).map((c) => c.columna);
    expect(await actualizables("GrupoDePrecio")).toEqual(["activo", "actualizadoEn", "nombre", "precio", "version"]);
    expect(await actualizables("CombinacionDeProducto")).toEqual(["activa", "actualizadoEn", "grupoDePrecioId", "precio", "version"]);
    expect(await actualizables("PrecioLocalDeCombinacion")).toEqual(["actualizadoEn", "habilitado", "precio"]);
    for (const t of ["RecetaDeCombinacionVersion", "RecetaDeCombinacionIngrediente", "CombinacionEnLinea"]) expect(await actualizables(t), t).toEqual([]);
    expect(await actualizables("ProductoAdmiteGrupo")).toContain("ejeDeCombinacion");
  });

  it("el migration.sql y el down.sql avisan que requieren autorización, el bloqueo de `CuentaItem` y que la reversa ABORTA con filas; la migración de esquema no crea políticas de sucursal", () => {
    const subida = readFileSync(join(SUBIDA, "migration.sql"), "utf8");
    const reversa = readFileSync(join(SUBIDA, "down.sql"), "utf8");
    expect(subida.split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(subida).toMatch(/SHARE ROW EXCLUSIVE sobre `CuentaItem`/);
    expect(subida).toMatch(/FUERA DEL HORARIO DE SERVICIO/);
    expect(reversa).toMatch(/ABORTA/);
    for (const t of TABLAS) expect(reversa).toContain(`DROP TABLE IF EXISTS "${t}"`);
    for (const sql of [subida, reversa]) expect(sql).not.toContain("alcance_sucursal_");
  });
});

describe("las reglas de los ejes, los grupos y las combinaciones", () => {
  it("el eje es 1, 2 o NULL, y un producto tiene a lo sumo un grupo por eje (23505); otro producto puede usar el mismo número", async () => {
    const duenio = await conexionDelDuenio();
    const eje = (grupoId: string, valor: string) => intentar(duenio, `UPDATE "ProductoAdmiteGrupo" SET "ejeDeCombinacion" = ${valor} WHERE "productoId" = $1 AND "grupoId" = $2`, [e.cafeId, grupoId]);
    for (const malo of ["0", "3", "-1"]) expect(await eje(e.grupoMedidaId, malo), `eje ${malo}`).toEqual({ codigo: "23514", restriccion: "ProductoAdmiteGrupo_eje_de_combinacion_chk" });
    expect(await eje(e.grupoMedidaId, "1")).toBeNull();
    expect(await eje(e.grupoVarianteId, "1")).toEqual({ codigo: "23505", restriccion: "ProductoAdmiteGrupo_un_grupo_por_eje_key" });
    expect(await eje(e.grupoVarianteId, "2")).toBeNull();
    expect(await eje(e.grupoIncluidaId, "NULL")).toBeNull();
    const te = (await prismaAdmin.producto.create({ data: { empresaId: EMPRESA_DE_PRUEBA_ID, codigo: "PV_TE", nombre: "Té", tipo: "PV", unidadStockId: e.unidadId } })).id;
    expect(await intentar(duenio, `INSERT INTO "ProductoAdmiteGrupo" ("id","empresaId","productoId","grupoId","ejeDeCombinacion") VALUES ('pag-te',$1,$2,$3,1)`, [EMPRESA_DE_PRUEBA_ID, te, e.grupoMedidaId])).toBeNull();
  });

  it("el grupo de precio: precio de 0,01 o más, nombre visible de hasta 80 y único sin importar mayúsculas, versión de 1 o más", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    for (const malo of ["0.00", "-1.00"]) expect(await probar(app, sentenciaDeGrupoDePrecio({ precio: malo })), malo).toEqual({ codigo: "23514", restriccion: "GrupoDePrecio_precio_chk" });
    expect(await probar(app, sentenciaDeGrupoDePrecio({ nombre: " " }))).toEqual({ codigo: "23514", restriccion: "GrupoDePrecio_nombre_chk" });
    expect(await probar(app, sentenciaDeGrupoDePrecio({ version: 0 }))).toEqual({ codigo: "23514", restriccion: "GrupoDePrecio_version_chk" });
    expect(await probar(app, sentenciaDeGrupoDePrecio({ nombre: "Café mediano", precio: "0.01" }))).toBeNull();
    expect(await probar(app, sentenciaDeGrupoDePrecio({ nombre: "CAFÉ MEDIANO" }))).toEqual({ codigo: "23505", restriccion: "GrupoDePrecio_nombre_lower_key" });
  });

  it("la combinación: única por (producto, eje 1, eje 2) también con el eje 2 NULL; ejes distintos; precio O grupo (o ninguno); precio de 0,01 o más", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const grupo = sentenciaDeGrupoDePrecio();
    expect(await probar(app, grupo)).toBeNull();
    expect(await probar(app, combinacion())).toBeNull();
    expect(await probar(app, combinacion({ activa: false })), "dos combinaciones con el eje 2 NULL").toEqual({ codigo: "23505", restriccion: "CombinacionDeProducto_identidad_key" });
    expect(await probar(app, combinacion({ opcionEje2Id: e.almendrasId }))).toBeNull();
    expect(await probar(app, combinacion({ opcionEje2Id: e.almendrasId, precio: "4700.00" }))).toEqual({ codigo: "23505", restriccion: "CombinacionDeProducto_identidad_key" });
    expect(await probar(app, combinacion({ opcionEje1Id: e.chicoId, opcionEje2Id: e.chicoId }))).toEqual({ codigo: "23514", restriccion: "CombinacionDeProducto_ejes_distintos_chk" });
    expect(await probar(app, combinacion({ opcionEje1Id: e.medianoId, precio: "3300.00", grupoDePrecioId: grupo.id }))).toEqual({ codigo: "23514", restriccion: "CombinacionDeProducto_precio_o_grupo_chk" });
    expect(await probar(app, combinacion({ opcionEje1Id: e.medianoId, precio: "0.00" }))).toEqual({ codigo: "23514", restriccion: "CombinacionDeProducto_precio_chk" });
    expect(await probar(app, combinacion({ opcionEje1Id: e.medianoId, grupoDePrecioId: grupo.id }))).toBeNull();
    expect(await probar(app, combinacion({ opcionEje1Id: e.chicoId, opcionEje2Id: e.vacaId, activa: false }))).toBeNull();
    expect(await cuantos("CombinacionDeProducto")).toBe(4);
  });

  it("el precio local: de una combinación O de un grupo (exactamente una, 23514), de 0,01 o más, uno por sucursal y por cosa (23505); en otra sucursal entra", async () => {
    const app = await conexionComoApp(undefined, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalA, e.sucursalB] });
    const grupo = sentenciaDeGrupoDePrecio();
    const comb = combinacion();
    expect(await probar(app, grupo)).toBeNull();
    expect(await probar(app, comb)).toBeNull();
    const local = (extra: Record<string, unknown>) => sentenciaDePrecioLocalDeCombinacion({ sucursalId: e.sucursalA }, extra);
    expect(await probar(app, local({}))).toEqual({ codigo: "23514", restriccion: "PrecioLocalDeCombinacion_de_una_cosa_chk" });
    expect(await probar(app, local({ combinacionId: comb.id, grupoDePrecioId: grupo.id }))).toEqual({ codigo: "23514", restriccion: "PrecioLocalDeCombinacion_de_una_cosa_chk" });
    expect(await probar(app, local({ combinacionId: comb.id, precio: "0.00" }))).toEqual({ codigo: "23514", restriccion: "PrecioLocalDeCombinacion_precio_chk" });
    expect(await probar(app, local({ combinacionId: comb.id }))).toBeNull();
    expect(await probar(app, local({ combinacionId: comb.id, precio: "9.99" }))).toEqual({ codigo: "23505", restriccion: "PrecioLocalDeCombinacion_sucursalId_combinacionId_key" });
    expect(await probar(app, local({ grupoDePrecioId: grupo.id }))).toBeNull();
    expect(await probar(app, local({ grupoDePrecioId: grupo.id }))).toEqual({ codigo: "23505", restriccion: "PrecioLocalDeCombinacion_sucursalId_grupoDePrecioId_key" });
    expect(await probar(app, sentenciaDePrecioLocalDeCombinacion({ sucursalId: e.sucursalB }, { combinacionId: comb.id }))).toBeNull();
  });

  it("la receta de la combinación: número de 1 o más y único por combinación (23505: dos versiones a la vez, gana una); ingrediente con cantidad > 0, merma de 0 a 100 y orden único", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const comb = combinacion();
    expect(await probar(app, comb)).toBeNull();
    expect(await probar(app, sentenciaDeRecetaDeCombinacion({ combinacionId: comb.id, usuarioId: e.usuarioId }, { numero: 0 }))).toEqual({ codigo: "23514", restriccion: "RecetaDeCombinacionVersion_numero_chk" });
    const v1 = sentenciaDeRecetaDeCombinacion({ combinacionId: comb.id, usuarioId: e.usuarioId });
    expect(await probar(app, v1)).toBeNull();
    expect(await probar(app, sentenciaDeRecetaDeCombinacion({ combinacionId: comb.id, usuarioId: e.usuarioId }))).toEqual({ codigo: "23505", restriccion: "RecetaDeCombinacionVersion_combinacionId_numero_key" });
    const ing = (extra: Record<string, unknown>) => sentenciaDeIngredienteDeCombinacion({ versionId: v1.id, insumoProductoId: e.lecheId, unidadId: e.unidadId }, extra);
    for (const mala of ["0", "-0.0001"]) expect(await probar(app, ing({ cantidad: mala })), mala).toEqual({ codigo: "23514", restriccion: "RecetaDeCombinacionIngrediente_cantidad_chk" });
    for (const mala of ["-0.01", "100.01"]) expect(await probar(app, ing({ mermaPorcentaje: mala })), mala).toEqual({ codigo: "23514", restriccion: "RecetaDeCombinacionIngrediente_merma_chk" });
    expect(await probar(app, ing({ cantidad: "0.2000", mermaPorcentaje: "100.00" }))).toBeNull();
    expect(await probar(app, ing({ cantidad: "0.0360" }))).toEqual({ codigo: "23505", restriccion: "RecetaDeCombinacionIngrediente_versionId_orden_key" });
    expect(await probar(app, ing({ orden: 1, cantidad: "0.0001" }))).toBeNull();
    const [fila] = await prismaAdmin.$queryRaw<Array<{ c: string }>>`SELECT "cantidad"::text AS c FROM "RecetaDeCombinacionIngrediente" WHERE "orden" = 1`;
    expect(fila!.c, "la cantidad se guarda exacta, con 4 decimales").toBe("0.0001");
  });
});

describe("la foto de la combinación vendida", () => {
  it("el origen es coherente: ADITIVO sin precio ni grupo ni precio de sucursal; PROPIO con precio y sin grupo; GRUPO con precio, grupo y su nombre; una foto por línea", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const grupo = sentenciaDeGrupoDePrecio({ nombre: "Café mediano" });
    const comb = combinacion();
    expect(await probar(app, grupo)).toBeNull();
    expect(await probar(app, comb)).toBeNull();
    const linea = await sembrarLineaConOpciones(e.cuentaAId, e);
    const foto = (extra: Record<string, unknown>) => sentenciaDeCombinacionEnLinea({ cuentaItemId: linea.id, combinacionId: comb.id }, extra);
    const coherente = { codigo: "23514", restriccion: "CombinacionEnLinea_origen_coherente_chk" };
    // Un origen fuera de la lista rompe los dos CHECK del origen; Postgres informa el primero por nombre.
    expect(await probar(app, foto({ origenPrecio: "OTRO" }))).toEqual(coherente);
    const [lista] = await prismaAdmin.$queryRaw<Array<{ d: string }>>`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'CombinacionEnLinea_origen_precio_chk'`;
    expect([...lista!.d.matchAll(/'([A-Z]+)'::text/g)].map((m) => m[1]), "paridad con el núcleo").toEqual([...ORIGENES_DE_PRECIO_DE_COMBINACION]);
    expect(await probar(app, foto({ precio: "3800.00" })), "ADITIVO con precio").toEqual(coherente);
    expect(await probar(app, foto({ precioDeSucursal: true })), "ADITIVO de la sucursal").toEqual(coherente);
    expect(await probar(app, foto({ origenPrecio: "PROPIO" })), "PROPIO sin precio").toEqual(coherente);
    expect(await probar(app, foto({ origenPrecio: "PROPIO", precio: "3800.00", grupoDePrecioId: grupo.id, nombreGrupoDePrecio: "Café mediano" })), "PROPIO con grupo").toEqual(coherente);
    expect(await probar(app, foto({ origenPrecio: "GRUPO", precio: "3300.00", grupoDePrecioId: grupo.id })), "GRUPO sin el nombre copiado").toEqual(coherente);
    expect(await probar(app, foto({ origenPrecio: "GRUPO", precio: "0.00", grupoDePrecioId: grupo.id, nombreGrupoDePrecio: "Café mediano" }))).toEqual({ codigo: "23514", restriccion: "CombinacionEnLinea_precio_chk" });
    expect(await probar(app, foto({ origenPrecio: "GRUPO", precio: "3300.00", grupoDePrecioId: grupo.id, nombreGrupoDePrecio: "Café mediano", precioDeSucursal: true }))).toBeNull();
    expect(await probar(app, foto({}))).toEqual({ codigo: "23505", restriccion: "CombinacionEnLinea_cuentaItemId_key" });
    const otra = await sembrarLineaConOpciones(e.cuentaAId, e);
    expect(await probar(app, sentenciaDeCombinacionEnLinea({ cuentaItemId: otra.id, combinacionId: comb.id }))).toBeNull();
    expect(await probar(app, sentenciaDeCombinacionEnLinea({ cuentaItemId: (await sembrarLineaConOpciones(e.cuentaAId, e)).id, combinacionId: comb.id }, { origenPrecio: "PROPIO", precio: "4700.00" }))).toBeNull();
  });

  it("el disparador de GO-1 sigue aceptando la MEDIDA de un eje fotografiada como «ABSOLUTO P» (el precio de la combinación), y la VARIANTE del eje sin diferencia", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const linea = await sembrarLineaConOpciones(e.cuentaAId, e, { precioUnitario: "4700.00" });
    const medida = sentenciaDeFoto(
      { grupoVarianteId: e.grupoMedidaId, vacaId: e.grandeId, versionDe: e.versionDe, cuentaItemId: linea.id },
      { tipoGrupo: "MEDIDA", nombreGrupo: "Tamaño", nombreOpcion: "Grande", modoPrecio: "ABSOLUTO", importeUnitario: "4700.00", factorEscala: "1.5000" },
    );
    expect(await probar(app, medida)).toBeNull();
    expect(await probar(app, sentenciaDeFoto({ ...e, cuentaItemId: linea.id }))).toBeNull();
    const comb = combinacion({ opcionEje2Id: e.vacaId, precio: "4700.00" });
    expect(await probar(app, comb)).toBeNull();
    expect(await probar(app, sentenciaDeCombinacionEnLinea({ cuentaItemId: linea.id, combinacionId: comb.id }, { origenPrecio: "PROPIO", precio: "4700.00" }))).toBeNull();
    expect(await cuantos("OpcionElegidaEnLinea")).toBe(2);
  });

  it("integración con el núcleo (A1): la foto que sale de `entradaConPrecioDeCombinacion` + `componerPrecioDeLinea` con la tarifa del grupo entra en la base tal cual (MEDIDA «ABSOLUTO P», VARIANTE del eje en 0) junto con su `CombinacionEnLinea`", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const grupo = sentenciaDeGrupoDePrecio({ nombre: "Café grande", precio: "3800.00" });
    const comb = combinacion({ opcionEje2Id: e.vacaId, grupoDePrecioId: grupo.id });
    expect(await probar(app, grupo)).toBeNull();
    expect(await probar(app, comb)).toBeNull();
    const precio = resolverPrecioDeCombinacion({ combinacionId: comb.id, activa: true, precio: null, grupo: { grupoDePrecioId: grupo.id, nombre: "Café grande", precio: 3800, activo: true } }, { deLaCombinacion: null, delGrupo: null }, "Café");
    const base = { versionDeOpcionId: "", cantidad: 1, factorEscala: null, modoPrecio: null, precioAbsoluto: null, diferencia: null } as const;
    const entrada = {
      precioBase: 1000,
      cantidad: 1,
      opciones: [
        { ...base, opcionId: e.grandeId, versionDeOpcionId: e.versionDe[e.grandeId]!, nombre: "Grande", tipo: "MEDIDA" as const, modoPrecio: "DIFERENCIA" as const, factorEscala: 1.5, diferencia: { tipo: "MONTO" as const, monto: 100 } },
        { ...base, opcionId: e.vacaId, versionDeOpcionId: e.versionDe[e.vacaId]!, nombre: "De vaca", tipo: "VARIANTE" as const },
        { ...base, opcionId: e.azucarId, versionDeOpcionId: e.versionDe[e.azucarId]!, nombre: "Azúcar", tipo: "INCLUIDA" as const },
      ],
    };
    const r = componerPrecioDeLinea(entradaConPrecioDeCombinacion(entrada, precio, [e.grandeId, e.vacaId]));
    expect(r.ok).toBe(true);
    if (!r.ok || !precio.ok || precio.origen !== "GRUPO") return;
    expect(r.precio.precioDeLista).toBe(3800);
    const linea = await sembrarLineaConOpciones(e.cuentaAId, e, { precioUnitario: r.precio.precioDeLista.toFixed(2) });
    const nombres: Record<string, [string, string, string]> = { [e.grandeId]: [e.grupoMedidaId, "Tamaño", "Grande"], [e.vacaId]: [e.grupoVarianteId, "Leche", "De vaca"], [e.azucarId]: [e.grupoIncluidaId, "Viene con", "Azúcar"] };
    for (const d of r.precio.dentroDelPrecio) {
      const [grupoId, nombreGrupo, nombreOpcion] = nombres[d.opcionId]!;
      const fila = sentenciaDeFoto(
        { grupoVarianteId: grupoId, vacaId: d.opcionId, versionDe: e.versionDe, cuentaItemId: linea.id },
        { tipoGrupo: d.tipo, nombreGrupo, nombreOpcion, cantidad: d.cantidad, modoPrecio: d.modoPrecio, tipoDeDiferencia: d.tipoDeDiferencia, porcentaje: d.porcentaje, importeUnitario: d.importeUnitario.toFixed(2), precioDeSucursal: d.precioDeSucursal, factorEscala: d.factorEscala === null ? null : d.factorEscala.toFixed(4) },
      );
      expect(await probar(app, fila), d.opcionId).toBeNull();
    }
    expect(
      await probar(app, sentenciaDeCombinacionEnLinea({ cuentaItemId: linea.id, combinacionId: comb.id }, { origenPrecio: precio.origen, precio: precio.precio.toFixed(2), precioDeSucursal: precio.precioDeSucursal, grupoDePrecioId: precio.grupoDePrecioId, nombreGrupoDePrecio: precio.nombreGrupoDePrecio })),
    ).toBeNull();
    const medida = await prismaAdmin.opcionElegidaEnLinea.findFirstOrThrow({ where: { cuentaItemId: linea.id, tipoGrupo: "MEDIDA" } });
    expect([medida.modoPrecio, medida.importeUnitario.toFixed(2), medida.tipoDeDiferencia]).toEqual(["ABSOLUTO", "3800.00", null]);
  });

  it("la cascada del borrador: como motor2_app, borrar el borrador de la línea borra su foto aunque la app no tenga DELETE sobre ella; la foto no se cambia", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const comb = combinacion();
    expect(await probar(app, comb)).toBeNull();
    const linea = await sembrarLineaConOpciones(e.cuentaAId, e);
    const foto = sentenciaDeCombinacionEnLinea({ cuentaItemId: linea.id, combinacionId: comb.id });
    expect(await probar(app, foto)).toBeNull();
    expect(await intentar(app, `DELETE FROM "CombinacionEnLinea" WHERE "id" = $1`, [foto.id]), "la app no borra fotos").toMatchObject({ codigo: "42501" });
    expect(await intentar(app, `UPDATE "CombinacionEnLinea" SET "origenPrecio" = 'PROPIO', "precio" = 1 WHERE "id" = $1`, [foto.id]), "ni las cambia").toMatchObject({ codigo: "42501" });
    expect(await intentar(app, `DELETE FROM "CuentaItem" WHERE "id" = $1 AND "numeroEnvio" IS NULL`, [linea.id])).toBeNull();
    expect([await cuantos("CuentaItem", `"id" = '${linea.id}'`), await cuantos("CombinacionEnLinea")]).toEqual([0, 0]);
  });
});

describe("solo cambian lo editable y nada se borra", () => {
  it("UPDATE de la identidad de la combinación, del grupo o del precio local da 42501; el de lo editable anda; DELETE y TRUNCATE de las seis dan 42501", async () => {
    const app = await conexionComoApp(undefined, alcanceA());
    const grupo = sentenciaDeGrupoDePrecio();
    const comb = combinacion();
    expect(await probar(app, grupo)).toBeNull();
    expect(await probar(app, comb)).toBeNull();
    const local = sentenciaDePrecioLocalDeCombinacion({ sucursalId: e.sucursalA }, { combinacionId: comb.id });
    expect(await probar(app, local)).toBeNull();
    for (const [tabla, id, columna, valor] of [
      ["CombinacionDeProducto", comb.id, "productoId", `'${e.anclaDelShotId}'`],
      ["CombinacionDeProducto", comb.id, "opcionEje1Id", `'${e.chicoId}'`],
      ["CombinacionDeProducto", comb.id, "opcionEje2Id", `'${e.vacaId}'`],
      ["GrupoDePrecio", grupo.id, "empresaId", "'otra'"],
      ["PrecioLocalDeCombinacion", local.id, "combinacionId", "NULL"],
      ["PrecioLocalDeCombinacion", local.id, "sucursalId", `'${e.sucursalB}'`],
    ] as const) {
      expect(await intentar(app, `UPDATE "${tabla}" SET "${columna}" = ${valor} WHERE "id" = $1`, [id]), `${tabla}.${columna}`).toMatchObject({ codigo: "42501" });
    }
    expect(await intentar(app, `UPDATE "CombinacionDeProducto" SET "activa" = false, "precio" = 3800.00, "version" = "version" + 1, "actualizadoEn" = now() WHERE "id" = $1 AND "version" = 1`, [comb.id])).toBeNull();
    expect(await intentar(app, `UPDATE "GrupoDePrecio" SET "precio" = 3500.00, "nombre" = 'Mediano', "activo" = false, "version" = 2, "actualizadoEn" = now() WHERE "id" = $1`, [grupo.id])).toBeNull();
    expect(await intentar(app, `UPDATE "PrecioLocalDeCombinacion" SET "precio" = 4100.00, "habilitado" = false, "actualizadoEn" = now() WHERE "id" = $1`, [local.id])).toBeNull();
    const fila = await prismaAdmin.combinacionDeProducto.findUniqueOrThrow({ where: { id: comb.id } });
    expect([fila.activa, fila.precio?.toFixed(2), fila.version]).toEqual([false, "3800.00", 2]);
    for (const tabla of TABLAS) {
      expect(await intentar(app, `DELETE FROM "${tabla}"`), `DELETE ${tabla}`).toMatchObject({ codigo: "42501" });
      expect(await intentar(app, `TRUNCATE "${tabla}"`), `TRUNCATE ${tabla}`).toMatchObject({ codigo: "42501" });
    }
  });
});

describe("el alcance por sucursal del precio local y de la foto (GO-3a-rls)", () => {
  it("con alcance en A: el precio local de B ni se ve ni se escribe (42501); la foto de una línea de una mesa de B no se ve ni se escribe; sin alcance nada; la combinación (de empresa) se ve igual", async () => {
    const duenio = await conexionDelDuenio();
    const comb = combinacion({ ...PROPIA, id: "comb-empresa" });
    expect(await probar(duenio, comb)).toBeNull();
    expect(await probar(duenio, sentenciaDePrecioLocalDeCombinacion({ sucursalId: e.sucursalB }, { ...PROPIA, id: "local-b", combinacionId: comb.id }))).toBeNull();
    const lineaB = await sembrarLineaConOpciones(e.cuentaBId, e);
    expect(await probar(duenio, sentenciaDeCombinacionEnLinea({ cuentaItemId: lineaB.id, combinacionId: comb.id }, { ...PROPIA, id: "foto-b" }))).toBeNull();
    const enA = await conexionComoApp(undefined, alcanceA());
    expect((await enA.query(`SELECT "id" FROM "PrecioLocalDeCombinacion"`)).rows).toEqual([]);
    expect((await enA.query(`SELECT "id" FROM "CombinacionEnLinea"`)).rows).toEqual([]);
    expect(await probar(enA, sentenciaDePrecioLocalDeCombinacion({ sucursalId: e.sucursalB }, { combinacionId: comb.id, id: "otro" }))).toMatchObject({ codigo: "42501" });
    const otraLineaB = await sembrarLineaConOpciones(e.cuentaBId, e);
    expect(await probar(enA, sentenciaDeCombinacionEnLinea({ cuentaItemId: otraLineaB.id, combinacionId: comb.id }))).toMatchObject({ codigo: "42501" });
    expect((await enA.query(`SELECT "id" FROM "CombinacionDeProducto"`)).rows).toEqual([{ id: "comb-empresa" }]);
    const sinAlcance = await conexionComoApp();
    expect((await sinAlcance.query(`SELECT "id" FROM "PrecioLocalDeCombinacion" UNION ALL SELECT "id" FROM "CombinacionEnLinea"`)).rows).toEqual([]);
    expect(await probar(sinAlcance, sentenciaDePrecioLocalDeCombinacion({ sucursalId: e.sucursalA }, { combinacionId: comb.id }))).toMatchObject({ codigo: "42501" });
  });
});

describe("la pertenencia: claves foráneas compuestas con empresaId", () => {
  it("una combinación con el producto o una opción de OTRA empresa, o una foto de una línea ajena, da 23503 aun como DUEÑO; lo referenciado no se borra (RESTRICT)", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const grupoAjeno = await ajeno.testigo.grupoDeOpciones.create({ data: { nombre: "Grupo testigo", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 } });
    const opcionAjena = await ajeno.testigo.opcionDeGrupo.create({ data: { grupoId: grupoAjeno.id, nombre: "Opción testigo" } });
    const duenio = await conexionDelDuenio();
    expect(await probar(duenio, combinacion({ ...PROPIA, productoId: ajeno.producto.id }))).toEqual({ codigo: "23503", restriccion: "CombinacionDeProducto_empresaId_productoId_fkey" });
    expect(await probar(duenio, combinacion({ ...PROPIA, opcionEje1Id: opcionAjena.id }))).toEqual({ codigo: "23503", restriccion: "CombinacionDeProducto_empresaId_opcionEje1Id_fkey" });
    expect(await probar(duenio, combinacion({ ...PROPIA, opcionEje2Id: opcionAjena.id }))).toEqual({ codigo: "23503", restriccion: "CombinacionDeProducto_empresaId_opcionEje2Id_fkey" });
    expect(await probar(duenio, sentenciaDePrecioLocalDeCombinacion({ sucursalId: ajeno.sucursal.id }, { ...PROPIA, grupoDePrecioId: "no-existe" }))).toEqual({ codigo: "23503", restriccion: "PrecioLocalDeCombinacion_empresaId_sucursalId_fkey" });
    const grupo = sentenciaDeGrupoDePrecio(PROPIA);
    const comb = combinacion({ ...PROPIA, grupoDePrecioId: grupo.id });
    expect(await probar(duenio, grupo)).toBeNull();
    expect(await probar(duenio, comb)).toBeNull();
    const version = sentenciaDeRecetaDeCombinacion({ combinacionId: comb.id, usuarioId: e.usuarioId }, PROPIA);
    expect(await probar(duenio, version)).toBeNull();
    expect(await probar(duenio, sentenciaDeIngredienteDeCombinacion({ versionId: version.id, insumoProductoId: ajeno.producto.id, unidadId: e.unidadId }, PROPIA))).toEqual({ codigo: "23503", restriccion: "RecetaDeCombinacionIngrediente_empresaId_insumoProductoId_fkey" });
    for (const [tabla, id] of [["GrupoDePrecio", grupo.id], ["CombinacionDeProducto", comb.id], ["Producto", e.cafeId], ["OpcionDeGrupo", e.grandeId], ["User", e.usuarioId]] as const) {
      expect(await intentar(duenio, `DELETE FROM "${tabla}" WHERE "id" = $1`, [id]), tabla).toMatchObject({ codigo: "23503" });
    }
  });
});

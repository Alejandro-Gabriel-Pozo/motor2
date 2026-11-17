import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lineaDelPortalDesdeTexto, sonPartesDeImagenValidas, esColorDePortalValido, esTelefonoDeTarjetaValido, tituloDelPortalDesdeTexto } from "../../src/core/carta/public";
import { textoDeFichaDesdeTexto } from "../../src/core/datos/fichas-de-texto";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Carta, portal de la empresa PR-A: las tablas `PortalDeEmpresa`, `PortalTarjeta` y `PortalZona` y sus tres funciones de validación (migración 20261117162000). SUBIR, BAJAR y SUBIR sobre una base TEMPORAL migrada como una real.
 * Prueba: ANTES nada existe; SUBIR crea las tablas con sus únicos, sus CHECK, sus disparadores, la RLS por empresa y los privilegios de la app (leer, agregar y cambiar solo las columnas con GRANT; SIN borrar); la base decide con SQL directo (zona fuera de rango, color, imagen incompleta o de otro proveedor,
 * teléfono con letras, variante, código corto, segundo portal por empresa, código repetido en toda la plataforma, una zona por sucursal, sucursal de otra empresa, identidad inmutable, código inmutable); PRUEBA ESPEJO: las funciones de la base aceptan EXACTAMENTE lo que el código acepta; BAJAR CON FILAS aborta y no
 * pierde nada; con las tablas vacías baja, y bajar dos veces no falla; SUBIR OTRA VEZ deja el catálogo idéntico al de la primera subida. Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261117162000_portal_de_empresa";
const E = "empresa_portal";
const E2 = "empresa_portal_2";
const P1 = "00000000-0000-4000-8000-0000000000c1";
const P2 = "00000000-0000-4000-8000-0000000000c2";
const Z1 = "00000000-0000-4000-8000-0000000000d1";
const Z2 = "00000000-0000-4000-8000-0000000000d2";
const CODIGO = "A".repeat(22);
const CODIGO2 = "B".repeat(22);
const TABLAS = ["PortalDeEmpresa", "PortalTarjeta", "PortalZona"];

let base: BaseTemporalMigrada;
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, MIGRACION, archivo), "utf8");
const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(leer(archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);
const existe = async (t = "PortalDeEmpresa") => (await q(`SELECT to_regclass('public."${t}"')::text AS t`))[0].t !== null;
const falla = async (texto: string, params: unknown[] = []): Promise<string> => {
  await base.cliente.query("BEGIN");
  try {
    await base.cliente.query(texto, params);
    return "sin error";
  } catch (e) {
    return (e as { code?: string; message?: string }).code ?? (e as Error).message;
  } finally {
    await base.cliente.query("ROLLBACK");
  }
};
const portal = (id: string, codigo: string, empresa = E) => q(`INSERT INTO "PortalDeEmpresa" ("id","empresaId","codigo","creadoPorId","actualizadoEn") VALUES ($1,$2,$3,'u',now())`, [id, empresa, codigo]);
const insertarPortal = (id: string, codigo: string, columna: string, valor: unknown, empresa = E) => base.cliente.query(`INSERT INTO "PortalDeEmpresa" ("id","empresaId","codigo","creadoPorId","actualizadoEn","${columna}") VALUES ($1,$2,$3,'u',now(),$4)`, [id, empresa, codigo, valor]);
const insertarTarjeta = (columna: string | null, valor: unknown, sucursal = "suc_portal", portalId = P1, empresa = E) =>
  base.cliente.query(`INSERT INTO "PortalTarjeta" ("empresaId","portalId","sucursalId","orden","actualizadoEn"${columna ? `,"${columna}"` : ""}) VALUES ($1,$2,$3,0,now()${columna ? ",$4" : ""})`, columna ? [empresa, portalId, sucursal, valor] : [empresa, portalId, sucursal]);
const insertarZona = (id: string, x: unknown, y: unknown, ancho: unknown, alto: unknown, sucursal = "suc_portal", empresa = E) =>
  base.cliente.query(`INSERT INTO "PortalZona" ("id","empresaId","portalId","sucursalId","x","y","ancho","alto","actualizadoEn") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`, [id, empresa, P1, sucursal, x, y, ancho, alto]);

async function foto() {
  const porTabla = async <T extends object>(consulta: (t: string) => Promise<T[]>): Promise<Record<string, T[]>> => Object.fromEntries(await Promise.all(TABLAS.map(async (t): Promise<[string, T[]]> => [t, await consulta(t)])));
  return {
    columnas: await porTabla((t) => q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY 1`, [t])),
    restricciones: await porTabla((t) => q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = format('public.%I', $1::text)::regclass ORDER BY 1`, [t])),
    indices: await porTabla((t) => q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 ORDER BY 1`, [t])),
    politicas: await porTabla((t) => q(`SELECT policyname::text AS nombre, cmd::text, permissive::text, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY 1`, [t])),
    privilegios: await porTabla((t) => q(`SELECT privilege_type::text AS p FROM information_schema.role_table_grants WHERE table_name = $1 AND grantee = 'motor2_app' ORDER BY 1`, [t])),
    columnasConUpdate: await porTabla((t) => q(`SELECT column_name::text AS c FROM information_schema.column_privileges WHERE table_name = $1 AND grantee = 'motor2_app' AND privilege_type = 'UPDATE' ORDER BY 1`, [t])),
    disparadores: await q(`SELECT tgname::text AS nombre, tgrelid::regclass::text AS tabla FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text LIKE '"Portal%' ORDER BY 1`),
    funciones: await q(`SELECT p.proname::text AS nombre, pg_get_function_arguments(p.oid) AS argumentos FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (p.proname LIKE 'Portal%' OR p.proname IN ('texto_de_catalogo_valido','color_de_carta_valido','imagen_externa_valida')) ORDER BY 1`),
  };
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(MIGRACION);
  for (const e of [E, E2]) await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
  await q(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_portal',$1,'Centro'), ('suc_portal_2',$1,'Norte'), ('suc_ajena',$2,'Ajena')`, [E, E2]);
}, 300_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("Portal de la empresa PR-A (subir, bajar y subir)", () => {
  let primeraSubida: Awaited<ReturnType<typeof foto>>;

  it("ANTES: las tablas y las funciones no existen", async () => {
    for (const t of TABLAS) expect(await existe(t)).toBe(false);
    expect(await q(`SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('texto_de_catalogo_valido','color_de_carta_valido','imagen_externa_valida')`)).toEqual([{ n: 0 }]);
  });

  it("SUBIR: las tres tablas nacen vacías con su RLS por empresa, sus únicos, sus disparadores y los privilegios de la app (leer, agregar y cambiar solo las columnas con GRANT; sin borrar ni vaciar)", async () => {
    await correr("migration.sql");
    for (const t of TABLAS) {
      expect(await existe(t)).toBe(true);
      expect(await q(`SELECT count(*)::int AS n FROM "${t}"`)).toEqual([{ n: 0 }]);
    }
    const f = await foto();
    expect(f.indices.PortalDeEmpresa.map((i) => i.nombre)).toEqual(expect.arrayContaining(["PortalDeEmpresa_pkey", "PortalDeEmpresa_empresaId_key", "PortalDeEmpresa_codigo_key", "PortalDeEmpresa_empresaId_id_key"]));
    expect(f.indices.PortalTarjeta.map((i) => i.nombre)).toEqual(expect.arrayContaining(["PortalTarjeta_pkey"]));
    expect(f.indices.PortalZona.map((i) => i.nombre)).toEqual(expect.arrayContaining(["PortalZona_pkey", "PortalZona_empresaId_id_key", "PortalZona_portalId_sucursalId_key"]));
    for (const t of TABLAS) {
      expect(f.politicas[t].map((p) => p.nombre), t).toEqual(["aislamiento_empresa"]);
      expect(f.privilegios[t], t).toEqual([{ p: "INSERT" }, { p: "SELECT" }]);
      expect(await q(`SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', $1::text)::regclass`, [t]), t).toEqual([{ relrowsecurity: true }]);
      // Nunca DELETE ni TRUNCATE para la app (ocultar = `visible = false`).
      expect(await q(`SELECT has_table_privilege('motor2_app', format('public.%I', $1::text), 'DELETE, TRUNCATE') AS borra`, [t]), t).toEqual([{ borra: false }]);
    }
    expect(f.columnasConUpdate.PortalDeEmpresa.map((c) => c.c)).toEqual(["actualizadoEn", "colorDetras", "colorEncabezado", "colorPagina", "imagenCuenta", "imagenExtension", "imagenIdPublico", "imagenProveedor", "imagenVersion", "lineaSuperior", "logoVisible", "titulo", "variante", "version"]);
    // Ni el código, ni el id, ni la empresa, ni el autor se pueden cambiar (ni siquiera tienen privilegio de UPDATE).
    for (const inmutable of ["codigo", "id", "empresaId", "creadoPorId", "creadoEn"]) expect(f.columnasConUpdate.PortalDeEmpresa.map((c) => c.c)).not.toContain(inmutable);
    expect(f.columnasConUpdate.PortalTarjeta.map((c) => c.c)).toEqual(["actualizadoEn", "fotoCuenta", "fotoExtension", "fotoIdPublico", "fotoProveedor", "fotoVersion", "nombre", "orden", "telefono", "version", "visible"]);
    expect(f.columnasConUpdate.PortalZona.map((c) => c.c)).toEqual(["actualizadoEn", "alto", "ancho", "version", "visible", "x", "y"]);
    expect(f.columnas.PortalDeEmpresa.find((c) => c.columna === "id")).toMatchObject({ data_type: "uuid" });
    expect(f.columnas.PortalDeEmpresa.find((c) => c.columna === "actualizadoEn")).toMatchObject({ data_type: "timestamp with time zone", column_default: null });
    expect(f.columnas.PortalDeEmpresa.find((c) => c.columna === "variante")).toMatchObject({ column_default: "'A'::text" });
    expect(f.disparadores.map((d) => d.nombre)).toEqual(["PortalDeEmpresa_proteger", "PortalTarjeta_proteger", "PortalZona_proteger"]);
    primeraSubida = f;
  });

  it("la base decide el PORTAL: un segundo portal para la misma empresa (23505), un código repetido en TODA la plataforma aunque sea de otra empresa (23505), código corto o con signos (23514), variante fuera de la lista (23514), versión 0 (23514)", async () => {
    await portal(P1, CODIGO);
    expect(await falla(`INSERT INTO "PortalDeEmpresa" ("id","empresaId","codigo","creadoPorId","actualizadoEn") VALUES ($1,$2,$3,'u',now())`, [P2, E, CODIGO2])).toBe("23505");
    expect(await falla(`INSERT INTO "PortalDeEmpresa" ("id","empresaId","codigo","creadoPorId","actualizadoEn") VALUES ($1,$2,$3,'u',now())`, [P2, E2, CODIGO])).toBe("23505");
    for (const malo of ["A".repeat(21), "A".repeat(65), `${"A".repeat(21)}.`, `${"A".repeat(21)} `, `${"A".repeat(21)}/`, `${"A".repeat(21)}ñ`]) {
      expect(await falla(`INSERT INTO "PortalDeEmpresa" ("id","empresaId","codigo","creadoPorId","actualizadoEn") VALUES ($1,$2,$3,'u',now())`, [P2, E2, malo]), malo).toBe("23514");
    }
    expect(await falla(`INSERT INTO "PortalDeEmpresa" ("id","empresaId","codigo","creadoPorId","actualizadoEn","variante") VALUES ($1,$2,$3,'u',now(),'C')`, [P2, E2, CODIGO2])).toBe("23514");
    expect(await falla(`INSERT INTO "PortalDeEmpresa" ("id","empresaId","codigo","creadoPorId","actualizadoEn","version") VALUES ($1,$2,$3,'u',now(),0)`, [P2, E2, CODIGO2])).toBe("23514");
    expect(await falla(`INSERT INTO "PortalDeEmpresa" ("id","empresaId","codigo","creadoPorId","actualizadoEn") VALUES ('no-es-uuid',$1,$2,'u',now())`, [E2, CODIGO2])).toBe("22P02");
    expect(await q(`SELECT "variante", "logoVisible", "version" FROM "PortalDeEmpresa"`)).toEqual([{ variante: "A", logoVisible: true, version: 1 }]);
  });

  it("la base decide los textos, los colores y la imagen del portal: línea > 40 o título > 60 o con signos fuera de la lista (23514); color en mayúsculas, corto o `transparent` (23514); imagen con 4 de 5 partes o de otro proveedor o con extensión rara (23514); vacío (NULL) sí vale", async () => {
    const c = async (columna: string, valor: unknown) => {
      await base.cliente.query("BEGIN");
      try {
        await insertarPortal(P2, CODIGO2, columna, valor, E2);
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code ?? "error";
      } finally {
        await base.cliente.query("ROLLBACK");
      }
    };
    expect(await c("lineaSuperior", "a".repeat(40))).toBe("ok");
    expect(await c("lineaSuperior", "a".repeat(41))).toBe("23514");
    expect(await c("lineaSuperior", "")).toBe("23514");
    expect(await c("lineaSuperior", "<b>")).toBe("23514");
    expect(await c("titulo", "a".repeat(60))).toBe("ok");
    expect(await c("titulo", "a".repeat(61))).toBe("23514");
    expect(await c("titulo", "hola\nmundo")).toBe("23514");
    expect(await c("titulo", " hola")).toBe("23514");
    expect(await c("titulo", null)).toBe("ok");
    for (const columna of ["colorEncabezado", "colorPagina", "colorDetras"]) {
      expect(await c(columna, "#e5dfdf"), columna).toBe("ok");
      expect(await c(columna, "#E5DFDF"), columna).toBe("23514");
      expect(await c(columna, "#e5dfd"), columna).toBe("23514");
      expect(await c(columna, "transparent"), columna).toBe("23514");
      expect(await c(columna, null), columna).toBe("ok");
    }
    // La imagen: las cinco partes juntas o ninguna.
    const imagen = async (partes: Record<string, string | null>) => {
      await base.cliente.query("BEGIN");
      try {
        await base.cliente.query(
          `INSERT INTO "PortalDeEmpresa" ("id","empresaId","codigo","creadoPorId","actualizadoEn","imagenProveedor","imagenCuenta","imagenIdPublico","imagenVersion","imagenExtension") VALUES ($1,$2,$3,'u',now(),$4,$5,$6,$7,$8)`,
          [P2, E2, CODIGO2, partes.proveedor, partes.cuenta, partes.id, partes.version, partes.ext],
        );
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code ?? "error";
      } finally {
        await base.cliente.query("ROLLBACK");
      }
    };
    const completa = { proveedor: "CLOUDINARY", cuenta: "mi-cuenta", id: "carta/portal/fondo", version: "1700000000", ext: "jpg" };
    expect(await imagen(completa)).toBe("ok");
    expect(await imagen({ proveedor: null, cuenta: null, id: null, version: null, ext: null })).toBe("ok");
    for (const clave of Object.keys(completa)) expect(await imagen({ ...completa, [clave]: null }), `sin ${clave}`).toBe("23514");
    expect(await imagen({ ...completa, proveedor: "OTRO" })).toBe("23514");
    expect(await imagen({ ...completa, ext: "gif" })).toBe("23514");
    expect(await imagen({ ...completa, version: "0123" })).toBe("23514");
    expect(await imagen({ ...completa, id: "a//b" })).toBe("23514");
    expect(await imagen({ ...completa, cuenta: "Mayus" })).toBe("23514");
  });

  it("la base decide la TARJETA: el teléfono SOLO DÍGITOS de 1 a 40 (letras, espacios, `+` o 41 dígitos: 23514), el nombre con la lista del catálogo, el orden ≥ 0, una por (portal, sucursal) (23505), la sucursal de otra empresa (23503) y un portal ajeno (23503)", async () => {
    const t = async (columna: string | null, valor: unknown) => {
      await base.cliente.query("BEGIN");
      try {
        await insertarTarjeta(columna, valor);
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code ?? "error";
      } finally {
        await base.cliente.query("ROLLBACK");
      }
    };
    expect(await t(null, null)).toBe("ok");
    expect(await t("telefono", "1155551234")).toBe("ok");
    expect(await t("telefono", "0".repeat(40))).toBe("ok");
    expect(await t("telefono", "0".repeat(41))).toBe("23514");
    for (const malo of ["", "11 5555", "11-5555", "+5411555", "11555a", "１１５５", "1155\n"]) expect(await t("telefono", malo), JSON.stringify(malo)).toBe("23514");
    expect(await t("nombre", "Centro")).toBe("ok");
    expect(await t("nombre", "a".repeat(81))).toBe("23514");
    expect(await t("nombre", "<script>")).toBe("23514");
    expect(await falla(`INSERT INTO "PortalTarjeta" ("empresaId","portalId","sucursalId","orden","actualizadoEn") VALUES ($1,$2,'suc_portal',-1,now())`, [E, P1])).toBe("23514");
    await insertarTarjeta(null, null);
    expect(await falla(`INSERT INTO "PortalTarjeta" ("empresaId","portalId","sucursalId","orden","actualizadoEn") VALUES ($1,$2,'suc_portal',1,now())`, [E, P1])).toBe("23505");
    expect(await falla(`INSERT INTO "PortalTarjeta" ("empresaId","portalId","sucursalId","orden","actualizadoEn") VALUES ($1,$2,'suc_ajena',1,now())`, [E, P1])).toBe("23503");
    expect(await falla(`INSERT INTO "PortalTarjeta" ("empresaId","portalId","sucursalId","orden","actualizadoEn") VALUES ($1,$2,'suc_ajena',1,now())`, [E2, P1])).toBe("23503");
  });

  it("la base decide la ZONA: x, y ≥ 0; ancho, alto > 0; x + ancho ≤ 100 e y + alto ≤ 100 (23514); una por (portal, sucursal) (23505); la sucursal de otra empresa (23503)", async () => {
    const z = async (x: unknown, y: unknown, ancho: unknown, alto: unknown) => {
      await base.cliente.query("BEGIN");
      try {
        await insertarZona(Z1, x, y, ancho, alto);
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code ?? "error";
      } finally {
        await base.cliente.query("ROLLBACK");
      }
    };
    expect(await z(0, 0, 100, 100)).toBe("ok");
    expect(await z("12.5", "10", "30", "20.25")).toBe("ok");
    expect(await z(90, 0, 10, 10)).toBe("ok");
    expect(await z("90.01", 0, 10, 10)).toBe("23514");
    expect(await z(0, "95.5", 10, "4.51")).toBe("23514");
    expect(await z(-1, 0, 10, 10)).toBe("23514");
    expect(await z(0, -0.01, 10, 10)).toBe("23514");
    expect(await z(0, 0, 0, 10)).toBe("23514");
    expect(await z(0, 0, 10, 0)).toBe("23514");
    expect(await z(0, 0, 100.01, 10)).toMatch(/23514|22003/);
    expect(await z(100, 0, "0.01", 10)).toBe("23514");
    await insertarZona(Z1, 1, 1, 10, 10);
    expect(await falla(`INSERT INTO "PortalZona" ("id","empresaId","portalId","sucursalId","x","y","ancho","alto","actualizadoEn") VALUES ($1,$2,$3,'suc_portal',50,50,10,10,now())`, [Z2, E, P1])).toBe("23505");
    expect(await falla(`INSERT INTO "PortalZona" ("id","empresaId","portalId","sucursalId","x","y","ancho","alto","actualizadoEn") VALUES ($1,$2,$3,'suc_ajena',50,50,10,10,now())`, [Z2, E, P1])).toBe("23503");
  });

  it("la IDENTIDAD es inmutable por disparador (aunque quien escribe sea el dueño): el código, el id, la empresa, el autor y la fecha del portal; el portal, la empresa y la sucursal de una tarjeta y de una zona", async () => {
    // (La tarjeta y la zona de las pruebas anteriores siguen cargadas.)
    const portalEmpresa = "UPDATE \"PortalDeEmpresa\" SET ";
    expect(await falla(`${portalEmpresa}"codigo" = $1`, [CODIGO2])).toBe("23514");
    expect(await falla(`${portalEmpresa}"id" = $1::uuid`, [P2])).toBe("23514");
    expect(await falla(`${portalEmpresa}"empresaId" = $1`, [E2])).toBe("23514");
    expect(await falla(`${portalEmpresa}"creadoPorId" = 'otro'`)).toBe("23514");
    expect(await falla(`${portalEmpresa}"creadoEn" = now() + interval '1 day'`)).toBe("23514");
    expect(await falla(`UPDATE "PortalTarjeta" SET "sucursalId" = 'suc_portal_2'`)).toBe("23514");
    expect(await falla(`UPDATE "PortalTarjeta" SET "portalId" = $1::uuid`, [P2])).toMatch(/23514|23503/);
    expect(await falla(`UPDATE "PortalZona" SET "sucursalId" = 'suc_portal_2'`)).toBe("23514");
    expect(await falla(`UPDATE "PortalZona" SET "id" = $1::uuid`, [Z2])).toBe("23514");
    // Lo que SÍ se cambia (con la versión que sube la aplicación) anda.
    expect(await falla(`${portalEmpresa}"titulo" = 'Nuevo', "version" = "version" + 1, "actualizadoEn" = now()`)).toBe("sin error");
  });

  it("la RLS: la política por empresa tiene USING y WITH CHECK con `app_empresa_actual()` y no hay políticas por sucursal (es de la empresa entera)", async () => {
    const f = await foto();
    for (const t of TABLAS) {
      expect(f.politicas[t]).toHaveLength(1);
      expect(f.politicas[t][0]).toMatchObject({ nombre: "aislamiento_empresa", cmd: "ALL" });
      expect(String(f.politicas[t][0]!.qual)).toContain("app_empresa_actual()");
      expect(String(f.politicas[t][0]!.with_check)).toContain("app_empresa_actual()");
    }
  });

  describe("PRUEBA ESPEJO: la base acepta exactamente lo que el código acepta", () => {
    const TEXTOS = [
      "Nuestros restaurantes", "¿Dónde querés comer?", "2x1 50% $500", "Hola, mundo", "a", "a".repeat(40), "a".repeat(41), "a".repeat(60), "a".repeat(61), "a".repeat(80), "a".repeat(81), "", " ", " hola", "hola ", "hola  mundo", "+54 11", "-5", "5-5", "=SUMA(1)", "@usuario", "<b>", "hola>", "hola_mundo", "hola\nmundo", "hola\tmundo",
      "hola​mundo", "hola mundo", "👍", "ñandú", "Ñoño", "Café ® ™", "“comillas” – raya — larga", "«francés»", "100%", "#1", "a/b", "a:b;c", "(a)", "a'b", 'a"b', "a`b", "a|b", "a\\b", "a~b", "a^b", "a{b}", "a[b]", "ß", "Œuvre", "Ž", "×", "÷", "Ā", "中文", "אבג", "٠١٢", "hola…",
    ];

    it("texto de catálogo: lo que la base acepta lo acepta el código y es su forma canónica; lo que el código acepta (ya canónico) lo acepta la base — línea (40), título (60) y nombre de tarjeta (80)", async () => {
      const casos: Array<[number, (t: string) => { ok: boolean; valor?: string }]> = [
        [40, (t) => lineaDelPortalDesdeTexto(t)],
        [60, (t) => tituloDelPortalDesdeTexto(t)],
        [80, (t) => textoDeFichaDesdeTexto("ELECCION", t)],
      ];
      for (const [maximo, codigo] of casos) {
        for (const texto of TEXTOS) {
          const enBase = (await q<{ v: boolean }>(`SELECT texto_de_catalogo_valido($1, $2) AS v`, [texto, maximo]))[0]!.v;
          const r = codigo(texto);
          // La base es más laxa en UNA cosa a propósito: no colapsa espacios repetidos (la forma canónica la produce el código). Todo lo demás que la base acepta, el código lo acepta.
          if (enBase) expect(r.ok, `${maximo}: la base acepta ${JSON.stringify(texto)} y el código no`).toBe(true);
          if (enBase && r.ok) expect(r.valor, `${maximo}: ${JSON.stringify(texto)}`).toBe(texto.replace(/ {2,}/g, " "));
          if (r.ok) expect((await q<{ v: boolean }>(`SELECT texto_de_catalogo_valido($1, $2) AS v`, [r.valor, maximo]))[0]!.v, `${maximo}: el código acepta ${JSON.stringify(texto)} (${JSON.stringify(r.valor)}) y la base no`).toBe(true);
        }
      }
      expect((await q<{ v: boolean }>(`SELECT texto_de_catalogo_valido(NULL, 40) AS v`))[0]!.v).toBe(false);
    });

    it("color: la función de la base y `esColorDePortalValido` coinciden", async () => {
      for (const color of ["#000000", "#e5dfdf", "#abcdef", "#ABCDEF", "#abc", "#abcdeg", "abcdef", "#abcdef ", "transparent", "#abcdef0", "", " #abcdef", "#ａｂｃｄｅｆ", "#abcdef\n"]) {
        expect((await q<{ v: boolean }>(`SELECT color_de_carta_valido($1) AS v`, [color]))[0]!.v, JSON.stringify(color)).toBe(esColorDePortalValido(color));
      }
    });

    it("imagen por partes: la función de la base y `sonPartesDeImagenValidas` coinciden en una grilla de casos buenos y malos", async () => {
      const buena = { proveedor: "CLOUDINARY", cuenta: "mi-cuenta", idPublico: "carta/portal/fondo", version: "1700000000", extension: "jpg" };
      const variantes: Array<Partial<Record<keyof typeof buena, string>>> = [
        {}, { proveedor: "OTRO" }, { cuenta: "" }, { cuenta: "a".repeat(64) }, { cuenta: "a".repeat(65) }, { cuenta: "Mayus" }, { cuenta: "con.punto" }, { idPublico: "x" }, { idPublico: "a".repeat(200) }, { idPublico: "a".repeat(201) }, { idPublico: "" }, { idPublico: "a//b" }, { idPublico: "/a" },
        { idPublico: "a/" }, { idPublico: "a.b" }, { idPublico: "a b" }, { idPublico: "ñ" }, { idPublico: "a-b_c/d" }, { version: "0" }, { version: "01" }, { version: "1" }, { version: "999999999999" }, { version: "1234567890123" }, { version: "12a" }, { version: "" },
        { extension: "jpeg" }, { extension: "png" }, { extension: "webp" }, { extension: "gif" }, { extension: "JPG" }, { extension: "" },
      ];
      for (const v of variantes) {
        const partes = { ...buena, ...v };
        const enBase = (await q<{ v: boolean }>(`SELECT imagen_externa_valida($1,$2,$3,$4,$5) AS v`, [partes.proveedor, partes.cuenta, partes.idPublico, partes.version, partes.extension]))[0]!.v;
        expect(enBase, JSON.stringify(v)).toBe(sonPartesDeImagenValidas(partes));
      }
      // Todas o ninguna: `NULL` en las cinco vale; en una sola, no.
      expect((await q<{ v: boolean }>(`SELECT imagen_externa_valida(NULL,NULL,NULL,NULL,NULL) AS v`))[0]!.v).toBe(true);
      expect((await q<{ v: boolean }>(`SELECT imagen_externa_valida('CLOUDINARY',NULL,NULL,NULL,NULL) AS v`))[0]!.v).toBe(false);
    });

    it("teléfono: el CHECK de la base y `esTelefonoDeTarjetaValido` coinciden (solo dígitos, 1 a 40)", async () => {
      await base.cliente.query("BEGIN");
      for (const t of ["1", "1155551234", "0".repeat(40), "0".repeat(41), "", " ", "11 5555", "11-5555", "+54115555", "(011)5555", "11555a", "１１５５", "1155\n", " 1155", "1155 ", "1e5", "0x10"]) {
        const enBase = (await q<{ v: boolean }>(`SELECT ($1::text ~ '^[0-9]{1,40}$') AS v`, [t]))[0]!.v;
        expect(esTelefonoDeTarjetaValido(t), JSON.stringify(t)).toBe(enBase);
        // Y el CHECK de la tabla es ESA misma expresión: la tarjeta con ese teléfono entra si y solo si vale.
        await base.cliente.query("SAVEPOINT s");
        let entra = true;
        try {
          await base.cliente.query(`INSERT INTO "PortalTarjeta" ("empresaId","portalId","sucursalId","orden","actualizadoEn","telefono") VALUES ($1,$2,'suc_portal_2',0,now(),$3)`, [E, P1, t]);
        } catch {
          entra = false;
        }
        await base.cliente.query("ROLLBACK TO SAVEPOINT s");
        expect(entra, JSON.stringify(t)).toBe(enBase);
      }
      await base.cliente.query("ROLLBACK");
    });
  });

  it("BAJAR CON FILAS aborta (los QR impresos dependen del código) y no pierde nada; con las tablas vacías baja, y bajar dos veces no falla", async () => {
    expect(await falla(leer("down.sql"))).toBe("P0001");
    expect(await q(`SELECT count(*)::int AS n FROM "PortalDeEmpresa"`)).toEqual([{ n: 1 }]);
    await q(`DELETE FROM "PortalZona"`);
    await q(`DELETE FROM "PortalTarjeta"`);
    await q(`DELETE FROM "PortalDeEmpresa"`);
    await correr("down.sql");
    for (const t of TABLAS) expect(await existe(t)).toBe(false);
    expect(await q(`SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('texto_de_catalogo_valido','color_de_carta_valido','imagen_externa_valida','PortalDeEmpresa_proteger','PortalTarjeta_proteger','PortalZona_proteger')`)).toEqual([{ n: 0 }]);
    await correr("down.sql");
  });

  it("SUBIR OTRA VEZ: el catálogo (columnas, restricciones, índices, políticas, privilegios, disparadores y funciones) queda idéntico al de la primera subida", async () => {
    await correr("migration.sql");
    expect(await foto()).toEqual(primeraSubida);
  });
});

import { describe, expect, it } from "vitest";
import { ALCANCE_DE_TABLAS, TABLAS_CON_POLITICA_DE_SUCURSAL, tablasConAlcance } from "../setup/clasificacion-de-tablas";
import {
  COMANDOS_CON_POLITICA_DE_ALCANCE,
  ROL_DE_LA_APP,
  nombreDePoliticaDeAlcance,
  sqlDeAlcanceDeSucursal,
  sqlDeFuncionesDeAlcance,
  sqlDePoliticasDeAlcance,
  sqlDeReversaDeAlcanceDeSucursal,
  sqlDeReversaDePoliticasDeAlcance,
} from "../setup/politicas-de-alcance-de-sucursal";

/**
 * M.3, Fase A, paso A9: el SQL de las políticas de RLS por sucursal se DERIVA de la clasificación (`ALCANCE_DE_TABLAS`); este test verifica su FORMA, sin base de datos. La prueba contra
 * Postgres (se aplica sobre una base migrada, se revierte y se vuelve a aplicar) está en `test/aislamiento/borrador-de-politicas-de-sucursal.test.ts`. El escenario de aislamiento completo
 * (dos sucursales, cruces, concurrencia) es del paso A10.
 *
 * El SQL NO está en `prisma/migrations` (es la Fase B y necesita la orden del dueño): es la salida del generador.
 *
 * `defectosDelSql(...)` es una función pura sobre el TEXTO del SQL: el test la corre contra el SQL real (tiene que dar vacío) y contra SQL mutado a propósito (tiene que dar rojo).
 */
const TODAS = TABLAS_CON_POLITICA_DE_SUCURSAL;
const SIN_POLITICA = [...tablasConAlcance("GOBIERNO"), ...tablasConAlcance("DE_EMPRESA"), ...tablasConAlcance("SIN_EMPRESA")];

const sinComentarios = (sql: string) => sql.replace(/^\s*--.*$/gm, "");
const sentencias = (sql: string) =>
  sinComentarios(sql)
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

interface Politica {
  nombre: string;
  tabla: string;
  tipo: string;
  comando: string;
  rol: string;
  usando: string | null;
  conCheck: string | null;
}

function leerPoliticas(sql: string): Politica[] {
  return sentencias(sql)
    .filter((s) => s.startsWith("CREATE POLICY"))
    .map((s) => {
      const cabecera = /^CREATE POLICY (\w+) ON "(\w+)"\s+AS (\w+)\s+FOR (\w+)\s+TO (\w+)/.exec(s);
      if (!cabecera) throw new Error(`política con forma inesperada: ${s.slice(0, 120)}`);
      const usando = /\bUSING \(([\s\S]*?)\)\s*(?:WITH CHECK|$)/.exec(s);
      const conCheck = /\bWITH CHECK \(([\s\S]*)\)$/.exec(s);
      return { nombre: cabecera[1], tabla: cabecera[2], tipo: cabecera[3], comando: cabecera[4], rol: cabecera[5], usando: usando ? usando[1] : null, conCheck: conCheck ? conCheck[1] : null };
    });
}

/** Todo lo que está mal en el SQL de alta (vacío = tiene la forma que se promete). */
function defectosDelSql(sql: string, tablasEsperadas: readonly string[]): string[] {
  const defectos: string[] = [];
  const mal = (m: string) => defectos.push(m);

  // Solo se crean funciones y políticas (y sus comentarios): nada destructivo ni ajeno.
  for (const s of sentencias(sql)) {
    if (!/^(CREATE OR REPLACE FUNCTION app_sucursales_(lectura|escritura)\(\)|CREATE POLICY alcance_sucursal_|COMMENT ON FUNCTION app_sucursales_(lectura|escritura)\(\))/.test(s)) mal(`sentencia ajena: ${s.slice(0, 80)}`);
  }
  if (/\b(DROP|TRUNCATE|ALTER|GRANT|REVOKE|DISABLE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+"|CASCADE|SECURITY\s+DEFINER|BYPASSRLS|FORCE)\b/i.test(sinComentarios(sql))) mal("contiene una palabra destructiva o que cambia privilegios");

  const politicas = leerPoliticas(sql);
  const porTabla = new Map<string, Politica[]>();
  for (const p of politicas) porTabla.set(p.tabla, [...(porTabla.get(p.tabla) ?? []), p]);
  if (JSON.stringify([...porTabla.keys()].sort()) !== JSON.stringify([...tablasEsperadas].sort())) mal(`las tablas con política no son las esperadas (${[...porTabla.keys()].length} contra ${tablasEsperadas.length})`);

  for (const [tabla, ps] of porTabla) {
    if (ps.length !== COMANDOS_CON_POLITICA_DE_ALCANCE.length) mal(`${tabla}: ${ps.length} políticas, tienen que ser ${COMANDOS_CON_POLITICA_DE_ALCANCE.length}`);
    for (const comando of COMANDOS_CON_POLITICA_DE_ALCANCE) {
      const p = ps.filter((x) => x.comando.toLowerCase() === comando);
      if (p.length !== 1) {
        mal(`${tabla}: ${p.length} políticas FOR ${comando.toUpperCase()}`);
        continue;
      }
      const { nombre, tipo, rol, usando, conCheck } = p[0];
      if (nombre !== nombreDePoliticaDeAlcance(comando)) mal(`${tabla}/${comando}: nombre ${nombre}`);
      if (tipo !== "RESTRICTIVE") mal(`${tabla}/${comando}: es ${tipo}, tiene que ser RESTRICTIVE (una PERMISSIVE se suma a la de empresa en vez de acotarla)`);
      if (rol !== ROL_DE_LA_APP) mal(`${tabla}/${comando}: TO ${rol}, tiene que ser TO ${ROL_DE_LA_APP}`);
      const lectura = comando === "select";
      const funcion = lectura ? "app_sucursales_lectura" : "app_sucursales_escritura";
      const otra = lectura ? "app_sucursales_escritura" : "app_sucursales_lectura";
      for (const [lugar, texto, debeEstar] of [
        ["USING", usando, comando !== "insert"],
        ["WITH CHECK", conCheck, comando === "insert" || comando === "update"],
      ] as const) {
        if (debeEstar && texto === null) mal(`${tabla}/${comando}: falta ${lugar}`);
        if (!debeEstar && texto !== null) mal(`${tabla}/${comando}: no debería llevar ${lugar}`);
        if (texto !== null) {
          if (!texto.includes(`${funcion}()`)) mal(`${tabla}/${comando}: ${lugar} no usa ${funcion}()`);
          if (texto.includes(`${otra}()`)) mal(`${tabla}/${comando}: ${lugar} usa ${otra}()`);
          if (texto.includes(`"${tabla}".`)) mal(`${tabla}/${comando}: ${lugar} califica la tabla propia (subconsulta correlacionada)`);
          const cantidadDeAny = (texto.match(/ANY\(/g) ?? []).length;
          const cantidadBienEscrita = (texto.match(/ANY\(\(SELECT app_sucursales_(?:lectura|escritura)\(\)\)::text\[\]\)/g) ?? []).length;
          if (cantidadDeAny !== cantidadBienEscrita) mal(`${tabla}/${comando}: ANY mal escrito (tiene que ser ANY((SELECT función())::text[]): sin la conversión Postgres lo lee como subconsulta)`);
        }
      }
    }
  }

  // Las dos funciones: text[], STABLE, falla cerrado (NULLIF), leen su variable con `missing_ok`.
  const funciones = sentencias(sql).filter((s) => s.startsWith("CREATE OR REPLACE FUNCTION"));
  if (tablasEsperadas.length > 0 || funciones.length > 0) {
    for (const f of ["lectura", "escritura"]) {
      const cuerpo = funciones.find((s) => s.includes(`app_sucursales_${f}()`));
      if (!cuerpo) {
        if (funciones.length > 0) mal(`falta la función app_sucursales_${f}()`);
        continue;
      }
      if (!cuerpo.includes("RETURNS text[]") || !/\bSTABLE\b/.test(cuerpo)) mal(`app_sucursales_${f}(): tiene que ser text[] y STABLE`);
      if (!cuerpo.includes(`current_setting('app.sucursales_${f}', true)`) || !cuerpo.includes("NULLIF")) mal(`app_sucursales_${f}(): tiene que leer su variable con missing_ok y devolver NULL si falta o está vacía`);
    }
  }
  return defectos;
}

const SQL = sqlDeAlcanceDeSucursal();
const politicas = leerPoliticas(SQL);

describe("el SQL de las políticas de sucursal generado desde la clasificación tiene la forma prometida", () => {
  it("el SQL real no tiene ningún defecto", () => {
    expect(TODAS.length, "31 tablas con política en la clasificación del plan").toBe(31);
    expect(defectosDelSql(SQL, TODAS)).toEqual([]);
  });

  it("cuatro políticas por tabla (SELECT, INSERT, UPDATE, DELETE), todas RESTRICTIVE y TO motor2_app", () => {
    expect(politicas).toHaveLength(TODAS.length * 4);
    for (const p of politicas) {
      expect(p.tipo, `${p.tabla}/${p.comando}`).toBe("RESTRICTIVE");
      expect(p.rol, `${p.tabla}/${p.comando}`).toBe("motor2_app");
    }
    expect([...new Set(politicas.map((p) => p.tabla))].sort()).toEqual([...TODAS].sort());
  });

  it("ninguna tabla GOBIERNO, DE_EMPRESA ni SIN_EMPRESA tiene política", () => {
    expect(SIN_POLITICA.length + TODAS.length, "las 70 tablas").toBe(Object.keys(ALCANCE_DE_TABLAS).length);
    const conPolitica = new Set(politicas.map((p) => p.tabla));
    for (const t of SIN_POLITICA) expect(conPolitica.has(t), t).toBe(false);
  });

  it("lectura en SELECT; escritura en INSERT (WITH CHECK), UPDATE (USING y WITH CHECK) y DELETE (USING)", () => {
    const seccion = Object.fromEntries(politicas.filter((p) => p.tabla === "Seccion").map((p) => [p.comando, p]));
    expect(seccion.SELECT).toMatchObject({ usando: `"sucursalId" = ANY((SELECT app_sucursales_lectura())::text[])`, conCheck: null });
    expect(seccion.INSERT).toMatchObject({ usando: null, conCheck: `"sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])` });
    expect(seccion.UPDATE).toMatchObject({ usando: `"sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])`, conCheck: `"sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])` });
    expect(seccion.DELETE).toMatchObject({ usando: `"sucursalId" = ANY((SELECT app_sucursales_escritura())::text[])`, conCheck: null });
  });

  it("las hijas verifican la sucursal de su padre con una subconsulta NO correlacionada, a lo largo de toda la cadena", () => {
    const insert = (tabla: string) => politicas.find((p) => p.tabla === tabla && p.comando === "INSERT")!.conCheck;
    const escritura = "ANY((SELECT app_sucursales_escritura())::text[])";
    expect(insert("MovimientoStock")).toBe(`"seccionId" IN (SELECT "id" FROM "Seccion" WHERE "sucursalId" = ${escritura})`);
    expect(insert("Cuenta")).toBe(`"mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ${escritura})`);
    expect(insert("CuentaItem")).toBe(`"cuentaId" IN (SELECT "id" FROM "Cuenta" WHERE "mesaId" IN (SELECT "id" FROM "Mesa" WHERE "sucursalId" = ${escritura}))`);
    // Cadena de tres niveles con padre PROPIA_O_EMPRESA (la receta central, NULL, es de la empresa).
    const nula = `("sucursalId" = ${escritura} OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))`;
    expect(insert("RecetaPasoIngrediente")).toBe(`"recetaPasoId" IN (SELECT "id" FROM "RecetaPaso" WHERE "recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ${nula}))`);
    expect(insert("SustitutoRecetaIngrediente")).toBe(`"recetaIngredienteId" IN (SELECT "id" FROM "RecetaIngrediente" WHERE "recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ${nula}))`);
    for (const hija of tablasConAlcance("HEREDADA")) for (const p of politicas.filter((x) => x.tabla === hija)) expect(`${p.usando ?? ""}${p.conCheck ?? ""}`, `${hija}/${p.comando}`).toContain("IN (SELECT");
  });

  it("PROPIA_O_EMPRESA: NULL es de la empresa y se ve, pero solo con un alcance fijado (sin variable falla cerrado)", () => {
    const lectura = politicas.find((p) => p.tabla === "RegistroAuditoria" && p.comando === "SELECT")!.usando;
    expect(lectura).toBe(`("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_lectura()) IS NOT NULL))`);
  });

  it("TraspasoSucursal (ENTRE_SUCURSALES): visible y escribible desde el origen o desde el destino", () => {
    const lectura = politicas.find((p) => p.tabla === "TraspasoSucursal" && p.comando === "SELECT")!.usando;
    expect(lectura).toBe(`("origenSucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_lectura())::text[]))`);
    const escritura = politicas.find((p) => p.tabla === "TraspasoSucursal" && p.comando === "INSERT")!.conCheck;
    expect(escritura).toBe(`("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]))`);
  });

  it("las funciones leen su variable con missing_ok, devuelven NULL si falta o está vacía, y la lectura efectiva incluye la escritura", () => {
    const funciones = sqlDeFuncionesDeAlcance();
    expect(defectosDelSql(funciones, [])).toEqual([]);
    expect(funciones).toContain("RETURNS text[]");
    expect(funciones).toContain("current_setting('app.sucursales_lectura', true)");
    expect(funciones).toContain("current_setting('app.sucursales_escritura', true)");
    const lectura = sentencias(funciones).find((s) => s.includes("FUNCTION app_sucursales_lectura()"))!;
    expect(lectura, "lectura efectiva = lectura ∪ escritura").toContain("current_setting('app.sucursales_escritura', true)");
  });

  it("se puede generar para un subconjunto de tablas (un grupo de migración de la Fase B) y rechaza las que no llevan política", () => {
    const grupo = ["Mesa", "Cuenta", "CuentaItem"];
    const parcial = sqlDePoliticasDeAlcance(grupo);
    expect(leerPoliticas(parcial).map((p) => p.tabla)).toEqual([...grupo].sort().flatMap((t) => [t, t, t, t]));
    expect(parcial).not.toContain("CREATE OR REPLACE FUNCTION");
    expect(defectosDelSql(parcial, grupo)).toEqual([]);
    for (const t of ["Sucursal", "UsuarioSucursal", "Producto", "User", "Fantasma"]) expect(() => sqlDePoliticasDeAlcance([t]), t).toThrow();
    expect(() => sqlDePoliticasDeAlcance(['Mesa"; DROP TABLE "Mesa'])).toThrow();
  });

  it("es determinista: dos corridas dan el mismo texto, ordenado por tabla", () => {
    expect(sqlDeAlcanceDeSucursal()).toBe(SQL);
    const tablas = [...new Set(politicas.map((p) => p.tabla))];
    expect(tablas).toEqual([...tablas].sort());
  });
});

describe("la reversa: solo DROP POLICY / DROP FUNCTION con IF EXISTS, las políticas antes que las funciones", () => {
  const REVERSA = sqlDeReversaDeAlcanceDeSucursal();

  it("borra exactamente lo que el alta crea y nada más", () => {
    const s = sentencias(REVERSA);
    const drops = s.filter((x) => x.startsWith("DROP POLICY IF EXISTS"));
    expect(drops).toHaveLength(TODAS.length * 4);
    expect(drops.map((d) => /^DROP POLICY IF EXISTS (\w+) ON "(\w+)"$/.exec(d)!.slice(1).join("@")).sort()).toEqual(politicas.map((p) => `${p.nombre}@${p.tabla}`).sort());
    expect(s.filter((x) => x.startsWith("DROP FUNCTION IF EXISTS"))).toEqual(["DROP FUNCTION IF EXISTS app_sucursales_lectura()", "DROP FUNCTION IF EXISTS app_sucursales_escritura()"]);
    expect(s).toHaveLength(drops.length + 2);
    expect(s.slice(-2).every((x) => x.startsWith("DROP FUNCTION"))).toBe(true);
    expect(REVERSA).not.toMatch(/CASCADE|DROP TABLE|TRUNCATE|DELETE FROM|ALTER/i);
  });

  it("la reversa de un grupo no toca las funciones", () => {
    expect(sqlDeReversaDePoliticasDeAlcance(["Mesa"])).not.toContain("FUNCTION");
    expect(sentencias(sqlDeReversaDePoliticasDeAlcance(["Mesa"]))).toHaveLength(4);
  });
});

describe("mutaciones: el verificador de forma se pone en rojo ante cada cambio que dejaría pasar un aislamiento roto", () => {
  const rojo = (sql: string, esperado: string) => expect(defectosDelSql(sql, TODAS).join("\n")).toContain(esperado);

  it("quitar AS RESTRICTIVE de una política (queda PERMISSIVE) da rojo", () => rojo(SQL.replace("ON \"Mesa\" AS RESTRICTIVE FOR SELECT", "ON \"Mesa\" AS PERMISSIVE FOR SELECT"), "Mesa/select: es PERMISSIVE"));
  it("quitar TO motor2_app (o apuntarla a otro rol) da rojo", () => rojo(SQL.replace(/(ON "Mesa"\s+AS RESTRICTIVE FOR INSERT) TO motor2_app/, "$1 TO PUBLIC"), "Mesa/insert: TO PUBLIC"));
  it("una política sobre una tabla de GOBIERNO da rojo", () =>
    rojo(`${SQL};\nCREATE POLICY alcance_sucursal_select ON "Sucursal" AS RESTRICTIVE FOR SELECT TO motor2_app USING ("id" = ANY((SELECT app_sucursales_lectura())::text[]))`, "las tablas con política no son las esperadas"));
  it("falta una política (la de DELETE de Seccion) da rojo", () => rojo(SQL.replace(/CREATE POLICY alcance_sucursal_delete ON "Seccion"[\s\S]*?;\n/, ""), "Seccion: 3 políticas"));
  it("usar la función de lectura en un INSERT (o la de escritura en un SELECT) da rojo", () => {
    rojo(SQL.replace(/(FOR INSERT TO motor2_app\s+WITH CHECK \("sucursalId" = ANY\(\(SELECT )app_sucursales_escritura/, "$1app_sucursales_lectura"), "usa app_sucursales_lectura()");
    rojo(SQL.replace(/(ON "Operacion"\s+AS RESTRICTIVE FOR SELECT TO motor2_app\s+USING \("sucursalId" = ANY\(\(SELECT )app_sucursales_lectura/, "$1app_sucursales_escritura"), "Operacion/select: USING usa app_sucursales_escritura()");
  });
  it("ANY((SELECT …)) sin la conversión a text[] (Postgres lo lee como subconsulta y falla en ejecución) da rojo", () =>
    rojo(SQL.replace('"sucursalId" = ANY((SELECT app_sucursales_lectura())::text[])', '"sucursalId" = ANY((SELECT app_sucursales_lectura()))'), "ANY mal escrito"));
  it("una sentencia destructiva o ajena (DROP TABLE, GRANT, ALTER) da rojo", () => {
    rojo(`${SQL};\nDROP TABLE "Seccion"`, "sentencia ajena");
    rojo(`${SQL};\nGRANT ALL ON "Seccion" TO motor2_app`, "palabra destructiva");
  });
  it("una función SECURITY DEFINER, o una que no falla cerrado (sin NULLIF), da rojo", () => {
    rojo(SQL.replace("LANGUAGE sql STABLE", "LANGUAGE sql STABLE SECURITY DEFINER"), "palabra destructiva");
    rojo(SQL.replace("NULLIF(current_setting('app.sucursales_escritura', true), '')", "current_setting('app.sucursales_escritura', true)"), "devolver NULL si falta");
  });
});

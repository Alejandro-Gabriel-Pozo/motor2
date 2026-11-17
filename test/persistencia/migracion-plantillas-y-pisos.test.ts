import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { semillaDePlantillas } from "../../src/core/permisos/plantillas-y-pisos";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { MARCA_DE_FIN, MARCA_DE_INICIO, cuentasDeLaSemilla, sentenciasDelBloque, sqlDeLaSemilla } from "../setup/semilla-de-plantillas-sql";
import { MATRIZ_ESPERADA } from "../permisos/matriz-esperada";

/**
 * Plantillas y pisos (roles propios, EB-1) — migración 20261117100400_plantillas_y_pisos: tablas, candados y SEMILLA (3 plantillas, 14 pisos, la versión 1 de ADMINISTRADOR y de OPERADOR, todas las acciones como
 * introducidas). Base temporal armada migración por migración (las anteriores aplicadas, la nuestra a mano). También prueba `down.sql` (ABORTA si la plataforma cargó algo a mano; con la semilla pura borra todo, es repetible y la
 * migración se puede volver a subir) y que `verificacion-previa.sql` corre y es de solo lectura.
 *
 * MUTACIONES (a mano, una por una, ya REVERTIDAS; cada una puso rojo lo que dice):
 *  (5) sacar la excepción de ADMINISTRADOR en `incumplimiento_de_pisos` → la semilla falla al MIGRAR (ADMINISTRADOR v1 lleva las 12 SOLO_GERENTE del gobierno): rojo el `beforeAll` de este archivo.
 *  (10) sacar el freno (el `RAISE`) de `down.sql` → rojo «down.sql ABORTA, sin tocar nada, si hay una versión 2 o un piso cambiado a mano».
 */
const NOMBRE = "20261117100400_plantillas_y_pisos";
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");
const ordenadas = (xs: readonly string[]) => [...xs].sort();

describe("migración de plantillas y pisos: semilla, candados y reversa", () => {
  let base: BaseTemporalMigrada;
  const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);
  const cuentas = async () => (await q(`SELECT (SELECT count(*)::int FROM "PlantillaDeRol") AS plantillas, (SELECT count(*)::int FROM "VersionDePlantilla") AS versiones, (SELECT count(*)::int FROM "PisoDePlataforma") AS pisos, (SELECT count(*)::int FROM "AccionIntroducida") AS introducidas`)).rows[0];
  /** Deja las cuatro tablas como la migración (el dueño puede TRUNCATE) y vuelve a sembrar con el bloque de la migración. */
  const resembrar = async () => {
    await q(`TRUNCATE TABLE "VersionDePlantilla", "PisoDePlataforma", "AccionIntroducida", "PlantillaDeRol"`);
    for (const s of sentenciasDelBloque(leer("migration.sql").slice(leer("migration.sql").indexOf(MARCA_DE_INICIO)))) await q(s);
  };

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(NOMBRE);
    await q(leer("migration.sql"));
  }, 240_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("el bloque de semilla de la migración es EXACTAMENTE lo que genera el catálogo (si el catálogo cambia, se regenera el bloque)", () => {
    const texto = leer("migration.sql");
    const desde = texto.indexOf(MARCA_DE_INICIO);
    const hasta = texto.indexOf(MARCA_DE_FIN);
    expect(desde).toBeGreaterThan(-1);
    expect(texto.slice(desde, hasta + MARCA_DE_FIN.length)).toBe(sqlDeLaSemilla());
  });

  it("deja 3 plantillas, 2 versiones número 1, los pisos y una acción introducida por cada clave del catálogo", async () => {
    const s = cuentasDeLaSemilla();
    expect(await cuentas()).toEqual({ plantillas: s.plantillas, versiones: s.versiones, pisos: s.pisos, introducidas: s.introducidas });
    expect((await q(`SELECT "clave" FROM "PlantillaDeRol" ORDER BY 1`)).rows.map((r) => r.clave)).toEqual(["ADMINISTRADOR", "GERENTE", "OPERADOR"]);
    expect((await q(`SELECT "plantillaClave", "numero", "autor" FROM "VersionDePlantilla" ORDER BY 1`)).rows).toEqual([
      { plantillaClave: "ADMINISTRADOR", numero: 1, autor: "migracion:plantillas_y_pisos" },
      { plantillaClave: "OPERADOR", numero: 1, autor: "migracion:plantillas_y_pisos" },
    ]);
  });

  it("las filas son las de la semilla del código Y las de la matriz esperada escrita aparte (listas, pisos e introducidas), y todas las claves existen en el catálogo", async () => {
    const semilla = semillaDePlantillas();
    const catalogo = new Set(ACCIONES.map((a) => a.clave));
    const versiones = (await q(`SELECT "plantillaClave", "accionesVer", "accionesEditar" FROM "VersionDePlantilla"`)).rows;
    for (const [plantilla, rol] of [["ADMINISTRADOR", "admin"], ["OPERADOR", "operador"]] as const) {
      const fila = versiones.find((v) => v.plantillaClave === plantilla)!;
      const esperadas = ordenadas(Object.entries(MATRIZ_ESPERADA).filter(([, f]) => (f.roles as readonly string[]).includes(rol)).map(([clave]) => clave));
      expect(ordenadas(fila.accionesVer), plantilla).toEqual(esperadas);
      expect(ordenadas(fila.accionesEditar), plantilla).toEqual(esperadas);
      expect(ordenadas(fila.accionesVer)).toEqual(semilla.versiones[plantilla].ver);
      for (const c of [...fila.accionesVer, ...fila.accionesEditar]) expect(catalogo.has(c), c).toBe(true);
    }
    const pisos = (await q(`SELECT "accionClave", "tipo", "version" FROM "PisoDePlataforma" ORDER BY 1`)).rows;
    expect(pisos.map((p) => [p.accionClave, p.tipo, p.version])).toEqual(semilla.pisos.map((p) => [p.accionClave, p.tipo, 1]));
    expect(ordenadas(Object.entries(MATRIZ_ESPERADA).filter(([, f]) => f.nivelMinimo === "gerente" || f.nivelMinimo === "administrador_sistema").map(([c]) => c))).toEqual(pisos.map((p) => p.accionClave));
    expect((await q(`SELECT "accionClave" FROM "AccionIntroducida" ORDER BY 1`)).rows.map((r) => r.accionClave)).toEqual(ordenadas(ACCIONES.map((a) => a.clave)));
  });

  it("la semilla es idempotente: volver a correr su bloque no duplica ni cambia nada", async () => {
    const antes = await cuentas();
    for (const s of sentenciasDelBloque(sqlDeLaSemilla())) await q(s);
    expect(await cuentas()).toEqual(antes);
  });

  it("los candados quedan puestos: RLS en las cuatro tablas y la política solo_plataforma de cada una", async () => {
    const tablas = "'PlantillaDeRol','VersionDePlantilla','PisoDePlataforma','AccionIntroducida'";
    const rls = (await q(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN (${tablas}) AND relkind = 'r' ORDER BY relname`)).rows;
    expect(rls).toHaveLength(4);
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
    const politicas = (await q(`SELECT tablename, policyname FROM pg_policies WHERE tablename IN (${tablas}) ORDER BY 1, 2`)).rows.map((r) => `${r.tablename}:${r.policyname}`);
    expect(politicas).toEqual(["AccionIntroducida:solo_plataforma", "PisoDePlataforma:solo_plataforma", "PlantillaDeRol:solo_plataforma", "VersionDePlantilla:solo_plataforma"]);
  });

  it("los literales de down.sql (3 plantillas, pisos, acciones introducidas) coinciden con los del generador", () => {
    const down = leer("down.sql");
    const s = cuentasDeLaSemilla();
    expect(down).toContain(`(SELECT count(*) FROM "PlantillaDeRol") - ${s.plantillas})`);
    expect(down).toContain(`(SELECT count(*) FROM "PisoDePlataforma") - ${s.pisos})`);
    expect(down).toContain(`(SELECT count(*) FROM "AccionIntroducida") - ${s.introducidas}, 0)`);
  });

  it("verificacion-previa.sql corre y no modifica nada (cuentas y nombres de rol, nunca datos personales)", async () => {
    const antes = await cuentas();
    await q(leer("verificacion-previa.sql"));
    expect(await cuentas()).toEqual(antes);
  });

  it("down.sql ABORTA, sin tocar nada, si hay una versión 2 o un piso cambiado a mano", async () => {
    const operador = semillaDePlantillas().versiones.OPERADOR.ver;
    const nueva = ACCIONES.find((a) => a.nivelMinimo === "operario" && !operador.includes(a.clave))!.clave;
    await q(
      `INSERT INTO "VersionDePlantilla" ("id", "plantillaClave", "numero", "accionesVer", "accionesEditar", "autor", "claveIdempotencia", "payloadHash") VALUES ('00000000-0000-4000-8000-0000000b0001', 'OPERADOR', 2, $1::text[], $1::text[], 'a-mano@plataforma.test', '00000000-0000-4000-8000-0000000b0002', 'h')`,
      [[...operador, nueva]],
    );
    await expect(q(leer("down.sql"))).rejects.toThrow(/cargadas a mano/);
    expect((await cuentas()).versiones).toBe(3);
    await resembrar();

    await q(`UPDATE "PisoDePlataforma" SET "tipo" = 'TODOS_LOS_ROLES' WHERE "accionClave" = 'traspasar_gerencia'`);
    expect((await q(`SELECT "version" FROM "PisoDePlataforma" WHERE "accionClave" = 'traspasar_gerencia'`)).rows[0].version).toBe(2);
    await expect(q(leer("down.sql"))).rejects.toThrow(/cargadas a mano/);
    expect((await cuentas()).pisos).toBe(cuentasDeLaSemilla().pisos);
    await resembrar();
  });

  it("down.sql borra la semilla pura (tablas y funciones), es repetible y la migración se puede volver a subir con el mismo resultado", async () => {
    const funciones = "'clave_de_accion_valida','claves_de_accion_validas','proteger_plantillas_y_pisos','solo_se_agrega_plantillas_y_pisos','incumplimiento_de_pisos','alta_de_version_de_plantilla','cambio_de_piso_de_plataforma'";
    await q(leer("down.sql"));
    expect((await q(`SELECT to_regclass('"PlantillaDeRol"') AS a, to_regclass('"VersionDePlantilla"') AS b, to_regclass('"PisoDePlataforma"') AS c, to_regclass('"AccionIntroducida"') AS d`)).rows[0]).toEqual({ a: null, b: null, c: null, d: null });
    expect((await q(`SELECT count(*)::int AS n FROM pg_proc WHERE proname IN (${funciones})`)).rows[0].n).toBe(0);
    await q(leer("down.sql")); // idempotente
    await q(leer("migration.sql"));
    const s = cuentasDeLaSemilla();
    expect(await cuentas()).toEqual({ plantillas: s.plantillas, versiones: s.versiones, pisos: s.pisos, introducidas: s.introducidas });
  });
});

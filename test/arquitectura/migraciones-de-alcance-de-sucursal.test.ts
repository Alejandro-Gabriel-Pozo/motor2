import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALCANCE_DE_TABLAS, TABLAS_CON_POLITICA_DE_SUCURSAL, politicasEsperadas } from "../setup/clasificacion-de-tablas";
import {
  MIGRACION_B1_FUNCIONES,
  MIGRACION_P3_AGREGADO_DE_CUENTA,
  MIGRACIONES_DE_POLITICAS_DE_SUCURSAL,
} from "../setup/migraciones-de-alcance-de-sucursal";
import {
  COMANDOS_CON_POLITICA_DE_ALCANCE,
  nombreDePoliticaDeAlcance,
  sqlDeFuncionesDeAlcance,
  sqlDePoliticasDeAlcance,
  sqlDeReversaDeFuncionesDeAlcance,
  sqlDeReversaDePoliticasDeAlcance,
} from "../setup/politicas-de-alcance-de-sucursal";

/**
 * B7 (Paquete 1): guardián de las migraciones de la RLS por sucursal. NADIE escribe una política a mano: el `migration.sql` y el `down.sql` de B1 a B6 son EXACTAMENTE la salida del generador
 * (`test/setup/politicas-de-alcance-de-sucursal.ts`, que sale de la clasificación) para su grupo de tablas, precedida de un encabezado de comentarios; y los cinco grupos juntos son
 * EXACTAMENTE `TABLAS_CON_POLITICA_DE_SUCURSAL`. Si la clasificación cambia (una tabla nueva con alcance de sucursal, un alcance distinto) o alguien toca una migración a mano, este test
 * se pone en rojo: la corrección es una migración NUEVA (las ya aplicadas no se editan), no retocar la salida.
 *
 * Sin base de datos. La mutación (alterar un byte de una migración) está demostrada en el último bloque con la misma función que usa el chequeo real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");

interface Esperada {
  migracion: string;
  tablas: readonly string[] | null; // null = B1 (las funciones)
  migrationSql: string;
  downSql: string;
}

const ESPERADAS: readonly Esperada[] = [
  { migracion: MIGRACION_B1_FUNCIONES, tablas: null, migrationSql: sqlDeFuncionesDeAlcance(), downSql: sqlDeReversaDeFuncionesDeAlcance() },
  ...MIGRACIONES_DE_POLITICAS_DE_SUCURSAL.map(({ migracion, tablas }) => ({
    migracion,
    tablas,
    migrationSql: sqlDePoliticasDeAlcance(tablas),
    downSql: sqlDeReversaDePoliticasDeAlcance(tablas),
  })),
];

/**
 * Todo lo que está mal en un archivo de migración (vacío = es el encabezado de comentarios y, después, EXACTAMENTE lo que genera el generador). El encabezado puede decir lo que quiera, pero
 * solo con comentarios: ninguna sentencia puede colarse ahí.
 */
function defectosDelArchivo(contenido: string, generado: string): string[] {
  const defectos: string[] = [];
  if (!contenido.endsWith(`\n\n${generado}`)) {
    defectos.push("el archivo no termina en la salida exacta del generador (separada del encabezado por una línea en blanco)");
    return defectos;
  }
  const encabezado = contenido.slice(0, contenido.length - generado.length);
  const ajenas = encabezado.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("--"));
  if (ajenas.length > 0) defectos.push(`el encabezado tiene líneas que no son comentarios: ${ajenas[0]}`);
  return defectos;
}

const leer = (migracion: string, archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, migracion, archivo), "utf8");

describe("B7: las migraciones de la RLS por sucursal (B1 a B6) son la salida del generador", () => {
  it("existen las seis carpetas, cada una con migration.sql y down.sql, en orden, después de la de AgregadoDeCuenta (P3)", () => {
    const carpetas = readdirSync(RAIZ, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    const nombres = ESPERADAS.map((e) => e.migracion);
    expect(nombres, "B1 primero, B2 a B6 en el orden de los grupos").toEqual([...nombres].sort());
    expect(nombres[0]).toBe(MIGRACION_B1_FUNCIONES);
    expect(MIGRACION_P3_AGREGADO_DE_CUENTA < MIGRACION_B1_FUNCIONES, "B4 incluye AgregadoDeCuenta: la tabla tiene que existir antes").toBe(true);
    for (const e of ESPERADAS) {
      expect(carpetas, e.migracion).toContain(e.migracion);
      expect(existsSync(join(RAIZ, e.migracion, "migration.sql")), `${e.migracion}/migration.sql`).toBe(true);
      expect(existsSync(join(RAIZ, e.migracion, "down.sql")), `${e.migracion}/down.sql`).toBe(true);
    }
  });

  it("el migration.sql de cada una es el encabezado más la salida exacta del generador para su grupo, y avisa que REQUIERE AUTORIZACIÓN EXPRESA", () => {
    for (const e of ESPERADAS) {
      const contenido = leer(e.migracion, "migration.sql");
      expect(defectosDelArchivo(contenido, e.migrationSql), `${e.migracion}/migration.sql`).toEqual([]);
      expect(contenido.split("\n")[0], `${e.migracion}: el encabezado dice qué hace y que hace falta autorización`).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    }
  });

  it("el down.sql de cada una es el encabezado más la salida exacta de la reversa del generador (B1: las dos funciones)", () => {
    for (const e of ESPERADAS) expect(defectosDelArchivo(leer(e.migracion, "down.sql"), e.downSql), `${e.migracion}/down.sql`).toEqual([]);
  });

  it("los cinco grupos son disjuntos y su unión es EXACTAMENTE TABLAS_CON_POLITICA_DE_SUCURSAL (32 tablas, 128 políticas)", () => {
    const todas = MIGRACIONES_DE_POLITICAS_DE_SUCURSAL.flatMap((g) => g.tablas);
    expect(new Set(todas).size, "ninguna tabla en dos grupos").toBe(todas.length);
    expect([...todas].sort()).toEqual([...TABLAS_CON_POLITICA_DE_SUCURSAL].sort());
    expect(todas).toHaveLength(32);
    expect(todas.length * COMANDOS_CON_POLITICA_DE_ALCANCE.length).toBe(128);
    expect(MIGRACIONES_DE_POLITICAS_DE_SUCURSAL).toHaveLength(5);
  });

  it("los padres de cada tabla HEREDADA van en el mismo grupo (ningún grupo depende de otro, salvo de B1 y de la tabla de P3)", () => {
    for (const { migracion, tablas } of MIGRACIONES_DE_POLITICAS_DE_SUCURSAL) {
      for (const tabla of tablas) {
        let actual = ALCANCE_DE_TABLAS[tabla]!;
        while (actual.alcance === "HEREDADA") {
          expect(tablas, `${migracion}: el padre ${actual.padre} de ${tabla}`).toContain(actual.padre);
          actual = ALCANCE_DE_TABLAS[actual.padre]!;
        }
      }
    }
  });

  it("los nombres de las políticas de la clasificación (`politicasEsperadas`) son los del generador", () => {
    const delGenerador = COMANDOS_CON_POLITICA_DE_ALCANCE.map(nombreDePoliticaDeAlcance).sort();
    for (const tabla of TABLAS_CON_POLITICA_DE_SUCURSAL) {
      expect(politicasEsperadas(tabla).filter((p) => p.startsWith("alcance_sucursal_")), tabla).toEqual(delGenerador);
    }
  });

  it("ninguna otra migración crea políticas de alcance de sucursal ni las funciones: solo B1 a B6", () => {
    const propias = new Set(ESPERADAS.map((e) => e.migracion));
    const ajenas = readdirSync(RAIZ, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !propias.has(e.name))
      .map((e) => e.name)
      .filter((nombre) => /alcance_sucursal_|app_sucursales_/.test(readFileSync(join(RAIZ, nombre, "migration.sql"), "utf8")));
    expect(ajenas).toEqual([]);
  });
});

describe("B7: la mutación — alterar un byte de una migración la pone en rojo", () => {
  it("el chequeo real da vacío con el archivo tal cual y da rojo si se cambia UN byte del SQL (migration.sql y down.sql de las seis)", () => {
    for (const e of ESPERADAS) {
      for (const [archivo, generado] of [["migration.sql", e.migrationSql], ["down.sql", e.downSql]] as const) {
        const real = leer(e.migracion, archivo);
        expect(defectosDelArchivo(real, generado), `${e.migracion}/${archivo} sin tocar`).toEqual([]);
        // Se cambia un carácter dentro de la parte generada (el último "TO motor2_app"/"DROP" que aparezca): una letra por otra.
        const posicion = real.lastIndexOf(archivo === "migration.sql" ? (e.tablas === null ? "STABLE" : "RESTRICTIVE") : "DROP");
        expect(posicion, `${e.migracion}/${archivo}: hay algo que alterar`).toBeGreaterThan(0);
        const mutado = `${real.slice(0, posicion)}X${real.slice(posicion + 1)}`;
        expect(mutado.length).toBe(real.length);
        expect(defectosDelArchivo(mutado, generado).length, `${e.migracion}/${archivo} con un byte alterado`).toBeGreaterThan(0);
      }
    }
  });

  it("una sentencia agregada en el encabezado, o una política de más al final, también se detecta", () => {
    const e = ESPERADAS[1]!;
    const real = leer(e.migracion, "migration.sql");
    expect(defectosDelArchivo(`DROP TABLE "Mesa";\n${real}`, e.migrationSql), "sentencia en el encabezado").not.toEqual([]);
    expect(defectosDelArchivo(`${real}\nDROP TABLE "Mesa";\n`, e.migrationSql), "sentencia después del SQL generado").not.toEqual([]);
    expect(defectosDelArchivo(real.replace("\n\n-- M.3 RLS", "\n-- M.3 RLS"), e.migrationSql), "sin la línea en blanco que separa el encabezado").not.toEqual([]);
  });
});

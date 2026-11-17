import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { semillaDePlantillas } from "../../src/core/permisos/plantillas-y-pisos";

/**
 * El bloque de SEMILLA de la migración `20261117100400_plantillas_y_pisos`, GENERADO desde el catálogo (nada a mano): las tres plantillas, los pisos por equivalencia de nivel, la versión 1 de ADMINISTRADOR y de
 * OPERADOR, y todas las claves como «ya introducidas». La migración lleva este texto entre los marcadores `-- >>> SEMILLA GENERADA >>>` / `-- <<< SEMILLA GENERADA <<<`; `test/persistencia/migracion-plantillas-y-pisos.test.ts`
 * exige que sea idéntico a lo que genera esta función (si el catálogo cambia, el test avisa y se regenera el bloque). También da `restaurarSemillaDePlantillasYPisos`, que las pruebas de persistencia usan para dejar las cuatro
 * tablas como las dejó la migración (el dueño puede TRUNCATE; el resto de las operaciones sigue prohibido).
 */
export const MARCA_DE_INICIO = "-- >>> SEMILLA GENERADA >>>";
export const MARCA_DE_FIN = "-- <<< SEMILLA GENERADA <<<";
export const AUTOR_DE_LA_SEMILLA = "migracion:plantillas_y_pisos";

const ID_PLANTILLA = { GERENTE: "00000000-0000-4000-8000-0000000c0001", ADMINISTRADOR: "00000000-0000-4000-8000-0000000c0002", OPERADOR: "00000000-0000-4000-8000-0000000c0003" } as const;
const ID_VERSION = {
  ADMINISTRADOR: { id: "00000000-0000-4000-8000-0000000c0011", clave: "00000000-0000-4000-8000-0000000c0012" },
  OPERADOR: { id: "00000000-0000-4000-8000-0000000c0021", clave: "00000000-0000-4000-8000-0000000c0022" },
} as const;

const literal = (texto: string): string => `'${texto.replaceAll("'", "''")}'`;
const arreglo = (claves: readonly string[]): string => `ARRAY[${claves.map(literal).join(", ")}]::text[]`;

/** Las sentencias de la semilla, una por elemento, SIN el punto y coma final. */
export function sentenciasDeLaSemilla(): string[] {
  const s = semillaDePlantillas();
  const sentencias: string[] = [];
  sentencias.push(
    `INSERT INTO "PlantillaDeRol" ("id", "clave") VALUES\n${(["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const).map((c) => `  (${literal(ID_PLANTILLA[c])}, ${literal(c)})`).join(",\n")}\nON CONFLICT ("clave") DO NOTHING`,
  );
  // Primero los pisos: la versión los lee al insertarse (el trigger de alta valida contra ellos).
  sentencias.push(
    `INSERT INTO "PisoDePlataforma" ("id", "accionClave", "tipo", "autor") VALUES\n${s.pisos.map((p) => `  (gen_random_uuid(), ${literal(p.accionClave)}, ${literal(p.tipo)}, ${literal(AUTOR_DE_LA_SEMILLA)})`).join(",\n")}\nON CONFLICT ("accionClave") DO NOTHING`,
  );
  for (const plantilla of ["ADMINISTRADOR", "OPERADOR"] as const) {
    const v = s.versiones[plantilla];
    // Sin ON CONFLICT: el trigger de alta corre ANTES del chequeo de unicidad. La guarda es el NOT EXISTS.
    sentencias.push(
      `INSERT INTO "VersionDePlantilla" ("id", "plantillaClave", "numero", "accionesVer", "accionesEditar", "autor", "claveIdempotencia", "payloadHash")\nSELECT ${literal(ID_VERSION[plantilla].id)}, ${literal(plantilla)}, 1,\n  ${arreglo(v.ver)},\n  ${arreglo(v.editar)},\n  ${literal(AUTOR_DE_LA_SEMILLA)}, ${literal(ID_VERSION[plantilla].clave)}, 'semilla-eb1'\nWHERE NOT EXISTS (SELECT 1 FROM "VersionDePlantilla" WHERE "plantillaClave" = ${literal(plantilla)})`,
    );
  }
  sentencias.push(`INSERT INTO "AccionIntroducida" ("id", "accionClave") VALUES\n${s.introducidas.map((c) => `  (gen_random_uuid(), ${literal(c)})`).join(",\n")}\nON CONFLICT ("accionClave") DO NOTHING`);
  return sentencias;
}

/** El bloque completo, con sus marcadores, tal como va en la migración. */
export function sqlDeLaSemilla(): string {
  return `${MARCA_DE_INICIO}\n${sentenciasDeLaSemilla().map((x) => `${x};`).join("\n\n")}\n${MARCA_DE_FIN}`;
}

/** Lo que cuenta la semilla (los literales de `down.sql` se comparan con esto). */
export function cuentasDeLaSemilla(): { plantillas: number; versiones: number; pisos: number; introducidas: number } {
  const s = semillaDePlantillas();
  return { plantillas: 3, versiones: 2, pisos: s.pisos.length, introducidas: s.introducidas.length };
}

/** Las sentencias del bloque tal como están en un `migration.sql` (para correrlas de a una con el cliente de Prisma, que no admite varias a la vez). */
export function sentenciasDelBloque(bloque: string): string[] {
  return bloque
    .split("\n")
    .filter((l) => !l.startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((x) => x.trim().replace(/;$/, ""))
    .filter((x) => x !== "");
}

const RUTA_DE_LA_MIGRACION = join(__dirname, "../../prisma/migrations/20261117100400_plantillas_y_pisos/migration.sql");

/** El bloque de semilla tal como quedó escrito en la migración. */
export function bloqueDeLaMigracion(): string {
  const texto = readFileSync(RUTA_DE_LA_MIGRACION, "utf8");
  const desde = texto.indexOf(MARCA_DE_INICIO);
  const hasta = texto.indexOf(MARCA_DE_FIN);
  if (desde < 0 || hasta < 0) throw new Error("La migración no tiene los marcadores de la semilla generada.");
  return texto.slice(desde, hasta + MARCA_DE_FIN.length);
}

/** Deja las cuatro tablas como las dejó la migración: las vacía (como dueño) y vuelve a correr el bloque leído de `migration.sql`. */
export async function restaurarSemillaDePlantillasYPisos(prismaAdmin: PrismaClient): Promise<void> {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "VersionDePlantilla", "PisoDePlataforma", "AccionIntroducida", "PlantillaDeRol"');
  for (const sentencia of sentenciasDelBloque(bloqueDeLaMigracion())) await prismaAdmin.$executeRawUnsafe(sentencia);
}

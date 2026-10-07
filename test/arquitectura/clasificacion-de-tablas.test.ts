import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CANTIDAD_DE_POLITICAS_ESPERADAS, CLASIFICACION_DE_TABLAS, TABLAS_CON_EMPRESA_ID, politicasEsperadas, tablasDeClase } from "../setup/clasificacion-de-tablas";

/**
 * Guardián de la clasificación declarada de tablas (Pureza, Hito 2, trabajo 2.6). Sin base de datos: cruza `test/setup/clasificacion-de-tablas.ts` con los modelos de `prisma/schema.prisma`.
 * Un modelo nuevo sin declarar, una declaración de una tabla que ya no existe, o un modelo con `empresaId` clasificado como sin empresa (o al revés) ponen este test en rojo: de qué empresa es
 * una tabla es una decisión de seguridad que se toma a propósito. Los tests contra Postgres (`test/persistencia/multiempresa-estructura.test.ts`, `test/aislamiento/rls-empresa.test.ts`) verifican
 * después que la base real cumple lo que cada clase promete.
 */
const esquema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");
const modelos = [...esquema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, nombre, cuerpo]) => ({ nombre, conEmpresaId: /^\s+empresaId\s/m.test(cuerpo), mapeado: /@@map\(/.test(cuerpo) }));

describe("la clasificación declarada de tablas coincide con el esquema de Prisma", () => {
  it("todo modelo está declarado, y toda declaración es de un modelo que existe (ninguna tabla queda sin clase)", () => {
    expect(modelos.length, "se leyeron los modelos del esquema").toBeGreaterThan(50);
    expect(modelos.filter((m) => m.mapeado).map((m) => m.nombre), "un @@map cambia el nombre de la tabla: habría que declarar el nombre de la tabla").toEqual([]);
    expect(modelos.map((m) => m.nombre).sort()).toEqual(Object.keys(CLASIFICACION_DE_TABLAS).sort());
  });

  it("las tablas con `empresaId` en el esquema son exactamente las de las dos clases con empresa", () => {
    expect(modelos.filter((m) => m.conEmpresaId).map((m) => m.nombre).sort()).toEqual(TABLAS_CON_EMPRESA_ID);
  });

  it("las políticas esperadas se derivan de la clase: una por tabla por empresa, las especiales por nombre, `solo_plataforma` en la consola y ninguna en las globales", () => {
    expect(politicasEsperadas("Unidad")).toEqual(["aislamiento_empresa"]);
    expect(politicasEsperadas("Invitacion")).toEqual(["aislamiento_empresa", "escritura_plataforma", "lectura_por_token"]);
    expect(politicasEsperadas("SesionPlataforma")).toEqual(["solo_plataforma"]);
    expect(politicasEsperadas("User")).toEqual([]);
    expect(politicasEsperadas("Empresa")).toEqual([]);
    expect(CANTIDAD_DE_POLITICAS_ESPERADAS).toBe(
      tablasDeClase("POR_EMPRESA").length + 2 + 2 + 3 + tablasDeClase("CONSOLA").length, // por empresa + UsuarioEmpresa + ModuloEmpresa + Invitacion + consola
    );
  });
});

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ROL_DE_PLATAFORMA } from "../../plataforma/src/entorno";
import { ConexionDePlataformaError, describirConexion, resolverConexionDePlataforma } from "../../scripts/conexion-de-plataforma";

/**
 * Qué base operan los scripts de plataforma con `--instalacion` (ADR-025): puro, sin `process.env` ni base real. Reusa el patrón de
 * `test/plataforma/instalaciones.test.ts` (mismas claves "filtrables" para comprobar que ningún mensaje de error las repite).
 */
const url = (host: string, bd = "neondb", usuario = ROL_DE_PLATAFORMA, clave = "clave-secreta-uno") => `postgresql://${usuario}:${clave}@${host}:5432/${bd}?sslmode=require`;
const BASE = {
  PLATAFORMA_DATABASE_URL: url("ep-principal.c-6.us-east-2.aws.neon.tech"),
  PLATAFORMA_SECRETO_CODIGOS: "x".repeat(32),
  PLATAFORMA_CLAVE_TOTP: randomBytes(32).toString("base64"),
  PLATAFORMA_URL_APP: "https://zuluhub.ejemplo.test",
};
const ADICIONAL = [{ id: "stockhneuquen", nombre: "Stock Neuquén", urlApp: "https://stock.ejemplo.test" }];
const CON_ADICIONAL = {
  ...BASE,
  PLATAFORMA_INSTALACION_ID: "zuluhub",
  PLATAFORMA_INSTALACION_NOMBRE: "Zuluhub",
  PLATAFORMA_INSTALACIONES_ADICIONALES: JSON.stringify(ADICIONAL),
  PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN: url("ep-stock.c-2.us-west-2.aws.neon.tech", "neondb", ROL_DE_PLATAFORMA, "clave-secreta-dos"),
};
const SOLO_DATABASE_URL = { DATABASE_URL: url("ep-dueno.neon.tech", "neondb", "motor2", "clave-del-duenio") };

function mensaje(entorno: Record<string, string | undefined>, instalacionPedida: string | undefined): string {
  try {
    resolverConexionDePlataforma(entorno, instalacionPedida);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("se esperaba que resolverConexionDePlataforma fallara");
}

describe("resolverConexionDePlataforma", () => {
  it("con --instalacion del id de la principal, resuelve a la principal (no abre un segundo cliente contra la misma base)", () => {
    const c = resolverConexionDePlataforma(CON_ADICIONAL, "zuluhub");
    expect(c).toEqual({ origen: "instalacion", id: "zuluhub", nombre: "Zuluhub", databaseUrl: CON_ADICIONAL.PLATAFORMA_DATABASE_URL });
  });

  it("con --instalacion de una adicional, resuelve a SU conexión, no a la de la principal", () => {
    const c = resolverConexionDePlataforma(CON_ADICIONAL, "stockhneuquen");
    expect(c).toEqual({ origen: "instalacion", id: "stockhneuquen", nombre: "Stock Neuquén", databaseUrl: CON_ADICIONAL.PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN });
  });

  it("un id inexistente NO cae en la principal: falla nombrando el id pedido y los ids configurados", () => {
    // Mutación: `instalacionPorId(lista, id) ?? lista[0]` pone este test en rojo.
    const m = mensaje(CON_ADICIONAL, "neuquen");
    expect(m).toContain("neuquen");
    expect(m).toContain("zuluhub");
    expect(m).toContain("stockhneuquen");
  });

  it.each([["vacío", ""], ["solo espacios", "   "]])("--instalacion %s pide un id", (_n, id) => {
    expect(mensaje(CON_ADICIONAL, id)).toMatch(/--instalacion/);
  });

  it.each([["en mayúsculas", "ZULUHUB"], ["el nombre por defecto que no es el id configurado", "principal"], ["__proto__", "__proto__"]])("no hace coincidencia laxa: %s no resuelve", (_n, id) => {
    expect(() => resolverConexionDePlataforma(CON_ADICIONAL, id)).toThrow(ConexionDePlataformaError);
  });

  it("sin --instalacion y con instalaciones adicionales configuradas, falla pidiendo el flag y lista los ids", () => {
    // Mutación: borrar esta rama (caer directo al archivo de entorno) pone este test en rojo: operaría la principal en silencio.
    const m = mensaje(CON_ADICIONAL, undefined);
    expect(m).toMatch(/--instalacion/);
    expect(m).toContain("zuluhub");
    expect(m).toContain("stockhneuquen");
  });

  it("sin --instalacion y sin instalaciones adicionales, usa PLATAFORMA_DATABASE_URL (comportamiento de siempre)", () => {
    expect(resolverConexionDePlataforma(BASE, undefined)).toEqual({ origen: "archivo-de-entorno", databaseUrl: BASE.PLATAFORMA_DATABASE_URL });
  });

  // S-33: `DATABASE_URL` es la conexión de la APP (o la del dueño en un `.env` local): un script de plataforma que cae en ella opera con un rol que NO es `motor2_plataforma`, sin las
  // garantías de la consola (grants, RLS por rol, trigger de la máquina de estados). Nunca cae ahí: sin `PLATAFORMA_DATABASE_URL` el script no se conecta a nada.
  it("S-33: sin --instalacion y sin PLATAFORMA_DATABASE_URL, NO cae en DATABASE_URL: falla nombrando PLATAFORMA_DATABASE_URL y sin repetir la clave", () => {
    const m = mensaje(SOLO_DATABASE_URL, undefined);
    expect(m).toContain("PLATAFORMA_DATABASE_URL");
    expect(m).not.toContain("clave-del-duenio");
    expect(() => resolverConexionDePlataforma({ ...SOLO_DATABASE_URL, PLATAFORMA_DATABASE_URL: "" }, undefined)).toThrow(ConexionDePlataformaError);
  });

  it("S-33: con las dos variables, usa PLATAFORMA_DATABASE_URL y no la de la app", () => {
    const c = resolverConexionDePlataforma({ ...BASE, ...SOLO_DATABASE_URL }, undefined);
    expect(c).toEqual({ origen: "archivo-de-entorno", databaseUrl: BASE.PLATAFORMA_DATABASE_URL });
  });

  it("sin --instalacion y sin ninguna de las dos variables, falla nombrando las variables", () => {
    expect(mensaje({}, undefined)).toContain("PLATAFORMA_DATABASE_URL");
  });

  it("con --instalacion pero el archivo de entorno de la consola incompleto, el mensaje nombra la variable que falta", () => {
    const sinClaveTotp = { ...CON_ADICIONAL, PLATAFORMA_CLAVE_TOTP: undefined };
    expect(mensaje(sinClaveTotp, "zuluhub")).toContain("PLATAFORMA_CLAVE_TOTP");
  });

  it("ningún mensaje de error repite una clave de conexión", () => {
    const mensajes = [
      mensaje(CON_ADICIONAL, "neuquen"),
      mensaje(CON_ADICIONAL, undefined),
      mensaje({ ...CON_ADICIONAL, PLATAFORMA_CLAVE_TOTP: undefined }, "zuluhub"),
    ];
    for (const m of mensajes) {
      expect(m).not.toContain("clave-secreta-uno");
      expect(m).not.toContain("clave-secreta-dos");
    }
  });
});

describe("describirConexion", () => {
  it("nombra la instalación (id y nombre), nunca una URL", () => {
    const c = resolverConexionDePlataforma(CON_ADICIONAL, "stockhneuquen");
    const texto = describirConexion(c);
    expect(texto).toContain("stockhneuquen");
    expect(texto).toContain("Stock Neuquén");
    expect(texto).not.toContain("clave-secreta-dos");
  });

  it("sin instalación, dice que es la del archivo de entorno", () => {
    const c = resolverConexionDePlataforma(BASE, undefined);
    expect(describirConexion(c)).toContain("archivo de entorno");
  });
});

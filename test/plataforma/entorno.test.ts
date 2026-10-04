import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CLAVES_DE_ENTORNO_DE_PLATAFORMA, ROL_DE_PLATAFORMA, leerEntornoDePlataforma } from "../../plataforma/src/entorno";

/**
 * La configuración de la consola (E4, ADR-019): cerrada por defecto. Sin su propia variable de conexión no hay base, y la conexión tiene que ser la
 * del rol `motor2_plataforma` (privilegio mínimo): la del dueño o la de la aplicación se rechazan. Los mensajes dicen QUÉ variable está mal, nunca su valor.
 */
const VALIDO = {
  PLATAFORMA_DATABASE_URL: `postgresql://${ROL_DE_PLATAFORMA}:contrasenia-secreta@db.ejemplo.test:5432/motor2?sslmode=require`,
  PLATAFORMA_SECRETO_CODIGOS: "x".repeat(32),
  PLATAFORMA_CLAVE_TOTP: randomBytes(32).toString("base64"),
  PLATAFORMA_URL_APP: "https://app.ejemplo.test",
};

function mensajeDeError(entorno: Record<string, string | undefined>): string {
  try {
    leerEntornoDePlataforma(entorno);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("se esperaba que el entorno fuera inválido");
}

describe("entorno de la consola de plataforma", () => {
  it("un entorno completo y del rol correcto se acepta", () => {
    expect(leerEntornoDePlataforma(VALIDO)).toEqual(VALIDO);
  });

  it.each(["https://app.ejemplo.test", "https://app.ejemplo.test/", "http://localhost:3000", "http://127.0.0.1:56472"])("la dirección de la app %s se acepta", (url) => {
    expect(leerEntornoDePlataforma({ ...VALIDO, PLATAFORMA_URL_APP: url }).PLATAFORMA_URL_APP).toBe(url);
  });

  it.each(["http://app.ejemplo.test", "app.ejemplo.test", "https://app.ejemplo.test/invitacion", "https://app.ejemplo.test?x=1", "ftp://localhost", ""])(
    "la dirección de la app %j se rechaza y el mensaje nombra la variable",
    (url) => {
      expect(mensajeDeError({ ...VALIDO, PLATAFORMA_URL_APP: url })).toContain("PLATAFORMA_URL_APP");
    },
  );

  it("el rol se lee de la URL aunque venga codificado en porcentaje", () => {
    const url = `postgresql://${encodeURIComponent(ROL_DE_PLATAFORMA)}:clave@db.ejemplo.test/motor2`;
    expect(leerEntornoDePlataforma({ ...VALIDO, PLATAFORMA_DATABASE_URL: url }).PLATAFORMA_DATABASE_URL).toBe(url);
  });

  it.each(CLAVES_DE_ENTORNO_DE_PLATAFORMA)("si falta %s, el entorno es inválido y el mensaje nombra la variable", (variable) => {
    const entorno: Record<string, string | undefined> = { ...VALIDO };
    delete entorno[variable];
    expect(mensajeDeError(entorno)).toContain(variable);
  });

  it("NUNCA cae en DATABASE_URL ni en DIRECT_URL: sin PLATAFORMA_DATABASE_URL no hay conexión, aunque esas dos estén bien", () => {
    const entorno = {
      ...VALIDO,
      PLATAFORMA_DATABASE_URL: undefined,
      DATABASE_URL: `postgresql://${ROL_DE_PLATAFORMA}:clave@db.ejemplo.test/motor2`,
      DIRECT_URL: `postgresql://${ROL_DE_PLATAFORMA}:clave@db.ejemplo.test/motor2`,
    };
    expect(mensajeDeError(entorno)).toContain("PLATAFORMA_DATABASE_URL");
  });

  it.each([
    ["el dueño de las tablas", "motor2"],
    ["el rol de la aplicación", "motor2_app"],
    ["un usuario vacío", ""],
  ])("rechaza una URL que conecta como %s", (_nombre, usuario) => {
    const url = `postgresql://${usuario}:contrasenia-secreta@db.ejemplo.test/motor2`;
    const mensaje = mensajeDeError({ ...VALIDO, PLATAFORMA_DATABASE_URL: url });
    expect(mensaje).toContain("PLATAFORMA_DATABASE_URL");
    expect(mensaje).toContain(ROL_DE_PLATAFORMA);
    expect(mensaje).not.toContain("contrasenia-secreta");
  });

  it("rechaza algo que ni siquiera es una URL", () => {
    expect(mensajeDeError({ ...VALIDO, PLATAFORMA_DATABASE_URL: "esto no es una url" })).toContain("PLATAFORMA_DATABASE_URL");
  });

  it("el secreto de códigos tiene que tener al menos 32 caracteres", () => {
    expect(mensajeDeError({ ...VALIDO, PLATAFORMA_SECRETO_CODIGOS: "x".repeat(31) })).toContain("PLATAFORMA_SECRETO_CODIGOS");
    expect(leerEntornoDePlataforma({ ...VALIDO, PLATAFORMA_SECRETO_CODIGOS: "x".repeat(32) }).PLATAFORMA_SECRETO_CODIGOS).toHaveLength(32);
  });

  it.each([
    ["corta", randomBytes(16).toString("base64")],
    ["larga", randomBytes(48).toString("base64")],
    ["vacía", ""],
  ])("la clave TOTP %s no sirve: tiene que ser de 32 bytes en base64", (_nombre, clave) => {
    expect(mensajeDeError({ ...VALIDO, PLATAFORMA_CLAVE_TOTP: clave })).toContain("PLATAFORMA_CLAVE_TOTP");
  });

  it("el mensaje de error no repite valores secretos", () => {
    const mensaje = mensajeDeError({ ...VALIDO, PLATAFORMA_SECRETO_CODIGOS: "corto-pero-secreto", PLATAFORMA_CLAVE_TOTP: "clave-mala-secreta" });
    expect(mensaje).not.toContain("corto-pero-secreto");
    expect(mensaje).not.toContain("clave-mala-secreta");
  });

  it("declara exactamente las cuatro variables que el despliegue tiene que configurar", () => {
    expect([...CLAVES_DE_ENTORNO_DE_PLATAFORMA].sort()).toEqual(["PLATAFORMA_CLAVE_TOTP", "PLATAFORMA_DATABASE_URL", "PLATAFORMA_SECRETO_CODIGOS", "PLATAFORMA_URL_APP"]);
  });
});

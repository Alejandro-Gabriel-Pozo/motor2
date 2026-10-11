import { describe, expect, it } from "vitest";
import { resolverUrlAppE2E, resolverUrlE2E, resolverUrlE2EB, resolverUrlPlataformaE2E, resolverUrlPlataformaE2EB, resolverUrlPruebasE2E } from "../e2e/fixtures/base-e2e";

/**
 * Las guardas de la base E2E (test/e2e/fixtures/base-e2e.ts) son lo único que
 * separa un `TRUNCATE ... CASCADE` de cada corrida de Playwright de una base
 * real. Este test fija QUÉ se acepta y QUÉ se rechaza — sin base de datos,
 * porque `resolverUrlE2E` es pura (recibe el entorno como parámetro).
 *
 * Si se afloja alguna regla (p. ej. el sufijo "_e2e" o el host local), un caso
 * de acá tiene que ponerse en rojo: para eso están los casos negativos.
 */
const OK = "postgresql://motor2:motor2@localhost:5432/motor2_e2e";

describe("resolverUrlE2E — qué base se acepta", () => {
  it("acepta un Postgres local cuya base termina en _e2e", () => {
    expect(resolverUrlE2E({ MOTOR2_E2E_DATABASE_URL: OK })).toEqual({ url: OK, host: "localhost", nombre: "motor2_e2e" });
  });

  it("acepta 127.0.0.1", () => {
    const url = "postgresql://motor2:motor2@127.0.0.1:5432/otra_e2e";
    expect(resolverUrlE2E({ MOTOR2_E2E_DATABASE_URL: url })).toMatchObject({ host: "127.0.0.1", nombre: "otra_e2e" });
  });
});

describe("resolverUrlE2E — qué base se rechaza (nunca se conecta)", () => {
  const rechazadas: Array<[string, Record<string, string | undefined>, RegExp]> = [
    ["sin MOTOR2_E2E_DATABASE_URL (no hay fallback a DATABASE_URL)", { DATABASE_URL: OK }, /Falta MOTOR2_E2E_DATABASE_URL/],
    ["una URL que no es una URL", { MOTOR2_E2E_DATABASE_URL: "no es una url" }, /no es una URL válida/],
    ["la base de desarrollo local (motor2_dev)", { MOTOR2_E2E_DATABASE_URL: "postgresql://motor2:motor2@localhost:5432/motor2_dev" }, /terminar en "_e2e"/],
    ["una base local llamada motor2_prod", { MOTOR2_E2E_DATABASE_URL: "postgresql://motor2:motor2@localhost:5432/motor2_prod" }, /terminar en "_e2e"/],
    ["un nombre que solo CONTIENE _e2e sin terminar en él", { MOTOR2_E2E_DATABASE_URL: "postgresql://motor2:motor2@localhost:5432/motor2_e2e_backup" }, /terminar en "_e2e"/],
    ["una URL sin nombre de base", { MOTOR2_E2E_DATABASE_URL: "postgresql://motor2:motor2@localhost:5432/" }, /terminar en "_e2e"/],
    ["Neon, aunque la base termine en _e2e", { MOTOR2_E2E_DATABASE_URL: "postgresql://u:p@ep-cool-123.neon.tech/inventario_e2e?sslmode=require" }, /Host rechazado/],
    ["el pooler de Neon", { MOTOR2_E2E_DATABASE_URL: "postgresql://u:p@ep-cool-123-pooler.us-east-2.aws.neon.tech/x_e2e" }, /Host rechazado/],
    ["un host remoto cualquiera con nombre _e2e", { MOTOR2_E2E_DATABASE_URL: "postgresql://u:p@db.ejemplo.com:5432/motor2_e2e" }, /Host rechazado/],
    ["localhost pero con un proveedor gestionado escondido en la URL", { MOTOR2_E2E_DATABASE_URL: "postgresql://u:p@localhost:5432/motor2_e2e?host=x.supabase.co" }, /proveedor gestionado/],
    ["NODE_ENV=production", { MOTOR2_E2E_DATABASE_URL: OK, NODE_ENV: "production" }, /producción\/Vercel/],
    ["un entorno de Vercel (VERCEL)", { MOTOR2_E2E_DATABASE_URL: OK, VERCEL: "1" }, /producción\/Vercel/],
    ["un entorno de Vercel (VERCEL_ENV)", { MOTOR2_E2E_DATABASE_URL: OK, VERCEL_ENV: "preview" }, /producción\/Vercel/],
  ];

  for (const [descripcion, env, mensaje] of rechazadas) {
    it(`rechaza ${descripcion}`, () => {
      expect(() => resolverUrlE2E(env)).toThrow(mensaje);
    });
  }
});

describe("resolverUrlAppE2E — el runtime de los E2E es motor2_app, no el dueño (ADR-007 A0)", () => {
  const APP = "postgresql://motor2_app:x@localhost:5432/motor2_e2e";
  const entorno = (app: string | undefined) => ({ MOTOR2_E2E_DATABASE_URL: OK, MOTOR2_E2E_APP_DATABASE_URL: app });

  it("acepta un rol distinto del dueño sobre la misma base", () => {
    expect(resolverUrlAppE2E(entorno(APP))).toEqual({ url: APP, host: "localhost", nombre: "motor2_e2e" });
  });

  it("rechaza si falta (no hay fallback al dueño)", () => {
    expect(() => resolverUrlAppE2E(entorno(undefined))).toThrow(/Falta MOTOR2_E2E_APP_DATABASE_URL/);
  });

  it("rechaza si es idéntica a la del dueño", () => {
    expect(() => resolverUrlAppE2E(entorno(OK))).toThrow(/idéntica/);
  });

  it("rechaza si apunta a otra base que la del dueño", () => {
    expect(() => resolverUrlAppE2E(entorno("postgresql://motor2_app:x@localhost:5432/otra_e2e"))).toThrow(/misma base/);
  });

  it("rechaza si apunta a la base de desarrollo", () => {
    expect(() => resolverUrlAppE2E(entorno("postgresql://motor2_app:x@localhost:5432/motor2_dev"))).toThrow(/terminar en "_e2e"/);
  });

  it("rechaza un host remoto", () => {
    expect(() => resolverUrlAppE2E(entorno("postgresql://motor2_app:x@db.ejemplo.com:5432/motor2_e2e"))).toThrow(/Host rechazado/);
  });
});

describe("resolverUrlPlataformaE2E — la consola de plataforma en los E2E (E4, ADR-019)", () => {
  const PLATAFORMA = "postgresql://motor2_plataforma:x@localhost:5432/motor2_e2e";
  const entorno = (url: string | undefined) => ({ MOTOR2_E2E_DATABASE_URL: OK, MOTOR2_E2E_PLATAFORMA_DATABASE_URL: url });

  it("sin la variable devuelve null: el E2E de la consola se omite (el rol solo existe donde se creó)", () => {
    expect(resolverUrlPlataformaE2E(entorno(undefined))).toBeNull();
    expect(resolverUrlPlataformaE2E(entorno(""))).toBeNull();
  });

  it("acepta el rol motor2_plataforma sobre la misma base", () => {
    expect(resolverUrlPlataformaE2E(entorno(PLATAFORMA))).toEqual({ url: PLATAFORMA, host: "localhost", nombre: "motor2_e2e" });
  });

  it.each([
    ["el dueño", OK, /rol motor2_plataforma/],
    ["el rol de la aplicación", "postgresql://motor2_app:x@localhost:5432/motor2_e2e", /rol motor2_plataforma/],
    ["otra base", "postgresql://motor2_plataforma:x@localhost:5432/otra_e2e", /misma base/],
    ["la base de desarrollo", "postgresql://motor2_plataforma:x@localhost:5432/motor2_dev", /terminar en "_e2e"/],
    ["un host remoto", "postgresql://motor2_plataforma:x@db.ejemplo.com:5432/motor2_e2e", /Host rechazado/],
  ])("rechaza %s", (_nombre, url, mensaje) => {
    expect(() => resolverUrlPlataformaE2E(entorno(url))).toThrow(mensaje);
  });
});

describe("la SEGUNDA instalación de los E2E (ADR-025)", () => {
  const B = "postgresql://motor2:motor2@localhost:5432/motor2_b_e2e";
  const B_PLATAFORMA = "postgresql://motor2_plataforma:x@localhost:5432/motor2_b_e2e";
  const entorno = (b: string | undefined, plataforma?: string) => ({ MOTOR2_E2E_DATABASE_URL: OK, MOTOR2_E2E_B_DATABASE_URL: b, MOTOR2_E2E_B_PLATAFORMA_DATABASE_URL: plataforma });

  it("sin la variable devuelve null: el spec multi-instalación se omite", () => {
    expect(resolverUrlE2EB(entorno(undefined))).toBeNull();
    expect(resolverUrlPlataformaE2EB(entorno(""))).toBeNull();
  });

  it("acepta otra base local `_e2e` y el rol de plataforma sobre ESA base", () => {
    expect(resolverUrlE2EB(entorno(B))).toEqual({ url: B, host: "localhost", nombre: "motor2_b_e2e" });
    expect(resolverUrlPlataformaE2EB(entorno(B, B_PLATAFORMA))).toEqual({ url: B_PLATAFORMA, host: "localhost", nombre: "motor2_b_e2e" });
  });

  it.each([
    ["la MISMA base que la de siempre", OK, /OTRA base/],
    ["la base de desarrollo", "postgresql://motor2:x@localhost:5432/motor2_dev", /terminar en "_e2e"/],
    ["un nombre que no termina en _e2e (motor2_e2e_b)", "postgresql://motor2:x@localhost:5432/motor2_e2e_b", /terminar en "_e2e"/],
    ["un host remoto", "postgresql://motor2:x@db.ejemplo.com:5432/motor2_b_e2e", /Host rechazado/],
  ])("rechaza %s como segunda base", (_nombre, url, mensaje) => {
    // Mutación: aceptar una B igual a A (sacar la comparación) pone el primer caso en rojo.
    expect(() => resolverUrlE2EB(entorno(url))).toThrow(mensaje);
  });

  it.each([
    ["sin la URL de plataforma de B", undefined, /Falta MOTOR2_E2E_B_PLATAFORMA_DATABASE_URL/],
    ["el dueño", B, /rol motor2_plataforma/],
    ["otra base", "postgresql://motor2_plataforma:x@localhost:5432/otra_e2e", /misma base/],
    ["la base de la instalación A", "postgresql://motor2_plataforma:x@localhost:5432/motor2_e2e", /misma base/],
  ])("la conexión de plataforma de B rechaza %s", (_nombre, url, mensaje) => {
    expect(() => resolverUrlPlataformaE2EB(entorno(B, url))).toThrow(mensaje);
  });
});

describe("resolverUrlPruebasE2E — el rol de pruebas que siembra los specs (M.3-A8)", () => {
  const PRUEBAS = "postgresql://motor2_app_pruebas:x@localhost:5432/motor2_e2e";
  const entorno = (url: string | undefined) => ({ MOTOR2_E2E_DATABASE_URL: OK, MOTOR2_E2E_PRUEBAS_DATABASE_URL: url });

  it("sin la variable devuelve null: los specs siembran con el rol de la app, como antes (el aviso lo da playwright.config.ts)", () => {
    expect(resolverUrlPruebasE2E(entorno(undefined))).toBeNull();
    expect(resolverUrlPruebasE2E(entorno(""))).toBeNull();
  });

  it("acepta el rol motor2_app_pruebas sobre la misma base _e2e", () => {
    expect(resolverUrlPruebasE2E(entorno(PRUEBAS))).toEqual({ url: PRUEBAS, host: "localhost", nombre: "motor2_e2e" });
  });

  it.each([
    ["el dueño", OK, /rol motor2_app_pruebas/],
    ["el rol de la aplicación", "postgresql://motor2_app:x@localhost:5432/motor2_e2e", /rol motor2_app_pruebas/],
    ["el rol de plataforma", "postgresql://motor2_plataforma:x@localhost:5432/motor2_e2e", /rol motor2_app_pruebas/],
    ["otra base", "postgresql://motor2_app_pruebas:x@localhost:5432/otra_e2e", /misma base/],
    ["la base de desarrollo", "postgresql://motor2_app_pruebas:x@localhost:5432/motor2_dev", /terminar en "_e2e"/],
    ["un host remoto", "postgresql://motor2_app_pruebas:x@db.ejemplo.com:5432/motor2_e2e", /Host rechazado/],
    ["un `?host=` remoto", "postgresql://motor2_app_pruebas:x@localhost:5432/motor2_e2e?host=db.ejemplo.com", /Host rechazado/],
  ])("rechaza %s", (_nombre, url, mensaje) => {
    // Mutación: no exigir el usuario motor2_app_pruebas (o la misma base) pone los casos correspondientes en rojo.
    expect(() => resolverUrlPruebasE2E(entorno(url))).toThrow(mensaje);
  });
});

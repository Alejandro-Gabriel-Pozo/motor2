import { describe, expect, it } from "vitest";
import { resolverUrlAppE2E, resolverUrlE2E } from "../e2e/fixtures/base-e2e";

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

import { describe, expect, it } from "vitest";
import { resolverUrlDelSeed, verificarConfirmacionExplicita, pideRehacer, verificarBaseVacia } from "../../scripts/demo-seed/guardas-destino";

const OK = "postgresql://motor2:motor2@localhost:5432/motor2_demo";

describe("resolverUrlDelSeed — qué base se acepta", () => {
  it("acepta un Postgres local cuya base termina en _demo", () => {
    expect(resolverUrlDelSeed({ MOTOR2_SEED_DATABASE_URL: OK })).toEqual({ url: OK, host: "localhost", nombre: "motor2_demo" });
  });

  it("acepta 127.0.0.1", () => {
    const url = "postgresql://motor2:motor2@127.0.0.1:5432/otra_demo";
    expect(resolverUrlDelSeed({ MOTOR2_SEED_DATABASE_URL: url })).toMatchObject({ host: "127.0.0.1", nombre: "otra_demo" });
  });
});

describe("resolverUrlDelSeed — qué base se rechaza (nunca se conecta)", () => {
  const rechazadas: Array<[string, Record<string, string | undefined>, RegExp]> = [
    ["sin MOTOR2_SEED_DATABASE_URL (no hay fallback a DATABASE_URL)", { DATABASE_URL: OK }, /Falta MOTOR2_SEED_DATABASE_URL/],
    ["una URL que no es una URL", { MOTOR2_SEED_DATABASE_URL: "no es una url" }, /no es una URL válida/],
    ["la base de desarrollo local (motor2_dev)", { MOTOR2_SEED_DATABASE_URL: "postgresql://motor2:motor2@localhost:5432/motor2_dev" }, /terminar en "_demo"/],
    ["la base E2E (sufijo distinto, no comparte carril)", { MOTOR2_SEED_DATABASE_URL: "postgresql://motor2:motor2@localhost:5432/motor2_e2e" }, /terminar en "_demo"/],
    ["un nombre que solo CONTIENE _demo sin terminar en él", { MOTOR2_SEED_DATABASE_URL: "postgresql://motor2:motor2@localhost:5432/motor2_demo_backup" }, /terminar en "_demo"/],
    ["una URL sin nombre de base", { MOTOR2_SEED_DATABASE_URL: "postgresql://motor2:motor2@localhost:5432/" }, /terminar en "_demo"/],
    ["Neon, aunque la base termine en _demo", { MOTOR2_SEED_DATABASE_URL: "postgresql://u:p@ep-cool-123.neon.tech/inventario_demo?sslmode=require" }, /Host rechazado/],
    ["el pooler de Neon", { MOTOR2_SEED_DATABASE_URL: "postgresql://u:p@ep-cool-123-pooler.us-east-2.aws.neon.tech/x_demo" }, /Host rechazado/],
    ["un host remoto cualquiera con nombre _demo", { MOTOR2_SEED_DATABASE_URL: "postgresql://u:p@db.ejemplo.com:5432/motor2_demo" }, /Host rechazado/],
    ["localhost pero con un proveedor gestionado escondido en la URL", { MOTOR2_SEED_DATABASE_URL: "postgresql://u:p@localhost:5432/motor2_demo?host=x.supabase.co" }, /proveedor gestionado/],
    ["NODE_ENV=production", { MOTOR2_SEED_DATABASE_URL: OK, NODE_ENV: "production" }, /producción\/Vercel/],
    ["un entorno de Vercel (VERCEL)", { MOTOR2_SEED_DATABASE_URL: OK, VERCEL: "1" }, /producción\/Vercel/],
    ["un entorno de Vercel (VERCEL_ENV)", { MOTOR2_SEED_DATABASE_URL: OK, VERCEL_ENV: "preview" }, /producción\/Vercel/],
  ];

  for (const [descripcion, env, mensaje] of rechazadas) {
    it(`rechaza ${descripcion}`, () => {
      expect(() => resolverUrlDelSeed(env)).toThrow(mensaje);
    });
  }
});

describe("verificarConfirmacionExplicita", () => {
  it("pasa con MOTOR2_SEED_CONFIRMAR=si", () => {
    expect(() => verificarConfirmacionExplicita({ MOTOR2_SEED_CONFIRMAR: "si" })).not.toThrow();
  });
  it("rechaza sin la variable", () => {
    expect(() => verificarConfirmacionExplicita({})).toThrow(/confirmación explícita/);
  });
  it("rechaza cualquier valor que no sea exactamente 'si' (ej. 'true', '1', mayúsculas)", () => {
    for (const valor of ["true", "1", "SI", "Si", "yes"]) expect(() => verificarConfirmacionExplicita({ MOTOR2_SEED_CONFIRMAR: valor })).toThrow();
  });
});

describe("pideRehacer", () => {
  it("true solo con MOTOR2_SEED_REHACER=si", () => {
    expect(pideRehacer({ MOTOR2_SEED_REHACER: "si" })).toBe(true);
    expect(pideRehacer({})).toBe(false);
    expect(pideRehacer({ MOTOR2_SEED_REHACER: "true" })).toBe(false);
  });
});

describe("verificarBaseVacia", () => {
  it("no hace nada si la sucursal no existe todavía", () => {
    expect(() => verificarBaseVacia("La Cuadra", false, false)).not.toThrow();
  });
  it("no hace nada si ya existe PERO se pidió rehacer", () => {
    expect(() => verificarBaseVacia("La Cuadra", true, true)).not.toThrow();
  });
  it("rechaza si ya existe y no se pidió rehacer", () => {
    expect(() => verificarBaseVacia("La Cuadra", true, false)).toThrow(/La Cuadra[\s\S]*MOTOR2_SEED_REHACER/);
  });
});

import { describe, expect, it } from "vitest";
import { hostsDeUnaConexion, primerHostNoLocal } from "../../src/core/auth/hosts-de-conexion";
import { permitirRolPrivilegiado } from "../../src/core/auth/rol-de-ejecucion";
import { resolverDestinoDelSeedBase, resolverUrlDelSeed } from "../../scripts/demo-seed/guardas-destino";
import { resolverUrlE2E } from "../e2e/fixtures/base-e2e";

/**
 * M-29 de la auditoría intermedia (S-33, S-32): `pg` (`pg-connection-string`) y libpq dan prioridad al parámetro `host` de la query sobre el host de la URL, así que
 * `postgresql://u:p@localhost/x_demo?host=10.0.0.5` parecía local —las guardas miraban solo `new URL(url).hostname`— y conectaba a `10.0.0.5`. El ataque (rojo contra el código anterior): cada
 * caso de abajo con `?host=<otro>` pasaba la guarda. Ahora las guardas cuentan el host real de la conexión.
 */
const REMOTO = "10.0.0.5";

describe("hostsDeUnaConexion: todos los hosts a los que la URL conecta de verdad", () => {
  it("el de la URL, más los de host= y hostaddr= (también listas con comas), en minúsculas y sin espacios", () => {
    expect(hostsDeUnaConexion(new URL("postgresql://u:p@LocalHost/x"))).toEqual(["localhost"]);
    expect(hostsDeUnaConexion(new URL(`postgresql://u:p@localhost/x?host=${REMOTO}`))).toEqual(["localhost", REMOTO]);
    // primero el de la URL, después los de `host=` (cada uno de la lista) y por último los de `hostaddr=`
    expect(hostsDeUnaConexion(new URL("postgresql://u:p@localhost/x?hostaddr=10.0.0.6&host=a.example.com,B.example.com"))).toEqual(["localhost", "a.example.com", "b.example.com", "10.0.0.6"]);
    expect(hostsDeUnaConexion(new URL("postgresql://u:p@localhost/x?host="))).toEqual(["localhost"]);
  });

  it("primerHostNoLocal: null solo si TODOS son locales; si no, nombra el primero que no lo es (nunca la URL)", () => {
    const locales = ["localhost", "127.0.0.1"];
    expect(primerHostNoLocal(new URL("postgresql://u:p@localhost/x"), locales)).toBeNull();
    expect(primerHostNoLocal(new URL("postgresql://u:p@localhost/x?host=127.0.0.1"), locales)).toBeNull();
    expect(primerHostNoLocal(new URL(`postgresql://u:p@localhost/x?host=${REMOTO}`), locales)).toBe(REMOTO);
    expect(primerHostNoLocal(new URL("postgresql://u:p@db.example.com/x?host=localhost"), locales)).toBe("db.example.com");
  });
});

describe("las guardas de «solo local» rechazan una URL local con ?host= apuntando a otro lado (el ataque)", () => {
  const SEED = `postgresql://u:clave@localhost:5432/motor2_demo?host=${REMOTO}`;

  it("el seed de 6 meses", () => {
    expect(() => resolverUrlDelSeed({ MOTOR2_SEED_DATABASE_URL: SEED })).toThrow(new RegExp(`Host rechazado \\(${REMOTO.replace(/\./g, "\\.")}\\)`));
    expect(() => resolverUrlDelSeed({ MOTOR2_SEED_DATABASE_URL: `postgresql://u:clave@localhost:5432/motor2_demo?hostaddr=${REMOTO}` })).toThrow(/Host rechazado/);
    // sin el parámetro (o con uno local) sigue valiendo
    expect(resolverUrlDelSeed({ MOTOR2_SEED_DATABASE_URL: "postgresql://u:clave@localhost:5432/motor2_demo?host=127.0.0.1" })).toMatchObject({ host: "localhost", nombre: "motor2_demo" });
  });

  it("el seed base: sin --permitir-remoto se rechaza; con él, es REMOTO y la confirmación nombra el host REAL", () => {
    const env = { DATABASE_URL: `postgresql://u:clave@localhost:5432/motor2?host=${REMOTO}` };
    expect(() => resolverDestinoDelSeedBase(env, { permitirRemoto: false })).toThrow(new RegExp(`Destino rechazado \\(${REMOTO.replace(/\./g, "\\.")}`));
    expect(resolverDestinoDelSeedBase(env, { permitirRemoto: true })).toEqual({ host: REMOTO, nombre: "motor2", remoto: true });
    expect(resolverDestinoDelSeedBase({ DATABASE_URL: "postgresql://u:clave@localhost:5432/motor2" }, { permitirRemoto: false })).toEqual({ host: "localhost", nombre: "motor2", remoto: false });
  });

  it("el escape del rol privilegiado: una URL local con ?host= a otra base ya no cuenta como descartable", () => {
    const base = { MOTOR2_ROL_ESTRICTO: "0" };
    expect(permitirRolPrivilegiado({ ...base, DATABASE_URL: "postgresql://u:clave@localhost:5432/motor2_real" })).toBe(true);
    expect(permitirRolPrivilegiado({ ...base, DATABASE_URL: `postgresql://u:clave@localhost:5432/motor2_real?host=${REMOTO}` })).toBe(false);
    // el nombre descartable sigue valiendo por su cuenta, aunque el host no sea local (decisión vieja de S-32)
    expect(permitirRolPrivilegiado({ ...base, DATABASE_URL: `postgresql://u:clave@${REMOTO}:5432/motor2_dev` })).toBe(true);
  });

  it("los E2E", () => {
    const env = { MOTOR2_E2E_DATABASE_URL: `postgresql://u:clave@localhost:5432/motor2_e2e?host=${REMOTO}` };
    expect(() => resolverUrlE2E(env)).toThrow(/Host rechazado/);
    expect(resolverUrlE2E({ MOTOR2_E2E_DATABASE_URL: "postgresql://u:clave@localhost:5432/motor2_e2e" })).toMatchObject({ host: "localhost", nombre: "motor2_e2e" });
  });
});

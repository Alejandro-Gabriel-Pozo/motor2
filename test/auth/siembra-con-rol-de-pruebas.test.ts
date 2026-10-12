import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { avisoSinRolDePruebas, resolverUrlDeSembrado, ROL_DE_PRUEBAS, VARIABLE_DE_PRUEBAS } from "../setup/rol-de-pruebas";

/**
 * M.3-A8: los fixtures de test SIEMBRAN con el rol de pruebas `motor2_app_pruebas` (`MOTOR2_PRUEBAS_DATABASE_URL`) mientras el código bajo prueba sigue corriendo como `motor2_app`
 * (`DATABASE_URL`, por `baseDeTest`). Sin la variable caen al comportamiento de siempre (sembrar como `motor2_app`) y avisan. `resolverUrlDeSembrado` es pura: este archivo fija qué se acepta
 * y qué se rechaza sin conectarse a nada; el resto mira, contra la base real de la corrida, con qué rol corre cada camino.
 */
afterAll(() => prismaAdmin.$disconnect());

const APP = "postgresql://motor2_app:clave-app@localhost:5432/motor2_dev";
const PRUEBAS = `postgresql://${ROL_DE_PRUEBAS}:clave-pruebas@localhost:5432/motor2_dev`;
const resolver = (urlDePruebas: string | undefined, urlDeLaApp: string | undefined = APP) => resolverUrlDeSembrado({ urlDePruebas, urlDeLaApp, variable: VARIABLE_DE_PRUEBAS });

describe("resolverUrlDeSembrado — con y sin la variable", () => {
  it("sin la variable (o vacía) siembra con la URL de la app y devuelve un aviso que nombra la variable y el script", () => {
    for (const vacia of [undefined, ""]) {
      const r = resolver(vacia);
      expect(r).toMatchObject({ url: APP, conRolDePruebas: false });
      expect(r.aviso).toContain(VARIABLE_DE_PRUEBAS);
      expect(r.aviso).toContain("crear-rol-motor2-app.sql");
      expect(r.aviso).toBe(avisoSinRolDePruebas(VARIABLE_DE_PRUEBAS));
    }
  });

  it("con la variable bien puesta siembra con ELLA y no avisa", () => {
    expect(resolver(PRUEBAS)).toEqual({ url: PRUEBAS, conRolDePruebas: true, aviso: null });
  });

  it("acepta la misma base escrita distinto (puerto por defecto explícito, host en mayúsculas)", () => {
    expect(resolver(`postgresql://${ROL_DE_PRUEBAS}:x@LOCALHOST/motor2_dev`, "postgresql://motor2_app:y@localhost:5432/motor2_dev").conRolDePruebas).toBe(true);
  });

  it.each([
    ["el rol de la aplicación (sembraría como siempre sin avisar)", "postgresql://motor2_app:x@localhost:5432/motor2_dev", /rol motor2_app_pruebas/],
    ["el dueño (saltaría el RLS)", "postgresql://motor2:x@localhost:5432/motor2_dev", /rol motor2_app_pruebas/],
    ["el rol de plataforma", "postgresql://motor2_plataforma:x@localhost:5432/motor2_dev", /rol motor2_app_pruebas/],
    ["otra base que la de la app", `postgresql://${ROL_DE_PRUEBAS}:x@localhost:5432/otra`, /misma base/],
    ["otro host", `postgresql://${ROL_DE_PRUEBAS}:x@db.ejemplo.com:5432/motor2_dev`, /misma base/],
    ["otro puerto", `postgresql://${ROL_DE_PRUEBAS}:x@localhost:5544/motor2_dev`, /misma base/],
    ["un `?host=` que cambia adónde conecta de verdad", `postgresql://${ROL_DE_PRUEBAS}:x@localhost:5432/motor2_dev?host=10.0.0.5`, /misma base/],
    ["algo que no es una URL", "esto no es una url", /no es una URL válida/],
  ])("RECHAZA %s", (_nombre, url, mensaje) => {
    expect(() => resolver(url)).toThrow(mensaje);
  });

  it("rechaza si hay variable pero no hay DATABASE_URL con que compararla (no adivina a qué base apunta)", () => {
    expect(() => resolverUrlDeSembrado({ urlDePruebas: PRUEBAS, urlDeLaApp: undefined, variable: VARIABLE_DE_PRUEBAS })).toThrow(/DATABASE_URL/);
  });

  it("los mensajes de error no llevan la URL ni la clave (la clave de una URL es un secreto)", () => {
    for (const url of ["postgresql://motor2_app:SECRETO@localhost:5432/motor2_dev", `postgresql://${ROL_DE_PRUEBAS}:SECRETO@localhost:5432/otra`, "SECRETO no es una url"]) {
      try {
        resolver(url);
        expect.unreachable("tenía que rechazar");
      } catch (e) {
        expect((e as Error).message).not.toContain("SECRETO");
      }
    }
  });
});

const usuarioDe = async (cliente: { $queryRaw: typeof prisma.$queryRaw }) => (await cliente.$queryRaw<Array<{ u: string }>>`SELECT current_user::text AS u`)[0]!.u;

describe("los fixtures contra la base de esta corrida", () => {
  beforeEach(limpiarBaseDeTest);

  it("el cliente de los fixtures (`prisma`) corre como el rol de pruebas si hay variable, y como el de la app si no; la base bajo prueba (`baseDeTest.db`) SIEMPRE como el de la app", async () => {
    const usuarioDeLaApp = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "postgresql://?").username);
    const esperado = process.env[VARIABLE_DE_PRUEBAS] ? ROL_DE_PRUEBAS : usuarioDeLaApp;
    expect(await usuarioDe(prisma)).toBe(esperado);
    expect(await usuarioDe(baseDeTest.db)).toBe(usuarioDeLaApp);
  });

  it("siembra y lee: lo que el fixture escribe lo ve el código bajo prueba (misma base, dos roles)", async () => {
    const { sucursal } = await sembrarBase();
    const vista = await baseDeTest.db.sucursal.findUniqueOrThrow({ where: { id: sucursal.id } });
    expect(vista.nombre).toBe("Central");
  });

  it.runIf(Boolean(process.env[VARIABLE_DE_PRUEBAS]))("con la variable: el rol de pruebas NO es miembro de motor2_app ni de ningún rol, y no es superusuario ni salta el RLS", async () => {
    const [r] = await prisma.$queryRaw<Array<{ miembro_de_app: boolean; membresias: number; super: boolean; bypass: boolean }>>`
      SELECT COALESCE((SELECT pg_has_role(current_user, a.oid, 'MEMBER') FROM pg_roles a WHERE a.rolname = 'motor2_app'), false) AS miembro_de_app,
             (SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles x ON x.oid = m.member WHERE x.rolname = current_user) AS membresias,
             r.rolsuper AS super, r.rolbypassrls AS bypass
        FROM pg_roles r WHERE r.rolname = current_user`;
    expect(r).toEqual({ miembro_de_app: false, membresias: 0, super: false, bypass: false });
  });
});

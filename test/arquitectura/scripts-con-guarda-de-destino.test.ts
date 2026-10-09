import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * GT-22 (S-33): los scripts que escriben fuera de la app no pueden apuntar a cualquier base ni firmar con cualquier actor.
 *  1. Toda config de vitest de un seed (`vitest.seed*.config.ts`) pasa por las guardas de destino (`scripts/demo-seed/guardas-destino.ts`: host local, base `_demo`, confirmación explícita)
 *     y fija `DATABASE_URL` DESDE esa base validada, ANTES de que `src/lib/db.ts` cree el cliente. Un seed nuevo sin guarda (o un seed sin confirmar) siembra donde diga el `.env`.
 *  2. Los scripts de plataforma (`modulos-empresa`, `politica-empresa`) exigen que `--actor` sea un administrador de plataforma ACTIVO antes de hacer el cambio.
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

describe("GT-22: los seeds pasan por las guardas de destino", () => {
  const configs = readdirSync(RAIZ).filter((n) => /^vitest\.seed.*\.config\.ts$/.test(n));

  it("el detector ve las configs de los seeds (sanidad: no pasa en vacío)", () => {
    expect(configs).toEqual(expect.arrayContaining(["vitest.seed.config.ts", "vitest.seed-6-meses.config.ts", "vitest.seed-carta-la-cuadra.config.ts"]));
  });

  it.each(configs)("%s resuelve la base con resolverUrlDelSeed, pide confirmación explícita y fija DATABASE_URL desde la base validada", (nombre) => {
    const fuente = leer(nombre);
    expect(fuente, "sin las guardas de destino").toContain('from "./scripts/demo-seed/guardas-destino"');
    expect(fuente).toMatch(/const base = resolverUrlDelSeed\(process\.env\);/);
    expect(fuente, "un seed escribe: pide confirmación").toMatch(/verificarConfirmacionExplicita\(process\.env\);/);
    expect(fuente).toMatch(/process\.env\.DATABASE_URL = base\.url;/);
    // las guardas corren ANTES de armar la config (antes de que nada se conecte)
    expect(fuente.indexOf("resolverUrlDelSeed(process.env)")).toBeLessThan(fuente.indexOf("export default"));
  });
});

describe("GT-22: ningún script de plataforma cae en DATABASE_URL", () => {
  it.each([
    "scripts/cliente-plataforma.ts",
    "scripts/conexion-de-plataforma.ts",
    "scripts/contexto-de-plataforma.ts",
    "scripts/politica-empresa.ts",
    "scripts/modulos-empresa.ts",
    "scripts/plataforma/crear-primer-admin.ts",
  ])(
    "%s no lee DATABASE_URL (la conexión de la app o del dueño)",
    (ruta) => {
      const sinComentarios = leer(ruta)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(sinComentarios).not.toMatch(/(?<![A-Z_])DATABASE_URL\b/);
    },
  );
});

const sinComentarios = (ruta: string) =>
  leer(ruta)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("GT-22: los scripts de plataforma exigen un administrador de plataforma como actor", () => {
  it.each([
    ["scripts/politica-empresa.ts", "cambiarPoliticaDeEmpresa("],
    ["scripts/modulos-empresa.ts", "cambiarModulosDeEmpresa("],
  ])("%s abre el contexto de plataforma (conexión, rol y actor) con --actor ANTES de %s, y le pasa a la operación el autor verificado", (ruta, operacion) => {
    const fuente = leer(ruta);
    const llamada = fuente.indexOf("await abrirContextoDePlataforma(process.env, { instalacion: values.instalacion, actor: values.actor })");
    const cambio = fuente.indexOf(`await ${operacion}`);
    expect(llamada, "falta abrir el contexto con el actor").toBeGreaterThan(-1);
    expect(cambio).toBeGreaterThan(-1);
    expect(llamada).toBeLessThan(cambio);
    expect(fuente, "la operación recibe el cliente y el autor del contexto, no el email a ciegas").toMatch(/contexto\.db,[\s\S]*contexto\.autor/);
  });

  it("el contexto comprueba el rol de cada conexión ANTES de buscar al actor, y lo busca en la base de IDENTIDAD (no en la que se opera)", () => {
    const fuente = sinComentarios("scripts/contexto-de-plataforma.ts");
    const rol = fuente.indexOf("exigirRol(identidad)");
    const admin = fuente.indexOf("exigirAdmin(identidad, pedido.actor)");
    expect(rol, "falta comprobar el rol de la conexión de identidad").toBeGreaterThan(-1);
    expect(fuente, "falta comprobar el rol de la conexión que se opera").toMatch(/exigirRol\(db\)/);
    expect(admin, "el administrador se verifica con el cliente de identidad").toBeGreaterThan(-1);
    expect(rol).toBeLessThan(admin);
  });

  it.each(["src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa.ts", "src/server/operaciones-de-plataforma/cambiar-politica-de-empresa.ts"])(
    "%s no busca ni crea ningún User y no escribe el registro de auditoría de la empresa: audita en AuditoriaPlataforma",
    (ruta) => {
      const fuente = sinComentarios(ruta);
      expect(fuente, "el administrador de plataforma no es un User").not.toMatch(/\.user\./);
      expect(fuente, "ya no audita a nombre de un User").not.toMatch(/registrarCambioAuditado|registroAuditoria/);
      expect(fuente).toContain("auditarCambioDePlataforma(tx,");
    },
  );
});

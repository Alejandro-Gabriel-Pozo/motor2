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

describe("GT-22: los scripts de plataforma exigen un administrador de plataforma como actor", () => {
  it.each([
    ["scripts/politica-empresa.ts", "cambiarPoliticaDeEmpresa("],
    ["scripts/modulos-empresa.ts", "cambiarModulosDeEmpresa("],
  ])("%s llama a requerirAdminDePlataforma con --actor ANTES de %s", (ruta, operacion) => {
    const fuente = leer(ruta);
    const llamada = fuente.indexOf("await requerirAdminDePlataforma(prisma, values.actor)");
    const cambio = fuente.indexOf(`await ${operacion}`);
    expect(llamada, "falta la comprobación del actor").toBeGreaterThan(-1);
    expect(cambio).toBeGreaterThan(-1);
    expect(llamada).toBeLessThan(cambio);
  });
});

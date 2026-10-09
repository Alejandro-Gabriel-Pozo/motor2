import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mensajeDeMigracionRechazadaFueraDeProduccion, mensajeDeMigracionesSinAprobar, modoDeMigracionEnBuild } from "../../scripts/construir";

describe("modoDeMigracionEnBuild — el build nunca aplica migraciones sin aprobación", () => {
  it("por defecto verifica (local, gate y CI): no aplica nada, falla si hay pendientes", () => {
    expect(modoDeMigracionEnBuild({})).toBe("verificar");
  });

  it("en un build de Producción de Vercel también verifica, no migra", () => {
    expect(modoDeMigracionEnBuild({ VERCEL: "1", VERCEL_ENV: "production" })).toBe("verificar");
  });

  it.each(["preview", "development", undefined])("no toca la base en Vercel con VERCEL_ENV=%s", (entorno) => {
    expect(modoDeMigracionEnBuild({ VERCEL: "1", VERCEL_ENV: entorno })).toBe("omitir");
  });

  it("MOTOR2_MIGRAR_EN_BUILD=1 es la aprobación explícita: aplica en local y en Producción de Vercel", () => {
    expect(modoDeMigracionEnBuild({ MOTOR2_MIGRAR_EN_BUILD: "1" })).toBe("aplicar");
    expect(modoDeMigracionEnBuild({ VERCEL: "1", VERCEL_ENV: "production", MOTOR2_MIGRAR_EN_BUILD: "1" })).toBe("aplicar");
  });

  // S-31: el Preview de `stockhneuquen` comparte la base de PRODUCCIÓN (ADR-007). Un entorno menos confiable (Preview) nunca ejecuta con el privilegio de uno más confiable
  // (Producción): la variable en un Preview no migra producción, hace FALLAR el build (no se la ignora en silencio: alguien la puso creyendo que servía).
  it.each(["preview", "development", undefined, ""])("S-31: MOTOR2_MIGRAR_EN_BUILD=1 en Vercel con VERCEL_ENV=%s NO aplica: el build se rechaza", (entorno) => {
    expect(modoDeMigracionEnBuild({ VERCEL: "1", VERCEL_ENV: entorno, MOTOR2_MIGRAR_EN_BUILD: "1" })).toBe("rechazar");
  });

  it("S-31: en Vercel fuera de Producción, 0 y los valores raros siguen omitiendo (la variable no puede ganarle a VERCEL_ENV)", () => {
    for (const valor of ["0", "si", "true", undefined]) {
      expect(modoDeMigracionEnBuild({ VERCEL: "1", VERCEL_ENV: "preview", MOTOR2_MIGRAR_EN_BUILD: valor }), String(valor)).toBe("omitir");
    }
  });

  it("S-31: el mensaje del rechazo dice qué pasó, por qué y qué hacer (sacar la variable; migrar con `npm run migrar:aprobar`)", () => {
    const mensaje = mensajeDeMigracionRechazadaFueraDeProduccion();
    expect(mensaje).toContain("MOTOR2_MIGRAR_EN_BUILD=1");
    expect(mensaje).toContain("Producción");
    expect(mensaje).toContain("npm run migrar:aprobar");
  });

  it("MOTOR2_MIGRAR_EN_BUILD=0 no toca la base, incluso en Producción o en local", () => {
    expect(modoDeMigracionEnBuild({ VERCEL: "1", VERCEL_ENV: "production", MOTOR2_MIGRAR_EN_BUILD: "0" })).toBe("omitir");
    expect(modoDeMigracionEnBuild({ MOTOR2_MIGRAR_EN_BUILD: "0" })).toBe("omitir");
  });

  it("un valor raro de MOTOR2_MIGRAR_EN_BUILD no aprueba nada: rige la decisión por defecto", () => {
    expect(modoDeMigracionEnBuild({ MOTOR2_MIGRAR_EN_BUILD: "si" })).toBe("verificar");
    expect(modoDeMigracionEnBuild({ VERCEL: "1", VERCEL_ENV: "preview", MOTOR2_MIGRAR_EN_BUILD: "si" })).toBe("omitir");
  });

  it("ningún modo distinto de «aplicar» corre `migrate deploy`: solo la aprobación explícita lo hace", () => {
    const entornos = [{}, { VERCEL: "1", VERCEL_ENV: "production" }, { VERCEL: "1", VERCEL_ENV: "preview" }, { VERCEL: "1", VERCEL_ENV: "preview", MOTOR2_MIGRAR_EN_BUILD: "1" }, { MOTOR2_MIGRAR_EN_BUILD: "0" }, { MOTOR2_MIGRAR_EN_BUILD: "true" }];
    for (const env of entornos) expect(modoDeMigracionEnBuild(env), JSON.stringify(env)).not.toBe("aplicar");
  });

  it("el mensaje de pendientes dice cómo aprobar (comando y doc)", () => {
    const mensaje = mensajeDeMigracionesSinAprobar();
    expect(mensaje).toContain("npm run migrar:aprobar");
    expect(mensaje).toContain("MOTOR2_MIGRAR_EN_BUILD=1");
    expect(mensaje).toContain("docs/deploy-con-migraciones.md");
  });
});

describe("la aprobación de migraciones está cableada", () => {
  const raiz = join(__dirname, "../..");
  const scripts = (JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

  it("`npm run migrar:aprobar` es `prisma migrate deploy` y `npm run build` pasa por construir.ts", () => {
    expect(scripts["migrar:aprobar"]).toBe("prisma migrate deploy");
    expect(scripts.build).toBe("tsx scripts/construir.ts");
  });

  it("el build de la E2E y los scripts de arranque no migran por su cuenta", () => {
    for (const [nombre, comando] of Object.entries(scripts)) {
      if (nombre === "migrar:aprobar" || nombre === "db:migrate") continue;
      expect(comando, nombre).not.toMatch(/migrate (deploy|dev)/);
    }
  });

  it("el registro de módulos se verifica solo en modo «verificar», después de `migrate status`, y su script existe", () => {
    const fuente = readFileSync(join(raiz, "scripts/construir.ts"), "utf8");
    const desde = fuente.indexOf('modo === "verificar"');
    const rama = fuente.slice(desde, fuente.indexOf("} else {", desde));
    expect(rama.indexOf("npx prisma migrate status")).toBeGreaterThan(-1);
    expect(rama.indexOf("verificar-registro-de-modulos.ts")).toBeGreaterThan(rama.indexOf("npx prisma migrate status"));
    expect(fuente.match(/verificar-registro-de-modulos/g)?.length).toBe(2); // el comentario del encabezado y la llamada
    expect(scripts["verificar:modulos"]).toBe("tsx scripts/verificar-registro-de-modulos.ts");
    expect(existsSync(join(raiz, "scripts/verificar-registro-de-modulos.ts"))).toBe(true);
  });

  it("el doc que nombra el mensaje del build existe", () => {
    expect(existsSync(join(raiz, "docs/deploy-con-migraciones.md"))).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { leerCodigoDelActor, VARIABLE_DEL_CODIGO_DE_ACTOR, type TerminalParaElCodigo } from "../../scripts/codigo-de-actor";

/**
 * M-32: de dónde sale el código del actor de un script de plataforma. Variable de entorno o prompt de la terminal; NUNCA un argumento de línea de comandos.
 * (El prompt real, que enmudece la salida mientras se escribe, necesita una terminal interactiva: NO se probó en esta tanda; la lógica de decisión sí, con una terminal falsa.)
 */
const terminal = (esInteractiva: boolean, respuesta = "654321"): TerminalParaElCodigo & { preguntar: ReturnType<typeof vi.fn> } => ({ esInteractiva, preguntar: vi.fn(async () => respuesta) });
const RAIZ = join(__dirname, "../..");

describe("leerCodigoDelActor", () => {
  it("la variable de entorno manda y no se abre el prompt", async () => {
    const t = terminal(true);
    expect(await leerCodigoDelActor({ [VARIABLE_DEL_CODIGO_DE_ACTOR]: " 123456 " }, t)).toBe("123456");
    expect(t.preguntar).not.toHaveBeenCalled();
  });

  it("sin variable y con terminal, lo pregunta (y recorta lo escrito)", async () => {
    const t = terminal(true, " 654321 ");
    expect(await leerCodigoDelActor({}, t)).toBe("654321");
    expect(t.preguntar).toHaveBeenCalledTimes(1);
  });

  it("sin variable y SIN terminal (un pipe, un cron) no hay código: no se cuelga esperando", async () => {
    const t = terminal(false);
    expect(await leerCodigoDelActor({}, t)).toBeUndefined();
    expect(t.preguntar).not.toHaveBeenCalled();
  });

  it("un prompt vacío o una variable en blanco no cuentan como código", async () => {
    expect(await leerCodigoDelActor({ [VARIABLE_DEL_CODIGO_DE_ACTOR]: "   " }, terminal(true, "  "))).toBeUndefined();
  });
});

describe("los scripts de plataforma no aceptan el código como argumento", () => {
  it.each(["scripts/modulos-empresa.ts", "scripts/politica-empresa.ts"])("%s no declara ninguna opción de línea de comandos para el código", (ruta) => {
    const fuente = readFileSync(join(RAIZ, ruta), "utf8");
    const opciones = /parseArgs\(\{\s*options:\s*\{([\s\S]*?)\},\s*strict/.exec(fuente)?.[1] ?? "";
    expect(opciones, "las opciones se leyeron").toContain("actor");
    expect(opciones).not.toMatch(/codigo|totp|code|token/i);
  });

  it("el contexto real usa la prueba del actor y el lector de código real (no una versión que se salte la comprobación)", () => {
    const fuente = readFileSync(join(RAIZ, "scripts/contexto-de-plataforma.ts"), "utf8");
    expect(fuente).toMatch(/leerCodigo: leerCodigoDelActor/);
    expect(fuente).toMatch(/probarActor: probarActorDePlataforma/);
    expect(fuente).toMatch(/await dependencias\.probarActor\(identidad, admin,/);
  });
});

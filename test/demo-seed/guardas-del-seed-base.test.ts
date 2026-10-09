import { describe, expect, it, vi } from "vitest";
import { confirmarDestinoRemoto, resolverDestinoDelSeedBase } from "../../scripts/demo-seed/guardas-destino";
import { decidirEntregaDelEnlace, entregarEnlaceDelSeed } from "../../scripts/entrega-del-enlace-del-seed";

/**
 * S-33, `prisma/seed.ts` (autorizado por el dueño, 2026-10-08): el seed base escribe en la `DATABASE_URL` del `.env` sin ninguna guarda de host (a diferencia de los seeds de demo) e imprimía el
 * enlace de la invitación del gerente —con su token— a la terminal. Ahora: solo un Postgres local, nunca producción/Vercel; una base real únicamente con `--permitir-remoto` más una confirmación
 * interactiva que muestra host y base; y el enlace no se imprime salvo con `--mostrar-enlace`. Pura, sin base ni terminal.
 */
const CLAVE = "clave-super-secreta-del-duenio";
const LOCAL = `postgresql://motor2:${CLAVE}@localhost:5432/motor2_dev`;
const REAL = `postgresql://neondb_owner:${CLAVE}@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require`;

describe("resolverDestinoDelSeedBase — qué base se acepta", () => {
  it.each([
    ["localhost", LOCAL, "localhost", "motor2_dev"],
    ["127.0.0.1", `postgresql://motor2:${CLAVE}@127.0.0.1:5432/otra_base`, "127.0.0.1", "otra_base"],
  ])("acepta un Postgres local (%s) sin flags, sin marcarlo remoto y sin devolver la URL", (_n, url, host, nombre) => {
    const destino = resolverDestinoDelSeedBase({ DATABASE_URL: url }, { permitirRemoto: false });
    expect(destino).toEqual({ host, nombre, remoto: false });
    expect(JSON.stringify(destino)).not.toContain(CLAVE);
  });

  it("el flag --permitir-remoto no cambia nada para una base local", () => {
    expect(resolverDestinoDelSeedBase({ DATABASE_URL: LOCAL }, { permitirRemoto: true })).toEqual({ host: "localhost", nombre: "motor2_dev", remoto: false });
  });
});

describe("resolverDestinoDelSeedBase — un destino remoto se rechaza sin el flag (con un mensaje claro, sin repetir la clave)", () => {
  const remotos: Array<[string, string]> = [
    ["Neon", REAL],
    ["el pooler de Neon", `postgresql://u:${CLAVE}@ep-cool-123-pooler.us-east-2.aws.neon.tech/neondb`],
    ["un host de Vercel", `postgresql://u:${CLAVE}@db.vercel-storage.com:5432/verceldb`],
    ["Supabase", `postgresql://u:${CLAVE}@db.abcdefgh.supabase.co:5432/postgres`],
    ["RDS de Amazon", `postgresql://u:${CLAVE}@mi-base.abc123.us-east-1.rds.amazonaws.com:5432/motor2`],
    ["un host remoto cualquiera", `postgresql://u:${CLAVE}@db.ejemplo.com:5432/motor2`],
  ];

  it.each(remotos)("rechaza %s, nombra el host y la base, sugiere --permitir-remoto y no repite la clave", (_n, url) => {
    let mensaje = "";
    try {
      resolverDestinoDelSeedBase({ DATABASE_URL: url }, { permitirRemoto: false });
    } catch (e) {
      mensaje = (e as Error).message;
    }
    // Mutación: aceptar cualquier host (sacar `esHostLocal`) o ignorar el flag pone este test en rojo.
    expect(mensaje).toMatch(/Destino rechazado/);
    expect(mensaje).toContain(new URL(url).hostname);
    expect(mensaje).toContain("--permitir-remoto");
    expect(mensaje).not.toContain(CLAVE);
  });

  it.each(remotos)("con --permitir-remoto deja pasar %s, marcado como REMOTO (la confirmación interactiva es lo que falta)", (_n, url) => {
    const destino = resolverDestinoDelSeedBase({ DATABASE_URL: url }, { permitirRemoto: true });
    expect(destino.remoto).toBe(true);
    expect(destino.host).toBe(new URL(url).hostname);
    expect(JSON.stringify(destino)).not.toContain(CLAVE);
  });
});

describe("resolverDestinoDelSeedBase — lo que se rechaza siempre, con o sin --permitir-remoto", () => {
  for (const permitirRemoto of [false, true]) {
    const con = permitirRemoto ? "con --permitir-remoto" : "sin --permitir-remoto";
    const casos: Array<[string, Record<string, string | undefined>, RegExp]> = [
      ["NODE_ENV=production", { DATABASE_URL: LOCAL, NODE_ENV: "production" }, /producción\/Vercel/],
      ["un entorno de Vercel (VERCEL)", { DATABASE_URL: LOCAL, VERCEL: "1" }, /producción\/Vercel/],
      ["un entorno de Vercel (VERCEL_ENV)", { DATABASE_URL: REAL, VERCEL_ENV: "preview" }, /producción\/Vercel/],
      ["sin DATABASE_URL", {}, /Falta DATABASE_URL/],
      ["una URL que no es una URL", { DATABASE_URL: "no es una url" }, /no es una URL válida/],
      ["una URL sin nombre de base", { DATABASE_URL: "postgresql://u:p@localhost:5432/" }, /nombre de la base/],
      ["localhost con un proveedor gestionado escondido en la URL", { DATABASE_URL: `postgresql://u:${CLAVE}@localhost:5432/motor2?host=ep-x.neon.tech` }, /proveedor gestionado/],
    ];
    for (const [descripcion, env, mensaje] of casos) {
      it(`rechaza ${descripcion} (${con})`, () => {
        // Mutación: sacar `verificarEntornoNoProductivo` del seed base deja pasar producción/Vercel y pone los tres primeros en rojo.
        expect(() => resolverDestinoDelSeedBase(env, { permitirRemoto })).toThrow(mensaje);
      });
    }
  }
});

describe("confirmarDestinoRemoto — la confirmación interactiva", () => {
  const remoto = { host: "ep-cool-123.us-east-2.aws.neon.tech", nombre: "neondb", remoto: true };

  it("una base local no pregunta nada, aunque la terminal no sea interactiva", async () => {
    const preguntar = vi.fn(async () => "");
    await confirmarDestinoRemoto({ host: "localhost", nombre: "motor2_dev", remoto: false }, preguntar, false);
    expect(preguntar).not.toHaveBeenCalled();
  });

  it("una base remota en una terminal NO interactiva se rechaza sin preguntar (CI, redirección)", async () => {
    // Mutación: sacar la rama `!esInteractivo` pone este test en rojo.
    const preguntar = vi.fn(async () => remoto.nombre);
    await expect(confirmarDestinoRemoto(remoto, preguntar, false)).rejects.toThrow(/no es interactiva/);
    expect(preguntar).not.toHaveBeenCalled();
  });

  it("muestra el host y el nombre de la base y exige escribir el nombre de la base", async () => {
    const preguntar = vi.fn(async () => "  neondb ");
    await expect(confirmarDestinoRemoto(remoto, preguntar, true)).resolves.toBeUndefined();
    const texto = (preguntar.mock.calls as unknown as string[][])[0][0];
    expect(texto).toContain(remoto.host);
    expect(texto).toContain(remoto.nombre);
    expect(texto).not.toContain(CLAVE);
  });

  it.each([[""], ["si"], ["y"], ["otra_base"]])("una respuesta que no es el nombre de la base (%j) NO confirma", async (respuesta) => {
    // Mutación: aceptar cualquier respuesta no vacía (o cualquiera) pone este test en rojo.
    await expect(confirmarDestinoRemoto(remoto, async () => respuesta, true)).rejects.toThrow(/no es el nombre de la base/);
  });
});

describe("el enlace de la invitación del gerente no se imprime por defecto", () => {
  const TOKEN = "TOKEN-SECRETO-DE-LA-INVITACION-0123456789";
  const ENLACE = `https://app.ejemplo.test/invitacion#t=${TOKEN}`;

  function correr(entrega: Parameters<typeof entregarEnlaceDelSeed>[0]["entrega"], enviar: () => Promise<{ enviado: boolean; motivo?: string }>) {
    const impreso: string[] = [];
    const enviarPorCorreo = vi.fn(enviar);
    const hecho = entregarEnlaceDelSeed({ entrega, email: "gerente@empresa.test", enlace: ENLACE, enviarPorCorreo, imprimir: (l) => impreso.push(l) });
    return { hecho, impreso, enviarPorCorreo };
  }

  it("decide: el flag manda; sin flag, el correo si hay canal configurado; si no, no se entrega", () => {
    expect(decidirEntregaDelEnlace({ mostrarEnlace: true, correoConfigurado: true })).toBe("mostrar");
    expect(decidirEntregaDelEnlace({ mostrarEnlace: true, correoConfigurado: false })).toBe("mostrar");
    expect(decidirEntregaDelEnlace({ mostrarEnlace: false, correoConfigurado: true })).toBe("enviar-por-correo");
    expect(decidirEntregaDelEnlace({ mostrarEnlace: false, correoConfigurado: false })).toBe("no-entregar");
  });

  it("por defecto con correo: lo manda por el canal y no imprime el token", async () => {
    const { hecho, impreso, enviarPorCorreo } = correr("enviar-por-correo", async () => ({ enviado: true }));
    await hecho;
    // Mutación: imprimir el enlace en esta rama (o en cualquiera que no sea «mostrar») pone estos tests en rojo.
    expect(enviarPorCorreo).toHaveBeenCalledTimes(1);
    expect(impreso.join("\n")).not.toContain(TOKEN);
    expect(impreso.join("\n")).toContain("gerente@empresa.test");
  });

  it("si el correo falla: lo dice y sugiere --mostrar-enlace, sin imprimir el token", async () => {
    const { hecho, impreso } = correr("enviar-por-correo", async () => ({ enviado: false, motivo: "No se pudo enviar el mail." }));
    await hecho;
    expect(impreso.join("\n")).toContain("--mostrar-enlace");
    expect(impreso.join("\n")).not.toContain(TOKEN);
  });

  it("por defecto sin canal de correo: no entrega por ningún lado, avisa cómo pedirlo y no imprime el token", async () => {
    const { hecho, impreso, enviarPorCorreo } = correr("no-entregar", async () => ({ enviado: true }));
    await hecho;
    expect(enviarPorCorreo).not.toHaveBeenCalled();
    expect(impreso.join("\n")).toContain("--mostrar-enlace");
    expect(impreso.join("\n")).not.toContain(TOKEN);
  });

  it("solo con --mostrar-enlace imprime el enlace (y no manda el correo)", async () => {
    const { hecho, impreso, enviarPorCorreo } = correr("mostrar", async () => ({ enviado: true }));
    await hecho;
    expect(impreso.join("\n")).toContain(ENLACE);
    expect(enviarPorCorreo).not.toHaveBeenCalled();
  });
});

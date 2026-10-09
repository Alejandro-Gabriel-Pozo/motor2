import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { problemasDelSeed } from "./guardas/seed-base";

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

/**
 * GT-22 (T14, M-29 de la auditoría intermedia): toda guarda de «solo contra un Postgres LOCAL» mira el host al que la conexión va DE VERDAD, no solo `new URL(url).hostname`. El cliente `pg` y
 * libpq dan prioridad al parámetro `host` de la query sobre el host de la URL, así que `postgresql://u:p@localhost/x_demo?host=10.0.0.5` parecía local, pasaba la guarda y conectaba a
 * `10.0.0.5`. `hostsDeUnaConexion`/`primerHostNoLocal` (`src/core/auth/hosts-de-conexion.ts`) devuelven todos los hosts (URL, `host=`, `hostaddr=`, listas con comas).
 *  1. Los archivos que hoy deciden «local» con una URL de base de datos usan `primerHostNoLocal` (lista cerrada).
 *  2. Un archivo NUEVO de `scripts/`, `src/` o `test/` que lea el `hostname` de una URL de base de datos y lo compare con `localhost`/`127.0.0.1` sin usar el ayudante, falla.
 * Mutación: volver `esBaseDescartable` a `HOSTS_LOCALES.has(u.hostname…)` pone en rojo el caso con `?host=` y esta lista.
 */
describe("GT-22 (M-29): las guardas de host local miran el host real de la conexión", () => {
  const GUARDAS_DE_HOST_LOCAL = ["scripts/demo-seed/guardas-destino.ts", "scripts/benchmark-reportes.ts", "test/e2e/fixtures/base-e2e.ts", "test/setup/base-temporal-migrada.ts"];

  it.each(GUARDAS_DE_HOST_LOCAL)("%s decide «local» con primerHostNoLocal (no con el hostname de la URL sola)", (ruta) => {
    const fuente = sinComentarios(ruta);
    expect(fuente).toContain("primerHostNoLocal(");
    expect(fuente, "importa el ayudante").toMatch(/from "[./]+(?:src\/)?(?:core\/)?(?:auth\/)?hosts-de-conexion"/);
  });

  it("src/core/auth/rol-de-ejecucion.ts hace lo mismo con su propia copia (lo alcanza la carta pública: un archivo nuevo sería un cambio de frontera)", () => {
    const fuente = sinComentarios("src/core/auth/rol-de-ejecucion.ts");
    expect(fuente).toMatch(/searchParams\.getAll\(clave\)/);
    expect(fuente).toMatch(/\["host", "hostaddr"\]/);
    expect(fuente, "decide con TODOS los hosts de la conexión").toMatch(/hostsDeLaConexion\(u\)\.every\(/);
  });

  /** El patrón de una guarda de host local que mira SOLO el `hostname` de una URL de base de datos (sin comentarios). */
  const miraSoloElHostname = (f: string) =>
    /\bhostname\b/.test(f) && /["'`](?:localhost|127\.0\.0\.1)["'`]/.test(f) && /DATABASE_URL|DIRECT_URL|postgres(?:ql)?:\/\//.test(f) && !/primerHostNoLocal\(|hostsDeLaConexion\(/.test(f);

  /** Archivos que miran un `hostname` contra `localhost` y tienen una URL de base de datos a la vista, pero NO son una guarda de base: con su motivo. */
  const NO_SON_GUARDA_DE_BASE: Readonly<Record<string, string>> = {
    "plataforma/src/entorno.ts": "Compara el hostname de la dirección pública de la APP (`PLATAFORMA_URL_APP`: https, o http solo en localhost) y normaliza el host de dos URL para saber si son la misma base (`mismaBase`); no decide si una base es local.",
  };

  /** Archivos de código (no `node_modules`) donde se mira una URL de base de datos y se la compara con un host local. */
  function decidenHostLocalConUnaUrlDeBase(): string[] {
    const hallados: string[] = [];
    const visitar = (dir: string): void => {
      for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
        const ruta = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (!["node_modules", ".next", "__golden__", "migrations"].includes(e.name)) visitar(ruta);
        } else if (/\.(ts|mjs)$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !ruta.startsWith("test/arquitectura/")) {
          const f = sinComentarios(ruta);
          if (miraSoloElHostname(f)) hallados.push(ruta);
        }
      }
    };
    for (const d of ["scripts", "src", "test/e2e", "test/setup", "plataforma/src"]) visitar(d);
    return hallados.sort();
  }

  it("ningún archivo decide «local» mirando solo el hostname de una URL de base de datos (salvo los de NO_SON_GUARDA_DE_BASE, con su motivo)", () => {
    const halladas = decidenHostLocalConUnaUrlDeBase();
    expect(halladas.filter((r) => !(r in NO_SON_GUARDA_DE_BASE))).toEqual([]);
    // la lista de excepciones no tiene sobrantes
    expect(Object.keys(NO_SON_GUARDA_DE_BASE).filter((r) => !halladas.includes(r))).toEqual([]);
    for (const [r, motivo] of Object.entries(NO_SON_GUARDA_DE_BASE)) expect(motivo.length, r).toBeGreaterThan(40);
  });

  it("sanidad: el detector reconoce la forma vieja de las guardas (antes del arreglo) y no la nueva", () => {
    // (rol-de-ejecucion.ts usa una copia propia —ver arriba—; su forma vieja `HOSTS_LOCALES.has(u.hostname…)` la detecta el caso con `?host=` de test/auth/hosts-de-conexion.test.ts)
    const vieja = 'const url = process.env.DATABASE_URL;\nconst host = new URL(url).hostname;\nif (host !== "localhost" && host !== "127.0.0.1") throw new Error("x");';
    expect(miraSoloElHostname(vieja)).toBe(true);
    expect(miraSoloElHostname('const noLocal = primerHostNoLocal(new URL(url), ["localhost", "127.0.0.1"]);')).toBe(false);
  });
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

/**
 * 3. `prisma/seed.ts` (autorizado por el dueño, 2026-10-08): pasa por la guarda de destino y por la confirmación de una base remota ANTES de tocar la base, y nunca imprime el enlace con el
 *    token por su cuenta (solo lo entrega `entregarEnlaceDelSeed`, que lo imprime únicamente con `--mostrar-enlace`).
 */
describe("GT-22: prisma/seed.ts no siembra cualquier base ni imprime el token", () => {
  it("pasa por la guarda de destino y la confirmación antes de la primera consulta, y no imprime el enlace por su cuenta", () => {
    expect(problemasDelSeed(leer("prisma/seed.ts"))).toEqual([]);
  });

  it("el detector ve lo que tiene que ver (el seed de antes de S-33, y variantes con un solo defecto)", () => {
    const viejo = [
      'const { values } = parseArgs({ options: { empresa: { type: "string" }, gerente: { type: "string" } }, strict: true });',
      'const { id: empresaId } = await prisma.empresa.findFirstOrThrow({ where: {} });',
      'console.log(invitacion.ok && invitacion.token ? `Para entrar: ${enlaceDeInvitacion(base, invitacion.token)}` : "no");',
    ].join("\n");
    expect(problemasDelSeed(viejo).length).toBeGreaterThanOrEqual(4);

    const bueno = [
      'const { values } = parseArgs({ options: { "permitir-remoto": { type: "boolean" }, "mostrar-enlace": { type: "boolean" } } });',
      "const destino = resolverDestinoDelSeedBase(process.env, { permitirRemoto: true });",
      "await confirmarDestinoRemoto(destino, preguntar, true);",
      "const db = dbDeEmpresa(empresaId);",
      'await entregarEnlaceDelSeed({ entrega: decidirEntregaDelEnlace({ mostrarEnlace: values["mostrar-enlace"] === true, correoConfigurado: false }), enlace: enlaceDeInvitacion(base, token) });',
    ].join("\n");
    expect(problemasDelSeed(bueno)).toEqual([]);
    expect(problemasDelSeed(bueno.replace('values["mostrar-enlace"] === true', "true")), "una entrega que no depende del flag").toHaveLength(1);
    expect(problemasDelSeed(bueno.replace("resolverDestinoDelSeedBase(process.env,", "algo("))).toHaveLength(1);
    expect(problemasDelSeed(bueno.replace("await confirmarDestinoRemoto(", "await otra("))).toHaveLength(1);
    expect(problemasDelSeed(`await prisma.x.y();\n${bueno}`)).toHaveLength(2); // guarda y confirmación después de la primera consulta
    expect(problemasDelSeed(`${bueno}\nconsole.log(\`abrí: \${enlaceDeInvitacion(base, token)}\`);`).length).toBeGreaterThanOrEqual(1);
  });
});

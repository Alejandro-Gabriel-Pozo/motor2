import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CLAVES_DE_ENTORNO_DE_PLATAFORMA, CLAVES_OPCIONALES_DE_ENTORNO_DE_PLATAFORMA } from "../../plataforma/src/entorno";
import { CLAVES_DE_ENTORNO_DECLARADAS } from "../../src/env";

/**
 * Toda variable de entorno que lee el código tiene que estar declarada en el schema de `src/env.ts` o inventariada acá con su motivo.
 *
 * El schema es lo que valida el arranque de Producción (`validarEntornoAlArrancar`): una variable que el código lee y el schema no conoce
 * puede faltar o venir mal en producción sin que nada avise, y la feature que depende de ella se rompe en silencio. Una variable nueva
 * obliga a decidir: declararla en el schema (requerida u opcional) o inventariarla acá, explicando por qué no se valida.
 */

const RAIZ = join(__dirname, "../..");

/** Variables que el código lee y que NO se validan en el schema, cada una con el motivo. */
const FUERA_DEL_SCHEMA: Record<string, string> = {
  NODE_ENV: "la fija Next.js/Node, nunca el operador",
  NEXT_RUNTIME: "la fija Next.js según el runtime que ejecuta el archivo",
  VERCEL: "la fija Vercel; solo decide si se sirve por https",
  VERCEL_ENV: "la fija Vercel; es la que decide si el schema se aplica al arrancar",
  CARTA_DOMINIO_BASE_COMPILADO: "la copia de CARTA_DOMINIO_BASE que next.config.ts incrusta al compilar; la compara el arranque, no la configura el operador",
  CARTA_EMPRESA_UNICA_COMPILADO: "la copia de CARTA_EMPRESA_UNICA que next.config.ts incrusta al compilar (add-on de la empresa única); la compara el arranque, no la configura el operador",
  DIRECT_URL: "la conexión del DUEÑO de las tablas (salta el RLS): la lee `prisma.config.ts` para migrar y la usan los scripts, nunca el runtime de la app (S-32); por eso el schema de runtime no la declara ni la exige",
  MOTOR2_SIN_DOLAR_AUTOMATICO: "flag de pruebas de navegador (no salir a internet); no es configuración de la app",
};

function archivosDeCodigo(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivosDeCodigo(ruta, salida);
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

const NOMBRES_DE_ENTORNO_COMO_PARAMETRO = new Set(["env", "source"]);

/** Variables leídas: `process.env.X`, `process.env["X"]` y `env.X`/`source.X` (el entorno que se pasa entero a una función). */
function variablesLeidas(codigo: string): string[] {
  const fuente = ts.createSourceFile("archivo.ts", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nombres = new Set<string>();
  const esProcessEnv = (e: ts.Expression) =>
    ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "process" && e.name.text === "env";
  const visitar = (nodo: ts.Node) => {
    if (ts.isPropertyAccessExpression(nodo)) {
      if (esProcessEnv(nodo.expression)) nombres.add(nodo.name.text);
      else if (ts.isIdentifier(nodo.expression) && NOMBRES_DE_ENTORNO_COMO_PARAMETRO.has(nodo.expression.text) && /^[A-Z][A-Z0-9_]+$/.test(nodo.name.text)) {
        nombres.add(nodo.name.text);
      }
    } else if (ts.isElementAccessExpression(nodo) && esProcessEnv(nodo.expression) && ts.isStringLiteralLike(nodo.argumentExpression)) {
      nombres.add(nodo.argumentExpression.text);
    } else if (
      // M-34 (auditoría intermedia): la DESESTRUCTURACIÓN `const { A, B: otra } = process.env` (o `= env`/`= source`) también lee variables y antes no se veía.
      ts.isVariableDeclaration(nodo) &&
      ts.isObjectBindingPattern(nodo.name) &&
      nodo.initializer &&
      (esProcessEnv(nodo.initializer) || (ts.isIdentifier(nodo.initializer) && NOMBRES_DE_ENTORNO_COMO_PARAMETRO.has(nodo.initializer.text)))
    ) {
      for (const e of nodo.name.elements) {
        const nombre = (e.propertyName ?? e.name).getText(fuente);
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(nombre) && !e.dotDotDotToken && (esProcessEnv(nodo.initializer) || /^[A-Z][A-Z0-9_]+$/.test(nombre))) nombres.add(nombre);
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return [...nombres];
}

function leidasPorArchivo(): Map<string, string[]> {
  // M-34: también `prisma/seed.ts` (el seed base de la app, que lee AUTH_URL y el entorno de los envíos) y, abajo, `plataforma/next.config.ts`.
  const archivos = [...archivosDeCodigo(join(RAIZ, "src")), join(RAIZ, "next.config.ts"), join(RAIZ, "prisma.config.ts"), join(RAIZ, "prisma/seed.ts")];
  const porArchivo = new Map<string, string[]>();
  for (const a of archivos) {
    const variables = variablesLeidas(readFileSync(a, "utf8"));
    if (variables.length > 0) porArchivo.set(relative(RAIZ, a).replace(/\\/g, "/"), variables);
  }
  return porArchivo;
}

describe("variables de entorno: lo que el código lee está declarado en el schema o inventariado", () => {
  const leidas = leidasPorArchivo();
  const todas = new Set([...leidas.values()].flat());
  const declaradas = new Set(CLAVES_DE_ENTORNO_DECLARADAS);

  it("el detector ve las variables de verdad (sanidad: no pasa en vacío)", () => {
    for (const esperada of ["DATABASE_URL", "CRON_SECRET", "CARTA_DOMINIO_BASE", "NODE_ENV", "AUTH_URL", "MOTOR2_ROL_ESTRICTO"]) {
      expect(todas.has(esperada), esperada).toBe(true);
    }
    expect(variablesLeidas(`const a = process.env["ALGO_NUEVO"]; const b = process.env.OTRA; sirve(env.MAS_UNA); const c = otro.NO_ES;`).sort()).toEqual(["ALGO_NUEVO", "MAS_UNA", "OTRA"]);
    // la desestructuración (M-34): de `process.env` entra cualquier nombre; de `env`/`source` (parámetros) solo los que parecen una variable (MAYÚSCULAS), y un `...resto` no es una variable
    expect(variablesLeidas(`const { DESESTRUCTURADA, OTRA_MAS: renombrada, ...resto } = process.env;`).sort()).toEqual(["DESESTRUCTURADA", "OTRA_MAS"]);
    expect(variablesLeidas(`const { PARAMETRO_A } = env; const { minuscula } = source; const { X } = otroObjeto;`)).toEqual(["PARAMETRO_A"]);
  });

  it("toda variable que el código lee está en el schema de src/env.ts o en FUERA_DEL_SCHEMA", () => {
    const sinDeclarar = [...leidas.entries()]
      .flatMap(([archivo, variables]) => variables.filter((v) => !declaradas.has(v) && !(v in FUERA_DEL_SCHEMA)).map((v) => `${v} (en ${archivo})`))
      .sort();
    expect(sinDeclarar, "variables leídas sin declarar: agregarlas al schema de src/env.ts (requerida u opcional) o a FUERA_DEL_SCHEMA con motivo").toEqual([]);
  });

  it("FUERA_DEL_SCHEMA no tiene entradas viejas, repetidas con el schema ni sin motivo", () => {
    for (const [variable, motivo] of Object.entries(FUERA_DEL_SCHEMA)) {
      expect(todas.has(variable), `"${variable}" ya no se lee en el código: sacala de FUERA_DEL_SCHEMA`).toBe(true);
      expect(declaradas.has(variable), `"${variable}" ya está en el schema: sacala de FUERA_DEL_SCHEMA`).toBe(false);
      expect(motivo.trim().length, `"${variable}" sin motivo`).toBeGreaterThan(10);
    }
  });

  it("toda variable declarada en el schema se lee en algún lado del código (no hay declaraciones muertas)", () => {
    const sinUso = [...declaradas].filter((v) => !todas.has(v) && !["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"].includes(v));
    expect(sinUso, "declaradas en el schema que ningún archivo lee").toEqual([]);
  });
});

/**
 * S-34: el guardián de arriba solo miraba `src/`, `next.config.ts` y `prisma.config.ts`. La consola (`plataforma/src`) y los scripts (`scripts/`) también leen el entorno, y una variable
 * nueva ahí (o un `NEXT_PUBLIC_*`, que se INCRUSTA en el JavaScript que baja al navegador) pasaba sin que nadie la declarara.
 *  - `plataforma/src`: lo que lee está en el esquema de la consola (`plataforma/src/entorno.ts`) o inventariado acá con su motivo.
 *  - `scripts/`: lo que lee está inventariado acá, con su motivo (no tienen esquema: cada script valida lo suyo).
 *  - `NEXT_PUBLIC_*`: lista CERRADA en todo el código. Una variable pública nueva es una decisión (se publica a cualquiera que abra la app), no un descuido.
 */
const NEXT_PUBLIC_PERMITIDAS: Record<string, string> = {
  NEXT_PUBLIC_SENTRY_DSN: "el DSN de Sentry viaja al navegador por diseño (no es secreto: solo permite ENVIAR eventos al proyecto)",
};

/** Variables que lee la consola de plataforma y que no son de su esquema. */
const FUERA_DEL_ESQUEMA_DE_LA_CONSOLA: Record<string, string> = {
  NODE_ENV: "la fija Next.js/Node; decide si la CSP deja `unsafe-eval` en desarrollo",
};

/** Variables que leen los scripts de `scripts/`, cada una con quién la usa y por qué no se valida con un esquema. */
const VARIABLES_DE_SCRIPTS: Record<string, string> = {
  NODE_ENV: "la fija Node; las guardas de destino de los seeds se niegan con `production`",
  VERCEL: "la fija Vercel; `construir.ts` decide por el entorno y las guardas de los seeds se niegan en Vercel",
  VERCEL_ENV: "la fija Vercel; `construir.ts` (S-31) y las guardas de los seeds",
  MOTOR2_MIGRAR_EN_BUILD: "`construir.ts`: aprobación explícita de migrar en el build (S-31: solo local y Producción de Vercel)",
  npm_execpath: "la fija npm al correr un script; `auditar-dependencias.ts` la usa para invocar el mismo npm",
  DIRECT_URL: "conexión del DUEÑO de las tablas: `medir-cuit.ts` y `verificar-registro-de-modulos.ts` (solo lectura); fuera del schema de runtime (S-32)",
  DATABASE_URL: "`benchmark-reportes.ts` la lee solo para comprobar que la base de benchmark NO es la principal",
  PLATAFORMA_DATABASE_URL: "los scripts de plataforma (`cliente-plataforma.ts`, `conexion-de-plataforma.ts`): el rol `motor2_plataforma`; esquema en `plataforma/src/entorno.ts`",
  PLATAFORMA_INSTALACIONES_ADICIONALES: "`conexion-de-plataforma.ts`: pide elegir instalación; esquema en `plataforma/src/entorno.ts`",
  EMPRESA_ID: "los seeds y el benchmark indican la empresa en la que siembran (ADR-022); por defecto `empresa_principal`",
  MOTOR2_BENCH_DATABASE_URL: "`benchmark-reportes.ts`: base local `_bench` dedicada",
  MOTOR2_BENCH_DIAS_HISTORIAL: "`benchmark-reportes.ts`: cuántos días de historial sembrar",
  MOTOR2_SEED_DATABASE_URL: "`demo-seed/guardas-destino.ts`: base local `_demo` de los seeds",
  MOTOR2_SEED_CONFIRMAR: "`demo-seed/guardas-destino.ts`: confirmación explícita de la corrida",
  MOTOR2_SEED_REHACER: "`demo-seed/guardas-destino.ts`: permite sembrar sobre una demo existente",
};

function leidasEn(carpetas: string[]): Map<string, string[]> {
  const porArchivo = new Map<string, string[]>();
  for (const carpeta of carpetas) {
    for (const a of archivosDeCodigo(join(RAIZ, carpeta))) {
      const variables = variablesLeidas(readFileSync(a, "utf8"));
      if (variables.length > 0) porArchivo.set(relative(RAIZ, a).replace(/\\/g, "/"), variables);
    }
  }
  return porArchivo;
}

describe("variables de entorno (S-34): la consola, los scripts y las públicas también están declaradas", () => {
  const consola = leidasEn(["plataforma/src"]);
  // M-34: la configuración de Next de la consola (fuera de `plataforma/src`) también lee el entorno.
  const variablesDeLaConfigDeLaConsola = variablesLeidas(readFileSync(join(RAIZ, "plataforma/next.config.ts"), "utf8"));
  if (variablesDeLaConfigDeLaConsola.length > 0) consola.set("plataforma/next.config.ts", variablesDeLaConfigDeLaConsola);
  const scripts = leidasEn(["scripts"]);
  const esquemaDeLaConsola = new Set([...CLAVES_DE_ENTORNO_DE_PLATAFORMA, ...CLAVES_OPCIONALES_DE_ENTORNO_DE_PLATAFORMA]);

  it("el detector ve la consola y los scripts de verdad (sanidad: no pasa en vacío)", () => {
    expect([...new Set([...consola.values()].flat())]).toContain("NODE_ENV");
    const deScripts = new Set([...scripts.values()].flat());
    for (const esperada of ["MOTOR2_MIGRAR_EN_BUILD", "PLATAFORMA_DATABASE_URL", "MOTOR2_SEED_DATABASE_URL", "DIRECT_URL"]) expect(deScripts.has(esperada), esperada).toBe(true);
  });

  it("toda variable que lee plataforma/src está en el esquema de la consola o en FUERA_DEL_ESQUEMA_DE_LA_CONSOLA", () => {
    const sinDeclarar = [...consola.entries()]
      .flatMap(([archivo, variables]) => variables.filter((v) => !esquemaDeLaConsola.has(v) && !(v in FUERA_DEL_ESQUEMA_DE_LA_CONSOLA)).map((v) => `${v} (en ${archivo})`))
      .sort();
    expect(sinDeclarar, "variables de la consola sin declarar: al esquema de plataforma/src/entorno.ts o a FUERA_DEL_ESQUEMA_DE_LA_CONSOLA con motivo").toEqual([]);
  });

  it("toda variable que leen los scripts está en VARIABLES_DE_SCRIPTS, y esa lista no tiene entradas viejas ni sin motivo", () => {
    const leidas = new Set([...scripts.values()].flat());
    const sinDeclarar = [...scripts.entries()]
      .flatMap(([archivo, variables]) => variables.filter((v) => !(v in VARIABLES_DE_SCRIPTS)).map((v) => `${v} (en ${archivo})`))
      .sort();
    expect(sinDeclarar, "variables de scripts sin inventariar: agregarlas a VARIABLES_DE_SCRIPTS con quién la usa y por qué").toEqual([]);
    for (const [variable, motivo] of Object.entries(VARIABLES_DE_SCRIPTS)) {
      expect(leidas.has(variable), `"${variable}" ya no la lee ningún script: sacala de VARIABLES_DE_SCRIPTS`).toBe(true);
      expect(motivo.trim().length, `"${variable}" sin motivo`).toBeGreaterThan(10);
    }
  });

  it("FUERA_DEL_ESQUEMA_DE_LA_CONSOLA no tiene entradas viejas, repetidas con el esquema ni sin motivo", () => {
    const leidas = new Set([...consola.values()].flat());
    for (const [variable, motivo] of Object.entries(FUERA_DEL_ESQUEMA_DE_LA_CONSOLA)) {
      expect(leidas.has(variable), `"${variable}" ya no se lee en plataforma/src: sacala`).toBe(true);
      expect(esquemaDeLaConsola.has(variable), `"${variable}" ya está en el esquema de la consola: sacala`).toBe(false);
      expect(motivo.trim().length, `"${variable}" sin motivo`).toBeGreaterThan(10);
    }
  });

  /**
   * M-34: el `env: { … }` de `next.config.ts` se INCRUSTA en el JavaScript del navegador, sea cual sea el nombre de la variable (no hace falta que empiece con `NEXT_PUBLIC_`). Lista cerrada de
   * lo que se incrusta hoy, con su motivo: agregar una clave es publicarla.
   */
  const ENV_INCRUSTADAS_EN_EL_NAVEGADOR: Record<string, Record<string, string>> = {
    "next.config.ts": {
      CARTA_DOMINIO_BASE_COMPILADO: "el dominio base público de las cartas (ya es público: es la dirección que ve cualquiera); la compara el arranque",
      CARTA_EMPRESA_UNICA_COMPILADO: "el slug de la empresa única del add-on (también público en la dirección de su carta)",
    },
    "plataforma/next.config.ts": {},
  };

  function clavesDelEnvIncrustado(ruta: string): string[] {
    return clavesDeEnvEnTexto(readFileSync(join(RAIZ, ruta), "utf8"));
  }

  function clavesDeEnvEnTexto(codigo: string): string[] {
    const sf = ts.createSourceFile("next.config.ts", codigo, ts.ScriptTarget.Latest, true);
    const claves: string[] = [];
    const visitar = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "env" && ts.isObjectLiteralExpression(n.initializer)) {
        for (const p of n.initializer.properties) claves.push(p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : "(no literal)");
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
    return claves.sort();
  }

  it("lo que `env:` incrusta en el navegador desde los next.config.ts es una lista cerrada, con motivo", () => {
    for (const [ruta, declaradas] of Object.entries(ENV_INCRUSTADAS_EN_EL_NAVEGADOR)) {
      expect(clavesDelEnvIncrustado(ruta), `${ruta}: una clave nueva en \`env:\` se publica a cualquiera que abra la app: agregarla acá es una decisión`).toEqual(Object.keys(declaradas).sort());
      for (const [clave, motivo] of Object.entries(declaradas)) expect(motivo.length, clave).toBeGreaterThan(30);
    }
    // el detector ve una clave incrustada nueva (sintético)
    expect(clavesDeEnvEnTexto('export default { env: { OTRA: process.env.SECRETA ?? "", "B": 2, [dinamica]: 3 } };')).toEqual(["(no literal)", "B", "OTRA"]);
    expect(clavesDeEnvEnTexto("export default { reactStrictMode: true };")).toEqual([]);
  });

  it("las únicas NEXT_PUBLIC_* que existen son las de la lista cerrada (en src, plataforma/src, scripts y next.config.ts), y están declaradas en el schema", () => {
    const todas = [...leidasPorArchivo().entries(), ...consola.entries(), ...scripts.entries()];
    const publicasLeidas = todas.flatMap(([archivo, variables]) => variables.filter((v) => v.startsWith("NEXT_PUBLIC_")).map((v) => `${v} (en ${archivo})`));
    const fueraDeLista = publicasLeidas.filter((p) => !(p.split(" ")[0] in NEXT_PUBLIC_PERMITIDAS));
    expect(fueraDeLista, "una variable NEXT_PUBLIC_* se incrusta en el JavaScript del navegador: agregarla a NEXT_PUBLIC_PERMITIDAS es una decisión, con su motivo").toEqual([]);
    const declaradasPublicas = CLAVES_DE_ENTORNO_DECLARADAS.filter((v) => v.startsWith("NEXT_PUBLIC_"));
    expect(declaradasPublicas.sort()).toEqual(Object.keys(NEXT_PUBLIC_PERMITIDAS).sort());
    expect(publicasLeidas.length, "el recorrido tiene que ver la variable pública que existe").toBeGreaterThan(0);
  });
});

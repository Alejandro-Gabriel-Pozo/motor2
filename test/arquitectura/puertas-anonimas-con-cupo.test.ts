import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Las puertas ANÓNIMAS de la app llevan cupo por origen ANTES de tocar la base (S-27, T11 del endurecimiento; guard GT-8, parte de la app; la de la consola, en
 * `consola-cupo-de-codigos.test.ts`). El comportamiento lo prueba `test/auth/abrir-invitacion-con-cupo-por-origen.test.ts`; esto fija la FORMA:
 *  - `abrirInvitacion` (la única Server Action de la app que se puede invocar sin sesión) consulta el cupo del origen DESPUÉS de descartar el token mal formado (no cuesta nada ni
 *    cuenta) y ANTES de `invitacionDelToken` (la consulta a la base compartida);
 *  - las otras dos acciones del archivo (`aceptarMiInvitacion*`) NIEGAN al anónimo: lo primero que hacen es pedir la sesión. Si alguna dejara de hacerlo sería una puerta
 *    anónima más y tendría que entrar acá con su propio cupo.
 *
 * Mutaciones (cada una pone un caso en rojo): sacar el cupo; ponerlo después de `invitacionDelToken`; ponerlo antes de la forma del token; una acción de aceptar que no pide la sesión primero;
 * (S-18) no pasar el cupo de CUIT al caso de uso, o consultarlo después de la consulta por CUIT.
 */
const RUTA = "src/server/actions/auth/invitacion.ts";
const fuente = ts.createSourceFile(RUTA, readFileSync(join(__dirname, "../..", RUTA), "utf8"), ts.ScriptTarget.Latest, true);

const funcion = (nombre: string): ts.FunctionDeclaration => {
  const f = fuente.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === nombre);
  if (!f?.body) throw new Error(`No encuentro ${nombre} en ${RUTA}`);
  return f;
};

/** Posición (en el texto) de cada llamada a `nombre` dentro de `nodo`. */
function posicionesDeLlamadas(nodo: ts.Node, nombre: string): number[] {
  const salida: number[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nombre) salida.push(n.getStart(fuente));
    ts.forEachChild(n, visitar);
  };
  visitar(nodo);
  return salida;
}

describe("GT-8 — las puertas anónimas de la app llevan cupo por origen antes de la base", () => {
  const abrir = funcion("abrirInvitacion");

  it("sanidad: encuentra las llamadas que ordena", () => {
    expect(posicionesDeLlamadas(abrir, "esTokenConFormaValida")).toHaveLength(1);
    expect(posicionesDeLlamadas(abrir, "invitacionDelToken")).toHaveLength(1);
  });

  it("abrirInvitacion: forma del token → cupo del origen → consulta a la base, en ese orden", () => {
    const forma = posicionesDeLlamadas(abrir, "esTokenConFormaValida")[0]!;
    const cupo = posicionesDeLlamadas(abrir, "origenSinCupoParaAbrirInvitacion");
    const consulta = posicionesDeLlamadas(abrir, "invitacionDelToken")[0]!;
    expect(cupo, "tiene que consultar el cupo del origen una vez").toHaveLength(1);
    expect(cupo[0]!, "el cupo va después de la forma del token (un token mal formado no cuenta)").toBeGreaterThan(forma);
    expect(cupo[0]!, "el cupo va ANTES de la consulta a la base").toBeLessThan(consulta);
  });

  it("las acciones de aceptar niegan al anónimo: piden la sesión antes que cualquier otra cosa", () => {
    for (const nombre of ["aceptarMiInvitacion", "aceptarMiInvitacionDeUsuario"]) {
      const f = funcion(nombre);
      const sesion = posicionesDeLlamadas(f, "getUsuarioActual");
      expect(sesion, `${nombre} tiene que pedir la sesión`).toHaveLength(1);
      for (const otra of ["cookies", "aceptarInvitacionDeGerenteCasoDeUso", "aceptarInvitacionDeUsuarioCasoDeUso"]) {
        for (const posicion of posicionesDeLlamadas(f, otra)) expect(sesion[0]!, `${nombre}: la sesión va antes que ${otra}`).toBeLessThan(posicion);
      }
    }
  });

  // S-18 (T8; GT-8 y GT-16): `aceptarMiInvitacion` le pasa al caso de uso el cupo de pruebas de CUIT (por usuario e invitación) y el caso de uso lo consulta ANTES de mirar la tabla de empresas
  // por el CUIT. El comportamiento lo prueba `test/auth/aceptar-invitacion-cupo-de-cuit.test.ts`; acá la forma: sin el cableado, el cupo quedaría escrito y sin efecto.
  it("aceptarMiInvitacion pasa el cupo de pruebas de CUIT al caso de uso, y este lo consulta antes de la consulta por CUIT a la tabla de empresas", () => {
    const aceptar = funcion("aceptarMiInvitacion");
    let pasaElCupo = false;
    const visitar = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "consultaDeCuitSinCupo" && n.getText(fuente).includes("consultaDeCuitSinCupo(")) pasaElCupo = true;
      ts.forEachChild(n, visitar);
    };
    visitar(aceptar);
    expect(pasaElCupo, "aceptarMiInvitacion tiene que pasar `consultaDeCuitSinCupo: () => consultaDeCuitSinCupo(clave, ahora)` al caso de uso").toBe(true);

    const casoDeUso = join(__dirname, "../..", "src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente.ts");
    const texto = readFileSync(casoDeUso, "utf8");
    const cupo = texto.indexOf("entrada.consultaDeCuitSinCupo?.()");
    const consulta = texto.indexOf("tx.empresa.findFirst({ where: { cuit:");
    expect(cupo, "el caso de uso consulta el cupo").toBeGreaterThan(-1);
    expect(consulta, "el caso de uso consulta la tabla de empresas por CUIT (sanidad)").toBeGreaterThan(-1);
    expect(cupo, "el cupo va ANTES de la consulta por CUIT").toBeLessThan(consulta);
  });

  it("el archivo no exporta más acciones que estas tres (una puerta nueva tiene que decidir su cupo acá)", () => {
    const exportadas = fuente.statements
      .filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      .map((s) => s.name!.text)
      .sort();
    expect(exportadas).toEqual(["aceptarMiInvitacion", "aceptarMiInvitacionDeUsuario", "abrirInvitacion"].sort());
  });
});

/**
 * I-2 de la auditoría intermedia (corrección de S-27): `GET /invitacion` es la puerta HERMANA de `abrirInvitacion`. La cookie de invitación la manda el cliente (un `curl` con
 * una cookie inventada llega a la página sin pasar por la acción), y la página consultaba la base sin cupo. El comportamiento lo prueba
 * `test/auth/pagina-de-invitacion-con-cupo-por-origen.test.tsx`; acá la FORMA: la página cuenta el mismo cupo por origen entre la forma del token y la consulta, y la lista de
 * archivos que consultan una invitación por su token es CERRADA (una puerta nueva que lea la cookie de invitación tiene que decidir su cupo acá).
 *
 * Mutaciones (cada una pone un caso en rojo): sacar el cupo de la página; ponerlo después de `invitacionConSuBase`; ponerlo antes de la forma del token; un archivo nuevo de `src/app`
 * que llame a `invitacionConSuBase`.
 */
describe("GT-8 — GET /invitacion lleva el mismo cupo por origen antes de la base (I-2)", () => {
  const RUTA_PAGINA = "src/app/invitacion/page.tsx";
  const pagina = ts.createSourceFile(RUTA_PAGINA, readFileSync(join(__dirname, "../..", RUTA_PAGINA), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const componente = pagina.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "InvitacionPage");
  const posiciones = (nombre: string): number[] => {
    const salida: number[] = [];
    const visitar = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nombre) salida.push(n.getStart(pagina));
      ts.forEachChild(n, visitar);
    };
    if (componente) visitar(componente);
    return salida;
  };

  it("sanidad: encuentra el componente y las llamadas que ordena", () => {
    expect(componente, "la página exporta InvitacionPage").toBeDefined();
    expect(posiciones("esTokenConFormaValida")).toHaveLength(1);
    expect(posiciones("invitacionConSuBase")).toHaveLength(1);
  });

  it("la página: forma del token → cupo del origen → consulta a la base, en ese orden (el mismo limitador que abrirInvitacion)", () => {
    const forma = posiciones("esTokenConFormaValida")[0]!;
    const cupo = posiciones("origenSinCupoParaAbrirInvitacion");
    const consulta = posiciones("invitacionConSuBase")[0]!;
    expect(cupo, "la página tiene que consultar el cupo del origen una vez").toHaveLength(1);
    expect(cupo[0]!, "el cupo va después de la forma del token (una cookie mal formada no cuenta)").toBeGreaterThan(forma);
    expect(cupo[0]!, "el cupo va ANTES de la consulta a la base").toBeLessThan(consulta);
  });

  it("los archivos de src que consultan una invitación por su token son exactamente los de la lista: una puerta anónima nueva decide su cupo acá", () => {
    const CONSULTAS = new Set(["invitacionDelToken", "invitacionConSuBase", "invitacionHabilitaElIngreso"]);
    const archivosTs = (dir: string): string[] =>
      readdirSync(dir).flatMap((nombre) => {
        const ruta = join(dir, nombre);
        return statSync(ruta).isDirectory() ? archivosTs(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
      });
    const raiz = join(__dirname, "../..");
    const llaman = archivosTs(join(raiz, "src"))
      .filter((f) => {
        const codigo = readFileSync(f, "utf8");
        if (![...CONSULTAS].some((c) => codigo.includes(c))) return false;
        let llama = false;
        const visitar = (n: ts.Node): void => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && CONSULTAS.has(n.expression.text)) llama = true;
          ts.forEachChild(n, visitar);
        };
        visitar(ts.createSourceFile(f, codigo, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
        return llama;
      })
      .map((f) => relative(raiz, f).split(sep).join("/"))
      .sort();
    expect(llaman).toEqual(
      [
        // Puertas ANÓNIMAS: llevan cupo por origen (se fija arriba).
        "src/app/invitacion/page.tsx",
        "src/server/actions/auth/invitacion.ts",
        // Con sesión de quien acepta (la acción pide `getUsuarioActual` primero) o dentro del gate de `signIn` (el callback de Auth.js solo corre tras el OAuth con Google).
        "src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente.ts",
        "src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-usuario.ts",
        "src/server/sesion/acceso.ts",
        "src/server/sesion/vincular-cuenta.ts",
        // Su propia definición.
        "src/server/sesion/invitacion.ts",
      ].sort(),
    );
  });
});

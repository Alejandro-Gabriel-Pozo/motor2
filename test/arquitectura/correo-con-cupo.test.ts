import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Todo mail pasa por un cupo (S-21, T11 del endurecimiento; guards GT-9 y, en su parte del correo, GT-7). Los tests de comportamiento
 * (`test/administracion/cupo-de-correo-de-invitaciones.test.ts`) reproducen el ataque; este archivo fija la FORMA del código que lo impide:
 *  - GT-9, «todo envío de correo pasa por un cupo»: la lista de archivos que llaman a `enviarCorreo` es CERRADA, cada uno con el cupo que lo cubre; y todo caso de uso que
 *    devuelve un mail por mandar (`porEnviar: { … }`) lo RESERVA antes (`reservarMailDeInvitacion`), en la misma función, con el `tx` de su transacción;
 *  - GT-7, «todo tope se lee dentro de la transacción»: el cupo se cuenta con el `tx` (nunca con `ctx.db`), después de tomar el cerrojo por empresa.
 *
 * Mutaciones (cada una pone un caso en rojo): sacar la reserva de un caso de uso; pasarle `actor.db` en lugar de `tx`; un `enviarCorreo(` nuevo en un archivo que no está en la lista;
 * contar el cupo antes de tomar el cerrojo, o con otro cliente.
 */
const RAIZ = join(__dirname, "../..");
const CARPETAS = ["src", "plataforma/src", "scripts", "prisma"];
const DEFINICIONES = new Set(["src/lib/enviar-correo.ts", "src/core/correo/enviar.ts", "src/lib/correo/resend.ts"]);

/** Cada archivo que llama a `enviarCorreo` (o a `enviarConEnviador`) y el cupo que lo cubre. Una entrada nueva obliga a decidir y a explicarlo; una que ya no llama, se saca. */
const LLAMADORES_DE_ENVIAR_CORREO: Record<string, string> = {
  "src/server/actions/auth/casos-de-uso/enviar-invitacion-y-anotar.ts":
    "invitaciones de usuario y de vinculación de la app: cada caso de uso que devuelve un `porEnviar` reserva el mail ANTES, en su transacción (cupo por empresa y por destinatario en 24 horas, `reservarMailDeInvitacion`); el único otro llamador es el seed local con guarda de destino",
  "plataforma/src/app/login/acciones.ts": "código de ingreso a la consola: cupo por administrador y por hora bajo cerrojo, más el cupo por origen (S-08, `consola-cupo-de-codigos.test.ts`)",
  "plataforma/src/app/instalaciones/[instalacion]/empresas/acciones.ts":
    "invitación del primer gerente y su reenvío: la manda un administrador de plataforma autenticado con TOTP y con freno de un minuto por invitación; SIN cupo propio todavía (residuo declarado de S-21, B14: pide el canal de correo aparte de la consola, E.8)",
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === ".next") return [];
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
  });
}

const rel = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");
const arbol = (ruta: string) => ts.createSourceFile(ruta, leer(ruta), ts.ScriptTarget.Latest, true, ruta.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function recorrer(nodo: ts.Node, visitar: (n: ts.Node) => void): void {
  visitar(nodo);
  ts.forEachChild(nodo, (hijo) => recorrer(hijo, visitar));
}

const nombreDeLlamada = (c: ts.CallExpression): string => (ts.isIdentifier(c.expression) ? c.expression.text : ts.isPropertyAccessExpression(c.expression) ? c.expression.name.text : "?");

/** Lo que manda un mail (o arma quien lo manda): llamarlo, importarlo (con o sin alias) o importar el módulo que lo define. */
const NOMBRES_QUE_ENVIAN = new Set(["enviarCorreo", "enviarConEnviador", "crearEnviadorResend", "crearEnviadorDelCanal"]);
/** Los módulos que mandan correo (el enviador del proceso, el dominio del correo y el adaptador de Resend): importarlos, de la forma que sea, es tocar el correo. */
const MODULOS_QUE_ENVIAN = /(^|\/)(enviar-correo|correo\/enviar|correo\/resend)$/;

/**
 * ¿El archivo toca el envío de correo? (GT-9, endurecido por la auditoría final): una llamada por su nombre, un `import { enviarCorreo as avisar }` (el alias esconde la llamada), el import
 * del módulo entero (`* as correo`, por defecto, `export … from`, `import("…")`) o el import DIRECTO del adaptador de Resend (`lib/correo/resend`, que se salta el cupo y el reporte).
 * Por AST: un comentario o un string no cuenta.
 */
function tocaElCorreo(fuente: ts.SourceFile): boolean {
  let toca = false;
  recorrer(fuente, (n) => {
    if (ts.isCallExpression(n)) {
      if (NOMBRES_QUE_ENVIAN.has(nombreDeLlamada(n))) toca = true;
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && MODULOS_QUE_ENVIAN.test(n.arguments[0].text)) toca = true;
    }
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      if (MODULOS_QUE_ENVIAN.test(n.moduleSpecifier.text)) toca = true;
    }
    if (ts.isImportSpecifier(n) && NOMBRES_QUE_ENVIAN.has((n.propertyName ?? n.name).text)) toca = true;
  });
  return toca;
}

/** Los archivos que mandan correo (por AST: ver `tocaElCorreo`). */
function llamadoresDeEnviarCorreo(): string[] {
  const salida: string[] = [];
  for (const carpeta of CARPETAS) {
    for (const ruta of archivos(join(RAIZ, carpeta))) {
      const r = rel(ruta);
      if (DEFINICIONES.has(r)) continue;
      if (tocaElCorreo(arbol(r))) salida.push(r);
    }
  }
  return salida.sort();
}

const funcionQueContiene = (nodo: ts.Node): ts.Node | undefined => {
  for (let p: ts.Node | undefined = nodo.parent; p; p = p.parent) if (ts.isArrowFunction(p) || ts.isFunctionExpression(p) || ts.isFunctionDeclaration(p)) return p;
  return undefined;
};

describe("GT-9 — todo envío de correo pasa por un cupo", () => {
  it("los archivos que llaman a `enviarCorreo` son exactamente los de la lista, cada uno con su cupo", () => {
    const encontrados = llamadoresDeEnviarCorreo();
    expect(encontrados, "un `enviarCorreo(` nuevo tiene que entrar a la lista de arriba con el cupo que lo cubre").toEqual(Object.keys(LLAMADORES_DE_ENVIAR_CORREO).sort());
    for (const [archivo, cupo] of Object.entries(LLAMADORES_DE_ENVIAR_CORREO)) expect(cupo.length, `${archivo} necesita el motivo`).toBeGreaterThan(40);
  });

  it("el detector ve el envío escondido: un alias del import, el módulo entero, el adaptador de Resend directo y el import dinámico (y no se confunde con un comentario)", () => {
    const toca = (codigo: string) => tocaElCorreo(ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true));
    expect(toca('import { enviarCorreo } from "@/lib/enviar-correo"; enviarCorreo("a", m);')).toBe(true);
    expect(toca('import { enviarCorreo as avisar } from "@/lib/enviar-correo"; avisar("a", m);')).toBe(true);
    expect(toca('import { enviarCorreo as avisar } from "@/lib/barril"; avisar("a", m);')).toBe(true); // el alias de un re-export: ni el nombre de la llamada ni el módulo lo delatan
    expect(toca('import * as correo from "@/lib/enviar-correo"; correo.enviarCorreo("a", m);')).toBe(true);
    expect(toca('import { crearEnviadorResend } from "@/lib/correo/resend"; const e = crearEnviadorResend();')).toBe(true);
    expect(toca('import crear from "../lib/correo/resend"; crear();')).toBe(true);
    expect(toca('export { enviarCorreo } from "@/lib/enviar-correo";')).toBe(true);
    expect(toca('const m = await import("@/lib/enviar-correo");')).toBe(true);
    expect(toca('// enviarCorreo(x)\nconst s = "import { enviarCorreo } from lib/enviar-correo"; const f = 1;')).toBe(false);
    expect(toca('import { otraCosa } from "@/lib/otra"; otraCosa();')).toBe(false);
  });

  const casosDeUso = readdirSync(join(RAIZ, "src/server/actions/auth/casos-de-uso"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `src/server/actions/auth/casos-de-uso/${f}`);

  /** Cada `porEnviar: { … }` con un objeto (un mail que SALE; `porEnviar: null` es «nada que mandar») de un archivo. */
  function mailsPorEnviar(ruta: string): ts.PropertyAssignment[] {
    const salida: ts.PropertyAssignment[] = [];
    recorrer(arbol(ruta), (n) => {
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "porEnviar" && ts.isObjectLiteralExpression(n.initializer)) salida.push(n);
    });
    return salida;
  }

  it("sanidad: el recorrido ve los casos de uso que devuelven un mail por mandar (no pasa en vacío)", () => {
    const conMail = casosDeUso.filter((r) => mailsPorEnviar(r).length > 0).map((r) => r.split("/").pop());
    expect(conMail.sort()).toEqual(["agregar-o-actualizar-usuario.ts", "invitar-a-vincular.ts", "reenviar-invitacion.ts"]);
  });

  it("todo `porEnviar: { … }` está precedido, en su misma función, por `reservarMailDeInvitacion(tx, …)` con el `tx` de la transacción", () => {
    const sinReserva: string[] = [];
    for (const ruta of casosDeUso) {
      const fuente = arbol(ruta);
      for (const mail of mailsPorEnviar(ruta)) {
        const funcion = funcionQueContiene(mail);
        const linea = fuente.getLineAndCharacterOfPosition(mail.getStart(fuente)).line + 1;
        const reservas: ts.CallExpression[] = [];
        if (funcion) recorrer(funcion, (n) => {
          if (ts.isCallExpression(n) && nombreDeLlamada(n) === "reservarMailDeInvitacion" && n.end <= mail.pos) reservas.push(n);
        });
        const conTx = reservas.filter((c) => c.arguments.length === 2 && c.arguments[0] !== undefined && ts.isIdentifier(c.arguments[0]) && c.arguments[0].text === "tx");
        if (conTx.length === 0) sinReserva.push(`${ruta}:${linea}`);
      }
    }
    expect(sinReserva, "un mail por mandar sin su reserva de cupo antes (en la misma función, con el `tx`)").toEqual([]);
  });

  it("cada caso de uso con un mail por mandar devuelve el rechazo del cupo como fracaso (envuelto en `conCupoDeCorreo`)", () => {
    for (const ruta of casosDeUso.filter((r) => mailsPorEnviar(r).length > 0)) {
      let envuelto = false;
      recorrer(arbol(ruta), (n) => {
        if (ts.isCallExpression(n) && nombreDeLlamada(n) === "conCupoDeCorreo") envuelto = true;
      });
      expect(envuelto, `${ruta} tiene que correr su transacción dentro de conCupoDeCorreo`).toBe(true);
    }
  });
});

/**
 * GT-9 consolidado (T14, M-15 de la auditoría intermedia): el guard de arriba fija los llamadores de `enviarCorreo`, pero el cupo se RESERVA en el caso de uso y quien manda el mail es
 * `enviarInvitacionYAnotar`; el comentario de ese archivo prometía una lista cerrada de sus llamadores que no existía. Ahora existe: quién llama a `enviarInvitacionYAnotar`, y que cada
 * llamada mande SOLO lo que un caso de uso dejó por enviar (`porEnviar`, ya reservado), nunca un destinatario armado a mano.
 *  - `LLAMADORES_DE_ENVIAR_INVITACION_Y_ANOTAR`: archivo → funciones que lo llaman, y de dónde sale lo que mandan. Una llamada nueva obliga a decidir y a explicarlo; una que ya no está, se saca.
 *  - Los de `usuarios.ts` reciben el envío del caso de uso: `resultado.datos.porEnviar`. `enviarYResponder` (el ayudante) lo recibe por parámetro y SUS llamadores son exactamente dos, ambos con `.datos.porEnviar`.
 * Mutaciones: una llamada nueva a `enviarInvitacionYAnotar` en otra función o archivo; un llamador de `enviarYResponder` con un envío que no sale de `porEnviar`.
 */
describe("GT-9 — los llamadores de `enviarInvitacionYAnotar` (el paso que manda el mail ya reservado) son una lista cerrada", () => {
  const LLAMADORES_DE_ENVIAR_INVITACION_Y_ANOTAR: Record<string, { funciones: string[]; motivo: string }> = {
    "src/server/actions/auth/usuarios.ts": {
      funciones: ["agregarOActualizarUsuario", "enviarYResponder"],
      motivo: "las dos mandan lo que un caso de uso devolvió como `porEnviar` (ya reservado en el cupo, dentro de su transacción), DESPUÉS del commit",
    },
    "prisma/seed.ts": { funciones: ["main"], motivo: "el seed local `--gerente`: UN mail al propio gerente, con guarda de destino (no pasa por un caso de uso ni por el cupo; no es una empresa que pueda gastarlo)" },
  };

  function llamadasA(ruta: string, nombre: string): { funcion: string; llamada: ts.CallExpression }[] {
    const salida: { funcion: string; llamada: ts.CallExpression }[] = [];
    recorrer(arbol(ruta), (n) => {
      if (ts.isCallExpression(n) && nombreDeLlamada(n) === nombre) {
        let nombreDeLaFuncion = "(módulo)";
        // la función de primer nivel con nombre que lo contiene (la flecha anónima de un callback no cuenta)
        for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
          if (ts.isFunctionDeclaration(p) && p.name) {
            nombreDeLaFuncion = p.name.text;
            break;
          }
        }
        salida.push({ funcion: nombreDeLaFuncion, llamada: n });
      }
    });
    return salida;
  }

  it("los archivos y funciones que llaman a `enviarInvitacionYAnotar` son exactamente los de la lista", () => {
    const encontrados: Record<string, string[]> = {};
    for (const carpeta of CARPETAS) {
      for (const ruta of archivos(join(RAIZ, carpeta)).map(rel)) {
        if (ruta === "src/server/actions/auth/casos-de-uso/enviar-invitacion-y-anotar.ts") continue;
        const llamadas = llamadasA(ruta, "enviarInvitacionYAnotar");
        if (llamadas.length) encontrados[ruta] = [...new Set(llamadas.map((l) => l.funcion))].sort();
      }
    }
    const declarados = Object.fromEntries(Object.entries(LLAMADORES_DE_ENVIAR_INVITACION_Y_ANOTAR).map(([r, d]) => [r, [...d.funciones].sort()]));
    expect(encontrados, "una llamada nueva a `enviarInvitacionYAnotar` se anota acá con el cupo que la cubre").toEqual(declarados);
    for (const [r, d] of Object.entries(LLAMADORES_DE_ENVIAR_INVITACION_Y_ANOTAR)) expect(d.motivo.length, r).toBeGreaterThan(40);
  });

  it("en `usuarios.ts` lo que se manda sale de `porEnviar` de un caso de uso (por parámetro del ayudante o directo)", () => {
    const ruta = "src/server/actions/auth/usuarios.ts";
    const fuente = arbol(ruta);
    // 1) quien llama a `enviarYResponder` le pasa `resultado.datos.porEnviar`
    const aYResponder = llamadasA(ruta, "enviarYResponder");
    expect(aYResponder.length, "sanidad: el ayudante tiene llamadores").toBe(2);
    for (const { llamada } of aYResponder) {
      expect(llamada.arguments[2]?.getText(fuente), "el envío del ayudante sale de `porEnviar`").toMatch(/\.datos\.porEnviar$/);
    }
    // 2) `agregarOActualizarUsuario` manda `resultado.datos.porEnviar` (la variable `envio` sale de ahí)
    const propia = llamadasA(ruta, "enviarInvitacionYAnotar").find((l) => l.funcion === "agregarOActualizarUsuario")!;
    const cuerpo = propia.llamada.parent && funcionQueContiene(propia.llamada);
    expect(cuerpo?.getText(fuente), "el envío sale de `resultado.datos.porEnviar`").toMatch(/const envio = resultado\.datos\.porEnviar;/);
  });
});

describe("GT-7 — el cupo de correo se cuenta con el `tx`, después del cerrojo por empresa", () => {
  const lectura = arbol("src/server/lecturas/auth/cupo-de-correo.ts");
  const cupo = lectura.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "cupoDeCorreoDeEmpresa");

  it("sanidad: encuentra la lectura del cupo", () => {
    expect(cupo?.body).toBeDefined();
  });

  it("toma el cerrojo (`pg_advisory_xact_lock`) con el `tx` ANTES del primer conteo, y cuenta SOLO con el `tx`", () => {
    const cerrojos: ts.Node[] = [];
    const conteos: ts.CallExpression[] = [];
    recorrer(cupo!.body!, (n) => {
      if (ts.isTaggedTemplateExpression(n) && n.getText(lectura).startsWith("tx.$queryRaw") && n.getText(lectura).includes("pg_advisory_xact_lock")) cerrojos.push(n);
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "count") conteos.push(n);
    });
    expect(cerrojos, "tiene que tomar el cerrojo por empresa con el `tx`").toHaveLength(1);
    expect(conteos.length, "cuenta los de la empresa y los del destinatario").toBe(2);
    for (const conteo of conteos) {
      expect(conteo.expression.getText(lectura), "el conteo del cupo va con `tx`").toBe("tx.registroAuditoria.count");
      expect(cerrojos[0]!.pos, "el cerrojo va antes de contar").toBeLessThan(conteo.pos);
    }
  });

  it("el cupo se lee SOLO desde `reservarMailDeInvitacion`, con el `tx` de la transacción que le pasan", () => {
    const llamadores: string[] = [];
    for (const ruta of archivos(join(RAIZ, "src")).map(rel)) {
      if (ruta === "src/server/lecturas/auth/cupo-de-correo.ts") continue;
      const fuente = arbol(ruta);
      recorrer(fuente, (n) => {
        if (ts.isCallExpression(n) && nombreDeLlamada(n) === "cupoDeCorreoDeEmpresa") {
          const dentro = funcionQueContiene(n);
          const nombre = dentro && ts.isFunctionDeclaration(dentro) ? dentro.name?.text : "?";
          const primero = n.arguments[0] && ts.isIdentifier(n.arguments[0]) ? n.arguments[0].text : "?";
          llamadores.push(`${ruta}|${nombre}|${primero}`);
        }
      });
    }
    expect(llamadores).toEqual(["src/server/actions/auth/casos-de-uso/invitaciones-de-usuario-en-tx.ts|reservarMailDeInvitacion|tx"]);
  });
});

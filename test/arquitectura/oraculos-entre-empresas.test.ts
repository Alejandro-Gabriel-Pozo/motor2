import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * GT-16 (T8 del endurecimiento de seguridad; S-18 y S-19): ORÁCULOS ENTRE EMPRESAS. Las tablas `User` y `Empresa` son globales (las leen todas las empresas y el login): una lectura de
 * una de ellas por un valor que ENTRA DEL CLIENTE (un email, un CUIT, un slug) es una pregunta «hacia afuera» de la empresa de quien pregunta. Si la respuesta visible cambia según el valor
 * exista o no afuera —«esa cuenta está desactivada en toda la plataforma», «ya hay una empresa con ese CUIT»—, probando valores se averigua qué hay en las otras empresas (regla 3 del dueño:
 * un usuario con empresa solo alcanza lo de SU empresa, se mira hacia adentro).
 *
 * Por eso toda lectura de `user` o `empresa` en `src/` está en esta lista CERRADA, con su clase:
 *  - `PROPIA`: el id sale de una fila ya leída bajo la empresa o del contexto del actor (nunca de texto del cliente).
 *  - `SIN_ORACULO`: el valor entra del cliente, pero lo que se contesta (y se hace) es lo mismo exista o no afuera (S-19: la respuesta del alta de usuarios no depende de la fila global).
 *  - `CON_LIMITADOR`: el valor entra del cliente y la prueba tiene cupo (S-18: la prueba de un CUIT; `limitador-anonimo.ts`).
 *  - `PREVIA_AL_CONTEXTO`: el login; solo contesta sobre la cuenta de quien probó controlar ese email con Google.
 *  - `PUBLICA_ACOTADA`: la carta pública por el slug de la URL; lo que contesta lo fija la lista cerrada de publicación (GT-13, tanda T9).
 *  - `PLATAFORMA`: el operador de la consola de plataforma, que NO es un usuario de empresa.
 * Una lectura nueva (o una de más en la misma función) pone el test en rojo hasta que se la clasifique con su motivo; una clasificación que sobra también.
 *
 * Mutaciones (cada una pone un caso en rojo): una lectura nueva de `user` por email en cualquier archivo de `src/`; volver el mensaje «desactivada en toda la plataforma» (lo cubre
 * `test/administracion/invitacion-de-usuario.test.ts`); sacar el cupo de la prueba de CUIT (lo cubre `test/auth/aceptar-invitacion-cupo-de-cuit.test.ts`).
 */
const RAIZ = join(__dirname, "../..");
const SRC = join(RAIZ, "src");

type Clase = "PROPIA" | "SIN_ORACULO" | "CON_LIMITADOR" | "PREVIA_AL_CONTEXTO" | "PUBLICA_ACOTADA" | "PLATAFORMA";

/** `archivo (relativo a src)|función de primer nivel|modelo` → cuántas lecturas, su clase y por qué. */
const LECTURAS: Readonly<Record<string, { lecturas: number; clase: Clase; motivo: string }>> = {
  "server/acceso/politica-de-empresa.ts|politicaDeEmpresa|empresa": { lecturas: 1, clase: "PROPIA", motivo: "la política de la empresa del contexto, por su id" },
  "server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente.ts|aceptarEnLaTransaccion|empresa": {
    lecturas: 2, clase: "CON_LIMITADOR",
    motivo: "una por el id de la empresa de la invitación (propia); la otra, por el CUIT que tipea el invitado, es la prueba «hacia afuera» de S-18: pasa por `consultaDeCuitSinCupo` (5 por hora, usuario e invitación) y pasado el cupo no se consulta",
  },
  "server/actions/auth/casos-de-uso/aceptar-invitacion-de-usuario.ts|aceptarEnLaTransaccion|empresa": { lecturas: 1, clase: "PROPIA", motivo: "la empresa de la invitación, leída por el hash del token" },
  "server/actions/auth/casos-de-uso/aceptar-invitacion-de-usuario.ts|aceptarEnLaTransaccion|user": { lecturas: 1, clase: "PROPIA", motivo: "quien otorgó la invitación, por el id guardado en ella" },
  "server/actions/auth/casos-de-uso/actualizar-activo-membresia.ts|actualizarActivoMembresiaCasoDeUso|user": { lecturas: 1, clase: "PROPIA", motivo: "el usuario de una membresía de la empresa, por su id" },
  "server/actions/auth/casos-de-uso/actualizar-notas-membresia.ts|actualizarNotasMembresiaCasoDeUso|user": { lecturas: 1, clase: "PROPIA", motivo: "el usuario de una membresía de la empresa, por su id" },
  "server/actions/auth/casos-de-uso/agregar-o-actualizar-usuario.ts|agregarOActualizarEnLaTransaccion|user": {
    lecturas: 1, clase: "SIN_ORACULO",
    motivo: "el email entra del cliente; para quien no es de la empresa se responde y se obra IGUAL exista o no la cuenta y esté o no apagada (S-19): una invitación y un mail. El estado `activoGlobal` ya no se lee ni se dice",
  },
  "server/actions/auth/casos-de-uso/crear-sucursal-con-admin.ts|crearSucursalConAdminCasoDeUso|user": {
    lecturas: 1, clase: "SIN_ORACULO",
    motivo: "el email entra del cliente; «todavía no forma parte de la empresa» es el MISMO mensaje si la cuenta no existe o existe en otra empresa: solo se sigue si ya es de ESTA empresa",
  },
  "server/actions/auth/casos-de-uso/enviar-invitacion-y-anotar.ts|enviarInvitacionYAnotar|empresa": { lecturas: 1, clase: "PROPIA", motivo: "el nombre y la zona horaria de la empresa que invita, por su id" },
  "server/actions/auth/casos-de-uso/transferir-gerencia.ts|transferirGerenciaCasoDeUso|user": { lecturas: 1, clase: "PROPIA", motivo: "el gerente anterior de la empresa, por el id que devuelve la transferencia" },
  "server/consultas/empresa/perfil.ts|obtenerPerfilDeEmpresa|empresa": { lecturas: 1, clase: "PROPIA", motivo: "el perfil de la empresa del contexto, por su id" },
  "server/lecturas/carta/empresa.ts|resolverEmpresaCarta|empresa": {
    lecturas: 1, clase: "PUBLICA_ACOTADA",
    motivo: "la carta pública por el slug de la URL: solo empresas ACTIVE y con una lista cerrada de campos (GT-13, tanda T9: 404 igual que una inexistente cuando no hay nada publicado, S-24)",
  },
  "server/operaciones-de-plataforma/cambiar-modulos-de-empresa.ts|cambiarModulosDeEmpresa|empresa": { lecturas: 1, clase: "PLATAFORMA", motivo: "el operador de la consola elige la empresa por su slug; no es un usuario de empresa" },
  "server/operaciones-de-plataforma/cambiar-politica-de-empresa.ts|cambiarPoliticaDeEmpresa|empresa": { lecturas: 1, clase: "PLATAFORMA", motivo: "el operador de la consola elige la empresa por su slug; no es un usuario de empresa" },
  "server/sesion/acceso.ts|emailPuedeIniciarSesion|user": { lecturas: 1, clase: "PREVIA_AL_CONTEXTO", motivo: "el gate de login: el kill-switch de la cuenta de quien llega con ese email de Google; contesta solo sí/no a su dueño" },
  "server/sesion/acceso.ts|decidirInicioDeSesion|user": { lecturas: 2, clase: "PREVIA_AL_CONTEXTO", motivo: "el login: «cuenta desactivada» y la cuenta de Google a vincular; quien llega probó que controla ese email con Google, y se le contesta sobre SU cuenta" },
  "server/sesion/invitacion.ts|invitacionDelToken|empresa": { lecturas: 1, clase: "PROPIA", motivo: "la empresa de la invitación leída por el hash del token (256 bits)" },
};

const METODOS_DE_LECTURA = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);
const MODELOS_GLOBALES = new Set(["user", "empresa"]);

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.tsx?$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

/** Nombre de la función de primer nivel (declaración o `const x = () =>`) que contiene al nodo, o `(módulo)`. */
function funcionDePrimerNivel(nodo: ts.Node): string {
  let nombre = "(módulo)";
  for (let actual: ts.Node | undefined = nodo; actual; actual = actual.parent) {
    if (ts.isFunctionDeclaration(actual) && actual.name && ts.isSourceFile(actual.parent)) nombre = actual.name.text;
    else if (ts.isVariableDeclaration(actual) && ts.isIdentifier(actual.name) && actual.initializer && (ts.isArrowFunction(actual.initializer) || ts.isFunctionExpression(actual.initializer))) nombre = actual.name.text;
  }
  return nombre;
}

/** Las lecturas de `user` / `empresa` de un fuente, como `función|modelo` (una entrada por llamada). */
function lecturasDeTablasGlobales(nombreDeArchivo: string, fuente: string): string[] {
  const sf = ts.createSourceFile(nombreDeArchivo, fuente, ts.ScriptTarget.Latest, true, nombreDeArchivo.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const encontradas: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && METODOS_DE_LECTURA.has(n.expression.name.text)) {
      const modelo = n.expression.expression;
      if (ts.isPropertyAccessExpression(modelo) && MODELOS_GLOBALES.has(modelo.name.text)) encontradas.push(`${funcionDePrimerNivel(n)}|${modelo.name.text}`);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return encontradas;
}

describe("GT-16: toda lectura de las tablas globales User y Empresa está clasificada (no hay oráculos entre empresas sin declarar)", () => {
  const reales = new Map<string, number>();
  for (const ruta of archivos(SRC)) {
    const rel = relative(SRC, ruta).split(sep).join("/");
    for (const lectura of lecturasDeTablasGlobales(ruta, readFileSync(ruta, "utf8"))) reales.set(`${rel}|${lectura}`, (reales.get(`${rel}|${lectura}`) ?? 0) + 1);
  }

  it("el detector ve las lecturas (con prisma global, con tx, con db) y no los comentarios ni otros modelos", () => {
    const fuente = [
      "// await tx.user.findUnique({ where: { email } })",
      'const s = "prisma.empresa.findFirst()";',
      "export async function a(tx: T, email: string) { return tx.user.findUnique({ where: { email } }); }",
      "export const b = async (db: T) => { await db.empresa.findFirst({ where: { cuit: '1' } }); return prisma.user.count(); };",
      "export async function c(tx: T) { return tx.producto.findMany(); }",
    ].join("\n");
    expect(lecturasDeTablasGlobales("f.ts", fuente)).toEqual(["a|user", "b|empresa", "b|user"]);
    expect(reales.size).toBeGreaterThan(10);
  });

  it("las lecturas reales son exactamente las clasificadas (ni una más, ni una menos, ni una cuenta distinta)", () => {
    const sobran = [...reales].filter(([k, n]) => (LECTURAS[k]?.lecturas ?? 0) !== n).map(([k, n]) => `${k}: ${n} lectura(s), clasificadas ${LECTURAS[k]?.lecturas ?? 0}`);
    const faltan = Object.keys(LECTURAS).filter((k) => !reales.has(k));
    expect(sobran, `Lecturas de User/Empresa SIN clasificar (¿la respuesta cambia según el valor exista o no afuera de la empresa? Si no, clasificala acá con su motivo; si sí, es un oráculo: arreglalo):\n${sobran.join("\n")}`).toEqual([]);
    expect(faltan, `Clasificaciones que ya no corresponden a ninguna lectura:\n${faltan.join("\n")}`).toEqual([]);
  });

  it("cada clasificación lleva motivo, y las que reciben texto del cliente (SIN_ORACULO, CON_LIMITADOR) lo explican", () => {
    for (const [clave, l] of Object.entries(LECTURAS)) {
      expect(l.motivo.trim().length, `${clave}: sin motivo`).toBeGreaterThan(25);
      if (l.clase === "CON_LIMITADOR") expect(l.motivo, `${clave}: tiene que nombrar su cupo`).toMatch(/consultaDeCuitSinCupo|cupo/);
    }
  });

  it("las dos lecturas con valor del cliente de la tanda T8 siguen cableadas: el alta de usuarios no lee `activoGlobal` y la prueba de CUIT pasa por el cupo", () => {
    const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const archivo of ["server/actions/auth/casos-de-uso/agregar-o-actualizar-usuario.ts", "server/actions/auth/casos-de-uso/invitar-a-vincular.ts"]) {
      expect(sinComentarios(readFileSync(join(SRC, archivo), "utf8")), `${archivo}: no se mira (ni se dice) el estado de la cuenta global`).not.toMatch(/activoGlobal|CUENTA_DESACTIVADA_EN_PLATAFORMA/);
    }
    const aceptar = sinComentarios(readFileSync(join(SRC, "server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente.ts"), "utf8"));
    expect(aceptar.indexOf("entrada.consultaDeCuitSinCupo"), "el cupo se consulta").toBeGreaterThan(-1);
    expect(aceptar.indexOf("entrada.consultaDeCuitSinCupo"), "ANTES de la consulta por CUIT").toBeLessThan(aceptar.indexOf("cuit: cuit.valor"));
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * M.3-A7 (RLS por sucursal, Fase A): la CARTA PÚBLICA lee las tablas de UNA sucursal con una base de SOLO LECTURA en esa sucursal, y la sucursal sale de resolver el slug. Por AST y sin base
 * (el comportamiento contra Postgres con las políticas puestas es de `test/aislamiento/carta-publica-con-politicas-de-sucursal.test.ts`); fija la FORMA del código, en las dos mitades de la frontera:
 *
 *  1. `server/carta-publica/sin-sesion.ts` (quien abre la base): el ÚNICO `dbDeEmpresa` con alcance es el de `lecturaDeUnaSolaSucursal(empresaId, sucursalId)`, y su alcance es exactamente
 *     `{ lectura: [sucursalId], escritura: [] }` (la sucursal que recibe, nada más, y nada de escritura). Esa función solo se usa dentro de la fábrica `deLaSucursal: (sucursalId) => …`, con el
 *     id que la fábrica recibe. Los demás `dbDeEmpresa` (portal, módulos, apariencia) son de nivel empresa, sin alcance.
 *  2. `server/lecturas/carta/publica.ts` (quien decide con qué id se pide esa base): `resolverCartaPublica` resuelve el slug con `bases.deLaEmpresa` (solo `sucursalPublica`), y RECIÉN DESPUÉS pide
 *     `bases.deLaSucursal(sucursalId)` con el id que salió de ese registro (`publica.sucursal.id`), una sola vez; todo lo demás de la carta se lee con esa base y la de la empresa no se vuelve a usar.
 *
 * No existe una función de «todas las sucursales» (`ensanches-de-alcance.test.ts`), y `server/acceso/alcance.ts` no está en el alcance de la carta pública (`carta-publica-alcance`, `.dependency-cruiser.cjs`):
 * este alcance mínimo lo arma la carta pública misma, con `dbDeEmpresa`, y se declara acá a propósito.
 *
 * Mutaciones (rojo → revertido editando; también como casos sintéticos abajo): `escritura: [sucursalId]`; `lectura: [empresaId]`; un `dbDeEmpresa(…, alcance)` más; pasar el slug a la fábrica; pedir la
 * base de la sucursal ANTES de resolver el slug; leer el menú con la base de la empresa.
 */
const RAIZ = join(__dirname, "../..");
const SIN_SESION = "src/server/carta-publica/sin-sesion.ts";
const PUBLICA = "src/server/lecturas/carta/publica.ts";
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

const fuente = (texto: string) => ts.createSourceFile("x.ts", texto, ts.ScriptTarget.Latest, true);
function recorrer(nodo: ts.Node, f: (n: ts.Node) => void): void {
  f(nodo);
  ts.forEachChild(nodo, (hijo) => recorrer(hijo, f));
}
const llamaA = (n: ts.Node, nombre: string): n is ts.CallExpression => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nombre;
const funcionDeclarada = (n: ts.Node): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n);
function funcionQueContiene(n: ts.Node): ts.FunctionDeclaration | undefined {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (funcionDeclarada(p)) return p;
  return undefined;
}
const nombreDeParametro = (f: ts.FunctionDeclaration, i: number) => {
  const p = f.parameters[i]?.name;
  return p && ts.isIdentifier(p) ? p.text : undefined;
};

/** ¿`n` es el literal de objeto `{ lectura: [<id>], escritura: [] }`, con `id` el identificador dado y ninguna otra propiedad? */
function esAlcanceDeSoloLecturaEn(n: ts.Expression | undefined, id: string | undefined): boolean {
  if (!n || !ts.isObjectLiteralExpression(n) || n.properties.length !== 2 || !id) return false;
  const propiedad = (nombre: string) => n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === nombre);
  const lectura = propiedad("lectura")?.initializer;
  const escritura = propiedad("escritura")?.initializer;
  const unicoElementoEsElId = !!lectura && ts.isArrayLiteralExpression(lectura) && lectura.elements.length === 1 && ts.isIdentifier(lectura.elements[0]!) && (lectura.elements[0] as ts.Identifier).text === id;
  const sinEscritura = !!escritura && ts.isArrayLiteralExpression(escritura) && escritura.elements.length === 0;
  return unicoElementoEsElId && sinEscritura;
}

/** Lo que está mal en `sin-sesion.ts` (vacío = bien). */
function problemasDeSinSesion(texto: string): string[] {
  const sf = fuente(texto);
  const problemas: string[] = [];
  let conAlcance = 0;
  let usosDeLaFuncion = 0;
  recorrer(sf, (n) => {
    if (llamaA(n, "dbDeEmpresa")) {
      if (n.arguments.length === 1) return; // nivel empresa, sin alcance por sucursal
      conAlcance++;
      const dentro = funcionQueContiene(n);
      if (n.arguments.length !== 2 || dentro?.name?.text !== "lecturaDeUnaSolaSucursal") {
        problemas.push("un dbDeEmpresa con alcance fuera de lecturaDeUnaSolaSucursal (o con más de dos argumentos)");
        return;
      }
      const empresaId = nombreDeParametro(dentro, 0);
      const argumentoEmpresa = n.arguments[0]!;
      if (!ts.isIdentifier(argumentoEmpresa) || argumentoEmpresa.text !== empresaId) problemas.push("lecturaDeUnaSolaSucursal tiene que abrir la base de la empresa que recibe");
      if (!esAlcanceDeSoloLecturaEn(n.arguments[1], nombreDeParametro(dentro, 1))) problemas.push("el alcance de lecturaDeUnaSolaSucursal tiene que ser exactamente { lectura: [sucursalId], escritura: [] } con la sucursal que recibe");
    }
    if (ts.isIdentifier(n) && n.text === "lecturaDeUnaSolaSucursal" && !ts.isFunctionDeclaration(n.parent)) {
      usosDeLaFuncion++;
      const llamada = n.parent;
      const fabrica = llamada.parent;
      const arrow = ts.isCallExpression(llamada) && llamada.expression === n && fabrica && ts.isArrowFunction(fabrica) && fabrica.body === llamada ? fabrica : undefined;
      const propiedad = arrow?.parent;
      const esDeLaSucursal = !!propiedad && ts.isPropertyAssignment(propiedad) && ts.isIdentifier(propiedad.name) && propiedad.name.text === "deLaSucursal";
      const parametro = arrow?.parameters[0]?.name;
      const ultimoArgumento = ts.isCallExpression(llamada) ? llamada.arguments[1] : undefined;
      const conElIdDeLaFabrica = !!parametro && ts.isIdentifier(parametro) && !!ultimoArgumento && ts.isIdentifier(ultimoArgumento) && ultimoArgumento.text === parametro.text && ts.isCallExpression(llamada) && llamada.arguments.length === 2;
      if (!esDeLaSucursal || !conElIdDeLaFabrica) problemas.push("lecturaDeUnaSolaSucursal solo se usa en `deLaSucursal: (sucursalId) => lecturaDeUnaSolaSucursal(empresa.id, sucursalId)`, con el id que recibe la fábrica");
    }
  });
  if (conAlcance !== 1) problemas.push(`tiene que haber exactamente UN dbDeEmpresa con alcance (el de lecturaDeUnaSolaSucursal) y hay ${conAlcance}`);
  if (usosDeLaFuncion !== 1) problemas.push(`lecturaDeUnaSolaSucursal tiene que usarse exactamente una vez y se usa ${usosDeLaFuncion}`);
  return problemas;
}

/** Lo que está mal en `resolverCartaPublica` de `publica.ts` (vacío = bien). */
function problemasDeResolverCartaPublica(texto: string): string[] {
  const sf = fuente(texto);
  const problemas: string[] = [];
  const funcion = sf.statements.find((s): s is ts.FunctionDeclaration => funcionDeclarada(s) && s.name?.text === "resolverCartaPublica");
  if (!funcion) return ["falta resolverCartaPublica"];
  const accesoA = (n: ts.Node, objeto: string, miembro: string): n is ts.PropertyAccessExpression =>
    ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === objeto && n.name.text === miembro;
  const fabricas: ts.CallExpression[] = [];
  const usosDeLaEmpresa: ts.PropertyAccessExpression[] = [];
  const declaraciones = new Map<string, ts.Expression | undefined>();
  const menus: ts.CallExpression[] = [];
  recorrer(funcion, (n) => {
    if (ts.isCallExpression(n) && accesoA(n.expression, "bases", "deLaSucursal")) fabricas.push(n);
    if (accesoA(n, "bases", "deLaEmpresa")) usosDeLaEmpresa.push(n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) declaraciones.set(n.name.text, n.initializer);
    if (llamaA(n, "resolverMenuCarta")) menus.push(n);
  });
  if (fabricas.length !== 1) return [...problemas, `tiene que pedir bases.deLaSucursal(...) exactamente una vez y lo pide ${fabricas.length}`];
  const fabrica = fabricas[0]!;
  const argumento = fabrica.arguments[0];
  if (fabrica.arguments.length !== 1 || !argumento || !ts.isIdentifier(argumento) || argumento.text !== "sucursalId") problemas.push("la base de la sucursal se pide con `sucursalId` y nada más");
  if (declaraciones.get("sucursalId")?.getText(sf) !== "publica.sucursal.id") problemas.push("`sucursalId` tiene que salir de `publica.sucursal.id` (la sucursal que resolvió el slug en SucursalPublica)");
  // Antes de la fábrica solo se lee `sucursalPublica` con la base de la empresa; después, la base de la empresa no se vuelve a usar.
  for (const uso of usosDeLaEmpresa) {
    const antes = uso.getStart(sf) < fabrica.getStart(sf);
    const lee = ts.isPropertyAccessExpression(uso.parent) && uso.parent.name.text === "sucursalPublica";
    if (!antes) problemas.push("la base de la empresa se usa DESPUÉS de abrir la de la sucursal");
    else if (!lee) problemas.push("antes de resolver el slug la base de la empresa solo puede leer `sucursalPublica`");
  }
  const lecturaDelRegistro = usosDeLaEmpresa.some((u) => ts.isPropertyAccessExpression(u.parent) && u.parent.name.text === "sucursalPublica" && u.getStart(sf) < fabrica.getStart(sf));
  if (!lecturaDelRegistro) problemas.push("el slug se resuelve en `sucursalPublica` con bases.deLaEmpresa ANTES de pedir la base de la sucursal");
  // La base de la sucursal se guarda en `db` y es la que lee el menú.
  const db = declaraciones.get("db");
  if (!db || db.getText(sf) !== "bases.deLaSucursal(sucursalId)") problemas.push("`db` tiene que ser exactamente `bases.deLaSucursal(sucursalId)`");
  if (menus.length === 0) problemas.push("falta la lectura del menú");
  for (const menu of menus) {
    const base = menu.arguments[1];
    if (!base || !ts.isIdentifier(base) || base.text !== "db") problemas.push("el menú se lee con `db` (la base de la sucursal), no con la de la empresa");
  }
  return problemas;
}

describe("M.3-A7: la carta pública lee con una base de SOLO LECTURA en la sucursal que resolvió el slug", () => {
  it("sin-sesion.ts: el único alcance por sucursal es { lectura: [sucursalId], escritura: [] } y la fábrica lo recibe con el id que le llega", () => {
    expect(problemasDeSinSesion(leer(SIN_SESION))).toEqual([]);
  });

  it("publica.ts: resolverCartaPublica resuelve el slug con la base de la empresa y recién después abre la de la sucursal, con el id del registro", () => {
    expect(problemasDeResolverCartaPublica(leer(PUBLICA))).toEqual([]);
  });

  describe("el propio guardián (mutaciones sintéticas sobre los archivos reales)", () => {
    const sinSesion = leer(SIN_SESION);
    const publica = leer(PUBLICA);
    const mutar = (texto: string, de: string, a: string) => {
      expect(texto, `la mutación «${de}» tiene que existir en el archivo`).toContain(de);
      return texto.replace(de, a);
    };

    it("ve un alcance con escritura, con la lectura equivocada o con otra forma", () => {
      const llamada = "dbDeEmpresa(empresaId, { lectura: [sucursalId], escritura: [] })";
      expect(problemasDeSinSesion(mutar(sinSesion, llamada, "dbDeEmpresa(empresaId, { lectura: [sucursalId], escritura: [sucursalId] })"))).not.toEqual([]);
      expect(problemasDeSinSesion(mutar(sinSesion, llamada, "dbDeEmpresa(empresaId, { lectura: [empresaId], escritura: [] })"))).not.toEqual([]);
      expect(problemasDeSinSesion(mutar(sinSesion, llamada, "dbDeEmpresa(empresaId, { lectura: [sucursalId, empresaId], escritura: [] })"))).not.toEqual([]);
      expect(problemasDeSinSesion(mutar(sinSesion, llamada, "dbDeEmpresa(empresaId, { lectura: [sucursalId] })"))).not.toEqual([]);
      expect(problemasDeSinSesion(mutar(sinSesion, llamada, "dbDeEmpresa(sucursalId, { lectura: [sucursalId], escritura: [] })"))).not.toEqual([]);
    });

    it("ve que se abra otra base con alcance, que se quite el alcance o que se use la fábrica con otro id", () => {
      expect(problemasDeSinSesion(mutar(sinSesion, "const db = dbDeEmpresa(empresa.id);\n    if (!(await modulosQueLaCartaPublica(empresa, db)).carta) return resolverEstiloPortal(undefined);", "const db = dbDeEmpresa(empresa.id, { lectura: [], escritura: [] });\n    if (!(await modulosQueLaCartaPublica(empresa, db)).carta) return resolverEstiloPortal(undefined);"))).not.toEqual([]);
      expect(problemasDeSinSesion(mutar(sinSesion, "dbDeEmpresa(empresaId, { lectura: [sucursalId], escritura: [] })", "dbDeEmpresa(empresaId)"))).not.toEqual([]);
      expect(problemasDeSinSesion(mutar(sinSesion, "lecturaDeUnaSolaSucursal(empresa.id, sucursalId)", "lecturaDeUnaSolaSucursal(empresa.id, slug)"))).not.toEqual([]);
      expect(problemasDeSinSesion(mutar(sinSesion, "(sucursalId: string) => lecturaDeUnaSolaSucursal(empresa.id, sucursalId)", "() => lecturaDeUnaSolaSucursal(empresa.id, slug)"))).not.toEqual([]);
    });

    it("ve que se pida la base de la sucursal con el slug, antes de resolver el slug, o que se lea el menú con la base de la empresa", () => {
      expect(problemasDeResolverCartaPublica(mutar(publica, "bases.deLaSucursal(sucursalId)", "bases.deLaSucursal(slug)"))).not.toEqual([]);
      expect(problemasDeResolverCartaPublica(mutar(publica, "const sucursalId = publica.sucursal.id;", "const sucursalId = slug;"))).not.toEqual([]);
      expect(problemasDeResolverCartaPublica(mutar(publica, "resolverMenuCarta(sucursalId, db,", "resolverMenuCarta(sucursalId, bases.deLaEmpresa,"))).not.toEqual([]);
      expect(problemasDeResolverCartaPublica(mutar(publica, "db.sucursal.findUnique({ where: { id: sucursalId }", "bases.deLaEmpresa.sucursal.findUnique({ where: { id: sucursalId }"))).not.toEqual([]);
      // Pedir la base de la sucursal antes de leer el registro: se mueve la lectura de `sucursalPublica` a un usuario de la empresa DESPUÉS.
      const adelantada = mutar(publica, "if (!esSlugPublicoValido(slug)) return null;\n  const publica = await bases.deLaEmpresa.sucursalPublica", "if (!esSlugPublicoValido(slug)) return null;\n  const previa = bases.deLaSucursal(slug);\n  const publica = await bases.deLaEmpresa.sucursalPublica");
      expect(problemasDeResolverCartaPublica(adelantada)).not.toEqual([]);
    });
  });
});

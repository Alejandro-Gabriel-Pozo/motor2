import ts from "typescript";

/**
 * Qué RECIBE cada Server Action del cliente: los números y los arreglos de sus parámetros, mirando los tipos (en línea, de la misma fuente o de cualquier archivo de `src/`). Lo usa GT-11
 * (`numeros-del-cliente-con-rango.test.ts`, tanda T14 del plan de endurecimiento de seguridad). Por AST y sin `ts.Program`: resuelve los tipos NOMBRADOS por su nombre en un índice de todo
 * `src/` (`interface`, `type X = …`), con un tope de profundidad y sin vueltas. Un tipo que no se puede resolver (de un paquete, genérico, mapeado) no aporta nada: el guardián no inventa.
 */

export type Miembros = ReadonlyMap<string, ts.TypeNode>;
export type IndiceDeMiembros = ReadonlyMap<string, Miembros>;

const miembrosDe = (members: ts.NodeArray<ts.TypeElement>): Map<string, ts.TypeNode> => {
  const salida = new Map<string, ts.TypeNode>();
  for (const m of members) if (ts.isPropertySignature(m) && m.type && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) salida.set(m.name.text, m.type);
  return salida;
};

/** Índice `nombre del tipo → sus miembros` de las fuentes dadas (texto de cada archivo). Una `interface` o un `type X = { … }`; las intersecciones suman los miembros de cada parte. */
export function indiceDeMiembros(fuentes: Iterable<string>): IndiceDeMiembros {
  const indice = new Map<string, Map<string, ts.TypeNode>>();
  const alias: { nombre: string; tipo: ts.TypeNode }[] = [];
  for (const codigo of fuentes) {
    if (!/\b(interface|type)\b/.test(codigo)) continue;
    const sf = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
    for (const s of sf.statements) {
      if (ts.isInterfaceDeclaration(s)) indice.set(s.name.text, miembrosDe(s.members));
      if (ts.isTypeAliasDeclaration(s)) alias.push({ nombre: s.name.text, tipo: s.type });
    }
  }
  const deUnTipo = (tipo: ts.TypeNode): Map<string, ts.TypeNode> => {
    if (ts.isTypeLiteralNode(tipo)) return miembrosDe(tipo.members);
    if (ts.isParenthesizedTypeNode(tipo)) return deUnTipo(tipo.type);
    if (ts.isIntersectionTypeNode(tipo)) return new Map(tipo.types.flatMap((t) => [...deUnTipo(t)]));
    if (ts.isTypeReferenceNode(tipo) && indice.has(tipo.typeName.getText())) return new Map(indice.get(tipo.typeName.getText())!);
    return new Map();
  };
  for (const { nombre, tipo } of alias) {
    const m = deUnTipo(tipo);
    if (m.size) indice.set(nombre, m);
  }
  return indice;
}

export interface EntradaDeUnaAccion {
  /** `archivo|función`. */
  clave: string;
  /** Rutas de los valores numéricos (`cantidad`, `datos.cantidad`, `lineas[].precio`). */
  numericos: string[];
  /** Rutas de los arreglos (`ids[]`, `datos.lineas[]`). */
  arreglos: string[];
  /** Las funciones que llama el cuerpo (identificadores y propiedades), para buscar la evidencia del rango. */
  llamadas: Set<string>;
}

const PROFUNDIDAD = 6;

function recorrer(tipo: ts.TypeNode | undefined, ruta: string, indice: IndiceDeMiembros, vistos: readonly string[], salida: { numericos: string[]; arreglos: string[] }): void {
  if (!tipo || vistos.length > PROFUNDIDAD) return;
  if (tipo.kind === ts.SyntaxKind.NumberKeyword) salida.numericos.push(ruta);
  else if (ts.isParenthesizedTypeNode(tipo)) recorrer(tipo.type, ruta, indice, vistos, salida);
  else if (ts.isUnionTypeNode(tipo) || ts.isIntersectionTypeNode(tipo)) for (const t of tipo.types) recorrer(t, ruta, indice, vistos, salida);
  else if (ts.isArrayTypeNode(tipo)) {
    salida.arreglos.push(`${ruta}[]`);
    recorrer(tipo.elementType, `${ruta}[]`, indice, vistos, salida);
  } else if (ts.isTypeOperatorNode(tipo)) recorrer(tipo.type, ruta, indice, vistos, salida);
  else if (ts.isTupleTypeNode(tipo)) for (const t of tipo.elements) recorrer(t, ruta, indice, vistos, salida);
  else if (ts.isTypeLiteralNode(tipo)) for (const [n, t] of miembrosDe(tipo.members)) recorrer(t, ruta === "" ? n : `${ruta}.${n}`, indice, vistos, salida);
  else if (ts.isTypeReferenceNode(tipo)) {
    const nombre = tipo.typeName.getText();
    if (/^(Array|ReadonlyArray)$/.test(nombre) && tipo.typeArguments?.[0]) {
      salida.arreglos.push(`${ruta}[]`);
      recorrer(tipo.typeArguments[0], `${ruta}[]`, indice, vistos, salida);
    } else if (/^(Partial|Required|Readonly|NonNullable|Awaited)$/.test(nombre) && tipo.typeArguments?.[0]) recorrer(tipo.typeArguments[0], ruta, indice, vistos, salida);
    else if (indice.has(nombre) && !vistos.includes(nombre)) {
      for (const [n, t] of indice.get(nombre)!) recorrer(t, ruta === "" ? n : `${ruta}.${n}`, indice, [...vistos, nombre], salida);
    }
  }
}

/** Las Server Actions exportadas de un archivo `"use server"`, con los números y arreglos que reciben. */
export function entradasDeLasAcciones(rutaRelativa: string, codigo: string, indice: IndiceDeMiembros): EntradaDeUnaAccion[] {
  const sf = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  const primera = sf.statements[0];
  if (!(primera && ts.isExpressionStatement(primera) && ts.isStringLiteral(primera.expression) && primera.expression.text === "use server")) return [];
  const salida: EntradaDeUnaAccion[] = [];
  const agregar = (nombre: string, parametros: readonly ts.ParameterDeclaration[], cuerpo: ts.ConciseBody | undefined) => {
    const e = { numericos: [] as string[], arreglos: [] as string[] };
    for (const p of parametros) {
      const nombreDelParametro = ts.isIdentifier(p.name) ? p.name.text : "";
      recorrer(p.type, nombreDelParametro, indice, [], e);
    }
    const llamadas = new Set<string>();
    const visitar = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        if (ts.isIdentifier(n.expression)) llamadas.add(n.expression.text);
        else if (ts.isPropertyAccessExpression(n.expression)) llamadas.add(n.expression.name.text);
      }
      ts.forEachChild(n, visitar);
    };
    if (cuerpo) visitar(cuerpo);
    if (e.numericos.length || e.arreglos.length) salida.push({ clave: `${rutaRelativa}|${nombre}`, numericos: e.numericos, arreglos: e.arreglos, llamadas });
  };
  for (const s of sf.statements) {
    const exportada = ts.canHaveModifiers(s) && !!ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exportada) continue;
    if (ts.isFunctionDeclaration(s) && s.name) agregar(s.name.text, s.parameters, s.body);
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) agregar(d.name.text, d.initializer.parameters, d.initializer.body);
      }
    }
  }
  return salida;
}

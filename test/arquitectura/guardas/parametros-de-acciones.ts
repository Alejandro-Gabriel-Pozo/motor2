import ts from "typescript";
import { esArchivoUseServer, funcionDeInicializador } from "./analizador";

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

/** Índice `nombre del tipo → sus miembros` de las fuentes dadas (texto de cada archivo). Una `interface` o un `type X = { … }`; las intersecciones suman los miembros de cada parte; `Partial`/`Omit`/`Pick` de un tipo nombrado aportan los de ese tipo. */
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
    // `Partial<X>`, `Omit<X, …>`, `Pick<X, …>`…: los miembros de X (M.2-A4: `DatosProductoEdicion`). Sobre-aproxima (no quita las claves de `Omit` ni se queda solo con las de `Pick`): un guardián que ve de más no deja pasar nada.
    if (ts.isTypeReferenceNode(tipo) && /^(Partial|Required|Readonly|Pick|Omit)$/.test(tipo.typeName.getText()) && tipo.typeArguments?.[0]) return deUnTipo(tipo.typeArguments[0]);
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
  /** Rutas de los valores `unknown`/`any` (entradas opacas: pueden ser números o arreglos sin que el tipo lo diga). */
  opacos: string[];
  /** Las funciones que llama el cuerpo (identificadores y propiedades), para buscar la evidencia del rango. */
  llamadas: Set<string>;
}

const PROFUNDIDAD = 6;

function recorrer(tipo: ts.TypeNode | undefined, ruta: string, indice: IndiceDeMiembros, vistos: readonly string[], salida: { numericos: string[]; arreglos: string[]; opacos: string[] }): void {
  if (!tipo || vistos.length > PROFUNDIDAD) return;
  if (tipo.kind === ts.SyntaxKind.NumberKeyword) salida.numericos.push(ruta);
  // `unknown` / `any`: el cliente puede mandar CUALQUIER cosa (un número, un `NaN`, un arreglo) y el tipo no lo dice. Es una entrada «opaca» que también necesita su guard o su pendiente (I-2 de la
  // auditoría final: `actualizarCliente(…, descuentoPorcentaje: unknown)` movía plata con el % validado solo en el caso de uso y GT-11 no lo veía).
  else if (tipo.kind === ts.SyntaxKind.UnknownKeyword || tipo.kind === ts.SyntaxKind.AnyKeyword) salida.opacos.push(ruta);
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
    } else if (/^(Partial|Required|Readonly|NonNullable|Awaited|Pick|Omit)$/.test(nombre) && tipo.typeArguments?.[0]) recorrer(tipo.typeArguments[0], ruta, indice, vistos, salida);
    else if (indice.has(nombre) && !vistos.includes(nombre)) {
      for (const [n, t] of indice.get(nombre)!) recorrer(t, ruta === "" ? n : `${ruta}.${n}`, indice, [...vistos, nombre], salida);
    }
  }
}

/** `typeof <nombre> === "string"` (o `==`), solo o como una de las partes de un `&&`, entre paréntesis o no. */
function esCondicionDeTexto(cond: ts.Expression, nombre: string): boolean {
  if (ts.isParenthesizedExpression(cond)) return esCondicionDeTexto(cond.expression, nombre);
  if (!ts.isBinaryExpression(cond)) return false;
  const operador = cond.operatorToken.kind;
  if (operador === ts.SyntaxKind.AmpersandAmpersandToken) return esCondicionDeTexto(cond.left, nombre) || esCondicionDeTexto(cond.right, nombre);
  if (operador !== ts.SyntaxKind.EqualsEqualsEqualsToken && operador !== ts.SyntaxKind.EqualsEqualsToken) return false;
  const esTypeofDelParametro = (x: ts.Expression) => ts.isTypeOfExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === nombre;
  const esLaPalabraString = (x: ts.Expression) => ts.isStringLiteral(x) && x.text === "string";
  return (esTypeofDelParametro(cond.left) && esLaPalabraString(cond.right)) || (esTypeofDelParametro(cond.right) && esLaPalabraString(cond.left));
}

/** ¿Esta referencia al parámetro es solo mirar su tipo (`typeof x`) o está donde ya se sabe que es un TEXTO (la rama verdadera de `typeof x === "string"`, o lo que sigue en el `&&`)? */
function esReferenciaDeTexto(referencia: ts.Identifier, nombre: string): boolean {
  let hijo: ts.Node = referencia;
  for (let padre: ts.Node | undefined = referencia.parent; padre; hijo = padre, padre = padre.parent) {
    if (ts.isTypeOfExpression(padre)) return true;
    if (ts.isConditionalExpression(padre) && padre.whenTrue === hijo && esCondicionDeTexto(padre.condition, nombre)) return true;
    if (ts.isIfStatement(padre) && padre.thenStatement === hijo && esCondicionDeTexto(padre.expression, nombre)) return true;
    if (ts.isBinaryExpression(padre) && padre.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && padre.right === hijo && esCondicionDeTexto(padre.left, nombre)) return true;
  }
  return false;
}

/**
 * Falso positivo de `unknown` (I-2 ampliada a `unknown`/`any`): un parámetro opaco que el cuerpo SOLO usa como texto —cada referencia es `typeof x` o está en la rama de `typeof x === "string"`— no es un
 * número ni un arreglo que el cliente pueda colar: o es un texto o se ignora (`cambiarEmpresaActiva(empresaId, volver?: unknown)`: con un `<form action>` el último argumento es el `FormData`). Conservador: `typeof x ===
 * "number"`, pasarlo entero a otra función, usarlo fuera de la rama o negar la condición lo dejan opaco.
 */
function soloSeUsaComoTexto(cuerpo: ts.Node, nombre: string): boolean {
  let referencias = 0;
  let todasDeTexto = true;
  const visitar = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === nombre) {
      const p = n.parent;
      const esNombreDePropiedad = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n);
      if (!esNombreDePropiedad) {
        referencias++;
        if (!esReferenciaDeTexto(n, nombre)) todasDeTexto = false;
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(cuerpo);
  return referencias > 0 && todasDeTexto;
}

/** Las Server Actions exportadas de un archivo `"use server"`, con los números y arreglos que reciben. */
export function entradasDeLasAcciones(rutaRelativa: string, codigo: string, indice: IndiceDeMiembros): EntradaDeUnaAccion[] {
  const sf = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  if (!esArchivoUseServer(codigo)) return [];
  const salida: EntradaDeUnaAccion[] = [];
  const agregar = (nombre: string, parametros: readonly ts.ParameterDeclaration[], cuerpo: ts.ConciseBody | undefined) => {
    const e = { numericos: [] as string[], arreglos: [] as string[], opacos: [] as string[] };
    for (const p of parametros) {
      const nombreDelParametro = ts.isIdentifier(p.name) ? p.name.text : "";
      const opacosAntes = e.opacos.length;
      recorrer(p.type, nombreDelParametro, indice, [], e);
      // Un parámetro `unknown`/`any` (declarado así, no anidado) que el cuerpo solo usa como texto no es una entrada numérica ni de arreglo: no se inventaría (ver `soloSeUsaComoTexto`).
      const esOpacoDirecto = p.type?.kind === ts.SyntaxKind.UnknownKeyword || p.type?.kind === ts.SyntaxKind.AnyKeyword;
      if (esOpacoDirecto && cuerpo && e.opacos.length > opacosAntes && soloSeUsaComoTexto(cuerpo, nombreDelParametro)) e.opacos.length = opacosAntes;
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
    if (e.numericos.length || e.arreglos.length || e.opacos.length) salida.push({ clave: `${rutaRelativa}|${nombre}`, numericos: e.numericos, arreglos: e.arreglos, opacos: e.opacos, llamadas });
  };
  for (const s of sf.statements) {
    const exportada = ts.canHaveModifiers(s) && !!ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exportada) continue;
    if (ts.isFunctionDeclaration(s) && s.name) agregar(s.name.text, s.parameters, s.body);
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        // I-2 de la auditoría final: también la acción exportada como constante con envoltorio o `as` (`export const x = conRegistro(async (n: number) => …)`).
        const funcion = ts.isIdentifier(d.name) && d.initializer ? funcionDeInicializador(d.initializer) : undefined;
        if (funcion && ts.isIdentifier(d.name)) agregar(d.name.text, funcion.parameters, funcion.body);
      }
    }
  }
  return salida;
}

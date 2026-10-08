import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: lo que mueve plata (o cambia el SIGNIFICADO de una cantidad) y se edita a mano deja su rastro en la auditoría
 * administrativa (`RegistroAuditoria`), en la MISMA función que lo escribe. Reescrita en Pureza 0.7 (hallazgo H4 de la auditoría): antes era una
 * lista fija de 5 modelos y miraba el ARCHIVO entero (una función auditada dejaba pasar a las demás del archivo); ahora está INVERTIDA y es por FUNCIÓN.
 *
 * Qué exige. En `src/server/actions/**`, `src/core/**` y `src/server/persistencia/**`: toda función que ESCRIBA (`create`, `createMany`, `update`,
 * `updateMany`, `upsert`) una columna de dinero de un modelo, tiene que llamar a `registrarCambioAuditado` (o a una función del mismo archivo que lo llame).
 * La persistencia (`server/persistencia/`) no audita por sí misma: escribe lo que le pide un caso de uso, que es quien audita. Por eso, para una escritura
 * de dinero en persistencia se exige la CADENA: TODA función que la llama (directa o por un ayudante, en el mismo archivo o importándola de otro) tiene
 * que auditar, y tiene que haber al menos una que la llame. Así, al mover una escritura de dinero de una acción a la persistencia, el control no se pierde. «Columna de dinero» es TODA columna `Decimal` de `prisma/schema.prisma`
 * (sale del esquema: un modelo o una columna nueva queda cubierta sin tocar este test) más las «columnas de significado» de abajo. Si el `data` no se
 * puede leer (un spread o una variable), se supone que toca dinero: falla cerrado.
 *
 * Qué NO exige (cada excepción con su motivo, y revisada en las dos direcciones: una que ya no hace falta falla, así la lista solo puede achicarse):
 *  - Los modelos que SON su propia historia (documentos y datos de fuente externa): `MODELOS_QUE_SON_SU_PROPIA_HISTORIA`.
 *  - Las columnas `Decimal` que no son plata ni cambian un costo: `COLUMNAS_QUE_NO_SON_DINERO`.
 *  - Funciones puntuales que no pueden auditar por diseño: `FUNCIONES_EXCEPTUADAS`.
 *
 * Cómo se controla: AST de TypeScript (no texto plano). Que la auditoría se escriba de verdad lo prueban los tests de cada acción.
 */
const RAIZ = join(__dirname, "../..");
// Incluye la consola de plataforma y las operaciones de plataforma por script (auditoría de la Fase 0, 0.7): hoy no escriben `Decimal`, pero si una tabla de plataforma suma uno, que se vea.
const CARPETAS = ["src/server/actions", "src/core", "src/server/persistencia", "plataforma/src/servidor", "src/server/operaciones-de-plataforma"];
/** Donde buscar a quienes llaman a una escritura de la persistencia (la cadena caso de uso → persistencia). */
const CARPETAS_DE_LLAMADORES = ["src/server", "src/core"];
const ZONA_PERSISTENCIA = "src/server/persistencia/";
const OPERACIONES_DE_ESCRITURA = new Set(["create", "createMany", "update", "updateMany", "upsert"]);

/** Columnas que no son `Decimal` pero cambian el significado de una cantidad: modelo → columnas (`"*"` = cualquier escritura del modelo). */
const COLUMNAS_DE_SIGNIFICADO: Record<string, string[] | "*"> = {
  unidad: ["decimales"],
  disponibilidadProducto: "*",
};

/** Modelos cuya fila ES el rastro (un documento propio o un dato de fuente externa): no hay un valor anterior que se pierda al escribirlos. */
const MODELOS_QUE_SON_SU_PROPIA_HISTORIA: Record<string, string> = {
  movimientoStock: "El Kardex: solo agrega, cada fila lleva operación, usuario y fecha (kardex-solo-agrega.test.ts).",
  cuentaItem: "Línea de la cuenta de una mesa (documento del POS): se agrega y se anula con su estado y usuario; el precio es el congelado de la carta.",
  promoCuenta: "Promo cobrada en una cuenta (documento del POS): copia el precio congelado de la carta, no es una configuración editable.",
  cotizacionDolar: "Dato de una fuente externa sincronizado por un cron, una fila por día: no lo edita nadie a mano.",
  indicePrecio: "Dato de una fuente externa (IPC) sincronizado por un cron: no lo edita nadie a mano.",
};

/** `modelo.columna` que es `Decimal` pero no es plata ni cambia un costo. */
const COLUMNAS_QUE_NO_SON_DINERO: Record<string, string> = {
  "sucursalPublica.posX": "Coordenada del mapa del portal de cartas: posición en pantalla, no plata.",
  "sucursalPublica.posY": "Coordenada del mapa del portal de cartas: posición en pantalla, no plata.",
  "sucursalPublica.posW": "Ancho de un recuadro del mapa del portal de cartas: no es plata.",
  "sucursalPublica.posH": "Alto de un recuadro del mapa del portal de cartas: no es plata.",
  "stockMinimoProducto.minimo": "Umbral de la alerta de stock bajo: no mueve plata ni el costo (no entra a ninguna valuación).",
};

/** `archivo|función` que escribe dinero y no audita, con el motivo. Cada una es DEUDA CONOCIDA o una decisión de diseño: la lista solo puede achicarse. */
const FUNCIONES_EXCEPTUADAS: Record<string, string> = {
  "plataforma/src/servidor/sembrar-empresa.ts|sembrarEmpresa":
    "Siembra de una empresa NUEVA (la consola de plataforma): crea sus unidades de fábrica con los decimales de la semilla. No hay un valor anterior que se pierda ni cantidades que ya dependan de ellos (la empresa está en alta, sin movimientos); cada cambio posterior de los decimales de una unidad lo audita `actualizarDecimalesUnidad`. La huella del gobierno (`test/auth/caracterizacion/huella-de-gobierno`) fija lo que siembra.",
  "src/server/actions/catalogo/productos.ts|darDeAltaProducto":
    "Alta de un producto: no hay valor anterior que se pierda, y se crea SIN transacción a propósito (reintenta el código ante `P2002`, ver su docstring), así que la auditoría no puede ir atómica con la creación. Cada cambio posterior del precio lo audita `actualizarProducto`.",
  "src/server/actions/catalogo/productos.ts|darDeAltaProductoRapido":
    "Alta rápida de una MP con factor 1 (sin precio): misma razón que `darDeAltaProducto` (creación sin transacción por el reintento del código).",
  // Hito 4, H4C-8: la escritura del alta pasó de `actions/catalogo/unidades.ts|crearUnidad` a la persistencia (la llama solo `casos-de-uso/crear-unidad.ts`).
  "src/server/persistencia/catalogo/unidades.ts|crearUnidadNueva":
    "Alta de una unidad nueva: todavía nada la usa, así que no hay un valor anterior ni cantidades cuyo significado cambie. Cada cambio posterior de sus decimales lo audita `actualizarDecimalesUnidad`.",
};

interface Escritura {
  archivo: string;
  linea: number;
  funcion: string;
  modelo: string;
  operacion: string;
  /** Columnas de dinero o de significado que toca (`["(no verificable)"]` si el `data` no se puede leer). */
  columnas: string[];
  audita: boolean;
}

/** Columnas `Decimal` por modelo (el delegado, con la primera letra en minúscula), leídas de `prisma/schema.prisma`. */
function columnasDecimales(schema: string): Map<string, Set<string>> {
  const salida = new Map<string, Set<string>>();
  for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const columnas = [...m[2].matchAll(/^\s*(\w+)\s+Decimal\??/gm)].map((c) => c[1]);
    if (columnas.length > 0) salida.set(m[1].charAt(0).toLowerCase() + m[1].slice(1), new Set(columnas));
  }
  return salida;
}

/** Las relaciones del schema: delegado del modelo → nombre del campo de relación → delegado del modelo relacionado (`RecetaVersion.ingredientes` → `recetaIngrediente`). */
export function relacionesDelSchema(schema: string): Map<string, Map<string, string>> {
  const modelos = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  const nombres = new Set(modelos.map((m) => m[1]));
  const delegado = (n: string) => n.charAt(0).toLowerCase() + n.slice(1);
  const salida = new Map<string, Map<string, string>>();
  for (const m of modelos) {
    const campos = new Map<string, string>();
    for (const c of m[2].matchAll(/^\s*(\w+)\s+(\w+)(\[\])?\??\s/gm)) if (nombres.has(c[2])) campos.set(c[1], delegado(c[2]));
    if (campos.size > 0) salida.set(delegado(m[1]), campos);
  }
  return salida;
}

const OPERACIONES_ANIDADAS = new Set(["create", "createMany", "connectOrCreate", "update", "updateMany", "upsert"]);

/** Las propiedades (clave → valor) de un literal de objeto, o de cada elemento de un array de literales; `null` si algo no se puede leer (spread, propiedad calculada, no literal). */
function propiedadesDe(nodo: ts.Expression): { clave: string; valor: ts.Expression }[] | null {
  const filas = ts.isArrayLiteralExpression(nodo) ? [...nodo.elements] : [nodo];
  const salida: { clave: string; valor: ts.Expression }[] = [];
  for (const fila of filas) {
    if (!ts.isObjectLiteralExpression(fila)) return null;
    for (const p of fila.properties) {
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) salida.push({ clave: p.name.text, valor: p.initializer });
      else if (ts.isShorthandPropertyAssignment(p)) salida.push({ clave: p.name.text, valor: p.name });
      else return null;
    }
  }
  return salida;
}

/**
 * Las escrituras ANIDADAS de un `data` (`data: { ingredientes: { create: [{ cantidad }] } }`): la regla antes solo miraba las claves de primer nivel del modelo, así que un `Decimal` escrito
 * a través de una relación quedaba invisible (auditoría de la Fase 0, 0.7). Para cada campo de relación con una operación anidada se devuelven las columnas que escribe en el modelo
 * relacionado; `null` en `columnas` = no se pudo leer (falla cerrado). Recursivo (una relación dentro de otra).
 */
export function escriturasAnidadas(
  data: ts.Expression,
  modelo: string,
  relaciones: ReadonlyMap<string, ReadonlyMap<string, string>>
): { modelo: string; columnas: string[] | null }[] {
  const propiedades = propiedadesDe(data);
  if (propiedades === null) return [];
  const resultado: { modelo: string; columnas: string[] | null }[] = [];
  for (const { clave, valor } of propiedades) {
    const relacionado = relaciones.get(modelo)?.get(clave);
    if (!relacionado || !ts.isObjectLiteralExpression(valor)) continue;
    for (const op of valor.properties) {
      if (!ts.isPropertyAssignment(op) || !ts.isIdentifier(op.name) || !OPERACIONES_ANIDADAS.has(op.name.text)) continue;
      // Dónde está el `data` de cada operación: create → el valor; createMany → su `data`; update/updateMany → su `data`; upsert → `create` y `update`; connectOrCreate → su `create`.
      const datas: ts.Expression[] = [];
      const hijo = ts.isObjectLiteralExpression(op.initializer) ? propiedadesDe(op.initializer) : null;
      if (op.name.text === "create") datas.push(op.initializer);
      else if (hijo === null && !ts.isArrayLiteralExpression(op.initializer)) {
        resultado.push({ modelo: relacionado, columnas: null });
        continue;
      } else if (op.name.text === "createMany" || op.name.text === "update" || op.name.text === "updateMany") datas.push(...(hijo ?? []).filter((h) => h.clave === "data").map((h) => h.valor));
      else if (op.name.text === "upsert" || op.name.text === "connectOrCreate") datas.push(...(hijo ?? []).filter((h) => h.clave === "create" || h.clave === "update").map((h) => h.valor));
      for (const d of datas) {
        const props = propiedadesDe(d);
        if (props === null) resultado.push({ modelo: relacionado, columnas: null });
        else {
          resultado.push({ modelo: relacionado, columnas: props.map((x) => x.clave) });
          resultado.push(...escriturasAnidadas(d, relacionado, relaciones));
        }
      }
    }
  }
  return resultado;
}

function clavesDeData(llamada: ts.CallExpression): string[] | null {
  const argumento = llamada.arguments[0];
  if (!argumento || !ts.isObjectLiteralExpression(argumento)) return null;
  const claves: string[] = [];
  let encontroData = false;
  for (const p of argumento.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) || !["data", "create", "update"].includes(p.name.text)) continue;
    encontroData = true;
    const filas = ts.isArrayLiteralExpression(p.initializer) ? [...p.initializer.elements] : [p.initializer];
    for (const fila of filas) {
      if (!ts.isObjectLiteralExpression(fila)) return null;
      for (const campo of fila.properties) {
        if ((ts.isPropertyAssignment(campo) || ts.isShorthandPropertyAssignment(campo)) && ts.isIdentifier(campo.name)) claves.push(campo.name.text);
        else return null; // un spread o una propiedad calculada: no se puede leer
      }
    }
  }
  return encontroData ? claves : null;
}

/** Una función de primer nivel de un archivo, con lo que llama y si audita directamente. */
export interface Unidad {
  nodo: ts.Node;
  llama: Set<string>;
  auditaDirecto: boolean;
}

/** Las funciones de primer nivel de un archivo (declaradas o asignadas a una constante), con lo que llaman. */
function extraerUnidades(fuente: ts.SourceFile): Map<string, Unidad> {
  const unidades = new Map<string, Unidad>();
  const registrar = (nombre: string, nodo: ts.Node) => {
    const llama = new Set<string>();
    let auditaDirecto = false;
    const visitar = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        if (n.expression.text === "registrarCambioAuditado") auditaDirecto = true;
        llama.add(n.expression.text);
      }
      ts.forEachChild(n, visitar);
    };
    visitar(nodo);
    unidades.set(nombre, { nodo, llama, auditaDirecto });
  };
  for (const s of fuente.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) registrar(s.name.text, s);
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) registrar(d.name.text, d.initializer);
      }
    }
  }
  return unidades;
}

/** `true` si la función audita ella misma o por un ayudante del mismo archivo. */
function auditaEnElArchivo(unidades: ReadonlyMap<string, Unidad>, nombre: string, visitadas = new Set<string>()): boolean {
  if (visitadas.has(nombre)) return false;
  visitadas.add(nombre);
  const u = unidades.get(nombre);
  if (!u) return false;
  return u.auditaDirecto || [...u.llama].some((otra) => unidades.has(otra) && auditaEnElArchivo(unidades, otra, visitadas));
}

/** Las escrituras de dinero (o de significado) de un archivo, con su función y si esa función audita. */
export function leerEscrituras(codigo: string, archivo: string, decimales: ReadonlyMap<string, ReadonlySet<string>>, relaciones: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map()): Escritura[] {
  const fuente = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true, archivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  // 1) Las funciones de primer nivel, con lo que llaman (para resolver «llama a un helper del archivo que audita»).
  const unidades = extraerUnidades(fuente);
  const audita = (nombre: string) => auditaEnElArchivo(unidades, nombre);

  // 2) Las escrituras, cada una atribuida a la función de primer nivel que la contiene.
  const escrituras: Escritura[] = [];
  const funcionDeNivelSuperior = (nodo: ts.Node): string => {
    for (const [nombre, u] of unidades) if (nodo.pos >= u.nodo.pos && nodo.end <= u.nodo.end) return nombre;
    return "(módulo)";
  };
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && OPERACIONES_DE_ESCRITURA.has(n.expression.name.text) && ts.isPropertyAccessExpression(n.expression.expression)) {
      const modelo = n.expression.expression.name.text;
      const columnasDeDinero = decimales.get(modelo);
      const significado = COLUMNAS_DE_SIGNIFICADO[modelo];
      if (columnasDeDinero || significado) {
        const claves = clavesDeData(n);
        let tocadas: string[];
        if (claves === null) tocadas = ["(no verificable)"];
        else if (significado === "*") tocadas = ["(cualquier escritura)"];
        else tocadas = claves.filter((c) => columnasDeDinero?.has(c) || significado?.includes(c));
        if (tocadas.length > 0) {
          const funcion = funcionDeNivelSuperior(n);
          escrituras.push({
            archivo,
            linea: fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1,
            funcion,
            modelo,
            operacion: n.expression.name.text,
            columnas: tocadas,
            audita: audita(funcion),
          });
        }
      }
    }
    // Escrituras ANIDADAS por relación (`data: { ingredientes: { create: [...] } }`): el `Decimal` que se escribe en el modelo relacionado cuenta como una escritura de ESE modelo.
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && OPERACIONES_DE_ESCRITURA.has(n.expression.name.text) && ts.isPropertyAccessExpression(n.expression.expression)) {
      const dueño = n.expression.expression.name.text;
      const argumento = n.arguments[0];
      const dataNodo = argumento && ts.isObjectLiteralExpression(argumento) ? argumento.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && ["data", "create", "update"].includes(p.name.text)) : undefined;
      if (dataNodo && relaciones.size > 0) {
        for (const anidada of escriturasAnidadas(dataNodo.initializer, dueño, relaciones)) {
          const columnasDeDinero = decimales.get(anidada.modelo);
          const significado = COLUMNAS_DE_SIGNIFICADO[anidada.modelo];
          if (!columnasDeDinero && !significado) continue;
          const tocadas = anidada.columnas === null ? ["(no verificable)"] : significado === "*" ? ["(cualquier escritura)"] : anidada.columnas.filter((c) => columnasDeDinero?.has(c) || significado?.includes(c));
          if (tocadas.length === 0) continue;
          const funcion = funcionDeNivelSuperior(n);
          escrituras.push({ archivo, linea: fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1, funcion, modelo: anidada.modelo, operacion: `${n.expression.name.text} (anidada en ${dueño})`, columnas: tocadas, audita: audita(funcion) });
        }
      }
    }
    // SQL CRUDO (`$executeRaw` con plantilla, o `$executeRawUnsafe("…")`): la regla antes solo veía `x.<modelo>.<operación>`, así que un `INSERT … ON CONFLICT DO UPDATE` sobre una tabla con
    // columnas `Decimal` quedaba invisible (auditoría de la Fase 0, hallazgo 0.7). Se lee el texto SQL, se saca la tabla (`INSERT INTO "X"`, `UPDATE "X"`, `DELETE FROM "X"`) y se la trata como
    // una escritura del modelo `x`; las columnas de dinero son las `Decimal` que el SQL nombra (un `DELETE` o un SQL sin columnas nombradas cuenta como cualquier escritura).
    const crudo = escrituraDeSqlCrudo(n, fuente);
    if (crudo?.noVerificable) {
      const funcion = funcionDeNivelSuperior(n);
      escrituras.push({ archivo, linea: fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1, funcion, modelo: crudo.modelo, operacion: "$executeRaw", columnas: ["(no verificable)"], audita: audita(funcion) });
    } else if (crudo) {
      const columnasDeDinero = decimales.get(crudo.modelo);
      if (columnasDeDinero) {
        const nombradas = [...columnasDeDinero].filter((c) => new RegExp(`"${c}"`).test(crudo.sql));
        const tocadas = crudo.operacion === "DELETE" || nombradas.length === 0 ? ["(cualquier escritura)"] : nombradas;
        const funcion = funcionDeNivelSuperior(n);
        escrituras.push({ archivo, linea: fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1, funcion, modelo: crudo.modelo, operacion: `$executeRaw ${crudo.operacion}`, columnas: tocadas, audita: audita(funcion) });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return escrituras;
}

/**
 * Si el nodo es SQL CRUDO que ESCRIBE (`$executeRaw*` siempre; `$queryRaw*` solo si su texto es un INSERT, UPDATE o DELETE: un `INSERT … RETURNING` es una escritura legítima), la tabla (como
 * delegado), la operación y el texto SQL. Si es un `$executeRaw*` cuyo SQL no se puede leer (una variable, `Prisma.sql`, `Prisma.raw`), `noVerificable`: falla cerrado, como lo anidado. Si no, `null`.
 */
export function escrituraDeSqlCrudo(
  n: ts.Node,
  fuente: ts.SourceFile,
): { modelo: string; operacion: "INSERT" | "UPDATE" | "DELETE"; sql: string; noVerificable?: undefined } | { modelo: string; operacion: "UPDATE"; sql: string; noVerificable: true } | null {
  let sql: string | null = null;
  let esExecute = false;
  if (ts.isTaggedTemplateExpression(n) && ts.isPropertyAccessExpression(n.tag) && /^\$(execute|query)Raw(Unsafe)?$/.test(n.tag.name.text)) {
    esExecute = /^\$executeRaw/.test(n.tag.name.text);
    sql = ts.isNoSubstitutionTemplateLiteral(n.template) ? n.template.text : [n.template.head.text, ...n.template.templateSpans.map((x) => x.literal.text)].join(" ");
  } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^\$(execute|query)Raw(Unsafe)?$/.test(n.expression.name.text)) {
    esExecute = /^\$executeRaw/.test(n.expression.name.text);
    if (n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) sql = n.arguments[0].text;
    else if (esExecute) return { modelo: "(sql no verificable)", operacion: "UPDATE", sql: "", noVerificable: true };
  }
  if (sql === null) return null;
  const m = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?"?(\w+)"?/i.exec(sql);
  if (!m) return null;
  void fuente;
  void esExecute;
  const operacion = m[1].toUpperCase().startsWith("INSERT") ? "INSERT" : m[1].toUpperCase().startsWith("UPDATE") ? "UPDATE" : "DELETE";
  return { modelo: m[2].charAt(0).toLowerCase() + m[2].slice(1), operacion, sql };
}

/** Juzga las escrituras contra las excepciones. `usadas` recibe las excepciones que sí hicieron falta (para la revisión en las dos direcciones). */
export function violaciones(escrituras: Escritura[], usadas: Set<string> = new Set()): Escritura[] {
  return escrituras.filter((e) => {
    if (e.audita) return false;
    if (MODELOS_QUE_SON_SU_PROPIA_HISTORIA[e.modelo]) {
      usadas.add(`modelo|${e.modelo}`);
      return false;
    }
    const sinExceptuadas = e.columnas.filter((c) => {
      const clave = `${e.modelo}.${c}`;
      if (COLUMNAS_QUE_NO_SON_DINERO[clave]) {
        usadas.add(`columna|${clave}`);
        return false;
      }
      return true;
    });
    if (sinExceptuadas.length === 0) return false;
    const clave = `${e.archivo}|${e.funcion}`;
    if (FUNCIONES_EXCEPTUADAS[clave]) {
      usadas.add(`funcion|${clave}`);
      return false;
    }
    return true;
  });
}

/** Un archivo para armar la cadena: sus funciones de primer nivel y lo que importa (nombre local → módulo y nombre original). */
export interface FuenteDeCadena {
  archivo: string;
  unidades: Map<string, Unidad>;
  importes: Map<string, { modulo: string; original: string }>;
}

export function leerFuenteDeCadena(codigo: string, archivo: string): FuenteDeCadena {
  const fuente = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true, archivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const importes = new Map<string, { modulo: string; original: string }>();
  for (const s of fuente.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    const enlaces = s.importClause?.namedBindings;
    if (!enlaces || !ts.isNamedImports(enlaces)) continue;
    for (const e of enlaces.elements) importes.set(e.name.text, { modulo: s.moduleSpecifier.text, original: (e.propertyName ?? e.name).text });
  }
  return { archivo, unidades: extraerUnidades(fuente), importes };
}

const nombreDeModulo = (archivo: string) => (archivo.split("/").pop() ?? archivo).replace(/\.tsx?$/, "");
const moduloApuntaA = (modulo: string, archivo: string) => modulo === nombreDeModulo(archivo) || modulo.endsWith(`/${nombreDeModulo(archivo)}`);

/** Las funciones que llaman a `nombre` de `archivo`: las del mismo archivo y las de quienes la importan de ese módulo. */
function llamadoresDe(archivo: string, nombre: string, fuentes: readonly FuenteDeCadena[]): { archivo: string; nombre: string }[] {
  const llamadores: { archivo: string; nombre: string }[] = [];
  for (const f of fuentes) {
    const nombreLocal = f.archivo === archivo ? nombre : [...f.importes].find(([, i]) => i.original === nombre && moduloApuntaA(i.modulo, archivo))?.[0];
    if (!nombreLocal) continue;
    for (const [otra, u] of f.unidades) if (u.llama.has(nombreLocal) && !(f.archivo === archivo && otra === nombre)) llamadores.push({ archivo: f.archivo, nombre: otra });
  }
  return llamadores;
}

/**
 * `true` si hay al menos un llamador de la función y TODOS sus llamadores auditan (ellos mismos o por un ayudante de su archivo), o a su vez están cubiertos
 * por la cadena hacia arriba (un llamador de la propia persistencia). Una función que nadie llama no está cubierta: no hay quién audite.
 */
export function cubiertaPorLaCadena(archivo: string, nombre: string, fuentes: readonly FuenteDeCadena[], visitadas = new Set<string>()): boolean {
  const clave = `${archivo}|${nombre}`;
  if (visitadas.has(clave)) return false;
  visitadas.add(clave);
  const llamadores = llamadoresDe(archivo, nombre, fuentes);
  if (llamadores.length === 0) return false;
  return llamadores.every((c) => {
    const fuente = fuentes.find((f) => f.archivo === c.archivo)!;
    return auditaEnElArchivo(fuente.unidades, c.nombre) || (c.archivo.startsWith(ZONA_PERSISTENCIA) && cubiertaPorLaCadena(c.archivo, c.nombre, fuentes, visitadas));
  });
}

/** `violaciones` más la cadena: una escritura de dinero en la persistencia que cubren sus llamadores no es una violación. */
export function violacionesConCadena(escrituras: Escritura[], fuentes: readonly FuenteDeCadena[], usadas: Set<string> = new Set()): Escritura[] {
  return violaciones(escrituras, usadas).filter((e) => !(e.archivo.startsWith(ZONA_PERSISTENCIA) && cubiertaPorLaCadena(e.archivo, e.funcion, fuentes)));
}

function archivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

const SCHEMA = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");
const DECIMALES = columnasDecimales(SCHEMA);
const RELACIONES = relacionesDelSchema(SCHEMA);
const formato = (es: Escritura[]) => es.map((e) => `${e.archivo}:${e.linea}  ${e.funcion}  →  ${e.modelo}.${e.operacion} (${e.columnas.join(", ")})`).join("\n");

describe("escrituras auditadas: el detector ve lo que tiene que ver (la regla no puede quedar ciega)", () => {
  const leer = (codigo: string) => leerEscrituras(codigo, "src/server/actions/x.ts", DECIMALES);

  it("una función que escribe una columna Decimal sin auditar es una violación", () => {
    const codigo = "export async function f(ctx: any) { await ctx.db.promoCarta.update({ where: { id: 'a' }, data: { precio: 5 } }); }";
    expect(violaciones(leer(codigo))).toHaveLength(1);
  });

  it("la misma función con registrarCambioAuditado, o llamando a un helper del archivo que lo llama, NO lo es", () => {
    const directa = "export async function f(ctx: any, tx: any) { await tx.promoCarta.update({ data: { precio: 5 } }); await registrarCambioAuditado(tx, {}); }";
    const conHelper = "async function auditar(tx: any) { await registrarCambioAuditado(tx, {}); }\nexport async function f(tx: any) { await tx.promoCarta.update({ data: { precio: 5 } }); await auditar(tx); }";
    const helperDeHelper = "async function a(tx: any) { await registrarCambioAuditado(tx, {}); }\nasync function b(tx: any) { await a(tx); }\nexport async function f(tx: any) { await tx.promoCarta.update({ data: { precio: 5 } }); await b(tx); }";
    expect(violaciones(leer(directa))).toEqual([]);
    expect(violaciones(leer(conHelper))).toEqual([]);
    expect(violaciones(leer(helperDeHelper))).toEqual([]);
  });

  it("la auditoría de OTRA función del archivo no cubre a esta (era el hueco de la regla vieja, que miraba el archivo entero)", () => {
    const codigo = "export async function audita(tx: any) { await registrarCambioAuditado(tx, {}); }\nexport async function escribe(tx: any) { await tx.promoCarta.update({ data: { precio: 5 } }); }";
    const v = violaciones(leer(codigo));
    expect(v).toHaveLength(1);
    expect(v[0].funcion).toBe("escribe");
  });

  it("una escritura dentro de un callback (ctx.transaccion) se atribuye a la función de primer nivel", () => {
    const codigo = "export async function f(ctx: any) { await ctx.transaccion(async (tx: any) => { await tx.promoCarta.update({ data: { precio: 5 } }); await registrarCambioAuditado(tx, {}); }); }";
    expect(leer(codigo)).toEqual([expect.objectContaining({ funcion: "f", audita: true })]);
  });

  it("un data que no se puede leer (spread o variable) supone dinero: falla cerrado", () => {
    expect(violaciones(leer("export async function f(tx: any, d: any) { await tx.promoCarta.update({ data: d }); }"))).toHaveLength(1);
    expect(violaciones(leer("export async function f(tx: any, d: any) { await tx.promoCarta.create({ data: { ...d, titulo: 'x' } }); }"))).toHaveLength(1);
  });

  it("no marca una escritura que no toca dinero ni significado", () => {
    expect(violaciones(leer("export async function f(tx: any) { await tx.promoCarta.update({ where: { id: 'a' }, data: { activa: false } }); }"))).toEqual([]);
    expect(violaciones(leer("export async function f(tx: any) { await tx.proveedor.update({ data: { nombre: 'x' } }); }"))).toEqual([]);
  });

  it("las columnas de significado (unidad.decimales, cualquier escritura de disponibilidadProducto) cuentan", () => {
    expect(violaciones(leer("export async function f(tx: any) { await tx.unidad.update({ data: { decimales: 3 } }); }"))).toHaveLength(1);
    expect(violaciones(leer("export async function f(tx: any) { await tx.unidad.update({ data: { activa: false } }); }"))).toEqual([]);
    expect(violaciones(leer("export async function f(tx: any) { await tx.disponibilidadProducto.createMany({ data: [] }); }"))).toHaveLength(1);
  });

  it("los modelos que son su propia historia y las columnas que no son dinero se exceptúan (con motivo)", () => {
    expect(violaciones(leer("export async function f(tx: any) { await tx.movimientoStock.createMany({ data: [] }); }"))).toEqual([]);
    expect(violaciones(leer("export async function f(tx: any) { await tx.sucursalPublica.update({ data: { posX: 1 } }); }"))).toEqual([]);
    expect(violaciones(leer("export async function f(tx: any) { await tx.stockMinimoProducto.update({ data: { minimo: 1 } }); }"))).toEqual([]);
  });

  it("un delete no cuenta como escritura de este test (lo cubre kardex-solo-agrega y la baja deja su fila)", () => {
    expect(leer("export async function f(tx: any) { await tx.promoCarta.delete({ where: { id: 'a' } }); }")).toEqual([]);
  });
});

describe("escrituras auditadas: el SQL crudo también cuenta (era invisible para la regla)", () => {
  const leer = (codigo: string) => leerEscrituras(codigo, "src/server/persistencia/x.ts", DECIMALES);

  it("un $executeRaw con plantilla que escribe columnas Decimal sin auditar es una violación, con las columnas que nombra", () => {
    const codigo = 'export async function f(db: any) { await db.$executeRaw`INSERT INTO "ProveedorPorProducto" ("id", "precioUnitario") VALUES (${1}, ${2}) ON CONFLICT DO UPDATE SET "precioUnitario" = 1`; }';
    const e = leer(codigo);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ modelo: "proveedorPorProducto", operacion: "$executeRaw INSERT", columnas: ["precioUnitario"] });
    expect(violaciones(e)).toHaveLength(1);
  });

  it("con registrarCambioAuditado en la misma función ya no es violación", () => {
    const codigo = 'export async function f(db: any) { await db.$executeRaw`UPDATE "ProveedorPorProducto" SET "precioUnitario" = ${1}`; await registrarCambioAuditado(db, {}); }';
    expect(violaciones(leer(codigo))).toEqual([]);
  });

  it("$executeRawUnsafe con texto, UPDATE y DELETE; un DELETE o un SQL sin columnas nombradas cuenta como cualquier escritura", () => {
    expect(leer('export async function f(db: any) { await db.$executeRawUnsafe("UPDATE \\"ProveedorPorProducto\\" SET \\"precioUnitario\\" = 1"); }')).toHaveLength(1);
    expect(leer('export async function f(db: any) { await db.$executeRaw`DELETE FROM "ProveedorPorProducto" WHERE "id" = ${1}`; }')[0].columnas).toEqual(["(cualquier escritura)"]);
    expect(leer('export async function f(db: any) { await db.$executeRaw`UPDATE "ProveedorPorProducto" SET "referenciaProveedor" = ${1}`; }')[0].columnas).toEqual(["(cualquier escritura)"]);
  });

  it("no cuenta: una tabla sin columnas Decimal, un SELECT, un set_config ni un $queryRaw", () => {
    expect(leer('export async function f(db: any) { await db.$executeRaw`UPDATE "Proveedor" SET "nombre" = ${1}`; }')).toEqual([]);
    expect(leer("export async function f(db: any) { await db.$executeRaw`SELECT set_config('app.empresa_id', ${1}, true)`; }")).toEqual([]);
    expect(leer('export async function f(db: any) { await db.$queryRaw`SELECT "precioUnitario" FROM "ProveedorPorProducto" WHERE "id" = ${1}`; }')).toEqual([]);
  });

  it("un $queryRaw que ESCRIBE (INSERT … RETURNING) cuenta; un $executeRaw con SQL que no se puede leer falla cerrado", () => {
    const returning = leer('export async function f(db: any) { await db.$queryRaw`INSERT INTO "ProveedorPorProducto" ("id", "precioUnitario") VALUES (${1}, ${2}) RETURNING "id"`; }');
    expect(returning).toHaveLength(1);
    expect(returning[0]).toMatchObject({ modelo: "proveedorPorProducto", columnas: ["precioUnitario"] });
    expect(leer("export async function f(db: any, sql: string) { await db.$executeRawUnsafe(sql); }")[0].columnas).toEqual(["(no verificable)"]);
    expect(leer("export async function f(db: any, Prisma: any) { await db.$executeRaw(Prisma.sql`UPDATE x SET y = 1`); }")[0].columnas).toEqual(["(no verificable)"]);
    expect(violaciones(leer("export async function f(db: any, sql: string) { await db.$executeRawUnsafe(sql); await registrarCambioAuditado(db, {}); }"))).toEqual([]);
  });
});

describe("escrituras auditadas: las escrituras ANIDADAS por relación también cuentan", () => {
  const leer = (codigo: string) => leerEscrituras(codigo, "src/server/persistencia/x.ts", DECIMALES, RELACIONES);

  it("las relaciones del schema se leen (RecetaVersion.ingredientes → recetaIngrediente)", () => {
    expect(RELACIONES.get("recetaVersion")?.get("ingredientes")).toBe("recetaIngrediente");
    expect(RELACIONES.get("recetaVersion")?.get("pasos")).toBe("recetaPaso");
  });

  it("un Decimal escrito a través de una relación (create, createMany, update, upsert, connectOrCreate) se ve como escritura del modelo relacionado", () => {
    const e = leer("export async function f(tx: any) { await tx.recetaVersion.create({ data: { productoId: 'a', ingredientes: { create: [{ insumoProductoId: 'b', cantidad: 1 }] } } }); }");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ modelo: "recetaIngrediente", columnas: ["cantidad"], funcion: "f" });
    expect(violaciones(e)).toHaveLength(1);
    expect(leer("export async function f(tx: any) { await tx.recetaVersion.update({ where: {}, data: { ingredientes: { createMany: { data: [{ cantidad: 2 }] } } } }); }")[0].columnas).toEqual(["cantidad"]);
    expect(leer("export async function f(tx: any) { await tx.recetaVersion.update({ where: {}, data: { ingredientes: { update: { where: {}, data: { mermaPorcentaje: 3 } } } } }); }")[0].columnas).toEqual(["mermaPorcentaje"]);
    expect(leer("export async function f(tx: any) { await tx.recetaVersion.update({ where: {}, data: { ingredientes: { upsert: { where: {}, create: { cantidad: 1 }, update: { cantidad: 2 } } } } }); }")).toHaveLength(2);
  });

  it("con registrarCambioAuditado en la misma función ya no es violación; sin Decimal en lo anidado, no cuenta", () => {
    expect(violaciones(leer("export async function f(tx: any) { await tx.recetaVersion.create({ data: { ingredientes: { create: [{ cantidad: 1 }] } } }); await registrarCambioAuditado(tx, {}); }"))).toEqual([]);
    expect(leer("export async function f(tx: any) { await tx.recetaVersion.create({ data: { pasos: { create: [{ orden: 1, instruccion: 'x' }] } } }); }")).toEqual([]);
  });

  it("lo anidado que no se puede leer (spread) falla cerrado", () => {
    const e = leer("export async function f(tx: any, filas: any) { await tx.recetaVersion.create({ data: { ingredientes: { create: [...filas] } } }); }");
    expect(e[0].columnas).toEqual(["(no verificable)"]);
  });
});

describe("escrituras auditadas: la cadena caso de uso → persistencia", () => {
  const PERSISTENCIA = "src/server/persistencia/pos/escribir-promo.ts";
  const ESCRIBE = "export async function escribirPromo(tx: any) { await tx.promoCarta.update({ data: { precio: 5 } }); }";
  const caso = (cuerpo: string, ruta = "src/server/actions/carta/casos-de-uso/guardar-promo.ts") =>
    leerFuenteDeCadena(`import { escribirPromo } from "@/server/persistencia/pos/escribir-promo";\n${cuerpo}`, ruta);
  const juzgarCadena = (...llamadores: FuenteDeCadena[]) => {
    const fuentes = [leerFuenteDeCadena(ESCRIBE, PERSISTENCIA), ...llamadores];
    return violacionesConCadena(leerEscrituras(ESCRIBE, PERSISTENCIA, DECIMALES), fuentes);
  };

  it("una escritura de dinero en persistencia cuyo único llamador audita está cubierta", () => {
    expect(juzgarCadena(caso("export async function guardar(tx: any) { await escribirPromo(tx); await registrarCambioAuditado(tx, {}); }"))).toEqual([]);
  });

  it("también si el llamador audita por un ayudante de su archivo", () => {
    expect(juzgarCadena(caso("async function auditar(tx: any) { await registrarCambioAuditado(tx, {}); }\nexport async function guardar(tx: any) { await escribirPromo(tx); await auditar(tx); }"))).toEqual([]);
  });

  it("si el llamador NO audita, es una violación (la escritura quedó sin rastro)", () => {
    const v = juzgarCadena(caso("export async function guardar(tx: any) { await escribirPromo(tx); }"));
    expect(v).toHaveLength(1);
    expect(v[0].archivo).toBe(PERSISTENCIA);
  });

  it("con dos llamadores alcanza con que UNO no audite", () => {
    const bueno = caso("export async function guardar(tx: any) { await escribirPromo(tx); await registrarCambioAuditado(tx, {}); }");
    const malo = caso("export async function otra(tx: any) { await escribirPromo(tx); }", "src/server/actions/carta/casos-de-uso/otra.ts");
    expect(juzgarCadena(bueno, malo)).toHaveLength(1);
  });

  it("si nadie la llama, es una violación (no hay quién audite)", () => {
    expect(juzgarCadena()).toHaveLength(1);
  });

  it("un llamador que importa OTRA función del mismo nombre de otro módulo no la cubre", () => {
    const ajeno = leerFuenteDeCadena('import { escribirPromo } from "@/server/persistencia/otro/ajeno";\nexport async function g(tx: any) { await escribirPromo(tx); await registrarCambioAuditado(tx, {}); }', "src/server/actions/x/casos-de-uso/g.ts");
    expect(juzgarCadena(ajeno)).toHaveLength(1);
  });

  it("la cadena sube por la propia persistencia (una función de persistencia que llama a otra)", () => {
    const intermedia = leerFuenteDeCadena('import { escribirPromo } from "./escribir-promo";\nexport async function escribirTodo(tx: any) { await escribirPromo(tx); }', "src/server/persistencia/pos/escribir-todo.ts");
    const casoDeUso = leerFuenteDeCadena('import { escribirTodo } from "@/server/persistencia/pos/escribir-todo";\nexport async function g(tx: any) { await escribirTodo(tx); await registrarCambioAuditado(tx, {}); }', "src/server/actions/x/casos-de-uso/g.ts");
    expect(juzgarCadena(intermedia, casoDeUso)).toEqual([]);
    expect(juzgarCadena(intermedia)).toHaveLength(1);
  });

  it("un modelo que es su propia historia no necesita la cadena", () => {
    const codigo = "export async function agregar(tx: any) { await tx.movimientoStock.createMany({ data: [] }); }";
    expect(violacionesConCadena(leerEscrituras(codigo, PERSISTENCIA, DECIMALES), [leerFuenteDeCadena(codigo, PERSISTENCIA)])).toEqual([]);
  });
});

describe("escrituras auditadas: el código del repositorio", () => {
  const rutas = CARPETAS.flatMap((c) => archivosDe(join(RAIZ, c)));
  const escrituras = rutas.flatMap((absoluta) => {
    const archivo = relative(RAIZ, absoluta).split(sep).join("/");
    return leerEscrituras(readFileSync(absoluta, "utf8"), archivo, DECIMALES, RELACIONES);
  });
  const usadas = new Set<string>();
  const fuentes = CARPETAS_DE_LLAMADORES.flatMap((c) => archivosDe(join(RAIZ, c))).map((absoluta) =>
    leerFuenteDeCadena(readFileSync(absoluta, "utf8"), relative(RAIZ, absoluta).split(sep).join("/")),
  );
  const pendientes = violacionesConCadena(escrituras, fuentes, usadas);

  it("encuentra los archivos y las escrituras de dinero (si dejan de encontrarse, la regla quedó vacía)", () => {
    expect(rutas.length).toBeGreaterThan(300);
    expect(escrituras.length).toBeGreaterThan(20);
  });

  it("toda función que escribe dinero o cambia el significado de una cantidad deja su fila en la auditoría (registrarCambioAuditado)", () => {
    expect(
      pendientes,
      `Estas funciones escriben dinero sin dejar quién ni cuándo. Auditá el cambio en la MISMA transacción con registrarCambioAuditado (core/permisos/auditoria), o declará el motivo en este test:\n${formato(pendientes)}`
    ).toEqual([]);
  });

  it("cada excepción sigue haciendo falta (la lista solo puede achicarse)", () => {
    const sobrantes = [
      ...Object.keys(MODELOS_QUE_SON_SU_PROPIA_HISTORIA).map((m) => `modelo|${m}`),
      ...Object.keys(COLUMNAS_QUE_NO_SON_DINERO).map((c) => `columna|${c}`),
      ...Object.keys(FUNCIONES_EXCEPTUADAS).map((f) => `funcion|${f}`),
    ].filter((clave) => !usadas.has(clave));
    expect(sobrantes, `Excepciones que ya no hacen falta (el código ya audita o ya no escribe eso): sacalas.\n${sobrantes.join("\n")}`).toEqual([]);
  });

  it("toda excepción lleva su motivo", () => {
    for (const [clave, motivo] of [...Object.entries(MODELOS_QUE_SON_SU_PROPIA_HISTORIA), ...Object.entries(COLUMNAS_QUE_NO_SON_DINERO), ...Object.entries(FUNCIONES_EXCEPTUADAS)]) {
      expect(motivo.trim().length, clave).toBeGreaterThan(30);
    }
  });

  it("los archivos con auditoría obligatoria existen y la llaman", () => {
    // Hito 4, bloque 4.1 (paso 7): la auditoría de asignar el cliente de una cuenta pasó de la acción (`pos/cuenta-apertura.ts`) a su caso de uso.
    const OBLIGATORIOS = ["src/server/actions/pos/casos-de-uso/asignar-cliente-a-cuenta.ts", "src/server/actions/catalogo/casos-de-uso/guardar-version-de-receta.ts"];
    for (const nombre of OBLIGATORIOS) {
      const absoluta = join(RAIZ, nombre);
      expect(statSync(absoluta, { throwIfNoEntry: false }), `${nombre} ya no existe: actualizá la lista`).toBeDefined();
      expect(/\bregistrarCambioAuditado\s*\(/.test(readFileSync(absoluta, "utf8")), `${nombre} no llama a registrarCambioAuditado`).toBe(true);
    }
  });
});

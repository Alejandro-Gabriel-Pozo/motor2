import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: lo que mueve plata (o cambia el SIGNIFICADO de una cantidad) y se edita a mano deja su rastro en la auditoría
 * administrativa (`RegistroAuditoria`), en la MISMA función que lo escribe. Reescrita en Pureza 0.7 (hallazgo H4 de la auditoría): antes era una
 * lista fija de 5 modelos y miraba el ARCHIVO entero (una función auditada dejaba pasar a las demás del archivo); ahora está INVERTIDA y es por FUNCIÓN.
 *
 * Qué exige. En `src/server/actions/**` y `src/core/**` (la persistencia, `server/persistencia/`, solo escribe lo que le pide un caso de uso, que es
 * quien audita): toda función que ESCRIBA (`create`, `createMany`, `update`, `updateMany`, `upsert`) una columna de dinero de un modelo, tiene que llamar
 * a `registrarCambioAuditado` (o a una función del mismo archivo que lo llame). «Columna de dinero» es TODA columna `Decimal` de `prisma/schema.prisma`
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
const CARPETAS = ["src/server/actions", "src/core"];
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
  "src/server/actions/catalogo/productos.ts|darDeAltaProducto":
    "Alta de un producto: no hay valor anterior que se pierda, y se crea SIN transacción a propósito (reintenta el código ante `P2002`, ver su docstring), así que la auditoría no puede ir atómica con la creación. Cada cambio posterior del precio lo audita `actualizarProducto`.",
  "src/server/actions/catalogo/productos.ts|darDeAltaProductoRapido":
    "Alta rápida de una MP con factor 1 (sin precio): misma razón que `darDeAltaProducto` (creación sin transacción por el reintento del código).",
  "src/server/actions/catalogo/unidades.ts|crearUnidad":
    "Alta de una unidad nueva: todavía nada la usa, así que no hay un valor anterior ni cantidades cuyo significado cambie. Cada cambio posterior de sus decimales lo audita `actualizarDecimalesUnidad`.",
  "src/core/features/empresa/sembrar-empresa.ts|sembrarEmpresa":
    "Alta de una empresa por la plataforma: siembra el catálogo base (unidades, roles, sucursal) de una empresa recién creada, DENTRO de la misma transacción que deja el rastro «alta-de-empresa» en la auditoría de plataforma (`plataforma/src/servidor/empresas.ts`).",
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

/** Las escrituras de dinero (o de significado) de un archivo, con su función y si esa función audita. */
export function leerEscrituras(codigo: string, archivo: string, decimales: ReadonlyMap<string, ReadonlySet<string>>): Escritura[] {
  const fuente = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true, archivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  // 1) Las funciones de primer nivel, con lo que llaman (para resolver «llama a un helper del archivo que audita»).
  const unidades = new Map<string, { nodo: ts.Node; llama: Set<string>; auditaDirecto: boolean }>();
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
  const audita = (nombre: string, visitadas = new Set<string>()): boolean => {
    if (visitadas.has(nombre)) return false;
    visitadas.add(nombre);
    const u = unidades.get(nombre);
    if (!u) return false;
    return u.auditaDirecto || [...u.llama].some((otra) => unidades.has(otra) && audita(otra, visitadas));
  };

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
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return escrituras;
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

function archivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

const DECIMALES = columnasDecimales(readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8"));
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

describe("escrituras auditadas: el código del repositorio", () => {
  const rutas = CARPETAS.flatMap((c) => archivosDe(join(RAIZ, c)));
  const escrituras = rutas.flatMap((absoluta) => {
    const archivo = relative(RAIZ, absoluta).split(sep).join("/");
    return leerEscrituras(readFileSync(absoluta, "utf8"), archivo, DECIMALES);
  });
  const usadas = new Set<string>();
  const pendientes = violaciones(escrituras, usadas);

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
    const OBLIGATORIOS = ["src/server/actions/pos/cuenta-apertura.ts", "src/server/actions/catalogo/casos-de-uso/guardar-version-de-receta.ts"];
    for (const nombre of OBLIGATORIOS) {
      const absoluta = join(RAIZ, nombre);
      expect(statSync(absoluta, { throwIfNoEntry: false }), `${nombre} ya no existe: actualizá la lista`).toBeDefined();
      expect(/\bregistrarCambioAuditado\s*\(/.test(readFileSync(absoluta, "utf8")), `${nombre} no llama a registrarCambioAuditado`).toBe(true);
    }
  });
});

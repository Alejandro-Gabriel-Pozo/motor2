import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (Fase 0 del plan de pureza, PR 0.2): el Kardex SOLO AGREGA.
 *
 * `MovimientoStock` (el Kardex), `RegistroAuditoria` y `AuditoriaPlataforma` son historia: una corrección es una fila nueva (una reversión,
 * un ajuste), nunca un `update`/`delete` de una fila escrita. Hoy lo cumple todo el código (0 violaciones), pero por convención: nada lo
 * impedía, y las notas de crédito, las devoluciones y las anulaciones que vienen son justo el lugar donde alguien tendría la tentación de
 * «corregir» una línea en el lugar. Este test lo vuelve una regla que falla.
 *
 * Qué prohíbe en `src/` y `plataforma/src/`:
 *  1. Cualquier `update`, `updateMany`, `upsert`, `delete` o `deleteMany` sobre `movimientoStock`, `registroAuditoria` o `auditoriaPlataforma`
 *     (por `x.modelo.op(...)` o por un delegado suelto `modelo.op(...)`).
 *  2. SQL crudo (`$executeRaw*`, `$queryRaw*`) con `UPDATE`, `DELETE FROM` o `TRUNCATE` sobre esas tablas.
 *  3. Sobre `Operacion` (la cabecera de cada operación): solo los usos de la lista cerrada de abajo, cada uno con su motivo y con las
 *     columnas EXACTAS que puede tocar. Una `Operacion` nunca se borra, ni se hace `upsert`/`updateMany`, ni se actualiza fuera de la lista.
 *
 * Lo que NO cubre (a propósito, y por eso hay otras defensas): un acceso por un alias que no se llame como el modelo, el `scripts/` de
 * operación (los benchmarks borran filas `bench_*` de su propia base), y la base misma. El candado en la base (REVOKE + trigger) es el
 * paso de la Fase 5 del plan, con autorización expresa.
 *
 * Cómo se controla: AST de TypeScript (no texto plano), fuera de los comentarios. La lista de excepciones se revisa en las dos direcciones:
 * un uso fuera de la lista falla, y una excepción que ya no hace falta también (así la lista solo puede achicarse).
 */
const RAIZ = join(__dirname, "../..");
const CARPETAS = ["src", "plataforma/src"];

const MODELOS_SOLO_AGREGAN = ["movimientoStock", "registroAuditoria", "auditoriaPlataforma"];
const OPERACIONES_QUE_MODIFICAN = new Set(["update", "updateMany", "upsert", "delete", "deleteMany"]);
const SQL_CRUDO = new Set(["$executeRaw", "$executeRawUnsafe", "$queryRaw", "$queryRawUnsafe"]);
const TABLAS_SQL = /\b(update|delete\s+from|truncate(\s+table)?)\s+(only\s+)?(public\.)?\\?"?(MovimientoStock|RegistroAuditoria|AuditoriaPlataforma)\b/i;

interface UsoSobreOperacion {
  /** Ruta relativa a la raíz del repo, con `/`. */
  archivo: string;
  operaciones: string[];
  /** Columnas que ese `update` puede escribir en `data`. */
  columnas: string[];
  motivo: string;
}

/** Los ÚNICOS lugares donde se actualiza una `Operacion`. Agregar uno es una decisión de arquitectura: va con su motivo y su ADR/plan. */
const USOS_PERMITIDOS_DE_OPERACION: UsoSobreOperacion[] = [
  {
    archivo: "src/core/movimientos/idempotencia.ts",
    operaciones: ["update"],
    columnas: ["resultadoMensaje"],
    motivo: "I3: guarda el mensaje de resultado ya formateado en la operación que lleva la clave, para que un reenvío exacto lo devuelva tal cual.",
  },
  {
    archivo: "src/core/movimientos/registrar-venta.ts",
    operaciones: ["update"],
    columnas: ["resultadoMensaje"],
    motivo: "I3 de la venta: mismo `resultadoMensaje` que arriba, escrito en línea hasta que la venta use `registrarResultadoIdempotente`.",
  },
  {
    archivo: "src/server/persistencia/compras/escribir-anulacion-de-compra.ts",
    operaciones: ["update"],
    columnas: ["anuladaEn", "anuladaPorId"],
    motivo: "Anular una compra: marca la cabecera como anulada (`anuladaEn` = «no existió y se revirtió»); las líneas del Kardex se REVIERTEN con filas nuevas.",
  },
  {
    archivo: "src/server/persistencia/movimientos/escribir-anulacion-de-venta.ts",
    operaciones: ["update"],
    columnas: ["anuladaEn", "anuladaPorId"],
    motivo: "Anular una venta: marca la cabecera como anulada; las líneas del Kardex se REVIERTEN con filas nuevas.",
  },
  {
    archivo: "src/server/persistencia/compras/escribir-correccion-de-compra.ts",
    operaciones: ["update"],
    columnas: ["proveedorId", "nroFactura", "detalleLibre"],
    motivo:
      "DEUDA CONOCIDA (hallazgo H11 de la auditoría): corrige la cabecera de una compra EN EL LUGAR (auditada por campo). Los documentos nuevos (factura de proveedor, nota de crédito) se corrigen solo con versiones nuevas; esta excepción se elimina cuando las compras viejas pasen a ese modelo.",
  },
];

interface Violacion {
  archivo: string;
  linea: number;
  detalle: string;
}

interface UsoDeOperacion {
  archivo: string;
  operacion: string;
  linea: number;
  /** Claves literales del objeto `data`; `null` si no se pueden leer (spread, variable, función). */
  columnas: string[] | null;
}

/** Resultado de leer UN archivo: las violaciones inmediatas y los usos de `Operacion` (que se juzgan contra la lista de excepciones). */
interface LecturaDeArchivo {
  violaciones: Violacion[];
  usosDeOperacion: UsoDeOperacion[];
}

function clavesDeData(llamada: ts.CallExpression): string[] | null {
  const argumento = llamada.arguments[0];
  if (!argumento || !ts.isObjectLiteralExpression(argumento)) return null;
  const data = argumento.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "data");
  if (!data || !ts.isObjectLiteralExpression(data.initializer)) return null;
  const claves: string[] = [];
  for (const p of data.initializer.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) claves.push(p.name.text);
    else if (ts.isShorthandPropertyAssignment(p)) claves.push(p.name.text);
    else return null;
  }
  return claves.sort();
}

function leerArchivo(codigo: string, archivo: string): LecturaDeArchivo {
  const fuente = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true, archivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violaciones: Violacion[] = [];
  const usosDeOperacion: UsoDeOperacion[] = [];
  const linea = (nodo: ts.Node) => fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1;

  const revisarSql = (nodo: ts.Node, nombre: string) => {
    if (SQL_CRUDO.has(nombre) && TABLAS_SQL.test(nodo.getText(fuente))) {
      violaciones.push({ archivo, linea: linea(nodo), detalle: `SQL crudo (${nombre}) que modifica una tabla que solo agrega` });
    }
  };

  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression)) {
      const operacion = nodo.expression.name.text;
      const dueño = nodo.expression.expression;
      const modelo = ts.isPropertyAccessExpression(dueño) ? dueño.name.text : ts.isIdentifier(dueño) ? dueño.text : null;
      if (modelo && OPERACIONES_QUE_MODIFICAN.has(operacion)) {
        if (MODELOS_SOLO_AGREGAN.includes(modelo)) {
          violaciones.push({ archivo, linea: linea(nodo), detalle: `${modelo}.${operacion}: esa tabla solo agrega filas (una corrección es una fila nueva)` });
        } else if (modelo === "operacion") {
          usosDeOperacion.push({ archivo, operacion, linea: linea(nodo), columnas: operacion === "update" ? clavesDeData(nodo) : null });
        }
      }
      revisarSql(nodo, operacion);
    }
    if (ts.isTaggedTemplateExpression(nodo) && ts.isPropertyAccessExpression(nodo.tag)) revisarSql(nodo, nodo.tag.name.text);
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return { violaciones, usosDeOperacion };
}

/** Juzga los usos de `Operacion` contra la lista de excepciones y devuelve las violaciones. */
function juzgarUsosDeOperacion(usos: UsoDeOperacion[], permitidos: UsoSobreOperacion[]): Violacion[] {
  const violaciones: Violacion[] = [];
  for (const uso of usos) {
    const regla = permitidos.find((p) => p.archivo === uso.archivo);
    if (!regla) {
      violaciones.push({ archivo: uso.archivo, linea: uso.linea, detalle: `operacion.${uso.operacion}: fuera de la lista cerrada de usos permitidos de Operacion` });
    } else if (!regla.operaciones.includes(uso.operacion)) {
      violaciones.push({ archivo: uso.archivo, linea: uso.linea, detalle: `operacion.${uso.operacion}: este archivo solo puede hacer ${regla.operaciones.join(", ")}` });
    } else if (uso.columnas === null) {
      violaciones.push({ archivo: uso.archivo, linea: uso.linea, detalle: "operacion.update con un `data` que no es un objeto literal: no se puede verificar qué columnas escribe" });
    } else {
      const sobrantes = uso.columnas.filter((c) => !regla.columnas.includes(c));
      if (sobrantes.length > 0) {
        violaciones.push({ archivo: uso.archivo, linea: uso.linea, detalle: `operacion.update escribe columnas no permitidas en este archivo: ${sobrantes.join(", ")}` });
      }
    }
  }
  return violaciones;
}

function archivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "node_modules" || nombre === ".next" ? [] : archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

const formato = (vs: Violacion[]) => vs.map((v) => `${v.archivo}:${v.linea}  ${v.detalle}`).join("\n");

describe("el Kardex solo agrega: el analizador ve las violaciones (la regla no puede quedar ciega)", () => {
  it("detecta update/delete/upsert sobre el Kardex y la auditoría, por modelo calificado o delegado suelto", () => {
    for (const modelo of MODELOS_SOLO_AGREGAN) {
      for (const op of ["update", "updateMany", "upsert", "delete", "deleteMany"]) {
        expect(leerArchivo(`export const f = (tx: any) => tx.${modelo}.${op}({});`, "x.ts").violaciones, `${modelo}.${op}`).toHaveLength(1);
        expect(leerArchivo(`export const f = (${modelo}: any) => ${modelo}.${op}({});`, "x.ts").violaciones, `suelto ${modelo}.${op}`).toHaveLength(1);
      }
    }
  });

  it("NO marca lo que agrega o lee", () => {
    const codigo = "export const f = (tx: any) => [tx.movimientoStock.create({}), tx.movimientoStock.createMany({}), tx.movimientoStock.findMany({}), tx.registroAuditoria.count({})];";
    expect(leerArchivo(codigo, "x.ts").violaciones).toEqual([]);
  });

  it("detecta SQL crudo que modifica esas tablas (llamada y plantilla etiquetada), no el que solo lee", () => {
    expect(leerArchivo('export const f = (db: any) => db.$executeRaw`update "MovimientoStock" set precio = 0`;', "x.ts").violaciones).toHaveLength(1);
    expect(leerArchivo('export const f = (db: any) => db.$executeRawUnsafe("DELETE FROM \\"RegistroAuditoria\\"");', "x.ts").violaciones).toHaveLength(1);
    expect(leerArchivo('export const f = (db: any) => db.$executeRaw`truncate table "AuditoriaPlataforma"`;', "x.ts").violaciones).toHaveLength(1);
    expect(leerArchivo('export const f = (db: any) => db.$queryRaw`select * from "MovimientoStock"`;', "x.ts").violaciones).toEqual([]);
  });

  it("no cuenta un texto o un comentario que menciona tx.movimientoStock.update(", () => {
    expect(leerArchivo('// tx.movimientoStock.update({})\nexport const a = "tx.movimientoStock.delete({})";', "x.ts").violaciones).toEqual([]);
  });

  it("Operacion: un update fuera de la lista, un delete, un upsert o un data no literal fallan; el permitido con sus columnas no", () => {
    const permitidos: UsoSobreOperacion[] = [{ archivo: "ok.ts", operaciones: ["update"], columnas: ["anuladaEn"], motivo: "test" }];
    const juzgar = (codigo: string, archivo: string) => juzgarUsosDeOperacion(leerArchivo(codigo, archivo).usosDeOperacion, permitidos);
    expect(juzgar("export const f = (tx: any) => tx.operacion.update({ where: {}, data: { anuladaEn: 1 } });", "ok.ts")).toEqual([]);
    expect(juzgar("export const f = (tx: any) => tx.operacion.update({ where: {}, data: { anuladaEn: 1 } });", "otro.ts")).toHaveLength(1);
    expect(juzgar("export const f = (tx: any) => tx.operacion.update({ where: {}, data: { anuladaEn: 1, fecha: 2 } });", "ok.ts")).toHaveLength(1);
    expect(juzgar("export const f = (tx: any, d: any) => tx.operacion.update({ where: {}, data: d });", "ok.ts")).toHaveLength(1);
    expect(juzgar("export const f = (tx: any) => tx.operacion.delete({ where: {} });", "ok.ts")).toHaveLength(1);
    expect(juzgar("export const f = (tx: any) => tx.operacion.upsert({});", "ok.ts")).toHaveLength(1);
    expect(juzgar("export const f = (tx: any) => tx.operacion.create({ data: {} });", "otro.ts")).toEqual([]);
  });
});

describe("el Kardex solo agrega: el código del repositorio", () => {
  const lecturas = CARPETAS.flatMap((c) => archivosDe(join(RAIZ, c))).map((absoluta) => {
    const archivo = relative(RAIZ, absoluta).split(sep).join("/");
    return { archivo, ...leerArchivo(readFileSync(absoluta, "utf8"), archivo) };
  });
  const usos = lecturas.flatMap((l) => l.usosDeOperacion);

  it("encuentra el código de src/ y plataforma/src/", () => {
    expect(lecturas.length).toBeGreaterThan(500);
  });

  it("ningún archivo modifica ni borra el Kardex ni la auditoría (ni con SQL crudo)", () => {
    const violaciones = lecturas.flatMap((l) => l.violaciones);
    expect(violaciones, `Estas tablas solo agregan filas; una corrección es una fila nueva:\n${formato(violaciones)}`).toEqual([]);
  });

  it("Operacion solo se actualiza en la lista cerrada de usos, con sus columnas exactas", () => {
    const violaciones = juzgarUsosDeOperacion(usos, USOS_PERMITIDOS_DE_OPERACION);
    expect(violaciones, `Usos de Operacion no permitidos:\n${formato(violaciones)}`).toEqual([]);
  });

  it("cada excepción de la lista sigue haciendo falta (la lista solo puede achicarse)", () => {
    const sobrantes = USOS_PERMITIDOS_DE_OPERACION.filter((p) => !usos.some((u) => u.archivo === p.archivo)).map((p) => p.archivo);
    expect(sobrantes, `Excepciones que ya no se usan: sacalas de la lista.\n${sobrantes.join("\n")}`).toEqual([]);
  });

  it("cada excepción lleva su motivo", () => {
    for (const p of USOS_PERMITIDOS_DE_OPERACION) expect(p.motivo.trim().length, p.archivo).toBeGreaterThan(20);
  });
});

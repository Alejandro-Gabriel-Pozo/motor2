import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (Fase 0 del plan de pureza, PR 0.2): el Kardex SOLO AGREGA.
 *
 * `MovimientoStock` (el Kardex), `RegistroAuditoria`, `AuditoriaPlataforma` y `Venta` (la cabecera de venta, M2) son historia: una corrección es una fila nueva (una reversión,
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
 *  4. Una escritura ANIDADA que modifica el Kardex, la auditoría o una `Operacion` desde OTRO modelo (`producto.update({ data: { movimientos: { deleteMany } } })`,
 *     `conteoFisico.update({ data: { movimientos: { disconnect } } })`, `proveedor.update({ data: { operaciones: { updateMany } } })`): una relación hacia esas
 *     tablas con `connect`, `connectOrCreate`, `set`, `disconnect`, `update`, `updateMany`, `upsert`, `delete` o `deleteMany`. `create`/`createMany` anidados
 *     siguen a cargo de `ESCRITORES_DEL_KARDEX`. Las relaciones salen del schema y un test las mantiene sincronizadas con la lista.
 *
 * Además (Hito 5, pieza 5.4, A6) los ESCRITORES del Kardex son una lista cerrada (`ESCRITORES_DEL_KARDEX`, más abajo): `movimientoStock.create*` solo aparece en las tres
 * funciones declaradas, que son las que la Fase 5 tendrá que autorizar en la base.
 *
 * Lo que NO cubre (a propósito, y por eso hay otras defensas): un acceso por un alias que no se llame como el modelo, una relación anidada cuyo valor no es un
 * objeto literal (una variable o un spread: no se puede leer), las relaciones de uno solo (`operacion` en `CuentaItem`), el `scripts/` de
 * operación (los benchmarks borran filas `bench_*` de su propia base), y la base misma. El candado en la base (REVOKE + trigger) es el
 * paso de la Fase 5 del plan, con autorización expresa.
 *
 * Cómo se controla: AST de TypeScript (no texto plano), fuera de los comentarios. La lista de excepciones se revisa en las dos direcciones:
 * un uso fuera de la lista falla, y una excepción que ya no hace falta también (así la lista solo puede achicarse).
 */
const RAIZ = join(__dirname, "../..");
const CARPETAS = ["src", "plataforma/src"];

// Paquete 3 (M3b): el renglón, la parte y los tributos de la factura de proveedor también solo se agregan (la app no tiene UPDATE ni DELETE en la base). La CABECERA (`facturaProveedor`) no entra todavía: su UPDATE es por
// columna (estado, anulación y datos que identifican la factura) y la lista cerrada de sus escritores llega con el primer caso de uso que la escriba (Etapa C).
// La PARTE (`facturaProveedorSucursal`) sí está acá aunque la base le deje UPDATE POR COLUMNA de la recepción (estado, fecha y persona; solo PENDIENTE a RECIBIDA, con un disparador): hoy ningún `src/` la escribe, y el caso de uso de
// confirmar la recepción (Etapa C) tendrá que declarar ese UPDATE, con su lista cerrada de columnas, antes de entrar.
const MODELOS_SOLO_AGREGAN = ["movimientoStock", "registroAuditoria", "auditoriaPlataforma", "venta", "facturaProveedorRenglon", "facturaProveedorSucursal", "facturaProveedorTributo"];
const OPERACIONES_QUE_MODIFICAN = new Set(["update", "updateMany", "upsert", "delete", "deleteMany"]);
const SQL_CRUDO = new Set(["$executeRaw", "$executeRawUnsafe", "$queryRaw", "$queryRawUnsafe"]);
const TABLAS_SQL = /\b(update|delete\s+from|truncate(\s+table)?)\s+(only\s+)?(public\.)?\\?"?(MovimientoStock|RegistroAuditoria|AuditoriaPlataforma|Venta|FacturaProveedorRenglon|FacturaProveedorSucursal|FacturaProveedorTributo)\b/i;

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
    archivo: "src/server/persistencia/movimientos/idempotencia.ts",
    operaciones: ["update"],
    columnas: ["resultadoMensaje"],
    motivo: "I3: guarda el mensaje de resultado ya formateado en la operación que lleva la clave, para que un reenvío exacto lo devuelva tal cual.",
  },
  {
    archivo: "src/server/persistencia/movimientos/escribir-contra-asiento.ts",
    operaciones: ["update"],
    columnas: ["anuladaEn", "anuladaPorId"],
    motivo:
      "Anular una compra o una venta (Hito 5, 5.4-A5: un solo escritor para las dos): marca la cabecera como anulada (`anuladaEn` = «no existió y se revirtió»); las líneas del Kardex se REVIERTEN con filas nuevas.",
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

/**
 * Los ÚNICOS lugares donde se ESCRIBE una línea del Kardex (`movimientoStock.create`, `createMany` o `createManyAndReturn`): archivo → la función que la contiene.
 * Hito 5, pieza 5.4, A6 (O.13 de `docs/pureza-integracion.md`): la regla de arriba impide MODIFICAR el Kardex; esta impide que aparezca un escritor nuevo sin
 * que alguien lo decida. Antes de A4 y A5 eran cinco (la salida, la entrada y las dos anulaciones, más el motor genérico); la Fase 5 (el candado en la
 * base: REVOKE + trigger) necesita saber exactamente quién inserta, y con tres funciones la lista de permisos es corta y revisable.
 * Agregar una entrada es una decisión de arquitectura: va con su motivo; una que ya no hace falta se saca (se revisa en las dos direcciones).
 */
const ESCRITORES_DEL_KARDEX: Record<string, { funcion: string; motivo: string }> = {
  "src/server/persistencia/movimientos/escribir-movimiento-de-stock.ts": {
    funcion: "escribirLineasDeMovimientoStock",
    motivo:
      "Las líneas de las operaciones del motor genérico (compras, mermas, consumos, producción, reclasificación, conteos) y de la venta (`registrar-venta-en-tx.ts`): el caso de uso arma las filas y las escribe todas juntas con un `createMany`.",
  },
  "src/server/persistencia/movimientos/escribir-contra-asiento.ts": {
    funcion: "escribirContraAsiento",
    motivo: "Las líneas inversas de la anulación de una compra o una venta (A5): una `Operacion` AJUSTE nueva con sus filas; la original solo se marca como anulada.",
  },
  "src/server/persistencia/traspasos/escribir-movimiento-de-traspaso.ts": {
    funcion: "escribirMovimientoDeTraspaso",
    motivo: "La única línea de Kardex de cada paso de un traspaso: la salida de Origen, la entrada de Destino y el reingreso (A4).",
  },
};

interface EscrituraDeKardex {
  archivo: string;
  linea: number;
  /** El nombre de la función que contiene la escritura, o `<…>` si no es una función con nombre (nivel del módulo, SQL crudo, escritura anidada). */
  funcion: string;
}

const ESCRITURAS_DE_LINEA = new Set(["create", "createMany", "createManyAndReturn"]);

/** La función con nombre que contiene al nodo (la `function`, el método o la variable a la que se asignó la flecha; una flecha de callback sube a la de afuera). */
function funcionQueContiene(nodo: ts.Node): string {
  for (let p: ts.Node | undefined = nodo.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
      const dueño = p.parent;
      if (ts.isVariableDeclaration(dueño) && ts.isIdentifier(dueño.name)) return dueño.name.text;
      if (ts.isPropertyAssignment(dueño) && (ts.isIdentifier(dueño.name) || ts.isStringLiteral(dueño.name))) return dueño.name.text;
    }
  }
  return "<nivel del módulo>";
}

/**
 * Cada escritura de una línea del Kardex que hay en un archivo, por el AST (los comentarios y los textos no cuentan): `x.movimientoStock.create*(…)` o un delegado
 * suelto `movimientoStock.create*(…)`; una escritura ANIDADA (`movimientos: { create: … }` o `createMany` dentro de un `data`); y SQL crudo que inserta en la tabla.
 */
function escrituraDeKardexEn(codigo: string, archivo: string): EscrituraDeKardex[] {
  const fuente = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true, archivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const encontradas: EscrituraDeKardex[] = [];
  const linea = (nodo: ts.Node) => fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression) && ESCRITURAS_DE_LINEA.has(nodo.expression.name.text)) {
      const dueño = nodo.expression.expression;
      const modelo = ts.isPropertyAccessExpression(dueño) ? dueño.name.text : ts.isIdentifier(dueño) ? dueño.text : null;
      if (modelo === "movimientoStock") encontradas.push({ archivo, linea: linea(nodo), funcion: funcionQueContiene(nodo) });
    }
    if (ts.isPropertyAssignment(nodo) && ts.isIdentifier(nodo.name) && nodo.name.text === "movimientos" && ts.isObjectLiteralExpression(nodo.initializer)) {
      const anida = nodo.initializer.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && ESCRITURAS_DE_LINEA.has(p.name.text));
      if (anida) encontradas.push({ archivo, linea: linea(nodo), funcion: "<escritura anidada en una Operacion>" });
    }
    const esSql =
      (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression) && SQL_CRUDO.has(nodo.expression.name.text)) ||
      (ts.isTaggedTemplateExpression(nodo) && ts.isPropertyAccessExpression(nodo.tag) && SQL_CRUDO.has(nodo.tag.name.text));
    if (esSql && /\binsert\s+into\s+(public\.)?\\?"?MovimientoStock\b/i.test(nodo.getText(fuente))) {
      encontradas.push({ archivo, linea: linea(nodo), funcion: "<SQL crudo>" });
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return encontradas;
}

/** Juzga las escrituras encontradas contra la lista: una de más, una en otra función o una entrada de la lista que ya no escribe nada. */
function juzgarEscritoresDelKardex(encontradas: EscrituraDeKardex[], lista: Record<string, { funcion: string; motivo: string }>): string[] {
  const problemas: string[] = [];
  for (const e of encontradas) {
    const permitido = lista[e.archivo];
    if (!permitido) problemas.push(`${e.archivo}:${e.linea}  escribe una línea del Kardex (en ${e.funcion}) y no está en ESCRITORES_DEL_KARDEX`);
    else if (permitido.funcion !== e.funcion) problemas.push(`${e.archivo}:${e.linea}  la escritura está en ${e.funcion} y la lista dice ${permitido.funcion}`);
  }
  for (const [archivo, permitido] of Object.entries(lista)) {
    if (!encontradas.some((e) => e.archivo === archivo && e.funcion === permitido.funcion)) problemas.push(`${archivo}  la lista dice ${permitido.funcion} y ya no escribe una línea del Kardex`);
  }
  return problemas;
}

/**
 * Las relaciones (campos `X[]` del schema) que apuntan a `MovimientoStock`, `RegistroAuditoria`, `AuditoriaPlataforma` o `Operacion` desde otro modelo: por ahí se
 * puede modificar el Kardex o una cabecera sin nombrar el modelo (`producto.update({ data: { movimientos: { deleteMany: {} } } })`). Un test las compara con
 * `prisma/schema.prisma`: una relación nueva obliga a declararla acá.
 */
const RELACIONES_HACIA_EL_HISTORIAL = [
  "movimientos",
  "devoluciones",
  "consumosQueLoSustituyen",
  "movimientoStockRel",
  "registrosAuditoria",
  "registroAuditoriaRel",
  "operaciones",
  "operacionesAnuladas",
  "operacionRel",
  "operacionesTransferenciaDestino",
  "ventas",
  "ventaRel",
];
/** Las claves de Prisma que, dentro de una relación, modifican o desvinculan filas (no aparecen en `where`/`include`/`select`). `create`/`createMany` no: son de `ESCRITORES_DEL_KARDEX`. */
const CLAVES_QUE_MODIFICAN_UNA_RELACION = new Set(["connect", "connectOrCreate", "set", "disconnect", "update", "updateMany", "upsert", "delete", "deleteMany"]);

/** Cada `relación: { <clave que modifica>: … }` de un archivo, por el AST (los comentarios y los textos no cuentan). */
function escriturasAnidadasEn(codigo: string, archivo: string): Violacion[] {
  const fuente = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true, archivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violaciones: Violacion[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (ts.isPropertyAssignment(nodo) && (ts.isIdentifier(nodo.name) || ts.isStringLiteral(nodo.name)) && RELACIONES_HACIA_EL_HISTORIAL.includes(nodo.name.text)) {
      if (ts.isObjectLiteralExpression(nodo.initializer)) {
        for (const p of nodo.initializer.properties) {
          if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && CLAVES_QUE_MODIFICAN_UNA_RELACION.has(p.name.text)) {
            const linea = fuente.getLineAndCharacterOfPosition(p.getStart(fuente)).line + 1;
            violaciones.push({ archivo, linea, detalle: `${nodo.name.text}: { ${p.name.text} }: una escritura anidada que modifica una tabla que solo agrega (una corrección es una fila nueva)` });
          }
        }
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
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

describe("el Kardex solo agrega: las escrituras anidadas desde otro modelo", () => {
  const ver = (codigo: string) => escriturasAnidadasEn(codigo, "x.ts");

  it("marca deleteMany, disconnect, connect, updateMany y el resto de las claves que modifican, en cada relación", () => {
    expect(ver("export const f = (tx: any) => tx.producto.update({ where: {}, data: { movimientos: { deleteMany: {} } } });")).toHaveLength(1);
    expect(ver("export const f = (tx: any) => tx.conteoFisico.update({ where: {}, data: { movimientos: { disconnect: [{ id: 'a' }] } } });")).toHaveLength(1);
    expect(ver("export const f = (tx: any) => tx.conteoFisico.update({ where: {}, data: { movimientos: { connect: [{ id: 'a' }] } } });")).toHaveLength(1);
    expect(ver("export const f = (tx: any) => tx.proveedor.update({ where: {}, data: { operaciones: { updateMany: { where: {}, data: {} } } } });")).toHaveLength(1);
    expect(ver("export const f = (tx: any) => tx.empresa.update({ where: {}, data: { 'registroAuditoriaRel': { set: [] } } });")).toHaveLength(1);
    for (const relacion of RELACIONES_HACIA_EL_HISTORIAL) {
      for (const clave of CLAVES_QUE_MODIFICAN_UNA_RELACION) {
        expect(ver(`export const f = (tx: any) => tx.x.update({ data: { ${relacion}: { ${clave}: {} } } });`), `${relacion}.${clave}`).toHaveLength(1);
      }
    }
  });

  it("NO marca lo que lee (include, where, select) ni lo que agrega (create, createMany)", () => {
    expect(ver("export const f = (tx: any) => tx.producto.findMany({ include: { movimientos: { where: { cantidad: 1 }, orderBy: { fecha: 'asc' } } } });")).toEqual([]);
    expect(ver("export const f = (tx: any) => tx.producto.findMany({ where: { movimientos: { some: {} } } });")).toEqual([]);
    expect(ver("export const f = (tx: any) => tx.producto.findMany({ select: { operaciones: { select: { id: true } } } });")).toEqual([]);
    expect(ver("export const f = (tx: any) => tx.operacion.create({ data: { movimientos: { createMany: { data: [] } } } });")).toEqual([]);
    expect(ver("export const f = (tx: any) => tx.operacion.create({ data: { movimientos: { create: {} } } });")).toEqual([]);
    expect(ver("export const f = (tx: any) => tx.producto.update({ data: { nombre: 'a', activo: { set: true } } });")).toEqual([]);
  });

  it("no cuenta un comentario o un texto que menciona la escritura", () => {
    expect(ver("// data: { movimientos: { deleteMany: {} } }\nexport const a = 'movimientos: { deleteMany: {} }';")).toEqual([]);
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

  it("ningún archivo modifica ni desvincula el Kardex, la auditoría o una Operacion por una relación anidada desde otro modelo", () => {
    const violaciones = CARPETAS.flatMap((c) => archivosDe(join(RAIZ, c))).flatMap((absoluta) =>
      escriturasAnidadasEn(readFileSync(absoluta, "utf8"), relative(RAIZ, absoluta).split(sep).join("/"))
    );
    expect(violaciones, `Estas tablas solo agregan filas; una corrección es una fila nueva:\n${formato(violaciones)}`).toEqual([]);
  });

  it("la lista de relaciones hacia el historial coincide con el schema (una relación nueva obliga a declararla)", () => {
    const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");
    const delSchema = [...schema.matchAll(/^\s+(\w+)\s+(?:MovimientoStock|RegistroAuditoria|AuditoriaPlataforma|Operacion|Venta)\[\]/gm)].map((m) => m[1]);
    expect(delSchema.length, "el schema debería tener relaciones hacia esas tablas (si no, la lectura está ciega)").toBeGreaterThan(0);
    expect([...new Set(delSchema)].sort()).toEqual([...RELACIONES_HACIA_EL_HISTORIAL].sort());
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

describe("los escritores del Kardex son lista cerrada: el analizador ve lo que dice ver", () => {
  const lista = { "esc.ts": { funcion: "escribir", motivo: "test" } };
  const juzgar = (codigo: string, archivo = "esc.ts") => juzgarEscritoresDelKardex(escrituraDeKardexEn(codigo, archivo), lista);

  it("ve create, createMany y createManyAndReturn, calificados o sueltos, y dice en qué función están", () => {
    expect(escrituraDeKardexEn("export async function a(tx: any) { await tx.movimientoStock.create({}); }", "x.ts")).toEqual([{ archivo: "x.ts", linea: 1, funcion: "a" }]);
    expect(escrituraDeKardexEn("export const b = async (tx: any) => tx.movimientoStock.createMany({});", "x.ts").map((e) => e.funcion)).toEqual(["b"]);
    expect(escrituraDeKardexEn("export const c = (movimientoStock: any) => movimientoStock.createManyAndReturn({});", "x.ts").map((e) => e.funcion)).toEqual(["c"]);
    expect(escrituraDeKardexEn("export const d = (tx: any, xs: any[]) => xs.map((x) => tx.movimientoStock.create(x));", "x.ts").map((e) => e.funcion)).toEqual(["d"]);
    expect(escrituraDeKardexEn("tx.movimientoStock.create({});", "x.ts").map((e) => e.funcion)).toEqual(["<nivel del módulo>"]);
  });

  it("ve también la escritura anidada en una Operacion y el SQL crudo que inserta", () => {
    expect(escrituraDeKardexEn("export const f = (tx: any) => tx.operacion.create({ data: { movimientos: { createMany: { data: [] } } } });", "x.ts").map((e) => e.funcion)).toEqual([
      "<escritura anidada en una Operacion>",
    ]);
    expect(escrituraDeKardexEn('export const g = (db: any) => db.$executeRaw`insert into "MovimientoStock" ("id") values (1)`;', "x.ts").map((e) => e.funcion)).toEqual(["<SQL crudo>"]);
  });

  it("NO marca lo que lee, lo que otro modelo escribe, ni un comentario o un texto", () => {
    const codigo =
      '// tx.movimientoStock.create({})\nexport const a = "tx.movimientoStock.createMany({})";\nexport const f = (tx: any) => [tx.movimientoStock.findMany({}), tx.operacion.create({}), tx.registroAuditoria.create({}), tx.movimientoStock.count({})];';
    expect(escrituraDeKardexEn(codigo, "x.ts")).toEqual([]);
    expect(escrituraDeKardexEn('export const g = (db: any) => db.$queryRaw`select * from "MovimientoStock"`;', "x.ts")).toEqual([]);
  });

  it("juzga: la función de la lista pasa; otra función, otro archivo, un delegado suelto nuevo o una entrada que ya no escribe fallan", () => {
    expect(juzgar("export async function escribir(tx: any) { await tx.movimientoStock.createMany({}); }")).toEqual([]);
    expect(juzgar("export async function otra(tx: any) { await tx.movimientoStock.createMany({}); }")).toHaveLength(2); // escribe en otra función y la de la lista ya no escribe
    expect(juzgar("export async function escribir(tx: any) { await tx.movimientoStock.createMany({}); }", "nuevo.ts")).toHaveLength(2); // un escritor no declarado y el declarado sin escrituras
    expect(juzgar("export async function escribir(tx: any) { await tx.movimientoStock.createMany({}); }\nexport const suelto = (movimientoStock: any) => movimientoStock.create({});")).toHaveLength(1);
    expect(juzgar("export const nada = 1;")).toHaveLength(1);
  });
});

describe("los escritores del Kardex son lista cerrada: el código del repositorio", () => {
  const encontradas = CARPETAS.flatMap((c) => archivosDe(join(RAIZ, c))).flatMap((absoluta) => {
    const archivo = relative(RAIZ, absoluta).split(sep).join("/");
    return escrituraDeKardexEn(readFileSync(absoluta, "utf8"), archivo);
  });

  it("encuentra los escritores (si no, la regla está vacía)", () => {
    expect(encontradas.length).toBeGreaterThanOrEqual(Object.keys(ESCRITORES_DEL_KARDEX).length);
  });

  it("solo escriben una línea del Kardex las funciones de la lista (y la lista no tiene entradas de más)", () => {
    const problemas = juzgarEscritoresDelKardex(encontradas, ESCRITORES_DEL_KARDEX);
    expect(problemas, `Escritores del Kardex fuera de la lista cerrada (agregar uno es una decisión de arquitectura, con su motivo):\n${problemas.join("\n")}`).toEqual([]);
  });

  it("cada escritor lleva su motivo", () => {
    for (const [archivo, e] of Object.entries(ESCRITORES_DEL_KARDEX)) expect(e.motivo.trim().length, archivo).toBeGreaterThan(20);
  });
});

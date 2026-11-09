import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guardianes de «una sola compra» (U0 de docs/diseno-una-sola-compra-2026-11-06.md, §6.7): toda compra se escribe por UNA puerta, la factura de una o más partes.
 *
 *  U-I2  Un solo escritor de `Operacion` COMPRA en `src/`: el caso de uso de la factura (al cargar) y el de aceptar la parte (al aceptar). `registrarMovimiento` con proceso COMPRA es un adaptador que delega ahí
 *        y NO escribe: lo vigila (a) que ningún otro archivo de `src/` escriba una `Operacion` con `proceso: "COMPRA"` y (b) que el motor genérico corte la COMPRA ANTES de su primera escritura de Kardex.
 *  U-I6  Cabecera siempre `CONFIRMADA`/`CARGA` y parte siempre `RECIBIDA`: nada en `src/` escribe otro `estado` u `origen` en `FacturaProveedor`, ni otra recepción en `FacturaProveedorSucursal`
 *        (`PENDIENTE_DE_REPARTO`, `MIGRACION` y `PENDIENTE` quedan en el esquema, sin uso, hasta una poda con autorización del dueño).
 *  U-I1  Toda COMPRA nueva tiene parte de factura: lo prueba, con la base real, `test/movimientos/compra-una-sola-puerta.test.ts`.
 *
 * Cada guardián trae su control de sanidad (si el analizador quedara ciego, las reglas pasarían por vacías) y se prueba a sí mismo con código de muestra que SÍ debe fallar.
 */
const RAIZ = join(__dirname, "../..");
const normalizar = (ruta: string) => ruta.split(sep).join("/");

function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivosTs(ruta));
    else if (/\.(ts|tsx)$/.test(nombre) && !nombre.endsWith(".d.ts")) salida.push(ruta);
  }
  return salida;
}

const ARCHIVOS_DE_SRC = archivosTs(join(RAIZ, "src")).map((ruta) => ({ ruta: normalizar(relative(RAIZ, ruta)), codigo: readFileSync(ruta, "utf8") }));

const fuente = (codigo: string) => ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);

/** Nombre del último miembro del callee: `escribirOperacionDeStock(…)` → "escribirOperacionDeStock"; `tx.operacion.create(…)` → "create". */
const nombreDelCallee = (e: ts.Expression): string => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "");
/** El texto del objeto que recibe el método: `tx.operacion.create` → "operacion". */
const duenioDelMetodo = (e: ts.Expression): string => (ts.isPropertyAccessExpression(e) && ts.isPropertyAccessExpression(e.expression) ? e.expression.name.text : "");

/** ¿Alguna propiedad `clave: "valor"` (literal de texto) dentro de este nodo, a cualquier profundidad? Devuelve los valores literales de esa clave. */
function valoresLiteralesDe(nodo: ts.Node, clave: string): string[] {
  const valores: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteralLike(n.name)) && n.name.text === clave && ts.isStringLiteralLike(n.initializer)) valores.push(n.initializer.text);
    ts.forEachChild(n, visitar);
  };
  visitar(nodo);
  return valores;
}

/** Las claves de propiedad (a cualquier profundidad) de un nodo. */
function clavesDe(nodo: ts.Node): Set<string> {
  const claves = new Set<string>();
  const visitar = (n: ts.Node): void => {
    if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && (ts.isIdentifier(n.name) || ts.isStringLiteralLike(n.name))) claves.add(n.name.text);
    ts.forEachChild(n, visitar);
  };
  visitar(nodo);
  return claves;
}

/** Las escrituras de `Operacion` (el escritor compartido o Prisma directo) con `proceso: "COMPRA"` literal. */
export function escritoresDeOperacionCompra(codigo: string): number {
  let cuenta = 0;
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const nombre = nombreDelCallee(n.expression);
      const esEscritura = nombre === "escribirOperacionDeStock" || (["create", "createMany", "createManyAndReturn", "upsert"].includes(nombre) && duenioDelMetodo(n.expression) === "operacion");
      if (esEscritura && n.arguments.some((a) => valoresLiteralesDe(a, "proceso").includes("COMPRA"))) cuenta += 1;
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente(codigo));
  return cuenta;
}

/** Escrituras de `FacturaProveedor` / `FacturaProveedorSucursal` que ponen un valor distinto del permitido en `estado`, `origen` o `estadoRecepcion`. Devuelve una descripción por hallazgo. */
export function escriturasDeEstadoNoPermitidas(codigo: string): string[] {
  const hallazgos: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const metodo = nombreDelCallee(n.expression);
      const duenio = duenioDelMetodo(n.expression);
      if (["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert"].includes(metodo)) {
        if (duenio === "facturaProveedor") {
          for (const a of n.arguments) {
            if (clavesDe(a).has("origen")) hallazgos.push("facturaProveedor escribe `origen`");
            for (const v of valoresLiteralesDe(a, "estado")) if (v !== "CONFIRMADA") hallazgos.push(`facturaProveedor escribe estado ${v}`);
            if (clavesDe(a).has("estado") && valoresLiteralesDe(a, "estado").length === 0) hallazgos.push("facturaProveedor escribe `estado` con un valor que no es un literal");
          }
        }
        if (duenio === "facturaProveedorSucursal") {
          for (const a of n.arguments) {
            for (const v of valoresLiteralesDe(a, "estadoRecepcion")) if (v !== "RECIBIDA") hallazgos.push(`facturaProveedorSucursal escribe estadoRecepcion ${v}`);
            if (clavesDe(a).has("estadoRecepcion") && valoresLiteralesDe(a, "estadoRecepcion").length === 0) hallazgos.push("facturaProveedorSucursal escribe `estadoRecepcion` con un valor que no es un literal");
          }
        }
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente(codigo));
  return hallazgos;
}

describe("U-I2: un solo escritor de Operacion COMPRA en src/", () => {
  const ESCRITORES_PERMITIDOS = [
    "src/server/actions/movimientos/casos-de-uso/aceptar-propuesta-de-factura.ts",
    "src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor.ts",
  ];

  it("solo la carga y la aceptación de la factura escriben una Operacion con proceso COMPRA", () => {
    const escritores = ARCHIVOS_DE_SRC.filter((a) => escritoresDeOperacionCompra(a.codigo) > 0).map((a) => a.ruta).sort();
    expect(escritores).toEqual(ESCRITORES_PERMITIDOS);
  });

  it("control de sanidad: el analizador reconoce una escritura de COMPRA (por el escritor compartido y por Prisma directo) y no confunde otro proceso", () => {
    expect(escritoresDeOperacionCompra(`await escribirOperacionDeStock(tx, { proceso: "COMPRA", fecha })`)).toBe(1);
    expect(escritoresDeOperacionCompra(`await tx.operacion.create({ data: { proceso: "COMPRA" } })`)).toBe(1);
    expect(escritoresDeOperacionCompra(`await tx.operacion.createMany({ data: [{ proceso: "COMPRA" }] })`)).toBe(1);
    expect(escritoresDeOperacionCompra(`await escribirOperacionDeStock(tx, { proceso: "MERMA" })`)).toBe(0);
    expect(escritoresDeOperacionCompra(`await tx.movimientoStock.create({ data: { proceso: "COMPRA" } })`)).toBe(0);
  });

  it("el motor genérico de movimientos manda la COMPRA a la factura ANTES de su primera escritura de Kardex", () => {
    const motor = ARCHIVOS_DE_SRC.find((a) => a.ruta === "src/server/actions/movimientos/casos-de-uso/registrar-movimiento.ts")!;
    const delegacion = motor.codigo.indexOf('if (datos.proceso === "COMPRA") return registrarCompraComoFactura(');
    const primeraEscritura = motor.codigo.indexOf("escribirOperacionDeStock(tx");
    expect(delegacion, "la delegación de la COMPRA existe").toBeGreaterThan(-1);
    expect(primeraEscritura, "el motor sigue escribiendo los otros procesos").toBeGreaterThan(-1);
    expect(delegacion, "la COMPRA se corta antes de escribir").toBeLessThan(primeraEscritura);
    expect(motor.codigo.includes("registrarFacturaProveedorCasoDeUso(actor"), "y la manda al caso de uso de la factura").toBe(true);
  });
});

describe("U-I6: estado, origen y recepción constantes", () => {
  it("nada en src/ escribe otro estado u origen de la factura, ni otra recepción de la parte", () => {
    const hallazgos = ARCHIVOS_DE_SRC.flatMap((a) => escriturasDeEstadoNoPermitidas(a.codigo).map((h) => `${a.ruta}: ${h}`));
    expect(hallazgos).toEqual([]);
  });

  it("control de sanidad: el analizador ve lo permitido y rechaza lo que no", () => {
    expect(escriturasDeEstadoNoPermitidas(`await tx.facturaProveedor.create({ data: { estado: "CONFIRMADA" } })`)).toEqual([]);
    expect(escriturasDeEstadoNoPermitidas(`await tx.facturaProveedorSucursal.create({ data: { estadoRecepcion: "RECIBIDA" } })`)).toEqual([]);
    expect(escriturasDeEstadoNoPermitidas(`await tx.facturaProveedor.create({ data: { estado: "PENDIENTE_DE_REPARTO" } })`)).toHaveLength(1);
    expect(escriturasDeEstadoNoPermitidas(`await tx.facturaProveedor.update({ where: {}, data: { origen: "MIGRACION" } })`)).toHaveLength(1);
    expect(escriturasDeEstadoNoPermitidas(`await tx.facturaProveedorSucursal.update({ where: {}, data: { estadoRecepcion: "PENDIENTE" } })`)).toHaveLength(1);
    expect(escriturasDeEstadoNoPermitidas(`await tx.facturaProveedor.update({ where: {}, data: { estado } })`)).toHaveLength(1);
    expect(escriturasDeEstadoNoPermitidas(`await tx.facturaProveedor.update({ where: {}, data: { anuladaEn: ahora } })`)).toEqual([]);
  });

  it("las escrituras reales existen (si no, el guardián estaría ciego)", () => {
    const conEscritura = ARCHIVOS_DE_SRC.filter((a) => /facturaProveedor(Sucursal)?\.(create|update)/.test(a.codigo)).map((a) => a.ruta);
    expect(conEscritura).toContain("src/server/persistencia/compras/escribir-factura-proveedor.ts");
  });
});

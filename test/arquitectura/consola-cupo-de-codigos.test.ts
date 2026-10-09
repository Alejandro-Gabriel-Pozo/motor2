import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * El cupo de códigos de ingreso de la consola (S-08, T4 del endurecimiento; guards GT-7 y GT-8 en su parte de la consola). Los tests de comportamiento
 * (`test/persistencia/ingreso-de-plataforma.test.ts`, `test/plataforma/pedir-codigo-de-ingreso.test.ts`) reproducen el ataque; este archivo fija la FORMA del código
 * que lo impide, para que un arreglo «de prolijidad» no la deshaga sin que nadie lo vea:
 *  - GT-7, «todo tope se lee dentro de la transacción»: el cupo por hora se cuenta con el `tx` de la transacción que crea el código y bajo el cerrojo de la fila
 *    del administrador (`FOR UPDATE`), nunca con la conexión suelta (`count` y después `create` dejaba pasar pedidos en paralelo por encima del tope);
 *  - GT-8, «un cupo que un anónimo puede consumir no invalida lo del dueño»: pedir un código NO invalida, borra ni toca los de nadie, y verificar busca el código de
 *    SU pedido (por id), nunca «el último vigente del administrador»;
 *  - B-C15: la acción pública `pedirCodigo` no toca la base antes de responder: la preparación entera corre dentro de `after()`.
 *
 * Mutaciones (cada una pone un caso en rojo): sacar el `FOR UPDATE`; contar con `db` en vez de `tx`; volver a invalidar los anteriores con `updateMany`; llamar a
 * `prepararCodigoDeIngreso` (o a la base) en el cuerpo de `pedirCodigo` fuera de `after()`; ordenar por `creadoEn` al verificar.
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

function archivoTs(ruta: string): ts.SourceFile {
  return ts.createSourceFile(ruta, leer(ruta), ts.ScriptTarget.Latest, true);
}

function funcion(sf: ts.SourceFile, nombre: string): ts.FunctionDeclaration {
  const f = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === nombre);
  if (!f?.body) throw new Error(`No encuentro la función ${nombre} en ${sf.fileName}`);
  return f;
}

function recorrer(nodo: ts.Node, visitar: (n: ts.Node) => void): void {
  visitar(nodo);
  ts.forEachChild(nodo, (hijo) => recorrer(hijo, visitar));
}

/** `a.b.c(...)`: el texto de la cadena de propiedades de una llamada, p. ej. `tx.codigoDeIngresoPlataforma.count`. */
const cadena = (n: ts.Expression): string => (ts.isPropertyAccessExpression(n) ? `${cadena(n.expression)}.${n.name.text}` : ts.isIdentifier(n) ? n.text : "?");

function llamadas(nodo: ts.Node, patron: RegExp): ts.CallExpression[] {
  const salida: ts.CallExpression[] = [];
  recorrer(nodo, (n) => {
    if (ts.isCallExpression(n) && patron.test(cadena(n.expression))) salida.push(n);
  });
  return salida;
}

/** ¿`nodo` está dentro del argumento de alguna llamada que cumple `patron`? */
function dentroDeLlamada(nodo: ts.Node, patron: RegExp): boolean {
  for (let p: ts.Node | undefined = nodo.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && patron.test(cadena(p.expression)) && p.arguments.some((a) => a.pos <= nodo.pos && nodo.end <= a.end)) return true;
  }
  return false;
}

describe("S-08 — el cupo de códigos de la consola: la forma del código que lo protege", () => {
  const ingreso = archivoTs("plataforma/src/servidor/ingreso.ts");
  const preparar = funcion(ingreso, "prepararCodigoDeIngreso");
  const verificar = funcion(ingreso, "verificarCodigoDeIngreso");

  it("sanidad: el recorrido ve las funciones de verdad (no pasa en vacío)", () => {
    expect(llamadas(preparar, /\.codigoDeIngresoPlataforma\.create$/).length).toBeGreaterThanOrEqual(1);
    expect(llamadas(verificar, /\.codigoDeIngresoPlataforma\.updateMany$/).length).toBeGreaterThanOrEqual(1);
  });

  it("GT-7: el cupo por hora se cuenta con el `tx` de la transacción que crea el código, nunca con la conexión suelta", () => {
    const conteos = llamadas(preparar, /\.codigoDeIngresoPlataforma\.count$/);
    expect(conteos.length, "prepararCodigoDeIngreso tiene que contar el cupo").toBe(1);
    for (const conteo of conteos) {
      expect(cadena(conteo.expression), "el conteo del cupo va con `tx`").toBe("tx.codigoDeIngresoPlataforma.count");
      expect(dentroDeLlamada(conteo, /\.\$transaction$/), "el conteo del cupo va dentro de `$transaction`").toBe(true);
    }
    // Y la creación, en la misma transacción.
    for (const creacion of llamadas(preparar, /\.codigoDeIngresoPlataforma\.create$/)) {
      expect(cadena(creacion.expression)).toBe("tx.codigoDeIngresoPlataforma.create");
      expect(dentroDeLlamada(creacion, /\.\$transaction$/)).toBe(true);
    }
  });

  it("GT-7: antes de contar, la transacción toma el cerrojo de la fila del administrador (`SELECT … FOR UPDATE`): los pedidos en paralelo se hacen la cola", () => {
    const conteo = llamadas(preparar, /\.codigoDeIngresoPlataforma\.count$/)[0];
    const cerrojos: ts.Node[] = [];
    recorrer(preparar, (n) => {
      if (ts.isTaggedTemplateExpression(n) && /\.\$queryRaw$/.test(cadena(n.tag)) && /FROM\s+"AdminPlataforma"[\s\S]*FOR UPDATE/.test(n.template.getText())) cerrojos.push(n);
    });
    expect(cerrojos.length, "falta el `FOR UPDATE` sobre AdminPlataforma").toBe(1);
    expect(cerrojos[0].pos, "el cerrojo tiene que ir ANTES del conteo").toBeLessThan(conteo.pos);
  });

  it("GT-8: pedir un código no invalida, borra ni modifica los códigos de nadie", () => {
    const toques = llamadas(preparar, /\.codigoDeIngresoPlataforma\.(update|updateMany|upsert|delete|deleteMany)$/).map((l) => cadena(l.expression));
    expect(toques).toEqual([]);
    expect(preparar.getText()).not.toMatch(/invalidadoEn/);
  });

  it("GT-8: verificar busca el código de SU pedido por id, nunca «el último vigente» del administrador", () => {
    const texto = verificar.getText();
    expect(texto, "ordenar por creadoEn es buscar «el último»").not.toMatch(/orderBy/);
    expect(llamadas(verificar, /\.adminPlataforma\.(findUnique|findFirst|findMany)$/), "buscar al administrador primero hace que el tiempo delate si el email existe").toEqual([]);
    const busquedas = llamadas(verificar, /\.codigoDeIngresoPlataforma\.findFirst$/);
    expect(busquedas.length).toBe(1);
    expect(busquedas[0].arguments[0].getText()).toMatch(/where:\s*\{\s*id:\s*codigoId\b/);
    const reservas = llamadas(verificar, /\.codigoDeIngresoPlataforma\.updateMany$/);
    for (const reserva of reservas) expect(reserva.arguments[0].getText(), "toda escritura del código va por el id del pedido").toMatch(/where:\s*\{\s*id:\s*codigoId\b/);
  });

  it("el HMAC del código lleva el nonce del pedido en su contexto (solo el navegador que lo pidió puede comprobarlo)", () => {
    expect(leer("plataforma/src/servidor/ingreso.ts")).toMatch(/const contextoDeIngreso = \(adminId: string, codigoId: string, nonce: string\) => `ingreso:\$\{adminId\}:\$\{codigoId\}:\$\{nonce\}`/);
  });
});

describe("B-C15 — pedirCodigo responde sin tocar la base", () => {
  const acciones = archivoTs("plataforma/src/app/login/acciones.ts");
  const pedir = funcion(acciones, "pedirCodigo");

  it("la preparación (prepararCodigoDeIngreso) y toda conexión a la base van SOLO dentro de `after()`", () => {
    const usos: ts.Identifier[] = [];
    recorrer(pedir, (n) => {
      if (ts.isIdentifier(n) && (n.text === "prepararCodigoDeIngreso" || n.text === "dbDeIdentidad" || n.text === "enviarCorreo")) usos.push(n);
    });
    expect(usos.length, "sanidad: pedirCodigo tiene que preparar y mandar").toBeGreaterThanOrEqual(3);
    for (const uso of usos) expect(dentroDeLlamada(uso, /^after$/), `${uso.text} fuera de after()`).toBe(true);
  });

  it("pone la cookie del pedido y consulta el cupo por origen ANTES de programar el trabajo", () => {
    const despues = llamadas(pedir, /^after$/)[0];
    const cookie = llamadas(pedir, /^ponerCookieDePedido$/)[0];
    const origen = llamadas(pedir, /^origenSinCupoDeCodigos$/)[0];
    expect(cookie, "falta ponerCookieDePedido").toBeDefined();
    expect(origen, "falta el cupo por origen").toBeDefined();
    expect(cookie.pos).toBeLessThan(despues.pos);
    expect(origen.pos).toBeLessThan(despues.pos);
  });
});

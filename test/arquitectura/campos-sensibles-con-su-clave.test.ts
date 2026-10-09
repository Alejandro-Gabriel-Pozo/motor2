import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { ACCIONES, type NivelDeAccion } from "../../src/core/permisos/acciones";
import { nivelAlcanzaElPiso } from "../../src/core/permisos/jerarquia";

/**
 * GT-1, parte de la tanda T7 del endurecimiento de seguridad (S-12, S-13, S-14): CAMPOS SENSIBLES CON PISO MÍNIMO. Un dato de dinero o de la relación con un proveedor solo sale a quien
 * tiene la clave que le corresponde, y esa clave no puede ser de un piso más bajo que el que el dato merece. Cada dato de la lista se pide a su consulta con una OPCIÓN que la consulta
 * niega por defecto (`conCostoDeConsignacion`, `conImportes`, `conDatosComerciales`); la página decide la opción con la clave y nadie la pone en `true` fijo.
 *
 * Lo que se vigila, por AST:
 *  1. Toda asignación de una de esas opciones en `src/` está en la lista cerrada `CONSUMIDORES` (una página nueva que pida el dato falla hasta que se la anote con su clave), y la lista
 *     no tiene entradas de más.
 *  2. La opción NUNCA se asigna con `true` fijo (ni `false`: sería código muerto): se asigna con lo que devolvió el gate.
 *  3. El archivo que la asigna llama a un gate de permisos con el literal de LA CLAVE declarada (no una cualquiera).
 *  4. La clave declarada existe en el catálogo y su piso alcanza el `pisoMinimo` del dato (que se declara acá, aparte de la clave: si alguien baja la clave a operario, el dato se
 *     queda sin la protección que se acordó).
 * T14 (M-25 de la auditoría intermedia): también se ve la forma abreviada `{ conImportes }`, y el gate se verifica por VALOR (lo que se le pasa a la opción sale de la variable que declaró
 * el gate de SU clave), no solo por la presencia de la clave en el archivo. La otra mitad de GT-1 —todo el que PIDE a Prisma un campo sensible, hasta las páginas— es
 * `campos-sensibles-lectores.test.ts`.
 * El detalle de qué campos vuelven con y sin la opción lo prueban los tests de comportamiento de cada arreglo (`conteo-frecuencia-sin-importes`, `trazabilidad-sin-datos-comerciales`,
 * `costo-consignacion-solo-administrador`). El resto de la lista de GT-1 (importes del Kardex, CUIT y correo del proveedor, tokens) se suma a medida que cada dato tiene su opción.
 *
 * Mutaciones (cada una pone un caso en rojo): `{ conImportes: true }` fijo en la pantalla de Frecuencia de conteo; cambiar `"reporte_compras"` por otra clave en esa página; bajar
 * `reporte_historial_importes` a operario en el catálogo; una página nueva que pide `conDatosComerciales`.
 */
const RAIZ = join(__dirname, "../..");

interface DatoSensible {
  dato: string;
  clave: string;
  pisoMinimo: NivelDeAccion;
}

/** Opción de la consulta → qué dato destapa, con qué clave y con qué piso mínimo. */
const DATOS_SENSIBLES: Record<string, DatoSensible> = {
  conCostoDeConsignacion: { dato: "Producto.precioConsignacion y Producto.proveedorConsignacionId (S-12, D8)", clave: "pagar_consignante", pisoMinimo: "administrador" },
  conImportes: { dato: "el gasto en compras por insumo (S-13)", clave: "reporte_compras", pisoMinimo: "administrador" },
  conDatosComerciales: { dato: "Operacion.nroFactura, el proveedor de la operación y el email de quien la anuló (S-14)", clave: "reporte_historial_importes", pisoMinimo: "administrador" },
};

/** `archivo|opción` de cada lugar donde una página pide el dato. Lista cerrada. */
const CONSUMIDORES = [
  "src/app/(app)/catalogo/productos/[id]/editar/page.tsx|conCostoDeConsignacion",
  "src/app/(app)/catalogo/productos/[id]/page.tsx|conCostoDeConsignacion",
  "src/app/(app)/reportes/trazabilidad/page.tsx|conDatosComerciales",
  "src/app/(app)/stock/conteo-frecuencia/page.tsx|conImportes",
];

const GATES = new Set(["obtenerMiNivelPermiso", "obtenerMiNivelPermisoDeEmpresa", "requierePermiso", "requierePermisoVer", "requierePermisoDeEmpresa", "requierePermisoVerDeEmpresa"]);

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
  });
}

interface Uso {
  opcion: string;
  valor: "true" | "false" | "otro";
  /** Los identificadores del valor (`{ conImportes: veImportes }` → `veImportes`; la forma abreviada `{ conImportes }` → `conImportes`): de ellos sale la clave del gate de la que depende. */
  identificadores: string[];
}

const nombresDeUnPatron = (n: ts.BindingName): string[] =>
  ts.isIdentifier(n) ? [n.text] : n.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : nombresDeUnPatron(e.name)));

const identificadoresDe = (n: ts.Node): string[] => {
  const salida: string[] = [];
  const visitar = (x: ts.Node): void => {
    if (ts.isIdentifier(x)) salida.push(x.text);
    ts.forEachChild(x, visitar);
  };
  visitar(n);
  return salida;
};

/**
 * Dónde se asigna una de las opciones (`{ opción: valor }` o la forma abreviada `{ opción }`, M-25 de la auditoría intermedia: antes solo se veían las asignaciones con valor), las claves literales
 * que el archivo le pasa a un gate y, por variable, DE QUÉ claves de gate depende (`atadas`: una variable declarada con una llamada a un gate con esa clave literal, y las que se arman con una
 * variable así: `const veImportes = ver && algo`). El gate se verifica por VALOR: lo que se le pasa a la opción tiene que salir del gate de SU clave, no solo estar en el mismo archivo.
 */
function analizar(codigo: string, ruta: string): { usos: Uso[]; clavesDeGate: Set<string>; atadas: Map<string, Set<string>> } {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const usos: Uso[] = [];
  const clavesDeGate = new Set<string>();
  const declaraciones: { nombres: string[]; inicializador: ts.Expression }[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && Object.hasOwn(DATOS_SENSIBLES, n.name.text)) {
      usos.push({
        opcion: n.name.text,
        valor: n.initializer.kind === ts.SyntaxKind.TrueKeyword ? "true" : n.initializer.kind === ts.SyntaxKind.FalseKeyword ? "false" : "otro",
        identificadores: identificadoresDe(n.initializer),
      });
    }
    if (ts.isShorthandPropertyAssignment(n) && Object.hasOwn(DATOS_SENSIBLES, n.name.text)) usos.push({ opcion: n.name.text, valor: "otro", identificadores: [n.name.text] });
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && GATES.has(n.expression.text)) {
      for (const a of n.arguments) if (ts.isStringLiteral(a)) clavesDeGate.add(a.text);
    }
    if (ts.isVariableDeclaration(n) && n.initializer) declaraciones.push({ nombres: nombresDeUnPatron(n.name), inicializador: n.initializer });
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);

  // De qué claves de gate depende cada variable: la llamada al gate dentro de su inicializador, y (hasta que no cambie nada) las variables que ese inicializador usa.
  const atadas = new Map<string, Set<string>>();
  const clavesDeLaLlamada = (e: ts.Node): string[] => {
    const claves: string[] = [];
    const v = (x: ts.Node): void => {
      if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && GATES.has(x.expression.text)) for (const a of x.arguments) if (ts.isStringLiteral(a)) claves.push(a.text);
      ts.forEachChild(x, v);
    };
    v(e);
    return claves;
  };
  for (let cambio = true; cambio; ) {
    cambio = false;
    for (const d of declaraciones) {
      const claves = new Set(clavesDeLaLlamada(d.inicializador));
      for (const id of identificadoresDe(d.inicializador)) for (const c of atadas.get(id) ?? []) claves.add(c);
      for (const nombre of d.nombres) {
        const actual = atadas.get(nombre) ?? new Set<string>();
        for (const c of claves) {
          if (actual.has(c)) continue;
          actual.add(c);
          cambio = true;
        }
        if (actual.size) atadas.set(nombre, actual);
      }
    }
  }
  return { usos, clavesDeGate, atadas };
}

const delSrc = archivos(join(RAIZ, "src")).map((f) => {
  const ruta = relative(RAIZ, f).split(sep).join("/");
  return { ruta, ...analizar(readFileSync(f, "utf8"), ruta) };
});
const consumidores = delSrc.flatMap((a) => a.usos.map((u) => ({ ...u, ruta: a.ruta, clavesDeGate: a.clavesDeGate, atadas: a.atadas })));

describe("GT-1 (T7) — los datos sensibles de una consulta se piden con la clave que les corresponde", () => {
  it("el detector (con fuentes sintéticas)", () => {
    const a = analizar('async function p() { const { ver } = await obtenerMiNivelPermiso(u, s, "reporte_compras", db); return q(db, { conImportes: ver }); }', "x.ts");
    expect(a.usos).toEqual([{ opcion: "conImportes", valor: "otro", identificadores: ["ver"] }]);
    expect([...a.clavesDeGate]).toEqual(["reporte_compras"]);
    expect(analizar("q(db, { conImportes: true });", "x.ts").usos).toEqual([{ opcion: "conImportes", valor: "true", identificadores: [] }]);
    expect(analizar("q(db, { otra: true }); // conImportes: true", "x.ts").usos).toEqual([]);
  });

  it("el detector ve la forma ABREVIADA y verifica el gate por VALOR (M-25 de la auditoría intermedia)", () => {
    // `{ conImportes }` es lo mismo que `{ conImportes: conImportes }`: antes no se veía, y la página quedaba fuera de CONSUMIDORES
    const abreviada = analizar('async function p() { const { ver: conImportes } = await obtenerMiNivelPermiso(u, s, "reporte_compras", db); return q(db, { conImportes }); }', "x.ts");
    expect(abreviada.usos).toEqual([{ opcion: "conImportes", valor: "otro", identificadores: ["conImportes"] }]);
    expect([...(abreviada.atadas.get("conImportes") ?? [])]).toEqual(["reporte_compras"]);
    // un valor que NO sale del gate de la clave: el gate está en el archivo pero no manda sobre la opción
    const desatada = analizar('async function p() { await requierePermiso(u, s, "reporte_compras", db); const x = calculo(); return q(db, { conImportes: x }); }', "x.ts");
    expect(desatada.atadas.get("x")).toBeUndefined();
    // un valor armado con una variable atada (cadena de variables) sigue atado; el gate de OTRA clave ata a OTRA clave
    const cadena = analizar('async function p() { const { ver } = await obtenerMiNivelPermiso(u, s, "reporte_compras", db); const v = ver && true; const { ver: o } = await obtenerMiNivelPermiso(u, s, "otra", db); return q(db, { conImportes: v }); }', "x.ts");
    expect([...(cadena.atadas.get("v") ?? [])]).toEqual(["reporte_compras"]);
    expect([...(cadena.atadas.get("o") ?? [])]).toEqual(["otra"]);
    // un nombre heredado del prototipo no es una opción
    expect(analizar("q({ constructor: 1, toString })", "x.ts").usos).toEqual([]);
  });

  it("los consumidores de los datos sensibles son exactamente los de CONSUMIDORES", () => {
    const hallados = [...new Set(consumidores.map((c) => `${c.ruta}|${c.opcion}`))].sort();
    expect(hallados, "una página nueva que pide un dato sensible se anota en CONSUMIDORES con su clave; una entrada que ya no existe sale").toEqual([...CONSUMIDORES].sort());
  });

  it("ningún consumidor pide el dato con un valor fijo: lo decide la clave", () => {
    const fijos = consumidores.filter((c) => c.valor !== "otro").map((c) => `${c.ruta}|${c.opcion}: ${c.valor}`);
    expect(fijos).toEqual([]);
  });

  it("cada consumidor llama a un gate de permisos con la clave que corresponde a su dato", () => {
    for (const c of consumidores) {
      const { clave, dato } = DATOS_SENSIBLES[c.opcion]!;
      expect(c.clavesDeGate.has(clave), `${c.ruta} pide ${dato} sin consultar «${clave}»`).toBe(true);
    }
  });

  it("el valor de la opción sale del gate de SU clave (por valor, no solo por archivo)", () => {
    for (const c of consumidores) {
      const { clave, dato } = DATOS_SENSIBLES[c.opcion]!;
      const atadasALaClave = c.identificadores.filter((id) => c.atadas.get(id)?.has(clave));
      expect(atadasALaClave.length, `${c.ruta}: lo que se le pasa a ${c.opcion} (${dato}) tiene que salir del gate de «${clave}»; las variables que usa son: ${c.identificadores.join(", ") || "(ninguna)"}`).toBeGreaterThan(0);
    }
  });

  it("la clave de cada dato existe en el catálogo y su piso alcanza el piso mínimo del dato", () => {
    for (const [opcion, { clave, pisoMinimo, dato }] of Object.entries(DATOS_SENSIBLES)) {
      const accion = ACCIONES.find((a) => a.clave === clave);
      expect(accion, `${opcion}: la clave «${clave}» no está en el catálogo`).toBeDefined();
      expect(nivelAlcanzaElPiso(accion!.nivelMinimo, pisoMinimo), `«${clave}» (piso ${accion!.nivelMinimo}) protege ${dato}, que pide piso ${pisoMinimo} como mínimo`).toBe(true);
    }
  });
});

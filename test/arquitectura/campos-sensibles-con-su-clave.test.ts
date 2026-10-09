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
}

/** Dónde se asigna una de las opciones (`{ opción: valor }`) y las claves literales que el archivo le pasa a un gate. */
function analizar(codigo: string, ruta: string): { usos: Uso[]; clavesDeGate: Set<string> } {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const usos: Uso[] = [];
  const clavesDeGate = new Set<string>();
  const visitar = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text in DATOS_SENSIBLES) {
      usos.push({ opcion: n.name.text, valor: n.initializer.kind === ts.SyntaxKind.TrueKeyword ? "true" : n.initializer.kind === ts.SyntaxKind.FalseKeyword ? "false" : "otro" });
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && GATES.has(n.expression.text)) {
      for (const a of n.arguments) if (ts.isStringLiteral(a)) clavesDeGate.add(a.text);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return { usos, clavesDeGate };
}

const delSrc = archivos(join(RAIZ, "src")).map((f) => {
  const ruta = relative(RAIZ, f).split(sep).join("/");
  return { ruta, ...analizar(readFileSync(f, "utf8"), ruta) };
});
const consumidores = delSrc.flatMap((a) => a.usos.map((u) => ({ ...u, ruta: a.ruta, clavesDeGate: a.clavesDeGate })));

describe("GT-1 (T7) — los datos sensibles de una consulta se piden con la clave que les corresponde", () => {
  it("el detector (con fuentes sintéticas)", () => {
    const a = analizar('async function p() { const { ver } = await obtenerMiNivelPermiso(u, s, "reporte_compras", db); return q(db, { conImportes: ver }); }', "x.ts");
    expect(a.usos).toEqual([{ opcion: "conImportes", valor: "otro" }]);
    expect([...a.clavesDeGate]).toEqual(["reporte_compras"]);
    expect(analizar("q(db, { conImportes: true });", "x.ts").usos).toEqual([{ opcion: "conImportes", valor: "true" }]);
    expect(analizar("q(db, { otra: true }); // conImportes: true", "x.ts").usos).toEqual([]);
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

  it("la clave de cada dato existe en el catálogo y su piso alcanza el piso mínimo del dato", () => {
    for (const [opcion, { clave, pisoMinimo, dato }] of Object.entries(DATOS_SENSIBLES)) {
      const accion = ACCIONES.find((a) => a.clave === clave);
      expect(accion, `${opcion}: la clave «${clave}» no está en el catálogo`).toBeDefined();
      expect(nivelAlcanzaElPiso(accion!.nivelMinimo, pisoMinimo), `«${clave}» (piso ${accion!.nivelMinimo}) protege ${dato}, que pide piso ${pisoMinimo} como mínimo`).toBe(true);
    }
  });
});

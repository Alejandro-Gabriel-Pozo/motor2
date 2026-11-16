import { describe, expect, it } from "vitest";
import {
  dimensionesDeRecepcion,
  productoCartesiano,
  resultadoDeCargar,
  resultadoDeConfirmar,
  resultadoDeControlDeLinea,
  resultadoDeEntradas,
  resultadoDePuertaDeControl,
  tablaDeRecepcion,
  type FilaDeConfirmacion,
  type FilaDeControl,
  type FilaDeEntradas,
  type FilaDePuertaDeControl,
} from "../setup/oraculo-compras-recepcion";

/**
 * Oráculo de combinaciones de la recepción separada de compras (regla «Combinaciones» del dueño): recorre TODAS las combinaciones de las reglas reales —con qué estado nace la parte (módulo × reparto) y confirmar la recepción
 * (módulo × rol × sucursal de la parte × estado × sección × fecha, con el guard de módulo y de piso del rol y la regla pura de recepción), registrar el control por línea (condición × observación × cantidad según remito; módulo × rol × parte × estado) y las entradas de stock (entradas × control)— contra las tablas de `docs/oraculo-combinaciones-compras-recepcion-2026-11-16.md`, escritas
 * aparte del código. Son pocas, así que el recorrido es exhaustivo. Que la tabla sea EXACTAMENTE el producto de los valores declarados es la mitad del test: una fila repetida, faltante o con un valor no declarado lo pone en rojo.
 */
const DIMENSIONES = dimensionesDeRecepcion();

const SECCIONES = [
  { seccion: "Cargar la factura", dims: ["M", "R"], decidir: (f: Record<string, string>) => resultadoDeCargar(f as { M: string; R: string }) },
  { seccion: "Confirmar la recepción", dims: ["M", "O", "P", "E", "S", "F"], decidir: (f: Record<string, string>) => resultadoDeConfirmar(f as FilaDeConfirmacion) },
  { seccion: "Registrar el control de una línea", dims: ["C", "B", "Q"], decidir: (f: Record<string, string>) => resultadoDeControlDeLinea(f as FilaDeControl) },
  { seccion: "Registrar el control: puerta y estado", dims: ["M", "O", "P", "E"], decidir: (f: Record<string, string>) => resultadoDePuertaDeControl(f as FilaDePuertaDeControl) },
  { seccion: "Entradas de la confirmación", dims: ["N", "K"], decidir: (f: Record<string, string>) => resultadoDeEntradas(f as FilaDeEntradas) },
] as const;

describe.each(SECCIONES)("oráculo: $seccion", ({ seccion, dims, decidir }) => {
  const tabla = tablaDeRecepcion(seccion);

  it("la tabla es exactamente el producto cartesiano de los valores declarados (sin filas repetidas, faltantes ni valores no declarados)", () => {
    expect(tabla.columnas).toEqual([...dims, "Resultado"]);
    const declarado = productoCartesiano(Object.fromEntries(dims.map((d) => [d, DIMENSIONES[d] ?? []])));
    expect(declarado.length).toBeGreaterThan(0);
    const clave = (f: Record<string, string>) => dims.map((d) => f[d]).join("|");
    expect(tabla.filas.map(clave).sort()).toEqual(declarado.map(clave).sort());
  });

  it("cada combinación da el resultado de la tabla", () => {
    expect(tabla.filas.length).toBeGreaterThan(0);
    for (const fila of tabla.filas) {
      expect(decidir(fila), `${dims.map((d) => `${d}=${fila[d]}`).join(" ")}`).toBe(fila["Resultado"]);
    }
  });
});

describe("oráculo de recepción: sanidad", () => {
  it("las dimensiones declaradas existen y tienen más de un valor", () => {
    for (const d of ["M", "R", "O", "P", "E", "S", "F", "C", "B", "Q", "N", "K"]) expect(DIMENSIONES[d]?.length ?? 0, d).toBeGreaterThan(1);
  });

  it("la tabla de confirmar tiene de todo: CONFIRMA una sola vez por cada rol que puede, y todos los rechazos del orden declarado", () => {
    const filas = tablaDeRecepcion("Confirmar la recepción").filas;
    const resultados = new Set(filas.map((f) => f["Resultado"]));
    expect([...resultados].sort()).toEqual(
      ["CONFIRMA", "RECHAZA_FECHA_FUERA_DE_RANGO", "RECHAZA_MODULO_NO_ACTIVO", "RECHAZA_NO_ES_DE_ESTA_SUCURSAL", "RECHAZA_SECCION_INACTIVA", "RECHAZA_SECCION_NO_ENCONTRADA", "RECHAZA_SIN_PERMISO", "RECHAZA_YA_ANULADA", "RECHAZA_YA_RECIBIDA"].sort()
    );
    expect(filas.filter((f) => f["Resultado"] === "CONFIRMA").map((f) => f["O"]).sort()).toEqual(["ADMINISTRADOR", "GERENTE"]);
  });
});

describe("oráculo del control por línea: sanidad", () => {
  it("el control se guarda en una sola forma por cada condición válida y todos los rechazos del orden declarado aparecen", () => {
    const filas = tablaDeRecepcion("Registrar el control de una línea").filas;
    expect([...new Set(filas.map((f) => f["Resultado"]))].sort()).toEqual(
      ["GUARDA", "RECHAZA_CANTIDAD_SEGUN_REMITO_INVALIDA", "RECHAZA_CONDICION_INVALIDA", "RECHAZA_OBSERVACION_INVALIDA", "RECHAZA_OBSERVACION_OBLIGATORIA"].sort()
    );
    // Sin observación solo se guarda un CONFORME: nunca hay un CONFORME «por defecto» ni una condición con observación faltante.
    expect(filas.filter((f) => f["B"] === "SIN" && f["Resultado"] === "GUARDA").map((f) => f["C"])).toEqual(["CONFORME", "CONFORME"]);
  });

  it("el operador registra el control (piso operario) pero no confirma: la puerta del control lo deja pasar y la de confirmar lo rechaza", () => {
    const puerta = tablaDeRecepcion("Registrar el control: puerta y estado").filas.filter((f) => f["M"] === "ENCENDIDO" && f["P"] === "PROPIA" && f["E"] === "PENDIENTE");
    expect(puerta.map((f) => [f["O"], f["Resultado"]])).toEqual([["OPERADOR", "GUARDA"], ["ADMINISTRADOR", "GUARDA"], ["GERENTE", "GUARDA"]]);
    const confirmar = tablaDeRecepcion("Confirmar la recepción").filas.find((f) => f["M"] === "ENCENDIDO" && f["O"] === "OPERADOR" && f["P"] === "PROPIA" && f["E"] === "PENDIENTE" && f["S"] === "PROPIA_ACTIVA" && f["F"] === "VALIDA");
    expect(confirmar?.["Resultado"]).toBe("RECHAZA_SIN_PERMISO");
  });

  it("el control no cambia lo que entra: para cada forma de las entradas el resultado es el mismo con cualquier control", () => {
    const filas = tablaDeRecepcion("Entradas de la confirmación").filas;
    for (const n of DIMENSIONES["N"] ?? []) expect(new Set(filas.filter((f) => f["N"] === n).map((f) => f["Resultado"])).size, n).toBe(1);
  });
});

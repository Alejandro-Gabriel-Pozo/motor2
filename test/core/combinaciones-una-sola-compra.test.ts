import { describe, expect, it } from "vitest";
import { claveDeLote, decidirAnulacionDeFactura, decidirCorreccionDeDatos, decidirDeclaracionDePago, evaluarAnulacion } from "@/core/compras/public";
import type { LineaComprada } from "@/core/compras/public";
import { dimensionesDelOraculo, productoCartesiano, tablaDelOraculo } from "../setup/oraculo-una-sola-compra";

/**
 * Oráculo de combinaciones de «una sola compra» (regla «Combinaciones» del dueño): recorre TODAS las combinaciones de las reglas puras de anular la factura, corregir sus datos y declarar su pago contra las tablas de
 * `docs/oraculo-combinaciones-una-sola-compra-2026-11-06.md` (escritas aparte del código). Son pocas, así que el recorrido es exhaustivo. Que la tabla sea EXACTAMENTE el producto de los valores declarados es la mitad del
 * test: una fila repetida, faltante o con un valor no declarado lo pone en rojo.
 */
const DIMENSIONES = dimensionesDelOraculo();

const LINEA: LineaComprada = {
  productoId: "p1", productoCodigo: "P1", productoNombre: "Producto", seccionId: "s1", seccionNombre: "Cocina", loteVencimiento: null,
  cantidad: 10, precioTotal: 1000, precioPorUnidadStock: 100, detalle: "",
};

/** La regla pura de anular la factura entera con la cabecera ya decidida y el stock de la (única) parte. */
function anular(f: { A: string; N: string; S: string }): string {
  const cabecera = decidirAnulacionDeFactura({ anulada: f.A === "SI", notasVigentes: f.N === "VIGENTE" });
  if (!cabecera.ok) return `RECHAZA_${cabecera.codigo}`;
  const saldos = new Map([[claveDeLote(LINEA.productoId, LINEA.seccionId, null), f.S === "INTACTO" ? 10 : 0]]);
  const stock = evaluarAnulacion({ proceso: "COMPRA", anuladaEn: null, lineas: [LINEA] }, saldos);
  return stock.ok ? "ANULA" : `RECHAZA_${stock.motivo}`;
}

function corregir(f: { A: string; V: string; N: string }): string {
  const r = decidirCorreccionDeDatos({ anulada: f.A === "SI", cambiaElProveedor: f.V === "SI", tieneNotas: f.N !== "SIN" });
  return r.ok ? "CORRIGE" : `RECHAZA_${r.codigo}`;
}

function declararPago(f: { A: string; C: string; P: string }): string {
  const r = decidirDeclaracionDePago({ condicionPago: f.C as "CONTADO_PAGADA" | "PENDIENTE_DE_PAGO", anulada: f.A === "SI", tienePagoVigente: f.P === "SI", diaFactura: "2026-11-01", diaPago: "2026-11-02", hoy: "2026-11-06" });
  return r.ok ? "DECLARA" : `RECHAZA_${r.codigo}`;
}

const COMANDOS = [
  { seccion: "Anular la factura entera", dims: ["A", "N", "S"], decidir: anular },
  { seccion: "Corregir los datos de la factura", dims: ["A", "V", "N"], decidir: corregir },
  { seccion: "Declarar el pago de la factura", dims: ["A", "C", "P"], decidir: declararPago },
] as const;

describe.each(COMANDOS)("oráculo: $seccion", ({ seccion, dims, decidir }) => {
  const tabla = tablaDelOraculo(seccion);

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
      expect(decidir(fila as never), `${dims.map((d) => `${d}=${fila[d]}`).join(" ")}`).toBe(fila["Resultado"]);
    }
  });
});

describe("oráculo: sanidad", () => {
  it("las dimensiones declaradas existen y tienen más de un valor", () => {
    for (const d of ["A", "N", "S", "C", "P", "V"]) expect(DIMENSIONES[d]?.length ?? 0, d).toBeGreaterThan(1);
  });
});

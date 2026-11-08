import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCION_POR_PROCESO, obtenerConfigProceso } from "@/core/movimientos/public";

/**
 * Poda del 2026-11-06 (rama «Compra» muerta del formulario genérico). La página `movimientos/[proceso]` manda SIEMPRE la Compra
 * a `PanelCompraPorPasos`; el panel genérico (`PanelMovimientoForm`) no puede volver a traer lo que era solo de la Compra: el
 * reparto entre sucursales (`registrarFacturaProveedor` + `BloqueDeReparto`), el alta rápida de producto (`QuickCrearProducto`)
 * ni la precarga por proveedor (`listarProductosDeProveedor`). Esas tres cosas viven en el panel por pasos.
 */
const CARPETA = join(__dirname, "../../src/app/(app)/movimientos/[proceso]");
const leer = (archivo: string) => readFileSync(join(CARPETA, archivo), "utf8");

function sinComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("formulario genérico de movimientos sin la rama Compra", () => {
  it("la página manda la Compra al panel por pasos y el genérico solo recibe los demás procesos", () => {
    const pagina = sinComentarios(leer("page.tsx"));
    expect(pagina).toMatch(/esCompra\s*\?\s*\(\s*<PanelCompraPorPasos/);
    // El genérico queda en la rama «no es Compra»: ahí `esCompra` es falso, no puede pedirle reparto ni alta rápida.
    const ramaGenerica = pagina.slice(pagina.indexOf("<PanelMovimientoForm"));
    expect(ramaGenerica).not.toMatch(/reparto=/);
    expect(ramaGenerica).not.toMatch(/unidades=/);
  });

  it("ningún proceso del selector que no sea la Compra queda sin su formulario, y COMPRA es el único que usa el panel por pasos", () => {
    const procesos = Object.keys(ACCION_POR_PROCESO);
    expect(procesos).toContain("COMPRA");
    const compras = procesos.filter((p) => p === "COMPRA");
    expect(compras).toHaveLength(1);
    expect(obtenerConfigProceso("compra")?.proceso).toBe("COMPRA");
  });

  it("el panel genérico no importa nada propio de la Compra", () => {
    const panel = sinComentarios(leer("panel-movimiento-form.tsx"));
    for (const prohibido of ["registrarFacturaProveedor", "BloqueDeReparto", "bloque-de-reparto", "QuickCrearProducto", "listarProductosDeProveedor", "referenciaProveedor", 'proceso === "COMPRA"']) {
      expect(panel, prohibido).not.toContain(prohibido);
    }
  });

  it("lo que sí usa la Devolución a proveedor (esCompraLike) se conserva en el panel genérico", () => {
    const panel = sinComentarios(leer("panel-movimiento-form.tsx"));
    expect(panel).toContain("config.esCompraLike");
    expect(panel).toContain("listarPresentaciones");
    expect(panel).toContain("Precio total (con IVA incluido)");
  });

  it("el panel por pasos conserva reparto, alta rápida y precarga por proveedor", () => {
    const pasos = sinComentarios(leer("panel-compra-por-pasos.tsx"));
    for (const requerido of ["BloqueDeReparto", "registrarFacturaProveedor", "QuickCrearProducto", "listarProductosDeProveedor"]) {
      expect(pasos, requerido).toContain(requerido);
    }
  });
});

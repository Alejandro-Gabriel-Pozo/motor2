import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { CompraRegistrada } from "../../src/core/reportes/public";
import { redondearMoneda } from "../../src/core/moneda";

/**
 * Contratos compartidos, dinero: el «suman $X» de la página de Compras redondea con la función oficial (`redondearMoneda`, src/core/moneda.ts) y no con
 * `Math.round(x * 100) / 100`, que pierde los empates de medio centavo que no son exactos en binario (`1.005 * 100` da `100.49999999999999` → 1,00 en vez de 1,01).
 * Se mira el árbol que arma la página (sin dibujar), con la consulta y la sesión simuladas (mismo arnés que `compras-pagina-dia-en-la-zona.test.ts`).
 */

const mocks = vi.hoisted(() => ({ compras: [] as unknown[] }));

vi.mock("@/server/sesion/contexto", () => ({ obtenerContextoUsuario: async () => ({ usuarioId: "u1", sucursalId: "s1", empresaZonaHoraria: "America/Argentina/Buenos_Aires", db: {} }) }));
vi.mock("@/server/acceso/gate", () => ({
  requierePermisoVer: async () => ({ ok: true }),
  obtenerMiNivelPermiso: async () => ({ ver: true, editar: false }),
}));
vi.mock("@/server/consultas/reportes/compras-registradas", () => ({ listarComprasRegistradas: async () => ({ items: mocks.compras, nextCursor: null }) }));
vi.mock("@/server/actions/catalogo/proveedores", () => ({ listarProveedoresParaSelector: async () => [] }));

import ComprasRegistradasPage from "../../src/app/(app)/reportes/compras/page";

function compra(idOperacion: string, total: number, anulada = false): CompraRegistrada {
  return {
    idOperacion,
    fecha: new Date("2026-09-30T12:00:00Z"),
    proveedorId: null,
    proveedorNombre: null,
    nroFactura: null,
    cargadaPor: "a@b.c",
    detalle: null,
    total,
    haySinPrecio: false,
    anuladaEn: anulada ? new Date("2026-09-30T13:00:00Z") : null,
    anuladaPorEmail: null,
    cantidadProductos: 1,
    facturaProveedorId: null,
    renglones: [],
  };
}

function elementos(nodo: ReactNode): { tipo: unknown; props: Record<string, unknown> }[] {
  const salida: { tipo: unknown; props: Record<string, unknown> }[] = [];
  const recorrer = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(recorrer);
    if (!n || typeof n !== "object" || !("props" in n)) return;
    const el = n as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
    salida.push({ tipo: el.type, props: el.props });
    recorrer(el.props.children);
  };
  recorrer(nodo);
  return salida;
}

const textoDe = (nodo: ReactNode): string => (Array.isArray(nodo) ? nodo.map(textoDe).join("") : typeof nodo === "string" || typeof nodo === "number" ? String(nodo) : "");

async function lineaDeTotal(): Promise<string> {
  const todos = elementos(await ComprasRegistradasPage({ searchParams: Promise.resolve({}) }));
  const linea = todos.find((e) => e.tipo === "p" && textoDe(e.props.children as ReactNode).includes(" · suman "))!;
  return textoDe(linea.props.children as ReactNode);
}

describe("el total de la página de Compras redondea con la función oficial (empates de medio centavo)", () => {
  beforeEach(() => {
    mocks.compras = [];
  });

  it("el antiguo Math.round(x * 100) / 100 perdía estos empates; redondearMoneda no (la premisa del caso)", () => {
    expect(Math.round(1.005 * 100) / 100).toBe(1);
    expect(redondearMoneda(1.005)).toBe(1.01);
    expect(Math.round(128.045 * 100) / 100).toBe(128.04);
    expect(redondearMoneda(128.045)).toBe(128.05);
  });

  it("una compra de 1,005 suma $1,01 (no $1)", async () => {
    mocks.compras = [compra("op1", 1.005)];
    expect(await lineaDeTotal()).toContain("suman $1,01");
  });

  it("una compra de 128,045 suma $128,05 (no $128,04)", async () => {
    mocks.compras = [compra("op1", 128.045)];
    expect(await lineaDeTotal()).toContain("suman $128,05");
  });

  it("las compras anuladas siguen sin sumar y el total de enteros no cambia", async () => {
    mocks.compras = [compra("op1", 1000), compra("op2", 2500), compra("op3", 999999, true)];
    const linea = await lineaDeTotal();
    expect(linea).toContain("suman $3.500");
    expect(linea).toContain("sin contar 1 anulada(s)");
  });
});

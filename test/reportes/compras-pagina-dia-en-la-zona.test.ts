import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { CompraRegistrada } from "../../src/core/reportes/public";

/**
 * P1, paso 5 (la página de Compras): el día de una compra (y de su anulación) se lee en la zona de la empresa (`ctx.empresaZonaHoraria`), el mismo corte del filtro; el vencimiento
 * del LOTE es una fecha de solo día (00:00 UTC) y se sigue leyendo en UTC: en zona argentina un `toISOString` mal cambiado por `diaDeCalendario(f, zona)` lo mostraría un día antes.
 * Se mira el árbol que arma la página (sin dibujar), con la consulta y la sesión simuladas.
 */

const mocks = vi.hoisted(() => ({ zona: "America/Argentina/Buenos_Aires", compras: [] as unknown[], zonaPasada: undefined as unknown }));

vi.mock("@/server/sesion/contexto", () => ({ obtenerContextoUsuario: async () => ({ usuarioId: "u1", sucursalId: "s1", empresaZonaHoraria: mocks.zona, db: {} }) }));
vi.mock("@/server/acceso/gate", () => ({
  requierePermisoVer: async () => ({ ok: true }),
  obtenerMiNivelPermiso: async () => ({ ver: true, editar: false }),
}));
vi.mock("@/server/consultas/reportes/compras-registradas", () => ({
  listarComprasRegistradas: async (_sucursalId: string, _filtro: unknown, _db: unknown, zona: unknown) => {
    mocks.zonaPasada = zona;
    return { items: mocks.compras, nextCursor: null };
  },
}));
vi.mock("@/server/actions/catalogo/proveedores", () => ({ listarProveedoresParaSelector: async () => [] }));

import ComprasRegistradasPage from "../../src/app/(app)/reportes/compras/page";

const NOCHE_DEL_30 = new Date("2026-09-30T22:30:00-03:00"); // 01:30Z del 1/10

function compra(): CompraRegistrada {
  return {
    idOperacion: "op1",
    fecha: NOCHE_DEL_30,
    proveedorId: null,
    proveedorNombre: null,
    nroFactura: null,
    cargadaPor: "a@b.c",
    detalle: null,
    total: 10,
    haySinPrecio: false,
    anuladaEn: NOCHE_DEL_30,
    anuladaPorEmail: null,
    cantidadProductos: 1,
    facturaProveedorId: null,
    renglones: [
      {
        idMovimiento: "m1",
        productoCodigo: "P1",
        productoNombre: "Harina",
        cantidad: 1,
        unidad: "kg",
        loteVencimiento: new Date("2026-10-01"), // fecha de solo día
        precioTotal: 10,
        precioPorUnidadStock: 10,
        seccionNombre: "Cocina",
      },
    ],
  };
}

/** Todos los elementos del árbol (tipo y props). */
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

describe("la página de Compras muestra el día en la zona de la empresa (P1, paso 5)", () => {
  beforeEach(() => {
    mocks.zona = "America/Argentina/Buenos_Aires";
    mocks.compras = [compra()];
    mocks.zonaPasada = undefined;
  });

  it("la compra de las 22:30 del 30/9 se ve el 30/9 (y su anulación también), y el lote que vence el 1/10 sigue diciendo 1/10", async () => {
    const arbol = await ComprasRegistradasPage({ searchParams: Promise.resolve({}) });
    const todos = elementos(arbol);

    const fila = todos.find((e) => e.props.className === "w-24 tabular-nums")!;
    expect(textoDe(fila.props.children as ReactNode)).toBe("2026-09-30");

    const marcaAnulada = todos.find((e) => typeof e.props.title === "string" && e.props.title.startsWith("Anulada el "))!;
    expect(marcaAnulada.props.title).toContain("Anulada el 2026-09-30");

    const celdaLote = todos.filter((e) => e.tipo === "td").map((e) => textoDe(e.props.children as ReactNode));
    expect(celdaLote).toContain("2026-10-01");

    // La página le pasa la zona de la empresa a la consulta.
    expect(mocks.zonaPasada).toBe("America/Argentina/Buenos_Aires");
  });

  it("con otra zona de empresa el día cambia (Tokio: 10:30 del 1/10) y la consulta recibe esa zona", async () => {
    mocks.zona = "Asia/Tokyo";
    const todos = elementos(await ComprasRegistradasPage({ searchParams: Promise.resolve({}) }));
    expect(textoDe(todos.find((e) => e.props.className === "w-24 tabular-nums")!.props.children as ReactNode)).toBe("2026-10-01");
    expect(mocks.zonaPasada).toBe("Asia/Tokyo");
  });
});

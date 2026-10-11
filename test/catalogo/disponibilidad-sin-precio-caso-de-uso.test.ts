import { describe, expect, it } from "vitest";

import { actualizarDisponibilidadProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/actualizar-disponibilidad-producto";

/**
 * D4 sobre el caso de uso SOLO (sin base de datos: la transacción es un doble que anota qué se hizo y en qué orden). Complementa a `disponibilidad-de-producto-sin-precio.test.ts` (contra Postgres, por la
 * Server Action y con la carrera real): acá se fijan la regla, el motivo del rechazo y que la fila del producto se toma (`FOR UPDATE`) ANTES de leer el precio.
 */
type Producto = { id: string; nombre: string; tipo: "PV" | "MP"; precioVenta: number };

function armar(producto: Producto | null, disponibleAntes: boolean | null) {
  const pasos: string[] = [];
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray) => {
      pasos.push(`SQL ${sql.join("?").replace(/\s+/g, " ").trim()}`);
      return [];
    },
    producto: {
      findUnique: async () => {
        pasos.push("leer producto");
        return producto === null ? null : { ...producto, precioVenta: { valueOf: () => producto.precioVenta, toNumber: () => producto.precioVenta, toString: () => String(producto.precioVenta) } };
      },
    },
    disponibilidadProducto: {
      findUnique: async () => (disponibleAntes === null ? null : { disponible: disponibleAntes }),
      upsert: async (args: { update: { disponible: boolean } }) => {
        pasos.push(`escribir disponible=${args.update.disponible}`);
      },
    },
    // Las lecturas de `dependenciasParaDesactivar` (al apagar): nada depende del producto.
    recetaIngrediente: { findMany: async () => [] },
    recetaVersion: { findMany: async () => [] },
    recetaSucursal: { findMany: async () => [] },
    movimientoStock: { groupBy: async () => [] },
    registroAuditoria: {
      create: async () => {
        pasos.push("auditar");
      },
    },
  };
  const actor = {
    usuarioId: "u1",
    sucursalId: "s1",
    sucursalNombre: "Central",
    transaccion: (async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) as never,
  };
  return { actor, pasos };
}
const pedir = (producto: Producto | null, disponibleAntes: boolean | null, comando: { disponible: boolean; puedeEditarCamposSensibles: boolean }) => {
  const { actor, pasos } = armar(producto, disponibleAntes);
  return actualizarDisponibilidadProductoCasoDeUso(actor, { productoId: "p1", ...comando }).then((r) => ({ r, pasos }));
};
const pv = (precioVenta: number): Producto => ({ id: "p1", nombre: "Milanesa", tipo: "PV", precioVenta });

describe("D4 (caso de uso): activar un producto de venta sin precio exige producto_campos_sensibles", () => {
  it("sin la clave, activar un PV a $0 se rechaza con el motivo (qué falta, por qué, cómo resolverlo) y no escribe ni audita", async () => {
    const { r, pasos } = await pedir(pv(0), false, { disponible: true, puedeEditarCamposSensibles: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.codigo).toBe("SIN_PERMISO_CAMPOS_SENSIBLES");
    expect(r.mensaje).toContain('"Milanesa"');
    expect(r.mensaje).toContain("no tiene precio");
    expect(r.mensaje).toContain("producto_campos_sensibles");
    expect(r.mensaje).toContain("Pedile a un administrador");
    expect(pasos.some((p) => p.startsWith("escribir") || p === "auditar")).toBe(false);
  });

  it("con la clave, activar un PV a $0 pasa y deja su rastro", async () => {
    const { r, pasos } = await pedir(pv(0), false, { disponible: true, puedeEditarCamposSensibles: true });
    expect(r.ok).toBe(true);
    expect(pasos).toContain("escribir disponible=true");
    expect(pasos).toContain("auditar");
  });

  it("sin la clave, activar un PV que YA tiene precio pasa", async () => {
    const { r } = await pedir(pv(4500), false, { disponible: true, puedeEditarCamposSensibles: false });
    expect(r.ok).toBe(true);
  });

  it("sin la clave, activar una MATERIA PRIMA a $0 pasa (no se vende)", async () => {
    const { r } = await pedir({ id: "p1", nombre: "Harina", tipo: "MP", precioVenta: 0 }, false, { disponible: true, puedeEditarCamposSensibles: false });
    expect(r.ok).toBe(true);
  });

  it("APAGAR no exige la clave aunque el PV esté a $0 (nada depende de él): se apaga y se audita", async () => {
    const { r, pasos } = await pedir(pv(0), true, { disponible: false, puedeEditarCamposSensibles: false });
    expect(r.ok, r.mensaje).toBe(true);
    expect(pasos).toContain("escribir disponible=false");
    expect(pasos).toContain("auditar");
  });

  it("un id inexistente sigue siendo «No se encontró el producto.»", async () => {
    const { r } = await pedir(null, null, { disponible: true, puedeEditarCamposSensibles: false });
    expect(r).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO", mensaje: "No se encontró el producto." });
  });

  it("CARRERA: la fila del producto se toma (FOR UPDATE) ANTES de leer su precio, para que un cambio de precio concurrente espere o se vea", async () => {
    const { pasos } = await pedir(pv(4500), false, { disponible: true, puedeEditarCamposSensibles: false });
    expect(pasos[0]).toMatch(/^SQL .*FROM "Producto" WHERE id = \? FOR UPDATE$/);
    expect(pasos.indexOf("leer producto")).toBeGreaterThan(0);
  });
});

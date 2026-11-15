import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProducto, type DatosProductoEdicion } from "../../src/server/actions/catalogo/productos";
import { TRATAMIENTO_DE_AUSENTE } from "../../src/server/lecturas/catalogo/completar-edicion-de-producto";

/**
 * EDICIÓN PARCIAL del producto (decisión de Pedernal DEC-0356, 13/11/2026; el dueño pidió ser iguales a Pedernal en todo, 2026-11-13), por la Server Action pública y contra Postgres real:
 * un campo AUSENTE (`undefined`) no se toca; `null` o vacío enviado a propósito sí lo borra; un valor lo actualiza.
 *
 * El ORÁCULO está escrito aparte del código, campo por campo (`ORACULO`): qué se manda y qué tiene que quedar. El guardián compara sus claves contra `TRATAMIENTO_DE_AUSENTE` (la declaración del código):
 * un campo nuevo del producto sin tratamiento declarado no compila (`satisfies Record<keyof EntradaEdicionProducto, …>`) y uno declarado «COMPLETA» sin su fila acá hace fallar este test.
 * Cada caso manda SOLO el campo bajo prueba y revisa que todas las demás columnas editables queden como estaban (lo ausente no se toca).
 */
type Fila = Record<string, unknown>;
interface Caso {
  /** Lo que manda el cliente (solo estos campos; el resto ausente). */
  enviar: (ids: Ids) => Partial<DatosProductoEdicion>;
  /** Lo que tiene que quedar en la fila, solo de esos campos (los demás, como estaban). */
  esperado: (ids: Ids) => Fila;
}
interface Ids { categoriaB: string; insumoB: string; unidadG: string; proveedorB: string }
interface Fila_Oraculo { producto: "MP" | "PV"; borra?: Caso; actualiza: Caso }

const ORACULO: Record<string, Fila_Oraculo> = {
  nombre: { producto: "MP", actualiza: { enviar: () => ({ nombre: "Renombrado" }), esperado: () => ({ nombre: "Renombrado" }) } },
  tipo: { producto: "MP", actualiza: { enviar: () => ({ tipo: "MP" }), esperado: () => ({ tipo: "MP" }) } },
  categoriaId: { producto: "MP", borra: { enviar: () => ({ categoriaId: null }), esperado: () => ({ categoriaId: null }) }, actualiza: { enviar: (i) => ({ categoriaId: i.categoriaB }), esperado: (i) => ({ categoriaId: i.categoriaB }) } },
  unidadCompraId: { producto: "MP", borra: { enviar: () => ({ unidadCompraId: null }), esperado: () => ({ unidadCompraId: null }) }, actualiza: { enviar: (i) => ({ unidadCompraId: i.unidadG }), esperado: (i) => ({ unidadCompraId: i.unidadG }) } },
  unidadStockId: { producto: "MP", actualiza: { enviar: (i) => ({ unidadStockId: i.unidadG }), esperado: (i) => ({ unidadStockId: i.unidadG }) } },
  factorConversion: { producto: "MP", actualiza: { enviar: () => ({ factorConversion: 2 }), esperado: () => ({ factorConversion: 2 }) } },
  observaciones: { producto: "MP", borra: { enviar: () => ({ observaciones: null }), esperado: () => ({ observaciones: null }) }, actualiza: { enviar: () => ({ observaciones: "Otra nota" }), esperado: () => ({ observaciones: "Otra nota" }) } },
  insumoId: { producto: "MP", borra: { enviar: () => ({ insumoId: null }), esperado: () => ({ insumoId: null }) }, actualiza: { enviar: (i) => ({ insumoId: i.insumoB }), esperado: (i) => ({ insumoId: i.insumoB }) } },
  precioVenta: { producto: "PV", actualiza: { enviar: () => ({ precioVenta: 2000, precioVentaVisto: 1500 }), esperado: () => ({ precioVenta: 2000 }) } },
  pasoVenta: { producto: "PV", borra: { enviar: () => ({ pasoVenta: null }), esperado: () => ({ pasoVenta: null }) }, actualiza: { enviar: () => ({ pasoVenta: 0.25 }), esperado: () => ({ pasoVenta: 0.25 }) } },
  seProduce: { producto: "PV", actualiza: { enviar: () => ({ seProduce: false }), esperado: () => ({ seProduce: false }) } },
  esConsignacion: { producto: "MP", actualiza: { enviar: () => ({ esConsignacion: false }), esperado: () => ({ esConsignacion: false }) } },
  proveedorConsignacionId: { producto: "MP", borra: { enviar: () => ({ esConsignacion: false, proveedorConsignacionId: null }), esperado: () => ({ esConsignacion: false, proveedorConsignacionId: null }) }, actualiza: { enviar: (i) => ({ proveedorConsignacionId: i.proveedorB }), esperado: (i) => ({ proveedorConsignacionId: i.proveedorB }) } },
  precioConsignacion: { producto: "MP", actualiza: { enviar: () => ({ precioConsignacion: 80 }), esperado: () => ({ precioConsignacion: 80 }) } },
};

const COLUMNAS = ["nombre", "tipo", "categoriaId", "unidadCompraId", "unidadStockId", "factorConversion", "observaciones", "insumoId", "precioVenta", "pasoVenta", "seProduce", "esConsignacion", "proveedorConsignacionId", "precioConsignacion"] as const;
const comoNumero = new Set(["factorConversion", "precioVenta", "pasoVenta", "precioConsignacion"]);

describe("edición parcial del producto (DEC-0356 de Pedernal)", () => {
  let ids: Ids & { unidadKg: string; categoriaA: string; insumoA: string; proveedorA: string; mp: string; pv: string };
  let n = 0;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const [kg, g] = await Promise.all([
      prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } }),
      prisma.unidad.create({ data: { nombre: "g", magnitud: "PESO", decimales: 2 } }),
    ]);
    const [categoriaA, categoriaB] = await Promise.all([prisma.categoriaProducto.create({ data: { nombre: "Almacén" } }), prisma.categoriaProducto.create({ data: { nombre: "Carnes" } })]);
    const [insumoA, insumoB] = await Promise.all([prisma.insumo.create({ data: { nombre: "Harina" } }), prisma.insumo.create({ data: { nombre: "Sal" } })]);
    const [proveedorA, proveedorB] = await Promise.all([
      prisma.proveedor.create({ data: { codigo: "PRV_A", nombre: "Proveedor A" } }),
      prisma.proveedor.create({ data: { codigo: "PRV_B", nombre: "Proveedor B" } }),
    ]);
    const mp = await sembrarProductoDisponible(
      {
        codigo: `MP_EP_${n++}`, nombre: "Harina leudante", tipo: "MP", unidadStockId: kg.id, unidadCompraId: kg.id, factorConversion: 1, categoriaId: categoriaA.id, insumoId: insumoA.id,
        observaciones: "Una nota", esConsignacion: true, proveedorConsignacionId: proveedorA.id, precioConsignacion: 50,
      },
      base.sucursal.id,
    );
    const pv = await sembrarProductoDisponible(
      { codigo: `PV_EP_${n++}`, nombre: "Pizza", tipo: "PV", unidadStockId: kg.id, factorConversion: 1, categoriaId: categoriaA.id, precioVenta: 1500, pasoVenta: 0.5, seProduce: true, observaciones: "Otra nota" },
      base.sucursal.id,
    );
    ids = { unidadKg: kg.id, unidadG: g.id, categoriaA: categoriaA.id, categoriaB: categoriaB.id, insumoA: insumoA.id, insumoB: insumoB.id, proveedorA: proveedorA.id, proveedorB: proveedorB.id, mp: mp.id, pv: pv.id };
  });

  const leer = async (id: string): Promise<Fila> => {
    const fila = (await prisma.producto.findUniqueOrThrow({ where: { id } })) as unknown as Fila;
    const r: Fila = {};
    for (const c of COLUMNAS) r[c] = comoNumero.has(c) && fila[c] !== null ? Number(fila[c]) : fila[c];
    return r;
  };
  const idDe = (p: "MP" | "PV") => (p === "MP" ? ids.mp : ids.pv);
  const filasDeAuditoria = () => prisma.registroAuditoria.count();

  it("guardián: el oráculo declara exactamente los campos que el código completa con lo guardado", () => {
    const completan = Object.entries(TRATAMIENTO_DE_AUSENTE).filter(([, t]) => t === "COMPLETA").map(([c]) => c).sort();
    expect(Object.keys(ORACULO).sort()).toEqual(completan);
    expect([...COLUMNAS].sort()).toEqual(completan);
  });

  for (const campo of Object.keys(ORACULO)) {
    const caso = ORACULO[campo]!;
    describe(`campo «${campo}»`, () => {
      it("ausente: no se toca (se edita otra cosa y este queda como estaba)", async () => {
        const id = idDe(caso.producto);
        const antes = await leer(id);
        const r = await actualizarProducto(id, caso.producto === "MP" ? { observaciones: "Cambiada" } : { pasoVenta: 0.25 });
        expect(r.ok, JSON.stringify(r)).toBe(true);
        const despues = await leer(id);
        const tocado = caso.producto === "MP" ? "observaciones" : "pasoVenta";
        for (const c of COLUMNAS) if (c !== tocado) expect(despues[c], c).toEqual(antes[c]);
      });

      if (caso.borra) {
        it("null enviado a propósito: lo borra, y las demás columnas quedan como estaban", async () => {
          const id = idDe(caso.producto);
          const antes = await leer(id);
          const r = await actualizarProducto(id, caso.borra!.enviar(ids));
          expect(r.ok, JSON.stringify(r)).toBe(true);
          expect(await leer(id)).toEqual({ ...antes, ...caso.borra!.esperado(ids) });
        });
      }

      it("valor enviado: lo actualiza, y las demás columnas quedan como estaban", async () => {
        const id = idDe(caso.producto);
        const antes = await leer(id);
        const r = await actualizarProducto(id, caso.actualiza.enviar(ids));
        expect(r.ok, JSON.stringify(r)).toBe(true);
        expect(await leer(id)).toEqual({ ...antes, ...caso.actualiza.esperado(ids) });
      });
    });
  }

  it("una edición vacía ({}) no cambia nada y no deja filas de auditoría", async () => {
    const antes = { mp: await leer(ids.mp), pv: await leer(ids.pv), auditoria: await filasDeAuditoria() };
    for (const id of [ids.mp, ids.pv]) expect((await actualizarProducto(id, {})).ok).toBe(true);
    expect({ mp: await leer(ids.mp), pv: await leer(ids.pv), auditoria: await filasDeAuditoria() }).toEqual(antes);
  });

  it("repetir el mismo pedido es idempotente: mismo resultado y ninguna fila de auditoría nueva", async () => {
    const pedido: Partial<DatosProductoEdicion> = { categoriaId: ids.categoriaB, observaciones: null, unidadCompraId: null };
    expect((await actualizarProducto(ids.mp, pedido)).ok).toBe(true);
    const unaVez = { fila: await leer(ids.mp), auditoria: await filasDeAuditoria() };
    expect((await actualizarProducto(ids.mp, pedido)).ok).toBe(true);
    expect({ fila: await leer(ids.mp), auditoria: await filasDeAuditoria() }).toEqual(unaVez);
  });

  it("dos ediciones a la vez sobre campos distintos: se aplican las dos (no se pisan lo que no mandaron)", async () => {
    for (let i = 0; i < 6; i++) {
      const [a, b] = await Promise.all([
        actualizarProducto(ids.mp, { categoriaId: i % 2 === 0 ? ids.categoriaB : ids.categoriaA }),
        actualizarProducto(ids.mp, { observaciones: `Nota ${i}` }),
      ]);
      expect(a.ok, JSON.stringify(a)).toBe(true);
      expect(b.ok, JSON.stringify(b)).toBe(true);
      const fila = await leer(ids.mp);
      expect(fila.categoriaId).toBe(i % 2 === 0 ? ids.categoriaB : ids.categoriaA);
      expect(fila.observaciones).toBe(`Nota ${i}`);
    }
  });

  it("dos ediciones a la vez del precio con el mismo precio visto: gana una y la otra recibe el aviso de hoy (PRECIO_DESACTUALIZADO)", async () => {
    const [a, b] = await Promise.all([
      actualizarProducto(ids.pv, { precioVenta: 1800, precioVentaVisto: 1500 }),
      actualizarProducto(ids.pv, { precioVenta: 1900, precioVentaVisto: 1500 }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const rechazada = a.ok ? b : a;
    expect(rechazada.ok).toBe(false);
    expect(!rechazada.ok && rechazada.mensaje).toContain("mientras lo editabas");
    expect([1800, 1900]).toContain((await leer(ids.pv)).precioVenta);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto, type DatosProducto } from "../../src/server/actions/catalogo/productos";
import { CLASES_DE_ALTA } from "../../src/core/catalogo/public";
import { ALTAS_ESPERADAS } from "./precio-fuera-del-alta.reglas";

/**
 * Frente 2: el precio sale del alta (`docs/diseno-precio-fuera-del-alta-2026-11-17.md`; pedido del dueño, 2026-11-17: «No, el precio donde lo pide... Donde lo pide Pedernal.»; A1). Contra Postgres real.
 * Qué fija: (a) un producto de venta SIN precio nace NO disponible en la sucursal, con y sin la clave `producto_campos_sensibles`; (b) uno CON precio (solo con la clave) nace disponible; (c) MP, Insumo y
 * Elaborado siguen naciendo disponibles; (d) la tabla de combinaciones (clase × clave × trae precio) contra el oráculo escrito aparte; (e) repetir el alta no duplica; (f) dos altas simultáneas dejan UNO.
 */
describe("el alta de un producto de venta sin precio nace no disponible (Frente 2, A1)", () => {
  let sucursalId: string;
  let kgId: string;
  let conClaveId: string;
  let sinClaveId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const pedido = (nombre: string, clase: keyof typeof CLASES_DE_ALTA, extra: Partial<DatosProducto> = {}): DatosProducto => ({
    nombre, tipo: CLASES_DE_ALTA[clase].tipo, seProduce: CLASES_DE_ALTA[clase].seProduce, claseDeUso: clase, unidadStockId: kgId, factorConversion: 1, ...extra,
  } as DatosProducto);
  const filas = async (nombre: string) => {
    const p = await prisma.producto.findFirstOrThrow({ where: { nombre } });
    return prisma.disponibilidadProducto.findMany({ where: { productoId: p.id, sucursalId } });
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    kgId = (await sembrarCatalogoBase()).kg.id;
    conClaveId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    sinClaveId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
  });
  const actuar = (conClave: boolean) => (conClave ? como(conClaveId, "admin@test.com") : como(sinClaveId, "operador@test.com"));

  it.each(ALTAS_ESPERADAS.map((f) => [`${f.clase} ${f.conClave ? "con" : "sin"} clave ${f.traePrecio ? "con" : "sin"} precio`, f] as const))("%s", async (_n, f) => {
    await actuar(f.conClave);
    const r = await darDeAltaProducto(pedido("Producto X", f.clase, f.traePrecio ? { precioVenta: 4500 } : {}));
    if (f.disponible === null) {
      expect(r.ok).toBe(false);
      expect(await prisma.producto.count({ where: { nombre: "Producto X" } })).toBe(0);
      return;
    }
    expect(r.ok, r.mensaje).toBe(true);
    const d = await filas("Producto X");
    expect(d.map((x) => x.disponible)).toEqual([f.disponible]);
  });

  it("un PV con la clave y precio ausente (el alta de la pantalla) o 0 nace NO disponible, con el precio guardado en 0", async () => {
    await actuar(true);
    expect((await darDeAltaProducto(pedido("Sin precio", "VENDIBLE"))).ok).toBe(true);
    expect((await darDeAltaProducto(pedido("Cero", "VENDIBLE", { precioVenta: 0 }))).ok).toBe(true);
    for (const n of ["Sin precio", "Cero"]) {
      expect((await filas(n)).every((x) => x.disponible === false), n).toBe(true);
      expect(Number((await prisma.producto.findFirstOrThrow({ where: { nombre: n } })).precioVenta)).toBe(0);
    }
  });

  it("el mensaje de un PV sin precio con la clave es el de siempre («creado con precio $0…»)", async () => {
    await actuar(true);
    const r = await darDeAltaProducto(pedido("Sin precio", "VENDIBLE"));
    expect(r.mensaje).toContain("creado con precio $0");
  });

  it("IDEMPOTENCIA: repetir el alta de un PV sin precio no crea otro", async () => {
    await actuar(true);
    expect((await darDeAltaProducto(pedido("Doble clic", "VENDIBLE"))).ok).toBe(true);
    expect((await darDeAltaProducto(pedido("Doble clic", "VENDIBLE"))).ok).toBe(false);
    expect(await prismaAdmin.producto.count({ where: { nombre: "Doble clic" } })).toBe(1);
  });

  it("CONCURRENCIA: dos altas simultáneas del mismo PV sin precio dejan UNO, no disponible", async () => {
    await actuar(true);
    const [a, b] = await Promise.all([darDeAltaProducto(pedido("Carrera", "VENDIBLE")), darDeAltaProducto(pedido("Carrera", "VENDIBLE"))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await prismaAdmin.producto.count({ where: { nombre: "Carrera" } })).toBe(1);
    expect((await filas("Carrera")).every((x) => x.disponible === false)).toBe(true);
  });
});

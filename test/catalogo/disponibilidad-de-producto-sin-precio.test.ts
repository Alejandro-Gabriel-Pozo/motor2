import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarDisponibilidadProducto } from "../../src/server/actions/catalogo/productos";

/**
 * D4 (decisión del dueño, 2026-10-11): activar —poner a la venta— un producto de venta SIN precio definido (hoy: `precioVenta` en 0) exige `producto_campos_sensibles`; quien solo tiene
 * `producto_disponibilidad` puede prender y apagar productos que YA tienen precio. El candado de M.2 hace que un PV creado sin la clave nazca a $0 y apagado, pero la activación no miraba el precio:
 * el operador (que tiene `producto_disponibilidad` y no la clave fina) lo ponía a la venta a $0. La decide el servidor, dentro de la transacción del caso de uso.
 */
describe("D4: poner a la venta un producto de venta sin precio exige producto_campos_sensibles", () => {
  let sucursalId: string;
  let kgId: string;
  let adminId: string;
  let operadorId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  async function producto(extra: { tipo?: "PV" | "MP"; precioVenta: number; disponible: boolean; codigo?: string; nombre?: string }) {
    const p = await prisma.producto.create({
      data: { codigo: extra.codigo ?? "PV_D4", nombre: extra.nombre ?? "Milanesa", tipo: extra.tipo ?? "PV", unidadStockId: kgId, precioVenta: extra.precioVenta },
    });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: extra.disponible } });
    return p.id;
  }
  const disponibleAca = async (productoId: string) => (await prisma.disponibilidadProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } }))?.disponible;
  const auditoria = (productoId: string) => prisma.registroAuditoria.count({ where: { entidad: "DisponibilidadProducto", entidadId: `${sucursalId}:${productoId}` } });
  const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    kgId = (await sembrarCatalogoBase()).kg.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    await como(operadorId, "operador@test.com");
  });

  it("EL DEFECTO: el operador (producto_disponibilidad sin la clave fina) NO puede poner a la venta un PV a $0: dice qué falta, por qué y cómo resolverlo, y no escribe nada", async () => {
    const id = await producto({ precioVenta: 0, disponible: false });
    const r = await actualizarDisponibilidadProducto(id, true);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("Milanesa");
    expect(r.mensaje).toContain("no tiene precio");
    expect(r.mensaje).toContain("producto_campos_sensibles");
    expect(r.mensaje).toContain("administrador");
    expect(await disponibleAca(id)).toBe(false);
    expect(await auditoria(id)).toBe(0);
  });

  it("también cuando todavía no hay fila de disponibilidad en la sucursal (fila ausente = no disponible)", async () => {
    const id = await producto({ precioVenta: 0, disponible: false });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: id } });
    expect((await actualizarDisponibilidadProducto(id, true)).ok).toBe(false);
    expect(await prisma.disponibilidadProducto.count({ where: { productoId: id } })).toBe(0);
  });

  it("CON la clave (el administrador) sí lo pone a la venta a $0, con su auditoría", async () => {
    const id = await producto({ precioVenta: 0, disponible: false });
    await como(adminId, "admin@test.com");
    const r = await actualizarDisponibilidadProducto(id, true);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await disponibleAca(id)).toBe(true);
    expect(await auditoria(id)).toBe(1);
  });

  it("el operador sigue prendiendo y apagando un PV que YA tiene precio", async () => {
    const id = await producto({ precioVenta: 4500, disponible: false });
    expect((await actualizarDisponibilidadProducto(id, true)).ok).toBe(true);
    expect(await disponibleAca(id)).toBe(true);
    expect((await actualizarDisponibilidadProducto(id, false)).ok).toBe(true);
    expect(await disponibleAca(id)).toBe(false);
  });

  it("APAGAR nunca exige la clave: el operador apaga un PV que quedó a la venta a $0", async () => {
    const id = await producto({ precioVenta: 0, disponible: true });
    const r = await actualizarDisponibilidadProducto(id, false);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await disponibleAca(id)).toBe(false);
  });

  it("una MATERIA PRIMA a $0 (no se vende: no hay precio que exigir) la prende el operador como siempre", async () => {
    const id = await producto({ tipo: "MP", precioVenta: 0, disponible: false, codigo: "MP_D4", nombre: "Harina" });
    expect((await actualizarDisponibilidadProducto(id, true)).ok).toBe(true);
    expect(await disponibleAca(id)).toBe(true);
  });

  it("el pedido «prender» sobre un PV que ya está a la venta a $0 (legado) se decide igual que sobre uno apagado: sin la clave, no", async () => {
    const id = await producto({ precioVenta: 0, disponible: true });
    expect((await actualizarDisponibilidadProducto(id, true)).ok).toBe(false);
  });

  describe("concurrencia: cambiar el precio a $0 y prender a la vez no deja un PV vendible a $0 sin la clave", () => {
    it("EL DEFECTO: otra persona (con la clave) baja el precio a $0 y todavía no confirmó; el operador pide prenderlo → espera a esa transacción, ve el $0 y lo rechaza", async () => {
      const id = await producto({ precioVenta: 4500, disponible: false });
      let soltar!: () => void;
      const confirmar = new Promise<void>((r) => (soltar = r));
      let tomada!: () => void;
      const filaTomada = new Promise<void>((r) => (tomada = r));
      // La transacción del administrador baja el precio y se queda con la fila tomada hasta que se le avise.
      const cambioDePrecio = prismaAdmin.$transaction(async (tx) => {
        await tx.producto.update({ where: { id }, data: { precioVenta: 0 } });
        tomada();
        await confirmar;
      });
      await filaTomada;
      const activacion = actualizarDisponibilidadProducto(id, true);
      const mientras = await Promise.race([activacion.then(() => "terminó"), dormir(700).then(() => "espera")]);
      expect(mientras, "la activación tiene que esperar la fila (candado), no decidir con un precio que está por cambiar").toBe("espera");
      soltar();
      await cambioDePrecio;
      const r = await activacion;
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("no tiene precio");
      expect(await disponibleAca(id)).toBe(false);
      expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id } })).precioVenta)).toBe(0);
    });
  });
});

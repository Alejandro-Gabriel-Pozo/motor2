import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";

/**
 * El vínculo proveedor↔producto de una Compra va DENTRO de la transacción SERIALIZABLE (decisión del dueño, 2026-10-06). Su escritura es un `INSERT … ON CONFLICT DO UPDATE` sobre
 * una fila de la EMPRESA (no de la sucursal): dos compras simultáneas del mismo producto, proveedor y unidad —aunque sean de sucursales distintas— chocan sobre la misma fila y la base
 * aborta una con un error de serialización (40001). El grounding contra Odoo/ERPNext/Dolibarr (hallazgo H3) pidió demostrar, ANTES de fusionar, que ese error llega con una forma que
 * `conTransaccionSerializable` reconoce y reintenta, y no como un 500 (`P2010`, «raw query failed», no está manejado). Estas pruebas lo ejercitan contra Postgres real.
 */
describe("vínculo proveedor↔producto: dos compras simultáneas de sucursales distintas sobre la misma fila", () => {
  it("terminan las dos, sin error, con UNA sola fila y el precio de la más reciente", async () => {
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      await limpiarBaseDeTest();
      const base = await sembrarBase();
      const catalogo = await sembrarCatalogoBase();
      await sembrarMotivosYDestinos();
      const sucursalA = base.sucursal.id;
      const sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
      const seccionA = (await sembrarSeccion(sucursalA, "Depósito A")).id;
      const seccionB = (await sembrarSeccion(sucursalB, "Depósito B")).id;
      const usuarioA = await crearUsuarioConMembresia({ email: "a@test.com", sucursalId: sucursalA, rolId: base.admin.id });
      const usuarioB = await crearUsuarioConMembresia({ email: "b@test.com", sucursalId: sucursalB, rolId: base.admin.id });
      const producto = await sembrarProductoDisponible({ codigo: "MP_ACEITE", nombre: "Aceite", tipo: "MP", unidadStockId: catalogo.kg.id, unidadCompraId: catalogo.kg.id }, sucursalA);
      await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalB, productoId: producto.id, disponible: true } });
      const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_CONC", nombre: "Proveedor concurrente" } });

      const actor = (usuarioId: string, sucursalId: string, sucursalNombre: string) => ({
        usuarioId,
        sucursalId,
        sucursalNombre,
        db: prisma,
        transaccion: ((fn: Parameters<typeof prisma.$transaction>[0], opciones?: object) => prisma.$transaction(fn as never, opciones as never)) as never,
      });
      const compra = (seccionId: string, precioTotal: number, fecha: string) => ({
        proceso: "COMPRA" as const,
        fecha: new Date(fecha),
        seccionId,
        proveedorId: proveedor.id,
        items: [{ productoId: producto.id, cantidad: 10, precioTotal }],
      });

      const resultados = await Promise.allSettled([
        registrarMovimientoCasoDeUso(actor(usuarioA.id, sucursalA, "Central"), compra(seccionA, 1000, "2026-09-20")),
        registrarMovimientoCasoDeUso(actor(usuarioB.id, sucursalB, "Norte"), compra(seccionB, 1500, "2026-09-21")),
      ]);

      const detalle = resultados.map((r) => (r.status === "fulfilled" ? JSON.stringify(r.value) : `RECHAZADA: name=${(r.reason as Error)?.name} code=${(r.reason as { code?: string })?.code} msg=${(r.reason as Error)?.message} meta=${JSON.stringify((r.reason as { meta?: unknown })?.meta)} cause=${JSON.stringify((r.reason as { cause?: unknown })?.cause, Object.getOwnPropertyNames((r.reason as { cause?: object })?.cause ?? {}))}`)).join(" | ");
      expect(resultados.every((r) => r.status === "fulfilled"), `vuelta ${vuelta}: ${detalle}`).toBe(true);
      expect(resultados.every((r) => r.status === "fulfilled" && r.value.ok), `vuelta ${vuelta}: ${detalle}`).toBe(true);

      const filas = await prisma.proveedorPorProducto.findMany({ where: { productoId: producto.id } });
      expect(filas, `vuelta ${vuelta}`).toHaveLength(1);
      // Gana la compra de fecha más reciente (21/09, $150 el kg), cualquiera haya sido el orden en que se confirmaron.
      expect(filas[0]!.ultimaCompra.toISOString().slice(0, 10), `vuelta ${vuelta}`).toBe("2026-09-21");
      expect(Number(filas[0]!.precioPorUnidadStock), `vuelta ${vuelta}`).toBe(150);
      expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } }), `vuelta ${vuelta}: una Operación por compra`).toBe(2);
    }
  }, 180_000);
});

import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { registrarVinculoDeCompraEnTx } from "../../src/server/actions/catalogo/casos-de-uso/registrar-vinculo-de-compra-en-tx";

/**
 * Fase 2b, D2 (DEC-36): el vínculo proveedor↔producto de una Compra es un COMANDO de Catálogo (`registrarVinculoDeCompraEnTx`) que el registro de la compra de Movimientos
 * invoca dentro de SU transacción. Acá se prueba el comando solo: escribe el vínculo con el cliente de la transacción de quien llama, así que si esa transacción se cae no queda nada.
 * Poda (2026-11-06): ya no guarda el precio ni deja auditoría de él. (Que la compra lo invoque de punta a punta: `test/movimientos/compra-sin-precio-en-el-vinculo.test.ts`.)
 */
describe("registrarVinculoDeCompraEnTx: el vínculo, en la transacción de quien llama", () => {
  let sucursalId: string;
  let productoId: string;
  let proveedorId: string;
  let unidadCompraId: string;

  const linea = () => ({ productoId, proveedorId, unidadCompraId, fechaCompra: new Date("2026-09-10T12:00:00Z"), referenciaProveedor: "HAR-25" });
  const vinculos = () => prisma.proveedorPorProducto.findMany({ where: { productoId, proveedorId } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadCompraId = catalogo.kg.id;
    productoId = (await sembrarProductoDisponible({ codigo: "MP_VINC", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_VINC", nombre: "Molino" } })).id;
  });

  it("con la transacción confirmada: el vínculo con su unidad, referencia y fecha, sin precio y sin fila de auditoría", async () => {
    await prisma.$transaction((tx) => registrarVinculoDeCompraEnTx(tx, linea()));

    const filas = await vinculos();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ unidadCompraId, referenciaProveedor: "HAR-25" });
    expect(filas[0]!.ultimaCompra.toISOString()).toBe("2026-09-10T12:00:00.000Z");
    expect([Number(filas[0]!.precioUnitario), Number(filas[0]!.precioPorUnidadStock)]).toEqual([0, 0]);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "ProveedorPorProducto" } })).toBe(0);
  });

  it("si la transacción de quien llama se cae después, no queda el vínculo (va con el cliente de esa transacción)", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await registrarVinculoDeCompraEnTx(tx, linea());
        throw new Error("falla la compra después del vínculo");
      })
    ).rejects.toThrow("falla la compra después del vínculo");

    expect(await vinculos()).toEqual([]);
  });
});

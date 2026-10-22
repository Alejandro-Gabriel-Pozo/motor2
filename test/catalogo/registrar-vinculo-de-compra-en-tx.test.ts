import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { registrarVinculoDeCompraEnTx } from "../../src/server/actions/catalogo/casos-de-uso/registrar-vinculo-de-compra-en-tx";

/**
 * Fase 2b, D2 (DEC-36): el vínculo proveedor↔producto de una Compra es un COMANDO de Catálogo (`registrarVinculoDeCompraEnTx`) que el registro de la compra de Movimientos
 * invoca dentro de SU transacción. Acá se prueba el comando solo: escribe el vínculo Y la auditoría de su precio con el cliente de la transacción de quien llama, así que
 * si esa transacción se cae no queda ninguna de las dos cosas. (Que la compra lo invoque y audite de punta a punta: `test/auditoria/vinculo-proveedor-auditado.test.ts`.)
 */
describe("registrarVinculoDeCompraEnTx: el vínculo y su auditoría, en la transacción de quien llama", () => {
  let sucursalId: string;
  let usuarioId: string;
  let productoId: string;
  let proveedorId: string;
  let unidadCompraId: string;

  const linea = (precio: number) => ({ productoId, proveedorId, unidadCompraId, precioUnitario: precio, precioPorUnidadStock: precio, fechaCompra: new Date("2026-09-10T12:00:00Z") });
  const vinculos = () => prisma.proveedorPorProducto.findMany({ where: { productoId, proveedorId } });
  const auditorias = () => prisma.registroAuditoria.findMany({ where: { entidad: "ProveedorPorProducto" } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadCompraId = catalogo.kg.id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    productoId = (await sembrarProductoDisponible({ codigo: "MP_VINC", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_VINC", nombre: "Molino" } })).id;
  });

  it("con la transacción confirmada: el vínculo y UNA fila de auditoría de su precio, de quien compró y en su sucursal", async () => {
    await prisma.$transaction((tx) => registrarVinculoDeCompraEnTx(tx, { usuarioId, sucursalId }, linea(150)));

    expect((await vinculos()).map((v) => Number(v.precioPorUnidadStock))).toEqual([150]);
    const filas = await auditorias();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ entidadId: `${productoId}:${proveedorId}:${unidadCompraId}`, campo: "precioPorUnidadStock", valorAnterior: null, valorNuevo: "150", actorId: usuarioId, sucursalId });
  });

  it("si la transacción de quien llama se cae después, no queda ni el vínculo ni su auditoría (los dos van con el cliente de esa transacción)", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await registrarVinculoDeCompraEnTx(tx, { usuarioId, sucursalId }, linea(150));
        throw new Error("falla la compra después del vínculo");
      })
    ).rejects.toThrow("falla la compra después del vínculo");

    expect(await vinculos()).toEqual([]);
    expect(await auditorias()).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, prisma } from "../setup/test-db";
import { calcularSaldoPorLote, calcularSaldoTotal, validarStockSuficiente } from "../../src/server/lecturas/movimientos/saldos";
import { listarStockParaConteo } from "../../src/server/consultas/movimientos/stock-para-conteo";

/**
 * Hallazgo O.177 (GT-3b, cerrado): los lectores del saldo y la precarga del conteo FALLAN CERRADO por sucursal. Con el `db` de la empresa
 * (la RLS separa empresas, no sucursales) y el id de una sección de OTRA sucursal de la misma empresa devolvían su saldo: ahora la sección
 * tiene que ser de la `sucursalId` que reciben (la del contexto), en el mismo `where` de la consulta. «Quien la llama ya valida» no alcanza.
 */
describe("saldos y precarga del conteo: la sección ajena (otra sucursal de la misma empresa) no devuelve nada", () => {
  let sucursalPropiaId: string;
  let sucursalAjenaId: string;
  let seccionAjenaId: string;
  let seccionPropiaId: string;
  let mpId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalPropiaId = base.sucursal.id;
    sucursalAjenaId = (await prisma.sucursal.create({ data: { nombre: "Sucursal ajena" } })).id;
    seccionPropiaId = (await sembrarSeccion(sucursalPropiaId, "Propia")).id;
    seccionAjenaId = (await sembrarSeccion(sucursalAjenaId, "Ajena")).id;
    const catalogo = await sembrarCatalogoBase();
    mpId = (await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalAjenaId, productoId: mpId, disponible: true } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalPropiaId, productoId: mpId, disponible: true } });
    const usuario = await prisma.user.create({ data: { email: "u@saldos.test" } });
    // 10 kg en la sección de la OTRA sucursal (el ataque: pedir ese saldo desde la sucursal propia).
    const operacion = await prisma.operacion.create({ data: { sucursalId: sucursalAjenaId, proceso: "AJUSTE", fecha: new Date(), usuarioId: usuario.id } });
    await prisma.movimientoStock.create({
      data: { operacionId: operacion.id, productoId: mpId, seccionId: seccionAjenaId, proceso: "AJUSTE", cantidad: 10, detalle: "AJUSTE", precioTotal: 0, precioPorUnidadStock: 0 },
    });
  });

  it("calcularSaldoTotal: con la sucursal propia y la sección ajena da 0; con la sucursal de la sección da su saldo", async () => {
    expect(await calcularSaldoTotal(mpId, seccionAjenaId, sucursalPropiaId, prisma)).toBe(0);
    expect(await calcularSaldoTotal(mpId, seccionAjenaId, sucursalAjenaId, prisma)).toBe(10);
    expect(await calcularSaldoTotal(mpId, seccionPropiaId, sucursalPropiaId, prisma)).toBe(0);
  });

  it("calcularSaldoPorLote: ídem, por lote", async () => {
    expect(await calcularSaldoPorLote(mpId, seccionAjenaId, null, sucursalPropiaId, prisma)).toBe(0);
    expect(await calcularSaldoPorLote(mpId, seccionAjenaId, null, sucursalAjenaId, prisma)).toBe(10);
  });

  it("validarStockSuficiente: la sección ajena cuenta como saldo 0 (no hay stock), sin devolver el saldo ajeno en `actual`", async () => {
    expect(await validarStockSuficiente(mpId, seccionAjenaId, 5, sucursalPropiaId, prisma)).toEqual({ ok: false, actual: 0, requerido: 5 });
    expect(await validarStockSuficiente(mpId, seccionAjenaId, 5, sucursalAjenaId, prisma)).toEqual({ ok: true, actual: 10, requerido: 5 });
  });

  it("listarStockParaConteo: la sección ajena da vacío; con la sucursal de la sección trae la fila", async () => {
    expect(await listarStockParaConteo(seccionAjenaId, sucursalPropiaId, prisma)).toEqual([]);
    const propias = await listarStockParaConteo(seccionAjenaId, sucursalAjenaId, prisma);
    expect(propias).toHaveLength(1);
    expect(propias[0]).toMatchObject({ productoId: mpId, saldoSistema: 10 });
  });
});

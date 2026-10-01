import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularStockEnTransito } from "../../src/core/stock/en-transito";
import { calcularStockConsolidado } from "../../src/core/stock/consolidado";
import {
  crearEnvioDirectoTransferencia,
  crearSolicitudTransferencia,
  aceptarTransferencia,
  rechazarTransferencia,
  confirmarReingresoTransferencia,
} from "../../src/server/actions/traspasos/traspasos";

/**
 * El stock de un traspaso ENVIADA (o RECHAZADA_DESTINO sin reingresar) ya salió del Kardex del origen y todavía no está en el del destino:
 * no suma en el consolidado de nadie. `calcularStockEnTransito` lo hace visible para que no parezca una pérdida.
 */
describe("stock en tránsito entre sucursales", () => {
  let sucursalAId: string;
  let sucursalBId: string;
  let seccionAId: string;
  let seccionBId: string;
  let mpId: string;
  let usuarioAId: string;
  let usuarioBId: string;

  const comoA = () => mockearUsuarioActual({ id: usuarioAId, email: "a@test.com", nombre: null });
  const comoB = () => mockearUsuarioActual({ id: usuarioBId, email: "b@test.com", nombre: null });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalAId = base.sucursal.id;
    sucursalBId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    const catalogo = await sembrarCatalogoBase();
    seccionAId = (await sembrarSeccion(sucursalAId, "Depósito A")).id;
    seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;
    usuarioAId = (await crearUsuarioConMembresia({ email: "a@test.com", sucursalId: sucursalAId, rolId: base.admin.id })).id;
    usuarioBId = (await crearUsuarioConMembresia({ email: "b@test.com", sucursalId: sucursalBId, rolId: base.admin.id })).id;

    const mp = await prisma.producto.create({
      data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id },
    });
    mpId = mp.id;
    await prisma.disponibilidadProducto.createMany({ data: [sucursalAId, sucursalBId].map((sucursalId) => ({ sucursalId, productoId: mp.id, disponible: true })) });
    await comoA();
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mpId, cantidad: 10 }] });
  });

  async function enviar(cantidad: number): Promise<string> {
    await comoA();
    const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mpId, cantidad, seccionOrigenId: seccionAId });
    if (!envio.ok) throw new Error(envio.mensaje);
    return envio.id;
  }

  it("sin traspasos pendientes no hay nada en tránsito", async () => {
    expect(await calcularStockEnTransito(sucursalAId, prisma)).toEqual([]);
    expect(await calcularStockEnTransito(sucursalBId, prisma)).toEqual([]);
  });

  it("un envío ENVIADA es «enviado» para el origen y «por recibir» para el destino — y el consolidado del origen ya bajó", async () => {
    await enviar(4);

    const origen = await calcularStockEnTransito(sucursalAId, prisma);
    expect(origen).toEqual([
      { productoId: mpId, productoCodigo: "MP_HARINA", productoNombre: "Harina", unidadStockNombre: "kg", porRecibir: 0, enviadoPorAceptar: 4, pendienteDeReingreso: 0 },
    ]);
    const destino = await calcularStockEnTransito(sucursalBId, prisma);
    expect(destino).toEqual([
      { productoId: mpId, productoCodigo: "MP_HARINA", productoNombre: "Harina", unidadStockNombre: "kg", porRecibir: 4, enviadoPorAceptar: 0, pendienteDeReingreso: 0 },
    ]);

    // Lo que el indicador explica: el teórico del origen ya descontó las 4 y el del destino todavía no las tiene.
    const consolidadoOrigen = await calcularStockConsolidado(sucursalAId, prisma);
    expect(consolidadoOrigen.find((f) => f.productoId === mpId)?.teorico).toBe(6);
  });

  it("al aceptar, deja de estar en tránsito (ya entró al Kardex del destino)", async () => {
    const id = await enviar(4);
    await comoB();
    expect((await aceptarTransferencia(id, seccionBId)).ok).toBe(true);

    expect(await calcularStockEnTransito(sucursalAId, prisma)).toEqual([]);
    expect(await calcularStockEnTransito(sucursalBId, prisma)).toEqual([]);
  });

  it("si el destino rechaza, queda «pendiente de reingresar» SOLO para el origen; al confirmar el reingreso desaparece", async () => {
    const id = await enviar(4);
    await comoB();
    expect((await rechazarTransferencia(id, "no lo pedimos")).ok).toBe(true);

    const origen = await calcularStockEnTransito(sucursalAId, prisma);
    expect(origen).toHaveLength(1);
    expect(origen[0]).toMatchObject({ porRecibir: 0, enviadoPorAceptar: 0, pendienteDeReingreso: 4 });
    expect(await calcularStockEnTransito(sucursalBId, prisma)).toEqual([]);

    await comoA();
    expect((await confirmarReingresoTransferencia(id)).ok).toBe(true);
    expect(await calcularStockEnTransito(sucursalAId, prisma)).toEqual([]);
  });

  it("una solicitud SOLICITADA todavía no movió stock: no cuenta", async () => {
    await comoB();
    const solicitud = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mpId, cantidad: 3, seccionDestinoId: seccionBId });
    expect(solicitud.ok, solicitud.mensaje).toBe(true);

    expect(await calcularStockEnTransito(sucursalAId, prisma)).toEqual([]);
    expect(await calcularStockEnTransito(sucursalBId, prisma)).toEqual([]);
  });

  it("suma varios traspasos del mismo producto y separa las tres columnas", async () => {
    const primero = await enviar(2);
    await enviar(3);
    await comoB();
    expect((await rechazarTransferencia(primero, "mal estado")).ok).toBe(true);

    const origen = await calcularStockEnTransito(sucursalAId, prisma);
    expect(origen).toHaveLength(1);
    expect(origen[0]).toMatchObject({ enviadoPorAceptar: 3, pendienteDeReingreso: 2, porRecibir: 0 });
  });
});

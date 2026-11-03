import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import { entrarComo, sembrarCuenta, sembrarMostrador, sembrarSalon } from "./salon-fixture";
import { abrirCuenta, corregirComensales, liberarMesa } from "../../src/server/actions/pos/cuenta-apertura";
import { obtenerMapaDeMesas } from "../../src/server/consultas/pos/mesas";
import { obtenerDetalleDeMesa } from "../../src/server/consultas/pos/detalle-de-mesa";
import { generarReporteRotacionMesas } from "../../src/server/consultas/reportes/rotacion-mesas";

/**
 * M1.3 del mostrador (ADR-039): el puesto mostrador NO es una mesa para lo que mide mesas. Se prueba con un mostrador sembrado y una cuenta abierta suya:
 *  - `abrirCuenta` (con comensales) no lo abre: es de `abrirCuentaDeMostrador`; sin comensales, `corregirComensales` lo rechaza;
 *  - no aparece en el mapa de mesas, no cambia el «siguiente número» ni las métricas, y su detalle no se lee como el de una mesa;
 *  - la rotación de mesas (que mide comensales) no lo incluye;
 *  - las mesas siguen igual (las caracterizaciones congeladas lo prueban byte a byte; acá, los casos de contraste).
 * Los filtros por tipo los fija el guardián G2 (`test/arquitectura/puesto-filtra-salon.test.ts`).
 */
describe("el puesto mostrador queda fuera de lo que mide mesas", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let mostradorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
    mostradorId = (await sembrarMostrador(s.sucursalId)).id;
  });

  it("abrirCuenta sobre el mostrador responde MESA_NO_ENCONTRADA y no escribe nada", async () => {
    const r = await abrirCuenta(mostradorId, 2);
    expect(r).toEqual({ ok: false, mensaje: "No se encontró esa mesa en esta sucursal." });
    expect(await prisma.cuenta.count({ where: { mesaId: mostradorId } })).toBe(0);
  });

  it("corregirComensales sobre una cuenta del mostrador responde «El mostrador no lleva comensales» y no escribe", async () => {
    const cuenta = await sembrarCuenta(mostradorId, s.admin.id, [], "MOSTRADOR");
    const r = await corregirComensales(cuenta.id, 3);
    expect(r).toEqual({ ok: false, mensaje: "El mostrador no lleva comensales." });
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).comensales).toBeNull();
  });

  it("una mesa sí corrige sus comensales (contraste)", async () => {
    await abrirCuenta(s.mesa.id, 2);
    const cuenta = await prisma.cuenta.findFirstOrThrow({ where: { mesaId: s.mesa.id } });
    expect(await corregirComensales(cuenta.id, 5)).toEqual({ ok: true, mensaje: "Comensales de la mesa 4 actualizados a 5." });
  });

  it("liberar una cuenta vacía del mostrador la descarta, con su propio texto", async () => {
    const cuenta = await sembrarCuenta(mostradorId, s.admin.id, [], "MOSTRADOR");
    expect(await liberarMesa(cuenta.id)).toEqual({ ok: true, mensaje: "Cuenta del mostrador descartada." });
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).not.toBeNull();
  });

  it("liberar una cuenta del mostrador con ítems se rechaza y dice «descartarla»", async () => {
    const cuenta = await sembrarCuenta(mostradorId, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 }], "MOSTRADOR");
    expect(await liberarMesa(cuenta.id)).toEqual({ ok: false, mensaje: "La cuenta del mostrador tiene ítems cargados: cerrá la cuenta en vez de descartarla." });
  });

  describe("mapa y detalle", () => {
    it("el mapa de mesas no trae el mostrador: ni la fila, ni su cuenta en las métricas, ni el «siguiente número»", async () => {
      await sembrarCuenta(mostradorId, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }], "MOSTRADOR");
      const mapa = await obtenerMapaDeMesas(s.sucursalId, prisma, new Date());
      expect(mapa.mesas.map((m) => m.numero)).toEqual([4]);
      expect(mapa.metricas).toEqual({ total: 1, libres: 1, enPedido: 0, ocupadas: 0 });
      expect(mapa.siguienteNumero).toBe(5);
    });

    it("sin ninguna mesa de salón, el mapa está vacío y la siguiente es la 1 (no la 1 por haber un mostrador)", async () => {
      await prisma.mesa.delete({ where: { id: s.mesa.id } });
      const mapa = await obtenerMapaDeMesas(s.sucursalId, prisma, new Date());
      expect(mapa).toMatchObject({ mesas: [], siguienteNumero: 1 });
    });

    it("obtenerDetalleDeMesa no lee el mostrador como una mesa (null); la mesa de salón sí", async () => {
      expect(await obtenerDetalleDeMesa(s.sucursalId, mostradorId, prisma, new Date())).toBeNull();
      expect(await obtenerDetalleDeMesa(s.sucursalId, s.mesa.id, prisma, new Date())).toMatchObject({ mesa: { id: s.mesa.id, numero: 4 } });
    });
  });

  describe("rotación de mesas", () => {
    it("las cuentas del mostrador no entran: ni la cerrada con consumo ni la abierta sin cerrar", async () => {
      const ahora = new Date();
      const cerrada = await sembrarCuenta(mostradorId, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }], "MOSTRADOR");
      await prisma.cuenta.update({ where: { id: cerrada.id }, data: { cerradaEn: new Date(ahora.getTime() + 1000), cerradaPorId: s.admin.id } });
      await sembrarCuenta(mostradorId, s.admin.id, [], "MOSTRADOR");
      const rep = await generarReporteRotacionMesas(s.sucursalId, new Date(ahora.getTime() - 86_400_000), new Date(ahora.getTime() + 86_400_000), ZONA_ARGENTINA, prisma);
      expect(rep).toMatchObject({ atendidas: 0, liberadasSinConsumo: 0, abiertasSinCerrar: 0 });
    });

    it("la cuenta de una mesa sí entra (contraste)", async () => {
      const ahora = new Date();
      await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
      await sembrarCuenta(mostradorId, s.admin.id, [], "MOSTRADOR");
      const rep = await generarReporteRotacionMesas(s.sucursalId, new Date(ahora.getTime() - 86_400_000), new Date(ahora.getTime() + 86_400_000), ZONA_ARGENTINA, prisma);
      expect(rep).toMatchObject({ abiertasSinCerrar: 1 });
    });
  });
});

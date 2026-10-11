import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarSalon } from "../pos/salon-fixture";
import { cargarHermanasDePromo, cargarVentaParaAnular } from "../../src/server/persistencia/movimientos/cargar-venta-para-anular";

/**
 * `cargarVentaParaAnular` y `cargarHermanasDePromo` leían las líneas de la venta SIN `orderBy`, y de ese orden depende el de las filas de reversión que escribe
 * la anulación: el CI (run 38096435673) vio la reversión de una Copa en consignación en otro orden que el golden de la caracterización ampliada. Ahora salen por
 * `creadoEn` y, a igualdad (las de una misma `createMany` comparten la hora), por id, sin importar el orden físico (acá se insertan con el id MAYOR primero).
 */
describe("cargarVentaParaAnular: las líneas salen en el orden en que se escribieron", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
  });

  async function ventaConLineasEmpatadas(promoCuentaId: string | null = null) {
    const venta = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id, promoCuentaId } });
    const misma = new Date("2026-03-01T12:00:00Z");
    const sufijo = venta.id.slice(-6);
    // Insertadas con el id mayor primero: en el disco quedan al revés de su orden por id.
    for (const [id, productoId] of [[`cz${sufijo}zzzzzzzzzzzzzzzz`, s.flan.id], [`cm${sufijo}mmmmmmmmmmmmmmmm`, s.milanesa.id], [`ca${sufijo}aaaaaaaaaaaaaaaa`, s.muzzarella.id]] as const) {
      await prisma.movimientoStock.create({
        data: { id, operacionId: venta.id, productoId, seccionId: s.seccion.id, proceso: "VENTA", cantidad: -1, detalle: "x", precioTotal: 0, precioPorUnidadStock: 0, creadoEn: misma },
      });
    }
    return venta;
  }

  it("cargarVentaParaAnular: por hora y, a igualdad, por id", async () => {
    const venta = await ventaConLineasEmpatadas();
    const cargada = await prisma.$transaction((tx) => cargarVentaParaAnular(tx, { operacionId: venta.id, sucursalId: s.sucursalId }));
    expect(cargada?.lineas.map((l) => l.productoId)).toEqual([s.muzzarella.id, s.milanesa.id, s.flan.id]);
  });

  it("cargarHermanasDePromo: mismo orden en las líneas de cada hermana", async () => {
    const cuenta = await prisma.cuenta.create({ data: { mesaId: s.mesa.id, abiertaPorId: s.admin.id } });
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Menú" } });
    const promoCarta = await prisma.promoCarta.create({ data: { seccionCartaId: seccionCarta.id, titulo: "Menú", precio: 1000, sucursales: { create: { sucursalId: s.sucursalId } } } });
    const promo = await prisma.promoCuenta.create({ data: { cuentaId: cuenta.id, promoCartaId: promoCarta.id, precio: 1000, titulo: "Menú", creadoPorId: s.admin.id } });
    const pedida = await ventaConLineasEmpatadas(promo.id);
    await ventaConLineasEmpatadas(promo.id);

    const hermanas = await prisma.$transaction((tx) => cargarHermanasDePromo(tx, { promoCuentaId: promo.id, excluirOperacionId: pedida.id }));
    expect(hermanas).toHaveLength(1);
    expect(hermanas[0]!.lineas.map((l) => l.productoId)).toEqual([s.muzzarella.id, s.milanesa.id, s.flan.id]);
  });
});

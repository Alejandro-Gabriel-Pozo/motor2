import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// Para PAUSAR la alta a la familia justo después de que lee «¿está en un ítem agrupado?» (su foto ya está tomada): envuelve la lectura con la real y deja que un test intercale otra alta.
vi.mock("../../src/server/persistencia/carta/familias", async (importar) => {
  const real = await importar<typeof import("../../src/server/persistencia/carta/familias")>();
  return { ...real, productoEstaEnUnItemAgrupadoDeLaSucursal: vi.fn(real.productoEstaEnUnItemAgrupadoDeLaSucursal) };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { agregarOpcionItemAgrupadoCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/agregar-opcion-item-agrupado-carta";
import { agregarProductoAFamiliaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/agregar-producto-a-familia";
import { crearFamiliaDeProductoCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/crear-familia-de-producto";
import { productoEstaEnUnItemAgrupadoDeLaSucursal } from "../../src/server/persistencia/carta/familias";
import { aceptar } from "../../src/core/datos/resultado";

/**
 * F1, el invariante transitorio «una familia O un ítem agrupado» frente a una carrera DETERMINISTA (sin `Promise.allSettled` y sin depender del reparto del azar): la alta a la familia ya leyó (su foto SERIALIZABLE está
 * tomada y NO ve ninguna opción) y, antes de que escriba, otro pedido agrega el mismo producto a un ítem agrupado y confirma. Si ese alta corriera en READ COMMITTED, la foto de la familia no vería la opción y el disparador
 * dejaría pasar el miembro (quedaban los dos lados). Con las dos altas en SERIALIZABLE, la base cancela la de la familia (40001), `conTransaccionSerializable` la repite, la repetición ve la opción y responde
 * `PRODUCTO_YA_AGRUPADO`. Límite declarado (migración `20261117161000`): un INSERT de opción hecho a mano por SQL en READ COMMITTED a la vez que una alta a familia podría pasar; cerrarlo del todo en la base pide una fila de
 * bloqueo compartida por producto (una tabla), que queda como pregunta al dueño.
 */
describe("familias: cruce con el ítem agrupado, carrera determinista (etapa F1)", () => {
  let sucursalA: string;
  let usuarioId: string;
  let unidadId: string;
  let seccionId: string;
  const actor = () => actorDePrueba(usuarioId, sucursalA);

  beforeEach(async () => {
    vi.mocked(productoEstaEnUnItemAgrupadoDeLaSucursal).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalA = base.sucursal.id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalA, rolId: base.admin.id })).id;
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Bebidas", orden: 1 } })).id;
  });

  it("la familia lee («no está agrupado»), otro pedido agrupa el producto y confirma, y recién entonces la familia escribe: queda SOLO la opción y la familia responde PRODUCTO_YA_AGRUPADO", async () => {
    const familiaId = crypto.randomUUID();
    expect(await crearFamiliaDeProductoCasoDeUso(actor(), { id: familiaId, nombre: "Gaseosas" })).toMatchObject({ ok: true });
    const producto = (await sembrarProductoDisponible({ codigo: "PV_COCA", nombre: "Coca", tipo: "PV", unidadStockId: unidadId, precioVenta: 1000 }, sucursalA)).id;
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalA, nombre: "Gaseosa 500", seccionCartaId: seccionId } });

    const real = (await vi.importActual<typeof import("../../src/server/persistencia/carta/familias")>("../../src/server/persistencia/carta/familias")).productoEstaEnUnItemAgrupadoDeLaSucursal;
    let agrupoEnElMedio: Awaited<ReturnType<typeof agregarOpcionItemAgrupadoCartaCasoDeUso>> | null = null;
    // Solo el PRIMER intento se pausa: el reintento (después del 40001) lee la base ya confirmada.
    vi.mocked(productoEstaEnUnItemAgrupadoDeLaSucursal).mockImplementationOnce(async (tx, args) => {
      const estaba = await real(tx, args);
      agrupoEnElMedio = await agregarOpcionItemAgrupadoCartaCasoDeUso(actor(), { itemAgrupadoCartaId: item.id, productoId: producto, orden: aceptar({ orden: null }) });
      return estaba;
    });

    const resultado = await agregarProductoAFamiliaCasoDeUso(actor(), { miembroId: crypto.randomUUID(), familiaId, productoId: producto });

    expect(agrupoEnElMedio).toMatchObject({ ok: true });
    expect(resultado).toMatchObject({ ok: false, codigo: "PRODUCTO_YA_AGRUPADO" });
    expect(await prisma.opcionItemAgrupadoCarta.count({ where: { productoId: producto } })).toBe(1);
    expect(await prisma.miembroDeFamilia.count({ where: { productoId: producto, quitadoEn: null } })).toBe(0);
    expect(vi.mocked(productoEstaEnUnItemAgrupadoDeLaSucursal).mock.calls.length, "la alta a la familia se repitió una vez").toBeGreaterThanOrEqual(2);
  });
});

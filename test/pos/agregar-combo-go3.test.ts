import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { cerrarConexiones, conexionComoApp } from "../setup/gasto";
import { sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItemsCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/agregar-items";
import { actualizarActivaEntradaDeCupoCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/actualizar-activa-entrada-de-cupo";
import { actorDeCombos } from "../setup/combos-go3b";
import { guardComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.guard";
import type { ComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.schema";
import { claveDeConfiguracion } from "../../src/core/pos/promo-combo";
import { ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";

/**
 * GO-3b (ADR-032, frente D, F5 paso I2): vender un COMBO con cupos de entradas (LISTA), contra Postgres real y por el caso de uso. Fija:
 *  - el MENÚ (el plato elegido de una lista, un postre FIJO que completa el servidor y un café con configuración fija) y el DESAYUNO (el café elegido entre dos configuraciones y el dulce fijo), con el
 *    prorrateo exacto al centavo sobre el precio de LISTA de cada entrada en la sucursal (con su configuración, sin el descuento de producto) y el componente configurado escrito con su huella y
 *    sus fotos, colgado de la promo;
 *  - los rechazos tipados, sin escribir nada: `PROMO_CAMBIO`, un lugar sin ninguna entrada activa (`PROMO_INVALIDA`, falla por el mínimo), `ENTRADA_NO_DISPONIBLE` (desactivada o con una opción
 *    apagada en la sucursal), un fijo que se manda distinto (`PROMO_INVALIDA`), la vigencia (`PROMO_INVALIDA`) y `COMBO_ALICUOTAS_DISTINTAS`;
 *  - concurrencia real: dar de baja una entrada del plato a la vez que se agrega el menú (con la baja sin confirmar del otro lado, y en un loop de 10 con el caso de uso): o el menú entero con el plato, o el
 *    rechazo; nunca una promo a medias.
 * Poda 2026-11-13: el plato del día (lugar DEL_DIA, con su tabla por fecha y sucursal) se retiró; el menú de estas pruebas es una lista («Plato») con las mismas entradas.
 *
 * Mutaciones demostradas (rojo y revertidas): sacar el completado del fijo en `promo-combo.ts` (9 en rojo); saltear la revisión de alícuotas (rojo: «alícuotas»).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let cuentaId: string;

const actor = () => ({
  usuarioId: s.admin.id,
  empresaId: EMPRESA_POR_DEFECTO_ID,
  sucursalId: s.sucursalId,
  sucursalNombre: s.sucursal.nombre,
  empresaZonaHoraria: ZONA_ARGENTINA,
  ahora: new Date(),
  ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }),
});
const agregar = (promos: ComandoAgregarItems["promos"], items: ComandoAgregarItems["items"] = []) => agregarItemsCasoDeUso(actor(), { cuentaId, items, promos });
const lineas = () => prisma.cuentaItem.findMany({ where: { cuentaId }, include: { opcionesElegidas: { orderBy: { orden: "asc" } } }, orderBy: [{ precioUnitario: "desc" }, { id: "asc" }] });

/** Una promo de la sucursal con sus cupos de entradas. */
async function promo(titulo: string, precio: string, extra: Record<string, unknown> = {}) {
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `Sección ${titulo}` } });
  return (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccion.id, titulo, precio, ...extra } })).id;
}
const cupo = (promoCartaId: string, tipo: "LISTA", nombre: string, orden: number, cantidadMinima = 1, cantidadMaxima = 1) =>
  prisma.promoCartaCupo.create({ data: { promoCartaId, tipo, nombre, orden, cantidadMinima, cantidadMaxima } });
const entrada = (cupoId: string, productoId: string, opciones: { opcionId: string; cantidad: number }[] = [], orden = 0) =>
  prisma.entradaDeCupo.create({ data: { cupoId, productoId, orden, claveConfiguracion: claveDeConfiguracion(opciones)!, opciones: { create: opciones } } });

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});
afterEach(cerrarConexiones);

/** El menú: plato a elegir (milanesa 9000 o pizza 12000), postre FIJO (flan 3000) y café mediano con almendras (1000 + 150) fijo, a 10000. */
async function menuConPlato() {
  const promoCartaId = await promo("Menú de la casa", "10000.00");
  const plato = await cupo(promoCartaId, "LISTA", "Plato", 0);
  const postre = await cupo(promoCartaId, "LISTA", "Postre", 1);
  const bebida = await cupo(promoCartaId, "LISTA", "Bebida", 2);
  const milanesa = await entrada(plato.id, s.milanesa.id, [], 0);
  const pizza = await entrada(plato.id, s.pizza.id, [], 1);
  // Una tercera opción: con solo UNA entrada activa (mínimo = máximo = 1) el lugar pasaría a ser un componente FIJO, y lo que se prueba acá es la baja de una entrada elegible.
  await entrada(plato.id, s.flan.id, [], 2);
  await entrada(postre.id, s.flan.id);
  await entrada(bebida.id, c.cafeId, [{ opcionId: c.medianoId, cantidad: 1 }, { opcionId: c.almendrasId, cantidad: 1 }]);
  const pedir = (platoId = milanesa.id, extra: Record<string, unknown> = {}) => ({ promoCartaId, elecciones: [{ cupoId: plato.id, elegidos: [{ entradaId: platoId, cantidad: 1 }] }], ...extra });
  return { promoCartaId, plato, postre, bebida, milanesa, pizza, pedir };
}

describe("vender un combo con cupos de entradas (GO-3b, I2)", () => {
  it("el MENÚ: plato elegido, postre fijo y café configurado, prorrateados al centavo (6844,11 + 2281,37 + 874,52 = 10000)", async () => {
    const m = await menuConPlato();
    const r = await agregar([m.pedir(m.milanesa.id, { precioEsperado: 10000 })]);
    expect(r, r.mensaje).toMatchObject({ ok: true });
    const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId } });
    expect([promoCuenta.titulo, Number(promoCuenta.precio)]).toEqual(["Menú de la casa", 10000]);
    const [mila, flan, cafe, ...resto] = await lineas();
    expect(resto).toEqual([]);
    expect([mila, flan, cafe].map((l) => [l!.productoId, Number(l!.cantidad), Number(l!.precioUnitario), Number(l!.precioCartaUnitario), l!.promoCuentaId])).toEqual([
      [s.milanesa.id, 1, 6844.11, 9000, promoCuenta.id],
      [s.flan.id, 1, 2281.37, 3000, promoCuenta.id],
      [c.cafeId, 1, 874.52, 1150, promoCuenta.id],
    ]);
    // El café va como línea configurada: su huella y la foto de su configuración (sin adicionales).
    expect(cafe!.huellaOpciones).toMatch(/^[0-9a-f]{64}$/);
    expect(cafe!.opcionesElegidas.map((f) => [f.nombreGrupo, f.nombreOpcion, Number(f.importeUnitario)])).toEqual([
      ["Tamaño", "Mediano", 0],
      ["Leche", "Almendras", 150],
    ]);
    expect([mila!.huellaOpciones, flan!.huellaOpciones]).toEqual([null, null]);
  });

  it("el DESAYUNO: el café elegido entre dos configuraciones (chico 950 / grande 1100) y el dulce fijo, a 1500 (402,44 + 1097,56)", async () => {
    const promoCartaId = await promo("Desayuno", "1500.00");
    const cafes = await cupo(promoCartaId, "LISTA", "Café", 0);
    const dulce = await cupo(promoCartaId, "LISTA", "Dulce", 1);
    await entrada(cafes.id, c.cafeId, [{ opcionId: c.chicoId, cantidad: 1 }], 0);
    const grande = await entrada(cafes.id, c.cafeId, [{ opcionId: c.grandeId, cantidad: 1 }], 1);
    await entrada(dulce.id, s.flan.id);
    expect((await agregar([{ promoCartaId, elecciones: [{ cupoId: cafes.id, elegidos: [{ entradaId: grande.id, cantidad: 1 }] }] }])).ok).toBe(true);
    const [flan, cafe] = await lineas();
    expect([flan, cafe].map((l) => [l!.productoId, Number(l!.precioUnitario), Number(l!.precioCartaUnitario)])).toEqual([
      [s.flan.id, 1097.56, 3000],
      [c.cafeId, 402.44, 1100],
    ]);
    expect(cafe!.opcionesElegidas.map((f) => f.nombreOpcion)).toEqual(["Grande"]);
  });

  it("el descuento de producto NO se aplica dentro del combo: el reparto es sobre el precio de lista", async () => {
    const m = await menuConPlato();
    await prisma.descuentoProductoSucursal.create({ data: { productoId: s.milanesa.id, sucursalId: s.sucursalId, porcentaje: 50 } });
    expect((await agregar([m.pedir()])).ok).toBe(true);
    const [mila] = await lineas();
    expect([Number(mila!.precioUnitario), Number(mila!.precioCartaUnitario)]).toEqual([6844.11, 9000]);
  });

  describe("rechazos tipados (y ninguno escribe nada)", () => {
    const casos: [string, () => Promise<ComandoAgregarItems["promos"]>, string, RegExp][] = [
      ["el precio que vio el mozo ya no es el de hoy", async () => [(await menuConPlato()).pedir(undefined, { precioEsperado: 9500 })], "PROMO_CAMBIO", /el precio de la promo cambió/],
      [
        "un lugar sin ninguna entrada activa (todas dadas de baja) con mínimo 1",
        async () => {
          const m = await menuConPlato();
          await prismaAdmin.entradaDeCupo.updateMany({ where: { cupoId: m.plato.id }, data: { activa: false } });
          return [{ promoCartaId: m.promoCartaId, elecciones: [] }];
        },
        "PROMO_INVALIDA",
        /Elegí al menos 1 opción\(es\) de "Plato"/,
      ],
      [
        "el plato elegido se dio de baja",
        async () => {
          const m = await menuConPlato();
          await prismaAdmin.entradaDeCupo.update({ where: { id: m.pizza.id }, data: { activa: false } });
          return [m.pedir(m.pizza.id)];
        },
        "ENTRADA_NO_DISPONIBLE",
        /no está disponible hoy/,
      ],
      [
        "la opción de la configuración del café está apagada en la sucursal (el fijo se queda sin entrada)",
        async () => {
          const m = await menuConPlato();
          await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: s.sucursalId, opcionId: c.almendrasId, apagada: true, actualizadoPorId: s.admin.id } });
          return [m.pedir()];
        },
        "PROMO_INVALIDA",
        /Elegí al menos 1 opción\(es\) de "Bebida"/,
      ],
      [
        "un fijo que se manda distinto de lo que fijó el dueño",
        async () => {
          const m = await menuConPlato();
          const flan = await prisma.entradaDeCupo.findFirstOrThrow({ where: { cupoId: m.postre.id } });
          return [{ ...m.pedir(), elecciones: [...m.pedir().elecciones, { cupoId: m.postre.id, elegidos: [{ entradaId: flan.id, cantidad: 2 }] }] }];
        },
        "PROMO_INVALIDA",
        /viene fijo en esta promo/,
      ],
      [
        "alícuotas de IVA declaradas distintas entre lo elegido",
        async () => {
          const m = await menuConPlato();
          await prisma.producto.update({ where: { id: s.milanesa.id }, data: { alicuotaIvaVenta: "IVA_21" } });
          await prisma.producto.update({ where: { id: s.flan.id }, data: { alicuotaIvaVenta: "IVA_10_5" } });
          return [m.pedir()];
        },
        "COMBO_ALICUOTAS_DISTINTAS",
        /alícuotas de IVA distintas/,
      ],
    ];
    it.each(casos)("%s", async (_caso, promos, codigo, mensaje) => {
      const r = await agregar(await promos());
      expect(r).toMatchObject({ ok: false, codigo });
      if (!r.ok) expect(r.mensaje).toMatch(mensaje);
      expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(0);
      expect(await prisma.promoCuenta.count({ where: { cuentaId } })).toBe(0);
    });

    it("control: la misma alícuota declarada entra", async () => {
      const m = await menuConPlato();
      for (const id of [s.milanesa.id, s.flan.id, c.cafeId]) await prisma.producto.update({ where: { id }, data: { alicuotaIvaVenta: "IVA_21" } });
      expect((await agregar([m.pedir()])).ok).toBe(true);
    });
  });

  it("el guard: un precio esperado de la promo que no es un importe se rechaza", () => {
    const g = (precioEsperado: unknown) => guardComandoAgregarItems({ cuentaId: "c", items: [], promos: [{ promoCartaId: "p", elecciones: [], precioEsperado }] }).ok;
    for (const malo of ["10000", -5, 1.234, Number.NaN]) expect(g(malo), String(malo)).toBe(false);
    expect(g(10000)).toBe(true);
    expect(guardComandoAgregarItems({ cuentaId: "c", items: [], promos: [{ promoCartaId: "p", elecciones: [] }] }).ok).toBe(true);
  });

  describe("concurrencia real: dar de baja una entrada del plato contra agregar el menú", () => {
    it("con la baja SIN confirmar del otro lado, el menú entra entero; confirmada, ENTRADA_NO_DISPONIBLE", async () => {
      const m = await menuConPlato();
      const otro = await conexionComoApp(undefined, { lectura: [s.sucursalId], escritura: [s.sucursalId] });
      await otro.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await otro.query(`UPDATE "EntradaDeCupo" SET activa = false WHERE id = $1`, [m.milanesa.id]);
      expect((await agregar([m.pedir()])).ok).toBe(true);
      await otro.query("COMMIT");
      expect(await agregar([m.pedir()])).toMatchObject({ ok: false, codigo: "ENTRADA_NO_DISPONIBLE" });
      expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(3);
    });

    it("el caso de uso de dar de baja contra el de agregar, a la vez (loop de 10): o el menú ENTERO (3 líneas que suman 10000) o el rechazo; nunca una promo a medias", async () => {
      const m = await menuConPlato();
      const quitarActor = actorDeCombos(s.admin.id, s.sucursalId, new Date());
      const vistos = { entro: 0, rechazo: 0 };
      for (let i = 0; i < 10; i++) {
        await prismaAdmin.entradaDeCupo.update({ where: { id: m.milanesa.id }, data: { activa: true } });
        const demora = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const [agregado, quitado] = await Promise.allSettled([
          (async () => {
            if (i % 2 === 1) await demora(15);
            return agregar([m.pedir()]);
          })(),
          (async () => {
            if (i % 2 === 0) await demora(15);
            return actualizarActivaEntradaDeCupoCasoDeUso(quitarActor, { entradaId: m.milanesa.id, activa: false });
          })(),
        ]);
        expect(agregado.status, `vuelta ${i}`).toBe("fulfilled");
        expect(quitado.status, `vuelta ${i}`).toBe("fulfilled");
        const r = agregado.status === "fulfilled" ? agregado.value : null;
        if (r?.ok) vistos.entro++;
        else {
          expect(r, `vuelta ${i}`).toMatchObject({ ok: false, codigo: "ENTRADA_NO_DISPONIBLE" });
          vistos.rechazo++;
        }
      }
      const promos = await prisma.promoCuenta.findMany({ where: { cuentaId }, include: { items: true } });
      expect(promos).toHaveLength(vistos.entro);
      for (const p of promos) {
        expect(p.items.map((l) => l.productoId).sort()).toEqual([s.milanesa.id, s.flan.id, c.cafeId].sort());
        expect(Math.round(p.items.reduce((t, l) => t + Number(l.precioUnitario) * Number(l.cantidad), 0) * 100) / 100).toBe(10000);
      }
      // Guardia contra el verde falso: las 10 vueltas terminaron en uno de los dos resultados y al menos una entró.
      expect(vistos.entro + vistos.rechazo).toBe(10);
      expect(vistos.entro, JSON.stringify(vistos)).toBeGreaterThan(0);
    });
  });
});

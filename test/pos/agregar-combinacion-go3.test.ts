import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { cerrarConexiones, conexionComoApp } from "../setup/gasto";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItemsCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/agregar-items";
import { guardComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.guard";
import type { ComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.schema";

/**
 * GO-3b (ADR-032, frente A, F5 paso I1): vender una línea que cae en una COMBINACIÓN del producto (el café con el TAMAÑO como eje), contra Postgres real y por el caso de uso. Fija:
 *  - el precio de la combinación (propio, de una tarifa, local de la sucursal) reemplaza al aditivo del eje y las demás opciones se suman igual; la foto `CombinacionEnLinea` (origen, precio,
 *    tarifa con su nombre copiado, versión de la receta propia vigente) queda 1 a 1 con la línea; una combinación ADITIVA deja foto sin precio; una opción sin fila, ni foto ni cambio;
 *  - `COMBINACION_NO_DISPONIBLE` (la combinación o su tarifa apagadas) y `PRECIO_CAMBIO` (el precio de lista que vio el mozo ya no es el de hoy), sin escribir nada;
 *  - el guard: un `precioDeListaEsperado` que no es un importe se rechaza;
 *  - idempotencia (la misma clave dos veces: una línea y una foto) y concurrencia real (apagar la combinación o cambiarle el precio a la vez que se agrega: o la línea con la foto de lo que se
 *    vio, o el rechazo; nunca una línea a otro precio que el que se vio).
 *
 * Mutaciones demostradas (rojo y revertidas): no pasar las combinaciones a `armarLineaConfigurada` (rojo: «propio»); no comparar el precio esperado (rojo: «PRECIO_CAMBIO»); no escribir la foto
 * (rojo: «foto»).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let cuentaId: string;

const actor = () => ({
  usuarioId: s.admin.id,
  empresaId: EMPRESA_POR_DEFECTO_ID,
  sucursalId: s.sucursalId,
  sucursalNombre: s.sucursal.nombre,
  ahora: new Date(),
  ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }),
});
const agregar = (items: ComandoAgregarItems["items"], claveIdempotencia?: string) =>
  agregarItemsCasoDeUso(actor(), { cuentaId, items, promos: [], ...(claveIdempotencia ? { claveIdempotencia } : {}) });
const lineas = () =>
  prisma.cuentaItem.findMany({ where: { cuentaId }, include: { combinacionEnLinea: true, opcionesElegidas: { orderBy: { orden: "asc" } } }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
/** La foto de la combinación de una línea (la relación es una lista por la clave compuesta; el único por `cuentaItemId` la deja en a lo sumo una). */
const fotoDe = (l: { combinacionEnLinea: { combinacionId: string; origenPrecio: string; precio: unknown; precioDeSucursal: boolean; grupoDePrecioId: string | null; nombreGrupoDePrecio: string | null; recetaDeCombinacionVersionId: string | null }[] }) => {
  expect(l.combinacionEnLinea.length).toBeLessThanOrEqual(1);
  return l.combinacionEnLinea[0] ?? null;
};
const combinacion = (opcionEje1Id: string, data: Record<string, unknown> = {}) => prisma.combinacionDeProducto.create({ data: { productoId: c.cafeId, opcionEje1Id, ...data } });

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  // El TAMAÑO es el eje de las combinaciones del café.
  await prisma.productoAdmiteGrupo.update({ where: { productoId_grupoId: { productoId: c.cafeId, grupoId: c.grupoMedidaId } }, data: { ejeDeCombinacion: 1 } });
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});
afterEach(cerrarConexiones);

describe("vender una combinación (GO-3b, I1)", () => {
  it("precio PROPIO: el grande a 1400 (en vez de 1100) más las almendras (150) = 1550, con su foto; el shot sigue aparte", async () => {
    const grande = await combinacion(c.grandeId, { precio: "1400.00" });
    const receta = await prisma.recetaDeCombinacionVersion.create({ data: { combinacionId: grande.id, numero: 1, creadoPorId: s.admin.id } });
    const r = await agregar([{ productoId: c.cafeId, cantidad: 2, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId), elegida(c, c.shotId)], precioDeListaEsperado: 1550 }]);
    expect(r).toMatchObject({ ok: true });
    const [cafe, shot] = await lineas();
    expect([Number(cafe!.precioUnitario), cafe!.precioCartaUnitario, Number(shot!.precioUnitario)]).toEqual([1550, null, 200]);
    const foto = fotoDe(cafe!)!;
    expect({ combinacion: foto.combinacionId, origen: foto.origenPrecio, precio: Number(foto.precio), deSucursal: foto.precioDeSucursal, grupo: foto.grupoDePrecioId, receta: foto.recetaDeCombinacionVersionId }).toEqual({
      combinacion: grande.id,
      origen: "PROPIO",
      precio: 1400,
      deSucursal: false,
      grupo: null,
      receta: receta.id,
    });
    expect(fotoDe(shot!)).toBeNull();
    // La foto de las opciones sigue igual (el tamaño con su importe de siempre: el precio de la combinación vive en la foto de la combinación).
    expect(cafe!.opcionesElegidas.map((f) => f.nombreOpcion)).toEqual(["Grande", "Almendras"]);
  });

  it("de una TARIFA con su nombre copiado, y el precio LOCAL de la sucursal gana; ADITIVA deja foto sin precio; sin fila, ni foto ni cambio", async () => {
    const tarifa = await prisma.grupoDePrecio.create({ data: { nombre: "Tarifa café grande", precio: "1300.00" } });
    await combinacion(c.grandeId, { grupoDePrecioId: tarifa.id });
    const mediano = await combinacion(c.medianoId);
    await prisma.precioLocalDeCombinacion.create({ data: { sucursalId: s.sucursalId, grupoDePrecioId: tarifa.id, precio: "1350.00", habilitado: true } });
    expect((await agregar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }, { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId)] }, { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.chicoId)] }])).ok).toBe(true);
    const [g, m, ch] = await lineas();
    expect([Number(g!.precioUnitario), Number(m!.precioUnitario), Number(ch!.precioUnitario)]).toEqual([1350, 1000, 950]);
    expect([fotoDe(g!)?.origenPrecio, fotoDe(g!)?.grupoDePrecioId, fotoDe(g!)?.nombreGrupoDePrecio, Number(fotoDe(g!)?.precio), fotoDe(g!)?.precioDeSucursal]).toEqual([
      "GRUPO",
      tarifa.id,
      "Tarifa café grande",
      1350,
      true,
    ]);
    expect([fotoDe(m!)?.combinacionId, fotoDe(m!)?.origenPrecio, fotoDe(m!)?.precio]).toEqual([mediano.id, "ADITIVO", null]);
    expect(fotoDe(ch!)).toBeNull();
    // Sin la capacidad `precio_local`, rige el de la tarifa.
    await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId: s.sucursalId, habilitado: false } });
    expect((await agregar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)], precioDeListaEsperado: 1300 }])).ok).toBe(true);
  });

  it("el descuento de producto se aplica sobre el precio de la combinación (la lista queda en precioCartaUnitario)", async () => {
    await combinacion(c.grandeId, { precio: "1400.00" });
    await prisma.descuentoProductoSucursal.create({ data: { productoId: c.cafeId, sucursalId: s.sucursalId, porcentaje: 10 } });
    expect((await agregar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)], precioDeListaEsperado: 1400 }])).ok).toBe(true);
    const [cafe] = await lineas();
    expect([Number(cafe!.precioUnitario), Number(cafe!.precioCartaUnitario)]).toEqual([1260, 1400]);
  });

  describe("rechazos tipados (y ninguno escribe nada)", () => {
    const casos: [string, () => Promise<ComandoAgregarItems["items"]>, string, RegExp][] = [
      [
        "la combinación está apagada",
        async () => {
          await combinacion(c.chicoId, { activa: false });
          return [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.chicoId)] }];
        },
        "COMBINACION_NO_DISPONIBLE",
        /no está disponible/,
      ],
      [
        "su tarifa está apagada",
        async () => {
          const tarifa = await prisma.grupoDePrecio.create({ data: { nombre: "T", precio: "1300.00", activo: false } });
          await combinacion(c.grandeId, { grupoDePrecioId: tarifa.id });
          return [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }];
        },
        "COMBINACION_NO_DISPONIBLE",
        /no está disponible/,
      ],
      [
        "el precio que vio el mozo ya no es el de hoy (una combinación)",
        async () => {
          await combinacion(c.grandeId, { precio: "1400.00" });
          return [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)], precioDeListaEsperado: 1100 }];
        },
        "PRECIO_CAMBIO",
        /el precio cambió desde que lo elegiste/,
      ],
      ["el precio que vio el mozo ya no es el de hoy (un producto sin opciones)", async () => [{ productoId: s.milanesa.id, cantidad: 1, precioDeListaEsperado: 8500 }], "PRECIO_CAMBIO", /el precio cambió/],
    ];
    it.each(casos)("%s", async (_caso, items, codigo, mensaje) => {
      const r = await agregar(await items());
      expect(r).toMatchObject({ ok: false, codigo });
      if (!r.ok) expect(r.mensaje).toMatch(mensaje);
      expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(0);
      expect(await prisma.combinacionEnLinea.count()).toBe(0);
    });

    it("con el precio que vio (el de hoy), entra: un producto sin opciones y el chico aditivo", async () => {
      expect((await agregar([{ productoId: s.milanesa.id, cantidad: 1, precioDeListaEsperado: 9000 }, { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.chicoId)], precioDeListaEsperado: 950 }])).ok).toBe(true);
    });
  });

  it("el guard: un precio esperado que no es un importe (texto, negativo, 3 decimales, NaN) se rechaza; 0 y 12,34 pasan", () => {
    const g = (precioDeListaEsperado: unknown) => guardComandoAgregarItems({ cuentaId: "c", items: [{ productoId: "p", cantidad: 1, precioDeListaEsperado }], promos: [] }).ok;
    for (const malo of ["1550", -1, 12.345, Number.NaN, Number.POSITIVE_INFINITY, null]) expect(g(malo), String(malo)).toBe(false);
    for (const bueno of [0, 12.34, 0.07, 1550]) expect(g(bueno), String(bueno)).toBe(true);
    expect(guardComandoAgregarItems({ cuentaId: "c", items: [{ productoId: "p", cantidad: 1 }], promos: [] }).ok).toBe(true);
  });

  it("idempotencia: la misma clave dos veces a la vez deja UNA línea y UNA foto", async () => {
    await combinacion(c.grandeId, { precio: "1400.00" });
    const clave = randomUUID();
    const items = [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)], precioDeListaEsperado: 1400 }];
    const resultados = await Promise.all([agregar(items, clave), agregar(items, clave)]);
    expect(resultados.map((r) => r.ok)).toEqual([true, true]);
    expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(1);
    expect(await prisma.combinacionEnLinea.count()).toBe(1);
  });

  describe("concurrencia real contra el catálogo", () => {
    it("apagar la combinación SIN confirmar del otro lado: el pedido entra con la foto; confirmado, COMBINACION_NO_DISPONIBLE", async () => {
      const grande = await combinacion(c.grandeId, { precio: "1400.00" });
      const otro = await conexionComoApp();
      await otro.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await otro.query(`UPDATE "CombinacionDeProducto" SET activa = false, version = version + 1 WHERE id = $1`, [grande.id]);
      expect((await agregar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }])).ok).toBe(true);
      await otro.query("COMMIT");
      expect(await agregar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }])).toMatchObject({ ok: false, codigo: "COMBINACION_NO_DISPONIBLE" });
      expect(await prisma.combinacionEnLinea.count()).toBe(1);
    });

    it("cambiar el precio de la combinación a la vez que se agrega con el precio visto (loop de 10): o la línea AL PRECIO VISTO, o PRECIO_CAMBIO; nunca otro precio", async () => {
      const grande = await combinacion(c.grandeId, { precio: "1400.00" });
      const resultados = { entro: 0, cambio: 0 };
      for (let i = 0; i < 10; i++) {
        const visto = Number((await prisma.combinacionDeProducto.findUniqueOrThrow({ where: { id: grande.id } })).precio);
        const nuevo = (1400 + (i + 1) * 10).toFixed(2);
        const otro = await conexionComoApp();
        const cambiar = async () => {
          if (i % 2 === 1) await new Promise((r) => setTimeout(r, 15));
          await otro.query(`UPDATE "CombinacionDeProducto" SET precio = $2, version = version + 1 WHERE id = $1`, [grande.id, nuevo]);
        };
        const pedir = async () => {
          if (i % 2 === 0) await new Promise((r) => setTimeout(r, 15));
          return agregar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)], precioDeListaEsperado: visto }]);
        };
        const [r, cambio] = await Promise.allSettled([pedir(), cambiar()]);
        expect(cambio.status, `vuelta ${i}`).toBe("fulfilled");
        expect(r.status, `vuelta ${i}`).toBe("fulfilled");
        const v = r.status === "fulfilled" ? r.value : null;
        if (v?.ok) resultados.entro++;
        else {
          expect(v, `vuelta ${i}`).toMatchObject({ ok: false, codigo: "PRECIO_CAMBIO" });
          resultados.cambio++;
        }
      }
      const vendidas = await lineas();
      expect(vendidas).toHaveLength(resultados.entro);
      // Cada línea se cobró al precio de su foto, y ese precio es uno que existió (1400 o uno de los cambios), nunca una mezcla.
      for (const l of vendidas) {
        expect(Number(l.precioUnitario)).toBe(Number(fotoDe(l)!.precio));
        expect((Number(l.precioUnitario) - 1400) % 10).toBe(0);
      }
      // Guardia contra el verde falso: el loop ejercitó al menos uno de los dos órdenes y ningún resultado quedó afuera.
      expect(resultados.entro + resultados.cambio).toBe(10);
      expect(resultados.entro, JSON.stringify(resultados)).toBeGreaterThan(0);
    });
  });
});

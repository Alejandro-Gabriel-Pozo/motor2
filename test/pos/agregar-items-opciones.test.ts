import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItemsCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/agregar-items";
import type { ComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.schema";

/**
 * GO-2b (ADR-030), contra Postgres real y por el caso de uso (los códigos tipados): agregar a una cuenta un producto con opciones. Fija lo funcional (café grande con
 * almendras y un shot), cada código nuevo, el descuento de producto sobre la lista compuesta (nunca al adicional), las promos (un componente con un grupo obligatorio
 * se rechaza; con grupos opcionales entra sin opciones), el ancla pedido suelto y el tope de líneas contando los adicionales. Todo rechazo no deja nada escrito.
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
const agregar = (items: ComandoAgregarItems["items"], promos: ComandoAgregarItems["promos"] = []) => agregarItemsCasoDeUso(actor(), { cuentaId, items, promos });
const lineas = () => prisma.cuentaItem.findMany({ where: { cuentaId }, include: { opcionesElegidas: { orderBy: { orden: "asc" } } }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});

describe("agregar ítems con opciones (GO-2b)", () => {
  it("café grande con almendras y un shot, ×2: la línea del producto a 1250 con su huella y su foto, y el shot en su línea (ancla, ×2, 200, colgado del padre)", async () => {
    const r = await agregar([{ productoId: c.cafeId, cantidad: 2, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId), elegida(c, c.shotId)] }]);
    expect(r).toEqual({ ok: true, mensaje: "Se agregó 1 ítem a la mesa 4.", datos: null });
    const [cafe, shot, ...resto] = await lineas();
    expect(resto).toEqual([]);
    expect({ producto: cafe!.productoId, cantidad: Number(cafe!.cantidad), precio: Number(cafe!.precioUnitario), lista: cafe!.precioCartaUnitario, envio: cafe!.numeroEnvio }).toEqual({
      producto: c.cafeId,
      cantidad: 2,
      precio: 1250,
      lista: null,
      envio: null,
    });
    expect(cafe!.huellaOpciones).toMatch(/^[0-9a-f]{64}$/);
    expect(cafe!.opcionesElegidas.map((f) => [f.nombreGrupo, f.nombreOpcion, f.versionDeOpcionId, Number(f.importeUnitario)])).toEqual([
      ["Tamaño", "Grande", c.versionDe[c.grandeId], 100],
      ["Leche", "Almendras", c.versionDe[c.almendrasId], 150],
    ]);
    expect({ producto: shot!.productoId, cantidad: Number(shot!.cantidad), precio: Number(shot!.precioUnitario), padre: shot!.lineaPadreId, huella: shot!.huellaOpciones }).toEqual({
      producto: c.anclaDelShotId,
      cantidad: 2,
      precio: 200,
      padre: cafe!.id,
      huella: null,
    });
    expect(shot!.opcionesElegidas.map((f) => [f.nombreOpcion, f.cantidad])).toEqual([["Shot extra", 1]]);
  });

  it("un producto sin opciones se agrega igual que siempre (sin huella, sin padre, sin foto)", async () => {
    expect((await agregar([{ productoId: s.milanesa.id, cantidad: 1 }])).ok).toBe(true);
    const [mila] = await lineas();
    expect({ huella: mila!.huellaOpciones, padre: mila!.lineaPadreId, fotos: mila!.opcionesElegidas }).toEqual({ huella: null, padre: null, fotos: [] });
  });

  it("descuento de producto: sobre la lista COMPUESTA (precioCartaUnitario = la lista); el adicional no lo lleva", async () => {
    await prisma.descuentoProductoSucursal.create({ data: { productoId: c.cafeId, sucursalId: s.sucursalId, porcentaje: 10 } });
    expect((await agregar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId), elegida(c, c.shotId)] }])).ok).toBe(true);
    const [cafe, shot] = await lineas();
    expect([Number(cafe!.precioUnitario), Number(cafe!.precioCartaUnitario)]).toEqual([1125, 1250]);
    expect([Number(shot!.precioUnitario), shot!.precioCartaUnitario]).toEqual([200, null]);
  });

  describe("cada código tipado (y ningún rechazo escribe nada)", () => {
    const casos: [string, () => Promise<ComandoAgregarItems["items"]>, string, RegExp][] = [
      ["falta el tamaño obligatorio", async () => [{ productoId: c.cafeId, cantidad: 1 }], "OPCIONES_INVALIDAS", /Elegí al menos 1 opción de «Tamaño»/],
      ["el tope del shot por café (3)", async () => [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), elegida(c, c.shotId, 4)] }], "OPCIONES_INVALIDAS", /como máximo 3/],
      ["una opción que el café no admite", async () => [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), { opcionId: "no-existe", cantidad: 1, versionDeOpcionId: "x" }] }], "OPCIONES_INVALIDAS", /no se puede elegir/],
      ["opciones a un producto que no admite nada", async () => [{ productoId: s.milanesa.id, cantidad: 1, opciones: [elegida(c, c.medianoId)] }], "OPCIONES_INVALIDAS", /no admite opciones/],
      [
        "una cantidad que no es entera (en un producto cuya unidad admite decimales: con opciones se pide en enteros)",
        async () => {
          await prisma.producto.update({ where: { id: c.cafeId }, data: { unidadStockId: s.kg.id } });
          return [{ productoId: c.cafeId, cantidad: 1.5, opciones: [elegida(c, c.medianoId)] }];
        },
        "OPCIONES_INVALIDAS",
        /cantidades enteras/,
      ],
      [
        "la versión que vio el mozo ya no es la vigente",
        async () => {
          await prisma.versionDeOpcion.create({ data: { opcionId: c.grandeId, numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "120.00", factorEscala: "1.5000", creadoPorId: s.admin.id } });
          return [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }];
        },
        "OPCION_CAMBIO",
        /cambió desde que la elegiste/,
      ],
      [
        "apagada en la sucursal",
        async () => {
          await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: s.sucursalId, opcionId: c.almendrasId, apagada: true, actualizadoPorId: s.admin.id } });
          return [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), elegida(c, c.almendrasId)] }];
        },
        "OPCIONES_INVALIDAS",
        /no está disponible en esta sucursal/,
      ],
      [
        "el ancla pedido suelto (aunque alguien le haya dado disponibilidad)",
        async () => {
          await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: c.anclaDelShotId, disponible: true } });
          return [{ productoId: c.anclaDelShotId, cantidad: 1 }];
        },
        "PRODUCTO_INVALIDO",
        /se vende solo como adicional/,
      ],
      ["el ancla pedido suelto, sin disponibilidad: el chequeo de siempre gana", async () => [{ productoId: c.anclaDelShotId, cantidad: 1 }], "PRODUCTO_INVALIDO", /no está disponible en/],
      [
        "con los adicionales se pasa el tope de líneas (26 cafés con un shot = 52)",
        async () => Array.from({ length: 26 }, () => ({ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), elegida(c, c.shotId)] })),
        "OPCIONES_INVALIDAS",
        /más de 50 ítems/,
      ],
    ];
    it.each(casos)("%s", async (_caso, items, codigo, mensaje) => {
      const r = await agregar(await items());
      expect(r).toMatchObject({ ok: false, codigo });
      if (!r.ok) expect(r.mensaje).toMatch(mensaje);
      expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(0);
      expect(await prisma.opcionElegidaEnLinea.count()).toBe(0);
    });
  });

  describe("promos (v1: los componentes no llevan opciones)", () => {
    async function promoConCafe() {
      const bebidas = await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } });
      const postres = await prisma.seccionCarta.create({ data: { nombre: "Postres" } });
      await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: c.cafeId, visibleEnCarta: true, seccionCartaId: bebidas.id } });
      await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.flan.id, visibleEnCarta: true, seccionCartaId: postres.id } });
      const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: bebidas.id, titulo: "Merienda", precio: 3500 } });
      await prisma.promoCartaCupo.createMany({
        data: [
          { promoCartaId: promo.id, seccionCartaId: bebidas.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 0 },
          { promoCartaId: promo.id, seccionCartaId: postres.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 1 },
        ],
      });
      return [
        {
          promoCartaId: promo.id,
          elecciones: [
            { seccionCartaId: bebidas.id, elegidos: [{ productoId: c.cafeId, cantidad: 1 }] },
            { seccionCartaId: postres.id, elegidos: [{ productoId: s.flan.id, cantidad: 1 }] },
          ],
        },
      ];
    }

    it("un componente con un grupo obligatorio (el tamaño del café) rechaza la promo con PROMO_CON_OPCIONES y no escribe nada", async () => {
      const r = await agregar([], await promoConCafe());
      expect(r).toMatchObject({ ok: false, codigo: "PROMO_CON_OPCIONES" });
      expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(0);
      expect(await prisma.promoCuenta.count()).toBe(0);
    });

    it("con grupos solo opcionales, el componente entra SIN opciones (sin huella ni foto)", async () => {
      await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: c.cafeId, grupoId: c.grupoMedidaId }, data: { activo: false } });
      const r = await agregar([], await promoConCafe());
      expect(r.ok, r.mensaje).toBe(true);
      const items = await lineas();
      expect(items.map((i) => [i.productoId, i.huellaOpciones, i.lineaPadreId, i.opcionesElegidas.length, i.promoCuentaId !== null])).toEqual([
        [c.cafeId, null, null, 0, true],
        [s.flan.id, null, null, 0, true],
      ]);
    });
  });
});

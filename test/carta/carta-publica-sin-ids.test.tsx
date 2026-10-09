import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { cartaPublica, empresaCartaPublica } from "../../src/server/carta-publica/sin-sesion";
import { proyectarCartaPublica, type CartaV1 } from "../../src/core/carta/public";
import { CartaVista } from "../../src/components/carta-publica/carta-vista";

/**
 * S-25 (plan de endurecimiento de seguridad, tanda T9): la carta pública no emite ids internos. El ataque real se mide en el artefacto de producción
 * (`test/e2e/carta-publica-sin-ids.spec.ts`: HTML y payload RSC); acá se prueba cada eslabón sin navegador:
 *  1. la ENTRADA pública (`cartaPublica`, lo que importan las páginas) entrega la carta sin ningún id de fila, con la base real;
 *  2. el HTML que dibuja `CartaVista` con esa carta no contiene ningún id sembrado ni nada con forma de cuid, y las páginas del slider se llaman por posición;
 *  3. la proyección copia CAMPO POR CAMPO: un campo que aparezca mañana en `CartaV1` no sale por la carta pública mientras nadie lo sume a propósito.
 */
const CUID = /\bc[a-z0-9]{24}\b/;

async function sembrar() {
  const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
  const central = await prisma.sucursal.create({ data: { nombre: "Central" } });
  await prisma.sucursalPublica.create({ data: { sucursalId: central.id, slug: "central", publicada: true } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
  const suelto = await prisma.producto.create({ data: { codigo: "BIFE", nombre: "Bife", tipo: "PV", precioVenta: 1000, unidadStockId: u.id } });
  const opcion = await prisma.producto.create({ data: { codigo: "OPC", nombre: "Opción", tipo: "PV", precioVenta: 900, unidadStockId: u.id } });
  for (const p of [suelto, opcion]) await prisma.disponibilidadProducto.create({ data: { sucursalId: central.id, productoId: p.id, disponible: true } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: central.id, productoId: suelto.id, visibleEnCarta: true, seccionCartaId: seccion.id } });
  await prisma.descuentoProductoSucursal.create({ data: { productoId: suelto.id, sucursalId: central.id, porcentaje: 10 } });
  const agrupado = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: central.id, nombre: "Combo", seccionCartaId: seccion.id, orden: 2 } });
  await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: central.id, itemAgrupadoCartaId: agrupado.id, productoId: opcion.id, orden: 0 } });
  const promo = await prisma.promoCarta.create({ data: { seccionCartaId: seccion.id, titulo: "Promo", descripcion: "x", precio: 100, sucursales: { create: [{ sucursalId: central.id }] } } });
  return { ids: { sucursal: central.id, seccion: seccion.id, suelto: suelto.id, opcion: opcion.id, agrupado: agrupado.id, promo: promo.id, empresa: EMPRESA_POR_DEFECTO_ID } };
}

describe("S-25: la carta pública no emite ids internos", () => {
  let ids: Awaited<ReturnType<typeof sembrar>>["ids"];

  beforeEach(async () => {
    await limpiarBaseDeTest();
    ({ ids } = await sembrar());
  });

  it("ATAQUE: la entrada pública entrega la carta sin ningún id de sucursal, sección, producto, ítem agrupado, opción ni promo", async () => {
    const empresa = (await empresaCartaPublica("principal"))!;
    const entregada = (await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA))!;
    expect(entregada.carta.secciones[0].items.length, "la carta sembrada tiene que tener ítems (si no, el test pasa en vacío)").toBe(2);
    const salida = JSON.stringify(entregada);
    for (const [clase, id] of Object.entries(ids)) expect(salida, `la salida pública contiene el id de ${clase}`).not.toContain(id);
    expect(salida).not.toMatch(CUID);
    expect(Object.keys(entregada.carta.sucursal)).toEqual(["nombre"]);
  });

  it("ATAQUE: el HTML de la carta dibujada no contiene ningún id, ni nada con forma de cuid, y las páginas del slider se llaman por posición", async () => {
    const empresa = (await empresaCartaPublica("principal"))!;
    const entregada = (await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA))!;
    const html = renderToStaticMarkup(<CartaVista carta={entregada.carta} estilo={entregada.estilo} hrefVolver="/carta-publica/principal" />);
    expect(html).toContain("Bife");
    expect(html).toContain('data-ir-a="seccion-0"');
    for (const [clase, id] of Object.entries(ids)) expect(html, `el HTML contiene el id de ${clase}`).not.toContain(id);
    expect(html).not.toMatch(CUID);
  });
});

describe("proyectarCartaPublica: copia campo por campo", () => {
  const completa = {
    version: 1,
    generadoEn: "2026-01-01T00:00:00.000Z",
    sucursal: { id: "suc-interna", nombre: "Central", costoInterno: 1 },
    secciones: [
      {
        id: "sec-interna",
        nombre: "Platos",
        titulo: null,
        descripcion: null,
        imagenUrl: null,
        orden: 1,
        notaInterna: "no sale",
        items: [
          { productoId: "prod-interno", nombre: "Bife", categoria: "Platos", descripcion: null, precio: 90, precioLista: 100, descuentoPorcentaje: 10, tags: ["a"], especial: false, imagenUrl: null, precioConsignacion: 55 },
          { productoId: "agr-interno", nombre: "Combo", categoria: "Platos", descripcion: null, precio: 50, tags: [], especial: true, imagenUrl: null, opciones: [{ productoId: "opc-interna", nombre: "Opción", precio: 50, costo: 20 }] },
        ],
        promos: [{ id: "promo-interna", titulo: "Promo", descripcion: null, precio: 10, orden: 0, sucursalesQueLaOfrecen: 3 }],
      },
    ],
  };

  it("deja solo la lista cerrada: ningún id y ningún campo que no esté en ella, aunque CartaV1 lo traiga", () => {
    const publica = proyectarCartaPublica(completa as unknown as CartaV1);
    const salida = JSON.stringify(publica);
    for (const interno of ["suc-interna", "sec-interna", "prod-interno", "agr-interno", "opc-interna", "promo-interna", "costoInterno", "notaInterna", "precioConsignacion", "costo", "sucursalesQueLaOfrecen"]) {
      expect(salida, interno).not.toContain(interno);
    }
    expect(publica.secciones[0].items[0]).toEqual({ nombre: "Bife", categoria: "Platos", descripcion: null, precio: 90, precioLista: 100, descuentoPorcentaje: 10, tags: ["a"], especial: false, imagenUrl: null });
    expect(publica.secciones[0].items[1]).toEqual({ nombre: "Combo", categoria: "Platos", descripcion: null, precio: 50, tags: [], especial: true, imagenUrl: null, opciones: [{ nombre: "Opción", precio: 50 }] });
    expect(publica.secciones[0].promos[0]).toEqual({ titulo: "Promo", descripcion: null, precio: 10, orden: 0 });
  });

  it("un ítem sin descuento ni opciones no lleva esas claves (el JSON queda igual que antes)", () => {
    const item = proyectarCartaPublica(completa as unknown as CartaV1).secciones[0].items[1];
    expect("precioLista" in item).toBe(false);
    expect("descuentoPorcentaje" in item).toBe(false);
  });
});

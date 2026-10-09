import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * S-25 (plan de endurecimiento de seguridad, tanda T9; método del dueño: el anónimo solo alcanza lo que la empresa PUBLICA). La carta pública es la única excepción
 * y publica una lista cerrada de campos; los ids internos (cuid de sección, producto, ítem agrupado, promo, sucursal y empresa) no están en esa lista: nadie los
 * publicó, y un anónimo con ellos puede apuntar a filas de la base que no son suyas (otra superficie de ataque, y un oráculo sobre cuántos hay).
 *
 * El ataque se mide en el artefacto REAL (`next build` + `next start`), en las dos formas en que el servidor entrega la página:
 *  - el HTML, que lleva incrustado el payload RSC (`self.__next_f.push`) con las props de los componentes de cliente y las `key` de cada elemento;
 *  - el payload RSC puro (`RSC: 1`), que es lo que baja la navegación del cliente.
 * En las dos, ningún id sembrado puede aparecer. Se siembra una carta con TODAS las formas que dibujan un id: sección, ítem suelto, ítem agrupado con opciones y promo.
 */
const EMPRESA = "e2e";
/** Un cuid de Prisma: `c` + 24 caracteres alfanuméricos en minúscula. */
const CUID = /\bc[a-z0-9]{24}\b/g;

async function descargas(request: import("@playwright/test").APIRequestContext, ruta: string): Promise<Record<string, string>> {
  const html = await request.get(ruta);
  expect(html.status(), ruta).toBe(200);
  const rsc = await request.get(ruta, { headers: { RSC: "1" } });
  expect(rsc.status(), `${ruta} (RSC)`).toBe(200);
  return { html: await html.text(), rsc: await rsc.text() };
}

test.describe("S-25: la carta pública no emite ids internos", () => {
  test("ni el HTML ni el payload RSC de la carta de una sucursal y del portal llevan un id de sección, producto, ítem agrupado, promo, sucursal o empresa", async ({ request, sucursalId }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-sinids-${marca}`;
    const sucursal = await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId }, select: { empresaId: true } });
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const suelto = await prisma.producto.create({ data: { codigo: `E2E_SINIDS_A_${marca}`, nombre: `E2E Suelto ${marca}`, tipo: "PV", precioVenta: 1000, unidadStockId: unidad.id } });
    const opcion = await prisma.producto.create({ data: { codigo: `E2E_SINIDS_B_${marca}`, nombre: `E2E Opción ${marca}`, tipo: "PV", precioVenta: 900, unidadStockId: unidad.id } });
    const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección ${marca}`, orden: 1 } });
    for (const p of [suelto, opcion]) await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: suelto.id, visibleEnCarta: true, seccionCartaId: seccion.id } });
    const agrupado = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: `E2E Combo ${marca}`, seccionCartaId: seccion.id, orden: 2 } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: agrupado.id, productoId: opcion.id, orden: 0 } });
    const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: seccion.id, titulo: `E2E Promo ${marca}`, precio: 500 } });
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
    const ids: Record<string, string> = {
      seccion: seccion.id,
      productoSuelto: suelto.id,
      productoOpcion: opcion.id,
      itemAgrupado: agrupado.id,
      promo: promo.id,
      sucursal: sucursalId,
      empresa: sucursal.empresaId,
    };

    try {
      for (const ruta of [`/carta-publica/${EMPRESA}/${slug}`, `/carta-publica/${EMPRESA}`]) {
        const cuerpos = await descargas(request, ruta);
        // Sanidad: lo que sí se publica tiene que estar (si no, el test pasaría en vacío sobre una página rota).
        expect(cuerpos.html, ruta).toContain(ruta.endsWith(slug) ? `E2E Suelto ${marca}` : slug);
        for (const [forma, cuerpo] of Object.entries(cuerpos)) {
          const filtrados = Object.entries(ids).filter(([, id]) => cuerpo.includes(id)).map(([clase]) => clase);
          expect(filtrados, `${ruta} (${forma}): estos ids internos salen al anónimo`).toEqual([]);
          const cuids = [...new Set(cuerpo.match(CUID) ?? [])];
          expect(cuids, `${ruta} (${forma}): hay cuid en la salida`).toEqual([]);
        }
      }
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
      await prisma.promoCartaSucursal.deleteMany({ where: { promoCarta: { id: promo.id } } });
      await prisma.promoCarta.delete({ where: { id: promo.id } });
      await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { itemAgrupadoCartaId: agrupado.id } });
      await prisma.itemAgrupadoCarta.delete({ where: { id: agrupado.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: suelto.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [suelto.id, opcion.id] } } });
      await prisma.seccionCarta.delete({ where: { id: seccion.id } });
      await prisma.producto.deleteMany({ where: { id: { in: [suelto.id, opcion.id] } } });
    }
  });
});

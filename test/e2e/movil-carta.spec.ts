import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { borrarRecetasDeReventa, darRecetaDeReventa } from "../setup/receta-de-venta";
import { abrirTodosLosDetails, capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular, ocultarMenuSiHaceFalta } from "./fixtures/movil";

/**
 * MOVIL (pase visual en celular, 375 × 812): la administración de la carta (/carta) y sus formularios de promo (alta, edición, precio de la sucursal, cupos con filas de
 * mín./máx., lugares de entradas, vigencia). En un celular real los formularios «Nueva promo» y de edición se salían por el borde derecho (campos cortados), los pares
 * «Título / Sección de carta», «Precio / Orden» y «Tipo / Nombre / mín. / máx.» iban lado a lado, los botones medían ~30 px y el bloque de «Cupos» (una fila de mín./máx.
 * por sección) era una maraña. Solo layout responsive: la lógica y los textos de negocio de promos no se tocan.
 *
 * Mide, no mira: `scrollWidth <= clientWidth` con todas las fichas abiertas, que cada campo y botón de los formularios mida >= 44 px de alto, que los pares se apilen
 * (misma columna: el segundo campo del par queda debajo del primero) y axe 0.
 */
async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccionE2E = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: "Depósito E2E" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const gaseosa = await prisma.producto.create({ data: { codigo: `E2E-MC-GAS-${m}`, nombre: `E2E Gaseosa móvil ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 1500 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: gaseosa.id, disponible: true } });
  const reventa = await darRecetaDeReventa(prisma, gaseosa, { sucursalIds: [sucursalId], stock: { cantidad: 100, seccionIds: [seccionE2E.id], usuarioId: admin.id } });
  const nombresDeSecciones = ["Entradas y empanadas", "Platos principales de la casa", "Guarniciones", "Postres caseros", "Bebidas sin alcohol"].map((n) => `E2E ${n} ${m}`);
  const secciones = [];
  for (const [i, nombre] of nombresDeSecciones.entries()) secciones.push(await prisma.seccionCarta.create({ data: { nombre, orden: i + 1 } }));
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: gaseosa.id, visibleEnCarta: true, seccionCartaId: secciones[4]!.id, orden: 1 } });
  const titulo = `E2E Combo de la casa con bebida y postre ${m}`;
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId, activa: true } }, seccionCartaId: secciones[1]!.id, titulo, precio: 12500 } });
  for (const [i, s] of secciones.slice(0, 3).entries()) await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, seccionCartaId: s.id, cantidadMinima: i, cantidadMaxima: i + 1, orden: i } });
  const lista = await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, tipo: "LISTA", nombre: "Bebida", cantidadMinima: 1, cantidadMaxima: 1, orden: 10 } });
  await prisma.entradaDeCupo.create({ data: { cupoId: lista.id, productoId: gaseosa.id } });
  await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, tipo: "DEL_DIA", nombre: "Plato del día", cantidadMinima: 1, cantidadMaxima: 1, orden: 11 } });
  return {
    titulo,
    limpiar: async () => {
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: { startsWith: promo.id } } });
      await prismaAdmin.entradaDeCupo.deleteMany({ where: { cupo: { promoCartaId: promo.id } } });
      await prismaAdmin.promoCartaCupo.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCartaSucursal.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: gaseosa.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: { in: secciones.map((s) => s.id) } } });
      await borrarRecetasDeReventa(prisma, { pvIds: [gaseosa.id], mpIds: [reventa.id] });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: gaseosa.id } });
      await prisma.producto.deleteMany({ where: { id: gaseosa.id } });
    },
  };
}

test("administración de la carta en celular (375 px): formularios de promo sin desborde, campos y botones de 44 px, pares apilados, cupos legibles", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  try {
    await fijarCelular(page);
    await page.goto("/carta");
    await expect(page.getByRole("heading", { name: "Promos" })).toBeVisible();
    await ocultarMenuSiHaceFalta(page);
    await expectSinDesborde(page, "carta con las fichas cerradas");
    await abrirTodosLosDetails(page);
    await capturar(page, "carta-fichas-abiertas");
    await expectSinDesborde(page, "carta con todas las fichas abiertas");

    // «Nueva promo» y la edición de la promo: los pares quedan uno debajo del otro, a todo el ancho.
    const promo = page.locator(`[data-promo-carta="${d.titulo}"]`);
    const formEdicion = promo.locator("form", { has: page.getByRole("button", { name: "Guardar promo" }) });
    const nueva = page.locator("form", { has: page.getByRole("button", { name: "Crear promo" }) });
    for (const [nombre, form] of [["edición de la promo", formEdicion], ["Nueva promo", nueva]] as const) {
      const caja = async (campo: string) => (await form.locator(`[name="${campo}"]`).boundingBox())!;
      const [titulo, seccion, precio, orden] = [await caja("titulo"), await caja("seccionCartaId"), await caja("precio"), await caja("orden")];
      expect.soft(seccion.y, `${nombre}: «Sección de carta» debajo de «Título» (no al lado)`).toBeGreaterThan(titulo.y + titulo.height - 1);
      expect.soft(orden.y, `${nombre}: «Orden» debajo de «Precio» (no al lado)`).toBeGreaterThan(precio.y + precio.height - 1);
      for (const [campo, c] of [["titulo", titulo], ["seccionCartaId", seccion], ["precio", precio], ["orden", orden]] as const) {
        expect.soft(c.x + c.width, `${nombre}: el campo «${campo}» entra en la pantalla`).toBeLessThanOrEqual(375);
      }
    }
    await capturar(page, "carta-promo-formularios");

    // Los cupos: cada fila (sección o lugar) con su nombre arriba y mín./máx. debajo, sin cortarse.
    const filas = promo.locator("[data-cupo-seccion], [data-cupo-lugar]");
    expect(await filas.count()).toBe(7); // 5 secciones + «Bebida» + «Plato del día»
    for (const fila of await filas.all()) {
      const cajaFila = (await fila.boundingBox())!;
      for (const input of await fila.locator('input[type="number"]').all()) {
        const c = (await input.boundingBox())!;
        expect.soft(c.x + c.width, "cupo: mín./máx. dentro de la pantalla").toBeLessThanOrEqual(375);
        expect.soft(c.x, "cupo: mín./máx. dentro de su fila").toBeGreaterThanOrEqual(cajaFila.x - 1);
      }
    }
    await capturar(page, "carta-cupos");
    const sumar = promo.locator("fieldset", { hasText: "Sumar un lugar" });
    const [tipo, nombre, min, max] = await Promise.all(["nuevo_lugar_tipo", "nuevo_lugar_nombre", "nuevo_lugar_min", "nuevo_lugar_max"].map(async (n) => (await sumar.locator(`[name="${n}"]`).boundingBox())!));
    expect.soft(nombre.y, "«Nombre» del lugar nuevo debajo de «Tipo»").toBeGreaterThan(tipo.y + tipo.height - 1);
    expect.soft(Math.abs(min.y - max.y), "mín. y máx. del lugar nuevo, en el mismo renglón").toBeLessThan(2);

    // Objetivos táctiles: cada campo, botón y resumen desplegable de la pantalla mide >= 44 px de alto; las casillas, su fila.
    const controles = page.locator("main").locator("button, select, textarea, summary, input:not([type=checkbox]):not([type=hidden])");
    await expectObjetivosTactiles(controles, "carta: campos, botones y resúmenes", { ancho: 0 });
    await expectObjetivosTactiles(page.locator("main label:has(input[type=checkbox])"), "carta: filas con casilla", { ancho: 0 });
    expect((await new AxeBuilder({ page }).analyze()).violations, "carta en celular").toEqual([]);
  } finally {
    await d.limpiar();
  }
});

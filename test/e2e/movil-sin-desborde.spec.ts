import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { capturar, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * MOVIL: guardián barato contra la regresión del celular. Recorre las pantallas principales a 375 × 812 y mide que la página NO se salga por la derecha (`scrollWidth <= clientWidth`); si un
 * cambio futuro hace que una pantalla desborde en el celular, este spec lo dice con la pantalla y los elementos que se salen. No siembra nada pesado: mide lo que cada pantalla muestra con
 * los datos de la base de pruebas (los casos con datos que hacen desbordar viven en los specs `movil-*` de cada pantalla). La mesa del salón se abre con una cuenta vacía.
 *
 * Pantallas: /inicio, /catalogo/opciones, /catalogo/productos, /movimientos/opciones-agotadas, /movimientos/precio-local, /carta (y su Parametrización, CARTA-MANT) y la mesa del POS.
 */
const PANTALLAS = ["/inicio", "/catalogo/opciones", "/catalogo/productos", "/movimientos/opciones-agotadas", "/movimientos/precio-local", "/carta", "/carta/parametrizacion", "/carta/parametrizacion/secciones"];

test("celular (375 px): ninguna de las pantallas principales se sale por la derecha", async ({ paginaAutenticada: page, sucursalId }) => {
  test.setTimeout(240_000); // con el servidor de desarrollo la primera visita de cada pantalla compila
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 7800 + Math.floor(Math.random() * 90) } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  try {
    await fijarCelular(page);
    for (const ruta of [...PANTALLAS, `/mesas/${mesa.id}`]) {
      await page.goto(ruta);
      await expect(page.locator("main").first(), `${ruta}: la pantalla cargó`).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expectSinDesborde(page, ruta);
    }
    await capturar(page, "guardian-mesa");
  } finally {
    await prismaAdmin.agregadoDeCuenta.deleteMany({ where: { cuentaId: cuenta.id } });
    await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
  }
});

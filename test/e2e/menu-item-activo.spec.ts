import { test, expect } from "./fixtures/auth";

/**
 * El menú resalta UN solo ítem: el de la pantalla abierta. Antes quedaban dos (el ítem y el que era prefijo de su ruta) en
 * /carta/tema, /traspasos/enviar y /reportes/rendimiento-recetas/por-sucursal, y ninguno llevaba `aria-current`.
 */
const CASOS = [
  { ruta: "/carta/tema", nombre: "Tema de la carta" },
  { ruta: "/traspasos/enviar", nombre: "Enviar directo" },
  { ruta: "/reportes/rendimiento-recetas/por-sucursal", nombre: "Rendimiento por sucursal" },
];

for (const { ruta, nombre } of CASOS) {
  test(`menú: en ${ruta} hay un solo ítem activo y es «${nombre}»`, async ({ paginaAutenticada: page }) => {
    await page.goto(ruta);
    const activos = page.locator('nav a[aria-current="page"]');
    await expect(activos).toHaveCount(1);
    await expect(activos).toHaveText(nombre);
  });
}

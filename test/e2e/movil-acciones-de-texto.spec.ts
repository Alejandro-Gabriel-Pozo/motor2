import { test, expect } from "./fixtures/auth";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";
import { capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * MOVIL (pase visual en celular, 375 × 812): los enlaces y botones de texto de acción de las tablas y listas del panel («Renombrar», «Desactivar», «+ Nuevo grupo», «Habilitar»…)
 * medían 16–21 px de alto: imposibles de tocar con el dedo sin errar. En celular (< 768 px) cada uno mide >= 44 px de alto, sin cambiar su aspecto en escritorio.
 *
 * Mide, no mira: en cada pantalla, todo botón de `main` y todo enlace que es una ACCIÓN de una celda o de un ítem de lista (hijo directo de `td`, `th`, `li` o `dd`; los enlaces dentro de una
 * oración están exentos del criterio) mide >= 44 px de alto a 375 px; y a 1280 px los botones de texto siguen midiendo lo mismo que antes (< 44 px: no se agrandaron en escritorio).
 */
const PANTALLAS = ["/catalogo/opciones", "/catalogo/productos", "/catalogo/categorias", "/catalogo/unidades", "/catalogo/proveedores", "/catalogo/clientes", "/administracion/usuarios", "/administracion/sucursales"];
// Las pantallas cuya página no debe salirse por la derecha (las del guardián de `movil-sin-desborde.spec.ts`); las otras tablas anchas del panel quedan fuera de este pase.
const DESBORDE_CONTROLADO = ["/catalogo/opciones", "/catalogo/productos", "/catalogo/opciones/[grupoId]"];
const ACCIONES = "main button:not([role=combobox]):not([type=checkbox]), main :is(td, th, li, dd) > a";

test("acciones de texto de las tablas y listas del panel en celular: 44 px de alto, y en escritorio no se agrandan", async ({ paginaAutenticada: page, sucursalId }) => {
  test.setTimeout(240_000); // recorre nueve pantallas (con el servidor de desarrollo, la primera visita de cada una compila)
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const grupo = await sembrarGrupo({ nombre: `E2E Tamaño acciones móvil ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chico", factorEscala: 1 }, { nombre: "Grande", factorEscala: 1.5 }] });
  await sembrarProductoConOpciones({ nombre: `E2E Café acciones móvil ${m}`, codigo: `E2E-AM-${m}`, precioVenta: 2500, sucursalId, grupos: [{ grupo }] });
  await fijarCelular(page);
  for (const ruta of [...PANTALLAS, `/catalogo/opciones/${grupo.grupoId}`]) {
    await page.goto(ruta);
    await expect(page.locator("main")).toBeVisible();
    if (DESBORDE_CONTROLADO.includes(ruta.replace(/\/[a-z0-9]{20,}$/, "/[grupoId]"))) await expectSinDesborde(page, ruta);
    await capturar(page, `acciones${ruta.replace(/\//g, "-")}`);
    await expectObjetivosTactiles(page.locator(ACCIONES), `${ruta}: acciones de texto`, { ancho: 0 });
  }
  // «+ Nuevo grupo» (el botón que abre el alta) y el botón de «Renombrar» de una opción.
  await page.goto("/catalogo/opciones");
  await expectObjetivosTactiles(page.getByRole("button", { name: "+ Nuevo grupo" }), "«+ Nuevo grupo»", { ancho: 0 });

  // En escritorio, sin cambios: los botones de texto siguen siendo chicos (no se agrandó nada).
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/catalogo/opciones");
  const nuevo = (await page.getByRole("button", { name: "+ Nuevo grupo" }).boundingBox())!;
  expect(nuevo.height, "«+ Nuevo grupo» en escritorio, como siempre").toBeLessThan(30);
});

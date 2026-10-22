import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";
import { capturar, expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";

/**
 * OPCIONES-FACTOR: el campo «El factor» de un tamaño (`/catalogo/opciones/[grupoId]`, en «Cambiar precio o consumo» y en el alta) dice en vivo qué quiere decir el número que se tipea
 * («Factor 1,3 = lleva 30% más que el tamaño base») y, a quien ve las recetas, cómo cambia lo que descuenta la receta del primer producto que usa el grupo («0,25 kg → 0,325 kg»). Sin
 * el «Ver» de las recetas, solo la frase. A 375 × 812 y a 1280 × 900, con axe y sin desborde. La base E2E la comparten los specs: todo lo propio va con su marca y se busca por nombre.
 * Solo lectura: no se guarda nada (lo que se guarda y su validación no cambian).
 */
const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const PANTALLAS = [
  { nombre: "celular", ancho: 375, alto: 812 },
  { nombre: "escritorio", ancho: 1280, alto: 900 },
] as const;

/** Un grupo de tamaños con «Grande» (×1,5) y un producto que lo usa, con su receta central: 0,25 kg de harina y 0,1 kg de queso. */
async function sembrarPizza(sucursalId: string, m: string) {
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const harina = await prisma.producto.create({ data: { codigo: `E2E-FAC-HAR-${m}`, nombre: `E2E Harina ${m}`, tipo: "MP", unidadStockId: kg.id } });
  const queso = await prisma.producto.create({ data: { codigo: `E2E-FAC-QUE-${m}`, nombre: `E2E Queso ${m}`, tipo: "MP", unidadStockId: kg.id } });
  const grupo = await sembrarGrupo({ nombre: `E2E Tamaño pizza ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Común", factorEscala: 1 }, { nombre: "Grande", monto: 800, factorEscala: 1.5 }] });
  const nombre = `E2E Pizza factor ${m}`;
  const { productoId } = await sembrarProductoConOpciones({ nombre, codigo: `E2E-FAC-PZ-${m}`, precioVenta: 6000, sucursalId, grupos: [{ grupo }] });
  await prisma.recetaVersion.create({
    data: { productoId, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 0.25, unidadId: kg.id }, { insumoProductoId: queso.id, cantidad: 0.1, unidadId: kg.id }] } },
  });
  return { grupo, nombre, harina: harina.nombre, queso: queso.nombre };
}

/** Tipear en un `CampoNumero` que ya tiene valor: primero el foco (el campo pasa a mostrar el número crudo y lo selecciona) y después el texto nuevo, que lo reemplaza. */
async function tipear(campo: Locator, texto: string) {
  await campo.click();
  await campo.fill(texto);
}

async function abrirCambioDeGrande(page: Page, grupoId: string) {
  await page.goto(`/catalogo/opciones/${grupoId}`);
  const fila = page.locator("[data-opcion='Grande']");
  await fila.getByRole("button", { name: "Cambiar precio o consumo de Grande" }).click();
  return fila;
}

for (const pantalla of PANTALLAS) {
  test(`${pantalla.nombre}: el factor dice cuánto más o menos lleva y cómo cambia la receta, mientras se tipea`, async ({ paginaAutenticada: page, sucursalId }) => {
    const m = marca();
    const pizza = await sembrarPizza(sucursalId, m);
    await page.setViewportSize({ width: pantalla.ancho, height: pantalla.alto });
    const fila = await abrirCambioDeGrande(page, pizza.grupo.grupoId);
    const lectura = fila.locator("[data-lectura-del-factor]");
    const factor = fila.getByLabel("Cuánto consume respecto del tamaño base");

    // Arranca con lo que rige (1,5) y la ayuda de siempre a la vista.
    await expect(factor).toHaveValue("1,5");
    await expect(fila).toContainText("Cuánto consume este tamaño respecto del base: 1 = igual, 1,5 = 50% más, 0,7 = 30% menos (máximo 10).");
    await expect(lectura.locator("[data-frase-del-factor]")).toHaveText("Factor 1,5 = lleva 50% más que el tamaño base");
    await expect(lectura.locator("[data-frase-del-factor]")).toHaveAttribute("aria-live", "polite");

    // 1,3: «30% más» y la receta del producto que usa el grupo, antes → después.
    await tipear(factor, "1,3");
    await expect(lectura.locator("[data-frase-del-factor]")).toHaveText("Factor 1,3 = lleva 30% más que el tamaño base");
    const receta = lectura.locator("[data-receta-del-factor]");
    await expect(receta.getByRole("heading", { name: `Cómo cambia la receta de «${pizza.nombre}»` })).toBeVisible();
    const harina = receta.locator(`[data-ingrediente-del-factor='${pizza.harina}']`);
    const queso = receta.locator(`[data-ingrediente-del-factor='${pizza.queso}']`);
    await expect(harina).toContainText("0,25 kg");
    await expect(harina.locator("strong")).toHaveText("0,325 kg");
    await expect(queso).toContainText("0,1 kg");
    await expect(queso.locator("strong")).toHaveText("0,13 kg");
    await expect(receta).toContainText("se multiplica por el factor solo si marcás");
    await expectSinDesborde(page, `${pantalla.nombre}: factor 1,3`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "factor 1,3").toEqual([]);
    await capturar(page, `opciones-factor-${pantalla.nombre}-1-3`);

    // 0,7: «30% menos».
    await tipear(factor, "0,7");
    await expect(lectura.locator("[data-frase-del-factor]")).toHaveText("Factor 0,7 = lleva 30% menos que el tamaño base");
    await expect(harina.locator("strong")).toHaveText("0,175 kg");
    await expect(queso.locator("strong")).toHaveText("0,07 kg");
    await expectSinDesborde(page, `${pantalla.nombre}: factor 0,7`);
    await capturar(page, `opciones-factor-${pantalla.nombre}-0-7`);

    // Fuera de rango: solo el aviso, sin tabla; nada se guardó.
    await tipear(factor, "12");
    await expect(lectura.locator("[data-frase-del-factor]")).toHaveText("El factor puede ser hasta 10 (10 veces lo que lleva el tamaño base).");
    await expect(receta).toHaveCount(0);
    expect(await prisma.versionDeOpcion.count({ where: { opcionId: pizza.grupo.opciones["Grande"]!.opcionId } })).toBe(1);

    // El alta de una opción nueva lee el factor igual (arranca en 1: «lo mismo»).
    await page.getByRole("button", { name: "+ Agregar opción" }).click();
    const alta = page.getByRole("button", { name: "Agregar opción", exact: true }).locator("xpath=ancestor::form[1]");
    const lecturaAlta = alta.locator("[data-lectura-del-factor]");
    await expect(lecturaAlta.locator("[data-frase-del-factor]")).toHaveText("Factor 1 = lleva lo mismo que el tamaño base");
    await tipear(alta.getByLabel("Cuánto consume respecto del tamaño base"), "2");
    await expect(lecturaAlta.locator("[data-frase-del-factor]")).toHaveText("Factor 2 = lleva el doble de lo que lleva el tamaño base (100% más)");
    await expect(lecturaAlta.locator(`[data-ingrediente-del-factor='${pizza.harina}'] strong`)).toHaveText("0,5 kg");
    // La lectura del factor no agrega controles; el botón del alta, a la altura del dedo en el celular.
    if (pantalla.ancho < 768) await expectObjetivosTactiles(alta.getByRole("button", { name: "Agregar opción", exact: true }), `${pantalla.nombre}: el alta`);
    await expectSinDesborde(page, `${pantalla.nombre}: alta con factor 2`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "alta con factor").toEqual([]);
  });
}

/**
 * Sin el «Ver» de las recetas. `opciones_definir` y `guardar_receta` tienen piso administrador: solo el rol «admin» llega, así que se le saca a ESE rol el «Ver» de `guardar_receta` durante el
 * test y se le devuelve al final (los specs corren de a uno, `workers: 1`; y la sesión del admin de cada test lo vuelve a dejar en verdadero, `fixtures/auth.ts`).
 */
test("sin el «Ver» de las recetas, el factor dice solo cuánto más o menos lleva (ni la receta ni sus cantidades)", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const pizza = await sembrarPizza(sucursalId, m);
  const admin = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" }, select: { id: true } });
  const clave = { rolId_accionClave: { rolId: admin.id, accionClave: "guardar_receta" } };
  const antes = await prisma.permisoRol.findUniqueOrThrow({ where: clave, select: { puedeVer: true, puedeEditar: true } });
  await prisma.permisoRol.update({ where: clave, data: { puedeVer: false, puedeEditar: false } });
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    const fila = await abrirCambioDeGrande(page, pizza.grupo.grupoId);
    await tipear(fila.getByLabel("Cuánto consume respecto del tamaño base"), "1,3");
    const lectura = fila.locator("[data-lectura-del-factor]");
    await expect(lectura.locator("[data-frase-del-factor]")).toHaveText("Factor 1,3 = lleva 30% más que el tamaño base");
    await expect(lectura.locator("[data-receta-del-factor]")).toHaveCount(0);
    await expect(fila.getByText("0,325 kg")).toHaveCount(0);
    await expectSinDesborde(page, "sin recetas: factor 1,3");
    expect((await new AxeBuilder({ page }).analyze()).violations, "sin recetas").toEqual([]);
    await capturar(page, "opciones-factor-celular-sin-receta");
  } finally {
    await prisma.permisoRol.update({ where: clave, data: antes });
  }
});

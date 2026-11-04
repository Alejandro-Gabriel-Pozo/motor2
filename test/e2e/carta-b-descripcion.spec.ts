import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * Carta «B», E3 (2026-11-04), en el navegador y con la base real: el administrador escribe la descripción de una opción en la pantalla del grupo («Guardar descripción», junto a «Renombrar»), y la carta pública
 * la muestra en un desplegable «Ver detalle ▾» por bloque (cerrado al llegar, con los nombres siempre a la vista), que se abre con el clic; en papel va siempre visible. Vaciarla saca el desplegable. Dos pestañas
 * que guardan sobre la misma versión no se pisan. La descripción NO sale en ningún otro lado de la carta (ni en la línea del plato).
 */
const EMPRESA = "e2e";

test("la descripción de una opción: se escribe en la administración, se ve en «Ver detalle» de la carta y en papel, y vaciarla la saca", async ({ page, paginaAutenticada: admin, sucursalId }) => {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const slug = `e2e-carta-b-det-${m}`;
  const guarnicion = await sembrarGrupo({ nombre: `Guarnición ${m}`, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Puré" }, { nombre: "Ensalada" }, { nombre: "Papas fritas" }] });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección detalle ${m}` } });
  const bife = `E2E Bife detalle ${m}`;
  const { productoId } = await sembrarProductoConOpciones({ nombre: bife, codigo: `E2E-CBD-${m}`, precioVenta: 20000, sucursalId, grupos: [{ grupo: guarnicion }] });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 0 } });
  await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });

  const abrirCarta = async () => {
    await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
    await page.getByRole("button", { name: new RegExp(seccion.nombre) }).click();
  };
  const bloque = () => page.locator(`[data-bloque-de-opciones='Guarnición ${m}']`);

  try {
    // Sin descripciones: el bloque dice sus opciones y NO hay desplegable.
    await abrirCarta();
    await expect(bloque().locator("[data-rol=eleccion]")).toHaveText("puré · ensalada · papas fritas");
    await expect(bloque().locator("details")).toHaveCount(0);

    // La administración: la descripción de la ensalada, junto a «Renombrar».
    await admin.goto(`/catalogo/opciones/${guarnicion.grupoId}`);
    const fila = admin.locator("[data-opcion='Ensalada']");
    await fila.getByLabel("Descripción en la carta de Ensalada").fill("lechuga, tomate, cebolla");
    await fila.getByRole("button", { name: "Guardar la descripción de Ensalada" }).click();
    await expect(admin.getByRole("status").filter({ hasText: "guardada" })).toBeVisible();
    expect((await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: guarnicion.opciones["Ensalada"]!.opcionId }, select: { descripcionEnCarta: true } })).descripcionEnCarta).toBe("lechuga, tomate, cebolla");

    // La carta (a 375 y a 1280 px): el desplegable cerrado, el rótulo genérico, la descripción al abrir; los nombres siempre a la vista; la línea del plato no la lleva.
    for (const ancho of [375, 1280]) {
      await page.setViewportSize({ width: ancho, height: ancho === 375 ? 812 : 900 });
      await abrirCarta();
      const desplegable = bloque().locator("details[data-detalle-del-bloque]");
      await expect(desplegable.locator("summary")).toHaveText("Ver detalle ▾");
      await expect(bloque().locator("[data-rol=eleccion]")).toHaveText("puré · ensalada · papas fritas");
      expect(await desplegable.evaluate((el: HTMLDetailsElement) => el.open), `cerrado al llegar (${ancho} px)`).toBe(false);
      // Cerrado, el texto está en el HTML pero no se ve.
      await expect(desplegable.getByText("lechuga, tomate, cebolla")).toBeHidden();
      await desplegable.locator("summary").click();
      await expect(desplegable.getByText("lechuga, tomate, cebolla")).toBeVisible();
      await expect(desplegable).toContainText("ensalada · lechuga, tomate, cebolla");
      await expect(page.locator("[data-incluye]").first()).not.toContainText("lechuga");
      expect((await new AxeBuilder({ page }).include("[data-bloque-de-opciones]").analyze()).violations, `axe del bloque (${ancho} px)`).toEqual([]);
    }

    // En papel las descripciones van siempre visibles y el desplegable no se ve.
    await page.emulateMedia({ media: "print" });
    await expect(bloque().locator("[data-detalle-en-papel]")).toContainText("ensalada · lechuga, tomate, cebolla");
    await expect(bloque().locator("details")).toBeHidden();
    await page.emulateMedia({ media: "screen" });

    // Dos pestañas sobre la misma versión: gana la primera; la segunda recibe el aviso y la descripción no se pierde.
    const pestañaA = admin;
    const pestañaB = await admin.context().newPage();
    await pestañaA.goto(`/catalogo/opciones/${guarnicion.grupoId}`);
    await pestañaB.goto(`/catalogo/opciones/${guarnicion.grupoId}`);
    await pestañaA.locator("[data-opcion='Puré']").getByLabel("Descripción en la carta de Puré").fill("de papa, con manteca");
    await pestañaA.locator("[data-opcion='Puré']").getByRole("button", { name: "Guardar la descripción de Puré" }).click();
    await expect(pestañaA.getByRole("status").filter({ hasText: "guardada" })).toBeVisible();
    await pestañaB.locator("[data-opcion='Puré']").getByLabel("Descripción en la carta de Puré").fill("de otra cosa");
    await pestañaB.locator("[data-opcion='Puré']").getByRole("button", { name: "Guardar la descripción de Puré" }).click();
    await expect(pestañaB.getByRole("alert").filter({ hasText: "cambió mientras la editabas" })).toBeVisible();
    expect((await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: guarnicion.opciones["Puré"]!.opcionId }, select: { descripcionEnCarta: true } })).descripcionEnCarta).toBe("de papa, con manteca");
    await pestañaB.close();

    // Una descripción con HTML o con un salto de línea se rechaza con un mensaje, sin guardar.
    await admin.goto(`/catalogo/opciones/${guarnicion.grupoId}`);
    const filaPapas = admin.locator("[data-opcion='Papas fritas']");
    await filaPapas.getByLabel("Descripción en la carta de Papas fritas").fill("<b>crocantes</b>");
    await filaPapas.getByRole("button", { name: "Guardar la descripción de Papas fritas" }).click();
    await expect(admin.getByRole("alert").filter({ hasText: "caracteres no permitidos" })).toBeVisible();
    expect((await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: guarnicion.opciones["Papas fritas"]!.opcionId }, select: { descripcionEnCarta: true } })).descripcionEnCarta).toBeNull();

    // Vaciarlas: el desplegable desaparece.
    for (const nombre of ["Ensalada", "Puré"]) {
      await admin.goto(`/catalogo/opciones/${guarnicion.grupoId}`);
      const f = admin.locator(`[data-opcion='${nombre}']`);
      await f.getByLabel(`Descripción en la carta de ${nombre}`).fill("");
      await f.getByRole("button", { name: `Guardar la descripción de ${nombre}` }).click();
      await expect(admin.getByRole("status").filter({ hasText: "guardada" })).toBeVisible();
    }
    await abrirCarta();
    await expect(bloque().locator("details")).toHaveCount(0);
    await expect(bloque().locator("[data-rol=eleccion]")).toHaveText("puré · ensalada · papas fritas");
  } finally {
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { seccionCartaId: seccion.id } });
  }
});

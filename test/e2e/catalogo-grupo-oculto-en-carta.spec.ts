import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * «Mostrar este grupo en la carta» (decisión del dueño, 2026-10-29: plato por plato), en la pantalla de un producto (`/catalogo/productos/[id]/opciones`, Editar de `producto_opciones_admitidas`):
 * el caso del dueño («vendo solo Bife y le pregunto al cliente si quiere ojo de bife o bife de chorizo, pero que no salga en la carta»). A 1280 y a 375 px, con axe:
 *  - destildar «Mostrar este grupo en la carta» y guardar: la tarjeta dice «no se muestra en la carta», la vista previa pierde la línea «Corte:» y la carta pública muestra solo «Bife $20.000»;
 *  - recargar: la casilla sigue destildada; una sola fila de auditoría del interruptor;
 *  - con el grupo oculto, cargar +$2.000 a «Ojo de bife» en la misma tarjeta se rechaza y explica cuál opción cambia el precio;
 *  - un recargo posterior desde otro camino (la Biblioteca) no se bloquea: la pantalla avisa en amarillo y vuelve a salir sola cuando el recargo vuelve a 0;
 *  - dos pestañas: la vieja se rechaza con «cambió mientras lo editabas».
 * Lo sembrado de opciones no se borra (ver `fixtures/opciones.ts`).
 */
const EMPRESA = "e2e";
const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

/** El bife del dueño: un producto de $20.000 con el grupo «Corte» (variante obligatoria, sin recargo), publicado en una carta propia de la sucursal. */
async function sembrarBife(m: string, sucursalId: string, opciones: { ocultoDeEntrada?: boolean } = {}) {
  const corte = await sembrarGrupo({ nombre: `E2E Corte ${m}`, tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Ojo de bife" }, { nombre: "Bife de chorizo" }] });
  const nombre = `E2E Bife ${m}`;
  const { productoId } = await sembrarProductoConOpciones({ nombre, codigo: `E2E-GOC-${m}`, precioVenta: 20000, sucursalId, grupos: [{ grupo: corte }] });
  // Apagar el interruptor es una escritura de la app (columna actualizable de `motor2_app`); el rol de pruebas de la siembra no la tiene: se hace como dueño.
  if (opciones.ocultoDeEntrada) await prismaAdmin.productoAdmiteGrupo.updateMany({ where: { productoId, grupoId: corte.grupoId }, data: { seMuestraEnCarta: false } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección bife ${m}` } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 0 } });
  const slug = `e2e-bife-${m}`;
  await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
  return { productoId, nombre, grupo: corte, grupoNombre: `E2E Corte ${m}`, seccionNombre: seccion.nombre, slug };
}

const tarjeta = (page: Page, grupoNombre: string) => page.locator(`[data-admision-grupo='${grupoNombre}']`);
const vistaPrevia = (page: Page) => page.locator("[data-vista-previa-de-la-carta]");

for (const ancho of [1280, 375]) {
  test(`a ${ancho} px: destildar «Mostrar este grupo en la carta», guardar, recargar; la vista previa y la carta pública muestran solo «Bife $20.000»`, async ({ paginaAutenticada: page, sucursalId }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    const m = marca();
    const bife = await sembrarBife(m, sucursalId);
    await page.goto(`/catalogo/productos/${bife.productoId}/opciones`);
    const grupo = tarjeta(page, bife.grupoNombre);
    const casilla = grupo.getByLabel("Mostrar este grupo en la carta");
    await expect(casilla).toBeChecked();
    await expect(vistaPrevia(page)).toContainText(`Corte`);
    await expect(vistaPrevia(page)).toContainText("ojo de bife o bife de chorizo");
    expect((await new AxeBuilder({ page }).analyze()).violations, "con la casilla tildada").toEqual([]);

    await casilla.uncheck();
    await grupo.getByRole("button", { name: `Guardar «${bife.grupoNombre}»` }).click();
    await expect(grupo.getByRole("status").filter({ hasText: "como pediste" })).toBeVisible();
    await expect(grupo).toContainText("no se muestra en la carta");
    await expect(vistaPrevia(page)).toContainText(`${bife.nombre} con su precio`);
    await expect(vistaPrevia(page)).not.toContainText("ojo de bife");
    expect((await new AxeBuilder({ page }).analyze()).violations, "con la casilla destildada").toEqual([]);

    await page.reload();
    await expect(tarjeta(page, bife.grupoNombre).getByLabel("Mostrar este grupo en la carta")).not.toBeChecked();
    expect(await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: bife.productoId }, select: { seMuestraEnCarta: true, version: true } })).toEqual({ seMuestraEnCarta: false, version: 2 });
    const grupoFila = await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: bife.productoId }, select: { id: true } });
    expect(await prisma.registroAuditoria.count({ where: { entidad: "ProductoAdmiteGrupo", entidadId: grupoFila.id, campo: "seMuestraEnCarta" } })).toBe(1);

    // La carta pública (el guardado invalidó su caché): «Bife $20.000», sin la línea del corte.
    await page.goto(`/carta-publica/${EMPRESA}/${bife.slug}`);
    await page.getByRole("button", { name: new RegExp(bife.seccionNombre) }).click();
    const item = page.locator("li", { has: page.getByRole("heading", { name: bife.nombre }) });
    await expect(item).toContainText("$20.000");
    await expect(item).not.toContainText("Corte");
    await expect(item).not.toContainText("ojo de bife");
    expect((await new AxeBuilder({ page }).analyze()).violations, "la carta pública").toEqual([]);

    // Y se puede volver a mostrar.
    await page.goto(`/catalogo/productos/${bife.productoId}/opciones`);
    await tarjeta(page, bife.grupoNombre).getByLabel("Mostrar este grupo en la carta").check();
    await tarjeta(page, bife.grupoNombre).getByRole("button", { name: `Guardar «${bife.grupoNombre}»` }).click();
    await expect(tarjeta(page, bife.grupoNombre).getByRole("status").filter({ hasText: "como pediste" })).toBeVisible();
    await expect(tarjeta(page, bife.grupoNombre)).not.toContainText("no se muestra en la carta");
    await expect(vistaPrevia(page)).toContainText("ojo de bife o bife de chorizo");
    expect((await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: bife.productoId }, select: { seMuestraEnCarta: true } })).seMuestraEnCarta).toBe(true);
  });
}

test("con el grupo oculto, cargar +$2.000 a «Ojo de bife» en la misma tarjeta se rechaza y dice cuál opción cambia el precio", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const bife = await sembrarBife(m, sucursalId, { ocultoDeEntrada: true });
  await page.goto(`/catalogo/productos/${bife.productoId}/opciones`);
  const grupo = tarjeta(page, bife.grupoNombre);
  await expect(grupo.getByLabel("Mostrar este grupo en la carta")).not.toBeChecked();
  await grupo.getByLabel("Cómo se cobra Ojo de bife en este producto").selectOption("MONTO");
  await grupo.getByLabel("Diferencia en pesos de Ojo de bife").fill("2000");
  await grupo.getByRole("button", { name: `Guardar «${bife.grupoNombre}»` }).click();
  const rechazo = grupo.getByRole("alert").filter({ hasText: "ninguna opción puede cambiar el precio" });
  await expect(rechazo).toBeVisible();
  await expect(rechazo).toContainText("«Ojo de bife» cambia el precio");
  await expect(rechazo).toContainText("Dejala sin recargo o mostralo en la carta");
  expect((await new AxeBuilder({ page }).analyze()).violations, "con el rechazo a la vista").toEqual([]);
  // Nada se guardó: la opción sigue sin diferencia propia y el grupo, oculto y en la misma versión.
  expect(await prisma.productoAdmiteOpcion.count({ where: { productoId: bife.productoId, tipoDeDiferencia: { not: null } } })).toBe(0);
  expect(await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: bife.productoId }, select: { seMuestraEnCarta: true, version: true } })).toEqual({ seMuestraEnCarta: false, version: 1 });

  // Tildando la casilla en el mismo formulario, el recargo sí entra (el grupo vuelve a mostrarse en la carta).
  await grupo.getByLabel("Mostrar este grupo en la carta").check();
  await grupo.getByRole("button", { name: `Guardar «${bife.grupoNombre}»` }).click();
  await expect(grupo.getByRole("status").filter({ hasText: "como pediste" })).toBeVisible();
  expect(await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: bife.productoId }, select: { seMuestraEnCarta: true } })).toEqual({ seMuestraEnCarta: true });
});

test("un recargo posterior desde la Biblioteca no se bloquea: la pantalla avisa en amarillo y, con el recargo de vuelta en 0, el aviso desaparece solo", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const bife = await sembrarBife(m, sucursalId, { ocultoDeEntrada: true });
  const ojo = bife.grupo.opciones["Ojo de bife"]!;
  const admin = await prisma.user.findFirstOrThrow({ where: { email: "e2e-admin@local.test" }, select: { id: true } });
  await page.goto(`/catalogo/productos/${bife.productoId}/opciones`);
  await expect(page.locator("[data-grupo-oculto-con-precio]")).toHaveCount(0);
  await expect(tarjeta(page, bife.grupoNombre)).toContainText("no se muestra en la carta");

  await prisma.versionDeOpcion.create({ data: { opcionId: ojo.opcionId, numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "2000.00", creadoPorId: admin.id } });
  await page.reload();
  const aviso = page.locator("[data-grupo-oculto-con-precio]");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("«Ojo de bife» cambia el precio: la carta lo muestra igual para no anunciar un precio que no es");
  await expect(tarjeta(page, bife.grupoNombre)).not.toContainText("· no se muestra en la carta");
  await expect(vistaPrevia(page)).toContainText("Ojo de bife");
  expect((await new AxeBuilder({ page }).analyze()).violations, "con el aviso").toEqual([]);
  expect((await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: bife.productoId }, select: { seMuestraEnCarta: true } })).seMuestraEnCarta, "no se escribió nada").toBe(false);

  await prisma.versionDeOpcion.create({ data: { opcionId: ojo.opcionId, numero: 3, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: admin.id } });
  await page.reload();
  await expect(page.locator("[data-grupo-oculto-con-precio]")).toHaveCount(0);
  await expect(tarjeta(page, bife.grupoNombre)).toContainText("no se muestra en la carta");
});

test("dos pestañas: la vieja arrastra la versión de antes y se rechaza con «cambió mientras lo editabas»; no pisa lo que guardó la otra", async ({ paginaAutenticada: pestañaA, sucursalId }) => {
  const m = marca();
  const bife = await sembrarBife(m, sucursalId);
  const pestañaB = await pestañaA.context().newPage();
  await pestañaA.goto(`/catalogo/productos/${bife.productoId}/opciones`);
  await pestañaB.goto(`/catalogo/productos/${bife.productoId}/opciones`);

  await tarjeta(pestañaA, bife.grupoNombre).getByLabel("Mostrar este grupo en la carta").uncheck();
  await tarjeta(pestañaA, bife.grupoNombre).getByRole("button", { name: `Guardar «${bife.grupoNombre}»` }).click();
  await expect(tarjeta(pestañaA, bife.grupoNombre).getByRole("status").filter({ hasText: "como pediste" })).toBeVisible();

  await tarjeta(pestañaB, bife.grupoNombre).getByLabel("Orden en el producto").fill("50");
  await tarjeta(pestañaB, bife.grupoNombre).getByRole("button", { name: `Guardar «${bife.grupoNombre}»` }).click();
  await expect(tarjeta(pestañaB, bife.grupoNombre).getByRole("alert").filter({ hasText: "cambió mientras lo editabas" })).toBeVisible();
  expect(await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: bife.productoId }, select: { seMuestraEnCarta: true, orden: true } })).toEqual({ seMuestraEnCarta: false, orden: 0 });
});

test("un tamaño y un adicional no tienen la casilla (cambian el precio)", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const tamano = await sembrarGrupo({ nombre: `E2E Tamaño ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chico" }, { nombre: "Grande", monto: 500 }] });
  const extras = await sembrarGrupo({ nombre: `E2E Extras ${m}`, tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2, marca: m, opciones: [{ nombre: "Huevo frito", monto: 600, conAncla: true }] });
  const { productoId } = await sembrarProductoConOpciones({ nombre: `E2E Plato ${m}`, codigo: `E2E-GOT-${m}`, precioVenta: 9000, sucursalId, grupos: [{ grupo: tamano }, { grupo: extras }] });
  await page.goto(`/catalogo/productos/${productoId}/opciones`);
  await expect(tarjeta(page, `E2E Tamaño ${m}`)).toBeVisible();
  await expect(tarjeta(page, `E2E Extras ${m}`)).toBeVisible();
  await expect(page.getByLabel("Mostrar este grupo en la carta")).toHaveCount(0);
});

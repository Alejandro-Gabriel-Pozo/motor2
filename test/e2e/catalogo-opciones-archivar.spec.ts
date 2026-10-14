import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";
import { capturar, expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";

/**
 * OPCIONES-LIMPIEZA (decisión del dueño, 2026-10-14): gestionar SIN MIEDO lo que compone la venta. En el celular (375 × 812) y en escritorio (1280 × 900):
 *  - archivar una opción y un grupo es UN toque, sin pantalla de confirmación, con el aviso abajo y «Deshacer» a la vista (fijo: aunque la fila ya se haya ido a «Archivados»);
 *  - lo archivado queda aparte («Opciones archivadas», «Archivados» de la lista) y vuelve con «Restaurar»;
 *  - quitar un grupo de un producto («Quitar de este producto») no borra nada: pasa a «Quitados de este producto» y vuelve con «Volver a vincular» o con «Deshacer».
 * Mide: sin desborde horizontal, objetivos de 44 px y axe sin violaciones. Lo sembrado de opciones no se borra (ver `fixtures/opciones.ts`): nombres con marca propia.
 */

const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const PANTALLAS = [
  { nombre: "celular", ancho: 375, alto: 812 },
  { nombre: "escritorio", ancho: 1280, alto: 900 },
] as const;

const aviso = (page: Page) => page.locator("[data-aviso-con-deshacer]");

for (const pantalla of PANTALLAS) {
  test(`${pantalla.nombre}: archivar una opción y el grupo con un toque, «Deshacer» a la vista y «Restaurar» desde los archivados`, async ({ paginaAutenticada: page, sucursalId }) => {
    const m = marca();
    const nombreGrupo = `E2E Leche archivo ${m}`;
    const g = await sembrarGrupo({ nombre: nombreGrupo, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "De vaca" }, { nombre: "Almendras", monto: 300 }] });
    await sembrarProductoConOpciones({ nombre: `E2E Cortado archivo ${m}`, codigo: `E2E-ARC-${m}`, precioVenta: 2000, sucursalId, grupos: [{ grupo: g }] });
    await page.setViewportSize({ width: pantalla.ancho, height: pantalla.alto });
    await page.goto(`/catalogo/opciones/${g.grupoId}`);

    // Archivar una opción: un toque, el aviso abajo con «Deshacer», y la opción pasa a «Opciones archivadas».
    await page.locator("[data-opcion='Almendras']").getByRole("button", { name: "Archivar Almendras" }).click();
    await expect(aviso(page)).toContainText("Opción «Almendras» archivada.");
    await expect(page.locator("[data-opcion-archivada='Almendras']")).toBeVisible();
    await expect(page.locator("[data-opcion='Almendras']")).toHaveCount(0);
    expect((await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: g.opciones["Almendras"]!.opcionId } })).activa).toBe(false);
    await expect(aviso(page), "el aviso queda dentro de la pantalla").toBeInViewport({ ratio: 1 });
    await expectObjetivosTactiles(aviso(page).getByRole("button"), `${pantalla.nombre}: los botones del aviso`);
    await expectSinDesborde(page, `${pantalla.nombre}: grupo con el aviso`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "con el aviso a la vista").toEqual([]);
    await capturar(page, `opciones-archivar-${pantalla.nombre}-aviso`);

    // «Deshacer» la vuelve a poner en uso.
    await aviso(page).getByRole("button", { name: "Deshacer" }).click();
    await expect(aviso(page)).toContainText("Opción «Almendras» restaurada.");
    await expect(page.locator("[data-opcion='Almendras']")).toBeVisible();
    await expect(aviso(page).getByRole("button", { name: "Deshacer" })).toHaveCount(0);
    expect((await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: g.opciones["Almendras"]!.opcionId } })).activa).toBe(true);

    // Archivar el grupo entero: el aviso de arriba dice que está archivado, y en la lista va a «Archivados».
    await page.getByRole("button", { name: `Archivar el grupo ${nombreGrupo}` }).click();
    await expect(aviso(page)).toContainText(`Grupo «${nombreGrupo}» archivado.`);
    await expect(page.locator("[data-grupo-archivado-aviso]")).toContainText("Este grupo está archivado");
    expect((await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: g.grupoId } })).activo).toBe(false);
    await expectSinDesborde(page, `${pantalla.nombre}: grupo archivado`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "grupo archivado").toEqual([]);
    await capturar(page, `opciones-archivar-${pantalla.nombre}-grupo-archivado`);

    await page.goto("/catalogo/opciones");
    const archivado = page.locator(`[data-grupo-archivado='${nombreGrupo}']`);
    await expect(archivado).toBeVisible();
    await expect(page.getByRole("region", { name: "Grupos de opciones" }).getByText(nombreGrupo)).toHaveCount(0);
    await expectObjetivosTactiles(archivado.getByRole("button"), `${pantalla.nombre}: «Restaurar»`);
    await expectSinDesborde(page, `${pantalla.nombre}: lista con archivados`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "lista con archivados").toEqual([]);
    await capturar(page, `opciones-archivar-${pantalla.nombre}-lista-archivados`);
    await archivado.getByRole("button", { name: `Restaurar ${nombreGrupo}` }).click();
    await expect(aviso(page)).toContainText(`Grupo «${nombreGrupo}» restaurado.`);
    await expect(archivado).toHaveCount(0);
    expect((await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: g.grupoId } })).activo).toBe(true);
    // Y un registro por cada cambio, con quién lo hizo.
    const filas = await prisma.registroAuditoria.findMany({ where: { entidadId: { in: [g.grupoId, g.opciones["Almendras"]!.opcionId] } }, select: { campo: true, actorId: true } });
    expect(filas.map((f) => f.campo).sort()).toEqual(["activa", "activa", "activo", "activo"]);
    expect(new Set(filas.map((f) => f.actorId)).size).toBe(1);
  });

  test(`${pantalla.nombre}: quitar un grupo de un producto no borra nada; «Deshacer» y «Volver a vincular» lo dejan como estaba`, async ({ paginaAutenticada: page, sucursalId }) => {
    const m = marca();
    const nombreGrupo = `E2E Leche producto ${m}`;
    const g = await sembrarGrupo({ nombre: nombreGrupo, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "De vaca" }, { nombre: "Almendras", monto: 300 }] });
    const { productoId } = await sembrarProductoConOpciones({ nombre: `E2E Cortado producto ${m}`, codigo: `E2E-QUI-${m}`, precioVenta: 2000, sucursalId, grupos: [{ grupo: g }] });
    const filaDelGrupo = () => prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId, grupoId: g.grupoId }, select: { activo: true } });
    await page.setViewportSize({ width: pantalla.ancho, height: pantalla.alto });
    await page.goto(`/catalogo/productos/${productoId}/opciones`);

    await page.getByRole("button", { name: `Quitar ${nombreGrupo} de este producto` }).click();
    await expect(aviso(page)).toContainText(`«${nombreGrupo}» se quitó de «E2E Cortado producto ${m}».`);
    await expect(page.locator(`[data-grupo-quitado='${nombreGrupo}']`)).toBeVisible();
    await expect(page.locator(`[data-admision-grupo='${nombreGrupo}']`)).toHaveCount(0);
    expect((await filaDelGrupo()).activo).toBe(false);
    expect(await prisma.productoAdmiteOpcion.count({ where: { productoId } }), "lo que admitía de cada opción queda guardado").toBe(2);
    await expectObjetivosTactiles(aviso(page).getByRole("button"), `${pantalla.nombre}: los botones del aviso`);
    await expectSinDesborde(page, `${pantalla.nombre}: producto con el grupo quitado`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "producto con el grupo quitado").toEqual([]);
    await capturar(page, `opciones-quitar-${pantalla.nombre}-quitado`);

    // «Deshacer» lo vuelve a vincular, como estaba.
    await aviso(page).getByRole("button", { name: "Deshacer" }).click();
    await expect(aviso(page)).toContainText("como estaba");
    await expect(page.locator(`[data-admision-grupo='${nombreGrupo}']`)).toBeVisible();
    expect((await filaDelGrupo()).activo).toBe(true);

    // Y también desde «Quitados de este producto», con «Volver a vincular».
    await page.getByRole("button", { name: `Quitar ${nombreGrupo} de este producto` }).click();
    await expect(page.locator(`[data-grupo-quitado='${nombreGrupo}']`)).toBeVisible();
    await expectObjetivosTactiles(page.locator(`[data-grupo-quitado='${nombreGrupo}']`).getByRole("button"), `${pantalla.nombre}: «Volver a vincular»`);
    await page.getByRole("button", { name: `Volver a vincular ${nombreGrupo}` }).click();
    await expect(page.locator(`[data-admision-grupo='${nombreGrupo}']`)).toBeVisible();
    expect((await filaDelGrupo()).activo).toBe(true);
    await page.emulateMedia({ colorScheme: "dark" });
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations, "modo oscuro").toEqual([]);
  });
}

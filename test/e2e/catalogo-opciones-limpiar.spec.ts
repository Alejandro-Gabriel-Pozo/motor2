import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { abrirComoRol } from "./fixtures/rol-pos";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";
import { capturar, expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";

/**
 * OPCIONES-LIMPIEZA (G2): «Limpiar opciones» (`/catalogo/opciones/limpiar`, Editar de `opciones_definir`), pensada para el celular. Lista lo que no se usa según el criterio, deja
 * elegir varios, muestra a cuántos productos afecta y archiva el lote de una vez (todo o nada), con «Deshacer» que restaura el lote entero. A 375 × 812 y a 1280 × 900, con axe, sin
 * desborde y con objetivos de 44 px. La base E2E la comparten los specs: se eligen solo los elementos propios (nombres con marca), nunca «Elegir todos».
 */
const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const PANTALLAS = [
  { nombre: "celular", ancho: 375, alto: 812 },
  { nombre: "escritorio", ancho: 1280, alto: 900 },
] as const;

for (const pantalla of PANTALLAS) {
  test(`${pantalla.nombre}: elegir lo que no se usa, ver a quién afecta, archivar el lote de una vez y deshacerlo`, async ({ paginaAutenticada: page, sucursalId }) => {
    const m = marca();
    const sinUso = await sembrarGrupo({ nombre: `E2E Limpiar sin uso ${m}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Picante" }] });
    const usado = await sembrarGrupo({ nombre: `E2E Limpiar leche ${m}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "De vaca" }] });
    const nombreProducto = `E2E Cortado limpiar ${m}`;
    await sembrarProductoConOpciones({ nombre: nombreProducto, codigo: `E2E-LIM-${m}`, precioVenta: 2000, sucursalId, grupos: [{ grupo: usado }] });
    // Una opción del grupo usado que ningún producto admite.
    const avena = await prisma.opcionDeGrupo.create({ data: { grupoId: usado.grupoId, nombre: `Avena ${m}`, orden: 99 } });

    await page.setViewportSize({ width: pantalla.ancho, height: pantalla.alto });
    await page.goto("/catalogo/opciones");
    await page.locator("[data-enlace-limpiar]").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Limpiar opciones");

    // «Sin productos» (el de entrada): el grupo sin uso entero y, del grupo usado, solo la opción que nadie admite.
    await expect(page.getByRole("button", { name: "Sin productos" })).toHaveAttribute("aria-pressed", "true");
    const grupoSinUso = page.locator(`[data-candidato-grupo='E2E Limpiar sin uso ${m}']`);
    const opcionAvena = page.locator(`[data-candidata-opcion='Avena ${m}']`);
    await expect(grupoSinUso).toContainText("ningún producto lo usa");
    await expect(opcionAvena).toContainText(`De «E2E Limpiar leche ${m}»`);
    await expect(page.locator(`[data-candidato-grupo='E2E Limpiar leche ${m}']`)).toHaveCount(0);
    await expectSinDesborde(page, `${pantalla.nombre}: limpiar`);
    await expectObjetivosTactiles(page.getByRole("button", { name: /^Sin / }), `${pantalla.nombre}: los criterios`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "limpiar").toEqual([]);

    // «Sin ventas 30 días»: el grupo usado (que nunca se vendió) entra entero, y la vista previa dice a qué producto afecta.
    await page.getByRole("button", { name: "Sin ventas 30 días" }).click();
    const grupoUsado = page.locator(`[data-candidato-grupo='E2E Limpiar leche ${m}']`);
    await expect(grupoUsado).toContainText("lo usa 1 producto");
    await grupoUsado.getByRole("checkbox").check();
    await page.locator(`[data-candidato-grupo='E2E Limpiar sin uso ${m}']`).getByRole("checkbox").check();
    const barra = page.locator("[data-barra-limpiar]");
    await expect(barra.locator("[data-vista-previa]")).toContainText("2 elegidos");
    await expect(barra.locator("[data-vista-previa]")).toContainText(nombreProducto);
    await expectObjetivosTactiles(barra.getByRole("button"), `${pantalla.nombre}: «Archivar»`);
    await expectSinDesborde(page, `${pantalla.nombre}: limpiar con elegidos`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "con elegidos").toEqual([]);
    await capturar(page, `opciones-limpiar-${pantalla.nombre}-elegidos`);

    // Archivar: los dos de una vez, con una auditoría cada uno, y salen de la lista.
    await barra.getByRole("button", { name: "Archivar 2 elementos" }).click();
    const aviso = page.locator("[data-aviso-con-deshacer]");
    await expect(aviso).toContainText("Archivados: 2 grupos.");
    await expect(page.locator(`[data-candidato-grupo='E2E Limpiar leche ${m}']`)).toHaveCount(0);
    expect(await prisma.grupoDeOpciones.count({ where: { id: { in: [sinUso.grupoId, usado.grupoId] }, activo: false } })).toBe(2);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: { in: [sinUso.grupoId, usado.grupoId] }, campo: "activo" } })).toBe(2);
    await expectObjetivosTactiles(aviso.getByRole("button"), `${pantalla.nombre}: el aviso`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "con el aviso").toEqual([]);
    await capturar(page, `opciones-limpiar-${pantalla.nombre}-archivado`);

    // «Deshacer» restaura el lote entero.
    await aviso.getByRole("button", { name: "Deshacer" }).click();
    await expect(aviso).toContainText("Restaurados: 2 grupos.");
    await expect(page.locator(`[data-candidato-grupo='E2E Limpiar leche ${m}']`)).toBeVisible();
    expect(await prisma.grupoDeOpciones.count({ where: { id: { in: [sinUso.grupoId, usado.grupoId] }, activo: true } })).toBe(2);
    expect((await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: avena.id } })).activa).toBe(true);
  });
}

test("sin el Editar de `opciones_definir` la pantalla no se abre (solo archiva), aunque se vea el catálogo de opciones", async ({ browser, baseURL, sucursalId }) => {
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { opciones_definir: "ver" });
  try {
    await page.goto("/catalogo/opciones");
    await expect(page.locator("[data-enlace-limpiar]")).toHaveCount(0);
    await page.goto("/catalogo/opciones/limpiar");
    await expect(page.getByText(/No tenés permiso/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Limpiar opciones" })).toHaveCount(0);
  } finally {
    await limpiar();
  }
});

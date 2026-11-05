import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";
import { borrarRecetasDeReventa, darRecetaDeReventa } from "../setup/receta-de-venta";

/** CAPTURAS de la PR «opciones debajo del plato»: no se commitea. La variable ETAPA dice antes/despues. */
const ETAPA = process.env.CAPTURA_ETAPA ?? "despues";
const SALIDA = `/home/user/revision-del-dueno/opciones-debajo/${ETAPA}`;
mkdirSync(SALIDA, { recursive: true });
async function foto(page: Page, nombre: string) {
  await page.screenshot({ path: join(SALIDA, `${nombre}.png`), fullPage: false });
}

test("capturas opciones debajo del plato", async ({ browser, paginaAutenticada, sucursalId }) => {
  test.setTimeout(300_000);
  const m = `${Date.now()}`.slice(-6);
  const contexto = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, storageState: await paginaAutenticada.context().storageState() });
  const page = await contexto.newPage();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const sabores = await sembrarGrupo({ nombre: `Sabores Jugo Fresli ${m}`, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "frutos rojos" }, { nombre: "limón con jengibre y menta" }, { nombre: "arándanos" }, { nombre: "limón con matcha" }] });
  const guarnicion = await sembrarGrupo({ nombre: `Guarnición ${m}`, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Puré" }, { nombre: "Ensalada" }, { nombre: "Papas fritas" }] });
  const proteina = await sembrarGrupo({ nombre: `Proteína ${m}`, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Nalga" }, { nombre: "Ojo de bife" }] });
  const preparacion = await sembrarGrupo({ nombre: `Preparación ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Bife a la criolla" }, { nombre: "Bife con chimichurri" }] });
  const { productoId: jugoId } = await sembrarProductoConOpciones({ nombre: `Jugo Fresli ${m}`, codigo: `E2E-OD-JUGO-${m}`, precioVenta: 4500, sucursalId, grupos: [{ grupo: sabores }] });
  const { productoId: milaId } = await sembrarProductoConOpciones({ nombre: `Milanesa ${m}`, codigo: `E2E-OD-MILA-${m}`, precioVenta: 19000, sucursalId, grupos: [{ grupo: guarnicion }] });
  const { productoId: pechugaId } = await sembrarProductoConOpciones({ nombre: `Pechuga grille ${m}`, codigo: `E2E-OD-PECH-${m}`, precioVenta: 18000, sucursalId, grupos: [{ grupo: guarnicion }] });
  const { productoId: baseId } = await sembrarProductoConOpciones({
    nombre: `BIFE- ${m}`, codigo: `E2E-OD-BIFE-${m}`, precioVenta: 0, sucursalId,
    grupos: [{ grupo: preparacion, modoPrecio: "ABSOLUTO", preciosAbsolutos: { "Bife a la criolla": 24000, "Bife con chimichurri": 26000 } }, { grupo: proteina }, { grupo: guarnicion }],
  });
  await prisma.producto.update({ where: { id: baseId }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });
  const flan = await prisma.producto.create({ data: { codigo: `E2E-OD-FLAN-${m}`, nombre: `Flan ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 6000 } });
  const reventa = await darRecetaDeReventa(prisma, flan, { sucursalIds: [sucursalId] });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: flan.id, disponible: true } });
  const bebidas = await prisma.seccionCarta.create({ data: { nombre: `Bebidas ${m}`, orden: 1 } });
  const platos = await prisma.seccionCarta.create({ data: { nombre: `Platos ${m}`, orden: 2 } });
  await prisma.contenidoCartaProducto.createMany({
    data: [
      { sucursalId, productoId: jugoId, visibleEnCarta: true, seccionCartaId: bebidas.id, orden: 1 },
      { sucursalId, productoId: flan.id, visibleEnCarta: true, seccionCartaId: bebidas.id, orden: 2 },
      { sucursalId, productoId: milaId, visibleEnCarta: true, seccionCartaId: platos.id, orden: 1 },
      { sucursalId, productoId: pechugaId, visibleEnCarta: true, seccionCartaId: platos.id, orden: 2 },
      { sucursalId, productoId: baseId, visibleEnCarta: true, seccionCartaId: platos.id, orden: 3 },
    ],
  });
  const slug = `e2e-od-${m}`;
  await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
  try {
    await page.goto(`/carta-publica/e2e/${slug}`);
    await page.getByRole("button", { name: new RegExp(bebidas.nombre) }).click();
    await page.waitForTimeout(800);
    await foto(page, "01-jugo-fresli");
    await page.goto(`/carta-publica/e2e/${slug}`);
    await page.getByRole("button", { name: new RegExp(platos.nombre) }).click();
    await page.waitForTimeout(800);
    await foto(page, "02-platos-compartidos-y-bife");
    await page.locator("[data-bloque-de-opciones]").last().scrollIntoViewIfNeeded();
    await foto(page, "03-platos-al-pie");
    expect(await page.locator("[data-bloque-de-opciones]").count()).toBeGreaterThan(0);
  } finally {
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: [jugoId, flan.id, milaId, pechugaId, baseId] } } });
    await prisma.seccionCarta.deleteMany({ where: { id: { in: [bebidas.id, platos.id] } } });
    await borrarRecetasDeReventa(prisma, { pvIds: [flan.id], mpIds: [reventa.id] });
    await contexto.close();
  }
});

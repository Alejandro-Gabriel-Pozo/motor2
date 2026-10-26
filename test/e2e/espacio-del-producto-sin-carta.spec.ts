import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { prismaAdmin } from "../setup/cliente-duenio";
import { MODULOS_VENDIBLES, fijarModulosActivos } from "../setup/modulos";
import { activarEmpresaB, crearSesion, paginaConSesion, suspenderEmpresaB, type EmpresasDeLaPrueba } from "./fixtures/multiempresa";

/**
 * El ESPACIO DEL PRODUCTO sin el módulo Carta (Fase 6, 6.17c): el paso «En la carta» NO aparece en la tira de pasos y su ruta, abierta por URL, dice que el módulo no está activo (el gate de la
 * página incluye el módulo). Con el módulo prendido, el mismo producto lo muestra: es el control de que el paso depende del módulo y no de otra cosa.
 *
 * Aislado en la empresa B (`activarEmpresaB`, como `modulos-registro.spec.ts`) para no tocar el registro de módulos de la empresa `e2e` del resto de la suite; se suspende al terminar. Se siembra
 * como dueño (`prismaAdmin`, con `empresaId` explícito: con dos empresas activas no hay empresa por defecto).
 */
test.describe.configure({ mode: "serial" });

let e: EmpresasDeLaPrueba;
let sesion: string;
let producto: { id: string; nombre: string };

test.beforeAll(async () => {
  e = await activarEmpresaB();
  sesion = await crearSesion(e.b.adminUsuarioId);
  const unidad = await prismaAdmin.unidad.findFirstOrThrow({ where: { empresaId: e.b.empresaId, nombre: "unidad" } });
  const nombre = `E2E Espacio sin carta ${e.marca}`;
  const creado = await prismaAdmin.producto.create({ data: { empresaId: e.b.empresaId, codigo: `E2E-ESC-${e.marca}`, nombre, tipo: "PV", unidadStockId: unidad.id, precioVenta: 3000 } });
  producto = { id: creado.id, nombre };
  await prismaAdmin.disponibilidadProducto.create({ data: { empresaId: e.b.empresaId, sucursalId: e.b.sucursalId, productoId: creado.id, disponible: true } });
});

test.afterAll(async () => {
  try {
    await prismaAdmin.disponibilidadProducto.deleteMany({ where: { productoId: producto?.id } });
    await prismaAdmin.producto.deleteMany({ where: { id: producto?.id } });
  } finally {
    await suspenderEmpresaB(e.b.empresaId);
  }
});

test("con el módulo Carta apagado no hay paso «En la carta»: ni en la tira ni por URL; con Carta prendida, sí", async ({ browser, baseURL }) => {
  const sinCarta = MODULOS_VENDIBLES.filter((m) => m !== "carta" && m !== "promociones");
  await fijarModulosActivos(e.b.empresaId, sinCarta);
  const page = await paginaConSesion(browser, baseURL, sesion);
  try {
    await page.goto(`/catalogo/productos/${producto.id}`);
    const pasos = page.getByRole("navigation", { name: "Pasos del producto" });
    await expect(pasos).toBeVisible();
    await expect(pasos).toContainText("Opciones y precio");
    await expect(pasos, "sin el módulo Carta el paso no aparece").not.toContainText("En la carta");
    expect((await new AxeBuilder({ page }).analyze()).violations, "portada sin el módulo Carta").toEqual([]);

    await page.goto(`/catalogo/productos/${producto.id}/en-la-carta`);
    await expect(page.getByText(/módulo/i).first()).toBeVisible();
    await expect(page.locator("[data-contenido-carta]"), "no tenía que llegar a dibujarse la ficha de carta").toHaveCount(0);

    // Contraespejo: con Carta prendida el paso está y abre.
    await fijarModulosActivos(e.b.empresaId, MODULOS_VENDIBLES);
    await page.goto(`/catalogo/productos/${producto.id}`);
    await expect(pasos.getByRole("link", { name: /^En la carta/ })).toBeVisible();
    await page.goto(`/catalogo/productos/${producto.id}/en-la-carta`);
    await expect(page.getByRole("heading", { level: 2, name: /^En la carta de «/ })).toBeVisible();
  } finally {
    await fijarModulosActivos(e.b.empresaId, MODULOS_VENDIBLES);
    await page.context().close();
  }
});

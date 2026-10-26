import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";
import { ajustarCeldasDelAdmin } from "./fixtures/admin-con-filas";

/**
 * El PRECIO POR SUCURSAL EDITABLE en el paso 2 «Opciones y precio» del espacio del producto (Fase 6, bloque 3): se carga ahí mismo el precio de la sucursal activa, con el MISMO comando de
 * siempre (`setPrecioLocalProducto`, clave `precio_local`). A 375 y a 1280 px:
 *  - un cambio chico se guarda con «Guardar el precio», se ve «antes → después» y queda el precio local habilitado;
 *  - un cambio de MÁS de 30 % pide una confirmación aparte: «Volver» no escribe nada, «Sí, guardar el precio» sí;
 *  - «Volver al precio global» deshabilita el precio local (queda guardado, sin cobrarse);
 *  - quien no puede Editar `precio_local` no ve el campo (ve la frase de siempre y el enlace a «Precio local»); un producto que se vende por opción tampoco lo muestra;
 *  - dos personas con la pantalla abierta: el valor visto frena al segundo (`PRECIO_DESACTUALIZADO`).
 */

const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function productoDirecto(m: string, sucursalId: string, modoDeVenta: "DIRECTO" | "BASE_CONFIGURABLE" = "DIRECTO") {
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const p = await prisma.producto.create({ data: { codigo: `E2E-PS-${m}`, nombre: `E2E Precio sucursal ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 18000, modoDeVenta } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
  return p;
}

const filaLocal = (sucursalId: string, productoId: string) =>
  prisma.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } }, select: { precio: true, habilitado: true } }).then((f) => (f ? { precio: Number(f.precio), habilitado: f.habilitado } : null));

for (const { ancho, alto } of [
  { ancho: 375, alto: 800 },
  { ancho: 1280, alto: 800 },
]) {
  test.describe(`precio por sucursal en el paso 2 a ${ancho} px`, () => {
    test.beforeEach(async ({ paginaAutenticada: page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
    });

    test("un cambio chico se guarda directo: «antes → después», el precio local queda habilitado y se puede volver al global", async ({ paginaAutenticada: page, sucursalId }) => {
      const p = await productoDirecto(marca(), sucursalId);
      await page.goto(`/catalogo/productos/${p.id}/opciones`);
      const editor = page.locator("[data-precio-editable-de-la-sucursal]");
      await expect(editor).toBeVisible();
      const campo = editor.getByRole("textbox", { name: /^Precio en «/ });
      await expect(campo).toHaveValue(/18\.000/);
      await expect(editor.locator("[data-cambio-de-precio]"), "sin cambio no hay «antes → después»").toHaveCount(0);
      await expect(editor.getByRole("button", { name: "Guardar el precio" }), "sin cambio no hay nada que guardar").toBeDisabled();

      await campo.fill("20000");
      await expect(editor.locator("[data-cambio-de-precio]")).toContainText(/\$\s*18\.000 → \$\s*20\.000 \(\+11,1 %\)/);
      await expectSinDesborde(page, `${ancho} px: el paso 2 con el precio de la sucursal`);
      if (ancho === 375) await expectObjetivosTactiles(editor.getByRole("button"), `${ancho} px: los botones del precio de la sucursal`);
      expect((await new AxeBuilder({ page }).analyze()).violations, "paso 2 con el precio editable").toEqual([]);

      await editor.getByRole("button", { name: "Guardar el precio" }).click();
      await expect(editor.getByRole("status")).toContainText(/Precio local de .* fijado en 20000/);
      expect(await filaLocal(sucursalId, p.id)).toEqual({ precio: 20000, habilitado: true });
      await expect(page.locator("[data-precio-de-la-sucursal]")).toContainText(/\$\s*20\.000/);

      await editor.getByRole("button", { name: /^Volver al precio global/ }).click();
      await expect(editor.getByRole("button", { name: /^Volver al precio global/ })).toHaveCount(0);
      expect(await filaLocal(sucursalId, p.id)).toEqual({ precio: 20000, habilitado: false });
      await expect(editor).toContainText(/Hay un precio local guardado \(\$\s*20\.000\) pero deshabilitado/);
    });

    test("un cambio de MÁS de 30 % pide confirmar: «Volver» no escribe, «Sí, guardar el precio» sí", async ({ paginaAutenticada: page, sucursalId }) => {
      const p = await productoDirecto(marca(), sucursalId);
      await page.goto(`/catalogo/productos/${p.id}/opciones`);
      const editor = page.locator("[data-precio-editable-de-la-sucursal]");
      // Justo 30 % (18.000 → 23.400) NO pide confirmación: es el botón de siempre.
      await editor.getByRole("textbox", { name: /^Precio en «/ }).fill("23400");
      await expect(editor.getByRole("button", { name: "Guardar el precio" })).toHaveAttribute("type", "submit");

      await editor.getByRole("textbox", { name: /^Precio en «/ }).fill("30000");
      await expect(editor.locator("[data-cambio-de-precio]")).toContainText(/\$\s*18\.000 → \$\s*30\.000 \(\+66,7 %\)/);
      await editor.getByRole("button", { name: "Guardar el precio" }).click();
      const aviso = editor.getByRole("alert").filter({ hasText: "El precio cambia más de 30 %" });
      await expect(aviso).toContainText(/\$\s*18\.000 → \$\s*30\.000/);
      await expect(editor.getByRole("button", { name: "Volver", exact: true })).toBeFocused();
      expect((await new AxeBuilder({ page }).analyze()).violations, "la confirmación del cambio de más de 30 %").toEqual([]);

      await editor.getByRole("button", { name: "Volver", exact: true }).click();
      expect(await filaLocal(sucursalId, p.id), "«Volver» no escribe nada").toBeNull();

      await editor.getByRole("button", { name: "Guardar el precio" }).click();
      await editor.getByRole("button", { name: "Sí, guardar el precio" }).click();
      await expect.poll(() => filaLocal(sucursalId, p.id)).toEqual({ precio: 30000, habilitado: true });
    });

    test("un importe que no se entiende no se guarda y se dice junto al campo", async ({ paginaAutenticada: page, sucursalId }) => {
      const p = await productoDirecto(marca(), sucursalId);
      await page.goto(`/catalogo/productos/${p.id}/opciones`);
      const editor = page.locator("[data-precio-editable-de-la-sucursal]");
      await editor.getByRole("textbox", { name: /^Precio en «/ }).fill("21,000");
      await expect(editor.getByText(/máximo 2 decimales/)).toBeVisible();
      await expect(editor.getByRole("button", { name: "Guardar el precio" })).toBeDisabled();
      expect(await filaLocal(sucursalId, p.id)).toBeNull();
    });
  });
}

test("el valor visto frena al segundo: si otra persona cambió el precio local, no se pisa y se pide recargar", async ({ paginaAutenticada: page, sucursalId }) => {
  const p = await productoDirecto(marca(), sucursalId);
  await prisma.precioLocalProducto.create({ data: { sucursalId, productoId: p.id, precio: 19000, habilitado: true } });
  await page.goto(`/catalogo/productos/${p.id}/opciones`);
  const editor = page.locator("[data-precio-editable-de-la-sucursal]");
  await expect(editor.getByRole("textbox", { name: /^Precio en «/ })).toHaveValue(/19\.000/);
  // Otra persona lo cambia mientras esta pantalla sigue abierta.
  await prisma.precioLocalProducto.update({ where: { sucursalId_productoId: { sucursalId, productoId: p.id } }, data: { precio: 21000 } });
  await editor.getByRole("textbox", { name: /^Precio en «/ }).fill("20000");
  await editor.getByRole("button", { name: "Guardar el precio" }).click();
  await expect(editor.getByRole("alert")).toContainText(/cambió mientras lo editabas/);
  expect(await filaLocal(sucursalId, p.id), "no se pisó lo de la otra persona").toEqual({ precio: 21000, habilitado: true });
});

test("quién lo ve: sin Editar de `precio_local` no hay campo (queda el enlace a «Precio local»); un producto que se vende por opción tampoco lo muestra", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const directo = await productoDirecto(m, sucursalId);
  const base = await productoDirecto(`${m}b`, sucursalId, "BASE_CONFIGURABLE");
  const admin = await ajustarCeldasDelAdmin({ precio_local: { puedeVer: true, puedeEditar: false } });
  try {
    await page.goto(`/catalogo/productos/${directo.id}/opciones`);
    await expect(page.getByRole("heading", { level: 2, name: "Opciones y precio" })).toBeVisible();
    await expect(page.locator("[data-precio-editable-de-la-sucursal]")).toHaveCount(0);
    await expect(page.locator("[data-precio-de-la-sucursal]")).toContainText("El precio de cada sucursal se cambia en Precio local");

    // Contraespejo: con el Editar de vuelta, el campo está.
    await admin.cambiar({ precio_local: { puedeVer: true, puedeEditar: true } });
    await page.goto(`/catalogo/productos/${directo.id}/opciones`);
    await expect(page.locator("[data-precio-editable-de-la-sucursal]")).toBeVisible();

    // Un producto que se vende por opción no tiene precio propio que cobrar: su precio es el de cada opción.
    await page.goto(`/catalogo/productos/${base.id}/opciones`);
    await expect(page.locator("[data-precio-de-la-sucursal]")).toContainText("Se vende por opción");
    await expect(page.locator("[data-precio-editable-de-la-sucursal]")).toHaveCount(0);
  } finally {
    await admin.restaurar();
  }
});

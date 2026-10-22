import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";
import { capturar } from "./fixtures/movil";

/**
 * CampoNumero (src/components/campo-numero.tsx) promete «todo el valor seleccionado al hacer foco»: lo que se tipea REEMPLAZA al valor
 * que ya estaba. No lo cumplía: al hacer foco el campo cambia su texto («0,02» formateado → «0.02» crudo) DESPUÉS de seleccionar, y
 * cambiar el valor de un `<input>` deja el cursor al final (y un toque o un clic lo ubican donde caen). Con un precio de «0,02»: tocar o
 * hacer clic y tipear «1,5» dejaba «1,50.02» (inválido: no se podía guardar); entrar con el teclado y tipear «1,5» dejaba «0.021,5»,
 * que el parser leía como 21,5 y se GUARDABA.
 *
 * Pantalla usada (sin cambiarla): «Precio local», el precio por tamaño, un CampoNumero no controlado que ya viene cargado. Los datos son
 * propios del spec (nombre único) y lo guardado se lee de SU fila.
 */
async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const tamano = await sembrarGrupo({ nombre: `E2E Tamaño campo número ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chico", factorEscala: 1 }, { nombre: "Grande", factorEscala: 1.5 }] });
  const nombre = `E2E Campo número ${m}`;
  const { productoId } = await sembrarProductoConOpciones({
    nombre,
    codigo: `E2E-CN-${m}`,
    precioVenta: 2500,
    sucursalId,
    grupos: [{ grupo: tamano, modoPrecio: "ABSOLUTO", preciosAbsolutos: { Chico: 2500, Grande: 3100 } }],
  });
  const opcionId = tamano.opciones["Grande"]!.opcionId;
  // Un precio decimal ya cargado: el campo lo muestra «0,02» y, con el foco, «0,02» sin formato (2c: con coma, la notación argentina; antes «0.02», que ahora se leería ambiguo con tres cifras).
  await prisma.precioLocalDeOpcion.create({ data: { sucursalId, productoId, opcionId, precio: "0.02", habilitado: true } });
  return { etiqueta: `${nombre} · Grande`, productoId, opcionId };
}

async function abrir(page: Page, sucursalId: string) {
  const d = await sembrar(sucursalId);
  await page.goto("/movimientos/precio-local");
  const fila = page.locator(`[data-tamano='${d.etiqueta}']`);
  const campo = fila.getByLabel(`Precio de ${d.etiqueta} en esta sucursal`);
  const guardar = fila.getByRole("button", { name: `Guardar el precio de ${d.etiqueta}` });
  await expect(campo).toHaveValue("0,02");
  // El HTML del servidor ya muestra «0,02»: tocar antes de que React hidrate el campo no probaría el componente (mismo criterio que
  // salon-volver-a-gestion.spec.ts).
  await expect.poll(() => campo.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { message: "campo hidratado" }).toBe(true);
  return { ...d, fila, campo, guardar };
}

/** Qué parte del texto está seleccionada (inicio y fin) y el texto entero. */
async function seleccion(campo: Locator) {
  return campo.evaluate((el) => {
    const entrada = el as HTMLInputElement;
    return { valor: entrada.value, inicio: entrada.selectionStart, fin: entrada.selectionEnd };
  });
}

async function precioGuardado(sucursalId: string, productoId: string, opcionId: string) {
  const fila = await prisma.precioLocalDeOpcion.findUniqueOrThrow({ where: { sucursalId_productoId_opcionId: { sucursalId, productoId, opcionId } } });
  return fila.precio.toString();
}

test.describe("celular (375 px, táctil)", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });

  test("tocar un precio ya cargado y tipear uno nuevo lo REEMPLAZA, y se guarda el nuevo", async ({ paginaAutenticada: page, sucursalId }) => {
    const d = await abrir(page, sucursalId);

    await d.campo.tap();
    // El primer toque (el que da el foco) deja el número crudo seleccionado entero.
    await expect.poll(() => seleccion(d.campo), { message: "todo el valor seleccionado tras el toque" }).toEqual({ valor: "0,02", inicio: 0, fin: 4 });
    await page.keyboard.type("1,5");
    await expect(d.campo, "lo tipeado reemplaza al valor anterior (antes quedaba «0.021,5» o «1,50.02»)").toHaveValue("1,5");
    await capturar(page, "campo-numero-tactil-tipeado");

    // Un segundo toque, con el campo ya enfocado, NO vuelve a seleccionar todo: deja ubicar el cursor. La pausa lo saca del intervalo de
    // doble toque (dos toques seguidos son un doble clic, que el navegador mismo convierte en «seleccionar la palabra»).
    await page.waitForTimeout(1000);
    await d.campo.tap();
    const otra = await seleccion(d.campo);
    expect(otra.inicio, "el segundo toque deja el cursor, sin selección").toBe(otra.fin);

    await d.guardar.tap();
    await expect(d.fila.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
    expect(await precioGuardado(sucursalId, d.productoId, d.opcionId)).toBe("1.5");
  });
});

test.describe("escritorio (clic y teclado)", () => {
  test("hacer clic en un precio ya cargado y tipear uno nuevo lo REEMPLAZA, y se guarda el nuevo", async ({ paginaAutenticada: page, sucursalId }) => {
    const d = await abrir(page, sucursalId);

    await d.campo.click();
    await expect.poll(() => seleccion(d.campo), { message: "todo el valor seleccionado tras el clic" }).toEqual({ valor: "0,02", inicio: 0, fin: 4 });
    await page.keyboard.type("1,5");
    await expect(d.campo, "lo tipeado reemplaza al valor anterior").toHaveValue("1,5");

    await d.guardar.click();
    await expect(d.fila.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
    expect(await precioGuardado(sucursalId, d.productoId, d.opcionId)).toBe("1.5");
  });

  test("entrar al campo con el teclado (foco sin puntero, como Tab) y tipear también REEMPLAZA (antes quedaba «0.021,5» y se guardaba 21,5)", async ({ paginaAutenticada: page, sucursalId }) => {
    const d = await abrir(page, sucursalId);

    await d.campo.focus();
    await expect.poll(() => seleccion(d.campo), { message: "todo el valor seleccionado al tomar el foco" }).toEqual({ valor: "0,02", inicio: 0, fin: 4 });
    await page.keyboard.type("1,5");
    await expect(d.campo).toHaveValue("1,5");

    // Todo con el teclado: Tab sale del campo (que se muestra formateado) y llega a «Guardar»; Enter en el botón envía (Enter en el campo
    // no envía a propósito, test/e2e/form-con-resultado-enter.spec.ts).
    await page.keyboard.press("Tab");
    await expect(d.guardar).toBeFocused();
    await expect(d.campo).toHaveValue("1,5");
    await page.keyboard.press("Enter");
    await expect(d.fila.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
    expect(await precioGuardado(sucursalId, d.productoId, d.opcionId)).toBe("1.5");
  });
});

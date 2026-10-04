import { test, expect } from "./fixtures/auth";
import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { prisma } from "./fixtures/db";

/**
 * Pendiente #44 (feedback al hacer click): mientras una acción de servidor está en curso, el formulario lo dice (`aria-busy`, «Guardando…» con
 * role="status"), no se puede enviar dos veces y, al terminar, el resultado queda a la vista. Se retiene a mano la respuesta del POST de la acción
 * (cabecera `next-action`) para poder mirar el estado «en curso»: sin eso la acción termina antes de que Playwright llegue a verlo.
 */

/** Retiene los POST de server actions hacia `patron` hasta llamar a `liberar()`; `envios()` dice cuántos llegaron. */
async function retenerAcciones(page: Page, patron: string) {
  let envios = 0;
  let liberar!: () => void;
  const retenido = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  await page.route(patron, async (route: Route) => {
    const r = route.request();
    if (r.method() === "POST" && r.headers()["next-action"]) {
      envios += 1;
      await retenido;
    }
    await route.continue();
  });
  return { liberar, envios: () => envios };
}

test("formulario: mientras guarda muestra «Guardando…», no se envía dos veces y al terminar muestra el resultado", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E En curso ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  try {
    await page.goto("/catalogo/categorias");
    const form = page.locator("form", { has: page.getByPlaceholder("nombre de la categoría") });
    const accion = await retenerAcciones(page, "**/catalogo/categorias");

    await form.getByPlaceholder("nombre de la categoría").fill(nombre);
    await form.getByRole("button", { name: "Crear" }).click();

    await expect(form).toHaveAttribute("aria-busy", "true");
    await expect(form.getByRole("status")).toHaveText("Guardando…");

    // Un segundo click con la acción todavía en curso no manda otra acción. Sin la guarda, Next encola la segunda y la manda al terminar la primera
    // (por eso también se cuenta al final, y el segundo «Crear» se vería como «Ya existía la categoría»).
    await form.getByRole("button", { name: "Crear" }).click();
    await page.waitForTimeout(300);
    expect(accion.envios(), "el segundo click no tiene que enviar la acción otra vez").toBe(1);

    // El estado «en curso» no introduce violaciones de accesibilidad (contraste del botón atenuado incluido).
    const resultados = await new AxeBuilder({ page }).include('form[aria-busy="true"]').analyze();
    expect(resultados.violations).toEqual([]);

    accion.liberar();
    await expect(form.getByRole("status")).toHaveText(`Categoría "${nombre}" creada.`);
    await expect(form).not.toHaveAttribute("aria-busy", "true");
    await page.waitForTimeout(500);
    expect(accion.envios()).toBe(1);
    expect(await prisma.categoriaProducto.count({ where: { nombre } })).toBe(1);
  } finally {
    await prisma.categoriaProducto.deleteMany({ where: { nombre } });
  }
});

test("formulario: el resultado se trae a la vista aunque el botón esté al borde de la pantalla", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Vista ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  try {
    await page.goto("/catalogo/categorias");
    const form = page.locator("form", { has: page.getByPlaceholder("nombre de la categoría") });
    await form.getByPlaceholder("nombre de la categoría").fill(nombre);
    // Espacio de sobra ARRIBA (para poder bajar la página hasta dejar el botón pegado al borde inferior de la pantalla) y ABAJO (para que ese borde sea
    // alcanzable): el mensaje, que va debajo del botón, nace fuera de la pantalla.
    await form.evaluate((f) => {
      for (const donde of ["antes", "despues"]) {
        const relleno = document.createElement("div");
        relleno.style.height = "200vh";
        if (donde === "antes") f.parentElement!.insertBefore(relleno, f);
        else document.body.append(relleno);
      }
    });
    const boton = form.getByRole("button", { name: "Crear" });
    await boton.evaluate((el) => el.scrollIntoView({ block: "end" }));

    await boton.click();
    const mensaje = form.getByRole("status");
    await expect(mensaje).toHaveText(`Categoría "${nombre}" creada.`);
    await expect(mensaje, "el mensaje tiene que verse entero, no asomar un píxel").toBeInViewport({ ratio: 1 });
  } finally {
    await prisma.categoriaProducto.deleteMany({ where: { nombre } });
  }
});

test("aviso compartido: FormConAviso también marca el formulario en curso y no envía dos veces", async ({ paginaAutenticada: page }) => {
  const admin = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
  const where = { rolId: admin.id, accionClave: "capacidades_sucursal" };
  try {
    // Sin «editar» la acción contesta con un error y no cambia nada en la base: la pantalla se puede usar sin dejar datos (mismo truco que
    // `resultado-de-accion-visible.spec.ts`).
    await prisma.permisoRol.updateMany({ where, data: { puedeVer: true, puedeEditar: false } });
    await page.goto("/administracion/capacidades-sucursal");
    await expect(page.getByRole("heading", { name: /Capacidades por sucursal/ })).toBeVisible();
    const celda = page.locator("tr", { has: page.getByRole("cell", { name: "stock_minimo", exact: true }) }).locator("td").nth(1);
    const form = celda.locator("form");
    const accion = await retenerAcciones(page, "**/administracion/capacidades-sucursal");

    await celda.getByRole("button").click();
    await expect(form).toHaveAttribute("aria-busy", "true");
    await celda.getByRole("button").click();
    accion.liberar();
    await expect(page.getByRole("alert").filter({ hasText: "No tenés permiso para esta acción" })).toBeVisible();
    await expect(form).not.toHaveAttribute("aria-busy", "true");
    // Sin la guarda Next encola el segundo envío y lo manda recién al terminar el primero: hay que esperar y contar al final.
    await page.waitForTimeout(500);
    expect(accion.envios(), "el segundo click no tiene que enviar la acción otra vez").toBe(1);
  } finally {
    await prisma.permisoRol.updateMany({ where, data: { puedeVer: true, puedeEditar: true } });
  }
});

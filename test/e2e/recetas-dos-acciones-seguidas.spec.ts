import type { Page, Route } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * O.2 (Revisión #93 (5); docs/plan-hito-4-pureza.md §4, E1/E2): dos acciones seguidas en el editor de recetas, sin recargar. Cada formulario del editor manda la
 * versión que la pantalla mostraba (H7); si la persona toca «Quitar» en un ingrediente y, mientras eso guarda, toca «Quitar» en otro, el segundo salía con la
 * versión VIEJA (Next encola el segundo envío y lo manda al terminar el primero) y recibía «cambió mientras la editabas… Recargá», aunque la pantalla ya se
 * hubiera refrescado sola. Ahora los formularios del editor forman un GRUPO (`GrupoDeFormularios`): mientras uno guarda, los demás no envían y avisan
 * «Esperá a que termine de guardarse el cambio anterior»; al terminar, la pantalla trae la versión nueva y el segundo cambio entra.
 *
 * Mismo molde que `form-con-resultado-en-curso.spec.ts`: se retiene a mano la respuesta del POST de la acción para poder mirar el estado «en curso».
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

test("dos «Quitar» seguidos en el editor de recetas: el segundo espera al primero en vez de salir con la versión vieja", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const mp = (nombre: string) => prisma.producto.create({ data: { codigo: `E2E-2A-${nombre}-${marca}`, nombre: `E2E ${nombre} dos acciones ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const [a, b, c] = [await mp("Harina"), await mp("Queso"), await mp("Tomate")];
  const pv = await prisma.producto.create({ data: { codigo: `E2E-2A-PV-${marca}`, nombre: `E2E Pizza dos acciones ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  await prisma.disponibilidadProducto.createMany({ data: [a.id, b.id, c.id, pv.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  await prisma.recetaVersion.create({
    data: { productoId: pv.id, version: 1, ingredientes: { create: [a, b, c].map((m) => ({ insumoProductoId: m.id, cantidad: 0.1, unidadId: kg.id })) } },
  });
  const versiones = async () => (await prisma.recetaVersion.findMany({ where: { productoId: pv.id, sucursalId: null }, select: { version: true } })).map((v) => v.version).sort();

  await page.goto(`/catalogo/recetas/${pv.id}`);
  const fila = (m: { nombre: string }) => page.locator("tbody tr").filter({ hasText: m.nombre });
  const formQuitar = (m: { nombre: string }) => fila(m).locator("form", { has: page.getByRole("button", { name: "Quitar" }) });
  await expect(fila(a)).toHaveCount(1);
  await expect(fila(b)).toHaveCount(1);
  const grupo = page.locator("[data-grupo-de-formularios]");
  const accion = await retenerAcciones(page, `**/catalogo/recetas/${pv.id}`);

  // 1. «Quitar» del ingrediente A: queda guardando (retenido).
  await formQuitar(a).getByRole("button", { name: "Quitar" }).click();
  await expect(formQuitar(a)).toHaveAttribute("aria-busy", "true");

  // 2. «Quitar» del B mientras A guarda: avisa y NO manda un segundo POST (sin el grupo, Next lo encolaba y salía al terminar A, con la versión 1).
  await formQuitar(b).getByRole("button", { name: "Quitar" }).click();
  await expect(formQuitar(b).getByRole("status")).toHaveText("Esperá a que termine de guardarse el cambio anterior.");
  await expect(grupo, "el grupo entero se marca ocupado").toHaveAttribute("aria-busy", "true");
  await page.waitForTimeout(300);
  expect(accion.envios(), "el «Quitar» de B no tiene que enviarse mientras A guarda").toBe(1);

  // 3. Al liberar, A se guarda (versión 2) y la pantalla se refresca sola: la fila de A desaparece y el aviso de B también.
  accion.liberar();
  await expect(fila(a)).toHaveCount(0);
  await expect(grupo).not.toHaveAttribute("aria-busy", "true");
  await expect(formQuitar(b).getByRole("status")).toHaveCount(0);
  expect(await versiones()).toEqual([1, 2]);

  // 4. B otra vez: ahora sale con la versión 2 y entra (versión 3). Nada de «cambió mientras la editabas».
  await formQuitar(b).getByRole("button", { name: "Quitar" }).click();
  await expect(fila(b)).toHaveCount(0);
  await expect(page.getByText(/cambió mientras la editabas/)).toHaveCount(0);
  expect(accion.envios()).toBe(2);
  expect(await versiones()).toEqual([1, 2, 3]);
  const ultima = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id, sucursalId: null, version: 3 }, include: { ingredientes: true } });
  expect(ultima.ingredientes.map((i) => i.insumoProductoId), "la versión 3 queda sin A ni B").toEqual([c.id]);
});

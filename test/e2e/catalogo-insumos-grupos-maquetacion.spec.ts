import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Maquetación de /catalogo/insumos-grupos a 1280 px.
 *
 * Bug real que encontró un spec de Playwright: la tabla de Insumos desbordaba su columna y el botón «Desactivar» de cada insumo quedaba TAPADO
 * por la sección de grupos, que interceptaba el clic ("<section class='space-y-6'> intercepts pointer events"). Mecanismo (medido, no supuesto):
 * `lg:grid-cols-2` de Tailwind v4 es `repeat(2, minmax(0, 1fr))`, así que la columna no crece con el contenido y la <section> mide lo que la
 * columna (su tamaño mínimo automático es 0 con ese track); pero la <table w-full> no puede achicarse por debajo de su ancho mínimo y SE SALE de
 * la sección (overflow visible) sobre la otra columna, y como la de grupos viene DESPUÉS en el DOM, se pinta encima y se queda con el clic.
 * Arreglo: cada tabla dentro de su propio `overflow-x-auto`, que es lo que ya hacen capacidades-sucursal y permisos-matriz.
 *
 * El ancho es lo que se prueba, así que se fija EXPLÍCITO aunque sea el default de Playwright: no puede depender de un valor que alguien cambie.
 * Ensancharlo escondería justamente esta regresión.
 */
test.use({ viewport: { width: 1280, height: 720 } });

/** Un nombre de grupo largo pero realista: ensancha el <select> de cada insumo, que es la columna que más depende de los datos. */
const NOMBRE_DE_GRUPO_LARGO = "Materias primas secas y harinas de uso frecuente";

async function conDatos<T>(marca: number, usar: (insumo: string) => Promise<T>) {
  const grupo = await prisma.grupo.create({ data: { nombre: `${NOMBRE_DE_GRUPO_LARGO} ${marca}` } });
  const insumo = `E2E Insumo Maquetación ${marca}`;
  await prisma.insumo.create({ data: { nombre: insumo, grupoId: grupo.id } });
  try {
    return await usar(insumo);
  } finally {
    await prisma.insumo.deleteMany({ where: { nombre: insumo } });
    await prisma.grupo.deleteMany({ where: { id: grupo.id } });
  }
}

test("a 1280 px el contenido de cada sección no se sale de ella ni pisa a la otra", async ({ paginaAutenticada: page }) => {
  await conDatos(Date.now(), async () => {
    await page.goto("/catalogo/insumos-grupos");
    await expect(page.getByRole("heading", { name: "Insumos", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Árbol de grupos" })).toBeVisible();

    const seccionDe = (titulo: string | RegExp, exact = false) => page.locator("section").filter({ has: page.getByRole("heading", { name: titulo, exact }) });
    const a = await seccionDe("Insumos", true).boundingBox();
    const b = await seccionDe("Árbol de grupos").boundingBox();
    expect(a, "no se encontró la sección de Insumos").not.toBeNull();
    expect(b, "no se encontró la sección de grupos").not.toBeNull();

    // El síntoma: el CONTENIDO de una sección se sale de su caja. `scrollWidth` incluye lo que desborda con overflow visible; si la tabla está
    // dentro de su propio contenedor con scroll, ese desborde queda adentro y la sección mide igual que su columna. Agnóstico al layout.
    const desborde = await page.evaluate(() =>
      [...document.querySelectorAll("section")].map((s) => ({ titulo: s.querySelector("h1")?.textContent ?? "?", scrollWidth: s.scrollWidth, clientWidth: s.clientWidth })),
    );
    for (const s of desborde) {
      expect(s.scrollWidth, `el contenido de la sección «${s.titulo}» se sale de ella (${s.scrollWidth} px de contenido en ${s.clientWidth} px de sección): tapa a la otra`).toBeLessThanOrEqual(s.clientWidth);
    }

    // Y las dos cajas no se intersecan en ningún eje (vale lado a lado o apiladas).
    const seInterseca = a!.x < b!.x + b!.width && b!.x < a!.x + a!.width && a!.y < b!.y + b!.height && b!.y < a!.y + a!.height;
    expect(
      seInterseca,
      `las dos secciones se pisan: la de grupos tapa los botones de Insumos (Insumos: x=${a!.x}..${a!.x + a!.width}, grupos: x=${b!.x}..${b!.x + b!.width})`,
    ).toBe(false);

    // Red para el futuro: sin scroll horizontal de la PÁGINA (el desborde, si lo hay, queda dentro del contenedor de la tabla).
    const desbordaLaPagina = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(desbordaLaPagina, "la página tiene scroll horizontal").toBe(false);
  });
});

test("el botón «Desactivar» de un insumo se puede tocar de verdad a 1280 px", async ({ paginaAutenticada: page }) => {
  await conDatos(Date.now(), async (insumo) => {
    // Misma fila que usa refresco-sin-recargar.spec.ts: React deja el `defaultValue` del input como atributo `value`.
    const fila = page.locator(`tr:has(input[value="${insumo}"])`);
    await page.goto("/catalogo/insumos-grupos");
    await expect(fila).toHaveCount(1);

    // SIN `force` y SIN cambiar el viewport. Sin el arreglo este clic falla con "<section class='space-y-6'> intercepts pointer events": es el
    // hallazgo original. Playwright se desplaza DENTRO del contenedor con scroll, así que funciona aunque la celda quede fuera de lo visible.
    // Timeout corto a propósito: si el bug vuelve, que el rojo no tarde 30 s.
    await fila.getByRole("button", { name: "Desactivar", exact: true }).click({ timeout: 10_000 });

    await expect(fila.getByRole("cell", { name: "No", exact: true })).toBeVisible();
    await expect(fila.getByRole("button", { name: "Activar", exact: true })).toBeVisible();
  });
});

test("las regiones con scroll de la pantalla se alcanzan con el teclado", async ({ paginaAutenticada: page }) => {
  await conDatos(Date.now(), async () => {
    await page.goto("/catalogo/insumos-grupos");
    await expect(page.getByRole("heading", { name: "Insumos", exact: true })).toBeVisible();

    // Chequeo ACOTADO a la única regla que este cambio puede introducir (una región con scroll que el teclado no alcance). Un scan completo
    // de la pantalla lo cubre el pendiente de accesibilidad de estas pantallas, que tiene deuda ajena a este cambio.
    const resultados = await new AxeBuilder({ page }).withRules(["scrollable-region-focusable"]).analyze();
    expect(resultados.violations).toEqual([]);
  });
});

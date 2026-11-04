import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * Carta «B», E2 (invitación «5+2», 2026-11-04), en el navegador a 375 px y con la base real: el plato dice «Incluye guarnición y salsa · elegí abajo ↓», las palabras «guarnición» y «salsa» son botones; al tocar
 * una, la lista baja al bloque, lo ilumina («Va con: …») y marca con una barra a los platos que lo incluyen; tocar dos veces o tocar otra palabra no rompe nada; a los pocos segundos todo vuelve a su lugar; con
 * «movimiento reducido» no hay animación (ni de la flecha ni del scroll); con teclado funciona; en papel no hay interacción. Axe sin violaciones sobre la sección.
 */
const EMPRESA = "e2e";

test("invitación 5+2: tocar «salsa» o «guarnición» baja al bloque, lo ilumina y marca los platos correctos", async ({ page, sucursalId }) => {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const slug = `e2e-carta-b-inv-${m}`;
  const guarnicion = await sembrarGrupo({ nombre: `Guarnición ${m}`, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Puré" }, { nombre: "Ensalada" }, { nombre: "Papas fritas" }] });
  const salsa = await sembrarGrupo({ nombre: `Salsa ${m}`, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Filetto" }, { nombre: "Crema" }, { nombre: "Rosa" }] });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Platos inv ${m}` } });
  // Los 5 platos de la maqueta: 1 con guarnición y salsa, 2 solo guarnición, 3 y 4 solo salsa (el 4.º sin la «rosa» no hace falta), 5 con guarnición solo «puré o ensalada».
  const platos = [
    { nombre: `E2E Bife a la criolla ${m}`, g: true, s: true },
    { nombre: `E2E Bife con chimichurri ${m}`, g: true, s: false },
    { nombre: `E2E Chivo del norte ${m}`, g: false, s: true },
    { nombre: `E2E Estofado de chivo ${m}`, g: false, s: false },
    { nombre: `E2E Pechuga grille ${m}`, g: true, s: false },
  ];
  for (const [i, p] of platos.entries()) {
    const grupos = [...(p.g ? [{ grupo: guarnicion }] : []), ...(p.s ? [{ grupo: salsa }] : [])];
    const { productoId } = await sembrarProductoConOpciones({ nombre: p.nombre, codigo: `E2E-CBI-${m}-${i}`, precioVenta: 20000 + i * 1000, sucursalId, grupos });
    if (i === 4) await prismaAdmin.productoAdmiteOpcion.deleteMany({ where: { productoId, opcionId: guarnicion.opciones["Papas fritas"]!.opcionId } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId, visibleEnCarta: true, seccionCartaId: seccion.id, orden: i } });
  }
  await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });

  const abrir = async () => {
    await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
    await page.getByRole("button", { name: new RegExp(seccion.nombre) }).click();
  };
  const fila = (i: number) => page.locator(`[data-plato="${i}"]`);
  const marcados = () => page.locator("[data-plato][data-marcado]");
  const bloqueS = () => page.locator(`[data-bloque-de-opciones='Salsa ${m}']`);
  const bloqueG = () => page.locator(`[data-bloque-de-opciones='Guarnición ${m}']`);

  try {
    await page.setViewportSize({ width: 375, height: 812 });
    await abrir();

    // La línea del plato y sus botones.
    await expect(fila(0).locator("[data-incluye]")).toHaveText(`Incluye guarnición ${m} y salsa ${m} · elegí abajo ↓`);
    await expect(fila(4).locator("[data-incluye]")).toHaveText(`Incluye guarnición ${m}: puré o ensalada · elegí abajo ↓`);
    await expect(fila(0).getByRole("button")).toHaveCount(2);
    await expect(fila(3).locator("[data-incluye]")).toHaveCount(0);
    expect(await marcados().count(), "nada marcado al llegar").toBe(0);
    await expect(bloqueS().locator("[data-va-con]")).toBeHidden();

    // Toca «salsa» del primer plato: baja al bloque, lo ilumina y marca solo los platos con salsa.
    await fila(0).getByRole("button", { name: `Ir a las opciones de salsa ${m}` }).click();
    await expect(bloqueS()).toHaveAttribute("data-iluminado", "");
    await expect(bloqueS().locator("[data-va-con]")).toHaveText(`Va con: E2E Bife a la criolla ${m} · E2E Chivo del norte ${m}`);
    await expect(marcados()).toHaveCount(2);
    await expect(fila(0)).toHaveAttribute("data-marcado", "");
    await expect(fila(2)).toHaveAttribute("data-marcado", "");
    // Los que no la incluyen no se marcan (el 4.º, sin opciones, ni siquiera lleva `data-plato`).
    for (const i of [1, 3, 4]) await expect(page.locator(`[data-plato="${i}"][data-marcado]`)).toHaveCount(0);
    await expect(bloqueS()).toBeInViewport();
    await expect(bloqueS()).toBeFocused();

    // Doble toque seguido: no rompe nada (sigue UN bloque iluminado y los mismos 2 platos marcados).
    await fila(0).getByRole("button", { name: `Ir a las opciones de salsa ${m}` }).dblclick();
    await expect(page.locator("[data-iluminado]")).toHaveCount(1);
    await expect(marcados()).toHaveCount(2);

    // Toca «guarnición» de otro plato: apaga lo anterior e ilumina el otro bloque (3 platos, el último con su subconjunto).
    await fila(1).getByRole("button", { name: `Ir a las opciones de guarnición ${m}` }).click();
    await expect(bloqueG()).toHaveAttribute("data-iluminado", "");
    await expect(bloqueS()).not.toHaveAttribute("data-iluminado", "");
    await expect(bloqueG().locator("[data-va-con]")).toHaveText(`Va con: E2E Bife a la criolla ${m} · E2E Bife con chimichurri ${m} · E2E Pechuga grille ${m} (solo puré o ensalada)`);
    await expect(marcados()).toHaveCount(3);
    expect((await new AxeBuilder({ page }).include("[data-carta-scroll]").analyze()).violations, "axe con el bloque iluminado").toEqual([]);

    // A los pocos segundos todo vuelve a su lugar.
    await expect(page.locator("[data-iluminado]")).toHaveCount(0, { timeout: 10_000 });
    await expect(marcados()).toHaveCount(0);

    // Con teclado: foco en la palabra y Enter.
    await fila(2).getByRole("button", { name: `Ir a las opciones de salsa ${m}` }).focus();
    await page.keyboard.press("Enter");
    await expect(bloqueS()).toHaveAttribute("data-iluminado", "");
    await expect(page.locator("[data-iluminado]")).toHaveCount(0, { timeout: 10_000 });

    // Movimiento reducido: la flecha no se anima y el scroll no es suave. Con movimiento normal, sí (la flecha rebota 2 veces y queda quieta).
    const registrarScroll = () =>
      page.evaluate(() => {
        const w = window as unknown as { __opcionesDeScroll: unknown[] };
        w.__opcionesDeScroll = [];
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
          w.__opcionesDeScroll.push(arg);
          return original.call(this, arg as ScrollIntoViewOptions);
        };
      });
    const flecha = () => fila(0).locator(".carta-flecha");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await abrir();
    expect(await flecha().evaluate((el) => getComputedStyle(el).animationName)).toBe("carta-rebote");
    expect(await flecha().evaluate((el) => getComputedStyle(el).animationIterationCount)).toBe("2");
    await registrarScroll();
    await fila(0).getByRole("button", { name: `Ir a las opciones de salsa ${m}` }).click();
    expect(await page.evaluate(() => (window as unknown as { __opcionesDeScroll: { behavior: string }[] }).__opcionesDeScroll[0]?.behavior)).toBe("smooth");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await abrir();
    expect(await flecha().evaluate((el) => getComputedStyle(el).animationName), "con movimiento reducido no se anima").toBe("none");
    await registrarScroll();
    await fila(0).getByRole("button", { name: `Ir a las opciones de salsa ${m}` }).click();
    expect(await page.evaluate(() => (window as unknown as { __opcionesDeScroll: { behavior: string }[] }).__opcionesDeScroll[0]?.behavior)).toBe("auto");
    await expect(bloqueS()).toHaveAttribute("data-iluminado", "");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // En papel no hay interacción: ni «elegí abajo ↓», ni «Va con», ni barra, y la palabra no lleva subrayado.
    await abrir();
    await fila(0).getByRole("button", { name: `Ir a las opciones de salsa ${m}` }).click();
    await page.emulateMedia({ media: "print" });
    await expect(fila(0).locator("[data-cue-abajo]")).toBeHidden();
    await expect(bloqueS().locator("[data-va-con]")).toBeHidden();
    expect(await fila(0).getByRole("button").first().evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("none");
    expect(await fila(0).evaluate((el) => getComputedStyle(el, "::before").display)).toBe("none");
    await page.emulateMedia({ media: "screen" });

    // A 1280 px también, sin violaciones.
    await page.setViewportSize({ width: 1280, height: 900 });
    await abrir();
    await fila(0).getByRole("button", { name: `Ir a las opciones de salsa ${m}` }).click();
    await expect(bloqueS()).toHaveAttribute("data-iluminado", "");
    expect((await new AxeBuilder({ page }).include("[data-carta-scroll]").analyze()).violations, "axe a 1280 px").toEqual([]);
  } finally {
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { seccionCartaId: seccion.id } });
  }
});

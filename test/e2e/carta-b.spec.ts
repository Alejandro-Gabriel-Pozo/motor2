import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prismaAdmin } from "../setup/cliente-duenio";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * Carta «B» (2026-11-04; `docs/diseno-descripcion-de-opciones-y-carta-b-2026-11-04.md`, etapa E1) en el navegador, con el servidor de producción y la base real: cada plato dice «Incluye guarnición», «Incluye
 * salsa» o «Incluye guarnición y salsa» (con las opciones que admite, si son un subconjunto) y al pie de la sección va un bloque por grupo, con sus opciones en texto. Se mira a 375 y a 1280 px, con
 * tres colores de marca (claro, oscuro y de bajo contraste) y con fondo claro y oscuro, con 5 y con 12 platos: sin violaciones de axe y sin desborde horizontal.
 *
 * Capturas (opcional, para mirar a ojo): con `MOTOR2_CARTA_B_CAPTURAS=<carpeta fuera del repo>` guarda un PNG por combinación. Sin la variable no se escribe ningún archivo.
 */

const EMPRESA = "e2e";

const MARCAS = [
  { nombre: "claro", color: "#f2d16b" },
  { nombre: "oscuro", color: "#1f2a44" },
  { nombre: "bajo-contraste", color: "#bcb8ae" },
] as const;
const FONDOS = [
  { nombre: "claro", color: "#faf7f0" },
  { nombre: "oscuro", color: "#1c1b19" },
] as const;

async function capturar(page: Page, nombre: string): Promise<void> {
  const carpeta = process.env.MOTOR2_CARTA_B_CAPTURAS;
  if (!carpeta) return;
  mkdirSync(carpeta, { recursive: true });
  await page.screenshot({ path: join(carpeta, `${nombre}.png`), fullPage: false });
}

test("carta B: «Incluye …» bajo cada plato y un bloque por grupo al pie de la sección, con 5 y 12 platos, tres marcas, fondo claro y oscuro", async ({ page, sucursalId }) => {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  // La carta pública se guarda en caché 60 s por sucursal y slug: cada combinación de tema y de platos usa un slug propio para no leer una carta vieja.
  let slug = `e2e-carta-b-${m}`;
  let tanda = 0;
  const guarnicion = await sembrarGrupo({ nombre: `Guarnición ${m}`, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Puré" }, { nombre: "Ensalada" }, { nombre: "Papas fritas" }] });
  const salsa = await sembrarGrupo({ nombre: `Salsa ${m}`, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Filetto" }, { nombre: "Crema" }, { nombre: "Rosa" }] });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Platos principales ${m}` } });
  const productoIds: string[] = [];
  const nombres: string[] = [];

  /** Siembra `n` platos: el 1.º y el 2.º incluyen guarnición, el 3.º y el 5.º, salsa; el 4.º incluye guarnición solo en «puré o ensalada» (un subconjunto); los demás, según su posición. */
  const sembrarPlatos = async (n: number) => {
    // El código y el nombre llevan la tanda (5 o 12): los productos de la primera siguen en la base cuando se siembra la segunda.
    for (let i = 0; i < n; i++) {
      const nombre = `E2E Plato ${n}-${i + 1} ${m}`;
      const conGuarnicion = i === 0 || i === 1 || i === 3 || (i >= 5 && i % 2 === 0);
      const conSalsa = i === 2 || i === 4 || (i >= 5 && i % 3 === 0);
      const grupos = [...(conGuarnicion ? [{ grupo: guarnicion }] : []), ...(conSalsa ? [{ grupo: salsa }] : [])];
      const { productoId } = await sembrarProductoConOpciones({ nombre, codigo: `E2E-CB-${m}-${n}-${i}`, precioVenta: 18000 + i * 1000, sucursalId, grupos });
      // El rol de la app no borra admisiones de opción: el subconjunto se arma con el dueño de la base.
      if (i === 3) await prismaAdmin.productoAdmiteOpcion.deleteMany({ where: { productoId, opcionId: guarnicion.opciones["Papas fritas"]!.opcionId } });
      await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId, visibleEnCarta: true, seccionCartaId: seccion.id, orden: i } });
      productoIds.push(productoId);
      nombres.push(nombre);
    }
  };
  const quitarPlatos = async () => {
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: productoIds } } });
    productoIds.length = 0;
    nombres.length = 0;
  };

  await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
  const usarTema = async (marca: string, fondo: string) => {
    slug = `e2e-carta-b-${m}-${++tanda}`;
    await prisma.sucursalPublica.updateMany({ where: { sucursalId }, data: { slug } });
    await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
    await prisma.temaCartaSucursal.create({ data: { sucursalId, aplicarEnCarta: true, valores: { color_marca: marca, color_fondo_dia: fondo } } });
  };
  const abrir = async () => {
    await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
    await page.getByRole("button", { name: new RegExp(seccion.nombre) }).click();
  };

  try {
    for (const cantidad of [5, 12]) {
      await sembrarPlatos(cantidad);
      for (const marca of MARCAS) {
        for (const fondo of FONDOS) {
          await usarTema(marca.color, fondo.color);
          for (const ancho of [375, 1280]) {
            await page.setViewportSize({ width: ancho, height: ancho === 375 ? 812 : 900 });
            await abrir();
            const etiqueta = `${cantidad} platos, marca ${marca.nombre}, fondo ${fondo.nombre}, ${ancho} px`;

            // Cada plato dice lo que incluye; el que no incluye nada no dice «Incluye».
            const fila = (i: number) => page.locator("li", { has: page.getByRole("heading", { name: nombres[i]! }) });
            await expect(fila(0).locator("[data-incluye]"), etiqueta).toHaveText(`Incluye guarnición ${m} · elegí abajo ↓`);
            await expect(fila(2).locator("[data-incluye]"), etiqueta).toHaveText(`Incluye salsa ${m} · elegí abajo ↓`);
            // El subconjunto se nombra («puré o ensalada»); el plato que ofrece todas las del bloque, no.
            await expect(fila(3).locator("[data-incluye]"), etiqueta).toHaveText(`Incluye guarnición ${m}: puré o ensalada · elegí abajo ↓`);
            await expect(page.locator("[data-incluye]", { hasText: "papas fritas" }), `ningún plato nombra «papas fritas» como subconjunto (${etiqueta})`).toHaveCount(0);
            // El pie de la sección: un bloque por grupo, con TODAS las opciones en texto (sin botones ni chips) y a qué platos va. «elegís 1» sale de los límites del grupo.
            const bloqueG = page.locator(`[data-bloque-de-opciones='Guarnición ${m}']`);
            const bloqueS = page.locator(`[data-bloque-de-opciones='Salsa ${m}']`);
            await expect(bloqueG.locator("h4"), etiqueta).toHaveText(`Guarnición ${m} · elegís 1`);
            await expect(bloqueG.locator("[data-rol=eleccion]"), etiqueta).toHaveText("puré · ensalada · papas fritas");
            await expect(bloqueG, etiqueta).toContainText(`Con los platos que dicen «Incluye guarnición ${m}»`);
            await expect(bloqueS.locator("[data-rol=eleccion]"), etiqueta).toHaveText("filetto · crema · rosa");
            await expect(bloqueG.locator("button, a, input"), `el bloque no tiene botones ni chips (${etiqueta})`).toHaveCount(0);
            // «En todos» se retiró.
            await expect(page.locator("body"), etiqueta).not.toContainText("En todos");
            // El bloque está al pie: después del último plato.
            const posiciones = await page.evaluate(
              ([ultimo, grupo]) => {
                const filas = [...document.querySelectorAll<HTMLElement>("[data-carta-scroll] > li")];
                const iPlato = filas.findIndex((l) => l.textContent?.includes(ultimo));
                const iBloque = filas.findIndex((l) => l.getAttribute("data-bloque-de-opciones") === grupo);
                return { iPlato, iBloque };
              },
              [nombres[nombres.length - 1]!, `Guarnición ${m}`] as const,
            );
            expect(posiciones.iBloque, `el bloque va después del último plato (${etiqueta})`).toBeGreaterThan(posiciones.iPlato);
            // Sin desborde horizontal ni violaciones de accesibilidad.
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `la página se desborda (${etiqueta})`).toBe(true);
            // Axe sobre lo NUEVO de la carta B (la línea «Incluye …» y los bloques del pie). La página entera no se exige con las marcas clara y de bajo contraste: el precio y el número de sección usan el color de
            // marca tal cual (decisión anterior del tema, fuera de E1) y con esas marcas no llegan a 4,5:1; se informa aparte.
            const nuevo = await new AxeBuilder({ page }).include("[data-incluye]").include("[data-bloque-de-opciones]").analyze();
            expect(nuevo.violations, `axe (línea «Incluye» y bloques): ${etiqueta}`).toEqual([]);
            if (marca.nombre === "oscuro" && fondo.nombre === "claro") expect((await new AxeBuilder({ page }).analyze()).violations, `axe de la página entera: ${etiqueta}`).toEqual([]);

            await bloqueG.scrollIntoViewIfNeeded();
            await capturar(page, `carta-b-${cantidad}-platos-marca-${marca.nombre}-fondo-${fondo.nombre}-${ancho}`);
          }
        }
      }
      await quitarPlatos();
    }
  } finally {
    await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { seccionCartaId: seccion.id } });
  }
});

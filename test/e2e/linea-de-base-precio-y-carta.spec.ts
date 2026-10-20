import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { limpiarLineaDeBasePrecioYCarta, restosDeLaLineaDeBase, sembrarLineaDeBasePrecioYCarta } from "./fixtures/siembra-precio-y-carta";

/**
 * LÍNEA DE BASE DE NAVEGADOR de la ola «precio y carta» (Fase 0): congela el TEXTO VISIBLE de la carta pública y de las pantallas de administración del catálogo de opciones TAL
 * COMO SE DIBUJAN HOY, a 375 px y a 1280 px, para que las fases siguientes (escala de letra única, impresión, carta pareja, espacio del producto) puedan mostrar qué cambió
 * exactamente. Completa las caracterizaciones pura (`test/caracterizacion-precio-y-carta/precios.test.ts`) e integrada (`cobro-y-carta.test.ts`): esas congelan lo que se calcula,
 * esta lo que se VE.
 *
 * Qué vuelca (al golden `linea-de-base-precio-y-carta.golden.txt`):
 *  - la carta pública de la sucursal dedicada (`/carta-publica/e2e/lb-precio-y-carta`, catálogo de referencia de `fixtures/siembra-precio-y-carta.ts`): la estructura (barra superior,
 *    portada, índice, cada sección con sus ítems, el precio del renglón, las listas de tamaños con su precio, las pastillas sin costo, la línea «Adicionales:»), el texto plano de
 *    cada página y la TIPOGRAFÍA computada (fontSize / fontWeight) de lo que la Fase 5 va a unificar: foto de hoy, no aprobación;
 *  - tres pantallas de administración, con el usuario propio de la siembra (solo ve la sucursal dedicada): las opciones de venta del producto «Pizzas», el grupo «Tipos de Pizza» y
 *    Parametrización › Secciones de la carta. Títulos, encabezados, etiquetas, botones, avisos y los valores de los campos (nunca fechas: se enmascaran); de los `<select>`, solo
 *    la opción elegida (la lista completa trae grupos y productos de otros specs).
 *
 * Determinismo: la sucursal, el slug, los nombres y los precios son fijos; la carta solo muestra lo de la sucursal dedicada. En «Secciones» (las secciones son de la EMPRESA) se
 * dejan solo las cuatro sembradas y se enmascara lo que depende de cuántas haya en la base (el número de posición y el «Orden» sugerido de la sección nueva).
 *
 * Es una FOTO de hoy, no una aprobación. Se escribe sola la primera vez; para regenerarla A PROPÓSITO (un cambio de presentación decidido):
 * `REGENERAR_LB_PRECIO_Y_CARTA=1 npx playwright test test/e2e/linea-de-base-precio-y-carta.spec.ts`, y se revisa el diff del golden en el commit.
 *
 * Capturas (opcional, para mirar a ojo): con `MOTOR2_LB_CAPTURAS=<carpeta fuera del repo>` guarda un PNG por página de la carta (y la vista de impresión) y por pantalla de
 * administración, a cada ancho. Sin la variable no se escribe ningún archivo.
 */

const EMPRESA = "e2e";
const ARCHIVO = join(__dirname, "linea-de-base-precio-y-carta.golden.txt");
const ANCHOS = [
  { ancho: 375, alto: 812 },
  { ancho: 1280, alto: 900 },
] as const;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Capturas

async function capturar(page: Page, nombre: string): Promise<void> {
  const carpeta = process.env.MOTOR2_LB_CAPTURAS;
  if (!carpeta) return;
  mkdirSync(carpeta, { recursive: true });
  await page.screenshot({ path: join(carpeta, `${nombre}.png`), fullPage: true });
}

/** La carta es un deslizador horizontal (una página por pantalla): una captura por página, y la de impresión (todas las páginas una debajo de la otra). */
async function capturarCarta(page: Page, ancho: number, paginas: readonly string[]): Promise<void> {
  if (!process.env.MOTOR2_LB_CAPTURAS) return;
  await capturar(page, `carta-${ancho}`);
  for (const [i, nombre] of paginas.entries()) {
    await page.evaluate((indice) => {
      const slider = document.querySelector<HTMLElement>("[data-carta-slider]")!;
      slider.scrollTo({ left: indice * slider.clientWidth, behavior: "instant" });
    }, i);
    await page.waitForTimeout(150);
    await capturar(page, `carta-${ancho}-${String(i + 1).padStart(2, "0")}-${nombre}`);
  }
  await page.evaluate(() => document.querySelector<HTMLElement>("[data-carta-slider]")!.scrollTo({ left: 0, behavior: "instant" }));
  await page.emulateMedia({ media: "print" });
  await capturar(page, `carta-${ancho}-impresion`);
  await page.emulateMedia({ media: "screen" });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Carta pública: estructura, texto plano por página y tipografía (todo leído del DOM, con `innerText` y `getComputedStyle`)

interface Letra {
  que: string;
  fontSize: string;
  fontWeight: string;
}

interface ItemDeCarta {
  nombre: string;
  /** Lo que se dibuja a la derecha del nombre (null: nada, la lista de tamaños dice cada precio). */
  precioDelRenglon: string | null;
  tamanos: { grupo: string; filas: string[] }[];
  pastillas: { etiqueta: string; lista: string; opciones: string[] }[];
  adicionales: string | null;
  /** Todo el texto visible de la fila (para que nada quede afuera aunque cambie la estructura). */
  texto: string[];
}

interface CartaVolcada {
  barraSuperior: string[];
  paginas: { tipo: string; texto: string[] }[];
  indice: { titulo: string; entradas: string[] };
  secciones: { etiqueta: string; titulo: string; items: ItemDeCarta[] }[];
  navegacion: string[];
  tipografia: Letra[];
}

function volcarCarta(page: Page): Promise<CartaVolcada> {
  return page.evaluate((): CartaVolcada => {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const lineas = (el: Element | null) => (el ? (el as HTMLElement).innerText.split("\n").map(norm).filter(Boolean) : []);
    const texto = (el: Element | null) => (el ? norm((el as HTMLElement).innerText) : "");
    const tipografia: Letra[] = [];
    const letra = (que: string, el: Element | null) => {
      if (!el) return;
      const c = getComputedStyle(el);
      tipografia.push({ que, fontSize: c.fontSize, fontWeight: c.fontWeight });
    };
    const libro = document.querySelector("[data-carta-libro]")!;
    const barra = libro.querySelector("[data-carta-topbar]");
    const barraSuperior = [...(barra?.querySelectorAll("a, button") ?? [])].map((el) => {
      const etiqueta = el.getAttribute("aria-label");
      return `${el.tagName === "A" ? "enlace" : "botón"} «${texto(el) || etiqueta}»${etiqueta && texto(el) ? ` (lector: «${etiqueta}»)` : ""}`;
    });
    letra("barra superior · volver (enlace)", barra?.querySelector("a") ?? null);

    const paginasEl = [...libro.querySelector("[data-carta-slider]")!.children];
    const tipoDe = (p: Element) => (p.querySelector("[data-carta-banda]") ? "sección" : p.querySelector("[data-carta-indice-lista]") ? "índice" : "portada");
    const paginas = paginasEl.map((p) => ({ tipo: tipoDe(p), texto: lineas(p) }));

    const portada = paginasEl.find((p) => tipoDe(p) === "portada") ?? null;
    letra("portada · nombre (h1)", portada?.querySelector("h1") ?? null);

    const paginaIndice = paginasEl.find((p) => tipoDe(p) === "índice") ?? null;
    const indice = {
      titulo: texto(paginaIndice?.querySelector("h1") ?? null),
      entradas: [...(paginaIndice?.querySelectorAll("[data-carta-indice-lista] li") ?? [])].map((li) => [...li.querySelectorAll("button > span")].map(texto).join(" ")),
    };
    letra("índice · título (h1)", paginaIndice?.querySelector("h1") ?? null);
    letra("índice · número de la sección", paginaIndice?.querySelector("[data-carta-indice-lista] li button > span") ?? null);
    letra("índice · nombre de la sección", paginaIndice?.querySelector("[data-carta-indice-lista] li button > span:last-child") ?? null);

    const vistos = new Set<string>();
    const primeraVez = (clave: string) => {
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    };
    const secciones = paginasEl
      .filter((p) => tipoDe(p) === "sección")
      .map((p, i) => {
        const banda = p.querySelector("[data-carta-banda]")!;
        if (i === 0) {
          letra("banda · etiqueta «01 / NN» (p)", banda.querySelector("p"));
          letra("banda · título de la sección (h2)", banda.querySelector("h2"));
        }
        const items = [...p.querySelectorAll("[data-carta-scroll] > li")].map((li): ItemDeCarta => {
          const h3 = li.querySelector("h3");
          const nombre = texto(h3);
          const precio = h3?.nextElementSibling ?? null;
          const tamanos = [...li.querySelectorAll("[data-tamanos-carta]")].map((ul) => ({
            grupo: ul.getAttribute("aria-label") ?? "",
            filas: [...ul.querySelectorAll(":scope > li")].map((fila) => [...fila.querySelectorAll(":scope > span")].map((s) => texto(s) || "…").join(" ")),
          }));
          const pastillas = [...li.querySelectorAll("[data-opciones-sin-costo]")].map((div) => ({
            etiqueta: texto(div.querySelector("p")),
            lista: div.querySelector("ul")?.getAttribute("aria-label") ?? "",
            opciones: [...div.querySelectorAll("li")].map(texto),
          }));
          const suma = li.querySelector("[data-suma-carta]");
          const conTamanos = tamanos.length > 0;
          const conOpciones = conTamanos || pastillas.length > 0 || suma !== null;
          const tipo = conTamanos ? "ítem con lista de tamaños" : conOpciones ? "ítem con opciones y precio en el renglón" : "ítem sin opciones";
          if (primeraVez(tipo)) {
            letra(`${tipo} «${nombre}» · nombre (h3)`, h3);
            if (precio) letra(`${tipo} «${nombre}» · precio del renglón`, precio);
          }
          const filaTamano = li.querySelector("[data-tamanos-carta] > li");
          if (filaTamano && primeraVez("tamaños")) {
            letra(`lista de tamaños «${nombre}» · fila (li)`, filaTamano);
            letra(`lista de tamaños «${nombre}» · nombre del tamaño`, filaTamano.querySelector(":scope > span"));
            letra(`lista de tamaños «${nombre}» · precio del tamaño`, filaTamano.querySelector(":scope > span:last-child"));
          }
          const sinCosto = li.querySelector("[data-opciones-sin-costo]");
          if (sinCosto && primeraVez("pastillas")) {
            letra(`pastillas «${nombre}» · nombre del grupo (p)`, sinCosto.querySelector("p"));
            letra(`pastillas «${nombre}» · pastilla (li)`, sinCosto.querySelector("li"));
          }
          if (suma && primeraVez("adicionales")) {
            letra(`adicionales «${nombre}» · línea (p)`, suma);
            letra(`adicionales «${nombre}» · «Adicionales:» (strong)`, suma.querySelector("strong"));
          }
          return { nombre, precioDelRenglon: precio ? texto(precio) : null, tamanos, pastillas, adicionales: suma ? texto(suma) : null, texto: lineas(li) };
        });
        return { etiqueta: texto(banda.querySelector("p")), titulo: texto(banda.querySelector("h2")), items };
      });

    const nav = libro.querySelector("[data-carta-nav]");
    const navegacion = [...(nav?.querySelectorAll("a, button, p") ?? [])].map((el) => {
      const etiqueta = el.getAttribute("aria-label");
      const t = texto(el);
      return `${el.tagName === "P" ? "texto" : el.tagName === "A" ? "enlace" : "botón"} «${t || etiqueta}»${etiqueta && t ? ` (lector: «${etiqueta}»)` : ""}${(el as HTMLButtonElement).disabled ? " (deshabilitado)" : ""}`;
    });
    return { barraSuperior, paginas, indice, secciones, navegacion, tipografia };
  });
}

function textoDeCarta(c: CartaVolcada): string[] {
  const out: string[] = [];
  out.push("### Barra superior", ...c.barraSuperior.map((l) => `  ${l}`));
  out.push(`### Páginas del deslizador (en orden): ${c.paginas.map((p) => p.tipo).join(" · ")}`);
  out.push("### Índice", `  título «${c.indice.titulo}»`, ...c.indice.entradas.map((e) => `  ${e}`));
  for (const s of c.secciones) {
    out.push(`### Sección «${s.titulo}» (banda «${s.etiqueta}»)`);
    for (const it of s.items) {
      out.push(`  ÍTEM «${it.nombre}» · precio del renglón: ${it.precioDelRenglon === null ? "(ninguno)" : `«${it.precioDelRenglon}»`}`);
      for (const t of it.tamanos) out.push(`    lista de tamaños «${t.grupo}»: ${t.filas.join(" | ")}`);
      for (const p of it.pastillas) out.push(`    pastillas «${p.etiqueta}» (lista «${p.lista}»): ${p.opciones.join(" | ")}`);
      if (it.adicionales !== null) out.push(`    adicionales: «${it.adicionales}»`);
      out.push(`    texto visible: ${it.texto.map((l) => `«${l}»`).join(" ")}`);
    }
  }
  out.push("### Barra de navegación (en la portada)", ...c.navegacion.map((l) => `  ${l}`));
  out.push("### Texto plano de cada página (innerText, una línea por renglón)");
  for (const [i, p] of c.paginas.entries()) out.push(`  [${i + 1} ${p.tipo}] ${p.texto.map((l) => `«${l}»`).join(" ")}`);
  out.push("### Tipografía computada (getComputedStyle: fontSize / fontWeight) — FOTO DE HOY, NO APROBACIÓN: es la escala que la Fase 5 va a unificar");
  for (const l of c.tipografia) out.push(`  ${l.que}: ${l.fontSize} / ${l.fontWeight}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Pantallas de administración: texto visible de `main`, con los controles anotados

/**
 * Anota los controles del `main` EN EL DOM (después de capturar) y devuelve su `innerText` renglón por renglón: `# ` en los títulos, `[botón: …]`, `[enlace: …]`, `[campo: «valor»]`
 * (las fechas se enmascaran), `[x]`/`[ ]` en casillas y radios, `[selección: …]` con SOLO la opción elegida, `[lector: …]` en el texto solo para lectores de pantalla, `▸`/`▾` en
 * los desplegables. Con `secciones`, deja solo esas secciones de carta (las demás son de otros specs) y enmascara lo que depende de cuántas haya; después abre los desplegables de
 * esas secciones y devuelve su texto aparte.
 */
function volcarAdmin(page: Page, secciones: readonly string[] | null): Promise<{ visible: string[]; abiertos: { que: string; texto: string[] }[] }> {
  return page.evaluate((propias) => {
    const raiz = document.querySelector("main")!;
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const sinFechas = (s: string) => s.replace(/\b\d{2}\/\d{2}\/\d{4}(?: \d{2}:\d{2})?/g, "«fecha»").replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g, "«fecha»");
    const lineas = (el: HTMLElement) => el.innerText.split("\n").map(norm).filter(Boolean).map(sinFechas);

    if (propias) {
      for (const atributo of ["data-seccion-orden", "data-seccion-carta", "data-grupo-de-la-carta"]) {
        for (const el of raiz.querySelectorAll(`[${atributo}]`)) if (!propias.includes(el.getAttribute(atributo) ?? "")) el.remove();
      }
      // La posición en «Secciones de la carta» (1, 2, …) depende de cuántas secciones haya en la base.
      for (const fila of raiz.querySelectorAll("[data-seccion-orden]")) {
        const numero = fila.firstElementChild;
        if (numero && /^\d+$/.test(norm(numero.textContent ?? ""))) numero.textContent = "n";
      }
      // El «Orden» sugerido de una sección nueva es la cantidad de secciones de la empresa.
      for (const form of raiz.querySelectorAll("form")) {
        if ([...form.querySelectorAll("button")].some((b) => norm(b.textContent ?? "") === "Crear sección")) form.querySelector("input[name=orden]")?.setAttribute("data-lb-variable", "");
      }
    }

    for (const el of raiz.querySelectorAll<HTMLElement>(".sr-only")) el.textContent = ` [lector: ${norm(el.textContent ?? "")}] `;
    for (const s of raiz.querySelectorAll("select")) {
      const marca = document.createElement("span");
      marca.textContent = ` [selección: ${norm(s.selectedOptions[0]?.text ?? "")}] `;
      s.after(marca);
      s.style.display = "none";
    }
    for (const i of raiz.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
      if (i.type === "hidden") continue;
      const marca = document.createElement("span");
      if (i.type === "checkbox" || i.type === "radio") {
        marca.textContent = (i as HTMLInputElement).checked ? "[x] " : "[ ] ";
        i.before(marca);
        continue;
      }
      if (i.hasAttribute("data-lb-variable")) marca.textContent = " [campo: (depende de la base)] ";
      else if (/date|time|month|week/.test(i.type)) marca.textContent = " [campo de fecha] ";
      else marca.textContent = ` [campo: ${i.value ? `«${sinFechas(i.value)}»` : "vacío"}${i.placeholder ? `, ayuda «${i.placeholder}»` : ""}${i.readOnly ? ", solo lectura" : ""}] `;
      i.after(marca);
    }
    // Dentro de un desplegable cerrado `innerText` da vacío: ahí vale el texto del nodo.
    for (const b of raiz.querySelectorAll("button")) {
      const t = norm(b.innerText) || norm(b.textContent ?? "");
      const etiqueta = b.getAttribute("aria-label");
      b.textContent = `[botón: ${t || etiqueta}${etiqueta && t && etiqueta !== t ? ` (lector: «${etiqueta}»)` : ""}${b.disabled ? " (deshabilitado)" : ""}]`;
    }
    for (const a of raiz.querySelectorAll("a")) a.textContent = `[enlace: ${norm(a.innerText) || norm(a.textContent ?? "")}]`;
    for (const h of raiz.querySelectorAll("h1, h2, h3, h4")) h.prepend(`${"#".repeat(Number(h.tagName[1]))} `);
    for (const s of raiz.querySelectorAll("summary")) s.prepend(s.parentElement instanceof HTMLDetailsElement && s.parentElement.open ? "▾ " : "▸ ");

    const visible = lineas(raiz);
    const abiertos: { que: string; texto: string[] }[] = [];
    if (propias) {
      for (const atributo of ["data-seccion-carta", "data-grupo-de-la-carta"]) {
        for (const el of raiz.querySelectorAll<HTMLElement>(`[${atributo}]`)) {
          // Se abren el desplegable de la sección y los de adentro (la ficha de cada producto).
          const desplegables = [...(el instanceof HTMLDetailsElement ? [el] : []), ...el.querySelectorAll("details")];
          if (!desplegables.length) continue;
          for (const det of desplegables) {
            det.open = true;
            const resumen = det.querySelector(":scope > summary");
            if (resumen?.firstChild?.nodeType === Node.TEXT_NODE) resumen.firstChild.textContent = "▾ ";
          }
          abiertos.push({ que: `${atributo}=«${el.getAttribute(atributo)}» (abierto)`, texto: lineas(el) });
        }
      }
    }
    return { visible, abiertos };
  }, secciones ? [...secciones] : null);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

test("línea de base de navegador de la carta pública y del catálogo de opciones (texto visible y tipografía, 375 y 1280 px)", async ({ page, browser, baseURL, sucursalId }) => {
  test.setTimeout(240_000);
  // `sucursalId` asegura la base de los fixtures (unidades, rol admin, el usuario de las pruebas) antes de sembrar.
  expect(sucursalId).toBeTruthy();
  const contexto = await browser.newContext();
  let llegoAlFinal = false;
  try {
    const d = await sembrarLineaDeBasePrecioYCarta();
    const host = new URL(baseURL ?? "http://localhost:3000").hostname;
    await contexto.addCookies([{ name: "authjs.session-token", value: d.sessionToken, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
    const admin = await contexto.newPage();

    const ruta = `/carta-publica/${EMPRESA}/${d.slug}`;
    const golden: string[] = [
      "# Línea de base de navegador (Fase 0 de la ola «precio y carta»): el texto visible de la carta pública y del catálogo de opciones HOY. Foto de hoy, no aprobación.",
      `# Catálogo de referencia (test/e2e/fixtures/siembra-precio-y-carta.ts) en la sucursal dedicada «${d.sucursalNombre}». Regenerar a propósito: REGENERAR_LB_PRECIO_Y_CARTA=1.`,
    ];

    // 1. La carta pública (sin sesión), a cada ancho.
    for (const { ancho, alto } of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: alto });
      const r = await page.goto(ruta);
      expect(r?.status(), `la carta a ${ancho} px`).toBe(200);
      await expect(page.locator("[data-carta-banda] h2")).toHaveCount(d.secciones.length);
      await page.waitForLoadState("networkidle");
      const carta = await volcarCarta(page);
      expect(carta.secciones.map((s) => s.titulo), "las secciones sembradas, en su orden").toEqual(d.secciones);
      const titulos = carta.secciones.map((s) => `seccion-${s.titulo}`);
      const nombres = carta.paginas.map((p) => (p.tipo === "sección" ? (titulos.shift() ?? "seccion") : p.tipo));
      await capturarCarta(page, ancho, nombres.map((n) => n.normalize("NFD").replace(/[^\w-]/g, "").toLowerCase()));
      golden.push("", `## CARTA PÚBLICA a ${ancho} px (${ruta})`, ...textoDeCarta(carta));
    }

    // 2. Las pantallas de administración (usuario propio, sucursal dedicada), a 1280 y a 375.
    const pantallas = [
      { clave: "opciones-del-producto-pizzas", titulo: "Opciones de venta del producto «Pizzas»", url: `/catalogo/productos/${d.productoId.pizzas}/opciones`, rutaVisible: "/catalogo/productos/<id de Pizzas>/opciones", secciones: null },
      { clave: "grupo-tipos-de-pizza", titulo: "Grupo de opciones «Tipos de Pizza»", url: `/catalogo/opciones/${d.grupoId.tiposDePizza}`, rutaVisible: "/catalogo/opciones/<id de Tipos de Pizza>", secciones: null },
      { clave: "parametrizacion-secciones", titulo: "Carta › Parametrización › Secciones", url: "/carta/parametrizacion/secciones", rutaVisible: "/carta/parametrizacion/secciones", secciones: d.secciones },
    ] as const;
    for (const p of pantallas) {
      for (const { ancho, alto } of [...ANCHOS].reverse()) {
        await admin.setViewportSize({ width: ancho, height: alto });
        const r = await admin.goto(p.url);
        expect(r?.status(), `${p.titulo} a ${ancho} px`).toBe(200);
        await expect(admin.locator("main h1").first()).toBeVisible();
        await admin.waitForLoadState("networkidle");
        await capturar(admin, `admin-${p.clave}-${ancho}`);
        const { visible, abiertos } = await volcarAdmin(admin, p.secciones);
        golden.push("", `## ADMINISTRACIÓN a ${ancho} px: ${p.titulo} (${p.rutaVisible})`, ...visible.map((l) => `  ${l}`));
        for (const a of abiertos) golden.push(`  --- ${a.que}`, ...a.texto.map((l) => `    ${l}`));
      }
    }

    const actual = `${golden.join("\n")}\n`;
    if (process.env.REGENERAR_LB_PRECIO_Y_CARTA === "1" || !existsSync(ARCHIVO)) writeFileSync(ARCHIVO, actual);
    expect(actual).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
    llegoAlFinal = true;
  } finally {
    await contexto.close();
    await limpiarLineaDeBasePrecioYCarta();
  }
  // No contamina a los specs que siguen (comparten la base): la limpieza no dejó nada. Solo si llegó al final, para no tapar el error de verdad.
  if (llegoAlFinal) expect(await restosDeLaLineaDeBase(), "restos de la línea de base después de limpiar").toEqual([]);
});

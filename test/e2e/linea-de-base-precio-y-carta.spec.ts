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
 * Fase 5 («carta pareja», paso 13): la siembra marca Pizzas y Milanesas como BASE, «Milanesas de» con «De» y «Pizza bomba» agotada hoy, así la carta muestra las cuatro formas; el
 * volcado lee la forma de cada ítem (tablas, filas, lo que se lee debajo), exige UN par tamaño / peso por rol de la escala única (DEC-35) a cada ancho y mira la carta en PAPEL (nada cortado,
 * completa con lo agotado hoy, el pie con la fecha y la dirección). Con `MOTOR2_LB_CAPTURAS` captura además la carta con un tema oscuro.
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

/** La carta es un deslizador horizontal (una página por pantalla): una captura por página, y la de impresión (todas las páginas una debajo de la otra). `tema` antepone «oscuro-» y demás. */
async function capturarCarta(page: Page, ancho: number, paginas: readonly string[], tema = ""): Promise<void> {
  if (!process.env.MOTOR2_LB_CAPTURAS) return;
  await capturar(page, `${tema}carta-${ancho}`);
  for (const [i, nombre] of paginas.entries()) {
    await page.evaluate((indice) => {
      const slider = document.querySelector<HTMLElement>("[data-carta-slider]")!;
      slider.scrollTo({ left: indice * slider.clientWidth, behavior: "instant" });
    }, i);
    await page.waitForTimeout(150);
    await capturar(page, `${tema}carta-${ancho}-${String(i + 1).padStart(2, "0")}-${nombre}`);
  }
  await page.evaluate(() => document.querySelector<HTMLElement>("[data-carta-slider]")!.scrollTo({ left: 0, behavior: "instant" }));
  await page.emulateMedia({ media: "print" });
  await capturar(page, `${tema}carta-${ancho}-impresion`);
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
  /** Fase 5 («carta pareja»): la forma con que se dibuja (`data-forma`), «tanda» (una tabla por producto, de columnas compartidas) o «sin opciones» / «sin forma». */
  forma: string;
  /** El nombre (los h3; en una tanda, el de cada producto, que protagoniza con su tabla propia). */
  nombre: string;
  /** Lo que se dibuja a la derecha del nombre (null: nada; en una tabla o una lista, cada fila dice su precio). */
  precioDelRenglon: string | null;
  /** Una tabla real: los encabezados de columna y cada fila (sus celdas separadas por « | »). */
  tabla: { columnas: string[]; filas: string[] } | null;
  /** Las filas de una lista (`data-filas-carta`). */
  filas: string[];
  /** Lo que se lee debajo del plato (`data-aclaracion`). */
  aclaraciones: string[];
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
  /** Fase 5 (DEC-35, la escala única): cada ROL (`data-rol`) con los pares tamaño / peso distintos que se ven en la carta (tiene que ser UNO por rol). */
  roles: { rol: string; pares: string[] }[];
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

    // Solo lo que se ve en pantalla (lo que es solo del papel —la carta completa con lo agotado hoy, el pie— no cuenta acá).
    const paginasEl = [...libro.querySelector("[data-carta-slider]")!.children].filter((el) => el.getClientRects().length > 0);
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
          const conOpciones = li.querySelector("[data-filas-carta], [data-aclaracion]") !== null;
          const forma = li.getAttribute("data-forma") ?? (li.hasAttribute("data-tanda") ? "tanda" : conOpciones ? "sin forma (como antes)" : "sin opciones");
          const nombres = [...li.querySelectorAll("h3")].map(texto);
          const nombre = nombres.join(" | ");
          const precio = li.querySelector(":scope > div > [data-rol=precio]");
          const tablaEl = li.querySelector("table");
          const tabla = tablaEl
            ? {
                columnas: [...tablaEl.querySelectorAll("th[scope=col]")].map(texto),
                filas: [...tablaEl.querySelectorAll("tbody > tr")].map((tr) => [...tr.children].map((c) => texto(c) || "…").join(" | ")),
              }
            : null;
          const filas = [...li.querySelectorAll("[data-filas-carta] > li")].map(texto);
          const aclaraciones = [...li.querySelectorAll("[data-aclaracion]")].map(texto);
          if (primeraVez(`forma ${forma}`)) {
            letra(`forma «${forma}» «${nombres[0] ?? ""}» · nombre`, li.querySelector("h3"));
            if (precio) letra(`forma «${forma}» «${nombres[0] ?? ""}» · precio del renglón`, precio);
          }
          return { forma, nombre, precioDelRenglon: precio ? texto(precio) : null, tabla, filas, aclaraciones, texto: lineas(li) };
        });
        return { etiqueta: texto(banda.querySelector("p")), titulo: texto(banda.querySelector("h2")), items };
      });

    const nav = libro.querySelector("[data-carta-nav]");
    const navegacion = [...(nav?.querySelectorAll("a, button, p") ?? [])].map((el) => {
      const etiqueta = el.getAttribute("aria-label");
      const t = texto(el);
      return `${el.tagName === "P" ? "texto" : el.tagName === "A" ? "enlace" : "botón"} «${t || etiqueta}»${etiqueta && t ? ` (lector: «${etiqueta}»)` : ""}${(el as HTMLButtonElement).disabled ? " (deshabilitado)" : ""}`;
    });
    // DEC-35: cada rol de la escala con los pares tamaño / peso que se ven (solo lo visible: en pantalla, lo que es solo del papel no cuenta).
    const porRol = new Map<string, Set<string>>();
    for (const el of libro.querySelectorAll<HTMLElement>("[data-rol]")) {
      if (el.getClientRects().length === 0) continue;
      const c = getComputedStyle(el);
      const rol = el.getAttribute("data-rol")!;
      porRol.set(rol, (porRol.get(rol) ?? new Set()).add(`${c.fontSize} / ${c.fontWeight}`));
    }
    const roles = [...porRol].map(([rol, pares]) => ({ rol, pares: [...pares].sort() })).sort((a, b) => a.rol.localeCompare(b.rol));
    return { barraSuperior, paginas, indice, secciones, navegacion, tipografia, roles };
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
      out.push(`  ÍTEM «${it.nombre}» · forma: ${it.forma} · precio del renglón: ${it.precioDelRenglon === null ? "(ninguno)" : `«${it.precioDelRenglon}»`}`);
      if (it.tabla) out.push(`    tabla: columnas ${it.tabla.columnas.map((c) => `«${c}»`).join(" ")}`, ...it.tabla.filas.map((f) => `      fila: ${f}`));
      if (it.filas.length) out.push(`    filas: ${it.filas.map((f) => `«${f}»`).join(" ")}`);
      for (const a of it.aclaraciones) out.push(`    debajo: «${a}»`);
      out.push(`    texto visible: ${it.texto.map((l) => `«${l}»`).join(" ")}`);
    }
  }
  out.push("### Barra de navegación (en la portada)", ...c.navegacion.map((l) => `  ${l}`));
  out.push("### Texto plano de cada página (innerText, una línea por renglón)");
  for (const [i, p] of c.paginas.entries()) out.push(`  [${i + 1} ${p.tipo}] ${p.texto.map((l) => `«${l}»`).join(" ")}`);
  out.push("### Tipografía computada (getComputedStyle: fontSize / fontWeight)");
  for (const l of c.tipografia) out.push(`  ${l.que}: ${l.fontSize} / ${l.fontWeight}`);
  out.push("### Escala única (DEC-35): cada rol, con su ÚNICO par tamaño / peso");
  for (const r of c.roles) out.push(`  ${r.rol}: ${r.pares.join(" · ")}`);
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
  test.setTimeout(420_000);
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
      // Solo las bandas que se ven: con algo agotado hoy, la carta completa del papel también está en la página (oculta en pantalla).
      await expect(page.locator("[data-carta-banda] h2:visible")).toHaveCount(d.secciones.length);
      await page.waitForLoadState("networkidle");
      const carta = await volcarCarta(page);
      expect(carta.secciones.map((s) => s.titulo), "las secciones sembradas, en su orden").toEqual(d.secciones);
      // DEC-35 (escala única, P41 del plan): cada rol con UN solo par tamaño / peso, a cada ancho.
      expect(carta.roles.filter((r) => r.pares.length !== 1), `escala única a ${ancho} px`).toEqual([]);
      // Lo agotado hoy no se ve en la pantalla.
      expect(carta.paginas.flatMap((x) => x.texto).join(" "), "«Pizza bomba» está agotada hoy").not.toContain("Pizza bomba");
      const titulos = carta.secciones.map((s) => `seccion-${s.titulo}`);
      const nombres = carta.paginas.map((p) => (p.tipo === "sección" ? (titulos.shift() ?? "seccion") : p.tipo));
      await capturarCarta(page, ancho, nombres.map((n) => n.normalize("NFD").replace(/[^\w-]/g, "").toLowerCase()));
      golden.push("", `## CARTA PÚBLICA a ${ancho} px (${ruta})`, ...textoDeCarta(carta));

      // DEC-20 (paso 10): en PAPEL la carta sale entera (ninguna lista con scroll cortada), completa (con lo agotado hoy), en puntos y con el pie (fecha y dirección en texto).
      await page.emulateMedia({ media: "print" });
      const papel = await page.evaluate(() => {
        const norm = (x: string) => x.replace(/\s+/g, " ").trim();
        const visibles = [...document.querySelectorAll<HTMLElement>("[data-carta-libro] [data-carta-scroll]")].filter((el) => el.getClientRects().length > 0);
        const cortadas = visibles.filter((el) => el.scrollHeight > el.clientHeight + 1).length;
        const pie = document.querySelector<HTMLElement>("[data-carta-pie-impreso]");
        const porRol = new Map<string, Set<string>>();
        for (const el of document.querySelectorAll<HTMLElement>("[data-carta-libro] [data-rol]")) {
          if (el.getClientRects().length === 0) continue;
          const c = getComputedStyle(el);
          porRol.set(el.getAttribute("data-rol")!, (porRol.get(el.getAttribute("data-rol")!) ?? new Set()).add(`${c.fontSize} / ${c.fontWeight}`));
        }
        return {
          cortadas,
          pie: pie && pie.getClientRects().length > 0 ? norm(pie.innerText) : null,
          conLoAgotado: norm(document.querySelector<HTMLElement>("[data-carta-libro]")!.innerText).includes("Pizza bomba"),
          roles: [...porRol].map(([rol, pares]) => `${rol}: ${[...pares].sort().join(" · ")}`).sort(),
        };
      });
      await page.emulateMedia({ media: "screen" });
      expect(papel.cortadas, `listas cortadas en papel a ${ancho} px`).toBe(0);
      expect(papel.pie).toMatch(/^Precios vigentes al \d{2}\/\d{2}\/\d{4} · http:\/\/carta\.localhost\/lb-precio-y-carta$/);
      expect(papel.conLoAgotado, "la carta impresa sale completa (con lo agotado hoy)").toBe(true);
      golden.push(
        `### Impresión a ${ancho} px (emulada)`,
        `  listas cortadas: ${papel.cortadas}`,
        `  pie: «${(papel.pie ?? "").replace(/\d{2}\/\d{2}\/\d{4}/, "«fecha»")}»`,
        `  con lo agotado hoy («Pizza bomba»): ${papel.conLoAgotado ? "sí" : "no"}`,
        ...papel.roles.map((r) => `  ${r}`),
      );
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

    // Capturas con TEMA OSCURO (solo con MOTOR2_LB_CAPTURAS, fuera del golden): el usuario propio carga un fondo oscuro y un color de marca en el tema de la sucursal, lo aplica (la acción
    // revalida la carta) y se vuelve a capturar la carta a cada ancho. La limpieza borra el tema.
    if (process.env.MOTOR2_LB_CAPTURAS) {
      await admin.setViewportSize({ width: 1280, height: 900 });
      await admin.goto("/carta/tema");
      await admin.evaluate(() => document.querySelectorAll("details").forEach((x) => (x.open = true)));
      await admin.locator('[name="color_fondo_dia"]').fill("#1c1b19");
      await admin.locator('[name="color_marca"]').fill("#f2b544");
      await admin.getByRole("button", { name: "Guardar tema" }).click();
      await expect(admin.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
      await admin.getByRole("button", { name: "Aplicar el tema" }).click();
      await expect(admin.getByRole("status").filter({ hasText: "aplicado" })).toBeVisible();
      for (const { ancho, alto } of ANCHOS) {
        await page.setViewportSize({ width: ancho, height: alto });
        await page.goto(ruta);
        await page.waitForLoadState("networkidle");
        const carta = await volcarCarta(page);
        const titulos = carta.secciones.map((x) => `seccion-${x.titulo}`);
        const nombres = carta.paginas.map((x) => (x.tipo === "sección" ? (titulos.shift() ?? "seccion") : x.tipo));
        await capturarCarta(page, ancho, nombres.map((n) => n.normalize("NFD").replace(/[^\w-]/g, "").toLowerCase()), "oscuro-");
      }
    }
    llegoAlFinal = true;
  } finally {
    await contexto.close();
    await limpiarLineaDeBasePrecioYCarta();
  }
  // No contamina a los specs que siguen (comparten la base): la limpieza no dejó nada. Solo si llegó al final, para no tapar el error de verdad.
  if (llegoAlFinal) expect(await restosDeLaLineaDeBase(), "restos de la línea de base después de limpiar").toEqual([]);
});

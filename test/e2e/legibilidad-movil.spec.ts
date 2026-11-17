import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { crearCategoriaDeTest } from "../setup/categoria-de-prueba";
import { expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * LEGIBILIDAD EN EL CELULAR: revisión automática, en el CI, de dos cosas que Pedernal (el proyecto hermano) ya vigila en cada pantalla a 375 px de ancho.
 * Pedido y aceptación del dueño: 2026-11-17, «Sí, como Pedernal» (revisión automática en el CI de desborde horizontal a 375 px y de letra mínima 16 px).
 *
 * LA REGLA (por cada ruta de `RUTAS`, con el viewport de `fijarCelular`: 375 × 812):
 *  1. «sin desborde»: la página no se sale por la derecha (`scrollWidth <= clientWidth + 1`; es `expectSinDesborde` del spec vecino `movil-sin-desborde.spec.ts`, que dice qué elementos se salen).
 *  2. «letra mínima»: todo elemento visible con TEXTO PROPIO (un nodo de texto no vacío hijo directo del elemento) tiene `getComputedStyle(el).fontSize >= 16px`. Se ignoran los
 *     `<script>`, `<style>`, `<noscript>` y `<template>`, lo que no se ve (`display: none`, `visibility: hidden`, sin caja) y el texto solo-lector (`sr-only`: una caja de 1 px o menos).
 *     El fallo lista ruta, selector aproximado, tamaño y los primeros 40 caracteres del texto. Los textos de `placeholder`/`value` de los controles no son nodos de texto y no se miden aquí.
 *
 * ESTADO HOY: casi ninguna pantalla cumple la letra mínima (hay centenares de `text-xs`/`text-sm` en `src/`). Por eso cada ruta arranca con `pendiente: ["letra"]`, que marca
 * ese chequeo como esperado-falla (`test.fail`): pendiente de paridad visual con Pedernal. Mientras la pantalla siga incumpliendo, el CI pasa; cuando se arregla, Playwright avisa con un
 * «se esperaba que fallara pero pasó» y ese aviso es la señal para SACAR la marca de la ruta (así lo arreglado queda protegido y nada se vuelve a romper en silencio). El chequeo de
 * desborde NO lleva marca: si una ruta se sale por la derecha, es una regresión (hay que arreglarla o, si es una deuda real, marcarla con `pendiente: ["desborde"]` y su motivo en un comentario).
 *
 * CÓMO AGREGAR UNA RUTA: sumá `{ ruta: "/la/ruta" }` a `RUTAS`. La ruta tiene que abrirse con la cuenta de los e2e (admin con todos los módulos) y sin sembrar nada; si necesita un
 * registro, usá un marcador de `resolverRuta` (hoy `{producto}`: un producto de venta sembrado) o extendelo. Si la pantalla ya incumple la letra mínima, ponele `pendiente: ["letra"]`.
 * CÓMO AGREGAR UNA EXCEPCIÓN: `excepciones: [{ selector: "...", motivo: "..." }]` (un selector CSS; lo que cae dentro de lo que él atrapa no se mide). El motivo es obligatorio y dice POR QUÉ
 * ese texto puede ser menor a 16 px (p. ej. un texto legal que el dueño aceptó chico, con su cita). Una excepción que no atrapa NINGÚN elemento que de otro modo fallaría hace fallar el test
 * (excepción vieja: se borra). La lista de excepciones nace vacía: no se exceptúa nada sin declararlo.
 */

const LETRA_MINIMA_PX = 16;
const MARCA_PENDIENTE = "pendiente de paridad visual con Pedernal";

type Chequeo = "desborde" | "letra";
interface Excepcion {
  /** Selector CSS de lo que se exceptúa de la letra mínima (el elemento y todo lo que tiene adentro). */
  selector: string;
  /** Por qué ese texto puede ser menor a 16 px. Obligatorio. */
  motivo: string;
}
interface Ruta {
  /** La ruta; puede llevar el marcador `{producto}` (ver `resolverRuta`). */
  ruta: string;
  excepciones?: readonly Excepcion[];
  /** Chequeos que hoy se esperan en falla (`test.fail`). Sacar el chequeo de acá cuando la pantalla se arregla. */
  pendiente?: readonly Chequeo[];
}

const RUTAS: readonly Ruta[] = [
  { ruta: "/inicio", pendiente: ["letra"] },
  { ruta: "/catalogo/productos", pendiente: ["letra"] },
  { ruta: "/catalogo/productos/nuevo", pendiente: ["letra"] },
  { ruta: "/catalogo/productos/{producto}", pendiente: ["letra"] },
  { ruta: "/catalogo/proveedores", pendiente: ["letra"] },
  { ruta: "/catalogo/clientes", pendiente: ["letra"] },
  { ruta: "/catalogo/unidades", pendiente: ["letra"] },
  { ruta: "/carta/parametrizacion/promociones", pendiente: ["letra"] },
  { ruta: "/carta/tema", pendiente: ["letra"] },
  { ruta: "/carta/portal", pendiente: ["letra"] },
  { ruta: "/mesas", pendiente: ["letra"] },
];

/** Reemplaza los marcadores de una ruta por datos sembrados. `{producto}`: el id de un producto de venta creado para este test. */
async function resolverRuta(ruta: string): Promise<string> {
  if (!ruta.includes("{producto}")) return ruta;
  const sufijo = randomUUID().slice(0, 8);
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const categoria = await crearCategoriaDeTest(prisma, { nombre: `E2E Categoría Legibilidad ${sufijo}` });
  const producto = await prisma.producto.create({
    data: { codigo: `E2E-LM-${sufijo}`, nombre: `E2E Legibilidad ${sufijo}`, tipo: "PV", categoriaId: categoria.id, unidadStockId: unidad.id, unidadCompraId: unidad.id, precioVenta: 4500 },
  });
  return ruta.replace("{producto}", producto.id);
}

interface ElementoChico {
  selector: string;
  tamano: number;
  texto: string;
}
interface MedidaDeLetra {
  /** Los elementos con texto propio menor al mínimo y fuera de toda excepción. */
  chicos: ElementoChico[];
  /** Cuántos elementos con texto menor al mínimo atrapó cada excepción (mismo orden que las recibidas). */
  atrapadosPorExcepcion: number[];
}

/** Recorre el documento (en el navegador) y mide la letra de los elementos visibles con texto propio. */
async function medirLetra(page: Page, excepciones: readonly Excepcion[]): Promise<MedidaDeLetra> {
  return page.evaluate(
    ({ minimo, selectores }) => {
      const IGNORADOS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
      const chicos: { selector: string; tamano: number; texto: string }[] = [];
      const atrapados = selectores.map(() => 0);
      const aproximado = (el: Element): string => {
        const id = el.id ? `#${el.id}` : "";
        const clases = Array.from(el.classList).slice(0, 3).map((c) => `.${c}`).join("");
        const padre = el.parentElement ? `${el.parentElement.tagName.toLowerCase()} > ` : "";
        return `${padre}${el.tagName.toLowerCase()}${id}${clases}`;
      };
      const visible = (el: Element): boolean => {
        const caja = el.getBoundingClientRect();
        if (caja.width <= 1 && caja.height <= 1) return false; // sin caja, o texto solo-lector (sr-only)
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      };
      const visto = new Set<Element>();
      const recorredor = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let nodo = recorredor.nextNode(); nodo; nodo = recorredor.nextNode()) {
        const el = nodo.parentElement;
        if (!el || visto.has(el) || IGNORADOS.has(el.tagName) || !(nodo.textContent ?? "").trim()) continue;
        visto.add(el);
        if (!visible(el)) continue;
        const tamano = parseFloat(getComputedStyle(el).fontSize);
        if (!(tamano < minimo)) continue;
        const dentro = selectores.map((s) => el.closest(s) !== null);
        dentro.forEach((d, i) => {
          if (d) atrapados[i] += 1;
        });
        if (dentro.some(Boolean)) continue;
        const propio = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => (n.textContent ?? "").trim())
          .filter(Boolean)
          .join(" ");
        chicos.push({ selector: aproximado(el), tamano, texto: propio.slice(0, 40) });
      }
      return { chicos, atrapadosPorExcepcion: atrapados };
    },
    { minimo: LETRA_MINIMA_PX, selectores: excepciones.map((e) => e.selector) },
  );
}

/** Abre la ruta con el celular puesto y espera a que cargue (la pantalla no debe mandar al login ni dar error). */
async function abrirEnCelular(page: Page, ruta: string): Promise<void> {
  await fijarCelular(page);
  const respuesta = await page.goto(ruta);
  expect(respuesta?.status(), `${ruta}: la pantalla respondió`).toBeLessThan(400);
  expect(new URL(page.url()).pathname, `${ruta}: no mandó a otra pantalla (login, etc.)`).toBe(new URL(ruta, page.url()).pathname);
  await page.evaluate(() => document.fonts.ready);
}

for (const { ruta, excepciones = [], pendiente = [] } of RUTAS) {
  for (const excepcion of excepciones) {
    if (!excepcion.motivo.trim()) throw new Error(`${ruta}: la excepción «${excepcion.selector}» no declara su motivo (es obligatorio)`);
  }

  test.describe(ruta, () => {
    test("celular (375 px): la página no se sale por la derecha", async ({ paginaAutenticada: page }) => {
      test.setTimeout(120_000);
      test.fail(pendiente.includes("desborde"), MARCA_PENDIENTE);
      const real = await resolverRuta(ruta);
      await abrirEnCelular(page, real);
      await expectSinDesborde(page, ruta);
    });

    test(`celular (375 px): todo texto visible mide ${LETRA_MINIMA_PX} px o más`, async ({ paginaAutenticada: page }) => {
      test.setTimeout(120_000);
      test.fail(pendiente.includes("letra"), MARCA_PENDIENTE);
      const real = await resolverRuta(ruta);
      await abrirEnCelular(page, real);
      const { chicos, atrapadosPorExcepcion } = await medirLetra(page, excepciones);

      const listado = chicos.slice(0, 25).map((c) => `  ${ruta} · ${c.selector} · ${c.tamano}px · «${c.texto}»`);
      const resto = chicos.length > listado.length ? [`  … y ${chicos.length - listado.length} más`] : [];
      expect.soft(chicos, `${ruta}: ${chicos.length} texto(s) con letra menor a ${LETRA_MINIMA_PX} px\n${[...listado, ...resto].join("\n")}\n`).toEqual([]);
      excepciones.forEach((e, i) => {
        expect.soft(atrapadosPorExcepcion[i], `${ruta}: la excepción «${e.selector}» (${e.motivo}) no atrapa ningún texto menor a ${LETRA_MINIMA_PX} px: ya no hace falta, borrala`).toBeGreaterThan(0);
      });
    });
  });
}

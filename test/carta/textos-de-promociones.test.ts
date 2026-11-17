import { afterEach, describe, expect, it, vi } from "vitest";
import { textosDeLaPantallaDePromos, type TextosDePromos } from "../../src/core/carta/textos-de-promociones";

/**
 * Los textos de la pantalla de Carta › Promociones según el interruptor `ARMADO_DE_PROMO_COMO_PEDERNAL` (pedido del dueño 2026-11-17: pocas palabras bien elegidas, sin párrafos explicativos).
 * Fija, con listas escritas ACÁ (el oráculo, aparte del código):
 *  - con el interruptor APAGADO, los textos son exactamente los de hoy;
 *  - con el interruptor ENCENDIDO, cada texto sale de una lista cerrada (vocabulario aprobado el 09/11/2026 en la maqueta de Pedernal, «conservados de hoy» o «sacados»): un texto inventado falla;
 *  - las dos pantallas tienen los mismos campos de texto (si aparece un campo nuevo, el test obliga a decidir en cuál lista va).
 * Tabla legible: docs/palabras-de-la-pantalla-de-promociones-2026-11-17.md.
 */
const DE_HOY: Record<string, string | boolean> = {
  encabezadoDeLaEntrada: "Promociones",
  encabezadoDeLaPestana: "Combos y cupos",
  tituloDeLaSeccion: "Promos",
  introduccion:
    "Una promo se define una sola vez para toda la empresa. Cada sucursal decide si la prende (apagada no sale en la carta ni en el POS) y, si quiere, le pone su propio precio. No tiene fechas: se maneja con activar y desactivar (mientras está prendida se vende; cuando termina, se apaga).",
  rotuloDelTitulo: "Título",
  rotuloDelPrecio: "Precio",
  asteriscoEnElPrecio: true,
  rotuloDeLaDescripcion: "Descripción (opcional)",
  rotuloDelPrecioLocal: "Precio en esta sucursal (vacío = el de la empresa)",
  botonGuardarPromo: "Guardar promo",
  tituloDelAlta: "Nueva promo (queda prendida en esta sucursal)",
  botonCrearPromo: "Crear promo",
  soloSalonEtiqueta: "Solo salón: se vende desde el POS, pero no aparece en la carta pública (web, QR ni impresa)",
  soloSalonAyuda: "Útil para un menú pactado con una empresa: el precio no queda publicado.",
  soloSalonDato: "Solo salón (no aparece en la carta pública)",
  avisoSoloSalonSinCupos:
    "Esta promo está en «solo salón» pero no tiene cupos: es solo informativa y el POS la ignora, así que no se vería en ningún lado. Cargale cupos para poder venderla en el salón.",
  tituloDeLoQueLleva: "Cupos",
  parrafoDeLoQueLleva:
    "Las partes de la promo se arman tildando secciones de la carta: de cada sección tildada el mozo elige entre «mín.» y «máx.» productos (para que elija más, subí el «máx.»). Para un grupo propio, como «Bebida», creá la sección en Carta › Secciones y géneros y tildala acá, o sumá abajo un lugar con su propia lista de productos.",
  mostrarAvisoDelPeorCaso: true,
  botonGuardarCupos: "Guardar cupos",
  sinComponentes: "Sin cupos: esta promo es solo informativa, el POS la ignora.",
  agregarComponente: "Agregar un componente",
  parrafoDeAgregarComponente: "Tildá la sección de la carta de la que el mozo elige y poné cuántos productos (mín. y máx.).",
  ayudaParaQuitar: "Para quitar un componente, destildalo y guardá.",
  leyendaDeSumarUnLugar: "Sumar un lugar (opcional)",
  sinEntradas: "Sin entradas todavía: sumá los productos que se pueden elegir acá.",
  ayudaDelRepartoConRango: "En las partes cargadas con un rango se usa la cantidad máxima.",
  sinPromos: "La empresa no tiene promos cargadas.",
  hacenFaltaSecciones: "Para cargar una promo hace falta al menos una sección de carta activa.",
};

/** Vocabulario aprobado por el dueño el 09/11/2026 (maqueta `combos.html` de Pedernal) más «Guardar» (decisión del 2026-11-17: Motor2 no tiene versiones, no se usa «Guardar versión»). */
const APROBADOS = new Set(["Combos", "Nuevo combo", "Nombre", "Precio", "Qué lleva", "Agregar componente", "Todavía no lleva nada", "Guardar"]);
/** Rótulos que la maqueta no tiene y se conservan de hoy, sin su ayuda («(opcional)», «vacío = …», la explicación de «solo salón»). */
const CONSERVADOS_DE_HOY = new Set(["Descripción", "Precio en esta sucursal", "Solo salón", "Sumar un lugar"]);
/** Frases de hoy con la palabra aprobada «combo» en lugar de «promo» (dudoso, anotado en la tabla del documento). */
const DE_HOY_CON_COMBO = new Set(["La empresa no tiene combos cargados.", "Para cargar un combo hace falta al menos una sección de carta activa."]);
/** Lo que se SACA de la pantalla encendida (párrafos y ayudas). */
const SACADOS = ["introduccion", "soloSalonAyuda", "avisoSoloSalonSinCupos", "parrafoDeLoQueLleva", "parrafoDeAgregarComponente", "ayudaParaQuitar", "ayudaDelRepartoConRango"];

const textosComoLista = (t: TextosDePromos): Record<string, unknown> => ({ ...t, quitarEntrada: t.quitarEntrada("«X»") });

describe("textos de la pantalla de promociones, interruptor APAGADO: los de hoy", () => {
  it("cada texto es exactamente el de hoy (oráculo copiado como literal)", () => {
    const t = textosComoLista(textosDeLaPantallaDePromos(false));
    for (const [campo, esperado] of Object.entries(DE_HOY)) expect(t[campo], campo).toBe(esperado);
    expect(textosDeLaPantallaDePromos(false).quitarEntrada("Gaseosa")).toBe("Sacar «Gaseosa»");
  });
});

describe("textos de la pantalla de promociones, interruptor ENCENDIDO: lista cerrada", () => {
  const t = textosComoLista(textosDeLaPantallaDePromos(true));

  it("tiene los mismos campos que los de hoy (un campo nuevo obliga a ubicarlo en una lista de este test)", () => {
    expect(Object.keys(t).sort()).toEqual([...Object.keys(DE_HOY), "quitarEntrada"].sort());
  });

  it("cada texto es vocabulario aprobado, un rótulo conservado de hoy, o está sacado (nulo)", () => {
    for (const [campo, valor] of Object.entries(t)) {
      if (campo === "quitarEntrada") continue;
      if (campo === "encabezadoDeLaPestana") {
        expect(valor, "el subtítulo se saca: repetir «Combos» no aporta").toBe("");
      } else if (SACADOS.includes(campo)) {
        expect(valor, `${campo} se saca`).toBeNull();
      } else if (typeof valor === "string") {
        expect(APROBADOS.has(valor) || CONSERVADOS_DE_HOY.has(valor) || DE_HOY_CON_COMBO.has(valor), `${campo}: «${valor}» no está en ninguna lista`).toBe(true);
      }
    }
  });

  it("la entrada se «Quita» (palabra aprobada); el aviso del piso y el asterisco no se dibujan", () => {
    expect(textosDeLaPantallaDePromos(true).quitarEntrada("Gaseosa")).toBe("Quitar «Gaseosa»");
    expect(t.mostrarAvisoDelPeorCaso).toBe(false);
    expect(t.asteriscoEnElPrecio).toBe(false);
  });

  it("ningún texto es un párrafo: hasta cuatro palabras en rótulos y botones, hasta catorce en las frases de «no hay nada»", () => {
    for (const [campo, valor] of Object.entries(t)) {
      if (typeof valor !== "string" || campo === "quitarEntrada") continue;
      const palabras = valor.split(/\s+/).length;
      expect(palabras, `${campo}: «${valor}»`).toBeLessThanOrEqual(campo === "sinPromos" || campo === "hacenFaltaSecciones" ? 14 : 4);
    }
  });
});

describe("el menú y la pestaña de la entrada se llaman «Combos» solo con el interruptor encendido (decisión del dueño, 2026-11-17)", () => {
  const cargar = async (encendido: boolean) => {
    vi.resetModules();
    vi.doMock("../../src/core/carta/armado-de-promo-como-pedernal", async (original) => ({ ...(await original<typeof import("../../src/core/carta/armado-de-promo-como-pedernal")>()), ARMADO_DE_PROMO_COMO_PEDERNAL: encendido }));
    return import("../../src/core/carta/ui-config");
  };
  afterEach(() => {
    vi.doUnmock("../../src/core/carta/armado-de-promo-como-pedernal");
    vi.resetModules();
  });

  it("APAGADO: «Promociones» en el menú y en la pestaña, como hoy", async () => {
    const c = await cargar(false);
    expect(c.PESTANAS_DE_PROMOCIONES[0]!.texto).toBe("Promociones");
    expect(c.PESTANAS_DE_PROMOCIONES[0]!.pantallas[0]!.texto).toBe("Promociones");
    expect(c.NAV_CARTA.find((i) => i.href === "/carta/parametrizacion/promociones")!.label).toBe("Promociones");
  });

  it("ENCENDIDO: «Combos» en el menú y en la pestaña", async () => {
    const c = await cargar(true);
    expect(c.PESTANAS_DE_PROMOCIONES[0]!.texto).toBe("Combos");
    expect(c.PESTANAS_DE_PROMOCIONES[0]!.pantallas[0]!.texto).toBe("Combos");
    expect(c.NAV_CARTA.find((i) => i.href === "/carta/parametrizacion/promociones")!.label).toBe("Combos");
  });
});

import { describe, expect, it } from "vitest";
import {
  PASOS_DEL_ESPACIO,
  pasosDelEspacio,
  pendientesDelProducto,
  rutaDelPaso,
  type AccesoAlEspacio,
  type EstadoDelPaso,
  type FormaDelProducto,
  type HechosDelProducto,
  type PasoDelEspacio,
} from "@/core/catalogo/public";

/**
 * Fase 6, paso 6.9b: el espacio del producto. Con los casos de la demo (Pizzas, Milanesas y Café), una materia prima, una que se produce y el producto de respaldo de un adicional; la tabla
 * de pasos por tipo (UN solo espacio: el paso 1 es `datos` para todos) y la tabla de acceso (sin permiso: sin enlace y sin dato; sin módulo: no aparece).
 */

const TODO: AccesoAlEspacio = { datos: true, opciones: true, receta: "si", carta: "si" };

const PIZZAS: HechosDelProducto = {
  tipo: "PV",
  seProduce: false,
  esAnclaDeAdicional: false,
  modoDeVenta: "BASE_CONFIGURABLE",
  precioDeVenta: 0,
  opciones: { vendibleAca: true },
  receta: { rechazo: null },
  carta: { estado: "visible" },
};
const MILANESAS: HechosDelProducto = { ...PIZZAS, modoDeVenta: "DIRECTO", precioDeVenta: 8500 };
const CAFE: HechosDelProducto = { ...PIZZAS, modoDeVenta: "DIRECTO", precioDeVenta: 3200, carta: { estado: "agrupado" } };
const HARINA: HechosDelProducto = { ...PIZZAS, tipo: "MP", modoDeVenta: "DIRECTO", precioDeVenta: 0, opciones: null, receta: null, carta: null };
const MASA_MADRE: HechosDelProducto = { ...HARINA, seProduce: true, receta: { rechazo: null } };
const RESPALDO: HechosDelProducto = { ...PIZZAS, esAnclaDeAdicional: true, modoDeVenta: "DIRECTO", precioDeVenta: 500, opciones: null, receta: null, carta: null };

const forma = (h: HechosDelProducto): FormaDelProducto => ({ tipo: h.tipo, seProduce: h.seProduce, esAnclaDeAdicional: h.esAnclaDeAdicional });
const pasos = (h: HechosDelProducto, acceso: AccesoAlEspacio = TODO) => pasosDelEspacio("p1", forma(h), acceso, pendientesDelProducto(h));
const nombres = (h: HechosDelProducto, acceso?: AccesoAlEspacio) => pasos(h, acceso).map((p) => p.paso);

describe("rutaDelPaso", () => {
  it.each([
    ["portada", "/catalogo/productos/p1"],
    ["datos", "/catalogo/productos/p1/datos"],
    ["opciones", "/catalogo/productos/p1/opciones"],
    ["receta", "/catalogo/recetas/p1"],
    ["en-la-carta", "/catalogo/productos/p1/en-la-carta"],
  ] as const)("%s ⇒ %s", (paso, ruta) => {
    expect(rutaDelPaso("p1", paso)).toBe(ruta);
  });

  it("codifica el id: nunca arma una ruta distinta de la del producto", () => {
    expect(rutaDelPaso("a/b?c#d", "datos")).toBe("/catalogo/productos/a%2Fb%3Fc%23d/datos");
  });

  it("los pasos son cuatro, en orden, y el primero es «datos» para todos los tipos", () => {
    expect(PASOS_DEL_ESPACIO).toEqual(["datos", "opciones", "receta", "en-la-carta"]);
  });
});

describe("la tabla de pasos por tipo de producto", () => {
  it("un producto de venta: Qué se vende · Opciones y precio · Receta · En la carta", () => {
    for (const pv of [PIZZAS, MILANESAS, CAFE]) {
      expect(pasos(pv).map((p) => [p.paso, p.titulo, p.href])).toEqual([
        ["datos", "Qué se vende", "/catalogo/productos/p1/datos"],
        ["opciones", "Opciones y precio", "/catalogo/productos/p1/opciones"],
        ["receta", "Receta", "/catalogo/recetas/p1"],
        ["en-la-carta", "En la carta", "/catalogo/productos/p1/en-la-carta"],
      ]);
    }
  });

  it("una materia prima que no se produce: solo Datos (ni opciones ni receta ni carta, aunque el usuario pueda abrirlas)", () => {
    expect(pasos(HARINA).map((p) => [p.paso, p.titulo])).toEqual([["datos", "Datos"]]);
  });

  it("una materia prima que se produce: Datos y Receta", () => {
    expect(pasos(MASA_MADRE).map((p) => [p.paso, p.titulo, p.href])).toEqual([
      ["datos", "Datos", "/catalogo/productos/p1/datos"],
      ["receta", "Receta", "/catalogo/recetas/p1"],
    ]);
  });

  it("el producto de respaldo de un adicional no tiene pasos de venta ni receta: solo el de datos", () => {
    expect(nombres(RESPALDO)).toEqual(["datos"]);
  });

  it("los pendientes de un paso que no corresponde al tipo valen sin-dato aunque se haya leído algo", () => {
    const e = pendientesDelProducto({ ...HARINA, opciones: { vendibleAca: false }, receta: { rechazo: "x" }, carta: { estado: "fuera" } });
    expect([e.opciones, e.receta, e["en-la-carta"]]).toEqual([{ tipo: "sin-dato" }, { tipo: "sin-dato" }, { tipo: "sin-dato" }]);
  });
});

describe("pendientesDelProducto", () => {
  it("Pizzas (se vende por opción) y Café (agrupado en la carta) están al día", () => {
    expect(pendientesDelProducto(PIZZAS)).toEqual({
      datos: { tipo: "listo", texto: "Se vende por opción" },
      opciones: { tipo: "listo", texto: "El precio sale de las opciones" },
      receta: { tipo: "listo", texto: "Tiene receta" },
      "en-la-carta": { tipo: "listo", texto: "Se ve en la carta" },
    });
    expect(pendientesDelProducto(CAFE)["en-la-carta"]).toEqual({ tipo: "listo", texto: "Se ve en la carta, agrupado con otros" });
  });

  it("una base que no se puede vender hoy deja pendiente el paso de opciones (y el paso 1 no)", () => {
    const e = pendientesDelProducto({ ...PIZZAS, opciones: { vendibleAca: false } });
    expect(e.opciones.tipo).toBe("pendiente");
    expect(e.datos.tipo).toBe("listo");
  });

  it("Milanesas: un producto directo con precio 0 deja pendiente el paso 1 (no «falta declarar el modo»: el modo siempre está declarado)", () => {
    expect(pendientesDelProducto({ ...MILANESAS, precioDeVenta: 0 }).datos).toEqual({ tipo: "pendiente", texto: "Falta el precio de venta" });
    expect(pendientesDelProducto(MILANESAS).datos).toEqual({ tipo: "listo", texto: "Se vende directo" });
  });

  it("una base con el precio guardado en 0 NO está pendiente: ese precio no se cobra", () => {
    expect(pendientesDelProducto({ ...PIZZAS, precioDeVenta: 0 }).datos.tipo).toBe("listo");
  });

  it("sin receta no se vende: el pendiente lleva el mensaje de la regla", () => {
    const rechazo = "«Milanesas» no tiene receta: armala en Catálogo → Recetas para poder venderla.";
    expect(pendientesDelProducto({ ...MILANESAS, receta: { rechazo } }).receta).toEqual({ tipo: "pendiente", texto: rechazo });
  });

  it.each([
    ["oculto", "pendiente"],
    ["fuera", "pendiente"],
    ["no-disponible", "pendiente"],
    ["visible", "listo"],
    ["agrupado", "listo"],
  ] as const)("en la carta: %s ⇒ %s", (estado, tipo) => {
    expect(pendientesDelProducto({ ...PIZZAS, carta: { estado } })["en-la-carta"].tipo).toBe(tipo);
  });

  it("lo que no se leyó (null: el usuario no ve esa pantalla) es sin-dato, nunca «listo»", () => {
    const e = pendientesDelProducto({ ...PIZZAS, opciones: null, receta: null, carta: null });
    expect([e.opciones, e.receta, e["en-la-carta"]]).toEqual([{ tipo: "sin-dato" }, { tipo: "sin-dato" }, { tipo: "sin-dato" }]);
  });

  it("una materia prima y el producto de respaldo tienen el paso 1 listo", () => {
    expect(pendientesDelProducto(HARINA).datos).toEqual({ tipo: "listo", texto: "Materia prima" });
    expect(pendientesDelProducto(RESPALDO).datos).toEqual({ tipo: "listo", texto: "Producto de respaldo de un adicional" });
  });

  it("una materia prima que se produce y no tiene receta queda pendiente con el mensaje", () => {
    expect(pendientesDelProducto({ ...MASA_MADRE, receta: { rechazo: "falta" } }).receta).toEqual({ tipo: "pendiente", texto: "falta" });
  });
});

describe("la tabla de acceso: sin permiso no hay enlace ni dato; sin módulo no hay paso", () => {
  /** Estados con TODO pendiente: si el acceso falla, ninguno de estos textos puede llegar a la portada. */
  const TODO_PENDIENTE: Record<PasoDelEspacio, EstadoDelPaso> = {
    datos: { tipo: "pendiente", texto: "secreto datos" },
    opciones: { tipo: "pendiente", texto: "secreto opciones" },
    receta: { tipo: "pendiente", texto: "secreto receta" },
    "en-la-carta": { tipo: "pendiente", texto: "secreto carta" },
  };

  it("quien no puede editar los datos ve el paso 1 sin enlace y sin dato", () => {
    const p = pasosDelEspacio("p1", forma(PIZZAS), { ...TODO, datos: false }, TODO_PENDIENTE).find((x) => x.paso === "datos");
    expect(p).toEqual({ paso: "datos", titulo: "Qué se vende", href: null, estado: { tipo: "sin-dato" } });
  });

  it("quien no puede abrir las opciones las ve sin enlace y sin dato", () => {
    const p = pasosDelEspacio("p1", forma(PIZZAS), { ...TODO, opciones: false }, TODO_PENDIENTE).find((x) => x.paso === "opciones");
    expect(p).toEqual({ paso: "opciones", titulo: "Opciones y precio", href: null, estado: { tipo: "sin-dato" } });
  });

  it.each(["receta", "carta"] as const)("%s sin permiso: el paso se ve sin enlace y sin dato", (cual) => {
    const paso: PasoDelEspacio = cual === "carta" ? "en-la-carta" : "receta";
    const p = pasosDelEspacio("p1", forma(PIZZAS), { ...TODO, [cual]: "sin-permiso" }, TODO_PENDIENTE).find((x) => x.paso === paso);
    expect(p?.href).toBeNull();
    expect(p?.estado).toEqual({ tipo: "sin-dato" });
  });

  it.each(["receta", "carta"] as const)("%s sin módulo: el paso no aparece", (cual) => {
    const paso: PasoDelEspacio = cual === "carta" ? "en-la-carta" : "receta";
    const lista = pasosDelEspacio("p1", forma(PIZZAS), { ...TODO, [cual]: "sin-modulo" }, TODO_PENDIENTE);
    expect(lista.map((x) => x.paso)).not.toContain(paso);
    expect(lista).toHaveLength(3);
  });

  it("un usuario que solo ve: ningún paso tiene enlace y ningún texto de pendiente se filtra", () => {
    const soloVe: AccesoAlEspacio = { datos: false, opciones: false, receta: "sin-permiso", carta: "sin-permiso" };
    const lista = pasosDelEspacio("p1", forma(PIZZAS), soloVe, TODO_PENDIENTE);
    expect(lista.map((x) => x.paso)).toEqual(["datos", "opciones", "receta", "en-la-carta"]);
    expect(lista.every((x) => x.href === null && x.estado.tipo === "sin-dato")).toBe(true);
    expect(JSON.stringify(lista)).not.toContain("secreto");
  });

  it("con acceso a todo cada paso lleva su ruta y su estado", () => {
    const lista = pasosDelEspacio("p1", forma(PIZZAS), TODO, TODO_PENDIENTE);
    expect(lista.map((x) => x.href)).toEqual(PASOS_DEL_ESPACIO.map((p) => rutaDelPaso("p1", p)));
    expect(lista.map((x) => x.estado)).toEqual(PASOS_DEL_ESPACIO.map((p) => TODO_PENDIENTE[p]));
  });

  it("el módulo apagado de un paso que no corresponde al tipo no cambia nada (ya no aparecía)", () => {
    expect(nombres(HARINA, { ...TODO, carta: "sin-modulo", receta: "sin-modulo" })).toEqual(["datos"]);
  });
});

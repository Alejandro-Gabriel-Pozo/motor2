import { describe, expect, it } from "vitest";
import {
  MENSAJE_FALTA_PRECIO_FINAL,
  esBaseConfigurable,
  precioDeReferenciaDeAdmisiones,
  rechazoDeAdmisionesDeBase,
  rechazoDeBaseConfigurable,
  type AdmisionParaSerBase,
  type ProductoParaSerBase,
} from "../../src/core/opciones/public";

/**
 * Fase 4 de la ola «precio y carta» (ADR-035): la regla PURA de la base configurable (`core/opciones/modo-de-venta.ts`). Lo que la aplica contra Postgres lo prueban
 * `test/catalogo/modo-de-venta.test.ts` (la edición del producto) y `test/catalogo/base-configurable-invariante.test.ts` (los escritores de opciones).
 */
const producto = (extra: Partial<ProductoParaSerBase> = {}): ProductoParaSerBase => ({ nombre: "Pizzas", tipo: "PV", seProduce: false, esConsignacion: false, esAnclaDeAdicional: false, itemAgrupado: null, ...extra });
const opcion = (nombre: string, extra: Partial<AdmisionParaSerBase["opciones"][number]> = {}) => ({ nombre, activa: true, admitida: true, esNinguna: false, precioAbsoluto: null, diferencia: null, ...extra });
const tipos = (opciones: AdmisionParaSerBase["opciones"], extra: Partial<AdmisionParaSerBase> = {}): AdmisionParaSerBase => ({
  grupo: { nombre: "Tipos de Pizza", tipo: "MEDIDA", activo: true },
  activa: true,
  modoPrecio: "ABSOLUTO",
  opciones,
  ...extra,
});
const pizzas = () => [tipos([opcion("Muzzarella", { precioAbsoluto: 18000 }), opcion("Fugazzeta", { precioAbsoluto: 22000 })])];
const milanesasDe = (opciones: AdmisionParaSerBase["opciones"]): AdmisionParaSerBase => ({ grupo: { nombre: "Milanesas de", tipo: "VARIANTE", activo: true }, activa: true, modoPrecio: null, opciones });

describe("la regla de la base configurable (pura)", () => {
  it("esBaseConfigurable: solo BASE_CONFIGURABLE", () => {
    expect(esBaseConfigurable("BASE_CONFIGURABLE")).toBe(true);
    expect(esBaseConfigurable("DIRECTO")).toBe(false);
    expect(esBaseConfigurable("base_configurable")).toBe(false);
  });

  it("una base válida: grupo de medida en ABSOLUTO con todas las ofrecidas con precio; una variante sin costo y montos no molestan", () => {
    expect(rechazoDeBaseConfigurable(producto(), pizzas())).toBeNull();
    expect(rechazoDeBaseConfigurable(producto(), [...pizzas(), milanesasDe([opcion("Carne"), opcion("Pollo", { diferencia: { tipo: "MONTO", monto: 500 } })])])).toBeNull();
    // Una opción apagada para la empresa o no admitida por el producto no se ofrece: no necesita precio.
    expect(rechazoDeBaseConfigurable(producto(), [tipos([opcion("Muzzarella", { precioAbsoluto: 18000 }), opcion("Vieja", { activa: false }), opcion("No admitida", { admitida: false })])])).toBeNull();
    // Un porcentaje en el grupo de precio no se usa (el ABSOLUTO reemplaza al precio base): no molesta.
    expect(rechazoDeBaseConfigurable(producto(), [tipos([opcion("Muzzarella", { precioAbsoluto: 18000, diferencia: { tipo: "PORCENTAJE", porcentaje: 10 } })])])).toBeNull();
  });

  it("sin grupo de precio, el mensaje base; con el grupo quitado, archivado, en DIFERENCIA o sin opciones, también (o el detalle)", () => {
    expect(rechazoDeAdmisionesDeBase([])).toBe(MENSAJE_FALTA_PRECIO_FINAL);
    expect(MENSAJE_FALTA_PRECIO_FINAL).toMatch(/^Falta el precio final de cada opción: /);
    expect(rechazoDeAdmisionesDeBase([tipos(pizzas()[0]!.opciones, { activa: false })])).toBe(MENSAJE_FALTA_PRECIO_FINAL);
    expect(rechazoDeAdmisionesDeBase([tipos(pizzas()[0]!.opciones, { grupo: { nombre: "Tipos de Pizza", tipo: "MEDIDA", activo: false } })])).toBe(MENSAJE_FALTA_PRECIO_FINAL);
    expect(rechazoDeAdmisionesDeBase([tipos(pizzas()[0]!.opciones, { modoPrecio: "DIFERENCIA" })])).toBe(MENSAJE_FALTA_PRECIO_FINAL);
    expect(rechazoDeAdmisionesDeBase([milanesasDe([opcion("Carne")])])).toBe(MENSAJE_FALTA_PRECIO_FINAL);
    expect(rechazoDeAdmisionesDeBase([tipos([opcion("Muzzarella", { admitida: false })])])).toBe("Falta el precio final de cada opción: «Tipos de Pizza» no tiene ninguna opción admitida.");
  });

  it("una ofrecida sin precio final (null, 0 o menos de 0,01) se nombra", () => {
    expect(rechazoDeAdmisionesDeBase([tipos([opcion("Muzzarella", { precioAbsoluto: 18000 }), opcion("Especial")])])).toBe("Falta el precio final de cada opción: «Especial» de «Tipos de Pizza» no tiene precio propio.");
    expect(rechazoDeAdmisionesDeBase([tipos([opcion("A", { precioAbsoluto: 0 }), opcion("B", { precioAbsoluto: 0.001 }), opcion("C", { precioAbsoluto: 1 })])])).toBe("Falta el precio final de cada opción: «A» y «B» de «Tipos de Pizza» no tienen precio propio.");
  });

  it("un porcentaje en lo que admite (del producto o de la versión) se rechaza; en una opción no ofrecida o en la «ninguna», no", () => {
    expect(rechazoDeAdmisionesDeBase([...pizzas(), milanesasDe([opcion("Carne"), opcion("Pollo", { diferencia: { tipo: "PORCENTAJE", porcentaje: 10 } })])])).toBe(
      "«Pollo» de «Milanesas de» tiene una diferencia en porcentaje, que se calcula sobre el precio guardado: un producto que se vende por opción solo admite diferencias en monto fijo. Cambiala a un monto antes.",
    );
    expect(rechazoDeAdmisionesDeBase([...pizzas(), milanesasDe([opcion("Pollo", { admitida: false, diferencia: { tipo: "PORCENTAJE", porcentaje: 10 } })])])).toBeNull();
    // En un grupo quitado del producto (admisión inactiva), tampoco.
    expect(rechazoDeAdmisionesDeBase([...pizzas(), { ...milanesasDe([opcion("Pollo", { diferencia: { tipo: "PORCENTAJE", porcentaje: 10 } })]), activa: false }])).toBeNull();
    expect(rechazoDeAdmisionesDeBase([...pizzas(), milanesasDe([opcion("Sin", { esNinguna: true, diferencia: { tipo: "PORCENTAJE", porcentaje: 0 } })])])).toBeNull();
  });

  it("el producto: PV, no se produce, no es consignación, ni ancla, ni está en un ítem agrupado (en ese orden)", () => {
    expect(rechazoDeBaseConfigurable(producto({ tipo: "MP" }), pizzas())).toBe("«Pizzas» no es un producto de venta: solo un producto de venta se vende por opción.");
    expect(rechazoDeBaseConfigurable(producto({ seProduce: true }), pizzas())).toMatch(/no se produce/);
    expect(rechazoDeBaseConfigurable(producto({ esConsignacion: true }), pizzas())).toMatch(/no puede ser de consignación/);
    expect(rechazoDeBaseConfigurable(producto({ esAnclaDeAdicional: true }), pizzas())).toMatch(/respaldo de un adicional/);
    expect(rechazoDeBaseConfigurable(producto({ itemAgrupado: "Pizzas y empanadas" }), pizzas())).toMatch(/ítem agrupado «Pizzas y empanadas»/);
  });

  it("el precio de referencia para el control de lista: la ofrecida con precio más barata de los grupos de precio", () => {
    expect(precioDeReferenciaDeAdmisiones(pizzas())).toBe(18000);
    expect(precioDeReferenciaDeAdmisiones([tipos([opcion("A", { precioAbsoluto: 5 }), opcion("B", { precioAbsoluto: 3, admitida: false })])])).toBe(5);
    expect(precioDeReferenciaDeAdmisiones([])).toBeNull();
  });
});

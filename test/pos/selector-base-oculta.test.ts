import { describe, expect, it } from "vitest";
import type { CartaV1, ItemCartaV1 } from "../../src/core/carta/armar-menu";
import { armarSelectorCartaPos, opcionDeLaFila, type ProductoPedible } from "../../src/core/pos/selector-carta";

/** Base configurable con el nombre oculto (2026-11-05): el selector del mozo muestra los renglones de la carta, no el nombre interno. */

const pedible = (productoId: string, nombre: string): ProductoPedible => ({ productoId, codigo: productoId, nombre, precio: 0, decimales: 0, pasoVenta: null, tieneStockReal: false });

const item = (productoId: string, nombre: string, presentacion?: ItemCartaV1["presentacion"]): ItemCartaV1 => ({
  productoId,
  nombre,
  categoria: "x",
  descripcion: null,
  precio: 1,
  tags: [],
  especial: false,
  imagenUrl: null,
  ...(presentacion ? { presentacion } : {}),
});

const cartaCon = (items: ItemCartaV1[]): CartaV1 => ({
  version: 1,
  generadoEn: "2026-11-05T12:00:00.000Z",
  sucursal: { id: "suc", nombre: "Central" },
  secciones: [{ id: "s1", nombre: "Platos", titulo: null, descripcion: null, imagenUrl: null, orden: 0, items, promos: [] }],
});

const tabla = (titulo: boolean, columnas: string[] = []) => ({
  forma: "tabla" as const,
  titulo,
  columnas,
  filas: [
    { rotulo: "Bife a la criolla", celdas: [18000] },
    { rotulo: "Bife con chimichurri", celdas: [19000] },
  ],
  aclaraciones: [],
});

describe("selector del mozo: base con el nombre oculto", () => {
  it("la base oculta lleva los renglones de la carta (rótulo y precio)", () => {
    const s = armarSelectorCartaPos(cartaCon([item("p-bife", "BIFE-", tabla(false))]), [pedible("p-bife", "BIFE-")]);
    const e = s.seccionesCarta[0]!.entradas[0]!;
    expect(e.tipo === "producto" && e.producto.filasEnCarta).toEqual([
      { rotulo: "Bife a la criolla", precio: 18000 },
      { rotulo: "Bife con chimichurri", precio: 19000 },
    ]);
  });

  it("con el nombre arriba, con columnas o sin presentación: sin renglones (se muestra el producto como siempre)", () => {
    for (const it of [item("p", "X", tabla(true)), item("p", "X", tabla(false, ["Chico", "Grande"])), item("p", "X")]) {
      const s = armarSelectorCartaPos(cartaCon([it]), [pedible("p", "X")]);
      const e = s.seccionesCarta[0]!.entradas[0]!;
      expect(e.tipo === "producto" && e.producto.filasEnCarta).toBeUndefined();
    }
  });

  describe("opcionDeLaFila", () => {
    const g = (opciones: { opcionId: string; nombre: string; esNinguna?: boolean }[], extra = {}) => ({ admitido: true, activo: true, opciones: opciones.map((o) => ({ esNinguna: false, ...o })), ...extra });
    const grupos = [g([{ opcionId: "lomo", nombre: "Lomo" }]), g([{ opcionId: "cri", nombre: "A la criolla" }, { opcionId: "chi", nombre: "Con chimichurri" }])];

    it("con el prefijo del grupo delante", () => {
      expect(opcionDeLaFila(grupos, "Bife con chimichurri")).toBe("chi");
    });
    it("con el nombre de la opción tal cual", () => {
      expect(opcionDeLaFila(grupos, "Con chimichurri")).toBe("chi");
    });
    it("sin coincidencia, o con más de una: null (nunca se adivina)", () => {
      expect(opcionDeLaFila(grupos, "Bife frito")).toBeNull();
      expect(opcionDeLaFila([...grupos, g([{ opcionId: "otra", nombre: "Con chimichurri" }])], "Bife con chimichurri")).toBeNull();
    });
    it("ignora los grupos que no cuentan hoy", () => {
      expect(opcionDeLaFila([g([{ opcionId: "chi", nombre: "Con chimichurri" }], { activo: false })], "Bife con chimichurri")).toBeNull();
    });
  });
});

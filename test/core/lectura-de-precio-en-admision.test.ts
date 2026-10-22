import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  fraseDeLecturaDePrecio,
  leerPrecioDeFilaDeAdmision,
  precioDeReferenciaDeAdmisiones,
  referenciaDePrecioDeAdmisiones,
  type AdmisionParaLaReferencia,
  type FilaDeAdmisionParaLeer,
} from "@/core/opciones/public";

/**
 * Fase 6, paso 6.15a: la lectura del precio dentro de «Opciones de venta» de un producto. Dos cosas: contra qué se lee lo que suma una opción (`referenciaDePrecioDeAdmisiones`: lo más barato
 * GUARDADO del grupo que fija el precio) y cuándo se lee una fila del formulario (`leerPrecioDeFilaDeAdmision`: las que NO se leen son parte del contrato). El total lo compone
 * `leerPrecioDeOpcion` con el compositor de la venta (sus propiedades están en `lectura-de-precio.propiedades.test.ts`).
 */

const pesos = (n: number) => `$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

type OpcionDeAdmision = AdmisionParaLaReferencia["opciones"][number];
const opcion = (nombre: string, precioAbsoluto: number | null, parcial: { activaEnEmpresa?: boolean; admitida?: boolean } = {}): OpcionDeAdmision => ({
  nombre,
  activaEnEmpresa: parcial.activaEnEmpresa ?? true,
  fila: parcial.admitida === false && precioAbsoluto === null ? null : { activo: parcial.admitida ?? true, precioAbsoluto },
});
const grupo = (opciones: OpcionDeAdmision[], parcial: Partial<AdmisionParaLaReferencia> = {}): AdmisionParaLaReferencia => ({
  tipo: "MEDIDA",
  activoEnEmpresa: true,
  fila: { activo: true, modoPrecio: "ABSOLUTO" },
  opciones,
  ...parcial,
});

describe("referenciaDePrecioDeAdmisiones: lo más barato guardado del grupo que fija el precio", () => {
  it("Pizzas: el tamaño más barato con precio final", () => {
    const tipos = grupo([opcion("Napolitana", 25000), opcion("Muzzarella", 18000), opcion("Fugazzeta", 22000)]);
    expect(referenciaDePrecioDeAdmisiones([tipos])).toEqual({ opcion: "Muzzarella", precio: 18000 });
  });

  it("sin grupo de precio (un directo, o un producto sin grupos) no hay referencia: rige el precio de lista", () => {
    expect(referenciaDePrecioDeAdmisiones([])).toBeNull();
    expect(referenciaDePrecioDeAdmisiones([grupo([opcion("Trucha", null)], { tipo: "VARIANTE", fila: { activo: true, modoPrecio: null } })])).toBeNull();
  });

  it.each<[string, AdmisionParaLaReferencia]>([
    ["un grupo quitado del producto", grupo([opcion("Chico", 100)], { fila: { activo: false, modoPrecio: "ABSOLUTO" } })],
    ["un grupo archivado en la empresa", grupo([opcion("Chico", 100)], { activoEnEmpresa: false })],
    ["un tamaño que se cobra por diferencia", grupo([opcion("Chico", 100)], { fila: { activo: true, modoPrecio: "DIFERENCIA" } })],
    ["un tamaño sin modo de precio", grupo([opcion("Chico", 100)], { fila: { activo: true, modoPrecio: null } })],
    ["una opción archivada en la empresa", grupo([opcion("Chico", 100, { activaEnEmpresa: false })])],
    ["una opción que el producto no admite (tildada en la base como inactiva)", grupo([opcion("Chico", 100, { admitida: false })])],
    ["una opción sin precio", grupo([opcion("Chico", null)])],
    ["una opción con precio de menos de 0,01", grupo([opcion("Chico", 0), opcion("Mediano", 0.005)])],
  ])("no cuenta %s", (_que, g) => {
    expect(referenciaDePrecioDeAdmisiones([g])).toBeNull();
    // y no tapa a uno que sí cuenta
    expect(referenciaDePrecioDeAdmisiones([g, grupo([opcion("Grande", 3100)])])).toEqual({ opcion: "Grande", precio: 3100 });
  });

  it("en un empate gana la primera, en el orden dado", () => {
    expect(referenciaDePrecioDeAdmisiones([grupo([opcion("Napolitana", 22000), opcion("Fugazzeta", 22000)])])).toEqual({ opcion: "Napolitana", precio: 22000 });
  });

  it("es la misma regla que el control de precio de lista (precioDeReferenciaDeAdmisiones): el mismo precio, para cualquier combinación", () => {
    const tipo = fc.constantFrom("MEDIDA", "VARIANTE", "INCLUIDA", "ADICIONAL");
    const modo = fc.constantFrom("ABSOLUTO", "DIFERENCIA", null);
    const precio = fc.option(fc.integer({ min: 0, max: 5_000_000 }).map((c) => c / 100), { nil: null });
    const unaOpcion = fc.record({ nombre: fc.string({ minLength: 1, maxLength: 6 }), activaEnEmpresa: fc.boolean(), activo: fc.boolean(), precio });
    const unGrupo = fc.record({ tipo, modo, activoEnEmpresa: fc.boolean(), activo: fc.boolean(), opciones: fc.array(unaOpcion, { maxLength: 4 }) });
    fc.assert(
      fc.property(fc.array(unGrupo, { maxLength: 3 }), (grupos) => {
        const mias = grupos.map<AdmisionParaLaReferencia>((g) => ({
          tipo: g.tipo as AdmisionParaLaReferencia["tipo"],
          activoEnEmpresa: g.activoEnEmpresa,
          fila: { activo: g.activo, modoPrecio: g.modo },
          opciones: g.opciones.map((o) => ({ nombre: o.nombre, activaEnEmpresa: o.activaEnEmpresa, fila: { activo: o.activo, precioAbsoluto: o.precio } })),
        }));
        const delControl = grupos.map((g) => ({
          grupo: { nombre: "g", tipo: g.tipo as AdmisionParaLaReferencia["tipo"], activo: g.activoEnEmpresa },
          activa: g.activo,
          modoPrecio: g.modo,
          opciones: g.opciones.map((o) => ({ nombre: o.nombre, activa: o.activaEnEmpresa, admitida: o.activo, esNinguna: false, precioAbsoluto: o.precio, diferencia: null })),
        }));
        expect(referenciaDePrecioDeAdmisiones(mias)?.precio ?? null).toBe(precioDeReferenciaDeAdmisiones(delControl));
      }),
      { numRuns: 300 },
    );
  });
});

const NAPOLITANA = { opcion: "Napolitana", precio: 25000 };
const fila = (parcial: Partial<FilaDeAdmisionParaLeer>): FilaDeAdmisionParaLeer => ({
  tipoDeGrupo: "VARIANTE",
  modoPrecio: null,
  opcion: { nombre: "Trucha", esNinguna: false, diferenciaDeLaOpcion: null },
  admitida: true,
  precio: "MONTO",
  precioAbsoluto: "",
  valor: "3000",
  precioDeLista: null,
  referencia: NAPOLITANA,
  ...parcial,
});
const frase = (f: FilaDeAdmisionParaLeer) => {
  const l = leerPrecioDeFilaDeAdmision(f);
  return l === null ? null : fraseDeLecturaDePrecio(l, pesos);
};

describe("leerPrecioDeFilaDeAdmision: cuándo se lee una fila del formulario", () => {
  it("un tamaño con precio propio: el precio final tecleado, sin mirar ninguna referencia", () => {
    const f = fila({ tipoDeGrupo: "MEDIDA", modoPrecio: "ABSOLUTO", opcion: { nombre: "Napolitana", esNinguna: false, diferenciaDeLaOpcion: null }, precioAbsoluto: "25000", referencia: null, precioDeLista: null });
    expect(leerPrecioDeFilaDeAdmision(f)).toEqual({ tipo: "precio-final", opcion: "Napolitana", total: 25000 });
    expect(frase(f)).toBe("Napolitana = $ 25.000");
  });

  it("un tamaño con precio propio sin precio todavía avisa que falta; con un texto que no es número, que no se entendió", () => {
    const base = { tipoDeGrupo: "MEDIDA", modoPrecio: "ABSOLUTO", opcion: { nombre: "Napolitana", esNinguna: false, diferenciaDeLaOpcion: null }, referencia: null } as const;
    expect(frase(fila({ ...base, precioAbsoluto: "" }))).toBe("Falta el precio final de «Napolitana»");
    expect(leerPrecioDeFilaDeAdmision(fila({ ...base, precioAbsoluto: "abc" }))).toMatchObject({ tipo: "invalido" });
    expect(leerPrecioDeFilaDeAdmision(fila({ ...base, precioAbsoluto: "0" }))).toMatchObject({ tipo: "invalido" });
  });

  it("un extra con un monto propio se lee contra la opción más barata guardada: «Napolitana con Trucha = $ 25.000 + $ 3.000 = $ 28.000»", () => {
    expect(frase(fila({}))).toBe("Napolitana con Trucha = $ 25.000 + $ 3.000 = $ 28.000");
  });

  it("sin referencia se suma sobre el precio de lista (un directo)", () => {
    expect(frase(fila({ referencia: null, precioDeLista: 8500, valor: "500" }))).toBe("Con Trucha = $ 8.500 + $ 500 = $ 9.000");
  });

  it("con la diferencia de la opción: en pesos se lee; una variante sin diferencia suma 0", () => {
    const sinPropia = { precio: "DE_LA_OPCION", valor: "" } as const;
    expect(frase(fila({ ...sinPropia, opcion: { nombre: "Trucha", esNinguna: false, diferenciaDeLaOpcion: { tipo: "MONTO", monto: 1200 } } }))).toBe("Napolitana con Trucha = $ 25.000 + $ 1.200 = $ 26.200");
    expect(frase(fila({ ...sinPropia }))).toBe("Napolitana con Trucha = $ 25.000 + $ 0 = $ 25.000");
  });

  it("un tamaño por diferencia se lee igual, sobre el precio base; sin diferencia no tiene con qué cobrarse y no se lee", () => {
    const porDiferencia = { tipoDeGrupo: "MEDIDA", modoPrecio: "DIFERENCIA", opcion: { nombre: "Grande", esNinguna: false, diferenciaDeLaOpcion: null }, referencia: null, precioDeLista: 8000 } as const;
    expect(frase(fila({ ...porDiferencia, valor: "1500" }))).toBe("Con Grande = $ 8.000 + $ 1.500 = $ 9.500");
    expect(frase(fila({ ...porDiferencia, precio: "DE_LA_OPCION", valor: "" }))).toBeNull();
  });

  it("un importe que no se entendió es una lectura inválida (la frase dice cuál)", () => {
    expect(leerPrecioDeFilaDeAdmision(fila({ valor: "mil" }))).toEqual({ tipo: "invalido", mensaje: "Revisá el importe de «Trucha»: no se entendió." });
  });

  it("un descuento que deja el precio en menos de 0,01 es el error del compositor, con su mensaje", () => {
    expect(leerPrecioDeFilaDeAdmision(fila({ valor: "-25000" }))).toMatchObject({ tipo: "invalido", mensaje: expect.stringContaining("menos de 0,01") });
  });

  describe("lo que no se lee", () => {
    it.each<[string, Partial<FilaDeAdmisionParaLeer>]>([
      ["una opción sin tildar", { admitida: false }],
      ["la opción «ninguna»", { opcion: { nombre: "Ninguna", esNinguna: true, diferenciaDeLaOpcion: null } }],
      ["un grupo de lo incluido (no tiene importe)", { tipoDeGrupo: "INCLUIDA" }],
      ["un adicional («se cobra aparte»: queda para el bloque 3)", { tipoDeGrupo: "ADICIONAL" }],
      ["un tamaño sin modo de precio elegido", { tipoDeGrupo: "MEDIDA", modoPrecio: null }],
      ["un porcentaje (la lectura es en pesos)", { precio: "PORCENTAJE", valor: "10" }],
      ["una diferencia propia vacía", { valor: "" }],
      ["la diferencia de la opción si es un porcentaje", { precio: "DE_LA_OPCION", opcion: { nombre: "Trucha", esNinguna: false, diferenciaDeLaOpcion: { tipo: "PORCENTAJE", porcentaje: 10 } } }],
      ["lo que suma en un producto que se vende por opción y todavía no tiene precio final (precio de lista null)", { referencia: null, precioDeLista: null }],
      ["lo que suma en un producto sin precio (precio de lista 0): sumar sobre 0 daría el error del compositor", { referencia: null, precioDeLista: 0 }],
    ])("%s", (_que, parcial) => {
      expect(leerPrecioDeFilaDeAdmision(fila(parcial))).toBeNull();
    });

    it("un tamaño con precio propio no necesita referencia ni precio de lista: se lee aunque el producto no tenga precio", () => {
      expect(leerPrecioDeFilaDeAdmision(fila({ tipoDeGrupo: "MEDIDA", modoPrecio: "ABSOLUTO", precioAbsoluto: "100", referencia: null, precioDeLista: null }))).toMatchObject({ tipo: "precio-final", total: 100 });
    });
  });

  it("el total de lo que suma es siempre referencia + diferencia, en centavos (la cuenta sale del compositor)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9_999_999 }), fc.integer({ min: 0, max: 9_999_999 }), (base, dif) => {
        const l = leerPrecioDeFilaDeAdmision(fila({ referencia: { opcion: "R", precio: base / 100 }, valor: String(dif / 100) }));
        expect(l).toMatchObject({ tipo: "suma" });
        if (l?.tipo !== "suma") return;
        expect(Math.round(l.total * 100)).toBe(base + dif);
      }),
      { numRuns: 300 },
    );
  });
});

import { describe, expect, it } from "vitest";
import { MODULOS, esModuloDelCatalogo, moduloDelCatalogo, type ModuloDef } from "../../src/core/modulos/catalogo";
import { modulosEfectivos, modulosQueIncluyen, validarCambioDeModulos } from "../../src/core/modulos/clausura";

const ordenados = (s: Iterable<string>) => [...s].sort();

describe("catálogo de módulos (ADR-014 + ADR-015)", () => {
  it("tiene 13 módulos: 1 fijo, 3 de soporte y 9 vendibles", () => {
    expect(MODULOS).toHaveLength(13);
    const porTipo = (tipo: string) => MODULOS.filter((m) => m.tipo === tipo).map((m) => m.id);
    expect(porTipo("fijo")).toEqual(["administracion"]);
    expect(ordenados(porTipo("soporte"))).toEqual(["catalogo_basico", "clientes_basico", "proveedores_basico"]);
    expect(ordenados(porTipo("vendible"))).toEqual(["carta", "compras", "consignacion", "produccion", "promociones", "recetas", "salon", "stock", "traspasos"]);
  });

  it("los ids son únicos y toda dependencia (dura o blanda) apunta a un módulo que existe", () => {
    const ids = new Set(MODULOS.map((m) => m.id));
    expect(ids.size).toBe(MODULOS.length);
    for (const m of MODULOS) for (const d of [...m.requiere, ...m.usaSiExiste]) expect(ids.has(d), `${m.id} → ${d}`).toBe(true);
  });

  it("los `requiere` no tienen ciclos y el fijo y los de soporte no requieren nada", () => {
    for (const m of MODULOS) {
      const visto = new Set<string>();
      const pendientes: string[] = [...m.requiere];
      while (pendientes.length) {
        const id = pendientes.pop()!;
        expect(id, `ciclo desde ${m.id}`).not.toBe(m.id);
        if (visto.has(id)) continue;
        visto.add(id);
        pendientes.push(...moduloDelCatalogo(id as never).requiere);
      }
      if (m.tipo !== "vendible") expect(m.requiere).toEqual([]);
    }
  });

  it("un módulo de soporte nunca es blando de otro ni se requiere a sí mismo; los vendibles solo requieren soporte o vendibles", () => {
    for (const m of MODULOS) expect(m.usaSiExiste).not.toContain(m.id);
    for (const m of MODULOS) for (const r of m.requiere) expect(moduloDelCatalogo(r as never).tipo).not.toBe("fijo");
  });

  it("esModuloDelCatalogo distingue ids del catálogo", () => {
    expect(esModuloDelCatalogo("salon")).toBe(true);
    expect(esModuloDelCatalogo("mostrador")).toBe(false);
  });
});

describe("modulosEfectivos (clausura por requiere)", () => {
  it("con el registro vacío queda solo Administración", () => {
    expect(ordenados(modulosEfectivos([]))).toEqual(["administracion"]);
  });

  it("Consignación sin Compras trae Proveedores básico, Stock y Catálogo básico, y no Compras", () => {
    const efectivos = modulosEfectivos(["consignacion"]);
    expect(ordenados(efectivos)).toEqual(["administracion", "catalogo_basico", "consignacion", "proveedores_basico", "stock"]);
    expect(efectivos.has("compras")).toBe(false);
  });

  it("Salón trae Stock, Clientes básico y Catálogo básico", () => {
    expect(ordenados(modulosEfectivos(["salon"]))).toEqual(["administracion", "catalogo_basico", "clientes_basico", "salon", "stock"]);
  });

  it("Producción trae Stock, Recetas y el catálogo; Promociones trae Carta", () => {
    expect(ordenados(modulosEfectivos(["produccion"]))).toEqual(["administracion", "catalogo_basico", "produccion", "recetas", "stock"]);
    expect(ordenados(modulosEfectivos(["promociones"]))).toEqual(["administracion", "carta", "catalogo_basico", "promociones"]);
  });

  it("una dependencia blanda NO se trae: Carta sola no trae Salón", () => {
    expect(modulosEfectivos(["carta"]).has("salon")).toBe(false);
  });

  it("con los 9 vendibles activos están los 13 módulos", () => {
    const vendibles = MODULOS.filter((m) => m.tipo === "vendible").map((m) => m.id);
    expect(modulosEfectivos(vendibles).size).toBe(13);
  });

  it("los de soporte y los ids desconocidos no cuentan como filas del registro", () => {
    expect(ordenados(modulosEfectivos(["catalogo_basico", "clientes_basico", "mostrador"]))).toEqual(["administracion"]);
  });

  it("un módulo en_desarrollo en el registro no está activo, con su dependencia ni sin ella", () => {
    const catalogo: ModuloDef[] = [
      ...MODULOS,
      { id: "facturacion", nombre: "Facturación", tipo: "vendible", estado: "en_desarrollo", requiere: ["stock"], usaSiExiste: [] },
    ];
    const efectivos = modulosEfectivos(["facturacion"], catalogo);
    expect(efectivos.has("facturacion")).toBe(false);
    expect(efectivos.has("stock")).toBe(false);
  });
});

describe("modulosQueIncluyen («incluido por X»)", () => {
  it("Stock lo traen Salón y Compras; un módulo activo se incluye a sí mismo", () => {
    expect(ordenados(modulosQueIncluyen("stock", ["salon", "compras", "carta"]))).toEqual(["compras", "salon"]);
    expect(modulosQueIncluyen("carta", ["carta"])).toEqual(["carta"]);
  });

  it("nadie trae un módulo que no se requiere", () => {
    expect(modulosQueIncluyen("compras", ["consignacion"])).toEqual([]);
  });
});

describe("validarCambioDeModulos", () => {
  it("no se desactiva Stock mientras Compras, Traspasos, Consignación, Producción o Salón lo requieren", () => {
    for (const quien of ["compras", "traspasos", "consignacion", "produccion", "salon"]) {
      const r = validarCambioDeModulos(["stock", quien], { desactivar: ["stock"] });
      expect(r.ok, quien).toBe(false);
      if (!r.ok) expect(r.errores).toEqual([{ motivo: "LO_REQUIEREN_OTROS", modulo: "stock", requeridoPor: [quien] }]);
    }
  });

  it("se desactiva Stock cuando nadie lo requiere, y desactivar a quien lo trae lo habilita", () => {
    expect(validarCambioDeModulos(["stock", "carta"], { desactivar: ["stock"] })).toEqual({ ok: true, activos: new Set(["carta"]) });
    expect(validarCambioDeModulos(["stock", "salon"], { desactivar: ["stock", "salon"] })).toEqual({ ok: true, activos: new Set() });
  });

  it("activar uno que requiere un vendible que no está en el registro es válido (queda incluido)", () => {
    const r = validarCambioDeModulos([], { activar: ["salon"] });
    expect(r).toEqual({ ok: true, activos: new Set(["salon"]) });
    expect(modulosEfectivos(r.ok ? r.activos : []).has("stock")).toBe(true);
  });

  it("no se activa ni se desactiva un módulo de soporte, el fijo ni uno desconocido", () => {
    const r = validarCambioDeModulos([], { activar: ["catalogo_basico", "administracion", "mostrador"], desactivar: ["clientes_basico"] });
    expect(r).toEqual({
      ok: false,
      errores: [
        { motivo: "NO_ES_VENDIBLE", modulo: "catalogo_basico" },
        { motivo: "NO_ES_VENDIBLE", modulo: "administracion" },
        { motivo: "DESCONOCIDO", modulo: "mostrador" },
        { motivo: "NO_ES_VENDIBLE", modulo: "clientes_basico" },
      ],
    });
  });

  it("no se activa un módulo en_desarrollo", () => {
    const catalogo: ModuloDef[] = [
      ...MODULOS,
      { id: "facturacion", nombre: "Facturación", tipo: "vendible", estado: "en_desarrollo", requiere: [], usaSiExiste: [] },
    ];
    expect(validarCambioDeModulos([], { activar: ["facturacion"] }, catalogo)).toEqual({ ok: false, errores: [{ motivo: "EN_DESARROLLO", modulo: "facturacion" }] });
  });
});

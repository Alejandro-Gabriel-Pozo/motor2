import { describe, expect, it } from "vitest";
import { slugTenant, slugTenantUnico } from "../../src/core/carta/registro-tenants";
import { validarDominioPublico, validarNombreTabSheet, validarPosicionPortal, validarSheetId, validarSlugTenant } from "../../src/core/carta/validaciones";

/**
 * Registro de tenants del portal (docs/plan-registro-tenants-2026-09-24.md, M2): el slug (D2) y los validadores de carga.
 * Puro, sin base. (ADR-006 Fase 8 borró el contrato HTTP `RegistroTenantsV1` y sus tests.)
 */
const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc";

describe("slugTenant", () => {
  it("saca tildes y ñ, pasa a minúsculas y reemplaza lo que no es [a-z0-9] por guiones", () => {
    expect(slugTenant("Piñón")).toBe("pinon");
    expect(slugTenant("Villa La Angostura")).toBe("villa-la-angostura");
    expect(slugTenant("Pan & Vino")).toBe("pan-vino");
    expect(slugTenant("  San   Martín  de los Andes ")).toBe("san-martin-de-los-andes");
    expect(slugTenant("¡Café—Bar!")).toBe("cafe-bar");
    expect(slugTenant("Sucursal 2")).toBe("sucursal-2");
  });

  it("vacío o sin nada rescatable → 'sucursal'", () => {
    expect(slugTenant("")).toBe("sucursal");
    expect(slugTenant("   ")).toBe("sucursal");
    expect(slugTenant("¿¡!?")).toBe("sucursal");
  });

  it("corta en 60 caracteres sin dejar un guion al final", () => {
    const largo = slugTenant("a".repeat(59) + " bcd");
    expect(largo).toBe("a".repeat(59));
    expect(slugTenant("x".repeat(100))).toHaveLength(60);
  });

  it("siempre cumple el formato que valida validarSlugTenant", () => {
    for (const n of ["Piñón", "Pan & Vino", "", "a".repeat(59) + " b", "Ñandú -- 3"]) {
      const s = slugTenant(n);
      expect(validarSlugTenant(s)).toEqual({ ok: true, valor: s });
    }
  });
});

describe("slugTenantUnico", () => {
  it("colisión: 'Villa La Angostura' y 'Villa la Angostura' dan el mismo base; el segundo lleva -2, el tercero -3", () => {
    const ocupados = new Set<string>();
    const a = slugTenantUnico(slugTenant("Villa La Angostura"), ocupados);
    ocupados.add(a);
    const b = slugTenantUnico(slugTenant("Villa la Angostura"), ocupados);
    ocupados.add(b);
    const c = slugTenantUnico(slugTenant("villa la angostura"), ocupados);
    expect([a, b, c]).toEqual(["villa-la-angostura", "villa-la-angostura-2", "villa-la-angostura-3"]);
  });

  it("'Piñón' y 'Pinon' chocan igual", () => {
    expect(slugTenantUnico(slugTenant("Pinon"), new Set([slugTenant("Piñón")]))).toBe("pinon-2");
  });

  it("con el sufijo no pasa de 60 caracteres", () => {
    const base = "x".repeat(60);
    const s = slugTenantUnico(base, new Set([base]));
    expect(s).toBe("x".repeat(58) + "-2");
    expect(s).toHaveLength(60);
  });
});

describe("validadores del registro", () => {
  it("slug: minúsculas, dígitos y guiones sueltos; se recorta y se pasa a minúsculas", () => {
    expect(validarSlugTenant(" Villa-La-Angostura ")).toEqual({ ok: true, valor: "villa-la-angostura" });
    for (const malo of ["", "a--b", "-a", "a-", "piñón", "a b", "a/b", "x".repeat(61)]) expect(validarSlugTenant(malo).ok, malo).toBe(false);
  });

  it("dominio: se normaliza a host desnudo; vacío → null; rechaza rutas y hosts inválidos", () => {
    expect(validarDominioPublico("")).toEqual({ ok: true, valor: null });
    expect(validarDominioPublico("https://Carta.MiResto.com.ar/")).toEqual({ ok: true, valor: "carta.miresto.com.ar" });
    expect(validarDominioPublico("http://carta.x.com:8080")).toEqual({ ok: true, valor: "carta.x.com" });
    for (const malo of ["localhost", "carta.x.com/menu", "-x.com", "a..com", "x_y.com", "1.2.3.4", "javascript:alert(1)"]) expect(validarDominioPublico(malo).ok, malo).toBe(false);
  });

  it("sheetId: vacío → null; id o URL completa; rechaza lo demás", () => {
    expect(validarSheetId(" ")).toEqual({ ok: true, valor: null });
    expect(validarSheetId(SHEET)).toEqual({ ok: true, valor: SHEET });
    expect(validarSheetId(`https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=0`)).toEqual({ ok: true, valor: SHEET });
    for (const malo of ["corto", "con espacios en el medio de todo esto", `${SHEET}!`]) expect(validarSheetId(malo).ok, malo).toBe(false);
  });

  it("tab del menú: vacío → 'Menu'; hasta 100 caracteres", () => {
    expect(validarNombreTabSheet("")).toEqual({ ok: true, valor: "Menu" });
    expect(validarNombreTabSheet(" Menú Invierno ")).toEqual({ ok: true, valor: "Menú Invierno" });
    expect(validarNombreTabSheet("x".repeat(101)).ok).toBe(false);
  });

  it("posición: 0-100 con 2 decimales; x/y/ancho juntos; alto solo con ellos", () => {
    expect(validarPosicionPortal({})).toEqual({ ok: true, valor: { x: null, y: null, w: null, h: null } });
    expect(validarPosicionPortal({ x: "12,345", y: 50, w: "8", h: "" })).toEqual({ ok: true, valor: { x: 12.35, y: 50, w: 8, h: null } });
    expect(validarPosicionPortal({ x: 0, y: 100, w: 1, h: 5 })).toEqual({ ok: true, valor: { x: 0, y: 100, w: 1, h: 5 } });
    expect(validarPosicionPortal({ x: 10, y: 10 }).ok).toBe(false);
    expect(validarPosicionPortal({ h: 5 }).ok).toBe(false);
    expect(validarPosicionPortal({ x: 101, y: 1, w: 1 }).ok).toBe(false);
    expect(validarPosicionPortal({ x: -1, y: 1, w: 1 }).ok).toBe(false);
    expect(validarPosicionPortal({ x: "abc", y: 1, w: 1 }).ok).toBe(false);
  });
});

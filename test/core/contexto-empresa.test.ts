import { describe, expect, it } from "vitest";
import { contextoEmpresaSchema, type ContextoEmpresa } from "../../src/core/auth/contexto-empresa";

/**
 * Fase 1.1 del checklist de multi-tenancy (Downloads/Motor 2/motor2-multitenancy-checklist (1).md): `contextoEmpresaSchema` SOLO
 * valida forma — no hay todavía un `resolverContextoEmpresa()` real contra el que probar autorización (eso depende de
 * `Empresa`/`UsuarioEmpresa`, Fase A). Este test confirma la FORMA acordada en la v3 (Bloque 7) + `rolEmpresa` (decisión del
 * dueño, 2026-09-28, reemplaza a `esGerenteEmpresa: boolean` — ver el docstring de `contexto-empresa.ts`), incluido el caso
 * superadmin (`sucursales: []`/`rolEmpresa: null` válidos).
 */
describe("contextoEmpresaSchema", () => {
  it("acepta la forma acordada, con rolEmpresa null y con un rol de empresa", () => {
    const sinRolDeEmpresa: ContextoEmpresa = {
      empresaId: "emp_1",
      usuarioId: "usr_1",
      rolEmpresa: null, // el caso de siempre: solo acceso por UsuarioSucursal, sin gerenciamiento cross-sucursal.
      sucursales: [{ sucursalId: "suc_1", rol: "admin" }],
      sucursalActivaId: "suc_1",
    };
    expect(contextoEmpresaSchema.parse(sinRolDeEmpresa)).toEqual(sinRolDeEmpresa);

    const gerente: ContextoEmpresa = {
      empresaId: "emp_1",
      usuarioId: "usr_1",
      rolEmpresa: "gerente",
      sucursales: [
        { sucursalId: "suc_1", rol: "admin" },
        { sucursalId: "suc_2", rol: "operador" }, // rol DISTINTO por sucursal — la razón de sucursales[] en vez de dos arrays paralelos.
      ],
      sucursalActivaId: "suc_2",
    };
    expect(contextoEmpresaSchema.parse(gerente)).toEqual(gerente);
  });

  it("rolEmpresa no es un enum cerrado — cualquier texto no vacío es válido (mismo criterio que sucursales[].rol)", () => {
    const auditor: ContextoEmpresa = {
      empresaId: "emp_1",
      usuarioId: "usr_1",
      rolEmpresa: "auditor", // rol de empresa distinto de "gerente" — el schema no lo restringe a un enum cerrado.
      sucursales: [],
      sucursalActivaId: null,
    };
    expect(contextoEmpresaSchema.parse(auditor)).toEqual(auditor);
  });

  it("sucursales: [] es válido — el caso superadmin (sin pertenencia a ninguna empresa en particular)", () => {
    const superadmin: ContextoEmpresa = {
      empresaId: "emp_plataforma",
      usuarioId: "usr_superadmin",
      rolEmpresa: null,
      sucursales: [],
      sucursalActivaId: null,
    };
    expect(contextoEmpresaSchema.parse(superadmin)).toEqual(superadmin);
  });

  it("rechaza empresaId/usuarioId vacíos, rolEmpresa vacío (string), y una sucursal sin rol", () => {
    const base = { empresaId: "emp_1", usuarioId: "usr_1", rolEmpresa: null, sucursales: [], sucursalActivaId: null };
    expect(contextoEmpresaSchema.safeParse({ ...base, empresaId: "" }).success).toBe(false);
    expect(contextoEmpresaSchema.safeParse({ ...base, usuarioId: "" }).success).toBe(false);
    expect(contextoEmpresaSchema.safeParse({ ...base, rolEmpresa: "" }).success).toBe(false);
    expect(contextoEmpresaSchema.safeParse({ ...base, sucursales: [{ sucursalId: "suc_1", rol: "" }] }).success).toBe(false);
  });

  it("rechaza sucursalActivaId vacío (string), pero acepta null", () => {
    const base = { empresaId: "emp_1", usuarioId: "usr_1", rolEmpresa: null, sucursales: [] };
    expect(contextoEmpresaSchema.safeParse({ ...base, sucursalActivaId: null }).success).toBe(true);
    expect(contextoEmpresaSchema.safeParse({ ...base, sucursalActivaId: "" }).success).toBe(false);
  });
});

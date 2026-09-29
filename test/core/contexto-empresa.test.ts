import { describe, expect, it } from "vitest";
import { contextoEmpresaSchema, type ContextoEmpresa } from "../../src/core/auth/contexto-empresa";

/**
 * Fase 1.1 del checklist de multi-tenancy (Downloads/Motor 2/motor2-multitenancy-checklist (1).md): `contextoEmpresaSchema` SOLO
 * valida forma — no hay todavía un `resolverContextoEmpresa()` real contra el que probar autorización (eso depende de
 * `Empresa`/`UsuarioEmpresa`, Fase A). Este test confirma la FORMA acordada en la v3 (Bloque 7), incluido el caso superadmin
 * (`sucursales: []` válido).
 */
describe("contextoEmpresaSchema", () => {
  it("acepta la forma acordada, con una sucursal y con varias", () => {
    const conUna: ContextoEmpresa = {
      empresaId: "emp_1",
      usuarioId: "usr_1",
      esGerenteEmpresa: false,
      sucursales: [{ sucursalId: "suc_1", rol: "admin" }],
      sucursalActivaId: "suc_1",
    };
    expect(contextoEmpresaSchema.parse(conUna)).toEqual(conUna);

    const conVarias: ContextoEmpresa = {
      empresaId: "emp_1",
      usuarioId: "usr_1",
      esGerenteEmpresa: true,
      sucursales: [
        { sucursalId: "suc_1", rol: "admin" },
        { sucursalId: "suc_2", rol: "operador" }, // rol DISTINTO por sucursal — la razón de sucursales[] en vez de dos arrays paralelos.
      ],
      sucursalActivaId: "suc_2",
    };
    expect(contextoEmpresaSchema.parse(conVarias)).toEqual(conVarias);
  });

  it("sucursales: [] es válido — el caso superadmin (sin pertenencia a ninguna empresa en particular)", () => {
    const superadmin: ContextoEmpresa = {
      empresaId: "emp_plataforma",
      usuarioId: "usr_superadmin",
      esGerenteEmpresa: false,
      sucursales: [],
      sucursalActivaId: null,
    };
    expect(contextoEmpresaSchema.parse(superadmin)).toEqual(superadmin);
  });

  it("rechaza empresaId/usuarioId vacíos, y una sucursal sin rol", () => {
    const base = { empresaId: "emp_1", usuarioId: "usr_1", esGerenteEmpresa: false, sucursales: [], sucursalActivaId: null };
    expect(contextoEmpresaSchema.safeParse({ ...base, empresaId: "" }).success).toBe(false);
    expect(contextoEmpresaSchema.safeParse({ ...base, usuarioId: "" }).success).toBe(false);
    expect(contextoEmpresaSchema.safeParse({ ...base, sucursales: [{ sucursalId: "suc_1", rol: "" }] }).success).toBe(false);
  });

  it("rechaza sucursalActivaId vacío (string), pero acepta null", () => {
    const base = { empresaId: "emp_1", usuarioId: "usr_1", esGerenteEmpresa: false, sucursales: [] };
    expect(contextoEmpresaSchema.safeParse({ ...base, sucursalActivaId: null }).success).toBe(true);
    expect(contextoEmpresaSchema.safeParse({ ...base, sucursalActivaId: "" }).success).toBe(false);
  });
});

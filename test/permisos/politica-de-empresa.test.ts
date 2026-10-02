import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { MENSAJE_PERMISOS_DE_PLATAFORMA, politicaDeEmpresa } from "../../src/core/permisos/politica-de-empresa";

describe("politicaDeEmpresa", () => {
  it("hoy toda empresa puede editar permisos (el add-on todavía no tiene dónde guardarse)", async () => {
    expect((await politicaDeEmpresa("cualquier-empresa", {} as unknown as PrismaClient)).permisosEditables).toBe(true);
  });

  it("el menú en dos paneles (ADR-010) vale lo mismo para toda empresa", async () => {
    expect((await politicaDeEmpresa("cualquier-empresa", {} as unknown as PrismaClient)).dosPaneles).toBe(true);
  });

  it("el mensaje de rechazo le explica a la empresa quién administra sus permisos", () => {
    expect(MENSAJE_PERMISOS_DE_PLATAFORMA).toMatch(/plataforma/);
  });
});

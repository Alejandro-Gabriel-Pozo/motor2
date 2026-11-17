import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { requierePermiso, requierePermisoDeEmpresa } from "../../src/server/acceso/gate";
import { guardarPermisos } from "../../src/server/actions/permisos/permisos";
import { SIN_PERMISO } from "../../src/core/permisos/matriz";
import { tablaDelOraculo } from "../setup/oraculo-una-sola-compra";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PISOS-65 (2026-11-17): recorre TODAS las combinaciones del oráculo `docs/oraculo-combinaciones-pisos-65-2026-11-17.md` contra Postgres real: las 40 de «Guardar la matriz» (con `guardarPermisos` de verdad) y las
 * 20 de «Acceso» (con el gate de verdad). El resultado esperado sale de la tabla, escrita aparte del código: este archivo solo la traduce a una entrada real y compara.
 */
const TEXTO = readFileSync(join(__dirname, "../../docs/oraculo-combinaciones-pisos-65-2026-11-17.md"), "utf8");
const GUARDAR = tablaDelOraculo("Guardar la matriz", TEXTO).filas;
const ACCESO = tablaDelOraculo("Acceso", TEXTO).filas;

/** Un representante de cada clase de acción (ver «Guardar la matriz» del oráculo). */
const REPRESENTANTE: Record<string, { clave: string; contexto: "sucursal" | "empresa" }> = {
  L: { clave: "producto_disponibilidad", contexto: "sucursal" },
  O: { clave: "caja_abrir_sesion", contexto: "sucursal" },
  D: { clave: "caja_cerrar_sesion", contexto: "sucursal" },
  GS: { clave: "ver_auditoria", contexto: "sucursal" },
  GG: { clave: "traspasar_gerencia", contexto: "empresa" },
};

const CON_TODO = { puedeVer: true, puedeEditar: true };
const TEXTO_GOBIERNO = "Esta acción es de gobierno de la empresa y no se delega.";

describe("PISOS-65: el oráculo tiene las filas que dice tener", () => {
  it("40 de guardar y 20 de acceso", () => {
    expect(GUARDAR).toHaveLength(40);
    expect(ACCESO).toHaveLength(20);
  });
});

describe("PISOS-65: guardar la matriz (R × C × Q × M) contra el oráculo", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  let gerente: { id: string; email: string };
  let administrador: { id: string; email: string };

  const ponerCelda = async (rolId: string, accionClave: string, estado: { puedeVer: boolean; puedeEditar: boolean }) => {
    await prismaAdmin.permisoRol.upsert({ where: { rolId_accionClave: { rolId, accionClave } }, update: estado, create: { rolId, accionClave, ...estado } });
  };
  const celda = async (rolId: string, accionClave: string) => {
    const f = await prismaAdmin.permisoRol.findUnique({ where: { rolId_accionClave: { rolId, accionClave } } });
    return f ? { puedeVer: f.puedeVer, puedeEditar: f.puedeEditar } : SIN_PERMISO;
  };
  const clasificar = (r: { ok: boolean; mensaje: string }): string => {
    if (r.ok) return "GUARDA";
    if (r.mensaje === TEXTO_GOBIERNO) return "RECHAZA_GOBIERNO";
    if (r.mensaje.startsWith("Solo el gerente de la empresa puede editar los permisos del rol administrador")) return "RECHAZA_MATRIZ_DEL_ADMIN";
    if (r.mensaje.startsWith("Solo el gerente de la empresa puede darle esta acción")) return "RECHAZA_SOLO_EL_GERENTE_LA_DA";
    return `OTRO: ${r.mensaje}`;
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
    gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
    administrador = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  });

  it.each(GUARDAR.map((f) => [`${f["R"]} · ${f["C"]} · ${f["Q"]} · ${f["M"]}`, f] as const))("%s", async (_nombre, f) => {
    const rolId = f["R"] === "ADMIN" ? base.admin.id : base.operador.id;
    const { clave } = REPRESENTANTE[f["C"]!]!;
    const otorga = f["M"] === "OTORGA";
    const anterior = otorga ? SIN_PERMISO : CON_TODO;
    const nuevo = otorga ? CON_TODO : SIN_PERMISO;
    await ponerCelda(rolId, clave, anterior);
    const auditoriaAntes = await prismaAdmin.registroAuditoria.count({ where: { entidad: "PermisoRol" } });
    const actor = f["Q"] === "GERENTE" ? gerente : administrador;
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    const r = await guardarPermisos([{ rolId, accionClave: clave, anterior, nuevo }]);

    expect(clasificar(r), r.mensaje).toBe(f["Resultado"]);
    if (f["Resultado"] === "GUARDA") {
      expect(await celda(rolId, clave)).toEqual(nuevo);
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "PermisoRol" } })).toBeGreaterThan(auditoriaAntes);
    } else {
      expect(await celda(rolId, clave), "un rechazo no escribe").toEqual(anterior);
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "PermisoRol" } }), "un rechazo no audita").toBe(auditoriaAntes);
    }
  });
});

describe("PISOS-65: acceso (R × C × F) contra el oráculo", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
  });

  it.each(ACCESO.map((f) => [`${f["R"]} · ${f["C"]} · fila ${f["F"]}`, f] as const))("%s", async (_nombre, f) => {
    const rolId = f["R"] === "ADMIN" ? base.admin.id : base.operador.id;
    const { clave, contexto } = REPRESENTANTE[f["C"]!]!;
    const usuario = await crearUsuarioConMembresia({ email: "persona@test.com", sucursalId: base.sucursal.id, rolId });
    if (f["F"] === "SI") await prismaAdmin.permisoRol.upsert({ where: { rolId_accionClave: { rolId, accionClave: clave } }, update: CON_TODO, create: { rolId, accionClave: clave, ...CON_TODO } });
    else await prismaAdmin.permisoRol.deleteMany({ where: { rolId, accionClave: clave } });

    const r =
      contexto === "sucursal"
        ? await requierePermiso(usuario.id, base.sucursal.id, clave as never, prisma)
        : await requierePermisoDeEmpresa(usuario.id, EMPRESA_POR_DEFECTO_ID, clave as never, prisma);

    expect(r.ok ? "PERMITE" : "DENIEGA").toBe(f["Resultado"]);
  });
});

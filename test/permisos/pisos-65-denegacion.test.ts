import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { EMPRESA_POR_DEFECTO_ID, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { activarTodosLosModulos } from "../setup/modulos";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { requierePermiso } from "../../src/server/acceso/gate";
import { guardarPermisos } from "../../src/server/actions/permisos/permisos";
import { abrirSesionDeCaja, iniciarCierreDeSesionDeCaja } from "../../src/server/actions/caja/caja";
import { sembrarSalon } from "../pos/salon-fixture";
import { SIN_PERMISO } from "../../src/core/permisos/matriz";
import type { AccionDeSucursal } from "../../src/core/permisos/acciones";

/**
 * PISOS-65 (2026-11-17), pruebas de denegación: de las 65 que bajaron de piso administrador a operario, `caja_cerrar_sesion`, `anular_venta`, `compra_recibir` y `carta_ver`.
 *  - el empleado (rol «operador» de fábrica) SIN la fila es rechazado por el guard;
 *  - un administrador que no es el gerente no puede dársela (DEC-0024): mensaje exacto, nada escrito ni auditado;
 *  - el gerente se la da y el empleado pasa (con una Server Action real: cerrar la caja);
 *  - una de gobierno (`ver_auditoria`) no se le da a nadie de nivel operario, ni el gerente: «Esta acción es de gobierno de la empresa y no se delega.»
 */
const LAS_4 = ["caja_cerrar_sesion", "anular_venta", "compra_recibir", "carta_ver"] as const;
const CON_TODO = { puedeVer: true, puedeEditar: true };
const TEXTO_GOBIERNO = "Esta acción es de gobierno de la empresa y no se delega.";
const TEXTO_SOLO_EL_GERENTE = "Solo el gerente de la empresa puede darle esta acción a un rol de nivel operario. No se guardó nada.";

let s: Awaited<ReturnType<typeof sembrarSalon>>;
let gerente: { id: string; email: string };
let administrador: { id: string; email: string };
let empleado: { id: string; email: string };

const como = (u: { id: string; email: string }) => mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });
const auditoria = () => prismaAdmin.registroAuditoria.count({ where: { entidad: "PermisoRol" } });
const fila = async (clave: string) => {
  const f = await prismaAdmin.permisoRol.findUnique({ where: { rolId_accionClave: { rolId: s.operador.id, accionClave: clave } } });
  return f ? { puedeVer: f.puedeVer, puedeEditar: f.puedeEditar } : SIN_PERMISO;
};
const pedirLaFila = async (clave: string) => guardarPermisos([{ rolId: s.operador.id, accionClave: clave, anterior: await fila(clave), nuevo: CON_TODO }]);

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await activarTodosLosModulos(EMPRESA_POR_DEFECTO_ID);
  // De fábrica el operador no tiene ninguna de las cuatro: se asegura (la semilla exacta no importa para esta prueba).
  await prismaAdmin.permisoRol.deleteMany({ where: { rolId: s.operador.id, accionClave: { in: [...LAS_4] } } });
  gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: s.sucursalId, rolId: s.admin.id });
  await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
  administrador = await crearUsuarioConMembresia({ email: "administrador@test.com", sucursalId: s.sucursalId, rolId: s.admin.id });
  empleado = await crearUsuarioConMembresia({ email: "empleado@test.com", sucursalId: s.sucursalId, rolId: s.operador.id });
});

describe("PISOS-65: las 65 nacen cerradas y las abre solo el gerente", () => {
  it.each(LAS_4)("%s: el empleado sin la fila es rechazado por el guard; el administrador que no es gerente no puede dársela; el gerente sí, y entonces pasa", async (clave) => {
    const gate = () => requierePermiso(empleado.id, s.sucursalId, clave as AccionDeSucursal, prisma);
    expect(await gate()).toMatchObject({ ok: false, motivo: "SIN_PERMISO" });

    // El administrador (no es el gerente) intenta dársela: mensaje exacto, nada escrito ni auditado.
    const auditoriaAntes = await auditoria();
    await como(administrador);
    expect(await pedirLaFila(clave)).toEqual({ ok: false, mensaje: TEXTO_SOLO_EL_GERENTE });
    expect(await fila(clave)).toEqual(SIN_PERMISO);
    expect(await auditoria()).toBe(auditoriaAntes);
    expect(await gate()).toMatchObject({ ok: false });

    // El gerente se la da: queda escrita y auditada, y el empleado pasa.
    await como(gerente);
    const r = await pedirLaFila(clave);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await fila(clave)).toEqual(CON_TODO);
    expect(await auditoria()).toBeGreaterThan(auditoriaAntes);
    expect((await gate()).ok).toBe(true);
  });

  it("el administrador que no es gerente SÍ puede quitar una de las 65 (la regla solo restringe dar)", async () => {
    await como(gerente);
    expect((await pedirLaFila("caja_cerrar_sesion")).ok).toBe(true);
    await como(administrador);
    const r = await guardarPermisos([{ rolId: s.operador.id, accionClave: "caja_cerrar_sesion", anterior: CON_TODO, nuevo: SIN_PERMISO }]);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await fila("caja_cerrar_sesion")).toEqual(SIN_PERMISO);
  });

  it("Server Action real: el empleado con la fila abre la caja y no puede iniciar el cierre sin `caja_cerrar_sesion`; el gerente se la da y la Server Action pasa", async () => {
    await como(gerente);
    expect((await pedirLaFila("caja_abrir_sesion")).ok).toBe(true);
    await como(empleado);
    const abierta = await abrirSesionDeCaja({ claveIdempotencia: randomUUID(), fondo: "0" });
    expect(abierta, JSON.stringify(abierta)).toMatchObject({ ok: true });

    const sesionId = abierta.sesionId!;
    const antes = await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: sesionId } });
    expect(await iniciarCierreDeSesionDeCaja({ sesionId })).toMatchObject({ ok: false, mensaje: expect.stringMatching(/permiso|acceso|No tenés|no tiene/i) });
    expect((await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: sesionId } })).estado).toBe(antes.estado);

    await como(gerente);
    expect((await pedirLaFila("caja_cerrar_sesion")).ok).toBe(true);
    await como(empleado);
    expect(await iniciarCierreDeSesionDeCaja({ sesionId })).toMatchObject({ ok: true });
  });
});

describe("PISOS-65: las 14 de gobierno y de gerente siguen cerradas, con el mensaje claro", () => {
  it.each(["ver_auditoria", "renombrar_rol", "traspasar_gerencia"])("dar «%s» a un rol de nivel operario devuelve el texto de gobierno, sin escribir ni auditar (ni siquiera el gerente puede)", async (clave) => {
    for (const quien of [gerente, administrador]) {
      await como(quien);
      const auditoriaAntes = await auditoria();
      expect(await pedirLaFila(clave)).toEqual({ ok: false, mensaje: TEXTO_GOBIERNO });
      expect(await fila(clave)).toEqual(SIN_PERMISO);
      expect(await auditoria()).toBe(auditoriaAntes);
    }
  });
});

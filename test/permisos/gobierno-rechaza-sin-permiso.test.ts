import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prismaAdmin, EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { enElFuturo, DIA_MS } from "../setup/tiempo";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";
import { azarDelProceso } from "../../src/lib/azar";
import { textoDeDenegacion } from "../../src/core/permisos/motivos";
import { MENSAJE_PERMISOS_DE_PLATAFORMA } from "../../src/core/permisos/politica-de-empresa";
import type { AccionDeEmpresa, AccionDeSucursal } from "../../src/core/permisos/acciones";
import type { ResultadoAccion } from "../../src/server/actions/tipos";
import { actualizarCapacidad } from "../../src/server/actions/permisos/capacidades-sucursal";
import { actualizarActivoRol, crearRol, renombrarRol } from "../../src/server/actions/permisos/roles";
import { guardarPermisos } from "../../src/server/actions/permisos/permisos";
import { actualizarActivoSucursal, crearSucursalConAdmin, renombrarSucursal } from "../../src/server/actions/auth/sucursales";
import {
  actualizarActivoMembresia,
  actualizarActivoUsuarioEnEmpresa,
  actualizarNotasMembresia,
  agregarOActualizarUsuario,
  invitarAVincular,
  reenviarInvitacionPendiente,
  revocarInvitacion,
  transferirGerencia,
} from "../../src/server/actions/auth/usuarios";

/**
 * Red del Hito 3 (paso 0.3 de `docs/plan-hito-3-pureza.md`), ANTES de mover las 16 mutaciones de auth y permisos a casos de uso (Fase I):
 * cada una rechaza a quien no tiene el permiso y, al rechazar, no cambia NINGUNA tabla de gobierno. Tres actores:
 *   - el `operador` de fábrica (sin la fila de la matriz);
 *   - un rol PROPIO que tiene la fila (Ver y Editar) de las 13 claves pero está bajo el piso (`administrador`, o `gerente` para traspasar la gerencia): el piso
 *     manda sobre la fila (`decision-de-acceso.ts`), así que la fila sola no da acceso;
 *   - un admin con la política de plataforma apagada (`Empresa.permisosEditables = false`, ADR-008): las 4 de `conEdicionDePermisos` rechazan con el mensaje de la
 *     plataforma. Y un admin que no es gerente no traspasa la gerencia.
 * Antes de este test no tenían test de rechazo `actualizarCapacidad`, `renombrarRol` (política apagada), `crearSucursalConAdmin`, `reenviarInvitacionPendiente`,
 * `revocarInvitacion` e `invitarAVincular`.
 *
 * Los argumentos apuntan a filas REALES (la membresía, la invitación, el rol y la sucursal existen): sin el guard, cada llamada escribiría. Por eso un envoltorio
 * que se cae (o se cambia por otro que no gatea igual) pone este test en rojo por dos lados: el mensaje deja de ser el del guard y la foto de las tablas cambia.
 */

interface Escenario {
  rolPropioId: string;
  rolSinUsuariosId: string;
  operadorRolId: string;
  sucursalCentral: string;
  sucursalNorte: string;
  admin: { id: string; email: string };
  adminNoGerente: { id: string; email: string };
  objetivo: { id: string; email: string };
  membresiaObjetivo: string;
  invitacionId: string;
}

interface Mutacion {
  nombre: string;
  clave: AccionDeSucursal | AccionDeEmpresa;
  contexto: "sucursal" | "empresa" | "gerente";
  /** La envuelve `conEdicionDePermisos` (además del permiso, la política de plataforma). */
  edicionDePermisos: boolean;
  llamar: (e: Escenario) => Promise<ResultadoAccion>;
}

const SIN_CAMBIO = { puedeVer: false, puedeEditar: false };

const MUTACIONES: Mutacion[] = [
  { nombre: "actualizarCapacidad", clave: "capacidades_sucursal", contexto: "empresa", edicionDePermisos: false, llamar: () => actualizarCapacidad("proceso_venta", null, false) },
  { nombre: "crearRol", clave: "gestion_roles", contexto: "empresa", edicionDePermisos: true, llamar: () => crearRol("cajero") },
  { nombre: "renombrarRol", clave: "renombrar_rol", contexto: "empresa", edicionDePermisos: true, llamar: (e) => renombrarRol(e.rolSinUsuariosId, "cajero") },
  { nombre: "actualizarActivoRol", clave: "gestion_roles", contexto: "empresa", edicionDePermisos: true, llamar: (e) => actualizarActivoRol(e.rolSinUsuariosId, false) },
  {
    nombre: "guardarPermisos",
    clave: "gestion_permisos",
    contexto: "empresa",
    edicionDePermisos: true,
    llamar: (e) => guardarPermisos([{ rolId: e.rolSinUsuariosId, accionClave: "proceso_venta", anterior: SIN_CAMBIO, nuevo: { puedeVer: true, puedeEditar: true } }]),
  },
  { nombre: "crearSucursalConAdmin", clave: "alta_sucursal", contexto: "empresa", edicionDePermisos: false, llamar: (e) => crearSucursalConAdmin({ nombre: "Sur", emailPrimerAdmin: e.admin.email }) },
  { nombre: "actualizarActivoSucursal", clave: "activar_sucursal", contexto: "empresa", edicionDePermisos: false, llamar: (e) => actualizarActivoSucursal(e.sucursalNorte, false) },
  { nombre: "renombrarSucursal", clave: "renombrar_sucursal", contexto: "empresa", edicionDePermisos: false, llamar: (e) => renombrarSucursal(e.sucursalNorte, "Oeste") },
  {
    nombre: "agregarOActualizarUsuario",
    clave: "gestion_usuarios",
    contexto: "sucursal",
    edicionDePermisos: false,
    llamar: (e) => agregarOActualizarUsuario({ email: e.objetivo.email, sucursalId: e.sucursalCentral, rolId: e.rolSinUsuariosId }),
  },
  { nombre: "actualizarActivoMembresia", clave: "activar_usuario_sucursal", contexto: "sucursal", edicionDePermisos: false, llamar: (e) => actualizarActivoMembresia(e.membresiaObjetivo, false) },
  { nombre: "actualizarNotasMembresia", clave: "notas_usuario_sucursal", contexto: "sucursal", edicionDePermisos: false, llamar: (e) => actualizarNotasMembresia(e.membresiaObjetivo, "nota nueva") },
  { nombre: "actualizarActivoUsuarioEnEmpresa", clave: "apagar_cuenta_empresa", contexto: "empresa", edicionDePermisos: false, llamar: (e) => actualizarActivoUsuarioEnEmpresa(e.objetivo.id, false) },
  { nombre: "transferirGerencia", clave: "traspasar_gerencia", contexto: "gerente", edicionDePermisos: false, llamar: (e) => transferirGerencia(e.adminNoGerente.id, e.adminNoGerente.email) },
  { nombre: "reenviarInvitacionPendiente", clave: "gestion_usuarios", contexto: "sucursal", edicionDePermisos: false, llamar: (e) => reenviarInvitacionPendiente(e.invitacionId) },
  { nombre: "revocarInvitacion", clave: "gestion_usuarios", contexto: "sucursal", edicionDePermisos: false, llamar: (e) => revocarInvitacion(e.invitacionId) },
  { nombre: "invitarAVincular", clave: "gestion_usuarios", contexto: "sucursal", edicionDePermisos: false, llamar: (e) => invitarAVincular(e.membresiaObjetivo) },
];

/** El texto exacto del guard para un rol sin la acción (o bajo su piso): el rechazo viene del envoltorio, no de una validación posterior. */
function mensajeDelGuard(m: Mutacion, nombreDelRol: string): string {
  if (m.contexto === "gerente") return textoDeDenegacion({ motivo: "SIN_PERMISO", caso: "SOLO_GERENTE", para: "editar" });
  if (m.contexto === "sucursal") return textoDeDenegacion({ motivo: "SIN_PERMISO", caso: "ROL_SIN_LA_ACCION", para: "editar", accion: m.clave, rol: nombreDelRol });
  return textoDeDenegacion({ motivo: "SIN_PERMISO", caso: "ROLES_SIN_LA_ACCION", para: "editar", accion: m.clave, roles: [nombreDelRol] });
}

/** Foto completa de las tablas de gobierno (y de lo que tocan las 16 mutaciones), por id: una actualización que no cambia conteos también se ve. */
async function fotoDeGobierno() {
  const porId = { orderBy: { id: "asc" as const } };
  return {
    rol: await prismaAdmin.rol.findMany(porId),
    permisoRol: await prismaAdmin.permisoRol.findMany(porId),
    capacidadSucursal: await prismaAdmin.capacidadSucursal.findMany(porId),
    sucursal: await prismaAdmin.sucursal.findMany(porId),
    disponibilidadProducto: await prismaAdmin.disponibilidadProducto.findMany(porId),
    user: await prismaAdmin.user.findMany(porId),
    usuarioEmpresa: await prismaAdmin.usuarioEmpresa.findMany(porId),
    usuarioSucursal: await prismaAdmin.usuarioSucursal.findMany(porId),
    invitacion: await prismaAdmin.invitacion.findMany(porId),
    invitacionSucursal: await prismaAdmin.invitacionSucursal.findMany(porId),
    registroAuditoria: await prismaAdmin.registroAuditoria.findMany(porId),
    empresa: await prismaAdmin.empresa.findMany(porId),
  };
}

let e: Escenario;
let operador: { id: string; email: string };
let conRolPropio: { id: string; email: string };
const NOMBRE_ROL_PROPIO = "encargado";

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  const sucursalNorte = (await prismaAdmin.sucursal.create({ data: { nombre: "Norte", empresaId: EMPRESA_POR_DEFECTO_ID } })).id;

  // El gerente es el admin principal; hay otro admin (no gerente) como destino de la gerencia.
  const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  await crearMembresia({ usuarioId: admin.id, sucursalId: sucursalNorte, rolId: base.admin.id });
  await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: admin.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
  const adminNoGerente = await crearUsuarioConMembresia({ email: "admin2@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });

  // Un rol propio (sin clave: nivel operario) con la fila de las 13 claves: está bajo el piso de todas.
  const rolPropio = await prismaAdmin.rol.create({ data: { nombre: NOMBRE_ROL_PROPIO, empresaId: EMPRESA_POR_DEFECTO_ID } });
  const claves = [...new Set(MUTACIONES.map((m) => m.clave))];
  await prismaAdmin.permisoRol.createMany({ data: claves.map((accionClave) => ({ rolId: rolPropio.id, accionClave, puedeVer: true, puedeEditar: true, empresaId: EMPRESA_POR_DEFECTO_ID })) });
  // Un rol sin usuarios: el que renombrar, apagar o editar en la matriz (sin el guard, esas tres escribirían).
  const rolSinUsuarios = await prismaAdmin.rol.create({ data: { nombre: "mozo", empresaId: EMPRESA_POR_DEFECTO_ID } });

  operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
  conRolPropio = await crearUsuarioConMembresia({ email: "encargado@test.com", sucursalId: base.sucursal.id, rolId: rolPropio.id });

  // El objetivo de las mutaciones de usuarios: un miembro sin cuenta de Google (precargado), y una invitación de usuario PENDIENTE de la Central.
  const objetivo = await crearUsuarioConMembresia({ email: "objetivo@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
  const membresiaObjetivo = (await prismaAdmin.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: objetivo.id } })).id;
  const invitacion = await prismaAdmin.invitacion.create({
    data: {
      empresaId: EMPRESA_POR_DEFECTO_ID,
      email: "nueva@test.com",
      rolEmpresa: "usuario",
      hashToken: hashDeToken(generarTokenOpaco(azarDelProceso)),
      venceEn: enElFuturo(7 * DIA_MS),
      invitadoPorId: admin.id,
    },
  });
  await prismaAdmin.invitacionSucursal.create({
    data: { empresaId: EMPRESA_POR_DEFECTO_ID, invitacionId: invitacion.id, sucursalId: base.sucursal.id, rolId: base.operador.id, invitadoPorId: admin.id },
  });

  e = {
    rolPropioId: rolPropio.id,
    rolSinUsuariosId: rolSinUsuarios.id,
    operadorRolId: base.operador.id,
    sucursalCentral: base.sucursal.id,
    sucursalNorte,
    admin,
    adminNoGerente,
    objetivo,
    membresiaObjetivo,
    invitacionId: invitacion.id,
  };
});

describe("las 16 mutaciones de gobierno rechazan sin el permiso y no cambian ninguna tabla", () => {
  it("la lista son las 16 (una por mutación de auth/permisos)", () => {
    expect(MUTACIONES).toHaveLength(16);
    expect(new Set(MUTACIONES.map((m) => m.nombre)).size).toBe(16);
  });

  it.each(MUTACIONES.map((m) => [m.nombre, m] as const))("operador de fábrica: %s rechaza con el mensaje del guard", async (_n, m) => {
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const antes = await fotoDeGobierno();
    expect(await m.llamar(e)).toEqual({ ok: false, mensaje: mensajeDelGuard(m, "operador") });
    expect(await fotoDeGobierno()).toEqual(antes);
  });

  it.each(MUTACIONES.map((m) => [m.nombre, m] as const))("rol propio con la fila pero bajo el piso: %s rechaza (el piso manda sobre la fila)", async (_n, m) => {
    await mockearUsuarioActual({ id: conRolPropio.id, email: conRolPropio.email, nombre: null });
    const antes = await fotoDeGobierno();
    expect(await m.llamar(e)).toEqual({ ok: false, mensaje: mensajeDelGuard(m, NOMBRE_ROL_PROPIO) });
    expect(await fotoDeGobierno()).toEqual(antes);
  });

  it.each(MUTACIONES.filter((m) => m.edicionDePermisos).map((m) => [m.nombre, m] as const))(
    "admin con la política de plataforma apagada: %s rechaza con el mensaje de la plataforma",
    async (_n, m) => {
      await prismaAdmin.empresa.update({ where: { id: EMPRESA_POR_DEFECTO_ID }, data: { permisosEditables: false } });
      await mockearUsuarioActual({ id: e.admin.id, email: e.admin.email, nombre: null });
      const antes = await fotoDeGobierno();
      expect(await m.llamar(e)).toEqual({ ok: false, mensaje: MENSAJE_PERMISOS_DE_PLATAFORMA });
      expect(await fotoDeGobierno()).toEqual(antes);
    }
  );

  it("las 4 de la política son exactamente las de `conEdicionDePermisos` (crear, renombrar y apagar rol; guardar la matriz)", () => {
    expect(MUTACIONES.filter((m) => m.edicionDePermisos).map((m) => m.nombre)).toEqual(["crearRol", "renombrarRol", "actualizarActivoRol", "guardarPermisos"]);
  });

  it("un admin que no es gerente no traspasa la gerencia", async () => {
    await mockearUsuarioActual({ id: e.adminNoGerente.id, email: e.adminNoGerente.email, nombre: null });
    const m = MUTACIONES.find((x) => x.nombre === "transferirGerencia")!;
    const antes = await fotoDeGobierno();
    expect(await transferirGerencia(e.admin.id, e.admin.email)).toEqual({ ok: false, mensaje: mensajeDelGuard(m, "admin") });
    expect(await fotoDeGobierno()).toEqual(antes);
  });
});

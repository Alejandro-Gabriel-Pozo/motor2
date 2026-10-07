import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { aceptarInvitacionDeGerenteCasoDeUso as aceptarInvitacionDelToken } from "../../src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente";
import { MENSAJE_ENLACE_NO_VALIDO } from "../../src/core/features/empresa/aceptar-invitacion";
import { sembrarEmpresa } from "../../plataforma/src/servidor/sembrar-empresa";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";
import { azarDelProceso } from "../../src/lib/azar";

/**
 * E5 (ADR-020), aceptar la invitación del primer gerente contra Postgres real, como `motor2_app` (el rol de ejecución) bajo la empresa de la invitación.
 * La empresa se prepara como la deja el alta de la consola: PROVISIONING, sembrada, con su primera sucursal, sin gerente ni CUIT.
 */
const EMPRESA = "nueva-en-alta";
const EMAIL = "dueno@gmail.com";
const CUIT_VALIDO = "30-71234567-1";

async function prepararEmpresaEnAlta(id = EMPRESA, slug = "nueva-en-alta") {
  await prismaAdmin.empresa.create({ data: { id, nombre: `Empresa ${slug}`, slug, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
  await prismaAdmin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${id}, true)`;
    await sembrarEmpresa(tx, id, "Central");
  });
}

async function invitar(empresaId = EMPRESA, email = EMAIL, venceEn = new Date(Date.now() + 3_600_000)) {
  const token = generarTokenOpaco(azarDelProceso);
  await prismaAdmin.invitacion.create({ data: { empresaId, email, rolEmpresa: "gerente", hashToken: hashDeToken(token), venceEn } });
  return token;
}

async function usuario(email = EMAIL) {
  return prismaAdmin.user.upsert({ where: { email }, update: {}, create: { email } });
}

const aceptar = async (token: string, cuit: unknown = CUIT_VALIDO, email = EMAIL) => {
  const u = await usuario(email);
  return aceptarInvitacionDelToken({ token, usuario: { id: u.id, email }, cuit, ahora: new Date() });
};

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prepararEmpresaEnAlta();
});

describe("aceptar la invitación", () => {
  it("deja al invitado como gerente y admin de la primera sucursal, guarda el CUIT en la invitación y la empresa sigue en alta", async () => {
    const token = await invitar();
    const r = await aceptar(token);
    expect(r).toMatchObject({ ok: true, empresaId: EMPRESA });

    const u = await prismaAdmin.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await prismaAdmin.usuarioEmpresa.findUniqueOrThrow({ where: { usuarioId_empresaId: { usuarioId: u.id, empresaId: EMPRESA } } })).toMatchObject({ rolEmpresa: "gerente", activo: true });
    const membresia = await prismaAdmin.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: u.id, empresaId: EMPRESA }, include: { rol: true, sucursal: true } });
    expect(membresia).toMatchObject({ activo: true });
    expect(membresia.rol.clave).toBe("admin");
    expect(membresia.sucursal.nombre).toBe("Central");

    const inv = await prismaAdmin.invitacion.findUniqueOrThrow({ where: { hashToken: hashDeToken(token) } });
    expect(inv).toMatchObject({ estado: "ACEPTADA", aceptadaPorId: u.id, cuitDeclarado: "30712345671" });
    expect(inv.aceptadaEn).toBeInstanceOf(Date);

    const empresa = await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: EMPRESA } });
    expect(empresa).toMatchObject({ estado: "PROVISIONING", cuit: null });
  });

  it("deja rastro en la auditoría de la empresa con el nuevo gerente como actor", async () => {
    await aceptar(await invitar());
    const u = await prismaAdmin.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const filas = await prismaAdmin.registroAuditoria.findMany({ where: { empresaId: EMPRESA }, orderBy: { creadoEn: "asc" } });
    expect(filas.map((f) => f.entidad).sort()).toEqual(["UsuarioEmpresa", "UsuarioSucursal"]);
    for (const f of filas) expect(f.actorId).toBe(u.id);
  });

  it("el enlace es de un solo uso: la segunda vez no sirve, y no duplica nada", async () => {
    const token = await invitar();
    expect((await aceptar(token)).ok).toBe(true);
    expect(await aceptar(token)).toEqual({ ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO });
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { empresaId: EMPRESA } })).toBe(1);
  });

  it("dos aceptaciones simultáneas: gana una sola", async () => {
    const token = await invitar();
    await usuario(); // el alta del usuario no es parte de la carrera
    const resultados = await Promise.all([aceptar(token), aceptar(token), aceptar(token)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { empresaId: EMPRESA, rolEmpresa: "gerente" } })).toBe(1);
    expect(await prismaAdmin.invitacion.count({ where: { estado: "ACEPTADA" } })).toBe(1);
  });

  it("con el CUIT mal escrito o vacío no acepta y la invitación sigue pendiente", async () => {
    const token = await invitar();
    for (const malo of ["", "30-71234567-4", "123", "abc"]) {
      const r = await aceptar(token, malo);
      expect(r.ok, String(malo)).toBe(false);
    }
    expect((await prismaAdmin.invitacion.findUniqueOrThrow({ where: { hashToken: hashDeToken(token) } })).estado).toBe("PENDIENTE");
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { empresaId: EMPRESA } })).toBe(0);
  });

  it("con un CUIT que ya tiene otra empresa no acepta, y el mensaje no nombra a la otra", async () => {
    await prismaAdmin.empresa.create({ data: { id: "otra", nombre: "Empresa Secreta SA", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE", cuit: "30712345671" } });
    const r = await aceptar(await invitar());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("Secreta");
  });

  it("con otro email no acepta aunque el token sea el correcto", async () => {
    const token = await invitar();
    const r = await aceptar(token, CUIT_VALIDO, "intruso@gmail.com");
    expect(r.ok).toBe(false);
    expect((await prismaAdmin.invitacion.findUniqueOrThrow({ where: { hashToken: hashDeToken(token) } })).estado).toBe("PENDIENTE");
  });

  it("no acepta si venció, si fue revocada o si la empresa ya no está en alta", async () => {
    expect(await aceptar(await invitar(EMPRESA, EMAIL, new Date(Date.now() - 1000)))).toEqual({ ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO });

    await prismaAdmin.invitacion.deleteMany();
    const revocada = await invitar();
    await prismaAdmin.invitacion.update({ where: { hashToken: hashDeToken(revocada) }, data: { estado: "REVOCADA", revocadaEn: new Date() } });
    expect(await aceptar(revocada)).toEqual({ ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO });

    const vigente = await invitar();
    await prismaAdmin.empresa.update({ where: { id: EMPRESA }, data: { estado: "SUSPENDED" } });
    expect(await aceptar(vigente)).toEqual({ ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO });
  });

  it("un token inventado o mal formado no acepta", async () => {
    await invitar();
    expect(await aceptar(generarTokenOpaco(azarDelProceso))).toEqual({ ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO });
    expect(await aceptar("corto")).toEqual({ ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO });
  });

  it("un usuario que ya existe en otra empresa sigue siendo de ella y suma esta como gerente", async () => {
    await prepararEmpresaEnAlta("segunda", "segunda");
    const existente = await usuario();
    await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: existente.id, empresaId: "segunda", rolEmpresa: null } });
    expect((await aceptar(await invitar())).ok).toBe(true);
    const pertenencias = await prismaAdmin.usuarioEmpresa.findMany({ where: { usuarioId: existente.id }, orderBy: { empresaId: "asc" } });
    expect(pertenencias.map((p) => [p.empresaId, p.rolEmpresa])).toEqual([[EMPRESA, "gerente"], ["segunda", null]]);
  });

  it("si el invitado ya tenía una cuenta APAGADA en esta empresa (y una membresía apagada de operador en la primera sucursal), aceptar la reactiva: gerente y admin activos", async () => {
    // Hueco de cobertura informado en la Fase II (`incorporarPrimerGerente`, Hito 3): sin este caso, sacar el `activo: true` del upsert de la cuenta en la
    // empresa (o de la membresía) no ponía ningún test en rojo. Un gerente con la cuenta apagada no entraría a la empresa que le acaban de dar.
    const existente = await usuario();
    await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: existente.id, empresaId: EMPRESA, rolEmpresa: null, activo: false } });
    const central = await prismaAdmin.sucursal.findFirstOrThrow({ where: { empresaId: EMPRESA, nombre: "Central" } });
    const operador = await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: EMPRESA, clave: "operador" } });
    await prismaAdmin.usuarioSucursal.create({ data: { usuarioId: existente.id, sucursalId: central.id, empresaId: EMPRESA, rolId: operador.id, activo: false } });

    expect((await aceptar(await invitar())).ok).toBe(true);

    expect(await prismaAdmin.usuarioEmpresa.findUniqueOrThrow({ where: { usuarioId_empresaId: { usuarioId: existente.id, empresaId: EMPRESA } } })).toMatchObject({ rolEmpresa: "gerente", activo: true });
    const membresia = await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { usuarioId_sucursalId: { usuarioId: existente.id, sucursalId: central.id } }, include: { rol: true } });
    expect(membresia).toMatchObject({ activo: true });
    expect(membresia.rol.clave).toBe("admin");
  });

  it("si la empresa ya tiene gerente, deshace todo y la invitación queda pendiente", async () => {
    const otro = await prismaAdmin.user.create({ data: { email: "otro@gmail.com" } });
    await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: otro.id, empresaId: EMPRESA, rolEmpresa: "gerente" } });
    const token = await invitar();
    const r = await aceptar(token);
    expect(r.ok).toBe(false);
    expect((await prismaAdmin.invitacion.findUniqueOrThrow({ where: { hashToken: hashDeToken(token) } })).estado).toBe("PENDIENTE");
  });
});

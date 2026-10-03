import { beforeEach, describe, expect, it } from "vitest";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin, sembrarBase } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import type { Transaccion } from "../../src/lib/db-tipos";
import { conTransaccionSerializable } from "../../src/core/movimientos/con-reintento";
import {
  conInvariantesDeGobierno,
  contarAdminsEfectivos,
  contarUsuariosActivosDelRol,
  esAdminEfectivoEnAlgunaSucursal,
  InvarianteViolada,
  invarianteGerenteConSucursalActiva,
  invarianteGerenteEsAdminEfectivo,
  invarianteQuedaUnAdmin,
  invarianteRolDeSistemaIntacto,
  invarianteRolSinUsuariosActivos,
  medirEstadoDeGobierno,
  MENSAJE_GERENTE_DEJA_DE_SER_ADMIN,
  MENSAJE_GERENTE_SIN_SUCURSAL,
  MENSAJE_SIN_ADMIN_ACTIVO,
  type EstadoDeGobierno,
} from "../../src/core/permisos/invariantes";

const EMPRESA = EMPRESA_POR_DEFECTO_ID;
const gerenteSano = { conSucursalActiva: true, adminEfectivo: true };

function estado(adminsEfectivos: number, gerente: EstadoDeGobierno["gerente"] = null): EstadoDeGobierno {
  return { adminsEfectivos, gerente };
}

describe("las invariantes de estado: solo rechazan lo que EMPEORA", () => {
  it("(a) estaba bien y queda en cero → rechaza; ya estaba en cero → no traba el arreglo; queda alguien → pasa", () => {
    expect(invarianteQuedaUnAdmin(estado(1), estado(0))).toBe(MENSAJE_SIN_ADMIN_ACTIVO);
    expect(invarianteQuedaUnAdmin(estado(0), estado(0))).toBeNull();
    expect(invarianteQuedaUnAdmin(estado(2), estado(1))).toBeNull();
    expect(invarianteQuedaUnAdmin(estado(0), estado(1))).toBeNull();
  });

  it("(b) el gerente pierde su última sucursal activa → rechaza; sin gerente o ya sin sucursal → pasa", () => {
    expect(invarianteGerenteConSucursalActiva(estado(1, gerenteSano), estado(1, { ...gerenteSano, conSucursalActiva: false }))).toBe(MENSAJE_GERENTE_SIN_SUCURSAL);
    expect(invarianteGerenteConSucursalActiva(estado(1), estado(1))).toBeNull();
    const yaSin = { conSucursalActiva: false, adminEfectivo: false };
    expect(invarianteGerenteConSucursalActiva(estado(1, yaSin), estado(1, yaSin))).toBeNull();
  });

  it("(f) el gerente deja de ser admin efectivo → rechaza y dice que traspase primero", () => {
    const mensaje = invarianteGerenteEsAdminEfectivo(estado(2, gerenteSano), estado(2, { ...gerenteSano, adminEfectivo: false }));
    expect(mensaje).toBe(MENSAJE_GERENTE_DEJA_DE_SER_ADMIN);
    expect(mensaje).toMatch(/traspasá la gerencia/);
    expect(invarianteGerenteEsAdminEfectivo(estado(2, { conSucursalActiva: true, adminEfectivo: false }), estado(2, { conSucursalActiva: true, adminEfectivo: false }))).toBeNull();
  });
});

describe("(c) rol de sistema y (e) rol con usuarios", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
  });

  it("(c) todo rol con clave está protegido —«admin» y «operador»—, uno sin clave no", async () => {
    const mozo = await prismaAdmin.rol.create({ data: { nombre: "mozo" } });
    expect(invarianteRolDeSistemaIntacto(base.admin)).not.toBeNull();
    expect(invarianteRolDeSistemaIntacto(base.operador)).not.toBeNull();
    expect(invarianteRolDeSistemaIntacto(mozo)).toBeNull();
  });

  it("(c) un rol que solo se LLAMA «admin», sin clave, no es de sistema", async () => {
    const impostor = await prismaAdmin.rol.create({ data: { nombre: "Admin2" } });
    expect(invarianteRolDeSistemaIntacto({ clave: impostor.clave })).toBeNull();
  });

  it("(e) definición amplia: cuenta toda membresía activa del rol, aunque su sucursal esté apagada o su cuenta global también", async () => {
    const mozo = await prismaAdmin.rol.create({ data: { nombre: "mozo" } });
    expect(await invarianteRolSinUsuariosActivos(prismaAdmin, mozo)).toBeNull();

    const apagada = await prismaAdmin.sucursal.create({ data: { nombre: "Apagada", activo: false } });
    const u = await crearUsuarioConMembresia({ email: "mozo@test.com", sucursalId: apagada.id, rolId: mozo.id });
    await prismaAdmin.user.update({ where: { id: u.id }, data: { activoGlobal: false } });

    expect(await contarUsuariosActivosDelRol(prismaAdmin, mozo.id)).toBe(1);
    expect(await invarianteRolSinUsuariosActivos(prismaAdmin, mozo)).toMatch(/todavía hay usuarios activos/);

    await prismaAdmin.usuarioSucursal.updateMany({ where: { rolId: mozo.id }, data: { activo: false } });
    expect(await invarianteRolSinUsuariosActivos(prismaAdmin, mozo)).toBeNull();
  });
});

describe("D1: «admin efectivo» es estricto", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  let adminId: string;
  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
  });

  it("un admin sano cuenta", async () => {
    expect(await contarAdminsEfectivos(prismaAdmin, EMPRESA)).toBe(1);
    expect(await esAdminEfectivoEnAlgunaSucursal(prismaAdmin, EMPRESA, adminId)).toBe(true);
  });

  const APAGADORES: Array<[string, () => Promise<unknown>]> = [
    ["membresía desactivada", () => prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: adminId }, data: { activo: false } })],
    ["rol «admin» desactivado", () => prismaAdmin.rol.update({ where: { id: base.admin.id }, data: { activo: false } })],
    ["sucursal desactivada", () => prismaAdmin.sucursal.update({ where: { id: base.sucursal.id }, data: { activo: false } })],
    ["pertenencia a la empresa desactivada", () => prismaAdmin.usuarioEmpresa.updateMany({ where: { usuarioId: adminId }, data: { activo: false } })],
    ["cuenta global desactivada", () => prismaAdmin.user.update({ where: { id: adminId }, data: { activoGlobal: false } })],
    ["empresa suspendida", () => prismaAdmin.empresa.update({ where: { id: EMPRESA }, data: { estado: "SUSPENDED" } })],
  ];
  for (const [nombre, apagar] of APAGADORES) {
    it(`no cuenta con ${nombre}`, async () => {
      await apagar();
      expect(await contarAdminsEfectivos(prismaAdmin, EMPRESA)).toBe(0);
      expect(await esAdminEfectivoEnAlgunaSucursal(prismaAdmin, EMPRESA, adminId)).toBe(false);
    });
  }

  it("un rol llamado «admin» pero sin la clave «admin» no cuenta (la identidad es la clave)", async () => {
    await prismaAdmin.rol.update({ where: { id: base.admin.id }, data: { clave: null } });
    expect(await contarAdminsEfectivos(prismaAdmin, EMPRESA)).toBe(0);
  });

  it("el caso del informe: A y B admins, la cuenta de B está apagada → A no puede dejar de ser admin", async () => {
    const b = await crearUsuarioConMembresia({ email: "b@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prismaAdmin.user.update({ where: { id: b.id }, data: { activoGlobal: false } });

    await expect(
      prismaAdmin.$transaction((tx) =>
        conInvariantesDeGobierno(tx, EMPRESA, () => tx.usuarioSucursal.updateMany({ where: { usuarioId: adminId }, data: { rolId: base.operador.id } })),
      ),
    ).rejects.toBeInstanceOf(InvarianteViolada);
    expect(await prismaAdmin.usuarioSucursal.count({ where: { usuarioId: adminId, rolId: base.admin.id } })).toBe(1);
  });
});

describe("conInvariantesDeGobierno", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
  });

  it("una empresa que YA estaba sin admin efectivo no queda trabada: se puede dar de alta al primero", async () => {
    const u = await crearUsuarioConMembresia({ email: "op@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await prismaAdmin.$transaction((tx) =>
      conInvariantesDeGobierno(tx, EMPRESA, () => tx.usuarioSucursal.updateMany({ where: { usuarioId: u.id }, data: { rolId: base.admin.id } })),
    );
    expect(await contarAdminsEfectivos(prismaAdmin, EMPRESA)).toBe(1);
  });

  it("D3: el gerente con una membresía en una sucursal APAGADA y otra activa no puede apagar la activa", async () => {
    const apagada = await prismaAdmin.sucursal.create({ data: { nombre: "Apagada", activo: false } });
    const otro = await crearUsuarioConMembresia({ email: "otro@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const gerente = await crearUsuarioConMembresia({ email: "g@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await crearMembresia({ usuarioId: gerente.id, sucursalId: apagada.id, rolId: base.operador.id });
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: EMPRESA } }, data: { rolEmpresa: "gerente" } });
    expect(otro.id).toBeTruthy();

    const antes = await medirEstadoDeGobierno(prismaAdmin, EMPRESA);
    expect(antes.gerente).toEqual({ conSucursalActiva: true, adminEfectivo: false });

    await expect(
      prismaAdmin.$transaction((tx) =>
        conInvariantesDeGobierno(tx, EMPRESA, () => tx.usuarioSucursal.updateMany({ where: { usuarioId: gerente.id, sucursalId: base.sucursal.id }, data: { activo: false } })),
      ),
    ).rejects.toThrow(MENSAJE_GERENTE_SIN_SUCURSAL);
  });

  it("Q1: el gerente admin en su única sucursal no puede bajarse a operador; con admin en otra sucursal activa, sí", async () => {
    const otra = await prismaAdmin.sucursal.create({ data: { nombre: "Otra" } });
    await crearUsuarioConMembresia({ email: "otro@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const gerente = await crearUsuarioConMembresia({ email: "g@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: EMPRESA } }, data: { rolEmpresa: "gerente" } });
    const bajarse = () =>
      prismaAdmin.$transaction((tx) =>
        conInvariantesDeGobierno(tx, EMPRESA, () => tx.usuarioSucursal.updateMany({ where: { usuarioId: gerente.id, sucursalId: base.sucursal.id }, data: { rolId: base.operador.id } })),
      );

    await expect(bajarse()).rejects.toThrow(MENSAJE_GERENTE_DEJA_DE_SER_ADMIN);

    await crearMembresia({ usuarioId: gerente.id, sucursalId: otra.id, rolId: base.admin.id });
    await bajarse();
    expect(await esAdminEfectivoEnAlgunaSucursal(prismaAdmin, EMPRESA, gerente.id)).toBe(true);
  });

  it("D2: dos admins que se desactivan a la vez no pueden dejar la empresa sin admin (serializable con reintento)", async () => {
    const a = await crearUsuarioConMembresia({ email: "a@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const b = await crearUsuarioConMembresia({ email: "b@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const transaccion: Transaccion = (fn, opciones) => prismaAdmin.$transaction(fn, opciones);
    const desactivar = (usuarioId: string) =>
      conTransaccionSerializable(
        transaccion,
        (tx) => conInvariantesDeGobierno(tx, EMPRESA, () => tx.usuarioSucursal.updateMany({ where: { usuarioId }, data: { activo: false } })),
        5,
        { baseEsperaMs: 1, topeEsperaMs: 5 },
      );

    const resultados = await Promise.allSettled([desactivar(a.id), desactivar(b.id)]);

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rechazado = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rechazado.reason).toBeInstanceOf(InvarianteViolada);
    expect(await contarAdminsEfectivos(prismaAdmin, EMPRESA)).toBe(1);
  });
});

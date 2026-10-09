import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * La hora que fija el envoltorio (`ctx.ahora`), como en `usuarios-hora-del-pedido.test.ts`: el guard es el REAL; solo se reemplaza la hora que `conPermiso` le entrega a la
 * acción. Hace falta para reenviar varias veces sin esperar el minuto de espera entre reenvíos.
 */
const reloj = vi.hoisted(() => ({ fija: null as Date | null }));
vi.mock("../../src/server/actions/con-permiso", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/actions/con-permiso")>();
  const conLaHoraFija =
    <C extends { ahora: Date }, R>(fn: (ctx: C) => Promise<R>) =>
    (ctx: C) =>
      fn(reloj.fija ? { ...ctx, ahora: reloj.fija } : ctx);
  return {
    ...real,
    conPermiso: ((clave, fn) => real.conPermiso(clave, conLaHoraFija(fn))) as typeof real.conPermiso,
    conPermisoDeEmpresa: ((clave, fn) => real.conPermisoDeEmpresa(clave, conLaHoraFija(fn))) as typeof real.conPermisoDeEmpresa,
  };
});

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { HORA_MS, MINUTO_MS, enElPasado } from "../setup/tiempo";
import { enviadorEnMemoriaDelCanal } from "../../src/core/correo/enviar";
import {
  CAMPO_DE_AUDITORIA_DEL_MAIL_DE_INVITACION,
  MAXIMO_DE_MAILS_DE_INVITACION_POR_DESTINATARIO_Y_DIA,
  MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA,
  claveDeDestinatarioDelCupo,
  descripcionDelMailDeInvitacion,
} from "../../src/core/features/empresa/cupo-de-correo";
import { cupoDeCorreoDeEmpresa } from "../../src/server/lecturas/auth/cupo-de-correo";
import { reservarMailDeInvitacion } from "../../src/server/actions/auth/casos-de-uso/invitaciones-de-usuario-en-tx";
import { agregarOActualizarUsuario, invitarAVincular, reenviarInvitacionPendiente } from "../../src/server/actions/auth/usuarios";

/**
 * S-21 (plan de endurecimiento de seguridad, T11): el cupo de correo `avisos` lo comparten TODAS las empresas y los códigos de ingreso de la consola. El único freno era uno por
 * minuto y por invitación (con carrera): una empresa podía mandar cientos de invitaciones. Ahora cada mail de invitación se RESERVA dentro de la transacción que lo origina
 * (cerrojo por empresa + una fila de auditoría por mail) y se rechaza al pasar el tope por empresa o por destinatario en 24 horas, sin crear ni rotar nada. Postgres real, por
 * las Server Actions (sesión mockeada, mail en memoria).
 */
const correo = enviadorEnMemoriaDelCanal("avisos");
let base: Awaited<ReturnType<typeof sembrarBase>>;
let admin: { id: string; email: string };

const MAILS = () => prismaAdmin.registroAuditoria.count({ where: { entidad: "UsuarioEmpresa", campo: CAMPO_DE_AUDITORIA_DEL_MAIL_DE_INVITACION } });
const alta = (email: string) => agregarOActualizarUsuario({ email, sucursalId: base.sucursal.id, rolId: base.operador.id });
const invitacionDe = (email: string) => prismaAdmin.invitacion.findFirstOrThrow({ where: { email }, orderBy: { creadaEn: "desc" } });

/** Deja `n` mails ya reservados hoy en la empresa dada (lo que dejarían `n` invitaciones), sin pasar por las acciones. */
async function reservarMailsDeAntes(empresaId: string, n: number, actorId: string) {
  await prismaAdmin.registroAuditoria.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      empresaId,
      entidad: "UsuarioEmpresa",
      entidadId: `invitacion-previa-${i}`,
      campo: CAMPO_DE_AUDITORIA_DEL_MAIL_DE_INVITACION,
      descripcion: descripcionDelMailDeInvitacion(`previa-${i}@ejemplo.com`),
      valorAnterior: null,
      valorNuevo: "usuario",
      actorId,
    })),
  });
}

beforeEach(async () => {
  reloj.fija = null;
  vi.stubEnv("AUTH_URL", "https://app.ejemplo.test");
  correo.vaciar();
  await limpiarBaseDeTest();
  base = await sembrarBase();
  admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
});

afterEach(() => {
  reloj.fija = null;
  vi.unstubAllEnvs();
});

describe("S-21: tope de mails de invitación por empresa", () => {
  it("EL ATAQUE: el gerente de la empresa agrega TOPE+1 emails distintos → el último se rechaza, sin mail ni invitación", async () => {
    const tope = MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA;
    for (let i = 0; i < tope; i++) {
      const r = await alta(`persona-${i}@ejemplo.com`);
      expect(r.ok, `alta ${i + 1}: ${r.mensaje}`).toBe(true);
    }
    expect(correo.enviados).toHaveLength(tope);

    const excedida = await alta("una-mas@ejemplo.com");
    expect(excedida.ok).toBe(false);
    expect(excedida.mensaje).toMatch(/Cupo de invitaciones agotado por hoy/);
    expect(correo.enviados).toHaveLength(tope);
    expect(await prismaAdmin.invitacion.count({ where: { email: "una-mas@ejemplo.com" } })).toBe(0);
    expect(await MAILS()).toBe(tope);
  }, 120_000);

  it("una empresa que agotó SU cupo no le saca el cupo a otra: la empresa de al lado tiene todos sus mails", async () => {
    await reservarMailsDeAntes(EMPRESA_TESTIGO_ID, MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA, admin.id);
    const r = await alta("nueva@ejemplo.com");
    expect(r.ok, r.mensaje).toBe(true);
    expect(correo.enviados).toHaveLength(1);
  });

  it("el contador cuenta solo la empresa pedida (aun leyendo con el dueño, que salta el RLS)", async () => {
    await reservarMailsDeAntes(EMPRESA_TESTIGO_ID, 7, admin.id);
    await reservarMailsDeAntes(EMPRESA_DE_PRUEBA_ID, 2, admin.id);
    const usados = await prismaAdmin.$transaction((tx) => cupoDeCorreoDeEmpresa(tx, { empresaId: EMPRESA_DE_PRUEBA_ID, destinatario: "previa-0@ejemplo.com", ahora: new Date() }));
    expect(usados).toEqual({ deLaEmpresa: 2, delDestinatario: 1 });
  });

  it("los mails de hace más de 24 horas ya no cuentan", async () => {
    await reservarMailsDeAntes(EMPRESA_DE_PRUEBA_ID, MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA, admin.id);
    // Se envejecen: salieron hace 25 horas.
    await prismaAdmin.registroAuditoria.updateMany({ where: { campo: CAMPO_DE_AUDITORIA_DEL_MAIL_DE_INVITACION }, data: { creadoEn: enElPasado(25 * HORA_MS) } });
    const r = await alta("nueva@ejemplo.com");
    expect(r.ok, r.mensaje).toBe(true);
  });

  it("EL BORDE CON CARRERA: queda UN lugar y ocho altas llegan a la vez → sale como mucho un mail y nunca se pasa el tope", async () => {
    await reservarMailsDeAntes(EMPRESA_DE_PRUEBA_ID, MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA - 1, admin.id);
    const resultados = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => alta(`carrera-${i}@ejemplo.com`)));
    expect(correo.enviados.length).toBeLessThanOrEqual(1);
    expect(correo.enviados.length, JSON.stringify(resultados.map((r) => (r.status === "fulfilled" ? r.value.mensaje : String(r.reason)))) ).toBe(1);
    expect(await MAILS()).toBe(MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA);
  }, 60_000);

  it("EL CERROJO por sí solo: con aislamiento común (no serializable) ocho reservas simultáneas en el borde dejan pasar UNA", async () => {
    // La transacción de gobierno es SERIALIZABLE y Postgres detecta el choque por su cuenta; el cerrojo por empresa tiene que bastar aunque algún día no lo sea.
    await reservarMailsDeAntes(EMPRESA_DE_PRUEBA_ID, MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA - 1, admin.id);
    const reservar = (i: number) =>
      prisma.$transaction((tx) =>
        reservarMailDeInvitacion(tx, { empresaId: EMPRESA_DE_PRUEBA_ID, invitacionId: `invitacion-carrera-${i}`, email: `carrera-${i}@ejemplo.com`, tipo: "usuario", actorId: admin.id, ahora: new Date() }),
      );
    const resultados = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => reservar(i)));
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await MAILS()).toBe(MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA);
  }, 60_000);
});

describe("S-21: tope de mails a un mismo destinatario (los reenvíos también cuentan)", () => {
  it("EL ATAQUE: alta y reenvíos a la misma persona → el cuarto mail del día se rechaza y el enlace vigente sigue sirviendo", async () => {
    const tope = MAXIMO_DE_MAILS_DE_INVITACION_POR_DESTINATARIO_Y_DIA;
    const inicio = enElPasado(2 * HORA_MS);
    reloj.fija = inicio;
    expect((await alta("victima@ejemplo.com")).ok).toBe(true);
    const inv = await invitacionDe("victima@ejemplo.com");
    for (let i = 1; i < tope; i++) {
      reloj.fija = new Date(inicio.getTime() + 2 * i * MINUTO_MS);
      const r = await reenviarInvitacionPendiente(inv.id);
      expect(r.ok, `reenvío ${i}: ${r.mensaje}`).toBe(true);
    }
    expect(correo.enviados).toHaveLength(tope);
    const hashAntes = (await invitacionDe("victima@ejemplo.com")).hashToken;

    reloj.fija = new Date(inicio.getTime() + 2 * tope * MINUTO_MS);
    const excedido = await reenviarInvitacionPendiente(inv.id);
    expect(excedido.ok).toBe(false);
    expect(excedido.mensaje).toMatch(/Cupo de invitaciones agotado por hoy para "victima@ejemplo.com"/);
    expect(correo.enviados).toHaveLength(tope);
    // Todo o nada: el pedido rechazado no rotó el token (el último enlace mandado sigue sirviendo).
    expect((await invitacionDe("victima@ejemplo.com")).hashToken).toBe(hashAntes);
    // Y otra persona de la misma empresa sigue pudiendo recibir su invitación.
    expect((await alta("otra@ejemplo.com")).ok).toBe(true);
  });

  // M-22 (T16; CAMBIA COMPORTAMIENTO: el cupo por destinatario cuenta el buzón y no la dirección escrita): `a+1@`, `a+2@`, … llegan al mismo buzón y esquivaban el tope de 3.
  it("EL ATAQUE (M-22): alias del mismo buzón (ana+1@, ana+2@, ana+3@) agotan el cupo del destinatario → el cuarto alias, y el buzón sin alias, se rechazan", async () => {
    const tope = MAXIMO_DE_MAILS_DE_INVITACION_POR_DESTINATARIO_Y_DIA;
    for (let i = 1; i <= tope; i++) {
      const r = await alta(`Ana+${i}@Ejemplo.com`);
      expect(r.ok, `alias ${i}: ${r.mensaje}`).toBe(true);
    }
    expect(correo.enviados).toHaveLength(tope);

    for (const otro of ["ana+4@ejemplo.com", "ana@ejemplo.com", "ANA+otro@ejemplo.com"]) {
      const excedido = await alta(otro);
      expect(excedido.ok, otro).toBe(false);
      expect(excedido.mensaje).toMatch(/Cupo de invitaciones agotado por hoy para/);
    }
    expect(correo.enviados).toHaveLength(tope);
    // Otro buzón (otra parte local, o el mismo nombre en otro dominio) NO comparte el cupo.
    expect((await alta("ana2@ejemplo.com")).ok).toBe(true);
    expect((await alta("ana+1@otro-dominio.com")).ok).toBe(true);
  });

  it("claveDeDestinatarioDelCupo: minúsculas y sin el sufijo +alias de la parte local; los puntos no se tocan y un +solo al principio se conserva", () => {
    expect(claveDeDestinatarioDelCupo(" Ana+Ventas@Ejemplo.COM ")).toBe("ana@ejemplo.com");
    expect(claveDeDestinatarioDelCupo("ana+a+b@ejemplo.com")).toBe("ana@ejemplo.com");
    expect(claveDeDestinatarioDelCupo("a.na@gmail.com")).toBe("a.na@gmail.com");
    expect(claveDeDestinatarioDelCupo("+x@ejemplo.com")).toBe("+x@ejemplo.com");
    expect(claveDeDestinatarioDelCupo("ana@ejemplo.com+x")).toBe("ana@ejemplo.com+x");
    expect(descripcionDelMailDeInvitacion("ana+1@ejemplo.com")).toBe(descripcionDelMailDeInvitacion("ANA+2@ejemplo.com"));
  });

  it("«invitar a vincular» también pasa por el cupo", async () => {
    const precargado = await crearUsuarioConMembresia({ email: "precargado@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const membresia = await prismaAdmin.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: precargado.id } });
    await reservarMailsDeAntes(EMPRESA_DE_PRUEBA_ID, MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA, admin.id);
    const r = await invitarAVincular(membresia.id);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/Cupo de invitaciones agotado por hoy/);
    expect(correo.enviados).toHaveLength(0);
    expect(await prismaAdmin.invitacion.count({ where: { email: "precargado@test.com" } })).toBe(0);
  });

  it("alta de alguien que ya es miembro y no vinculó Google: el mail de vinculación pasa por el cupo y, si no hay, no se guarda nada", async () => {
    await crearUsuarioConMembresia({ email: "miembro@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const sucursalB = await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA_DE_PRUEBA_ID, nombre: "Norte" } });
    await crearMembresia({ usuarioId: admin.id, sucursalId: sucursalB.id, rolId: base.admin.id });
    await reservarMailsDeAntes(EMPRESA_DE_PRUEBA_ID, MAXIMO_DE_MAILS_DE_INVITACION_POR_EMPRESA_Y_DIA, admin.id);
    const antes = await prismaAdmin.usuarioSucursal.count();
    const r = await agregarOActualizarUsuario({ email: "miembro@test.com", sucursalId: sucursalB.id, rolId: base.operador.id });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/Cupo de invitaciones agotado por hoy/);
    expect(correo.enviados).toHaveLength(0);
    expect(await prismaAdmin.usuarioSucursal.count()).toBe(antes);
  });
});

describe("S-21 (M17): el freno de un minuto no se burla con dos reenvíos simultáneos", () => {
  it("dos reenvíos a la vez de la misma invitación → sale UN solo mail", async () => {
    expect((await alta("nueva@ejemplo.com")).ok).toBe(true);
    const inv = await invitacionDe("nueva@ejemplo.com");
    // La invitación quedó enviada hace 5 minutos: el freno ya no la cubre y los dos pedidos pasan «el último envío fue hace rato».
    await prismaAdmin.invitacion.update({ where: { id: inv.id }, data: { enviadaEn: enElPasado(5 * MINUTO_MS) } });
    correo.vaciar();
    // El proveedor real tarda cientos de milisegundos: en ese rato la marca de envío todavía no estaba escrita (se anotaba DESPUÉS del mail) y el segundo pedido veía «hace 5 minutos».
    const mandar = correo.enviar.bind(correo);
    const lento = vi.spyOn(correo, "enviar").mockImplementation(async (mensaje) => {
      await new Promise((listo) => setTimeout(listo, 400));
      return mandar(mensaje);
    });
    try {
      await Promise.allSettled([reenviarInvitacionPendiente(inv.id), reenviarInvitacionPendiente(inv.id)]);
    } finally {
      lento.mockRestore();
    }
    expect(correo.enviados).toHaveLength(1);
  }, 60_000);
});

describe("S-21: si el mail no sale, la invitación queda «sin enviar»", () => {
  it("el proveedor falla → enviadaEn vuelve a nulo (la pantalla muestra «sin enviar»), el mail reservado cuenta igual y se puede reenviar enseguida", async () => {
    correo.fallarProximoEnvio("DEFINITIVO");
    const r = await alta("nueva@ejemplo.com");
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).toMatch(/El mail NO salió/);
    const inv = await invitacionDe("nueva@ejemplo.com");
    expect(inv.enviadaEn).toBeNull();
    expect(await MAILS()).toBe(1);
    const reenviada = await reenviarInvitacionPendiente(inv.id);
    expect(reenviada.ok, reenviada.mensaje).toBe(true);
    expect(correo.enviados).toHaveLength(1);
    expect((await invitacionDe("nueva@ejemplo.com")).enviadaEn).not.toBeNull();
  });
});

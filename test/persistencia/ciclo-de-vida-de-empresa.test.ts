import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { HAY_ROL_DE_PLATAFORMA, plataformaReal } from "../setup/cliente-plataforma-real";
import type { PrismaClient } from "@prisma/client";
import { aceptarInvitacionDelToken } from "../../src/core/auth/invitacion";
import type { MensajeDeCorreo, ResultadoDeEnvio } from "../../src/core/correo/tipos";
import { darDeAltaEmpresa } from "../../plataforma/src/servidor/empresas";
import {
  confirmarAltaDeEmpresa,
  corregirCuitDeEmpresa,
  reactivarEmpresa,
  reenviarAvisoDeActivacion,
  suspenderEmpresa,
  type DependenciasDeCicloDeVida,
} from "../../plataforma/src/servidor/ciclo-de-vida";

/**
 * Confirmar el alta, corregir el CUIT, suspender y reactivar (E6, ADR-021) contra Postgres real. El primer bloque corre con la conexión del DUEÑO (la base de test local
 * no tiene el rol `motor2_plataforma`); el segundo, con el rol REAL, solo si hay `PLATAFORMA_DATABASE_URL` (en CI corre).
 */
const AUTOR = { adminId: "admin-1", adminEmail: "admin@plataforma.test" };
const AHORA = new Date("2026-10-04T12:00:00.000Z");
const CUIT_A = "30712345671";
const CUIT_A_CON_GUIONES = "30-71234567-1";
const CUIT_B = "20123456786";

let enviados: MensajeDeCorreo[];
let resultadoDelEnvio: ResultadoDeEnvio;
let alEnviar: ((m: MensajeDeCorreo) => Promise<void>) | undefined;
let tokens = 0;
let hayFactura = false;

function deps(): DependenciasDeCicloDeVida {
  return {
    ahora: () => AHORA,
    urlApp: "https://app.ejemplo.com",
    generarToken: () => `T${String(++tokens).padStart(2, "0")}${"y".repeat(40)}`,
    enviar: async (m) => {
      await alEnviar?.(m);
      enviados.push(m);
      return resultadoDelEnvio;
    },
    tieneFacturaAutorizada: async () => hayFactura,
  };
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "AdminPlataforma"');
  enviados = [];
  resultadoDelEnvio = { ok: true, idExterno: "id-1" };
  alEnviar = undefined;
  tokens = 0;
  hayFactura = false;
});

afterAll(async () => {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
  await plataformaReal.$disconnect();
});

/** Una empresa dada de alta por la consola y con la invitación ACEPTADA por su gerente, que declaró `cuit`. Devuelve su id. */
async function empresaConCuitPendiente(slug: string, cuit: string = CUIT_A_CON_GUIONES, via: PrismaClient = prismaAdmin): Promise<{ id: string; email: string }> {
  const email = `gerente-${slug}@gmail.com`;
  const r = await darDeAltaEmpresa(via, deps(), AUTOR, { nombre: `Empresa ${slug}`, slug, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", nombreSucursal: "Central", emailDuenio: email });
  if (!r.ok) throw new Error(r.mensaje);
  const token = /#t=(\S+)/.exec(enviados.at(-1)!.texto)![1];
  const usuario = await prismaAdmin.user.upsert({ where: { email }, update: {}, create: { email } });
  const aceptada = await aceptarInvitacionDelToken({ token, usuario: { id: usuario.id, email }, cuit });
  if (!aceptada.ok) throw new Error(aceptada.mensaje);
  enviados = [];
  return { id: r.empresaId, email };
}

const confirmar = { revisado: true as const };
const acciones = async () => (await prismaAdmin.auditoriaPlataforma.findMany({ orderBy: { creadoEn: "asc" } })).map((a) => a.accion);

function pruebas(nombre: string, via: () => PrismaClient) {
  describe(nombre, () => {
    describe("confirmarAltaDeEmpresa", () => {
      it("pasa a ACTIVE con el CUIT declarado, deja auditoría y avisa al gerente; el CUIT declarado en la invitación no se toca", async () => {
        const e = await empresaConCuitPendiente("uno", CUIT_A_CON_GUIONES, via());
        const r = await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A_CON_GUIONES, ...confirmar });
        expect(r).toMatchObject({ ok: true, enviado: true });
        expect(await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ estado: "ACTIVE", cuit: CUIT_A });
        expect((await prismaAdmin.invitacion.findFirstOrThrow({ where: { empresaId: e.id } })).cuitDeclarado).toBe(CUIT_A);
        expect(enviados).toHaveLength(1);
        expect(enviados[0].para).toEqual([e.email]);
        expect(enviados[0].texto).toContain(CUIT_A_CON_GUIONES);
        expect(await acciones()).toEqual(["alta-de-empresa", "empresa-confirmada", "aviso-de-activacion"]);
        const aud = await prismaAdmin.auditoriaPlataforma.findFirstOrThrow({ where: { accion: "empresa-confirmada" } });
        expect(aud).toMatchObject({ adminId: AUTOR.adminId, adminEmail: AUTOR.adminEmail, empresaAfectadaId: e.id });
        expect(aud.detalle).toMatchObject({ cuit: CUIT_A, cuitDeclarado: CUIT_A, corregidoAlConfirmar: false });
      });

      it("el mail sale DESPUÉS del commit: al enviarse, otra conexión ya ve la empresa ACTIVE", async () => {
        const e = await empresaConCuitPendiente("dos", CUIT_A_CON_GUIONES, via());
        let estadoAlEnviar: string | undefined;
        alEnviar = async () => {
          estadoAlEnviar = (await prisma.empresa.findUnique({ where: { id: e.id } }))?.estado;
        };
        await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, ...confirmar });
        expect(estadoAlEnviar).toBe("ACTIVE");
      });

      it("exige tildar que se revisó el CUIT, y un CUIT distinto del declarado solo con confirmación explícita (que queda auditada)", async () => {
        const e = await empresaConCuitPendiente("tres", CUIT_A_CON_GUIONES, via());
        expect((await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, revisado: false })).ok).toBe(false);
        const sinAceptar = await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_B, ...confirmar });
        expect(sinAceptar).toMatchObject({ ok: false });
        expect((sinAceptar as { mensaje: string }).mensaje).toContain(CUIT_A_CON_GUIONES);
        expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: e.id } })).estado).toBe("PROVISIONING");
        expect(enviados).toEqual([]);

        expect((await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_B, ...confirmar, aceptoCuitDistinto: true })).ok).toBe(true);
        expect(await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ cuit: CUIT_B });
        const aud = await prismaAdmin.auditoriaPlataforma.findFirstOrThrow({ where: { accion: "empresa-confirmada" } });
        expect(aud.detalle).toMatchObject({ cuit: CUIT_B, cuitDeclarado: CUIT_A, corregidoAlConfirmar: true });
      });

      it("rechaza un CUIT inválido, una empresa que no existe, una que ya no está en alta y una cuyo gerente no aceptó", async () => {
        const e = await empresaConCuitPendiente("cuatro", CUIT_A_CON_GUIONES, via());
        expect((await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: "30-71234567-4", ...confirmar })).ok).toBe(false);
        expect((await confirmarAltaDeEmpresa(via(), deps(), AUTOR, "no-existe", { cuit: CUIT_A, ...confirmar })).ok).toBe(false);

        const sinAceptar = await darDeAltaEmpresa(via(), deps(), AUTOR, { nombre: "Sin aceptar", slug: "sin-aceptar", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", nombreSucursal: "Central", emailDuenio: "x@gmail.com" });
        if (!sinAceptar.ok) throw new Error("alta");
        expect((await confirmarAltaDeEmpresa(via(), deps(), AUTOR, sinAceptar.empresaId, { cuit: CUIT_A, ...confirmar })).ok).toBe(false);

        expect((await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, ...confirmar })).ok).toBe(true);
        expect((await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, ...confirmar })).ok).toBe(false); // ya activa
      });

      it("si otra empresa ya tiene ese CUIT, no confirma y el mensaje la nombra", async () => {
        const e = await empresaConCuitPendiente("cinco", CUIT_A_CON_GUIONES, via());
        // Otra empresa se confirmó con ese CUIT después de que esta lo declarara (aceptar ya rechaza declarar el CUIT de una empresa confirmada).
        await prismaAdmin.empresa.create({ data: { id: "previa", nombre: "Hostería Norte", slug: "previa", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE", cuit: CUIT_A } });
        const r = await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, ...confirmar });
        expect(r).toMatchObject({ ok: false });
        expect((r as { mensaje: string }).mensaje).toContain("Hostería Norte");
        expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: e.id } })).estado).toBe("PROVISIONING");
        expect(enviados).toEqual([]);
      });

      it("dos empresas que declararon el mismo CUIT, confirmadas a la vez: gana una y la otra recibe el mensaje que nombra a la primera", async () => {
        const a = await empresaConCuitPendiente("carrera-a", CUIT_A_CON_GUIONES, via());
        const b = await empresaConCuitPendiente("carrera-b", CUIT_A_CON_GUIONES, via());
        const resultados = await Promise.all([a, b].map((e) => confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, ...confirmar })));
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        const perdedora = resultados.find((r) => !r.ok) as { mensaje: string };
        expect(perdedora.mensaje).toMatch(/ya es de «Empresa carrera-[ab]»/);
        expect(await prismaAdmin.empresa.count({ where: { cuit: CUIT_A } })).toBe(1);
        expect(await prismaAdmin.empresa.count({ where: { estado: "PROVISIONING" } })).toBe(1);
      });

      it("carrera determinista: otra empresa toma el CUIT en una transacción abierta; al confirmarse, el choque del índice se traduce al mismo mensaje (no escapa como error de base)", async () => {
        const e = await empresaConCuitPendiente("determinista", CUIT_A_CON_GUIONES, via());
        let soltar!: () => void;
        const espera = new Promise<void>((r) => (soltar = r));
        let tomado!: () => void;
        const yaTomado = new Promise<void>((r) => (tomado = r));
        const abierta = prismaAdmin.$transaction(async (tx) => {
          await tx.empresa.create({ data: { id: "ganadora", nombre: "Hostería Ganadora", slug: "ganadora", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE", cuit: CUIT_A } });
          tomado();
          await espera;
        });
        await yaTomado;
        const confirmando = confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, ...confirmar });
        await new Promise((r) => setTimeout(r, 400)); // la confirmación ya está esperando el índice único
        soltar();
        await abierta;
        const r = await confirmando;
        expect(r).toMatchObject({ ok: false });
        expect((r as { mensaje: string }).mensaje).toContain("Hostería Ganadora");
        expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: e.id } })).estado).toBe("PROVISIONING");
        expect(enviados).toEqual([]);
      });

      it("la misma empresa confirmada dos veces a la vez: se aplica una sola, con un solo aviso", async () => {
        const e = await empresaConCuitPendiente("doble", CUIT_A_CON_GUIONES, via());
        const resultados = await Promise.all([1, 2, 3].map(() => confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, ...confirmar })));
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        expect(enviados).toHaveLength(1);
        expect((await acciones()).filter((a) => a === "empresa-confirmada")).toHaveLength(1);
      });

      it("si el mail no sale, queda confirmada, lo dice, el aviso figura sin enviar y reenviarlo lo anota", async () => {
        const e = await empresaConCuitPendiente("sinmail", CUIT_A_CON_GUIONES, via());
        resultadoDelEnvio = { ok: false, motivo: "CUPO", detalle: "cupo" };
        expect(await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, ...confirmar })).toMatchObject({ ok: true, enviado: false });
        expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: e.id } })).estado).toBe("ACTIVE");
        const aviso = () => prismaAdmin.auditoriaPlataforma.findMany({ where: { accion: "aviso-de-activacion" }, orderBy: { creadoEn: "asc" } });
        expect((await aviso()).map((a) => a.detalle)).toEqual([{ enviado: false, reenvio: false }]);

        resultadoDelEnvio = { ok: true, idExterno: null };
        expect(await reenviarAvisoDeActivacion(via(), deps(), AUTOR, e.id)).toMatchObject({ ok: true, enviado: true });
        expect((await aviso()).map((a) => a.detalle)).toEqual([{ enviado: false, reenvio: false }, { enviado: true, reenvio: true }]);
      });

      it("reenviar el aviso solo sirve para una empresa activa", async () => {
        const e = await empresaConCuitPendiente("reenvio", CUIT_A_CON_GUIONES, via());
        expect((await reenviarAvisoDeActivacion(via(), deps(), AUTOR, e.id)).ok).toBe(false); // todavía en alta
      });
    });

    describe("corregirCuitDeEmpresa", () => {
      async function activa(slug: string) {
        const e = await empresaConCuitPendiente(slug, CUIT_A_CON_GUIONES, via());
        await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, ...confirmar });
        enviados = [];
        return e;
      }

      it("corrige el CUIT, deja el anterior y el nuevo en la auditoría con el motivo, y no toca lo que declaró el gerente", async () => {
        const e = await activa("corrige");
        const r = await corregirCuitDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: "20-12345678-6", motivo: "Constancia de ARCA" });
        expect(r).toMatchObject({ ok: true });
        expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: e.id } })).cuit).toBe(CUIT_B);
        expect((await prismaAdmin.invitacion.findFirstOrThrow({ where: { empresaId: e.id } })).cuitDeclarado).toBe(CUIT_A);
        const aud = await prismaAdmin.auditoriaPlataforma.findFirstOrThrow({ where: { accion: "cuit-corregido" } });
        expect(aud.detalle).toEqual({ cuitAnterior: CUIT_A, cuitNuevo: CUIT_B, motivo: "Constancia de ARCA" });
      });

      it("carga el CUIT de una empresa que no lo tenía (anterior vacío)", async () => {
        await prismaAdmin.empresa.create({ data: { id: "vieja", nombre: "Vieja", slug: "vieja", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
        expect(await corregirCuitDeEmpresa(via(), deps(), AUTOR, "vieja", { cuit: CUIT_A, motivo: "Carga inicial" })).toMatchObject({ ok: true });
        expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: "vieja" } })).cuit).toBe(CUIT_A);
        expect((await prismaAdmin.auditoriaPlataforma.findFirstOrThrow({ where: { accion: "cuit-corregido" } })).detalle).toMatchObject({ cuitAnterior: "", cuitNuevo: CUIT_A });
      });

      it("el mismo CUIT es «sin cambios» y no audita; un CUIT inválido o sin motivo se rechaza", async () => {
        const e = await activa("igual");
        const antes = (await acciones()).length;
        expect(await corregirCuitDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, motivo: "Nada" })).toMatchObject({ ok: true, mensaje: expect.stringContaining("Sin cambios") });
        expect((await acciones()).length).toBe(antes);
        expect((await corregirCuitDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: "30-71234567-4", motivo: "Error" })).ok).toBe(false);
        expect((await corregirCuitDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_B, motivo: "" })).ok).toBe(false);
      });

      it("rechaza un CUIT que ya tiene otra empresa (nombrándola), también si llegan a la vez", async () => {
        const a = await activa("rep-a");
        await prismaAdmin.empresa.create({ data: { id: "b", nombre: "Empresa B", slug: "b", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
        const r = await corregirCuitDeEmpresa(via(), deps(), AUTOR, "b", { cuit: CUIT_A, motivo: "Prueba" });
        expect(r).toMatchObject({ ok: false });
        expect((r as { mensaje: string }).mensaje).toContain("Empresa rep-a");
        await prismaAdmin.empresa.create({ data: { id: "c", nombre: "Empresa C", slug: "c", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
        const dos = await Promise.all(["b", "c"].map((id) => corregirCuitDeEmpresa(via(), deps(), AUTOR, id, { cuit: CUIT_B, motivo: "A la vez" })));
        expect(dos.filter((x) => x.ok)).toHaveLength(1);
        expect(await prismaAdmin.empresa.count({ where: { cuit: CUIT_B } })).toBe(1);
        expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: a.id } })).cuit).toBe(CUIT_A);
      });

      it("con una factura autorizada en producción el CUIT es inmutable: se rechaza sin cambiar nada", async () => {
        const e = await activa("facturada");
        hayFactura = true;
        const r = await corregirCuitDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_B, motivo: "Intento" });
        expect(r).toMatchObject({ ok: false, mensaje: expect.stringContaining("factura autorizada") });
        expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: e.id } })).cuit).toBe(CUIT_A);
      });

      it("una empresa en alta se corrige al confirmarla, no acá", async () => {
        const e = await empresaConCuitPendiente("enalta", CUIT_A_CON_GUIONES, via());
        expect((await corregirCuitDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_B, motivo: "Intento" })).ok).toBe(false);
      });

      it("quitar el CUIT solo se permite en una empresa suspendida", async () => {
        const e = await activa("quitar");
        expect((await corregirCuitDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: "", motivo: "Era de otra" })).ok).toBe(false);
        await suspenderEmpresa(via(), AUTOR, e.id, "Posible suplantación");
        expect(await corregirCuitDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: "", motivo: "Era de otra" })).toMatchObject({ ok: true });
        expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: e.id } })).cuit).toBeNull();
      });
    });

    describe("suspenderEmpresa y reactivarEmpresa", () => {
      it("ACTIVE ↔ SUSPENDED con auditoría; suspender pide motivo; reactivar lo acepta opcional", async () => {
        const e = await empresaConCuitPendiente("ciclo", CUIT_A_CON_GUIONES, via());
        await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, ...confirmar });
        expect((await suspenderEmpresa(via(), AUTOR, e.id, "")).ok).toBe(false);
        expect((await suspenderEmpresa(via(), AUTOR, e.id, "Falta de pago")).ok).toBe(true);
        expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: e.id } })).estado).toBe("SUSPENDED");
        expect((await suspenderEmpresa(via(), AUTOR, e.id, "Otra vez")).ok).toBe(false);
        expect((await reactivarEmpresa(via(), AUTOR, e.id, undefined)).ok).toBe(true);
        expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: e.id } })).estado).toBe("ACTIVE");
        expect((await reactivarEmpresa(via(), AUTOR, e.id, undefined)).ok).toBe(false);
        const filas = await prismaAdmin.auditoriaPlataforma.findMany({ where: { accion: { in: ["empresa-suspendida", "empresa-reactivada"] } }, orderBy: { creadoEn: "asc" } });
        expect(filas.map((f) => [f.accion, f.detalle])).toEqual([["empresa-suspendida", { motivo: "Falta de pago" }], ["empresa-reactivada", {}]]);
      });

      it("una empresa en alta no se suspende, y una que no existe tampoco", async () => {
        const e = await empresaConCuitPendiente("alta", CUIT_A_CON_GUIONES, via());
        expect((await suspenderEmpresa(via(), AUTOR, e.id, "Motivo")).ok).toBe(false);
        expect((await suspenderEmpresa(via(), AUTOR, "no-existe", "Motivo")).ok).toBe(false);
      });

      it("dos suspensiones a la vez: se aplica una sola", async () => {
        const e = await empresaConCuitPendiente("vez", CUIT_A_CON_GUIONES, via());
        await confirmarAltaDeEmpresa(via(), deps(), AUTOR, e.id, { cuit: CUIT_A, ...confirmar });
        const r = await Promise.all([1, 2].map(() => suspenderEmpresa(via(), AUTOR, e.id, "A la vez")));
        expect(r.filter((x) => x.ok)).toHaveLength(1);
        expect((await acciones()).filter((a) => a === "empresa-suspendida")).toHaveLength(1);
      });
    });
  });
}

pruebas("con la conexión del dueño", () => prismaAdmin);

describe.skipIf(!HAY_ROL_DE_PLATAFORMA)("con el rol motor2_plataforma real", () => {
  pruebas("el rol alcanza para todo el ciclo de vida", () => plataformaReal);

  it("el rol no puede reescribir el CUIT declarado de una invitación aceptada ni borrar la empresa", async () => {
    const e = await empresaConCuitPendiente("permisos", CUIT_A_CON_GUIONES, plataformaReal);
    const SIN_PERMISO = /42501|permission denied|permiso denegado|no permitido|row-level security|policy/i;
    await expect(plataformaReal.invitacion.updateMany({ where: { empresaId: e.id }, data: { cuitDeclarado: CUIT_B } })).rejects.toThrow(SIN_PERMISO);
    await expect(plataformaReal.empresa.delete({ where: { id: e.id } })).rejects.toThrow(SIN_PERMISO);
  });
});

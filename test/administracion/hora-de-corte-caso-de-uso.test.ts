import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { horaDeCorteValida } from "../../src/core/tiempo/fecha-de-negocio";
import { guardComandoCambiarHoraDeCorteDeSucursal } from "../../src/core/features/sucursales/sucursal.guard";
import { azarDelProceso } from "../../src/lib/azar";
import { cambiarHoraDeCorteDeSucursalCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/cambiar-hora-de-corte-de-sucursal";
import { abrirSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/abrir-sesion";
import { baseDeEmpresa } from "../../src/server/sesion/base";
import { EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { HORAS_INVALIDAS, todasLasHorasValidas } from "../auth/oraculo-de-hora-de-corte";

/**
 * C2c (hora de corte de la sucursal), caso de uso `cambiarHoraDeCorteDeSucursalCasoDeUso` contra Postgres real (docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md, «C2c», tabla «¿qué pasa si…?»).
 * Cubre: cambio válido con UNA auditoría (anterior y nuevo), mismo valor (ok sin escribir ni auditar), doble clic, dos cambios simultáneos, hora inválida, sucursal inexistente o de otra empresa, y la
 * convivencia con la caja (sesión abierta conserva su sello, la nueva sella la hora nueva, jornada cerrada intacta, cambio vs apertura a la vez).
 *
 * MUTACIONES (rojo/verde, probadas a mano y registradas en docs/diseno-caja-c2c-hora-de-corte-construccion-2026-11-17.md):
 *  - sacar la comparación «mismo valor» (`if (anterior === horaDeCorte) return …`) del caso de uso → rojo «mismo valor: ok sin escribir ni auditar» y «doble clic»;
 *  - sacar `registrarCambioAuditado` del caso de uso → rojo «cambio válido: queda escrito y UNA fila de auditoría», «dos cambios a la vez» y los de doble clic;
 *  - sacar la validación de formato del caso de uso (`horaDeCorteValida`) → rojo «hora inválida: rechazo de regla» (la base lo frena con el CHECK, pero como error crudo, no como rechazo);
 *  - sacar la validación del guard (`guardComandoCambiarHoraDeCorteDeSucursal`) → rojo el test del guard de acá;
 *  - sacar `conPermisoDeEmpresa` de la Server Action → rojo `test/auth/hora-de-corte-rol-por-piso.test.ts`.
 */
const ZONA = "America/Argentina/Buenos_Aires";
// 15/01/2026 02:30 en Argentina (UTC-3): con corte 00:00 es la jornada del 15; con corte 06:00 todavía es la del 14.
const ENTRE_MEDIANOCHE_Y_LAS_SEIS = new Date("2026-01-15T05:30:00.000Z");

let usuarioId: string;
let sucursalBaseId: string;
const actor = () => ({ usuarioId, ...baseDeEmpresa(EMPRESA_POR_DEFECTO_ID, { lectura: [sucursalBaseId], escritura: [sucursalBaseId] }) });
const cambiar = (sucursalId: string, horaDeCorte: string) => cambiarHoraDeCorteDeSucursalCasoDeUso(actor(), { sucursalId, horaDeCorte });
const horaEnBase = async (id: string) => (await prismaAdmin.$queryRaw<{ h: string }[]>`SELECT to_char("horaDeCorte", 'HH24:MI') AS h FROM "Sucursal" WHERE id = ${id}`)[0]!.h;
const auditorias = (sucursalId: string) => prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Sucursal", entidadId: sucursalId, campo: "horaDeCorte" }, orderBy: { creadoEn: "asc" } });

async function abrirCaja(sucursalId: string, ahora: Date) {
  const a = { usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, ahora, empresaZonaHoraria: ZONA, ...baseDeEmpresa(EMPRESA_POR_DEFECTO_ID, { lectura: [sucursalId], escritura: [sucursalId] }) };
  return abrirSesionCasoDeUso(a, { claveIdempotencia: randomUUID(), fondoEnCentavos: BigInt(0) }, azarDelProceso);
}
const sesionDe = (sucursalId: string) => prismaAdmin.sesionCaja.findFirstOrThrow({ where: { sucursalId } });

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
  sucursalBaseId = base.sucursal.id;
});

describe("hora de corte: la hora válida (lista de permitidos)", () => {
  it("el validador acepta exactamente las 1440 horas HH:MM y rechaza las inválidas típicas (también el guard)", () => {
    const validas = todasLasHorasValidas();
    expect(validas).toHaveLength(1440);
    for (const h of validas) {
      expect(horaDeCorteValida(h), h).toBe(true);
      expect(guardComandoCambiarHoraDeCorteDeSucursal(h), h).toEqual({ ok: true, valor: { horaDeCorte: h } });
    }
    for (const h of HORAS_INVALIDAS) {
      expect(horaDeCorteValida(h), String(h)).toBe(false);
      expect(guardComandoCambiarHoraDeCorteDeSucursal(h), String(h)).toMatchObject({ ok: false, codigo: "formato" });
    }
  });
});

describe("cambiar la hora de corte: el caso de uso", () => {
  it("cambio válido: queda escrito en la base y UNA fila de auditoría con el valor anterior y el nuevo", async () => {
    expect(await horaEnBase(sucursalBaseId)).toBe("00:00");
    const r = await cambiar(sucursalBaseId, "06:00");
    expect(r).toMatchObject({ ok: true, datos: { sinCambios: false } });
    expect(await horaEnBase(sucursalBaseId)).toBe("06:00");
    const filas = await auditorias(sucursalBaseId);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ entidad: "Sucursal", campo: "horaDeCorte", valorAnterior: "00:00", valorNuevo: "06:00", actorId: usuarioId });
  });

  it("mismo valor: ok sin escribir ni auditar (idempotente por estado)", async () => {
    const primera = await cambiar(sucursalBaseId, "00:00");
    expect(primera).toMatchObject({ ok: true, datos: { sinCambios: true } });
    expect(await auditorias(sucursalBaseId)).toHaveLength(0);
    expect(await cambiar(sucursalBaseId, "06:00")).toMatchObject({ ok: true, datos: { sinCambios: false } });
    const repetida = await cambiar(sucursalBaseId, "06:00");
    expect(repetida).toMatchObject({ ok: true, datos: { sinCambios: true } });
    expect(await auditorias(sucursalBaseId)).toHaveLength(1);
  });

  it("doble clic: dos llamadas iguales a la vez → un solo cambio y UNA auditoría", async () => {
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      const sucursal = await prisma.sucursal.create({ data: { nombre: `Doble ${vuelta}` } });
      const [a, b] = await Promise.all([cambiar(sucursal.id, "05:30"), cambiar(sucursal.id, "05:30")]);
      expect(a.ok && b.ok, `vuelta ${vuelta}: ${JSON.stringify([a, b])}`).toBe(true);
      expect([a, b].filter((r) => r.ok && !r.datos.sinCambios), `vuelta ${vuelta}`).toHaveLength(1);
      expect(await horaEnBase(sucursal.id)).toBe("05:30");
      expect(await auditorias(sucursal.id), `vuelta ${vuelta}`).toHaveLength(1);
    }
  });

  it("dos cambios a la vez a valores DISTINTOS: los dos terminan ok (el que pierde reintenta y escribe el suyo), sin error crudo y con una auditoría por escritura real, encadenadas", async () => {
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      const sucursal = await prisma.sucursal.create({ data: { nombre: `Carrera ${vuelta}` } });
      const [a, b] = await Promise.all([cambiar(sucursal.id, "06:00"), cambiar(sucursal.id, "07:00")]);
      expect([a.ok, b.ok], `vuelta ${vuelta}: ${JSON.stringify([a, b])}`).toEqual([true, true]);
      const final = await horaEnBase(sucursal.id);
      expect(["06:00", "07:00"]).toContain(final);
      const filas = await auditorias(sucursal.id);
      expect(filas, `vuelta ${vuelta}`).toHaveLength(2);
      // La cadena es coherente: el primero parte de 00:00 y el segundo parte de lo que dejó el primero; lo último escrito es lo vigente.
      expect(filas[0]!.valorAnterior).toBe("00:00");
      expect(filas[1]!.valorAnterior).toBe(filas[0]!.valorNuevo);
      expect(filas[1]!.valorNuevo).toBe(final);
      expect(new Set([filas[0]!.valorNuevo, filas[1]!.valorNuevo])).toEqual(new Set(["06:00", "07:00"]));
    }
  });

  it("hora inválida (24:00, 6:00, 06:00:00, vacío, no texto): rechazo de regla HORA_DE_CORTE_INVALIDA sin escribir ni auditar", async () => {
    for (const h of HORAS_INVALIDAS) {
      const r = await cambiarHoraDeCorteDeSucursalCasoDeUso(actor(), { sucursalId: sucursalBaseId, horaDeCorte: h as string });
      expect(r, String(h)).toMatchObject({ ok: false, codigo: "HORA_DE_CORTE_INVALIDA" });
    }
    expect(await horaEnBase(sucursalBaseId)).toBe("00:00");
    expect(await auditorias(sucursalBaseId)).toHaveLength(0);
  });

  it("sucursal inexistente o de otra empresa: SUCURSAL_NO_ENCONTRADA, sin escribir", async () => {
    expect(await cambiar("no-existe", "06:00")).toMatchObject({ ok: false, codigo: "SUCURSAL_NO_ENCONTRADA" });
    const ajena = await prismaAdmin.sucursal.create({ data: { nombre: "Ajena", empresaId: EMPRESA_TESTIGO_ID } });
    expect(await cambiar(ajena.id, "06:00")).toMatchObject({ ok: false, codigo: "SUCURSAL_NO_ENCONTRADA" });
    expect(await horaEnBase(ajena.id)).toBe("00:00");
    expect(await prismaAdmin.registroAuditoria.count({ where: { campo: "horaDeCorte" } })).toBe(0);
  });
});

describe("cambiar la hora de corte: convivencia con la caja", () => {
  it("una sesión ya abierta conserva su hora sellada y su jornada; la que se abre DESPUÉS sella la nueva y su fecha de negocio sale de ella", async () => {
    const vieja = await prisma.sucursal.create({ data: { nombre: "Con sesión" } });
    const abierta = await abrirCaja(vieja.id, ENTRE_MEDIANOCHE_Y_LAS_SEIS);
    expect(abierta.ok, JSON.stringify(abierta)).toBe(true);
    const sesionAntes = await sesionDe(vieja.id);
    const jornadaAntes = await prismaAdmin.jornadaDeSucursal.findFirstOrThrow({ where: { sucursalId: vieja.id } });
    expect(sesionAntes.fechaDeNegocio.toISOString().slice(0, 10)).toBe("2026-01-15");

    expect(await cambiar(vieja.id, "06:00")).toMatchObject({ ok: true, datos: { sinCambios: false } });
    expect(await sesionDe(vieja.id)).toEqual(sesionAntes);
    expect(await prismaAdmin.jornadaDeSucursal.findFirstOrThrow({ where: { sucursalId: vieja.id } })).toEqual(jornadaAntes);
    expect(await prismaAdmin.sesionCaja.count({ where: { sucursalId: vieja.id } })).toBe(1);

    const nueva = await prisma.sucursal.create({ data: { nombre: "Después del cambio" } });
    expect(await cambiar(nueva.id, "06:00")).toMatchObject({ ok: true });
    const despues = await abrirCaja(nueva.id, ENTRE_MEDIANOCHE_Y_LAS_SEIS);
    expect(despues.ok, JSON.stringify(despues)).toBe(true);
    const sesionNueva = await sesionDe(nueva.id);
    expect(sesionNueva.horaDeCorte.toISOString().slice(11, 16)).toBe("06:00");
    expect(sesionNueva.fechaDeNegocio.toISOString().slice(0, 10)).toBe("2026-01-14");
  });

  it("una jornada CERRADA no cambia con el cambio de la hora", async () => {
    const sucursal = await prisma.sucursal.create({ data: { nombre: "Jornada cerrada" } });
    const j = await prismaAdmin.jornadaDeSucursal.create({ data: { id: randomUUID(), empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: sucursal.id, fechaDeNegocio: new Date("2026-01-10T00:00:00.000Z") } });
    await prismaAdmin.jornadaDeSucursal.update({ where: { id: j.id }, data: { estado: "EN_AUDITORIA", auditoriaIniciadaEn: new Date(), auditoriaIniciadaPorId: usuarioId } });
    await prismaAdmin.jornadaDeSucursal.update({ where: { id: j.id }, data: { estado: "CERRADA", cerradaEn: new Date(), cerradaPorId: usuarioId, huellaDeCierre: "a".repeat(64) } });
    const antes = await prismaAdmin.jornadaDeSucursal.findUniqueOrThrow({ where: { id: j.id } });
    expect(await cambiar(sucursal.id, "06:00")).toMatchObject({ ok: true });
    expect(await prismaAdmin.jornadaDeSucursal.findUniqueOrThrow({ where: { id: j.id } })).toEqual(antes);
  });

  it("cambio a la vez que una apertura de sesión (varias vueltas): ninguno sale como error crudo y la sesión queda sellada con una hora coherente con su fecha de negocio", async () => {
    const sellos = new Set<string>();
    for (let vuelta = 0; vuelta < 8; vuelta++) {
      const sucursal = await prisma.sucursal.create({ data: { nombre: `Apertura ${vuelta}` } });
      const [cambio, apertura] = await Promise.all([cambiar(sucursal.id, "06:00"), abrirCaja(sucursal.id, ENTRE_MEDIANOCHE_Y_LAS_SEIS)]);
      expect(cambio.ok, `vuelta ${vuelta}: ${JSON.stringify(cambio)}`).toBe(true);
      expect(apertura.ok, `vuelta ${vuelta}: ${JSON.stringify(apertura)}`).toBe(true);
      expect(await horaEnBase(sucursal.id)).toBe("06:00");
      const sesion = await sesionDe(sucursal.id);
      const sello = sesion.horaDeCorte.toISOString().slice(11, 16);
      sellos.add(sello);
      // 00:00 → jornada del 15; 06:00 → jornada del 14. Nunca otra combinación (el disparador `SesionCaja_validar` también lo exige).
      expect([sello, sesion.fechaDeNegocio.toISOString().slice(0, 10)], `vuelta ${vuelta}`).toSatisfy((par: string[]) => (par[0] === "00:00" && par[1] === "2026-01-15") || (par[0] === "06:00" && par[1] === "2026-01-14"));
    }
    // Informativo: qué sellos aparecieron en las vueltas (el orden lo decide quien llega primero).
    expect([...sellos].every((s) => s === "00:00" || s === "06:00")).toBe(true);
  });
});

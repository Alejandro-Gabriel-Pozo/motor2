import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { cerrarSesionDeCaja, abrirSesionDeCaja, cobrarCuenta, iniciarCierreDeSesionDeCaja } from "../../src/server/actions/caja/caja";
import {
  cancelarAuditoriaDeJornada,
  cerrarJornadaDeCaja,
  corregirMedioDeCobroDeCaja,
  darConformeGeneralDeJornada,
  declararTotalDeMedio,
  iniciarAuditoriaDeJornada,
  registrarAjusteDeCaja,
} from "../../src/server/actions/caja/cierre-del-dia";
import { leerConciliacionDeJornada, leerControlesDeJornada, leerEstadoDeJornada, leerJornadasDeCaja } from "../../src/server/actions/caja/lecturas-del-cierre";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { diaDeColumnaDate, fechaDeColumnaDate } from "../../src/core/tiempo/zona-horaria";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID as EMPRESA, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Caja, cierre del día, etapa A (2026-11-17): las 7 Server Actions y las 4 lecturas del cierre del día contra Postgres real y la sesión simulada. Por cada acción: el permiso EXACTO (rechaza sin él y sin tocar la base; con él pasa), el formato (un
 * rechazo de guard no toca la base), el cambio de permisos a mitad, el resultado con el caso de uso real, la idempotencia (doble clic y misma clave) y la concurrencia por las acciones reales (carreras de verdad con `Promise.allSettled`). El operador
 * NO registra ajustes aunque tenga la fila prendida (piso administrador). Las lecturas piden `caja_jornada_ver` y no devuelven nada de otra sucursal.
 * Mutaciones (rojo/verde; se corrieron a mano al escribir la prueba): (1) quitar el `conPermiso` de una acción (llamar al caso de uso sin envoltorio) deja en rojo «(a) con todas MENOS la que exige» y «(b) sin ninguna clave» de esa acción; (2) usar la clave
 * equivocada en una acción (p. ej. `caja_jornada_cerrar` en `cancelarAuditoriaDeJornada`) deja en rojo «(a)» y «(c) con el permiso exacto» de las dos (la matriz exacta lo detecta); (3) sacar la validación del guard (`guardComandoDeJornada` que siempre
 * devuelve ok) deja en rojo «(d) el formato».
 */
type Clave = "caja_jornada_ver" | "caja_jornada_iniciar_auditoria" | "caja_jornada_cancelar_auditoria" | "caja_jornada_cerrar" | "caja_corregir_medio_de_cobro" | "caja_declarar_total" | "caja_registrar_ajuste";
const TODAS: readonly Clave[] = ["caja_jornada_ver", "caja_jornada_iniciar_auditoria", "caja_jornada_cancelar_auditoria", "caja_jornada_cerrar", "caja_corregir_medio_de_cobro", "caja_declarar_total", "caja_registrar_ajuste"];
const DE_OPERARIO: readonly Clave[] = TODAS.filter((c) => c !== "caja_registrar_ajuste");

let s: Awaited<ReturnType<typeof sembrarSalon>>;
const actores: Record<string, { id: string; email: string }> = {};
const como = (actor: { id: string; email: string }) => entrarComo(actor);
const DICHO_POR_PERMISO = expect.stringMatching(/permiso|acceso|No tenés|no tiene/i);
const PASADO = "2026-01-08";

async function rolCon(nombre: string, claves: readonly Clave[]) {
  const rol = await prisma.rol.create({ data: { nombre } });
  await prisma.permisoRol.createMany({ data: claves.map((accionClave) => ({ rolId: rol.id, accionClave, puedeVer: true, puedeEditar: true })) });
  return rol;
}

const foto = async () => ({
  jornadas: await prismaAdmin.jornadaDeSucursal.findMany({ select: { id: true, estado: true }, orderBy: { id: "asc" } }),
  sesiones: await prismaAdmin.sesionCaja.count(),
  movimientos: await prismaAdmin.movimientoCaja.count(),
  correcciones: await prismaAdmin.correccionDeMedio.count(),
  declaraciones: await prismaAdmin.declaracionDeTotal.count(),
  conformes: await prismaAdmin.conformeDeJornada.count(),
  controles: await prismaAdmin.controlDeJornadaCerrada.count(),
  cierres: await prismaAdmin.cierreDeCajaDeJornada.count(),
  auditoria: await prismaAdmin.registroAuditoria.count(),
});

const efectivoId = async () => (await prismaAdmin.medioDePago.findFirstOrThrow({ where: { tipo: "EFECTIVO" } })).id;
const medio = (tipo: "TARJETA_DEBITO" | "QR") => prismaAdmin.medioDePago.create({ data: { id: randomUUID(), empresaId: EMPRESA, tipo } });
const fechaDe = async (sesionId: string) => diaDeColumnaDate((await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: sesionId } })).fechaDeNegocio);
const claveNueva = () => randomUUID();

async function cuentaCerrada(cantidad = 2, precio = 3000) {
  await como(s.admin);
  const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad, precioUnitario: precio, numeroEnvio: 1 }]);
  expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
  return cuenta;
}

/**
 * El día hecho con las acciones reales, como administrador: caja abierta con $100, una cuenta de $6.000 cobrada en efectivo, la caja contada ($6.100: 3 de $2.000 y un billete de $100) y cerrada. Devuelve la fecha de negocio de la jornada, la sesión
 * y el cobro (el que se corrige).
 */
async function diaConLaCajaCerrada() {
  await como(s.admin);
  const abierta = await abrirSesionDeCaja({ claveIdempotencia: claveNueva(), fondo: "100" });
  expect(abierta).toMatchObject({ ok: true });
  const sesionId = abierta.sesionId!;
  const cuenta = await cuentaCerrada();
  await como(s.admin);
  const ef = await efectivoId();
  expect(await cobrarCuenta({ claveIdempotencia: claveNueva(), cuentaId: cuenta.id, totalVisto: "6000", renglones: [{ medioDePagoId: ef, importe: "6000" }] })).toMatchObject({ ok: true });
  expect(await iniciarCierreDeSesionDeCaja({ sesionId })).toMatchObject({ ok: true });
  expect(await cerrarSesionDeCaja({ sesionId, billetes: { "2000": 3, "100": 1 }, monedas: "0", conformeDeLosDemasMedios: true, observacion: null })).toMatchObject({ ok: true });
  const cobro = await prismaAdmin.cobro.findFirstOrThrow({ where: { medioDePagoId: ef } });
  return { fecha: await fechaDe(sesionId), sesionId, cobroId: cobro.id, ef };
}

async function diaEnAuditoria() {
  const d = await diaConLaCajaCerrada();
  await como(s.admin);
  expect(await iniciarAuditoriaDeJornada({ fechaDeNegocio: d.fecha })).toMatchObject({ ok: true, yaEstabaEnAuditoria: false });
  return d;
}

/** Lleva (con el dueño de la base, como `forzarJornada` de jornada-casos-de-uso) una jornada de la sucursal a CERRADA. */
async function forzarJornadaCerrada(fecha: string) {
  const j = await prismaAdmin.jornadaDeSucursal.create({ data: { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, fechaDeNegocio: fechaDeColumnaDate(fecha) } });
  await prismaAdmin.jornadaDeSucursal.update({ where: { id: j.id }, data: { estado: "EN_AUDITORIA", auditoriaIniciadaEn: new Date(), auditoriaIniciadaPorId: s.admin.id } });
  await prismaAdmin.jornadaDeSucursal.update({ where: { id: j.id }, data: { estado: "CERRADA", cerradaEn: new Date(), cerradaPorId: s.admin.id, huellaDeCierre: "a".repeat(64) } });
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  __setCookieDeTestParaSucursal(undefined);
  s = await sembrarSalon();
  for (const faltante of TODAS) {
    const rol = await rolCon(`todas-menos-${faltante}`, TODAS.filter((c) => c !== faltante));
    actores[`menos-${faltante}`] = await crearUsuarioConMembresia({ email: `menos-${faltante}@test.com`, sucursalId: s.sucursalId, rolId: rol.id });
  }
  actores.ninguna = await crearUsuarioConMembresia({ email: "ninguna@test.com", sucursalId: s.sucursalId, rolId: (await rolCon("sin-cierre", [])).id });
  // El «operador»: las siete filas prendidas a mano. El piso administrador del ajuste manda sobre la fila.
  actores.operador = await crearUsuarioConMembresia({ email: "operador-cierre@test.com", sucursalId: s.sucursalId, rolId: (await rolCon("operador-cierre", TODAS)).id });
  for (const exacta of DE_OPERARIO) {
    actores[`solo-${exacta}`] = await crearUsuarioConMembresia({ email: `solo-${exacta}@test.com`, sucursalId: s.sucursalId, rolId: (await rolCon(`solo-${exacta}`, [exacta])).id });
  }
});

afterAll(() => {
  __setCookieDeTestParaSucursal(undefined);
});

interface Accion {
  nombre: string;
  exige: Clave;
  /** Quién la tiene con el permiso exacto (el piso manda: la de piso administrador solo la alcanza el administrador). */
  exacto: string;
  /** Prepara lo que la acción necesita (corre como administrador) y devuelve la llamada. */
  preparar: () => Promise<() => Promise<{ ok: boolean; mensaje: string; codigo?: string; yaExistia?: boolean }>>;
}

const ACCIONES: Accion[] = [
  {
    nombre: "iniciarAuditoriaDeJornada",
    exige: "caja_jornada_iniciar_auditoria",
    exacto: "solo-caja_jornada_iniciar_auditoria",
    preparar: async () => {
      const d = await diaConLaCajaCerrada();
      return () => iniciarAuditoriaDeJornada({ fechaDeNegocio: d.fecha });
    },
  },
  {
    nombre: "cancelarAuditoriaDeJornada",
    exige: "caja_jornada_cancelar_auditoria",
    exacto: "solo-caja_jornada_cancelar_auditoria",
    preparar: async () => {
      const d = await diaEnAuditoria();
      return () => cancelarAuditoriaDeJornada({ fechaDeNegocio: d.fecha });
    },
  },
  {
    nombre: "corregirMedioDeCobroDeCaja",
    exige: "caja_corregir_medio_de_cobro",
    exacto: "solo-caja_corregir_medio_de_cobro",
    preparar: async () => {
      const d = await diaEnAuditoria();
      const qr = await medio("QR");
      const clave = claveNueva();
      return () => corregirMedioDeCobroDeCaja({ claveIdempotencia: clave, cobroId: d.cobroId, medioDestinoId: qr.id, motivo: "Se cargó en el medio equivocado" });
    },
  },
  {
    nombre: "declararTotalDeMedio",
    exige: "caja_declarar_total",
    exacto: "solo-caja_declarar_total",
    preparar: async () => {
      const d = await diaEnAuditoria();
      const qr = await medio("QR");
      const clave = claveNueva();
      return () => declararTotalDeMedio({ claveIdempotencia: clave, fechaDeNegocio: d.fecha, medioDePagoId: qr.id, importe: "100" });
    },
  },
  {
    nombre: "darConformeGeneralDeJornada",
    exige: "caja_declarar_total",
    exacto: "solo-caja_declarar_total",
    preparar: async () => {
      const d = await diaEnAuditoria();
      const clave = claveNueva();
      return () => darConformeGeneralDeJornada({ claveIdempotencia: clave, fechaDeNegocio: d.fecha });
    },
  },
  {
    nombre: "cerrarJornadaDeCaja",
    exige: "caja_jornada_cerrar",
    exacto: "solo-caja_jornada_cerrar",
    preparar: async () => {
      const d = await diaEnAuditoria();
      await como(s.admin);
      const { huella } = await leerControlesDeJornada(d.fecha);
      return () => cerrarJornadaDeCaja({ fechaDeNegocio: d.fecha, huellaVista: huella, reconocimientos: [], observacion: null });
    },
  },
  {
    nombre: "registrarAjusteDeCaja",
    exige: "caja_registrar_ajuste",
    exacto: "admin",
    preparar: async () => {
      await como(s.admin);
      const abierta = await abrirSesionDeCaja({ claveIdempotencia: claveNueva(), fondo: "100" });
      await forzarJornadaCerrada(PASADO);
      const ef = await efectivoId();
      const clave = claveNueva();
      return () => registrarAjusteDeCaja({ claveIdempotencia: clave, sesionId: abierta.sesionId!, medioDePagoId: ef, importe: "-5", motivo: "Faltó un vale", corrigeJornada: PASADO });
    },
  },
];

const actorPorNombre = (nombre: string) => (nombre === "admin" ? s.admin : actores[nombre]!);

describe("cada acción del cierre del día verifica en el servidor el permiso EXACTO, sin tocar la base", () => {
  it.each(ACCIONES.map((a) => [a.nombre, a] as const))("(a) con todas las claves del cierre MENOS la que exige: %s rechaza y no cambia nada", async (_n, a) => {
    const llamar = await a.preparar();
    const antes = await foto();
    await como(actores[`menos-${a.exige}`]!);
    expect(await llamar()).toMatchObject({ ok: false, mensaje: DICHO_POR_PERMISO });
    expect(await foto(), `${a.nombre}: la base cambió`).toEqual(antes);
  });

  it.each(ACCIONES.map((a) => [a.nombre, a] as const))("(b) sin ninguna clave: %s rechaza y no cambia nada", async (_n, a) => {
    const llamar = await a.preparar();
    const antes = await foto();
    await como(actores.ninguna!);
    expect(await llamar()).toMatchObject({ ok: false, mensaje: DICHO_POR_PERMISO });
    expect(await foto()).toEqual(antes);
  });

  it.each(ACCIONES.map((a) => [a.nombre, a] as const))("(c) con el permiso exacto: %s pasa", async (_n, a) => {
    const llamar = await a.preparar();
    await como(actorPorNombre(a.exacto));
    expect(await llamar(), `${a.nombre} no pasó con ${a.exige}`).toMatchObject({ ok: true });
  });

  it("(c2) darConformeGeneralDeJornada y declararTotalDeMedio comparten la MISMA clave: con solo `caja_declarar_total` pasan las dos; con todas las demás, ninguna", async () => {
    const d = await diaEnAuditoria();
    await como(actores["menos-caja_declarar_total"]!);
    expect(await darConformeGeneralDeJornada({ claveIdempotencia: claveNueva(), fechaDeNegocio: d.fecha })).toMatchObject({ ok: false, mensaje: DICHO_POR_PERMISO });
    expect(await declararTotalDeMedio({ claveIdempotencia: claveNueva(), fechaDeNegocio: d.fecha, medioDePagoId: (await medio("QR")).id, importe: "1" })).toMatchObject({ ok: false, mensaje: DICHO_POR_PERMISO });
    await como(actores["solo-caja_declarar_total"]!);
    expect(await darConformeGeneralDeJornada({ claveIdempotencia: claveNueva(), fechaDeNegocio: d.fecha })).toMatchObject({ ok: true });
  });

  it("(d) el permiso se pide ANTES que el formato; con permiso, un rechazo de formato dice el código y el dato y no toca la base", async () => {
    await como(actores.ninguna!);
    expect(await iniciarAuditoriaDeJornada({ fechaDeNegocio: "no-es-una-fecha" })).toMatchObject({ ok: false, mensaje: DICHO_POR_PERMISO });
    await como(s.admin);
    const antes = await foto();
    const u = randomUUID();
    const casos: Array<[string, () => Promise<{ ok: boolean; codigo?: string; campo?: string }>, string, string]> = [
      ["iniciar con fecha inventada", () => iniciarAuditoriaDeJornada({ fechaDeNegocio: "2026-02-30" }), "FECHA_INVALIDA", "fechaDeNegocio"],
      ["iniciar con la fecha en otro formato", () => iniciarAuditoriaDeJornada({ fechaDeNegocio: "17/11/2026" }), "FECHA_INVALIDA", "fechaDeNegocio"],
      ["cancelar sin la fecha", () => cancelarAuditoriaDeJornada({} as never), "FECHA_INVALIDA", "fechaDeNegocio"],
      ["cancelar con una entrada que no es objeto", () => cancelarAuditoriaDeJornada(null as never), "ENTRADA_INVALIDA", "entrada"],
      ["corregir con clave que no es UUID", () => corregirMedioDeCobroDeCaja({ claveIdempotencia: "x", cobroId: u, medioDestinoId: u, motivo: "Equivocado" }), "CLAVE_INVALIDA", "claveIdempotencia"],
      ["corregir con cobro que no es UUID", () => corregirMedioDeCobroDeCaja({ claveIdempotencia: u, cobroId: "x", medioDestinoId: u, motivo: "Equivocado" }), "IDENTIFICADOR_INVALIDO", "cobroId"],
      ["corregir sin motivo", () => corregirMedioDeCobroDeCaja({ claveIdempotencia: u, cobroId: u, medioDestinoId: u, motivo: "   " }), "MOTIVO_INVALIDO", "motivo"],
      ["declarar con importe con coma", () => declararTotalDeMedio({ claveIdempotencia: u, fechaDeNegocio: "2026-01-08", medioDePagoId: u, importe: "1,5" }), "IMPORTE_INVALIDO", "importe"],
      ["declarar con importe negativo", () => declararTotalDeMedio({ claveIdempotencia: u, fechaDeNegocio: "2026-01-08", medioDePagoId: u, importe: "-1" }), "IMPORTE_INVALIDO", "importe"],
      ["declarar con importe número", () => declararTotalDeMedio({ claveIdempotencia: u, fechaDeNegocio: "2026-01-08", medioDePagoId: u, importe: 10 as never }), "IMPORTE_INVALIDO", "importe"],
      ["conforme con clave inválida", () => darConformeGeneralDeJornada({ claveIdempotencia: "", fechaDeNegocio: "2026-01-08" }), "CLAVE_INVALIDA", "claveIdempotencia"],
      ["cerrar con huella corta", () => cerrarJornadaDeCaja({ fechaDeNegocio: "2026-01-08", huellaVista: "abc", reconocimientos: [], observacion: null }), "HUELLA_INVALIDA", "huellaVista"],
      ["cerrar con huella en mayúsculas", () => cerrarJornadaDeCaja({ fechaDeNegocio: "2026-01-08", huellaVista: "A".repeat(64), reconocimientos: [], observacion: null }), "HUELLA_INVALIDA", "huellaVista"],
      ["cerrar con reconocimientos que no son lista", () => cerrarJornadaDeCaja({ fechaDeNegocio: "2026-01-08", huellaVista: "a".repeat(64), reconocimientos: "caja.x" as never, observacion: null }), "RECONOCIMIENTOS_INVALIDOS", "reconocimientos"],
      ["cerrar con clave de control inválida", () => cerrarJornadaDeCaja({ fechaDeNegocio: "2026-01-08", huellaVista: "a".repeat(64), reconocimientos: [{ clave: "CAJA.X", texto: null }], observacion: null }), "RECONOCIMIENTOS_INVALIDOS", "reconocimientos.0.clave"],
      ["cerrar con observación con caracteres que no se admiten", () => cerrarJornadaDeCaja({ fechaDeNegocio: "2026-01-08", huellaVista: "a".repeat(64), reconocimientos: [], observacion: "<script>" }), "OBSERVACION_INVALIDA", "observacion"],
      ["ajuste con importe cero", () => registrarAjusteDeCaja({ claveIdempotencia: u, sesionId: u, medioDePagoId: u, importe: "0", motivo: "Faltó un vale", corrigeJornada: "2026-01-08" }), "IMPORTE_INVALIDO", "importe"],
      ["ajuste con importe solo el signo", () => registrarAjusteDeCaja({ claveIdempotencia: u, sesionId: u, medioDePagoId: u, importe: "-", motivo: "Faltó un vale", corrigeJornada: "2026-01-08" }), "IMPORTE_INVALIDO", "importe"],
      ["ajuste con signo más", () => registrarAjusteDeCaja({ claveIdempotencia: u, sesionId: u, medioDePagoId: u, importe: "+5", motivo: "Faltó un vale", corrigeJornada: "2026-01-08" }), "IMPORTE_INVALIDO", "importe"],
      ["ajuste sin la jornada que corrige", () => registrarAjusteDeCaja({ claveIdempotencia: u, sesionId: u, medioDePagoId: u, importe: "5", motivo: "Faltó un vale", corrigeJornada: null as never }), "FECHA_INVALIDA", "corrigeJornada"],
      ["ajuste con sesión que no es UUID", () => registrarAjusteDeCaja({ claveIdempotencia: u, sesionId: "x", medioDePagoId: u, importe: "5", motivo: "Faltó un vale", corrigeJornada: "2026-01-08" }), "IDENTIFICADOR_INVALIDO", "sesionId"],
    ];
    for (const [nombre, llamar, codigo, campo] of casos) expect(await llamar(), nombre).toMatchObject({ ok: false, codigo, campo });
    expect(await foto()).toEqual(antes);
  });
});

describe("el operador NO registra ajustes aunque tenga la fila prendida a mano (el piso administrador manda)", () => {
  it("con las siete filas prendidas, `registrarAjusteDeCaja` lo rechaza por permiso al operador, sin escribir", async () => {
    await como(s.admin);
    const abierta = await abrirSesionDeCaja({ claveIdempotencia: claveNueva(), fondo: "100" });
    await forzarJornadaCerrada(PASADO);
    const antes = await foto();
    await como(actores.operador!);
    expect(await registrarAjusteDeCaja({ claveIdempotencia: claveNueva(), sesionId: abierta.sesionId!, medioDePagoId: await efectivoId(), importe: "-5", motivo: "Faltó un vale", corrigeJornada: PASADO })).toMatchObject({ ok: false, mensaje: DICHO_POR_PERMISO });
    expect(await foto()).toEqual(antes);
    expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "AJUSTE" } })).toBe(0);
  });

  it("con esas mismas filas el operador sí inicia el cierre del día (piso operario)", async () => {
    const d = await diaConLaCajaCerrada();
    await como(actores.operador!);
    expect(await iniciarAuditoriaDeJornada({ fechaDeNegocio: d.fecha })).toMatchObject({ ok: true });
  });

  it("el administrador sí registra el ajuste y queda un solo movimiento AJUSTE enlazado a la jornada cerrada", async () => {
    await como(s.admin);
    const abierta = await abrirSesionDeCaja({ claveIdempotencia: claveNueva(), fondo: "100" });
    await forzarJornadaCerrada(PASADO);
    const r = await registrarAjusteDeCaja({ claveIdempotencia: claveNueva(), sesionId: abierta.sesionId!, medioDePagoId: await efectivoId(), importe: "-5.50", motivo: "Faltó un vale", corrigeJornada: PASADO });
    expect(r).toMatchObject({ ok: true, yaExistia: false });
    const mov = await prismaAdmin.movimientoCaja.findFirstOrThrow({ where: { clase: "AJUSTE" } });
    expect(mov.id).toBe(r.movimientoId);
    expect(mov.importe.toString()).toBe("-5.5");
    expect(mov.corrigeJornada?.toISOString().slice(0, 10)).toBe(PASADO);
  });
});

describe("«¿qué pasa si…?» el permiso cambia a mitad de camino", () => {
  it.each(ACCIONES.filter((a) => a.exacto !== "admin").map((a) => [a.nombre, a] as const))("%s: pasa con la clave y, revocada la fila, rechaza por permiso aunque sea el MISMO pedido (no devuelve `yaExistia`) y no toca la base", async (_n, a) => {
    const llamar = await a.preparar();
    const usuario = actorPorNombre(a.exacto);
    await como(usuario);
    expect(await llamar()).toMatchObject({ ok: true });
    const antes = await foto();
    const { rolId } = await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: usuario.id } });
    await prisma.permisoRol.updateMany({ where: { rolId, accionClave: a.exige }, data: { puedeEditar: false, puedeVer: false } });
    const r = await llamar();
    expect(r).toMatchObject({ ok: false, mensaje: DICHO_POR_PERMISO });
    expect(r.yaExistia).toBeUndefined();
    expect(await foto()).toEqual(antes);
    // Se le vuelve a dar: el permiso se mira en cada llamada.
    await prisma.permisoRol.updateMany({ where: { rolId, accionClave: a.exige }, data: { puedeEditar: true, puedeVer: true } });
    expect(await llamar()).toMatchObject({ ok: true });
  });

  it("con la membresía desactivada con la pestaña abierta, rechaza o lleva al login, sin tocar la base (un operador sin fila o sin acceso no cierra nada)", async () => {
    const d = await diaConLaCajaCerrada();
    const usuario = actores["solo-caja_jornada_iniciar_auditoria"]!;
    await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: usuario.id }, data: { activo: false } });
    await como(usuario);
    const antes = await foto();
    await expect(iniciarAuditoriaDeJornada({ fechaDeNegocio: d.fecha })).rejects.toThrow();
    expect(await foto()).toEqual(antes);
  });
});

describe("el resultado de cada acción es el del caso de uso real", () => {
  it("iniciar y cancelar el cierre del día: la jornada cambia de estado y repetir (doble clic) no escribe ni audita de nuevo", async () => {
    const d = await diaConLaCajaCerrada();
    await como(s.admin);
    expect(await iniciarAuditoriaDeJornada({ fechaDeNegocio: d.fecha })).toMatchObject({ ok: true, yaEstabaEnAuditoria: false });
    const auditoria = await prismaAdmin.registroAuditoria.count();
    expect(await iniciarAuditoriaDeJornada({ fechaDeNegocio: d.fecha })).toMatchObject({ ok: true, yaEstabaEnAuditoria: true });
    expect(await prismaAdmin.registroAuditoria.count()).toBe(auditoria);
    expect((await prismaAdmin.jornadaDeSucursal.findFirstOrThrow()).estado).toBe("EN_AUDITORIA");
    expect(await cancelarAuditoriaDeJornada({ fechaDeNegocio: d.fecha })).toMatchObject({ ok: true, yaEstabaAbierta: false });
    expect(await cancelarAuditoriaDeJornada({ fechaDeNegocio: d.fecha })).toMatchObject({ ok: true, yaEstabaAbierta: true });
    expect((await prismaAdmin.jornadaDeSucursal.findFirstOrThrow()).estado).toBe("ABIERTA");
    // Una fecha sin actividad: no hay nada que cerrar.
    expect(await iniciarAuditoriaDeJornada({ fechaDeNegocio: "2026-01-02" })).toMatchObject({ ok: false, codigo: "JORNADA_NO_ENCONTRADA" });
  });

  it("iniciar con una caja abierta responde JORNADA_CON_IMPEDIMENTOS con los controles que impiden, y no cambia la jornada", async () => {
    await como(s.admin);
    const abierta = await abrirSesionDeCaja({ claveIdempotencia: claveNueva(), fondo: "100" });
    const fecha = await fechaDe(abierta.sesionId!);
    const r = await iniciarAuditoriaDeJornada({ fechaDeNegocio: fecha });
    expect(r).toMatchObject({ ok: false, codigo: "JORNADA_CON_IMPEDIMENTOS" });
    expect(r.impedimentos?.map((i) => i.clave)).toContain("caja.sesiones_sin_cerrar");
    expect((await prismaAdmin.jornadaDeSucursal.findFirstOrThrow()).estado).toBe("ABIERTA");
  });

  it("corregir el medio de un cobro, declarar el total y dar el conforme: devuelven los ids y la secuencia; la misma clave y el mismo pedido devuelven `yaExistia`; la misma clave con otro pedido es CLAVE_REUTILIZADA", async () => {
    const d = await diaEnAuditoria();
    const qr = await medio("QR");
    const otro = await medio("TARJETA_DEBITO");
    await como(s.admin);
    const claveCorreccion = claveNueva();
    const pedidoCorreccion = { claveIdempotencia: claveCorreccion, cobroId: d.cobroId, medioDestinoId: qr.id, motivo: "Se cargó en el medio equivocado" };
    const c1 = await corregirMedioDeCobroDeCaja(pedidoCorreccion);
    expect(c1).toMatchObject({ ok: true, yaExistia: false, secuencia: 1 });
    expect(typeof c1.correccionId).toBe("string");
    expect(await corregirMedioDeCobroDeCaja(pedidoCorreccion)).toMatchObject({ ok: true, yaExistia: true, correccionId: c1.correccionId });
    expect(await corregirMedioDeCobroDeCaja({ ...pedidoCorreccion, medioDestinoId: otro.id })).toMatchObject({ ok: false, codigo: "CLAVE_REUTILIZADA" });
    expect(await prismaAdmin.correccionDeMedio.count()).toBe(1);

    const claveDeclaracion = claveNueva();
    const pedidoDeclaracion = { claveIdempotencia: claveDeclaracion, fechaDeNegocio: d.fecha, medioDePagoId: qr.id, importe: "6000" };
    const t1 = await declararTotalDeMedio(pedidoDeclaracion);
    expect(t1).toMatchObject({ ok: true, yaExistia: false, secuencia: 1 });
    expect(await declararTotalDeMedio(pedidoDeclaracion)).toMatchObject({ ok: true, yaExistia: true, declaracionId: t1.declaracionId });
    expect(await declararTotalDeMedio({ ...pedidoDeclaracion, importe: "6001" })).toMatchObject({ ok: false, codigo: "CLAVE_REUTILIZADA" });
    expect(await declararTotalDeMedio({ claveIdempotencia: claveNueva(), fechaDeNegocio: d.fecha, medioDePagoId: d.ef, importe: "1" })).toMatchObject({ ok: false, codigo: "MEDIO_NO_DECLARABLE" });
    expect(await prismaAdmin.declaracionDeTotal.count()).toBe(1);

    const claveConforme = claveNueva();
    const k1 = await darConformeGeneralDeJornada({ claveIdempotencia: claveConforme, fechaDeNegocio: d.fecha });
    expect(k1).toMatchObject({ ok: true, yaExistia: false });
    expect(await darConformeGeneralDeJornada({ claveIdempotencia: claveConforme, fechaDeNegocio: d.fecha })).toMatchObject({ ok: true, yaExistia: true, conformeId: k1.conformeId });
    expect(await darConformeGeneralDeJornada({ claveIdempotencia: claveConforme, fechaDeNegocio: "2026-01-08" })).toMatchObject({ ok: false, codigo: "CLAVE_REUTILIZADA" });
    expect(await prismaAdmin.conformeDeJornada.count()).toBe(1);
  });

  it("corregir, declarar y dar el conforme con la jornada ABIERTA responden JORNADA_NO_EN_AUDITORIA y no escriben", async () => {
    const d = await diaConLaCajaCerrada();
    const qr = await medio("QR");
    await como(s.admin);
    const antes = await foto();
    expect(await corregirMedioDeCobroDeCaja({ claveIdempotencia: claveNueva(), cobroId: d.cobroId, medioDestinoId: qr.id, motivo: "Equivocado" })).toMatchObject({ ok: false, codigo: "JORNADA_NO_EN_AUDITORIA" });
    expect(await declararTotalDeMedio({ claveIdempotencia: claveNueva(), fechaDeNegocio: d.fecha, medioDePagoId: qr.id, importe: "1" })).toMatchObject({ ok: false, codigo: "JORNADA_NO_EN_AUDITORIA" });
    expect(await darConformeGeneralDeJornada({ claveIdempotencia: claveNueva(), fechaDeNegocio: d.fecha })).toMatchObject({ ok: false, codigo: "JORNADA_NO_EN_AUDITORIA" });
    expect(await foto()).toEqual(antes);
  });

  it("cerrar el día: con la huella que vio la pantalla cierra y devuelve la foto de los controles; repetir lo mismo es `yaEstabaCerrada`; otra huella o con los controles cambiados responde con su código", async () => {
    const d = await diaEnAuditoria();
    await como(s.admin);
    const { huella, controles } = await leerControlesDeJornada(d.fecha);
    expect(huella).toMatch(/^[0-9a-f]{64}$/);
    expect(controles.length).toBeGreaterThan(0);
    // Una huella que no es la de ahora: nada se cierra con algo que nadie vio; devuelve los controles de ahora y su huella.
    const vieja = await cerrarJornadaDeCaja({ fechaDeNegocio: d.fecha, huellaVista: "b".repeat(64), reconocimientos: [], observacion: null });
    expect(vieja).toMatchObject({ ok: false, codigo: "CONTROLES_CAMBIARON", huellaActual: huella });
    expect(Array.isArray(vieja.controles)).toBe(true);
    expect((await prismaAdmin.jornadaDeSucursal.findFirstOrThrow()).estado).toBe("EN_AUDITORIA");

    const pedido = { fechaDeNegocio: d.fecha, huellaVista: huella, reconocimientos: [], observacion: "Cierre sin novedades" };
    const r = await cerrarJornadaDeCaja(pedido);
    expect(r).toMatchObject({ ok: true, yaEstabaCerrada: false });
    expect(r.controles?.length).toBe(controles.length);
    expect((await prismaAdmin.jornadaDeSucursal.findFirstOrThrow()).estado).toBe("CERRADA");
    expect(await cerrarJornadaDeCaja(pedido)).toMatchObject({ ok: true, yaEstabaCerrada: true });
    expect(await cerrarJornadaDeCaja({ ...pedido, observacion: "Otra observación" })).toMatchObject({ ok: false, codigo: "JORNADA_CERRADA" });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "JornadaDeSucursal", valorAnterior: "EN_AUDITORIA" } })).toBe(1);
  });

  it("registrarAjusteDeCaja: misma clave y mismo pedido devuelve `yaExistia`; otro importe con la misma clave es CLAVE_REUTILIZADA; una jornada que no está cerrada o no es anterior se rechaza con su código", async () => {
    await como(s.admin);
    const abierta = await abrirSesionDeCaja({ claveIdempotencia: claveNueva(), fondo: "100" });
    const hoy = await fechaDe(abierta.sesionId!);
    await forzarJornadaCerrada(PASADO);
    const ef = await efectivoId();
    const pedido = { claveIdempotencia: claveNueva(), sesionId: abierta.sesionId!, medioDePagoId: ef, importe: "-5", motivo: "Faltó un vale", corrigeJornada: PASADO };
    const a1 = await registrarAjusteDeCaja(pedido);
    expect(a1).toMatchObject({ ok: true, yaExistia: false });
    expect(await registrarAjusteDeCaja(pedido)).toMatchObject({ ok: true, yaExistia: true, movimientoId: a1.movimientoId });
    expect(await registrarAjusteDeCaja({ ...pedido, importe: "-6" })).toMatchObject({ ok: false, codigo: "CLAVE_REUTILIZADA" });
    expect(await registrarAjusteDeCaja({ ...pedido, claveIdempotencia: claveNueva(), corrigeJornada: "2026-01-02" })).toMatchObject({ ok: false, codigo: "JORNADA_A_CORREGIR_NO_ENCONTRADA" });
    expect(await registrarAjusteDeCaja({ ...pedido, claveIdempotencia: claveNueva(), corrigeJornada: hoy })).toMatchObject({ ok: false, codigo: "JORNADA_A_CORREGIR_NO_CERRADA" });
    expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "AJUSTE" } })).toBe(1);
  });
});

describe("concurrencia por las acciones reales (carreras de verdad)", () => {
  it("seis cerrarJornadaDeCaja a la vez cierran UNA vez: todas responden bien, una sola foto de controles y una sola auditoría; ninguna lanza", async () => {
    const d = await diaEnAuditoria();
    await como(s.admin);
    const { huella } = await leerControlesDeJornada(d.fecha);
    const pedido = { fechaDeNegocio: d.fecha, huellaVista: huella, reconocimientos: [], observacion: null };
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => cerrarJornadaDeCaja(pedido)));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok), JSON.stringify(rs.map((x) => (x.status === "fulfilled" ? (x.value.codigo ?? x.value.ok) : "LANZÓ")))).toBe(true);
    expect(rs.filter((x) => x.status === "fulfilled" && x.value.yaEstabaCerrada === false)).toHaveLength(1);
    expect(await prismaAdmin.cierreDeCajaDeJornada.count()).toBe(1);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "JornadaDeSucursal", valorAnterior: "EN_AUDITORIA" } })).toBe(1);
  });

  it("ocho iniciarAuditoriaDeJornada a la vez cambian el estado UNA vez y auditan una sola vez; ocho cancelar, lo mismo", async () => {
    const d = await diaConLaCajaCerrada();
    await como(s.admin);
    const ini = await Promise.allSettled(Array.from({ length: 8 }, () => iniciarAuditoriaDeJornada({ fechaDeNegocio: d.fecha })));
    expect(ini.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(ini.filter((x) => x.status === "fulfilled" && x.value.yaEstabaEnAuditoria === false)).toHaveLength(1);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "JornadaDeSucursal", valorNuevo: "EN_AUDITORIA" } })).toBe(1);
    const can = await Promise.allSettled(Array.from({ length: 8 }, () => cancelarAuditoriaDeJornada({ fechaDeNegocio: d.fecha })));
    expect(can.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(can.filter((x) => x.status === "fulfilled" && x.value.yaEstabaAbierta === false)).toHaveLength(1);
  });

  it("seis declararTotalDeMedio con la MISMA clave a la vez dejan una sola declaración y todas devuelven lo mismo", async () => {
    const d = await diaEnAuditoria();
    const qr = await medio("QR");
    await como(s.admin);
    const pedido = { claveIdempotencia: claveNueva(), fechaDeNegocio: d.fecha, medioDePagoId: qr.id, importe: "100" };
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => declararTotalDeMedio(pedido)));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(new Set(rs.map((x) => (x.status === "fulfilled" ? x.value.declaracionId : "")).filter(Boolean)).size).toBe(1);
    expect(await prismaAdmin.declaracionDeTotal.count()).toBe(1);
  });

  it("empezar el cierre del día contra cerrar la caja a la vez: nunca queda la jornada en cierre con una caja sin cerrar, y ninguna acción lanza", async () => {
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      await limpiarBaseDeTest();
      s = await sembrarSalon();
      await como(s.admin);
      const abierta = await abrirSesionDeCaja({ claveIdempotencia: claveNueva(), fondo: "0" });
      const sesionId = abierta.sesionId!;
      const fecha = await fechaDe(sesionId);
      expect(await iniciarCierreDeSesionDeCaja({ sesionId })).toMatchObject({ ok: true });
      const rs = await Promise.allSettled([iniciarAuditoriaDeJornada({ fechaDeNegocio: fecha }), cerrarSesionDeCaja({ sesionId, billetes: {}, monedas: "0", conformeDeLosDemasMedios: false, observacion: null })]);
      expect(rs.every((x) => x.status === "fulfilled"), `vuelta ${vuelta}`).toBe(true);
      const j = await prismaAdmin.jornadaDeSucursal.findFirstOrThrow();
      const sesion = await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: sesionId } });
      if (j.estado === "EN_AUDITORIA") expect(sesion.estado, `vuelta ${vuelta}`).toBe("CERRADA");
      else expect(j.estado).toBe("ABIERTA");
    }
  });

  it("abrir la caja contra empezar el cierre del día a la vez: o la caja se abre y el cierre ve el impedimento, o el cierre empieza y no queda ninguna caja abierta", async () => {
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      await limpiarBaseDeTest();
      s = await sembrarSalon();
      const d = await diaConLaCajaCerrada();
      await como(s.admin);
      const rs = await Promise.allSettled([abrirSesionDeCaja({ claveIdempotencia: claveNueva(), fondo: "0" }), iniciarAuditoriaDeJornada({ fechaDeNegocio: d.fecha })]);
      expect(rs.every((x) => x.status === "fulfilled"), `vuelta ${vuelta}`).toBe(true);
      const j = await prismaAdmin.jornadaDeSucursal.findFirstOrThrow();
      const abiertas = await prismaAdmin.sesionCaja.count({ where: { estado: "ABIERTA" } });
      if (j.estado === "EN_AUDITORIA") expect(abiertas, `vuelta ${vuelta}`).toBe(0);
    }
  });
});

describe("una sucursal no ve ni toca el cierre del día de otra", () => {
  it("las acciones desde otra sucursal no encuentran la jornada, el cobro ni la sesión de la primera y la base no cambia; las lecturas devuelven lo propio (nada)", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const rolAdmin = (await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: s.admin.id } })).rolId;
    const adminNorte = await crearUsuarioConMembresia({ email: "admin-norte-cierre@test.com", sucursalId: norte.id, rolId: rolAdmin });
    const d = await diaEnAuditoria();
    const qr = await medio("QR");
    await como(adminNorte);
    const antes = await foto();
    expect(await iniciarAuditoriaDeJornada({ fechaDeNegocio: d.fecha })).toMatchObject({ ok: false, codigo: "JORNADA_NO_ENCONTRADA" });
    expect(await cancelarAuditoriaDeJornada({ fechaDeNegocio: d.fecha })).toMatchObject({ ok: false, codigo: "JORNADA_NO_ENCONTRADA" });
    expect(await corregirMedioDeCobroDeCaja({ claveIdempotencia: claveNueva(), cobroId: d.cobroId, medioDestinoId: qr.id, motivo: "Intruso" })).toMatchObject({ ok: false, codigo: "COBRO_NO_ENCONTRADO" });
    expect(await declararTotalDeMedio({ claveIdempotencia: claveNueva(), fechaDeNegocio: d.fecha, medioDePagoId: qr.id, importe: "1" })).toMatchObject({ ok: false, codigo: "JORNADA_NO_ENCONTRADA" });
    expect(await darConformeGeneralDeJornada({ claveIdempotencia: claveNueva(), fechaDeNegocio: d.fecha })).toMatchObject({ ok: false, codigo: "JORNADA_NO_ENCONTRADA" });
    expect(await cerrarJornadaDeCaja({ fechaDeNegocio: d.fecha, huellaVista: "a".repeat(64), reconocimientos: [], observacion: null })).toMatchObject({ ok: false, codigo: "JORNADA_NO_ENCONTRADA" });
    expect(await registrarAjusteDeCaja({ claveIdempotencia: claveNueva(), sesionId: d.sesionId, medioDePagoId: d.ef, importe: "-5", motivo: "Intruso", corrigeJornada: PASADO })).toMatchObject({ ok: false, codigo: "SESION_NO_ENCONTRADA" });
    expect(await foto()).toEqual(antes);
    expect(await leerEstadoDeJornada(d.fecha)).toBeNull();
    expect((await leerJornadasDeCaja()).items).toEqual([]);
    expect(await leerConciliacionDeJornada(d.fecha)).toBeNull();
    // Los controles de una fecha sin actividad propia salen vacíos de hallazgos: nada de la jornada de la otra sucursal.
    const propios = await leerControlesDeJornada(d.fecha);
    expect(propios.estadoDeLaJornada).toBeNull();
    expect(propios.conciliacion).toEqual([]);
    expect(propios.controles.every((c) => c.cantidad === 0)).toBe(true);
  });
});

describe("las lecturas del cierre del día piden `caja_jornada_ver` en la sucursal activa", () => {
  it("sin `caja_jornada_ver` las cuatro lanzan y no devuelven datos; con otras claves del cierre (pero no ella) también", async () => {
    const d = await diaConLaCajaCerrada();
    for (const nombre of ["ninguna", "menos-caja_jornada_ver", "solo-caja_jornada_cerrar", "solo-caja_declarar_total"]) {
      await como(actores[nombre]!);
      await expect(leerEstadoDeJornada(d.fecha), nombre).rejects.toThrow(/permiso|acceso|No tenés|no tiene/i);
      await expect(leerControlesDeJornada(d.fecha), nombre).rejects.toThrow(/permiso|acceso|No tenés|no tiene/i);
      await expect(leerJornadasDeCaja(), nombre).rejects.toThrow(/permiso|acceso|No tenés|no tiene/i);
      await expect(leerConciliacionDeJornada(d.fecha), nombre).rejects.toThrow(/permiso|acceso|No tenés|no tiene/i);
    }
    await como(actores["solo-caja_jornada_ver"]!);
    expect((await leerEstadoDeJornada(d.fecha))?.fechaDeNegocio).toBe(d.fecha);
  });

  it("la fecha que no es un día real se rechaza antes de leer nada", async () => {
    await como(s.admin);
    await expect(leerEstadoDeJornada("2026-13-40")).rejects.toThrow(/fecha/i);
    await expect(leerControlesDeJornada("ayer")).rejects.toThrow(/fecha/i);
    await expect(leerConciliacionDeJornada("")).rejects.toThrow(/fecha/i);
    expect(await leerJornadasDeCaja("no-es-un-id")).toEqual({ items: [], nextCursor: null });
  });

  it("el estado de la jornada, sus controles con la huella y la conciliación congelada de la jornada cerrada (importes en centavos como TEXTO)", async () => {
    const d = await diaEnAuditoria();
    await como(s.admin);
    const estado = await leerEstadoDeJornada(d.fecha);
    expect(estado).toMatchObject({ fechaDeNegocio: d.fecha, estado: "EN_AUDITORIA" });
    expect(estado?.sesiones).toEqual([expect.objectContaining({ sesionId: d.sesionId, estado: "CERRADA" })]);
    expect(await leerEstadoDeJornada("2026-01-02")).toBeNull();
    expect(await leerConciliacionDeJornada(d.fecha)).toBeNull(); // todavía no está cerrada: no hay foto

    const vistos = await leerControlesDeJornada(d.fecha);
    expect(vistos).toMatchObject({ fechaDeNegocio: d.fecha, estadoDeLaJornada: "EN_AUDITORIA" });
    const efectivo = vistos.conciliacion.find((l) => l.medioDePagoId === d.ef);
    // 100 de fondo + 6000 cobrados en efectivo, en centavos y como texto.
    expect(efectivo).toMatchObject({ tipoDeMedio: "EFECTIVO", registradoEnCentavos: "610000", correccionesEnCentavos: "0" });
    expect(typeof efectivo?.registradoEnCentavos).toBe("string");
    expect(JSON.stringify(vistos)).not.toMatch(/"(registrado|declarado|diferencia)EnCentavos":\s*\d/);
    // La huella de la lectura es la que `cerrarJornadaDeCaja` vuelve a calcular: con ella cierra.
    expect(await cerrarJornadaDeCaja({ fechaDeNegocio: d.fecha, huellaVista: vistos.huella, reconocimientos: [], observacion: null })).toMatchObject({ ok: true, yaEstabaCerrada: false });

    const congelada = await leerConciliacionDeJornada(d.fecha);
    expect(congelada).toMatchObject({ fechaDeNegocio: d.fecha, cerradaPorId: s.admin.id, huellaDeCierre: vistos.huella });
    const lineaEfectivo = congelada?.lineas.find((l) => l.medioDePagoId === d.ef);
    expect(lineaEfectivo).toMatchObject({ tipoDeMedio: "EFECTIVO", registradoEnCentavos: "610000", estadoDeConteo: "CONTADO" });
    expect(typeof lineaEfectivo?.diferenciaEnCentavos === "string" || lineaEfectivo?.diferenciaEnCentavos === null).toBe(true);
    expect(congelada?.controles.length).toBe(vistos.controles.length);
    expect((await leerEstadoDeJornada(d.fecha))?.estado).toBe("CERRADA");
  });

  it("la lista de jornadas viene de a páginas de 30, la fecha más reciente primero, y el cursor sigue sin repetir ni saltear", async () => {
    await como(s.admin);
    const fechas: string[] = [];
    for (let i = 0; i < 32; i++) {
      const dia = `2025-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;
      fechas.push(dia);
      await prismaAdmin.jornadaDeSucursal.create({ data: { id: randomUUID(), empresaId: EMPRESA, sucursalId: s.sucursalId, fechaDeNegocio: fechaDeColumnaDate(dia) } });
    }
    const p1 = await leerJornadasDeCaja();
    expect(p1.items).toHaveLength(30);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await leerJornadasDeCaja(p1.nextCursor!);
    expect(p2.items).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();
    const todas = [...p1.items, ...p2.items].map((i) => i.fechaDeNegocio);
    expect(todas).toEqual([...fechas].sort().reverse());
    expect(new Set([...p1.items, ...p2.items].map((i) => i.jornadaId)).size).toBe(32);
  });
});

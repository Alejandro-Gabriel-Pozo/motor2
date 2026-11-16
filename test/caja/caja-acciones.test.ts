import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { abrirSesionDeCaja, anularMovimientoDeCaja, cerrarSesionDeCaja, cobrarCuenta, registrarMovimientoDeCaja } from "../../src/server/actions/caja/caja";
import { ultimaSesionDeLaCaja, leerCobranzasDeSesion, leerCuentasSinCobrar, leerEstadoDeCaja, leerMediosDeCobro } from "../../src/server/actions/caja/lecturas-de-caja";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Caja y cobro C1, PR-B — las Server Actions y las lecturas de la caja contra Postgres real y la sesión simulada: permiso exacto de cada una (rechaza sin permiso y sin tocar la base), el operador cobra pero no cierra la caja (el PISO manda
 * aunque la fila exista), una sucursal no ve ni toca la caja de otra, el cambio de permisos a mitad (se pierde el permiso: rechaza aunque se repita la misma clave de reintento) y el formato (un rechazo de guard no toca la base).
 * Mutación: cambiar el permiso de una acción en `caja.ts` por otro `caja_*` deja en rojo «con todas MENOS la que exige»; sacar `requierePermiso` de `anularMovimientoDeCaja` (siempre `true`) deja en rojo «sin caja_anular_movimiento_ajeno».
 */
type Clave = "caja_ver" | "caja_abrir_sesion" | "caja_cerrar_sesion" | "caja_mover_efectivo" | "caja_anular_movimiento_ajeno" | "cobrar_cuenta";
const TODAS: readonly Clave[] = ["caja_ver", "caja_abrir_sesion", "caja_cerrar_sesion", "caja_mover_efectivo", "caja_anular_movimiento_ajeno", "cobrar_cuenta"];

let s: Awaited<ReturnType<typeof sembrarSalon>>;
const actores: Record<string, { id: string; email: string }> = {};
const como = (actor: { id: string; email: string }) => entrarComo(actor);

async function rolCon(nombre: string, claves: readonly Clave[]) {
  const rol = await prisma.rol.create({ data: { nombre } });
  await prisma.permisoRol.createMany({ data: claves.map((accionClave) => ({ rolId: rol.id, accionClave, puedeVer: true, puedeEditar: true })) });
  return rol;
}

const foto = async () => ({
  sesiones: await prismaAdmin.sesionCaja.count(),
  movimientos: await prismaAdmin.movimientoCaja.count(),
  cobranzas: await prismaAdmin.cobranza.count(),
  arqueos: await prismaAdmin.arqueoCaja.count(),
  auditoria: await prismaAdmin.registroAuditoria.count(),
});

async function cuentaCerrada(cantidad = 2, precio = 3000) {
  await como(s.admin);
  const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad, precioUnitario: precio, numeroEnvio: 1 }]);
  expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
  return cuenta;
}
/** El rol «admin» del usuario administrador del escenario (la clave del rol es lo que le da el piso de administrador). */
const rolDelAdmin = async () => (await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: s.admin.id } })).rolId;
const efectivoId = async () => (await prismaAdmin.medioDePago.findFirstOrThrow({ where: { tipo: "EFECTIVO" } })).id;
const conteoVacio = { billetes: {}, monedas: "0", conformeDeLosDemasMedios: false, observacion: null };

async function abrirComoAdmin(fondo = "100") {
  await como(s.admin);
  const r = await abrirSesionDeCaja({ claveIdempotencia: randomUUID(), fondo });
  expect(r).toMatchObject({ ok: true });
  return r.sesionId!;
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  __setCookieDeTestParaSucursal(undefined);
  s = await sembrarSalon();
  // Un actor por clave con TODAS menos esa, uno sin ninguna y uno con exactamente las del operario (ver, abrir, cobrar) más las de piso administrador (para probar que el PISO manda).
  for (const faltante of TODAS) {
    const rol = await rolCon(`todas-menos-${faltante}`, TODAS.filter((c) => c !== faltante));
    actores[`menos-${faltante}`] = await crearUsuarioConMembresia({ email: `menos-${faltante}@test.com`, sucursalId: s.sucursalId, rolId: rol.id });
  }
  actores.ninguna = await crearUsuarioConMembresia({ email: "ninguna@test.com", sucursalId: s.sucursalId, rolId: (await rolCon("sin-caja", [])).id });
  // El «operador de caja»: las tres de piso operario Y las de piso administrador con la fila prendida (la fila no alcanza: el piso manda).
  actores.cajero = await crearUsuarioConMembresia({ email: "cajero@test.com", sucursalId: s.sucursalId, rolId: (await rolCon("cajero", TODAS)).id });
  for (const exacta of ["caja_ver", "caja_abrir_sesion", "cobrar_cuenta"] as const) {
    actores[`solo-${exacta}`] = await crearUsuarioConMembresia({ email: `solo-${exacta}@test.com`, sucursalId: s.sucursalId, rolId: (await rolCon(`solo-${exacta}`, [exacta])).id });
  }
});

afterAll(() => {
  __setCookieDeTestParaSucursal(undefined);
});

interface Accion {
  nombre: string;
  exige: Clave;
  /** Quién la tiene con el permiso exacto (el piso manda: las de piso administrador solo las alcanza el administrador). */
  exacto: string;
  /** Prepara lo que la acción necesita (corre como admin) y devuelve la llamada. */
  preparar: () => Promise<() => Promise<{ ok: boolean; mensaje: string; codigo?: string }>>;
}
const ACCIONES: Accion[] = [
  { nombre: "abrirSesionDeCaja", exige: "caja_abrir_sesion", exacto: "solo-caja_abrir_sesion", preparar: async () => () => abrirSesionDeCaja({ claveIdempotencia: randomUUID(), fondo: "100" }) },
  {
    nombre: "registrarMovimientoDeCaja",
    exige: "caja_mover_efectivo",
    exacto: "admin",
    preparar: async () => {
      const sesionId = await abrirComoAdmin();
      return () => registrarMovimientoDeCaja({ claveIdempotencia: randomUUID(), sesionId, sentido: "EGRESO", importe: "10", motivo: "Compra de hielo" });
    },
  },
  {
    nombre: "anularMovimientoDeCaja",
    exige: "caja_mover_efectivo",
    exacto: "admin",
    preparar: async () => {
      const sesionId = await abrirComoAdmin();
      const m = await registrarMovimientoDeCaja({ claveIdempotencia: randomUUID(), sesionId, sentido: "EGRESO", importe: "10", motivo: "Compra de hielo" });
      return () => anularMovimientoDeCaja({ claveIdempotencia: randomUUID(), movimientoId: m.movimientoId!, motivo: "Error de carga" });
    },
  },
  {
    nombre: "cerrarSesionDeCaja",
    exige: "caja_cerrar_sesion",
    exacto: "admin",
    preparar: async () => {
      const sesionId = await abrirComoAdmin("0");
      return () => cerrarSesionDeCaja({ sesionId, ...conteoVacio });
    },
  },
  {
    nombre: "cobrarCuenta",
    exige: "cobrar_cuenta",
    exacto: "solo-cobrar_cuenta",
    preparar: async () => {
      await abrirComoAdmin();
      const cuenta = await cuentaCerrada();
      const medio = await efectivoId();
      return () => cobrarCuenta({ claveIdempotencia: randomUUID(), cuentaId: cuenta.id, totalVisto: "6000", renglones: [{ medioDePagoId: medio, importe: "6000" }] });
    },
  },
];

const actorPorNombre = (nombre: string) => (nombre === "admin" ? s.admin : actores[nombre]!);
const dichoPorPermiso = expect.stringMatching(/permiso|acceso|No tenés|no tiene/i);

describe("cada acción de la caja verifica en el servidor el permiso EXACTO, sin tocar la base", () => {
  it.each(ACCIONES.map((a) => [a.nombre, a] as const))("(a) con todas las claves de la caja MENOS la que exige: %s rechaza y no cambia nada", async (_n, a) => {
    const llamar = await a.preparar();
    const antes = await foto();
    await como(actores[`menos-${a.exige}`]!);
    expect(await llamar()).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    expect(await foto(), `${a.nombre}: la base cambió`).toEqual(antes);
  });

  it.each(ACCIONES.map((a) => [a.nombre, a] as const))("(b) sin ninguna clave: %s rechaza y no cambia nada", async (_n, a) => {
    const llamar = await a.preparar();
    const antes = await foto();
    await como(actores.ninguna!);
    expect(await llamar()).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    expect(await foto()).toEqual(antes);
  });

  it.each(ACCIONES.map((a) => [a.nombre, a] as const))("(c) con el permiso exacto: %s pasa", async (_n, a) => {
    const llamar = await a.preparar();
    await como(actorPorNombre(a.exacto));
    expect(await llamar(), `${a.nombre} no pasó con ${a.exige}`).toMatchObject({ ok: true });
  });

  it("(d) el permiso se pide ANTES que el formato: sin permiso un pedido mal formado dice que falta el permiso, no que el formato es inválido; con permiso, el rechazo de formato no toca la base", async () => {
    await como(actores.ninguna!);
    expect(await abrirSesionDeCaja({ claveIdempotencia: "no-es-uuid", fondo: "-1" })).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    await como(s.admin);
    const antes = await foto();
    expect(await abrirSesionDeCaja({ claveIdempotencia: "no-es-uuid", fondo: "100" })).toMatchObject({ ok: false, codigo: "CLAVE_INVALIDA", campo: "claveIdempotencia" });
    expect(await abrirSesionDeCaja({ claveIdempotencia: randomUUID(), fondo: "1,5" })).toMatchObject({ ok: false, codigo: "IMPORTE_INVALIDO", campo: "fondo" });
    expect(await foto()).toEqual(antes);
  });
});

describe("el operador de caja cobra pero no cierra la caja", () => {
  it("con las seis filas prendidas, abre y cobra, pero NO cierra, NO mueve efectivo ni anula (el PISO administrador manda sobre la fila)", async () => {
    await como(actores.cajero!);
    const abierta = await abrirSesionDeCaja({ claveIdempotencia: randomUUID(), fondo: "200" });
    expect(abierta).toMatchObject({ ok: true, yaExistia: false });
    const cuenta = await cuentaCerrada();
    await como(actores.cajero!);
    const medio = await efectivoId();
    expect(await cobrarCuenta({ claveIdempotencia: randomUUID(), cuentaId: cuenta.id, totalVisto: "6000", renglones: [{ medioDePagoId: medio, importe: "6000" }] })).toMatchObject({ ok: true });
    const antes = await foto();
    expect(await cerrarSesionDeCaja({ sesionId: abierta.sesionId!, ...conteoVacio })).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    expect(await registrarMovimientoDeCaja({ claveIdempotencia: randomUUID(), sesionId: abierta.sesionId!, sentido: "INGRESO", importe: "10", motivo: "Cambio" })).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    expect(await anularMovimientoDeCaja({ claveIdempotencia: randomUUID(), movimientoId: randomUUID(), motivo: "Error" })).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    expect(await foto()).toEqual(antes);
    expect((await prismaAdmin.sesionCaja.findUniqueOrThrow({ where: { id: abierta.sesionId! } })).estado).toBe("ABIERTA");
  });

  it("el administrador (que sí las tiene) cierra la caja con arqueo y devuelve la diferencia en centavos como texto", async () => {
    const sesionId = await abrirComoAdmin("100");
    const cuenta = await cuentaCerrada();
    await como(s.admin);
    expect(await cobrarCuenta({ claveIdempotencia: randomUUID(), cuentaId: cuenta.id, totalVisto: "6000", renglones: [{ medioDePagoId: await efectivoId(), importe: "6000" }] })).toMatchObject({ ok: true });
    // Esperado en efectivo: 100 de fondo + 6000 de cobro = 6100. Se cuenta 6000 (3 de 2000) + 90 de monedas = 6090: faltan 10 pesos = -1000 centavos.
    const r = await cerrarSesionDeCaja({ sesionId, billetes: { "2000": 3 }, monedas: "90", conformeDeLosDemasMedios: false, observacion: "Faltó vuelto" });
    expect(r).toMatchObject({ ok: true, yaEstabaCerrada: false, diferenciaEnEfectivoEnCentavos: "-1000" });
    // Cerrar de nuevo con el mismo conteo es idempotente.
    expect(await cerrarSesionDeCaja({ sesionId, billetes: { "2000": 3 }, monedas: "90", conformeDeLosDemasMedios: false, observacion: "Faltó vuelto" })).toMatchObject({ ok: true, yaEstabaCerrada: true });
  });
});

describe("una sucursal no ve ni toca la caja de otra", () => {
  it("la sesión, los movimientos y las cobranzas de la sucursal A no aparecen ni se operan desde la B", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const adminNorte = await crearUsuarioConMembresia({ email: "admin-norte@test.com", sucursalId: norte.id, rolId: await rolDelAdmin() });

    const sesionA = await abrirComoAdmin("100");
    await registrarMovimientoDeCaja({ claveIdempotencia: randomUUID(), sesionId: sesionA, sentido: "INGRESO", importe: "5", motivo: "Cambio" });
    const cuenta = await cuentaCerrada();
    await como(s.admin);
    await cobrarCuenta({ claveIdempotencia: randomUUID(), cuentaId: cuenta.id, totalVisto: "6000", renglones: [{ medioDePagoId: await efectivoId(), importe: "6000" }] });
    const estadoA = await leerEstadoDeCaja();
    expect(estadoA.sesionAbierta?.id).toBe(sesionA);
    expect(estadoA.sesionAbierta?.movimientos).toHaveLength(3);

    await como(adminNorte);
    expect(await leerEstadoDeCaja()).toEqual({ sesionAbierta: null });
    expect(await leerCobranzasDeSesion(sesionA)).toEqual([]);
    expect((await leerCuentasSinCobrar()).items).toEqual([]);
    const antes = await foto();
    // Operar la sesión ajena: no se encuentra (la sesión de A no existe para B) y la base no cambia.
    expect(await registrarMovimientoDeCaja({ claveIdempotencia: randomUUID(), sesionId: sesionA, sentido: "INGRESO", importe: "1", motivo: "Intruso" })).toMatchObject({ ok: false, codigo: "SESION_NO_ENCONTRADA" });
    expect(await cerrarSesionDeCaja({ sesionId: sesionA, ...conteoVacio })).toMatchObject({ ok: false, codigo: "SESION_NO_ENCONTRADA" });
    expect(await cobrarCuenta({ claveIdempotencia: randomUUID(), cuentaId: cuenta.id, totalVisto: "6000", renglones: [{ medioDePagoId: await efectivoId(), importe: "6000" }] })).toMatchObject({ ok: false, codigo: "CUENTA_NO_ENCONTRADA" });
    expect(await foto()).toEqual(antes);

    // B abre SU caja: la de A sigue intacta y cada una ve la suya.
    const sesionB = await abrirSesionDeCaja({ claveIdempotencia: randomUUID(), fondo: "50" });
    expect(sesionB).toMatchObject({ ok: true });
    expect((await leerEstadoDeCaja()).sesionAbierta?.id).toBe(sesionB.sesionId);
    await como(s.admin);
    expect((await leerEstadoDeCaja()).sesionAbierta?.id).toBe(sesionA);
  });
});

describe("«¿qué pasa si…?» el permiso cambia a mitad de camino", () => {
  it("se le quita `cobrar_cuenta` después de cobrar: repetir el MISMO pedido con la MISMA clave rechaza por permiso (no devuelve `yaExistia`) y no toca la base", async () => {
    await abrirComoAdmin();
    const cuenta = await cuentaCerrada();
    const medio = await efectivoId();
    const pedido = { claveIdempotencia: randomUUID(), cuentaId: cuenta.id, totalVisto: "6000", renglones: [{ medioDePagoId: medio, importe: "6000" }] };
    await como(actores["solo-cobrar_cuenta"]!);
    expect(await cobrarCuenta(pedido)).toMatchObject({ ok: true, yaExistia: false });
    expect(await cobrarCuenta(pedido)).toMatchObject({ ok: true, yaExistia: true });
    const antes = await foto();
    const rol = await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: actores["solo-cobrar_cuenta"]!.id } });
    await prisma.permisoRol.updateMany({ where: { rolId: rol.rolId, accionClave: "cobrar_cuenta" }, data: { puedeEditar: false, puedeVer: false } });
    const r = await cobrarCuenta(pedido);
    expect(r).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    expect(r.yaExistia).toBeUndefined();
    expect(await foto()).toEqual(antes);
  });

  it("se le quita el permiso ANTES del primer intento: rechaza; se le vuelve a dar: el mismo pedido pasa (el permiso se mira en cada llamada)", async () => {
    await abrirComoAdmin();
    const cuenta = await cuentaCerrada();
    const pedido = { claveIdempotencia: randomUUID(), cuentaId: cuenta.id, totalVisto: "6000", renglones: [{ medioDePagoId: await efectivoId(), importe: "6000" }] };
    const usuario = actores["solo-cobrar_cuenta"]!;
    const { rolId } = await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: usuario.id } });
    await prisma.permisoRol.updateMany({ where: { rolId, accionClave: "cobrar_cuenta" }, data: { puedeEditar: false, puedeVer: false } });
    await como(usuario);
    expect(await cobrarCuenta(pedido)).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    expect(await prismaAdmin.cobranza.count()).toBe(0);
    await prisma.permisoRol.updateMany({ where: { rolId, accionClave: "cobrar_cuenta" }, data: { puedeEditar: true, puedeVer: true } });
    expect(await cobrarCuenta(pedido)).toMatchObject({ ok: true, yaExistia: false });
  });

  it("se le saca la membresía (o se la desactiva) con la pestaña abierta: rechaza o lleva al login, sin tocar la base", async () => {
    await abrirComoAdmin();
    const usuario = actores["solo-caja_abrir_sesion"]!;
    await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: usuario.id }, data: { activo: false } });
    await como(usuario);
    const antes = await foto();
    await expect(abrirSesionDeCaja({ claveIdempotencia: randomUUID(), fondo: "1" })).rejects.toThrow();
    expect(await foto()).toEqual(antes);
  });

  it("anular lo ajeno: con `caja_anular_movimiento_ajeno` anula el de otra persona; sin ella (se le quita a mitad) solo anula lo propio", async () => {
    const sesionId = await abrirComoAdmin();
    const ajeno = await registrarMovimientoDeCaja({ claveIdempotencia: randomUUID(), sesionId, sentido: "EGRESO", importe: "10", motivo: "Compra" });
    // Otra persona con las dos claves de piso administrador: el rol propio con las dos filas no alcanza (el piso manda), así que se usa un segundo usuario con el rol de administrador.
    const otro = await crearUsuarioConMembresia({ email: "otro-admin@test.com", sucursalId: s.sucursalId, rolId: await rolDelAdmin() });
    await como(otro);
    const propio = await registrarMovimientoDeCaja({ claveIdempotencia: randomUUID(), sesionId, sentido: "EGRESO", importe: "7", motivo: "Propina" });
    expect(await anularMovimientoDeCaja({ claveIdempotencia: randomUUID(), movimientoId: ajeno.movimientoId!, motivo: "Error de carga" })).toMatchObject({ ok: true });

    const otroAjeno = await (async () => {
      await como(s.admin);
      return registrarMovimientoDeCaja({ claveIdempotencia: randomUUID(), sesionId, sentido: "EGRESO", importe: "3", motivo: "Otra compra" });
    })();
    const rolAdmin = await rolDelAdmin();
    await prisma.permisoRol.updateMany({ where: { rolId: rolAdmin, accionClave: "caja_anular_movimiento_ajeno" }, data: { puedeEditar: false, puedeVer: false } });
    await como(otro);
    const antes = await foto();
    expect(await anularMovimientoDeCaja({ claveIdempotencia: randomUUID(), movimientoId: otroAjeno.movimientoId!, motivo: "Error de carga" })).toMatchObject({ ok: false, codigo: "SIN_PERMISO_SOBRE_MOVIMIENTO_AJENO" });
    expect(await foto()).toEqual(antes);
    expect(await anularMovimientoDeCaja({ claveIdempotencia: randomUUID(), movimientoId: propio.movimientoId!, motivo: "Error de carga" })).toMatchObject({ ok: true });
  });
});

describe("las lecturas de la caja piden `caja_ver` en la sucursal activa", () => {
  it("sin `caja_ver` las cuatro lanzan y no devuelven datos; con otra clave de la caja (pero no `caja_ver`) también", async () => {
    await abrirComoAdmin();
    for (const nombre of ["ninguna", "menos-caja_ver", "solo-cobrar_cuenta", "solo-caja_abrir_sesion"]) {
      await como(actores[nombre]!);
      await expect(leerEstadoDeCaja(), nombre).rejects.toThrow(/permiso|acceso|No tenés|no tiene/i);
      await expect(leerCuentasSinCobrar(), nombre).rejects.toThrow(/permiso|acceso|No tenés|no tiene/i);
      await expect(leerCobranzasDeSesion(randomUUID()), nombre).rejects.toThrow(/permiso|acceso|No tenés|no tiene/i);
      await expect(leerMediosDeCobro(), nombre).rejects.toThrow(/permiso|acceso|No tenés|no tiene/i);
      await expect(ultimaSesionDeLaCaja(), nombre).rejects.toThrow(/permiso|acceso|No tenés|no tiene/i);
    }
  });

  it("con `caja_ver` (piso operario) ve el estado, las cuentas sin cobrar, las cobradas y los medios; los importes son centavos en texto", async () => {
    const sesionId = await abrirComoAdmin("100.50");
    const sinCobrar = await cuentaCerrada(2, 3000);
    const cobrada = await cuentaCerrada(1, 1234.56);
    await como(s.admin);
    expect(await cobrarCuenta({ claveIdempotencia: randomUUID(), cuentaId: cobrada.id, totalVisto: "1234.56", renglones: [{ medioDePagoId: await efectivoId(), importe: "1234.56" }] })).toMatchObject({ ok: true });

    await como(actores["solo-caja_ver"]!);
    const estado = await leerEstadoDeCaja();
    expect(estado.sesionAbierta).toMatchObject({ id: sesionId, fechaDeNegocio: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), efectivoEsperadoEnCentavos: "133506" });
    expect(estado.sesionAbierta?.esperadoPorMedio).toEqual([expect.objectContaining({ tipo: "EFECTIVO", esperadoEnCentavos: "133506" })]);
    expect(estado.sesionAbierta?.movimientos.map((m) => [m.clase, m.importeEnCentavos])).toEqual([["FONDO_INICIAL", "10050"], ["COBRO", "123456"]]);

    const pendientes = await leerCuentasSinCobrar();
    expect(pendientes.nextCursor).toBeNull();
    expect(pendientes.items).toEqual([expect.objectContaining({ cuentaId: sinCobrar.id, mesaNumero: 4, tipoMesa: "SALON", totalEnCentavos: "600000" })]);

    const cobradas = await leerCobranzasDeSesion(sesionId);
    expect(cobradas).toHaveLength(1);
    expect(cobradas[0]).toMatchObject({ cuentaId: cobrada.id, mesaNumero: 4, totalEnCentavos: "123456" });
    expect(cobradas[0]!.renglones).toEqual([expect.objectContaining({ orden: 1, tipoDeMedio: "EFECTIVO", importeEnCentavos: "123456" })]);
    // Sin datos personales: ni nombre ni correo de nadie en las cobradas.
    expect(JSON.stringify(cobradas)).not.toMatch(/@|admin@test/);

    expect(await leerMediosDeCobro()).toEqual([expect.objectContaining({ tipo: "EFECTIVO", nombre: null })]);
  });

  it("una sesión con un id que no es UUID devuelve vacío (no lanza)", async () => {
    await como(s.admin);
    expect(await leerCobranzasDeSesion("no-es-uuid")).toEqual([]);
    expect(await leerCobranzasDeSesion("' OR 1=1 --")).toEqual([]);
  });

  it("las cuentas sin cobrar se DERIVAN: una cuenta cobrada sale de la lista, una abierta no entra", async () => {
    await abrirComoAdmin();
    const cerrada = await cuentaCerrada();
    // Otra mesa (una sola cuenta abierta por mesa): su cuenta sigue abierta y nunca entra a la lista.
    const otraMesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
    const abierta = await sembrarCuenta(otraMesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    await como(s.admin);
    expect((await leerCuentasSinCobrar()).items.map((i) => i.cuentaId)).toEqual([cerrada.id]);
    await cobrarCuenta({ claveIdempotencia: randomUUID(), cuentaId: cerrada.id, totalVisto: "6000", renglones: [{ medioDePagoId: await efectivoId(), importe: "6000" }] });
    expect((await leerCuentasSinCobrar()).items).toEqual([]);
    expect(abierta.id).toBeTruthy();
  });

  it("se pagina de a 30 por cursor, más recientes primero, sin repetir ni saltear cuentas", async () => {
    await abrirComoAdmin();
    const ids: string[] = [];
    for (let i = 0; i < 31; i++) ids.push((await cuentaCerrada(1, 100 + i)).id);
    await como(s.admin);
    const primera = await leerCuentasSinCobrar();
    expect(primera.items).toHaveLength(30);
    expect(primera.nextCursor).not.toBeNull();
    const segunda = await leerCuentasSinCobrar(primera.nextCursor!);
    expect(segunda.items).toHaveLength(1);
    expect(segunda.nextCursor).toBeNull();
    const vistas = [...primera.items, ...segunda.items].map((i) => i.cuentaId);
    expect(new Set(vistas).size).toBe(31);
    expect([...vistas].sort()).toEqual([...ids].sort());
    // La más reciente (la última que se cerró) va primera.
    expect(vistas[0]).toBe(ids[30]);
    expect(primera.items[0]!.totalEnCentavos).toBe("13000");
  }, 120_000);

  describe("ultimaSesionDeLaCaja", () => {
    it("caja nunca cerrada (ni abierta) = null; una sesión ABIERTA no cuenta", async () => {
      await como(actores["solo-caja_ver"]!);
      expect(await ultimaSesionDeLaCaja()).toBeNull();
      await abrirComoAdmin();
      await como(actores["solo-caja_ver"]!);
      expect(await ultimaSesionDeLaCaja()).toBeNull();
    });

    it("la última cerrada con su arqueo: esperado, contado, diferencia con signo (centavos), billetes y monedas", async () => {
      const primera = await abrirComoAdmin("100");
      await como(s.admin);
      expect(await cerrarSesionDeCaja({ sesionId: primera, billetes: { "100": 1 }, monedas: "0", conformeDeLosDemasMedios: false, observacion: null })).toMatchObject({ ok: true });
      const segunda = await abrirComoAdmin("100");
      await como(s.admin);
      // Esperado 100; se cuentan 2 de 20 + 1 de 100 = 140 + 5.50 de monedas = 145.50: sobran 45.50 = 4550 centavos.
      expect(await cerrarSesionDeCaja({ sesionId: segunda, billetes: { "100": 1, "20": 2 }, monedas: "5.50", conformeDeLosDemasMedios: false, observacion: "Sobró" })).toMatchObject({ ok: true });
      await como(actores["solo-caja_ver"]!);
      const u = await ultimaSesionDeLaCaja();
      expect(u).toMatchObject({ sesionId: segunda, observacion: "Sobró", monedasEnCentavos: "550" });
      expect(u?.arqueos).toEqual([expect.objectContaining({ tipo: "EFECTIVO", esperadoEnCentavos: "10000", contadoEnCentavos: "14550", conforme: false, diferenciaEnCentavos: "4550" })]);
      expect(u?.billetes).toEqual([{ denominacion: 100, cantidad: 1 }, { denominacion: 20, cantidad: 2 }]);
    });

    it("una diferencia negativa conserva el signo; otra sucursal no ve la sesión de ésta", async () => {
      const sesion = await abrirComoAdmin("100");
      await como(s.admin);
      await cerrarSesionDeCaja({ sesionId: sesion, billetes: { "20": 1 }, monedas: "0", conformeDeLosDemasMedios: false, observacion: null });
      expect((await ultimaSesionDeLaCaja())?.arqueos[0]?.diferenciaEnCentavos).toBe("-8000");
      const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const adminNorte = await crearUsuarioConMembresia({ email: "admin-norte2@test.com", sucursalId: norte.id, rolId: await rolDelAdmin() });
      await como(adminNorte);
      expect(await ultimaSesionDeLaCaja()).toBeNull();
    });
  });
});

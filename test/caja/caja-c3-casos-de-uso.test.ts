import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { calcularPayloadHash } from "../../src/core/movimientos/public-servidor";
import { azarDelProceso } from "../../src/lib/azar";
import { abrirSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/abrir-sesion";
import { cerrarSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cerrar-sesion";
import { iniciarCierreDeSesion } from "../../src/server/actions/caja/casos-de-uso/iniciar-cierre";
import { cobrarCuentaCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cobrar-cuenta";
import { desactivarCuentaDeCobroCasoDeUso, reactivarCuentaDeCobroCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cambiar-estado-de-cuenta-de-cobro";
import { desactivarMedioDePagoCasoDeUso, reactivarMedioDePagoCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cambiar-estado-de-medio-de-pago";
import { crearCuentaDeCobroCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/crear-cuenta-de-cobro";
import { crearMedioDePagoCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/crear-medio-de-pago";
import { editarCuentaDeCobroCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/editar-cuenta-de-cobro";
import { editarMedioDePagoCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/editar-medio-de-pago";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { listarMarcasDeTarjeta } from "../../src/server/lecturas/caja/marcas-de-tarjeta";
import { baseDeEmpresa } from "../../src/server/sesion/base";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { EMPRESA_POR_DEFECTO_ID as EMPRESA, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Caja y cobro, etapa C3, contra Postgres real: cuentas de cobro, medios de pago (qué datos piden), marcas de tarjeta y el cobro con cuenta y datos. Las carreras son de verdad (`Promise.allSettled` desde conexiones distintas).
 * Mutación: sacar la validación del par (medio, cuenta) de `cobrarCuentaCasoDeUso` deja en rojo «rechaza cuenta de otra sucursal, inactiva, incompatible…» (la base lo rechazaría igual, pero con un error de persistencia en lugar del
 * código); sacar el `true` final de `conTransaccionSerializable` en `crearCuentaDeCobroCasoDeUso` deja en rojo «ocho altas iguales a la vez».
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
const AHORA = new Date("2026-01-15T15:00:00.000Z");
const c = (n: number) => BigInt(n);

const base = (escritura: string[] = [s.sucursalId], lectura: string[] = escritura) => baseDeEmpresa(EMPRESA, { lectura, escritura });
const actor = (escritura?: string[], lectura?: string[]) => ({ usuarioId: s.admin.id, empresaId: EMPRESA, sucursalId: s.sucursalId, ahora: AHORA, empresaZonaHoraria: "America/Argentina/Buenos_Aires", ...base(escritura, lectura) });

const crearCuenta = (nombre: string, tipo = "TERMINAL", identificadorExterno: string | null = null, sucursalId = s.sucursalId) =>
  crearCuentaDeCobroCasoDeUso(actor(), { tipo, nombre, identificadorExterno, sucursalId }, azarDelProceso);
const crearMedio = (tipo: string, nombre: string | null = null) => crearMedioDePagoCasoDeUso(actor(), { tipo, nombre }, azarDelProceso);

let mesaN = 20;
async function cuentaCerrada(precio = 3000) {
  mesaN += 1;
  const mesa = await prismaAdmin.mesa.create({ data: { sucursalId: s.sucursalId, numero: mesaN } });
  const cuenta = await sembrarCuenta(mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: precio, numeroEnvio: 1 }]);
  expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
  return cuenta;
}
const abrir = () => abrirSesionCasoDeUso(actor(), { claveIdempotencia: randomUUID(), fondoEnCentavos: c(0) }, azarDelProceso);
type Renglon = Parameters<typeof cobrarCuentaCasoDeUso>[1]["renglones"][number];
const cobrar = (cuentaId: string, renglones: Renglon[], total: number, clave = randomUUID()) =>
  cobrarCuentaCasoDeUso(actor(), { claveIdempotencia: clave, cuentaId, totalVistoEnCentavos: c(total), renglones }, azarDelProceso);

/** Un medio de un tipo (creado por el caso de uso) y, si se pide, con esos datos habilitados. */
async function medio(tipo: string, nombre: string | null, datos: Partial<Record<"cupon" | "ultimos4" | "marca" | "cuotas" | "dni", boolean>> = {}) {
  const r = await crearMedio(tipo, nombre);
  if (!r.ok) throw new Error(`no creó el medio: ${r.mensaje}`);
  if (Object.values(datos).some(Boolean)) {
    const e = await editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: r.datos.medioDePagoId, versionEsperada: 1, nombre, datos: { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false, ...datos } });
    if (!e.ok) throw new Error(`no editó el medio: ${e.mensaje}`);
  }
  return r.datos.medioDePagoId;
}
const visaId = async () => (await prismaAdmin.valorDeLista.findFirstOrThrow({ where: { lista: "MARCAS_DE_TARJETA", nombre: "Visa" } })).id;

const MARCAS_SEMBRADAS = ["Visa", "Mastercard", "American Express", "Cabal", "Naranja X", "Otra"];

beforeEach(async () => {
  await limpiarBaseDeTest();
  // La lista de marcas es GLOBAL y sembrada por la migración: `limpiarBaseDeTest` no la toca, así que se sacan las que crearon otros tests.
  await prismaAdmin.valorDeLista.deleteMany({ where: { nombre: { notIn: MARCAS_SEMBRADAS } } });
  s = await sembrarSalon();
  await entrarComo(s.admin);
});

describe("crear una cuenta de cobro", () => {
  it("nace activa, audita sin el identificador externo y repetirla no duplica", async () => {
    const r = await crearCuenta("Posnet 1", "TERMINAL", "T-0481");
    expect(r).toMatchObject({ ok: true, datos: { yaExistia: false } });
    const fila = await prismaAdmin.cuentaDeCobro.findFirstOrThrow();
    expect(fila).toMatchObject({ nombre: "Posnet 1", tipo: "TERMINAL", activa: true, identificadorExterno: "T-0481", sucursalId: s.sucursalId, version: 1 });
    const otra = await crearCuenta("Posnet 1", "TERMINAL", "T-0481");
    expect(otra).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect(await prismaAdmin.cuentaDeCobro.count()).toBe(1);
    const auditoria = await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "CuentaDeCobro" } });
    expect(auditoria).toHaveLength(1);
    expect(JSON.stringify(auditoria)).not.toContain("T-0481");
  });

  it("el nombre es único sin distinguir mayúsculas; con otro tipo o la misma desactivada es CUENTA_DUPLICADA", async () => {
    await crearCuenta("Posnet 1");
    expect(await crearCuenta("POSNET 1", "QR")).toMatchObject({ ok: false, codigo: "CUENTA_DUPLICADA" });
    expect(await crearCuenta("posnet 1", "TERMINAL", "otro")).toMatchObject({ ok: false, codigo: "CUENTA_DUPLICADA" });
    const id = (await prismaAdmin.cuentaDeCobro.findFirstOrThrow()).id;
    await desactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: id });
    expect(await crearCuenta("Posnet 1")).toMatchObject({ ok: false, codigo: "CUENTA_DUPLICADA" });
  });

  it("valida por lista de permitidos: tipo, nombre e identificador", async () => {
    expect(await crearCuenta("Posnet", "TARJETA")).toMatchObject({ ok: false, codigo: "TIPO_DE_CUENTA_INVALIDO" });
    for (const malo of ["", "   ", "<b>x</b>", "=SUMA(1)", "-Posnet", "Pos​net", "Pos\nnet", "x".repeat(61), "🙂"]) {
      expect(await crearCuenta(malo), JSON.stringify(malo)).toMatchObject({ ok: false, codigo: "NOMBRE_DE_CUENTA_INVALIDO" });
    }
    for (const malo of ["", "  ", "clave=1234", "a".repeat(41), "T-0481;DROP"]) {
      expect(await crearCuenta("Posnet", "TERMINAL", malo), JSON.stringify(malo)).toMatchObject({ ok: false, codigo: "IDENTIFICADOR_EXTERNO_INVALIDO" });
    }
    expect(await crearCuenta("  Posnet   Caja  ")).toMatchObject({ ok: true });
    expect((await prismaAdmin.cuentaDeCobro.findFirstOrThrow()).nombre).toBe("Posnet Caja");
  });

  it("la sucursal tiene que existir y estar en el alcance de escritura del actor", async () => {
    expect(await crearCuenta("Posnet", "TERMINAL", null, randomUUID())).toMatchObject({ ok: false, codigo: "SUCURSAL_NO_ENCONTRADA" });
    const norte = await prismaAdmin.sucursal.create({ data: { nombre: "Norte" } });
    expect(await crearCuenta("Posnet", "TERMINAL", null, norte.id)).toMatchObject({ ok: false, codigo: "SUCURSAL_FUERA_DE_ALCANCE" });
    expect(await prismaAdmin.cuentaDeCobro.count()).toBe(0);
  });

  it("ocho altas iguales a la vez dejan UNA sola cuenta (crearCuentaDeCobroCasoDeUso)", async () => {
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => crearCuentaDeCobroCasoDeUso(actor(), { tipo: "QR", nombre: "QR Caja", identificadorExterno: null, sucursalId: s.sucursalId }, azarDelProceso)));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(rs.filter((x) => x.status === "fulfilled" && x.value.ok && x.value.datos.yaExistia === false)).toHaveLength(1);
    expect(await prismaAdmin.cuentaDeCobro.count()).toBe(1);
  });

  it("ocho altas del MISMO nombre con otro tipo a la vez dejan una y las demás son CUENTA_DUPLICADA", async () => {
    const tipos = ["TERMINAL", "QR", "CUENTA_BANCARIA", "TERMINAL", "QR", "CUENTA_BANCARIA", "TERMINAL", "QR"];
    const rs = await Promise.allSettled(tipos.map((tipo) => crearCuentaDeCobroCasoDeUso(actor(), { tipo, nombre: "Una sola", identificadorExterno: null, sucursalId: s.sucursalId }, azarDelProceso)));
    expect(rs.every((x) => x.status === "fulfilled")).toBe(true);
    expect(await prismaAdmin.cuentaDeCobro.count()).toBe(1);
  });
});

describe("editar, desactivar y reactivar una cuenta de cobro", () => {
  async function unaCuenta() {
    const r = await crearCuenta("Posnet 1", "TERMINAL", "T-1");
    if (!r.ok) throw new Error("no creó");
    return r.datos.cuentaDeCobroId;
  }

  it("cambia nombre e identificador con la versión vigente, audita sin valores y repetirlo es un no-op", async () => {
    const id = await unaCuenta();
    const e = await editarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: id, versionEsperada: 1, nombre: "Posnet Salón", identificadorExterno: "T-2", sucursalId: s.sucursalId });
    expect(e).toMatchObject({ ok: true, datos: { version: 2 } });
    expect(await editarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: id, versionEsperada: 1, nombre: "Posnet Salón", identificadorExterno: "T-2", sucursalId: s.sucursalId })).toMatchObject({ ok: true, datos: { version: 2 } });
    expect((await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id } }))).toMatchObject({ nombre: "Posnet Salón", identificadorExterno: "T-2", version: 2 });
    const auditoria = JSON.stringify(await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "CuentaDeCobro" } }));
    expect(auditoria).not.toContain("T-1");
    expect(auditoria).not.toContain("T-2");
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "CuentaDeCobro", campo: { in: ["nombre", "identificadorExterno"] } } })).toBe(2);
  });

  it("versión vieja, nombre de otra cuenta y cuenta inexistente", async () => {
    const id = await unaCuenta();
    // Una sola cuenta activa por sucursal: «Banco» es otra cuenta, inactiva (el nombre sigue ocupado aunque esté inactiva).
    await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), sucursalId: s.sucursalId, tipo: "CUENTA_BANCARIA", nombre: "Banco", activa: false } });
    await editarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: id, versionEsperada: 1, nombre: "Posnet 2", identificadorExterno: null, sucursalId: s.sucursalId });
    expect(await editarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: id, versionEsperada: 1, nombre: "Posnet 3", identificadorExterno: null, sucursalId: s.sucursalId })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect(await editarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: id, versionEsperada: 2, nombre: "banco", identificadorExterno: null, sucursalId: s.sucursalId })).toMatchObject({ ok: false, codigo: "CUENTA_DUPLICADA" });
    expect(await editarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: randomUUID(), versionEsperada: 1, nombre: "X", identificadorExterno: null, sucursalId: s.sucursalId })).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
  });

  it("dos ediciones a la vez con la misma versión: una gana y la otra ve VERSION_DESACTUALIZADA (editarCuentaDeCobroCasoDeUso)", async () => {
    const id = await unaCuenta();
    const rs = await Promise.allSettled(["A uno", "B dos", "C tres", "D cuatro"].map((nombre) => editarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: id, versionEsperada: 1, nombre, identificadorExterno: null, sucursalId: s.sucursalId })));
    const resultados = rs.map((x) => (x.status === "fulfilled" ? x.value : null));
    expect(resultados.filter((r) => r?.ok)).toHaveLength(1);
    expect(resultados.filter((r) => r && !r.ok && r.codigo === "VERSION_DESACTUALIZADA")).toHaveLength(3);
    expect((await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id } })).version).toBe(2);
  });

  it("el tipo no cambia nunca (la base lo impide aunque se salte el caso de uso)", async () => {
    const id = await unaCuenta();
    await expect(prismaAdmin.cuentaDeCobro.update({ where: { id }, data: { tipo: "QR" } })).rejects.toThrow(/cuenta_de_cobro_tipo_inmutable/);
  });

  it("desactivar y reactivar son idempotentes por estado y se auditan una vez", async () => {
    const id = await unaCuenta();
    expect(await desactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: id })).toMatchObject({ ok: true, datos: { yaEstabaInactiva: false } });
    expect(await desactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: id })).toMatchObject({ ok: true, datos: { yaEstabaInactiva: true } });
    expect(await reactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: id })).toMatchObject({ ok: true, datos: { yaEstabaActiva: false } });
    expect(await reactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: id })).toMatchObject({ ok: true, datos: { yaEstabaActiva: true } });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "CuentaDeCobro", campo: "activa" } })).toBe(2);
    expect(await desactivarCuentaDeCobroCasoDeUso(actor(), { cuentaDeCobroId: randomUUID() })).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
  });

  it("sin alcance de escritura en la sucursal de la cuenta no se cambia nada (cambio de permisos)", async () => {
    const id = await unaCuenta();
    // Ve la sucursal pero no escribe en ella: código limpio. Sin verla (alcance vacío) la cuenta no existe para el actor: la RLS falla cerrado.
    expect(await desactivarCuentaDeCobroCasoDeUso(actor([], [s.sucursalId]), { cuentaDeCobroId: id })).toMatchObject({ ok: false, codigo: "SUCURSAL_FUERA_DE_ALCANCE" });
    expect(await desactivarCuentaDeCobroCasoDeUso(actor([]), { cuentaDeCobroId: id })).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
    expect((await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id } })).activa).toBe(true);
  });

  it("la RLS por sucursal: sin esa sucursal en el alcance la cuenta no se ve ni se escribe", async () => {
    await unaCuenta();
    expect(await base([]).db.cuentaDeCobro.count()).toBe(0);
    expect(await base().db.cuentaDeCobro.count()).toBe(1);
  });
});

describe("medios de pago: crear, editar qué datos piden, desactivar", () => {
  it("nace activo y sin pedir ningún dato; repetirlo no duplica", async () => {
    const r = await crearMedio("TARJETA_CREDITO", "Visa crédito");
    expect(r).toMatchObject({ ok: true, datos: { yaExistia: false } });
    const f = await prismaAdmin.medioDePago.findFirstOrThrow({ where: { nombre: "Visa crédito" } });
    expect(f).toMatchObject({ activo: true, pideCupon: false, pideUltimos4: false, pideMarca: false, pideCuotas: false, pideDni: false, version: 1 });
    expect(await crearMedio("TARJETA_CREDITO", "Visa crédito")).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect(await crearMedio("TARJETA_DEBITO", "VISA CRÉDITO")).toMatchObject({ ok: false });
    expect(await crearMedio("TARJETA_DEBITO", "visa crédito")).toMatchObject({ ok: false, codigo: "MEDIO_DUPLICADO" });
    expect(await crearMedio("TARJETA", null)).toMatchObject({ ok: false, codigo: "TIPO_DE_MEDIO_INVALIDO" });
    expect(await crearMedio("QR", "<x>")).toMatchObject({ ok: false, codigo: "NOMBRE_DE_MEDIO_INVALIDO" });
  });

  it("hay un solo efectivo: el de C1 (que nace al abrir) ya cuenta", async () => {
    expect(await crearMedio("EFECTIVO")).toMatchObject({ ok: true, datos: { yaExistia: false } });
    expect(await crearMedio("EFECTIVO")).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect(await crearMedio("EFECTIVO", "Caja chica")).toMatchObject({ ok: false, codigo: "EFECTIVO_YA_EXISTE" });
    expect(await prismaAdmin.medioDePago.count({ where: { tipo: "EFECTIVO" } })).toBe(1);
  });

  it("ocho altas iguales a la vez dejan UN solo medio (crearMedioDePagoCasoDeUso)", async () => {
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => crearMedioDePagoCasoDeUso(actor(), { tipo: "TRANSFERENCIA", nombre: "Banco Nación" }, azarDelProceso)));
    expect(rs.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(await prismaAdmin.medioDePago.count({ where: { nombre: "Banco Nación" } })).toBe(1);
  });

  it("editar: habilita datos dentro del techo del tipo, rechaza los que no admite y audita solo los nombres de los datos", async () => {
    const id = await medio("TARJETA_DEBITO", "Débito");
    const sin = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };
    expect(await editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: id, versionEsperada: 1, nombre: "Débito", datos: { ...sin, cupon: true, marca: true } })).toMatchObject({ ok: true, datos: { version: 2 } });
    expect(await editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: id, versionEsperada: 2, nombre: "Débito", datos: { ...sin, cuotas: true } })).toMatchObject({ ok: false, codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato: "cuotas" });
    expect(await editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: id, versionEsperada: 2, nombre: "Débito", datos: { ...sin, dni: true } })).toMatchObject({ ok: false, codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato: "dni" });
    expect(await prismaAdmin.medioDePago.findUniqueOrThrow({ where: { id } })).toMatchObject({ pideCupon: true, pideMarca: true, pideCuotas: false, version: 2 });
    const a = await prismaAdmin.registroAuditoria.findFirstOrThrow({ where: { entidad: "MedioDePago", campo: "datosQuePide" } });
    expect(a).toMatchObject({ valorAnterior: "ninguno", valorNuevo: "cupon,marca" });
  });

  it("editar: efectivo, QR y otro no piden nada; transferencia solo DNI; crédito suma cuotas", async () => {
    const sin = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };
    for (const tipo of ["QR", "OTRO"]) {
      const id = await medio(tipo, `M ${tipo}`);
      expect(await editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: id, versionEsperada: 1, nombre: `M ${tipo}`, datos: { ...sin, cupon: true } }), tipo).toMatchObject({ ok: false, codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO" });
    }
    const ef = await medio("EFECTIVO", null);
    expect(await editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: ef, versionEsperada: 1, nombre: null, datos: { ...sin, ultimos4: true } })).toMatchObject({ ok: false, codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO" });
    const tr = await medio("TRANSFERENCIA", "Transf");
    expect(await editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: tr, versionEsperada: 1, nombre: "Transf", datos: { ...sin, dni: true } })).toMatchObject({ ok: true });
    expect(await editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: tr, versionEsperada: 2, nombre: "Transf", datos: { ...sin, dni: true, cupon: true } })).toMatchObject({ ok: false, dato: "cupon" });
    const cr = await medio("TARJETA_CREDITO", "Crédito");
    expect(await editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: cr, versionEsperada: 1, nombre: "Crédito", datos: { ...sin, cuotas: true } })).toMatchObject({ ok: true });
  });

  it("editar: versión vieja, repetir lo ya aplicado, nombre duplicado, dos ediciones a la vez (editarMedioDePagoCasoDeUso)", async () => {
    const id = await medio("TARJETA_DEBITO", "Débito");
    await medio("TARJETA_CREDITO", "Crédito");
    const sin = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };
    expect(await editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: id, versionEsperada: 1, nombre: "crédito", datos: sin })).toMatchObject({ ok: false, codigo: "MEDIO_DUPLICADO" });
    const rs = await Promise.allSettled(["Uno", "Dos", "Tres", "Cuatro"].map((nombre) => editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: id, versionEsperada: 1, nombre, datos: sin })));
    const resultados = rs.map((x) => (x.status === "fulfilled" ? x.value : null));
    expect(resultados.filter((r) => r?.ok)).toHaveLength(1);
    expect(resultados.filter((r) => r && !r.ok && r.codigo === "VERSION_DESACTUALIZADA")).toHaveLength(3);
    const nombre = (await prismaAdmin.medioDePago.findUniqueOrThrow({ where: { id } })).nombre;
    expect(await editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: id, versionEsperada: 1, nombre, datos: sin })).toMatchObject({ ok: true, datos: { version: 2 } });
    expect(await editarMedioDePagoCasoDeUso(actor(), { medioDePagoId: randomUUID(), versionEsperada: 1, nombre: null, datos: sin })).toMatchObject({ ok: false, codigo: "MEDIO_NO_ENCONTRADO" });
  });

  it("desactivar y reactivar: idempotentes; el efectivo no se desactiva; un medio inactivo no cobra", async () => {
    const id = await medio("QR", "QR Caja");
    expect(await desactivarMedioDePagoCasoDeUso(actor(), { medioDePagoId: id })).toMatchObject({ ok: true, datos: { yaEstabaInactivo: false } });
    expect(await desactivarMedioDePagoCasoDeUso(actor(), { medioDePagoId: id })).toMatchObject({ ok: true, datos: { yaEstabaInactivo: true } });
    expect(await crearMedio("QR", "QR Caja")).toMatchObject({ ok: false, codigo: "MEDIO_INACTIVO_CON_ESE_NOMBRE" });
    await abrir();
    const cuenta = await cuentaCerrada();
    expect(await cobrar(cuenta.id, [{ medioDePagoId: id, importeEnCentavos: c(3000_00) }], 3000_00)).toMatchObject({ ok: false, codigo: "MEDIO_NO_HABILITADO" });
    expect(await reactivarMedioDePagoCasoDeUso(actor(), { medioDePagoId: id })).toMatchObject({ ok: true, datos: { yaEstabaActivo: false } });
    expect(await reactivarMedioDePagoCasoDeUso(actor(), { medioDePagoId: id })).toMatchObject({ ok: true, datos: { yaEstabaActivo: true } });
    const ef = await medio("EFECTIVO", null);
    expect(await desactivarMedioDePagoCasoDeUso(actor(), { medioDePagoId: ef })).toMatchObject({ ok: false, codigo: "EFECTIVO_NO_SE_DESACTIVA" });
  });
});

describe("marcas de tarjeta: lista global que solo lee la app", () => {
  it("vienen sembradas (Visa, Mastercard, American Express, Cabal, Naranja X y «Otra» al final)", async () => {
    const marcas = await listarMarcasDeTarjeta(prisma, { soloActivas: true });
    expect(marcas.map((m) => m.nombre)).toEqual(["American Express", "Cabal", "Mastercard", "Naranja X", "Visa", "Otra"]);
    expect(marcas.at(-1)?.fija).toBe(true);
  });

  it("la app NO escribe la lista (ni agrega, ni cambia, ni borra); el dueño de la base respeta la regla de «Otra» y de los nombres", async () => {
    await expect(prisma.valorDeLista.create({ data: { id: randomUUID(), lista: "MARCAS_DE_TARJETA", nombre: "Diners" } })).rejects.toThrow(/permission denied|42501/);
    await expect(prisma.valorDeLista.update({ where: { id: await visaId() }, data: { activo: false } })).rejects.toThrow(/permission denied|42501/);
    await expect(prisma.valorDeLista.deleteMany()).rejects.toThrow(/permission denied|42501/);
    const otra = await prismaAdmin.valorDeLista.findFirstOrThrow({ where: { fija: true } });
    await expect(prismaAdmin.valorDeLista.update({ where: { id: otra.id }, data: { activo: false } })).rejects.toThrow(/valor_de_lista_fija|ValorDeLista_fija_chk/);
    await expect(prismaAdmin.valorDeLista.update({ where: { id: otra.id }, data: { nombre: "Otra marca" } })).rejects.toThrow(/valor_de_lista_fija/);
    await expect(prismaAdmin.valorDeLista.create({ data: { id: randomUUID(), lista: "MARCAS_DE_TARJETA", nombre: "visá" } })).rejects.toThrow(/ValorDeLista_nombre_key|Unique constraint/);
    await expect(prismaAdmin.valorDeLista.create({ data: { id: randomUUID(), lista: "MOTIVOS_DE_RECHAZO", nombre: "Vencida" } })).rejects.toThrow(/ValorDeLista_lista_chk/);
    await expect(prismaAdmin.valorDeLista.create({ data: { id: randomUUID(), lista: "MARCAS_DE_TARJETA", nombre: "Otra2", fija: true } })).rejects.toThrow(/ValorDeLista_fija_key|Unique constraint/);
  });
});

describe("cobrar con cuenta de cobro y datos", () => {
  async function escenario() {
    await abrir();
    const posnet = await crearCuenta("Posnet 1", "TERMINAL", "T-1");
    if (!posnet.ok) throw new Error("no creó la cuenta");
    const debito = await medio("TARJETA_DEBITO", "Débito", { cupon: true, ultimos4: true, marca: true });
    const cuenta = await cuentaCerrada();
    return { cuentaId: posnet.datos.cuentaDeCobroId, debito, cuenta };
  }

  it("cobra con cuenta y datos, los guarda tipados y la auditoría lleva SOLO la lista de datos completados", async () => {
    const { cuentaId, debito, cuenta } = await escenario();
    const marca = await visaId();
    const r = await cobrar(cuenta.id, [{ medioDePagoId: debito, importeEnCentavos: c(3000_00), cuentaDeCobroId: cuentaId, datos: { cupon: "AB-123/45", ultimos4: "0042", marcaDeTarjetaId: marca } }], 3000_00);
    expect(r).toMatchObject({ ok: true, datos: { yaExistia: false } });
    const cobro = await prismaAdmin.cobro.findFirstOrThrow();
    expect(cobro).toMatchObject({ cuentaDeCobroId: cuentaId, cupon: "AB-123/45", ultimos4: "0042", marcaDeTarjetaId: marca, cuotas: null, dni: null });
    expect((await prismaAdmin.movimientoCaja.findFirstOrThrow({ where: { clase: "COBRO" } })).cuentaDeCobroId).toBe(cuentaId);
    const auditoria = JSON.stringify(await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Cobranza" } }));
    expect(auditoria).toContain("datos completados: cupon, ultimos4, marca");
    for (const valor of ["AB-123/45", "0042", marca]) expect(auditoria).not.toContain(valor);
  });

  it("un cobro sin cuenta ni datos conserva la forma vieja de la huella (los cobros de C1 siguen siendo repetibles)", async () => {
    await abrir();
    const cuenta = await cuentaCerrada();
    const ef = (await prismaAdmin.medioDePago.findFirstOrThrow({ where: { tipo: "EFECTIVO" } })).id;
    const clave = randomUUID();
    expect(await cobrar(cuenta.id, [{ medioDePagoId: ef, importeEnCentavos: c(3000_00) }], 3000_00, clave)).toMatchObject({ ok: true });
    const guardada = (await prismaAdmin.cobranza.findFirstOrThrow()).huella;
    expect(guardada).toBe(calcularPayloadHash("COBRAR_CUENTA", EMPRESA, { cuentaId: cuenta.id, total: "3000.00", renglones: [[ef, "3000.00"]] }));
    // Pedido idéntico con los campos nuevos en su valor «vacío»: el mismo pedido.
    expect(await cobrar(cuenta.id, [{ medioDePagoId: ef, importeEnCentavos: c(3000_00), cuentaDeCobroId: null, datos: {} }], 3000_00, clave)).toMatchObject({ ok: true, datos: { yaExistia: true } });
  });

  it("la misma clave con otro dato o con otra cuenta es CLAVE_REUTILIZADA; con los mismos datos es el mismo cobro", async () => {
    const { cuentaId, debito, cuenta } = await escenario();
    const clave = randomUUID();
    const renglon = (cupon: string, cuentaDeCobroId: string | null = cuentaId): Renglon => ({ medioDePagoId: debito, importeEnCentavos: c(3000_00), cuentaDeCobroId, datos: { cupon } });
    expect(await cobrar(cuenta.id, [renglon("A1")], 3000_00, clave)).toMatchObject({ ok: true, datos: { yaExistia: false } });
    expect(await cobrar(cuenta.id, [renglon("A1")], 3000_00, clave)).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect(await cobrar(cuenta.id, [renglon("A2")], 3000_00, clave)).toMatchObject({ ok: false, codigo: "CLAVE_REUTILIZADA" });
    expect(await cobrar(cuenta.id, [renglon("A1", null)], 3000_00, clave)).toMatchObject({ ok: false, codigo: "CLAVE_REUTILIZADA" });
    expect(await prismaAdmin.cobro.count()).toBe(1);
  });

  it("un dato que el medio no pidió se rechaza con su nombre y no escribe nada", async () => {
    const { debito, cuenta } = await escenario();
    expect(await cobrar(cuenta.id, [{ medioDePagoId: debito, importeEnCentavos: c(3000_00), datos: { cuotas: 3 } }], 3000_00)).toMatchObject({ ok: false, codigo: "DATO_DE_COBRO_NO_HABILITADO", dato: "cuotas" });
    expect(await cobrar(cuenta.id, [{ medioDePagoId: debito, importeEnCentavos: c(3000_00), datos: { dni: "12345678" } }], 3000_00)).toMatchObject({ ok: false, codigo: "DATO_DE_COBRO_NO_HABILITADO", dato: "dni" });
    const ef = (await prismaAdmin.medioDePago.findFirstOrThrow({ where: { tipo: "EFECTIVO" } })).id;
    expect(await cobrar(cuenta.id, [{ medioDePagoId: ef, importeEnCentavos: c(3000_00), datos: { cupon: "X1" } }], 3000_00)).toMatchObject({ ok: false, codigo: "DATO_DE_COBRO_NO_HABILITADO", dato: "cupon" });
    expect(await prismaAdmin.cobranza.count()).toBe(0);
    expect(await prismaAdmin.movimientoCaja.count({ where: { clase: "COBRO" } })).toBe(0);
  });

  it("un dato mal escrito se rechaza (lista de permitidos): cupón que parece una tarjeta, últimos 4, marca desconocida o desactivada", async () => {
    const { debito, cuenta } = await escenario();
    const intento = (datos: Record<string, unknown>) => cobrar(cuenta.id, [{ medioDePagoId: debito, importeEnCentavos: c(3000_00), datos: datos as never }], 3000_00);
    expect(await intento({ cupon: "4111111111111111" })).toMatchObject({ ok: false, codigo: "DATO_DE_COBRO_INVALIDO", dato: "cupon", motivo: "NUMERO_DE_TARJETA" });
    expect(await intento({ cupon: "4111-1111-1111-1111" })).toMatchObject({ ok: false, dato: "cupon", motivo: "NUMERO_DE_TARJETA" });
    expect(await intento({ cupon: "AB CD" })).toMatchObject({ ok: false, dato: "cupon", motivo: "FORMA" });
    expect(await intento({ cupon: "---" })).toMatchObject({ ok: false, dato: "cupon", motivo: "FORMA" });
    expect(await intento({ cupon: "" })).toMatchObject({ ok: false, dato: "cupon", motivo: "FORMA" });
    expect(await intento({ cupon: "x".repeat(33) })).toMatchObject({ ok: false, dato: "cupon", motivo: "FORMA" });
    expect(await intento({ ultimos4: "4111111111111111" })).toMatchObject({ ok: false, dato: "ultimos4", motivo: "FORMA" });
    expect(await intento({ ultimos4: "12a4" })).toMatchObject({ ok: false, dato: "ultimos4", motivo: "FORMA" });
    expect(await intento({ marcaDeTarjetaId: "no-es-un-uuid" })).toMatchObject({ ok: false, dato: "marca", motivo: "FORMA" });
    expect(await intento({ marcaDeTarjetaId: randomUUID() })).toMatchObject({ ok: false, dato: "marca", motivo: "NO_DISPONIBLE" });
    const diners = await prismaAdmin.valorDeLista.create({ data: { id: randomUUID(), lista: "MARCAS_DE_TARJETA", nombre: "Diners", activo: false } });
    expect(await intento({ marcaDeTarjetaId: diners.id })).toMatchObject({ ok: false, dato: "marca", motivo: "NO_DISPONIBLE" });
    expect(await prismaAdmin.cobranza.count()).toBe(0);
  });

  it("cuotas 1 a 36 y DNI de 6 a 9 dígitos sin cero inicial, cuando el medio los pide", async () => {
    await abrir();
    const credito = await medio("TARJETA_CREDITO", "Crédito", { cuotas: true });
    const transf = await medio("TRANSFERENCIA", "Transf", { dni: true });
    const cuenta = await cuentaCerrada();
    const intento = (m: string, datos: Record<string, unknown>) => cobrar(cuenta.id, [{ medioDePagoId: m, importeEnCentavos: c(3000_00), datos: datos as never }], 3000_00);
    for (const mala of [0, 37, 1.5, -1, "3" as unknown as number]) expect(await intento(credito, { cuotas: mala }), String(mala)).toMatchObject({ ok: false, dato: "cuotas", motivo: "FORMA" });
    for (const malo of ["12345", "1234567890", "012345678", "12.345.678", "1234 5678"]) expect(await intento(transf, { dni: malo }), malo).toMatchObject({ ok: false, dato: "dni", motivo: "FORMA" });
    expect(await intento(transf, { dni: "12345678" })).toMatchObject({ ok: true });
    const auditoria = JSON.stringify(await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Cobranza" } }));
    expect(auditoria).not.toContain("12345678");
    expect(auditoria).toContain("datos completados: dni");
  });

  it("rechaza una cuenta de cobro de otra sucursal, inactiva, incompatible, inexistente o con efectivo", async () => {
    const { cuentaId, debito, cuenta } = await escenario();
    const norte = await prismaAdmin.sucursal.create({ data: { nombre: "Norte" } });
    const deOtra = await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), sucursalId: norte.id, tipo: "TERMINAL", nombre: "Posnet Norte" } });
    const inactiva = await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), sucursalId: s.sucursalId, tipo: "TERMINAL", nombre: "Posnet viejo", activa: false } });
    // Una sola cuenta activa por sucursal: la del escenario (`cuentaId`, un posnet) se desactiva para que «Banco» (de un tipo que el débito no admite) sea la activa; el efectivo se prueba con la desactivada.
    await prismaAdmin.cuentaDeCobro.update({ where: { id: cuentaId }, data: { activa: false } });
    const banco = await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), sucursalId: s.sucursalId, tipo: "CUENTA_BANCARIA", nombre: "Banco" } });
    const ef = (await prismaAdmin.medioDePago.findFirstOrThrow({ where: { tipo: "EFECTIVO" } })).id;
    const con = (medioDePagoId: string, cuentaDeCobroId: string) => cobrar(cuenta.id, [{ medioDePagoId, importeEnCentavos: c(3000_00), cuentaDeCobroId }], 3000_00);
    // Con el alcance normal (solo la sucursal activa) la RLS por sucursal oculta la cuenta de otra sucursal: no existe para quien cobra. Con un alcance de lectura más ancho se la ve y se la rechaza por su sucursal.
    expect(await con(debito, deOtra.id)).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
    const conLecturaAncha = await cobrarCuentaCasoDeUso(actor([s.sucursalId], [s.sucursalId, norte.id]), { claveIdempotencia: randomUUID(), cuentaId: cuenta.id, totalVistoEnCentavos: c(3000_00), renglones: [{ medioDePagoId: debito, importeEnCentavos: c(3000_00), cuentaDeCobroId: deOtra.id }] }, azarDelProceso);
    expect(conLecturaAncha).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL" });
    expect(await con(debito, inactiva.id)).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_INACTIVA" });
    expect(await con(debito, banco.id)).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_INCOMPATIBLE" });
    expect(await con(debito, randomUUID())).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
    expect(await con(ef, cuentaId)).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_NO_ADMITIDA" });
    expect(await prismaAdmin.cobranza.count()).toBe(0);
    expect(await con(debito, cuentaId)).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_INACTIVA" });
  });

  it("ocho cobros a la vez de la MISMA cuenta con datos dejan uno solo, y ocho reintentos con la misma clave devuelven el mismo (cobrarCuentaCasoDeUso)", async () => {
    const { cuentaId, debito, cuenta } = await escenario();
    const renglones: Renglon[] = [{ medioDePagoId: debito, importeEnCentavos: c(3000_00), cuentaDeCobroId: cuentaId, datos: { cupon: "K1", ultimos4: "1234" } }];
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => cobrarCuentaCasoDeUso(actor(), { claveIdempotencia: randomUUID(), cuentaId: cuenta.id, totalVistoEnCentavos: c(3000_00), renglones }, azarDelProceso)));
    expect(rs.filter((x) => x.status === "fulfilled" && x.value.ok)).toHaveLength(1);
    expect(await prismaAdmin.cobro.count()).toBe(1);
    const otra = await cuentaCerrada();
    const clave = randomUUID();
    const rs2 = await Promise.allSettled(Array.from({ length: 8 }, () => cobrarCuentaCasoDeUso(actor(), { claveIdempotencia: clave, cuentaId: otra.id, totalVistoEnCentavos: c(3000_00), renglones }, azarDelProceso)));
    expect(rs2.every((x) => x.status === "fulfilled" && x.value.ok)).toBe(true);
    expect(await prismaAdmin.cobro.count()).toBe(2);
  });

  it("la base rechaza lo que el caso de uso olvidara: dato no pedido, marca desactivada y un renglón cuya cuenta no es la de su movimiento", async () => {
    const { cuentaId, debito, cuenta } = await escenario();
    const sesion = await prismaAdmin.sesionCaja.findFirstOrThrow();
    const efectivo = await prismaAdmin.medioDePago.findFirstOrThrow({ where: { tipo: "EFECTIVO" } });
    const insertar = async (extra: Record<string, unknown>, cuentaDelMovimiento: string | null = null) =>
      prismaAdmin.$transaction(async (tx) => {
        const cobranzaId = randomUUID();
        const movimientoId = randomUUID();
        await tx.cobranza.create({ data: { id: cobranzaId, sucursalId: s.sucursalId, cuentaId: cuenta.id, sesionId: sesion.id, total: "3000.00", claveIdempotencia: randomUUID(), huella: "a".repeat(64), creadoPorId: s.admin.id } });
        await tx.movimientoCaja.create({ data: { id: movimientoId, sucursalId: s.sucursalId, sesionId: sesion.id, clase: "COBRO", medioDePagoId: debito, cuentaDeCobroId: cuentaDelMovimiento, importe: "3000.00", creadoPorId: s.admin.id } });
        await tx.cobro.create({ data: { id: randomUUID(), sucursalId: s.sucursalId, cobranzaId, orden: 1, medioDePagoId: debito, movimientoId, importe: "3000.00", ...extra } as never });
      });
    expect(efectivo.id).toBeTruthy();
    await expect(insertar({ dni: "12345678" })).rejects.toThrow(/cobro_dato_no_habilitado/);
    await expect(insertar({ cuotas: 3 })).rejects.toThrow(/cobro_dato_no_habilitado/);
    await expect(insertar({ cupon: "4111111111111111" })).rejects.toThrow(/Cobro_cupon_chk/);
    await expect(insertar({ cuotas: 99 })).rejects.toThrow(/Cobro_cuotas_chk|cobro_dato_no_habilitado/);
    await expect(insertar({ cuentaDeCobroId: cuentaId }, null)).rejects.toThrow(/cobro_no_es_su_movimiento/);
    const diners = await prismaAdmin.valorDeLista.create({ data: { id: randomUUID(), lista: "MARCAS_DE_TARJETA", nombre: "Diners", activo: false } });
    await expect(insertar({ marcaDeTarjetaId: diners.id })).rejects.toThrow(/cobro_marca_invalida/);
  });
});

describe("el arqueo se lleva por (medio, cuenta de cobro)", () => {
  it("cerrar deja una línea por cada par con movimientos: «sin cuenta» es un grupo más", async () => {
    const a = await abrir();
    if (!a.ok) throw new Error("no abrió");
    const posnet = await crearCuenta("Posnet 1", "TERMINAL");
    if (!posnet.ok) throw new Error("no creó");
    const debito = await medio("TARJETA_DEBITO", "Débito");
    const c1 = await cuentaCerrada();
    const c2 = await cuentaCerrada();
    expect(await cobrar(c1.id, [{ medioDePagoId: debito, importeEnCentavos: c(3000_00), cuentaDeCobroId: posnet.datos.cuentaDeCobroId }], 3000_00)).toMatchObject({ ok: true });
    // Etapa P-C3: con una sola cuenta activa compatible un renglón sin cuenta la recibe solo; para tener un cobro «sin cuenta» se desactiva la cuenta antes (la sucursal queda sin cuenta activa: la venta no se frena).
    await prismaAdmin.cuentaDeCobro.update({ where: { id: posnet.datos.cuentaDeCobroId }, data: { activa: false } });
    expect(await cobrar(c2.id, [{ medioDePagoId: debito, importeEnCentavos: c(3000_00) }], 3000_00)).toMatchObject({ ok: true });
    const cerrar = (conforme: boolean) => cerrarSesionCasoDeUso(actor(), { sesionId: a.datos.sesionId, conteo: { billetes: {}, monedasEnCentavos: c(0) }, conformeDeLosDemasMedios: conforme, observacion: null }, azarDelProceso);
    expect((await iniciarCierreDeSesion(actor(), { sesionId: a.datos.sesionId })).ok).toBe(true); // C1b: se cierra desde EN_CIERRE
    expect(await cerrar(false)).toMatchObject({ ok: false, codigo: "CONFORME_FALTANTE" });
    expect(await cerrar(true)).toMatchObject({ ok: true, datos: { yaEstabaCerrada: false } });
    const lineas = await prismaAdmin.arqueoCaja.findMany({ where: { sesionId: a.datos.sesionId }, orderBy: { esperado: "asc" } });
    expect(lineas).toHaveLength(3);
    expect(lineas.filter((l) => l.medioDePagoId === debito).map((l) => [l.cuentaDeCobroId, Number(l.esperado)]).sort()).toEqual([[null, 3000], [posnet.datos.cuentaDeCobroId, 3000]].sort());
    expect(await cerrar(true)).toMatchObject({ ok: true, datos: { yaEstabaCerrada: true } });
  });

  it("la base: una línea por (sesión, medio, cuenta) con NULL contando como un grupo, el efectivo sin cuenta y la cuenta de la misma sucursal", async () => {
    const a = await abrir();
    if (!a.ok) throw new Error("no abrió");
    expect((await iniciarCierreDeSesion(actor(), { sesionId: a.datos.sesionId })).ok).toBe(true); // C1b: el conteo (arqueo) entra solo con la sesión EN_CIERRE
    const debito = await medio("TARJETA_DEBITO", "Débito");
    const norte = await prismaAdmin.sucursal.create({ data: { nombre: "Norte" } });
    const deOtra = await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), sucursalId: norte.id, tipo: "TERMINAL", nombre: "Posnet Norte" } });
    const efectivo = await prismaAdmin.medioDePago.findFirstOrThrow({ where: { tipo: "EFECTIVO" } });
    const linea = (medioDePagoId: string, cuentaDeCobroId: string | null) => ({ id: randomUUID(), sucursalId: s.sucursalId, sesionId: a.datos.sesionId, medioDePagoId, cuentaDeCobroId, esperado: "0.00", conforme: true });
    await prismaAdmin.arqueoCaja.create({ data: linea(debito, null) });
    await expect(prismaAdmin.arqueoCaja.create({ data: linea(debito, null) })).rejects.toThrow(/ArqueoCaja_empresaId_sesionId_medioDePagoId_cuentaDeCobroId_key|Unique constraint/);
    await expect(prismaAdmin.arqueoCaja.create({ data: linea(debito, deOtra.id) })).rejects.toThrow(/arqueo_caja_cuenta_de_otra_sucursal/);
    await expect(prismaAdmin.arqueoCaja.create({ data: linea(efectivo.id, deOtra.id) })).rejects.toThrow(/arqueo_caja_cuenta_no_admitida/);
  });
});

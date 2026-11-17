import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { leerCuentasDeCobroDeAdministracion, leerMarcasDeTarjeta, leerMediosDeCobroDeAdministracion } from "../../src/server/actions/caja/lecturas-de-cuentas-y-medios";
import {
  crearCuentaDeCobroDeCaja,
  crearMedioDePagoDeCaja,
  desactivarCuentaDeCobroDeCaja,
  desactivarMedioDePagoDeCaja,
  editarCuentaDeCobroDeCaja,
  editarMedioDePagoDeCaja,
  reactivarCuentaDeCobroDeCaja,
  reactivarMedioDePagoDeCaja,
} from "../../src/server/actions/caja/cuentas-y-medios";
import { entrarComo, sembrarSalon } from "../pos/salon-fixture";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID as EMPRESA, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { CLAVES_DE_CUENTAS_Y_MEDIOS } from "../permisos/oraculo-de-permisos-de-cuentas-y-medios";

/**
 * Caja y cobro, etapa B — las ocho Server Actions de administración (cuentas de cobro y medios de pago) y las tres lecturas, contra Postgres real y la sesión simulada, con usuarios reales. Cubre: (a) el permiso EXACTO de cada acción (con todas las claves MENOS la que exige,
 * o con ninguna, rechaza SIN tocar la base; con solo esa, pasa); (b) el permiso se pide ANTES que el formato y un rechazo de formato del guard (lista de permitidos) no toca la base; (c) la sucursal fuera de alcance, la sucursal y las filas de OTRA empresa; (d) idempotencia (crear dos
 * veces, desactivar y reactivar dos veces, editar con la misma versión dos veces); (e) CONCURRENCIA real (`Promise.all` de las acciones: una alta gana y las demás reciben `SUCURSAL_YA_TIENE_CUENTA_ACTIVA`, nunca un error crudo; dos ediciones con la misma versión; dos reactivaciones en la misma
 * sucursal); (f) `EFECTIVO_NO_SE_DESACTIVA`; (g) las tres lecturas: permiso `caja_ver`, aislamiento entre empresas, alcance de sucursal, activos e inactivos, datos como texto.
 *
 * Mutaciones comprobadas a mano (rojo y revertido): (1) en `cuentas-y-medios.ts` cambiar `conPermiso("caja_cuenta_de_cobro_crear", …)` por `conPermiso("caja_cuenta_de_cobro_editar", …)` → rojo en «(a) con todas MENOS la que exige: crearCuentaDeCobroDeCaja» y en el oráculo
 * `oraculo-de-permisos-de-cuentas-y-medios.test.ts`; (2) sacar la llamada al guard de `editarMedioDePagoDeCaja` (pasar `entrada as never` al caso de uso) → rojo en «(b) formato…». Comprobado y NO detectado: sacar el `true` final (reintento) de `conTransaccionSerializable` en `crearCuentaDeCobroCasoDeUso` deja verde «(e)»: el choque del índice único «una activa por sucursal» se traduce igual a `SUCURSAL_YA_TIENE_CUENTA_ACTIVA` por el `.catch` del caso de uso, así que ese flag no cambia el resultado visible.
 */
type Actor = { id: string; email: string };
let s: Awaited<ReturnType<typeof sembrarSalon>>;
const actores: Record<string, Actor> = {};
const como = (actor: Actor) => entrarComo(actor);

const TODAS = Object.keys(CLAVES_DE_CUENTAS_Y_MEDIOS);

async function rolCon(nombre: string, claves: readonly string[]) {
  const rol = await prisma.rol.create({ data: { nombre } });
  await prisma.permisoRol.createMany({ data: claves.map((accionClave) => ({ rolId: rol.id, accionClave, puedeVer: true, puedeEditar: true })) });
  return rol;
}

const foto = async () => ({
  cuentas: await prismaAdmin.cuentaDeCobro.findMany({ orderBy: { id: "asc" } }),
  medios: await prismaAdmin.medioDePago.findMany({ orderBy: { id: "asc" } }),
  auditoria: await prismaAdmin.registroAuditoria.count(),
});

const datosApagados = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };

async function nuevaCuenta(nombre: string, tipo = "TERMINAL", identificadorExterno: string | null = null, sucursalId = s.sucursalId) {
  await como(s.admin);
  const r = await crearCuentaDeCobroDeCaja({ tipo, nombre, identificadorExterno, sucursalId });
  expect(r, `no creó la cuenta ${nombre}`).toMatchObject({ ok: true });
  return r.cuentaDeCobroId!;
}
async function nuevoMedio(tipo: string, nombre: string | null) {
  await como(s.admin);
  const r = await crearMedioDePagoDeCaja({ tipo, nombre });
  expect(r, `no creó el medio ${nombre}`).toMatchObject({ ok: true });
  return r.medioDePagoId!;
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  __setCookieDeTestParaSucursal(undefined);
  s = await sembrarSalon();
  for (const faltante of TODAS) {
    const rol = await rolCon(`todas-menos-${faltante}`, TODAS.filter((c) => c !== faltante));
    actores[`menos-${faltante}`] = await crearUsuarioConMembresia({ email: `menos-${faltante}@test.com`, sucursalId: s.sucursalId, rolId: rol.id });
    actores[`solo-${faltante}`] = await crearUsuarioConMembresia({ email: `solo-${faltante}@test.com`, sucursalId: s.sucursalId, rolId: (await rolCon(`solo-${faltante}`, [faltante])).id });
  }
  actores.ninguna = await crearUsuarioConMembresia({ email: "ninguna@test.com", sucursalId: s.sucursalId, rolId: (await rolCon("sin-permisos", [])).id });
  actores.soloVer = await crearUsuarioConMembresia({ email: "solo-ver@test.com", sucursalId: s.sucursalId, rolId: (await rolCon("solo-ver", ["caja_ver"])).id });
});

afterAll(() => {
  __setCookieDeTestParaSucursal(undefined);
});

interface Accion {
  nombre: string;
  exige: string;
  /** Prepara lo que la acción necesita (corre como admin) y devuelve la llamada. */
  preparar: () => Promise<() => Promise<{ ok: boolean; mensaje: string; codigo?: string }>>;
}
const ACCIONES: Accion[] = [
  { nombre: "crearCuentaDeCobroDeCaja", exige: "caja_cuenta_de_cobro_crear", preparar: async () => () => crearCuentaDeCobroDeCaja({ tipo: "TERMINAL", nombre: "Terminal 1", identificadorExterno: "T-001", sucursalId: s.sucursalId }) },
  {
    nombre: "editarCuentaDeCobroDeCaja",
    exige: "caja_cuenta_de_cobro_editar",
    preparar: async () => {
      const id = await nuevaCuenta("Terminal 1");
      return () => editarCuentaDeCobroDeCaja({ cuentaDeCobroId: id, versionEsperada: 1, nombre: "Terminal principal", identificadorExterno: null, sucursalId: s.sucursalId });
    },
  },
  {
    nombre: "desactivarCuentaDeCobroDeCaja",
    exige: "caja_cuenta_de_cobro_desactivar",
    preparar: async () => {
      const id = await nuevaCuenta("Terminal 1");
      return () => desactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: id });
    },
  },
  {
    nombre: "reactivarCuentaDeCobroDeCaja",
    exige: "caja_cuenta_de_cobro_reactivar",
    preparar: async () => {
      const id = await nuevaCuenta("Terminal 1");
      expect(await desactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: id })).toMatchObject({ ok: true });
      return () => reactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: id });
    },
  },
  { nombre: "crearMedioDePagoDeCaja", exige: "caja_medio_de_pago_crear", preparar: async () => () => crearMedioDePagoDeCaja({ tipo: "TARJETA_DEBITO", nombre: "Visa Débito" }) },
  {
    nombre: "editarMedioDePagoDeCaja",
    exige: "caja_medio_de_pago_editar",
    preparar: async () => {
      const id = await nuevoMedio("TARJETA_DEBITO", "Visa Débito");
      return () => editarMedioDePagoDeCaja({ medioDePagoId: id, versionEsperada: 1, nombre: "Visa Débito", datos: { ...datosApagados, cupon: true } });
    },
  },
  {
    nombre: "desactivarMedioDePagoDeCaja",
    exige: "caja_medio_de_pago_desactivar",
    preparar: async () => {
      const id = await nuevoMedio("TARJETA_DEBITO", "Visa Débito");
      return () => desactivarMedioDePagoDeCaja({ medioDePagoId: id });
    },
  },
  {
    nombre: "reactivarMedioDePagoDeCaja",
    exige: "caja_medio_de_pago_reactivar",
    preparar: async () => {
      const id = await nuevoMedio("TARJETA_DEBITO", "Visa Débito");
      expect(await desactivarMedioDePagoDeCaja({ medioDePagoId: id })).toMatchObject({ ok: true });
      return () => reactivarMedioDePagoDeCaja({ medioDePagoId: id });
    },
  },
];

const dichoPorPermiso = expect.stringMatching(/permiso|acceso|No tenés|no tiene/i);

describe("(a) cada acción verifica en el servidor el permiso EXACTO, sin tocar la base", () => {
  it("hay una fila por cada una de las ocho claves del oráculo (si falta una acción, este test se pone rojo)", () => {
    expect(ACCIONES.map((a) => a.exige).sort()).toEqual([...TODAS].sort());
    expect(ACCIONES.map((a) => a.nombre).sort()).toEqual(TODAS.map((c) => CLAVES_DE_CUENTAS_Y_MEDIOS[c].accion).sort());
  });

  it.each(ACCIONES.map((a) => [a.nombre, a] as const))("con todas las claves MENOS la que exige: %s rechaza y no cambia nada", async (_n, a) => {
    const llamar = await a.preparar();
    const antes = await foto();
    await como(actores[`menos-${a.exige}`]!);
    expect(await llamar()).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    expect(await foto(), `${a.nombre}: la base cambió`).toEqual(antes);
  });

  it.each(ACCIONES.map((a) => [a.nombre, a] as const))("sin ninguna clave, y solo con caja_ver: %s rechaza y no cambia nada", async (_n, a) => {
    const llamar = await a.preparar();
    const antes = await foto();
    for (const quien of ["ninguna", "soloVer"]) {
      await como(actores[quien]!);
      expect(await llamar(), `${a.nombre} con ${quien}`).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    }
    expect(await foto()).toEqual(antes);
  });

  it.each(ACCIONES.map((a) => [a.nombre, a] as const))("con SOLO la clave exacta: %s pasa", async (_n, a) => {
    const llamar = await a.preparar();
    await como(actores[`solo-${a.exige}`]!);
    expect(await llamar(), `${a.nombre} no pasó con ${a.exige}`).toMatchObject({ ok: true });
  });

  it("un operador de fábrica (rol `operador`, sin fila prendida) no puede ninguna de las ocho; el piso no se lo impide si el gerente le prende la fila", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: s.sucursalId, rolId: s.operador.id });
    await como(operador);
    const antes = await foto();
    expect(await crearCuentaDeCobroDeCaja({ tipo: "TERMINAL", nombre: "Terminal 9", identificadorExterno: null, sucursalId: s.sucursalId })).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    expect(await crearMedioDePagoDeCaja({ tipo: "QR", nombre: null })).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    expect(await foto()).toEqual(antes);
    await prismaAdmin.permisoRol.updateMany({ where: { rolId: s.operador.id, accionClave: "caja_medio_de_pago_crear" }, data: { puedeVer: true, puedeEditar: true } });
    expect(await crearMedioDePagoDeCaja({ tipo: "QR", nombre: null })).toMatchObject({ ok: true });
  });

  it("el cambio de permisos a mitad: se pierde la clave y la MISMA llamada se rechaza", async () => {
    const llamar = await ACCIONES[0]!.preparar();
    await como(actores["solo-caja_cuenta_de_cobro_crear"]!);
    expect(await llamar()).toMatchObject({ ok: true });
    await prismaAdmin.permisoRol.deleteMany({ where: { accionClave: "caja_cuenta_de_cobro_crear", rol: { nombre: "solo-caja_cuenta_de_cobro_crear" } } });
    const antes = await foto();
    expect(await llamar()).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
    expect(await foto()).toEqual(antes);
  });
});

describe("(b) el permiso se pide ANTES que el formato, y un rechazo de formato (lista de permitidos) no toca la base", () => {
  const uuid = randomUUID();
  const cuentaMala = (campo: string, valor: unknown) => ({ tipo: "TERMINAL", nombre: "Terminal 1", identificadorExterno: null, sucursalId: "central", [campo]: valor });
  const edicionMala = (campo: string, valor: unknown) => ({ cuentaDeCobroId: uuid, versionEsperada: 1, nombre: "Terminal 1", identificadorExterno: null, sucursalId: "central", [campo]: valor });
  const medioEditadoMalo = (campo: string, valor: unknown) => ({ medioDePagoId: uuid, versionEsperada: 1, nombre: "Visa", datos: datosApagados, [campo]: valor });

  type Caso = [string, () => Promise<{ ok: boolean; codigo?: string; campo?: string; mensaje: string }>, string, string];
  const CASOS: Caso[] = [
    ["crear cuenta: no es objeto", () => crearCuentaDeCobroDeCaja(null as never), "ENTRADA_INVALIDA", "entrada"],
    ["crear cuenta: tipo fuera del vocabulario", () => crearCuentaDeCobroDeCaja(cuentaMala("tipo", "EFECTIVO") as never), "TIPO_INVALIDO", "tipo"],
    ["crear cuenta: tipo que no es texto", () => crearCuentaDeCobroDeCaja(cuentaMala("tipo", 7) as never), "TIPO_INVALIDO", "tipo"],
    ["crear cuenta: nombre vacío", () => crearCuentaDeCobroDeCaja(cuentaMala("nombre", "   ") as never), "NOMBRE_INVALIDO", "nombre"],
    ["crear cuenta: nombre con signos fuera de la lista", () => crearCuentaDeCobroDeCaja(cuentaMala("nombre", "<b>Terminal</b>") as never), "NOMBRE_INVALIDO", "nombre"],
    ["crear cuenta: nombre que no es texto", () => crearCuentaDeCobroDeCaja(cuentaMala("nombre", { x: 1 }) as never), "NOMBRE_INVALIDO", "nombre"],
    ["crear cuenta: identificador en blanco", () => crearCuentaDeCobroDeCaja(cuentaMala("identificadorExterno", "  ") as never), "IDENTIFICADOR_EXTERNO_INVALIDO", "identificadorExterno"],
    ["crear cuenta: identificador no es texto ni null", () => crearCuentaDeCobroDeCaja(cuentaMala("identificadorExterno", undefined) as never), "IDENTIFICADOR_EXTERNO_INVALIDO", "identificadorExterno"],
    ["crear cuenta: sucursal con forma inválida", () => crearCuentaDeCobroDeCaja(cuentaMala("sucursalId", "../../x") as never), "IDENTIFICADOR_INVALIDO", "sucursalId"],
    ["editar cuenta: id que no es uuid", () => editarCuentaDeCobroDeCaja(edicionMala("cuentaDeCobroId", "no-es-uuid") as never), "IDENTIFICADOR_INVALIDO", "cuentaDeCobroId"],
    ["editar cuenta: versión cero", () => editarCuentaDeCobroDeCaja(edicionMala("versionEsperada", 0) as never), "VERSION_INVALIDA", "versionEsperada"],
    ["editar cuenta: versión decimal", () => editarCuentaDeCobroDeCaja(edicionMala("versionEsperada", 1.5) as never), "VERSION_INVALIDA", "versionEsperada"],
    ["editar cuenta: versión como texto", () => editarCuentaDeCobroDeCaja(edicionMala("versionEsperada", "1") as never), "VERSION_INVALIDA", "versionEsperada"],
    ["editar cuenta: versión por encima del tope de la columna", () => editarCuentaDeCobroDeCaja(edicionMala("versionEsperada", 2_147_483_648) as never), "VERSION_INVALIDA", "versionEsperada"],
    ["editar cuenta: nombre inválido", () => editarCuentaDeCobroDeCaja(edicionMala("nombre", "") as never), "NOMBRE_INVALIDO", "nombre"],
    ["desactivar cuenta: id inválido", () => desactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: "1; DROP TABLE" } as never), "IDENTIFICADOR_INVALIDO", "cuentaDeCobroId"],
    ["reactivar cuenta: sin entrada", () => reactivarCuentaDeCobroDeCaja(undefined as never), "ENTRADA_INVALIDA", "entrada"],
    ["crear medio: tipo desconocido", () => crearMedioDePagoDeCaja({ tipo: "CHEQUE", nombre: null } as never), "TIPO_INVALIDO", "tipo"],
    ["crear medio: nombre inválido", () => crearMedioDePagoDeCaja({ tipo: "QR", nombre: "" } as never), "NOMBRE_INVALIDO", "nombre"],
    ["crear medio: nombre ausente (ni texto ni null)", () => crearMedioDePagoDeCaja({ tipo: "QR" } as never), "NOMBRE_INVALIDO", "nombre"],
    ["editar medio: id inválido", () => editarMedioDePagoDeCaja(medioEditadoMalo("medioDePagoId", "x") as never), "IDENTIFICADOR_INVALIDO", "medioDePagoId"],
    ["editar medio: versión negativa", () => editarMedioDePagoDeCaja(medioEditadoMalo("versionEsperada", -1) as never), "VERSION_INVALIDA", "versionEsperada"],
    ["editar medio: datos con una clave de más", () => editarMedioDePagoDeCaja(medioEditadoMalo("datos", { ...datosApagados, tarjeta: true }) as never), "DATOS_INVALIDOS", "datos"],
    ["editar medio: datos con una clave de menos", () => editarMedioDePagoDeCaja(medioEditadoMalo("datos", { cupon: true, ultimos4: false, marca: false, cuotas: false }) as never), "DATOS_INVALIDOS", "datos"],
    ["editar medio: un dato que no es booleano", () => editarMedioDePagoDeCaja(medioEditadoMalo("datos", { ...datosApagados, dni: "true" }) as never), "DATOS_INVALIDOS", "datos"],
    ["editar medio: datos es una lista", () => editarMedioDePagoDeCaja(medioEditadoMalo("datos", [true, false, false, false, false]) as never), "DATOS_INVALIDOS", "datos"],
    ["desactivar medio: id inválido", () => desactivarMedioDePagoDeCaja({ medioDePagoId: 5 } as never), "IDENTIFICADOR_INVALIDO", "medioDePagoId"],
    ["reactivar medio: sin entrada", () => reactivarMedioDePagoDeCaja(null as never), "ENTRADA_INVALIDA", "entrada"],
  ];

  it.each(CASOS)("con permiso, %s se rechaza por el guard (código y campo) y no toca la base", async (_n, llamar, codigo, campo) => {
    await como(s.admin);
    const antes = await foto();
    expect(await llamar()).toMatchObject({ ok: false, codigo, campo, mensaje: codigo });
    expect(await foto()).toEqual(antes);
  });

  it("sin permiso, un pedido mal formado dice que falta el permiso (no que el formato es inválido), y no toca la base", async () => {
    await como(actores.ninguna!);
    const antes = await foto();
    for (const [, llamar] of CASOS) {
      const r = await llamar();
      expect(r).toMatchObject({ ok: false, mensaje: dichoPorPermiso });
      expect(r.codigo).toBeUndefined();
    }
    expect(await foto()).toEqual(antes);
  });

  it("el guard devuelve la forma canónica: el nombre con espacios de más se guarda recortado y colapsado", async () => {
    await como(s.admin);
    const r = await crearCuentaDeCobroDeCaja({ tipo: "TERMINAL", nombre: "  Terminal   salón  ", identificadorExterno: "  T-009 ", sucursalId: s.sucursalId });
    expect(r).toMatchObject({ ok: true });
    expect(await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id: r.cuentaDeCobroId! } })).toMatchObject({ nombre: "Terminal salón", identificadorExterno: "T-009", activa: true, version: 1 });
  });
});

describe("(c) sucursal fuera de alcance y datos de otra empresa", () => {
  it("crear o editar una cuenta en una sucursal en la que el usuario no está: SUCURSAL_FUERA_DE_ALCANCE (la rechaza el guard: solo vale la sucursal activa), sin escribir; una sucursal de otra empresa, igual", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const rolAdmin = s.admin;
    void rolAdmin;
    const adminNorte = await crearUsuarioConMembresia({ email: "admin-norte@test.com", sucursalId: norte.id, rolId: (await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: s.admin.id } })).rolId });
    const cuentaCentral = await nuevaCuenta("Terminal Central");
    await prismaAdmin.empresa.create({ data: { id: "otra-b", nombre: "Otra", slug: "otra-b", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    const sucursalAjena = await prismaAdmin.sucursal.create({ data: { empresaId: "otra-b", nombre: "Ajena" } });

    await como(adminNorte);
    const antes = await foto();
    expect(await crearCuentaDeCobroDeCaja({ tipo: "TERMINAL", nombre: "Terminal Intrusa", identificadorExterno: null, sucursalId: s.sucursalId })).toMatchObject({ ok: false, codigo: "SUCURSAL_FUERA_DE_ALCANCE" });
    expect(await crearCuentaDeCobroDeCaja({ tipo: "TERMINAL", nombre: "Terminal Ajena", identificadorExterno: null, sucursalId: sucursalAjena.id })).toMatchObject({ ok: false, codigo: "SUCURSAL_FUERA_DE_ALCANCE", campo: "sucursalId" });
    // La cuenta de Central no existe para quien está en Norte (RLS por sucursal): no se edita, no se desactiva, no se reactiva.
    expect(await editarCuentaDeCobroDeCaja({ cuentaDeCobroId: cuentaCentral, versionEsperada: 1, nombre: "Hackeada", identificadorExterno: null, sucursalId: norte.id })).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
    expect(await desactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: cuentaCentral })).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
    expect(await reactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: cuentaCentral })).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
    expect(await foto()).toEqual(antes);

    // Mover una cuenta propia a una sucursal fuera del alcance tampoco se puede.
    const cuentaNorte = await crearCuentaDeCobroDeCaja({ tipo: "TERMINAL", nombre: "Terminal Norte", identificadorExterno: null, sucursalId: norte.id });
    expect(cuentaNorte).toMatchObject({ ok: true });
    expect(await editarCuentaDeCobroDeCaja({ cuentaDeCobroId: cuentaNorte.cuentaDeCobroId!, versionEsperada: 1, nombre: "Terminal Norte", identificadorExterno: null, sucursalId: s.sucursalId })).toMatchObject({ ok: false, codigo: "SUCURSAL_FUERA_DE_ALCANCE" });
    expect(await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id: cuentaNorte.cuentaDeCobroId! } })).toMatchObject({ sucursalId: norte.id, version: 1 });
  });

  it("un medio o una cuenta de OTRA empresa no se ven, no se editan ni se cambian de estado desde esta (RLS por empresa)", async () => {
    await prismaAdmin.empresa.create({ data: { id: "otra-b", nombre: "Otra", slug: "otra-b", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    const sucursalAjena = await prismaAdmin.sucursal.create({ data: { empresaId: "otra-b", nombre: "Ajena" } });
    const medioAjeno = await prismaAdmin.medioDePago.create({ data: { id: randomUUID(), empresaId: "otra-b", tipo: "QR", nombre: "QR ajeno" } });
    const cuentaAjena = await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), empresaId: "otra-b", sucursalId: sucursalAjena.id, tipo: "TERMINAL", nombre: "Terminal ajena" } });
    await como(s.admin);
    const antes = await foto();
    expect(await editarMedioDePagoDeCaja({ medioDePagoId: medioAjeno.id, versionEsperada: 1, nombre: "Mío", datos: datosApagados })).toMatchObject({ ok: false, codigo: "MEDIO_NO_ENCONTRADO" });
    expect(await desactivarMedioDePagoDeCaja({ medioDePagoId: medioAjeno.id })).toMatchObject({ ok: false, codigo: "MEDIO_NO_ENCONTRADO" });
    expect(await reactivarMedioDePagoDeCaja({ medioDePagoId: medioAjeno.id })).toMatchObject({ ok: false, codigo: "MEDIO_NO_ENCONTRADO" });
    expect(await editarCuentaDeCobroDeCaja({ cuentaDeCobroId: cuentaAjena.id, versionEsperada: 1, nombre: "Mía", identificadorExterno: null, sucursalId: s.sucursalId })).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
    expect(await desactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: cuentaAjena.id })).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
    expect(await reactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: cuentaAjena.id })).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
    expect(await foto()).toEqual(antes);
  });
});

describe("(d) idempotencia: repetir no duplica ni vuelve a escribir", () => {
  it("crear la misma cuenta dos veces deja UNA y la segunda dice yaExistia con el mismo id; crear el mismo medio dos veces, igual", async () => {
    await como(s.admin);
    const pedido = { tipo: "TERMINAL", nombre: "Terminal 1", identificadorExterno: "T-001", sucursalId: s.sucursalId };
    const primera = await crearCuentaDeCobroDeCaja(pedido);
    const segunda = await crearCuentaDeCobroDeCaja(pedido);
    expect(primera).toMatchObject({ ok: true, yaExistia: false });
    expect(segunda).toMatchObject({ ok: true, yaExistia: true, cuentaDeCobroId: primera.cuentaDeCobroId });
    expect(await prismaAdmin.cuentaDeCobro.count()).toBe(1);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "CuentaDeCobro" } })).toBe(1);

    const m1 = await crearMedioDePagoDeCaja({ tipo: "TARJETA_CREDITO", nombre: "Visa Crédito" });
    const m2 = await crearMedioDePagoDeCaja({ tipo: "TARJETA_CREDITO", nombre: "Visa Crédito" });
    expect(m1).toMatchObject({ ok: true, yaExistia: false });
    expect(m2).toMatchObject({ ok: true, yaExistia: true, medioDePagoId: m1.medioDePagoId });
    expect(await prismaAdmin.medioDePago.count()).toBe(1);
  });

  it("desactivar dos veces y reactivar dos veces la cuenta: la segunda dice yaEstaba… y no audita de nuevo", async () => {
    const id = await nuevaCuenta("Terminal 1");
    expect(await desactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: id })).toMatchObject({ ok: true, yaEstabaInactiva: false });
    const auditoria = await prismaAdmin.registroAuditoria.count();
    expect(await desactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: id })).toMatchObject({ ok: true, yaEstabaInactiva: true });
    expect(await prismaAdmin.registroAuditoria.count()).toBe(auditoria);
    expect(await reactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: id })).toMatchObject({ ok: true, yaEstabaActiva: false });
    expect(await reactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: id })).toMatchObject({ ok: true, yaEstabaActiva: true });
    expect(await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id } })).toMatchObject({ activa: true });
  });

  it("desactivar dos veces y reactivar dos veces el medio: la segunda dice yaEstaba… y no audita de nuevo", async () => {
    const id = await nuevoMedio("QR", "QR Mercado Pago");
    expect(await desactivarMedioDePagoDeCaja({ medioDePagoId: id })).toMatchObject({ ok: true, yaEstabaInactivo: false });
    const auditoria = await prismaAdmin.registroAuditoria.count();
    expect(await desactivarMedioDePagoDeCaja({ medioDePagoId: id })).toMatchObject({ ok: true, yaEstabaInactivo: true });
    expect(await prismaAdmin.registroAuditoria.count()).toBe(auditoria);
    expect(await reactivarMedioDePagoDeCaja({ medioDePagoId: id })).toMatchObject({ ok: true, yaEstabaActivo: false });
    expect(await reactivarMedioDePagoDeCaja({ medioDePagoId: id })).toMatchObject({ ok: true, yaEstabaActivo: true });
    expect(await prismaAdmin.medioDePago.findUniqueOrThrow({ where: { id } })).toMatchObject({ activo: true });
  });

  it("editar con la misma versión dos veces: la primera sube la versión; repetir lo MISMO no escribe; pedir OTRO cambio con la versión vieja da VERSION_DESACTUALIZADA (cuenta y medio)", async () => {
    const cuenta = await nuevaCuenta("Terminal 1", "TERMINAL", "T-001");
    const pedidoCuenta = { cuentaDeCobroId: cuenta, versionEsperada: 1, nombre: "Terminal principal", identificadorExterno: "T-001", sucursalId: s.sucursalId };
    expect(await editarCuentaDeCobroDeCaja(pedidoCuenta)).toMatchObject({ ok: true, version: 2 });
    const auditoria = await prismaAdmin.registroAuditoria.count();
    expect(await editarCuentaDeCobroDeCaja(pedidoCuenta), "repetir lo mismo no escribe").toMatchObject({ ok: true, version: 2 });
    expect(await prismaAdmin.registroAuditoria.count()).toBe(auditoria);
    expect(await editarCuentaDeCobroDeCaja({ ...pedidoCuenta, nombre: "Terminal del fondo" })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect(await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id: cuenta } })).toMatchObject({ nombre: "Terminal principal", version: 2 });

    const medio = await nuevoMedio("TARJETA_DEBITO", "Visa Débito");
    const pedidoMedio = { medioDePagoId: medio, versionEsperada: 1, nombre: "Visa Débito", datos: { ...datosApagados, cupon: true } };
    expect(await editarMedioDePagoDeCaja(pedidoMedio)).toMatchObject({ ok: true, version: 2 });
    expect(await editarMedioDePagoDeCaja(pedidoMedio), "repetir lo mismo no escribe").toMatchObject({ ok: true, version: 2 });
    expect(await editarMedioDePagoDeCaja({ ...pedidoMedio, datos: { ...datosApagados, ultimos4: true } })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect(await prismaAdmin.medioDePago.findUniqueOrThrow({ where: { id: medio } })).toMatchObject({ pideCupon: true, pideUltimos4: false, version: 2 });
  });
});

describe("(e) concurrencia real: una gana y la otra recibe un rechazo cerrado, nunca un error crudo", () => {
  it("seis altas de cuenta ACTIVA a la vez en la misma sucursal: exactamente una gana; las demás, SUCURSAL_YA_TIENE_CUENTA_ACTIVA", async () => {
    await como(s.admin);
    const resultados = await Promise.all(Array.from({ length: 6 }, (_, i) => crearCuentaDeCobroDeCaja({ tipo: "TERMINAL", nombre: `Terminal ${i + 1}`, identificadorExterno: null, sucursalId: s.sucursalId })));
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    for (const r of resultados.filter((x) => !x.ok)) expect(r).toMatchObject({ ok: false, codigo: "SUCURSAL_YA_TIENE_CUENTA_ACTIVA" });
    expect(await prismaAdmin.cuentaDeCobro.count({ where: { sucursalId: s.sucursalId, activa: true } })).toBe(1);
    expect(await prismaAdmin.cuentaDeCobro.count()).toBe(1);
  });

  it("seis altas IGUALES a la vez dejan una sola cuenta (las perdedoras ven la primera: yaExistia)", async () => {
    await como(s.admin);
    const resultados = await Promise.all(Array.from({ length: 6 }, () => crearCuentaDeCobroDeCaja({ tipo: "TERMINAL", nombre: "Terminal única", identificadorExterno: "T-1", sucursalId: s.sucursalId })));
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(new Set(resultados.map((r) => r.cuentaDeCobroId)).size).toBe(1);
    expect(resultados.filter((r) => r.yaExistia === false)).toHaveLength(1);
    expect(await prismaAdmin.cuentaDeCobro.count()).toBe(1);
  });

  it("dos reactivaciones a la vez de dos cuentas inactivas de la misma sucursal: una gana y la otra recibe SUCURSAL_YA_TIENE_CUENTA_ACTIVA", async () => {
    const a = await nuevaCuenta("Terminal A");
    expect(await desactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: a })).toMatchObject({ ok: true });
    const b = await nuevaCuenta("Terminal B");
    expect(await desactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: b })).toMatchObject({ ok: true });
    const [ra, rb] = await Promise.all([reactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: a }), reactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: b })]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    expect([ra, rb].find((r) => !r.ok)).toMatchObject({ ok: false, codigo: "SUCURSAL_YA_TIENE_CUENTA_ACTIVA" });
    expect(await prismaAdmin.cuentaDeCobro.count({ where: { activa: true } })).toBe(1);
  });

  it("dos ediciones a la vez con la MISMA versión (cuenta y medio): una gana (versión 2) y la otra recibe VERSION_DESACTUALIZADA", async () => {
    const cuenta = await nuevaCuenta("Terminal 1");
    const [c1, c2] = await Promise.all([
      editarCuentaDeCobroDeCaja({ cuentaDeCobroId: cuenta, versionEsperada: 1, nombre: "Terminal A", identificadorExterno: null, sucursalId: s.sucursalId }),
      editarCuentaDeCobroDeCaja({ cuentaDeCobroId: cuenta, versionEsperada: 1, nombre: "Terminal B", identificadorExterno: null, sucursalId: s.sucursalId }),
    ]);
    expect([c1.ok, c2.ok].filter(Boolean)).toHaveLength(1);
    expect([c1, c2].find((r) => !r.ok)).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect((await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id: cuenta } })).version).toBe(2);

    const medio = await nuevoMedio("TARJETA_CREDITO", "Visa Crédito");
    const [m1, m2] = await Promise.all([
      editarMedioDePagoDeCaja({ medioDePagoId: medio, versionEsperada: 1, nombre: "Visa Crédito", datos: { ...datosApagados, cuotas: true } }),
      editarMedioDePagoDeCaja({ medioDePagoId: medio, versionEsperada: 1, nombre: "Visa Crédito", datos: { ...datosApagados, marca: true } }),
    ]);
    expect([m1.ok, m2.ok].filter(Boolean)).toHaveLength(1);
    expect([m1, m2].find((r) => !r.ok)).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect((await prismaAdmin.medioDePago.findUniqueOrThrow({ where: { id: medio } })).version).toBe(2);
  });

  it("dos desactivaciones a la vez de la misma cuenta: las dos salen bien y la cuenta queda inactiva (una sola escritura)", async () => {
    const id = await nuevaCuenta("Terminal 1");
    const rs = await Promise.all([desactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: id }), desactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: id })]);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(rs.filter((r) => r.yaEstabaInactiva === false)).toHaveLength(1);
    expect(await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id } })).toMatchObject({ activa: false });
  });
});

describe("(f) el efectivo no se desactiva", () => {
  it("EFECTIVO_NO_SE_DESACTIVA, sin escribir; el efectivo se puede crear una sola vez y los demás medios sí se desactivan y reactivan", async () => {
    const efectivo = await nuevoMedio("EFECTIVO", null);
    const antes = await foto();
    expect(await desactivarMedioDePagoDeCaja({ medioDePagoId: efectivo })).toMatchObject({ ok: false, codigo: "EFECTIVO_NO_SE_DESACTIVA" });
    expect(await foto()).toEqual(antes);
    expect(await crearMedioDePagoDeCaja({ tipo: "EFECTIVO", nombre: "Caja chica" })).toMatchObject({ ok: false, codigo: "EFECTIVO_YA_EXISTE" });
    expect(await reactivarMedioDePagoDeCaja({ medioDePagoId: efectivo })).toMatchObject({ ok: true, yaEstabaActivo: true });
  });

  it("pedir un dato que el tipo de medio no admite: DATO_NO_ADMITIDO_POR_EL_MEDIO con el nombre del dato, sin escribir", async () => {
    const efectivo = await nuevoMedio("EFECTIVO", null);
    const debito = await nuevoMedio("TARJETA_DEBITO", "Visa Débito");
    const antes = await foto();
    expect(await editarMedioDePagoDeCaja({ medioDePagoId: efectivo, versionEsperada: 1, nombre: null, datos: { ...datosApagados, cupon: true } })).toMatchObject({ ok: false, codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato: "cupon" });
    expect(await editarMedioDePagoDeCaja({ medioDePagoId: debito, versionEsperada: 1, nombre: "Visa Débito", datos: { ...datosApagados, cuotas: true } })).toMatchObject({ ok: false, codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato: "cuotas" });
    expect(await foto()).toEqual(antes);
  });
});

describe("(g) las tres lecturas de administración (bajo caja_ver)", () => {
  it("piden `caja_ver`: sin ella (con las ocho de administración pero sin ver, o sin nada) rechazan; con solo `caja_ver` leen", async () => {
    for (const quien of ["ninguna", ...TODAS.map((c) => `solo-${c}`)]) {
      await como(actores[quien]!);
      await expect(leerCuentasDeCobroDeAdministracion(), quien).rejects.toThrow(/permiso|acceso|No tenés|no tiene/i);
      await expect(leerMediosDeCobroDeAdministracion(), quien).rejects.toThrow(/permiso|acceso|No tenés|no tiene/i);
      await expect(leerMarcasDeTarjeta(), quien).rejects.toThrow(/permiso|acceso|No tenés|no tiene/i);
    }
    await como(actores.soloVer!);
    await expect(leerCuentasDeCobroDeAdministracion()).resolves.toEqual([]);
    await expect(leerMediosDeCobroDeAdministracion()).resolves.toEqual([]);
    await expect(leerMarcasDeTarjeta()).resolves.toBeInstanceOf(Array);
  });

  it("devuelven activos e inactivos, con tipo, identificador, versión, sucursal y qué datos pide, como texto (nunca fechas ni objetos crudos)", async () => {
    const t1 = await nuevaCuenta("Terminal 1", "TERMINAL", "T-001");
    expect(await desactivarCuentaDeCobroDeCaja({ cuentaDeCobroId: t1 })).toMatchObject({ ok: true });
    const qr = await nuevaCuenta("QR salón", "QR", null);
    const credito = await nuevoMedio("TARJETA_CREDITO", "Visa Crédito");
    expect(await editarMedioDePagoDeCaja({ medioDePagoId: credito, versionEsperada: 1, nombre: "Visa Crédito", datos: { ...datosApagados, ultimos4: true, cuotas: true } })).toMatchObject({ ok: true });
    const debito = await nuevoMedio("TARJETA_DEBITO", "Visa Débito");
    expect(await desactivarMedioDePagoDeCaja({ medioDePagoId: debito })).toMatchObject({ ok: true });

    await como(actores.soloVer!);
    const cuentas = await leerCuentasDeCobroDeAdministracion();
    expect(cuentas).toEqual([
      { id: qr, tipo: "QR", nombre: "QR salón", identificadorExterno: null, version: 1, sucursalId: s.sucursalId, sucursalNombre: "Central", activa: true },
      { id: t1, tipo: "TERMINAL", nombre: "Terminal 1", identificadorExterno: "T-001", version: 2, sucursalId: s.sucursalId, sucursalNombre: "Central", activa: false },
    ]);
    const medios = await leerMediosDeCobroDeAdministracion();
    expect(medios).toEqual([
      { id: credito, tipo: "TARJETA_CREDITO", nombre: "Visa Crédito", activo: true, version: 2, datosQuePide: ["ultimos4", "cuotas"] },
      { id: debito, tipo: "TARJETA_DEBITO", nombre: "Visa Débito", activo: false, version: 2, datosQuePide: [] },
    ]);
    for (const fila of [...cuentas, ...medios]) for (const valor of Object.values(fila)) expect(["string", "number", "boolean"].includes(typeof valor) || valor === null || Array.isArray(valor)).toBe(true);
  });

  it("aislamiento entre empresas: no devuelven cuentas ni medios de otra empresa", async () => {
    await prismaAdmin.empresa.create({ data: { id: "otra-b", nombre: "Otra", slug: "otra-b", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    const sucursalAjena = await prismaAdmin.sucursal.create({ data: { empresaId: "otra-b", nombre: "Ajena" } });
    await prismaAdmin.medioDePago.create({ data: { id: randomUUID(), empresaId: "otra-b", tipo: "QR", nombre: "QR ajeno" } });
    await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), empresaId: "otra-b", sucursalId: sucursalAjena.id, tipo: "TERMINAL", nombre: "Terminal ajena" } });
    const propia = await nuevaCuenta("Terminal propia");
    const medioPropio = await nuevoMedio("QR", "QR propio");
    await como(actores.soloVer!);
    expect((await leerCuentasDeCobroDeAdministracion()).map((c) => c.id)).toEqual([propia]);
    expect((await leerMediosDeCobroDeAdministracion()).map((m) => m.id)).toEqual([medioPropio]);
  });

  it("alcance de sucursal: quien está en Norte no ve las cuentas de Central (los medios, de la empresa, sí)", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const rol = await rolCon("ver-norte", ["caja_ver"]);
    const verNorte = await crearUsuarioConMembresia({ email: "ver-norte@test.com", sucursalId: norte.id, rolId: rol.id });
    const central = await nuevaCuenta("Terminal Central");
    const medio = await nuevoMedio("QR", "QR de la empresa");
    await como(s.admin);
    const deNorte = await crearCuentaDeCobroDeCaja({ tipo: "TERMINAL", nombre: "Terminal Norte", identificadorExterno: null, sucursalId: norte.id });
    expect(deNorte).toMatchObject({ ok: false, codigo: "SUCURSAL_FUERA_DE_ALCANCE" });
    await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), empresaId: EMPRESA, sucursalId: norte.id, tipo: "TERMINAL", nombre: "Terminal Norte" } });
    await como(verNorte);
    expect((await leerCuentasDeCobroDeAdministracion()).map((c) => c.nombre)).toEqual(["Terminal Norte"]);
    expect((await leerMediosDeCobroDeAdministracion()).map((m) => m.id)).toEqual([medio]);
    await como(actores.soloVer!);
    expect((await leerCuentasDeCobroDeAdministracion()).map((c) => c.id)).toEqual([central]);
  });

  it("las marcas de tarjeta: la lista global activa, con «Otra» (fija) al final", async () => {
    await como(actores.soloVer!);
    const marcas = await leerMarcasDeTarjeta();
    expect(marcas.length).toBeGreaterThanOrEqual(6);
    expect(marcas.map((m) => m.nombre)).toEqual(expect.arrayContaining(["Visa", "Mastercard", "American Express", "Cabal", "Naranja X", "Otra"]));
    expect(marcas[marcas.length - 1]).toMatchObject({ nombre: "Otra", fija: true });
    for (const m of marcas) expect(Object.keys(m).sort()).toEqual(["fija", "id", "nombre"]);
  });
});

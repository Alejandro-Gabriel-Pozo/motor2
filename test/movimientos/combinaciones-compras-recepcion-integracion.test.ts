import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { tablaDeRecepcion } from "../setup/oraculo-compras-recepcion";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { confirmarRecepcionDeFacturaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/confirmar-recepcion-de-factura";
import { anularFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-factura-proveedor";
import { confirmarRecepcionDeFactura } from "../../src/server/actions/movimientos/facturas-proveedor";
import { requierePermiso } from "../../src/server/acceso/gate";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario, sumarDias } from "../../src/core/tiempo/zona-horaria";
import type { ContextoDeAccion } from "../../src/server/actions/tipos";

/**
 * Compras N3-a, recepción separada — el ORÁCULO DE COMBINACIONES contra la base real (regla «Combinaciones» del dueño). `docs/oraculo-combinaciones-compras-recepcion-2026-11-16.md` es la tabla de reglas esperadas, escrita aparte del
 * código; `test/core/combinaciones-compras-recepcion.test.ts` recorre TODAS sus filas contra las reglas puras. Acá se recorre contra los casos de uso y la Server Action reales, con Postgres:
 *  - «Cargar la factura» (módulo × reparto): con qué estado nace la parte y si entra o no el stock;
 *  - «Confirmar la recepción» con módulo encendido y rol administrador, TODAS las combinaciones de sucursal de la parte × estado × sección × fecha (54), contra el caso de uso: el resultado y, cuando confirma, el stock; cuando rechaza, que
 *    no entró nada;
 *  - la puerta de la Server Action (módulo × rol): con una parte pendiente, propia, sección activa propia y fecha válida, el guard real decide (6 filas).
 * (El resto de las combinaciones —módulo o rol rechazados con cualquier estado— lo cubre el recorrido exhaustivo de las reglas puras: el guard rechaza antes de mirar nada más.)
 */
const E = EMPRESA_POR_DEFECTO_ID;
const diaDeHoy = () => diaDeCalendario(new Date(), ZONA_ARGENTINA);
const mediodia = (dias: number) => mediodiaDelDia(sumarDias(diaDeHoy(), dias), ZONA_ARGENTINA);
const DIAS_DE_LA_FACTURA = -5;
/** La fecha de stock de cada valor de la dimensión F, respecto de la factura (día -5) y de hoy. */
const FECHA_DE_STOCK: Record<string, Date> = { VALIDA: mediodia(-3), ANTERIOR_A_LA_FACTURA: mediodia(-6), FUTURA: mediodia(1) };

let s3: string, s4: string;
let secDe: Record<string, { activa: string; inactiva: string }>;
let admin3: string, admin4: string;
let harina: string, proveedorId: string;
let numero = 0;

const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
const actorDe = (usuarioId: string, sucursalId: string, sucursalNombre: string) =>
  ({ usuarioId, empresaId: E, sucursalId, sucursalNombre, ahora: new Date(), membresias: [{ sucursalId: s3 }, { sucursalId: s4 }] as never, ...baseDe(sucursalId) }) as unknown as ContextoDeAccion;
const actor3 = () => actorDe(admin3, s3, "Central");

const nuevoNumero = () => `A-00001-${String(++numero).padStart(8, "0")}`;
async function cargar(reparto: { sucursalId: string; valor: number }[]) {
  const r = await registrarFacturaProveedorCasoDeUso(actor3(), {
    fecha: mediodia(DIAS_DE_LA_FACTURA),
    proveedorId,
    nroFactura: nuevoNumero(),
    seccionId: secDe[s3]!.activa,
    items: [{ productoId: harina, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
    reparto: { modo: "PORCENTAJE", partes: reparto },
    claveIdempotencia: randomUUID(),
  });
  expect(r.ok, r.mensaje).toBe(true);
  return (r.ok && r.datos.facturaId) as string;
}
const parteDe = (facturaId: string) => prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { facturaProveedorId: facturaId, sucursalId: s3 } });
const comprasDeStock = () => prisma.operacion.count({ where: { proceso: "COMPRA" } });

beforeEach(async () => {
  __setCookieDeTestParaSucursal(undefined);
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  s3 = base.sucursal.id;
  s4 = (await prisma.sucursal.create({ data: { nombre: "Sucursal 4" } })).id;
  secDe = {};
  for (const s of [s3, s4]) {
    const activa = await sembrarSeccion(s, "Depósito");
    const inactiva = await prisma.seccion.create({ data: { sucursalId: s, nombre: "Vieja", activa: false } });
    secDe[s] = { activa: activa.id, inactiva: inactiva.id };
  }
  admin3 = (await crearUsuarioConMembresia({ email: "admin3@test.com", sucursalId: s3, rolId: base.admin.id })).id;
  admin4 = (await crearUsuarioConMembresia({ email: "admin4@test.com", sucursalId: s4, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  await prisma.disponibilidadProducto.createMany({ data: [s3, s4].map((sucursalId) => ({ sucursalId, productoId: harina, disponible: true })) });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  numero = 0;
});

describe("oráculo contra la base real: cargar la factura (módulo × reparto)", () => {
  const filas = tablaDeRecepcion("Cargar la factura").filas;

  it.each(filas.map((f) => [f["M"]!, f["R"]!, f["Resultado"]!]))("módulo %s, reparto %s → %s", async (M, R, resultado) => {
    await fijarModulosActivos(E, M === "ENCENDIDO" ? [...MODULOS_VENDIBLES, "recepcion_de_compras"] : MODULOS_VENDIBLES);

    const facturaId = await cargar(R === "UNA_PARTE" ? [{ sucursalId: s3, valor: 100 }] : [{ sucursalId: s3, valor: 50 }, { sucursalId: s4, valor: 50 }]);

    const parte = await parteDe(facturaId);
    if (resultado === "PARTE_PENDIENTE_SIN_STOCK") {
      expect([parte.estadoRecepcion, parte.operacionId, parte.recibidaEn]).toEqual(["PENDIENTE", null, null]);
      expect([await comprasDeStock(), await prisma.movimientoStock.count()]).toEqual([0, 0]);
    } else {
      expect([parte.estadoRecepcion, Boolean(parte.operacionId), Boolean(parte.recibidaEn)]).toEqual(["RECIBIDA", true, true]);
      expect(await comprasDeStock()).toBe(1);
      expect(await prisma.movimientoStock.count({ where: { facturaProveedorRenglon: { facturaProveedorId: facturaId }, proceso: "COMPRA" } })).toBe(1);
    }
  });
});

describe("oráculo contra la base real: confirmar la recepción (módulo encendido, rol administrador)", () => {
  const filas = tablaDeRecepcion("Confirmar la recepción").filas.filter((f) => f["M"] === "ENCENDIDO" && f["O"] === "ADMINISTRADOR");

  it("el recorte tiene las 54 combinaciones de sucursal de la parte × estado × sección × fecha", () => {
    expect(filas).toHaveLength(54);
  });

  it("cada combinación da el resultado de la tabla, y escribe stock solo cuando CONFIRMA", { timeout: 240_000 }, async () => {
    await fijarModulosActivos(E, [...MODULOS_VENDIBLES, "recepcion_de_compras"]);
    for (const fila of filas) {
      const { P, E: estado, S, F } = { P: fila["P"]!, E: fila["E"]!, S: fila["S"]!, F: fila["F"]! };
      const clave = `P=${P} E=${estado} S=${S} F=${F}`;
      const facturaId = await cargar([{ sucursalId: s3, valor: 100 }]);
      // El estado de la parte (dimensión E): pendiente tal cual nace, recibida confirmándola antes, anulada anulando la factura pendiente.
      if (estado === "RECIBIDA") expect((await confirmarRecepcionDeFacturaCasoDeUso(actor3(), { facturaId, seccionId: secDe[s3]!.activa, fechaStock: mediodia(-3) })).ok, clave).toBe(true);
      if (estado === "ANULADA") expect((await anularFacturaProveedorCasoDeUso(actor3(), { facturaId, motivo: "Prueba de combinaciones", claveIdempotencia: randomUUID() })).ok, clave).toBe(true);
      // Quién confirma (dimensión P) y qué sección elige (dimensión S, respecto de SU sucursal).
      const [quien, suSucursal, nombre, otraSucursal] = P === "PROPIA" ? [admin3, s3, "Central", s4] : [admin4, s4, "Sucursal 4", s3];
      const seccionId = S === "PROPIA_ACTIVA" ? secDe[suSucursal]!.activa : S === "INACTIVA" ? secDe[suSucursal]!.inactiva : secDe[otraSucursal]!.activa;
      const antes = await comprasDeStock();

      const r = await confirmarRecepcionDeFacturaCasoDeUso(actorDe(quien, suSucursal, nombre), { facturaId, seccionId, fechaStock: FECHA_DE_STOCK[F]! });

      expect(r.ok ? "CONFIRMA" : `RECHAZA_${r.codigo}`, clave).toBe(fila["Resultado"]);
      const parte = await parteDe(facturaId);
      if (r.ok) {
        expect([parte.estadoRecepcion, Boolean(parte.operacionId), await comprasDeStock()], clave).toEqual(["RECIBIDA", true, antes + 1]);
        expect(await prisma.movimientoStock.count({ where: { operacionId: parte.operacionId as string, seccionId } }), clave).toBe(1);
      } else {
        // Un rechazo no escribe NADA: la cantidad de compras no cambia y la parte conserva su estado de antes.
        expect(await comprasDeStock(), clave).toBe(antes);
        expect(parte.estadoRecepcion, clave).toBe(estado === "RECIBIDA" ? "RECIBIDA" : "PENDIENTE");
      }
    }
  });
});

describe("oráculo contra la base real: la puerta de la Server Action (módulo × rol)", () => {
  const filas = tablaDeRecepcion("Confirmar la recepción").filas.filter((f) => f["P"] === "PROPIA" && f["E"] === "PENDIENTE" && f["S"] === "PROPIA_ACTIVA" && f["F"] === "VALIDA");

  it("el recorte tiene las 6 combinaciones de módulo × rol", () => {
    expect(filas.map((f) => `${f["M"]}|${f["O"]}`).sort()).toEqual(["APAGADO|ADMINISTRADOR", "APAGADO|GERENTE", "APAGADO|OPERADOR", "ENCENDIDO|ADMINISTRADOR", "ENCENDIDO|GERENTE", "ENCENDIDO|OPERADOR"]);
  });

  it.each(filas.map((f) => [f["M"]!, f["O"]!, f["Resultado"]!]))("módulo %s, rol %s → %s", async (M, O, resultado) => {
    const base = await prisma.rol.findFirstOrThrow({ where: { clave: O === "OPERADOR" ? "operador" : "admin" } });
    const usuario = await crearUsuarioConMembresia({ email: `${O.toLowerCase()}@test.com`, sucursalId: s3, rolId: base.id });
    if (O === "GERENTE") await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: E } }, data: { rolEmpresa: "gerente" } });
    // Aun con la fila en la matriz, el operador no llega al piso: el servidor decide por el piso, no por la pantalla.
    await prisma.permisoRol.updateMany({ where: { rolId: base.id, accionClave: "compra_recibir" }, data: { puedeVer: true, puedeEditar: true } });
    await fijarModulosActivos(E, [...MODULOS_VENDIBLES, "recepcion_de_compras"]);
    const facturaId = await cargar([{ sucursalId: s3, valor: 100 }]);
    await fijarModulosActivos(E, M === "ENCENDIDO" ? [...MODULOS_VENDIBLES, "recepcion_de_compras"] : MODULOS_VENDIBLES);
    __setCookieDeTestParaSucursal(s3);
    await mockearUsuarioActual({ id: usuario.id, email: `${O.toLowerCase()}@test.com`, nombre: null });
    const gate = await requierePermiso(usuario.id, s3, "compra_recibir", prisma);

    const r = await confirmarRecepcionDeFactura(facturaId, secDe[s3]!.activa, FECHA_DE_STOCK["VALIDA"]!);

    if (resultado === "CONFIRMA") {
      expect([gate.ok, r.ok]).toEqual([true, true]);
      expect((await parteDe(facturaId)).estadoRecepcion).toBe("RECIBIDA");
      expect(await comprasDeStock()).toBe(1);
    } else {
      expect(gate.ok).toBe(false);
      expect(r).toEqual({ ok: false, mensaje: gate.ok ? "" : gate.mensaje });
      expect(gate.ok ? "" : gate.motivo).toBe(resultado === "RECHAZA_MODULO_NO_ACTIVO" ? "MODULO_NO_ACTIVO" : "SIN_PERMISO");
      expect((await parteDe(facturaId)).estadoRecepcion).toBe("PENDIENTE");
      expect(await comprasDeStock()).toBe(0);
    }
  });
});

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { dimensionesDeOrden, productoCartesiano, tablaDeOrden } from "../setup/oraculo-compras-orden";
import { azarDelProceso } from "../../src/lib/azar";
import { crearOrdenDeCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/crear-orden-de-compra";
import { pedirOrdenDeCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/pedir-orden-de-compra";
import { anularOrdenDeCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-orden-de-compra";
import { cerrarOrdenDeCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/cerrar-orden-de-compra";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { confirmarRecepcionDeFacturaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/confirmar-recepcion-de-factura";
import { registrarControlDeRecepcionCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-control-de-recepcion";
import { diaDeCalendario, mediodiaDelDia, sumarDias, ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import type { ContextoDeAccion } from "../../src/server/actions/tipos";

/**
 * Oráculo de combinaciones de la orden de compra contra la BASE REAL (el resultado del caso de uso, no solo el de la regla pura): pedir, anular y cerrar por estado × (líneas, entrega | compras vigentes, motivo | compras pendientes) y el control de exceso
 * al confirmar la recepción (nivel × confirmación × cantidad × renglón rechazado), todo contra las tablas de `docs/oraculo-combinaciones-compras-orden-2026-11-17.md`. Algunas combinaciones son INALCANZABLES con la base real (por ejemplo, una compra vigente
 * contra una orden en BORRADOR: el vínculo exige una orden pedida): se declaran acá una por una y la regla pura las cubre en `test/core/combinaciones-compras-orden.test.ts`.
 */
const E = EMPRESA_POR_DEFECTO_ID;
const DIMENSIONES = dimensionesDeOrden();
const hoy = () => diaDeCalendario(new Date(), ZONA_ARGENTINA);
const mediodia = (dias: number) => mediodiaDelDia(sumarDias(hoy(), dias), ZONA_ARGENTINA);

let s3: string, sec3: string, admin: string, harina: string, proveedorId: string;
const actor = (ahora = new Date()) => ({ usuarioId: admin, empresaId: E, sucursalId: s3, sucursalNombre: "Central", ahora, membresias: [{ sucursalId: s3 }] as never, ...baseDeTest({ lectura: [s3], escritura: [s3] }) }) as unknown as ContextoDeAccion;

async function crear(extra: { entrega?: string } = {}): Promise<string> {
  const r = await crearOrdenDeCompraCasoDeUso(actor(), { proveedorId, fechaDeEntregaPrevista: extra.entrega ?? null, lineas: [{ productoId: harina, cantidad: 10, precio: 100 }], claveIdempotencia: randomUUID() }, azarDelProceso);
  expect(r.ok, r.mensaje).toBe(true);
  return (r.ok && r.datos.ordenId) as string;
}
const pedir = (id: string, ahora?: Date) => pedirOrdenDeCompraCasoDeUso(actor(ahora), { ordenId: id });
const cargarContra = (ordenId: string, cantidad: number, confirmoExceso = false) =>
  registrarFacturaProveedorCasoDeUso(
    actor(),
    {
      fecha: mediodia(-1),
      proveedorId,
      nroFactura: `A-00001-${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      items: [{ productoId: harina, cantidad, precioTotal: cantidad * 100, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
      reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 100 }] },
      ordenDeCompra: { ordenId, renglones: [{ itemIndex: 0, lineaDeOrden: 1, confirmoExceso }] },
      claveIdempotencia: randomUUID(),
    },
    azarDelProceso
  );
const confirmar = async (facturaId: string) => {
  const entradas = (await prisma.facturaProveedorRenglon.findMany({ where: { facturaProveedorId: facturaId, productoId: { not: null } } })).map((r) => ({ renglonId: r.id, seccionId: sec3, cantidad: Number(r.cantidadStock) }));
  return confirmarRecepcionDeFacturaCasoDeUso(actor(), { facturaId, entradas, fechaStock: mediodia(0) });
};
const id = (r: { ok: boolean; datos?: { facturaId?: string } }) => r.datos?.facturaId as string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  s3 = base.sucursal.id;
  sec3 = (await sembrarSeccion(s3)).id;
  admin = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s3, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  await prisma.disponibilidadProducto.create({ data: { sucursalId: s3, productoId: harina, disponible: true } });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  await fijarModulosActivos(E, [...MODULOS_VENDIBLES, "ordenes_de_compra"]);
});

/** Lleva una orden nueva al estado pedido. `compras`: «ninguna», «pendiente» (cargada y sin recibir) o «recibida» (cargada y recibida). */
async function ordenEn(estado: string, compras: "ninguna" | "pendiente" | "recibida" = "ninguna"): Promise<string> {
  const ordenId = await crear();
  if (estado === "BORRADOR") return ordenId;
  expect((await pedir(ordenId)).ok).toBe(true);
  if (compras !== "ninguna") {
    const c = await cargarContra(ordenId, 4);
    expect(c.ok, c.mensaje).toBe(true);
    if (compras === "recibida") expect((await confirmar(id(c))).ok).toBe(true);
  }
  if (estado === "CERRADA") expect((await cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId })).ok).toBe(true);
  if (estado === "ANULADA") expect((await anularOrdenDeCompraCasoDeUso(actor(), { ordenId, motivo: "Ya no hace falta" })).ok).toBe(true);
  return ordenId;
}
const estadoDe = async (ordenId: string) => (await prisma.ordenDeCompra.findUniqueOrThrow({ where: { id: ordenId } })).estado;

describe("oráculo contra la base: pedir la orden", () => {
  const fila = tablaDeOrden("Pedir la orden").filas;
  it("cada combinación estado × líneas × entrega da el resultado de la tabla", async () => {
    expect(fila).toHaveLength(24);
    for (const f of fila) {
      await limpiarOrdenes();
      const ordenId = await ordenEn(f["E"]!);
      if (f["L"] === "SIN_LINEAS" && f["E"] === "BORRADOR") await prismaAdmin.lineaDeOrdenDeCompra.updateMany({ where: { ordenId }, data: { retirada: true } });
      let ahora = new Date();
      if (f["D"] === "ENTREGA_ANTERIOR") {
        // La entrega prevista valía al crear (hoy); la pasada de «ahora» la deja anterior al día del pedido.
        await prismaAdmin.$executeRaw`UPDATE "OrdenDeCompra" SET "fechaDeEntregaPrevista" = ${hoy()}::date WHERE "id" = ${ordenId}::uuid`;
        ahora = new Date(mediodia(2));
      } else if (f["D"] === "ENTREGA_HOY_O_FUTURA") {
        await prismaAdmin.$executeRaw`UPDATE "OrdenDeCompra" SET "fechaDeEntregaPrevista" = ${hoy()}::date WHERE "id" = ${ordenId}::uuid`;
      }
      const r = await pedir(ordenId, ahora);
      expect(r.ok ? "PIDE" : `RECHAZA_${r.codigo}`, `E=${f["E"]} L=${f["L"]} D=${f["D"]}`).toBe(f["Resultado"]);
    }
  }, 120_000);
});

const MOTIVO: Record<string, string> = { MOTIVO_VALIDO: "El proveedor no entregó", MOTIVO_VACIO: "   ", MOTIVO_INVALIDO: "Motivo <script>" };
/** Las combinaciones que la base real no puede producir (una compra vigente o pendiente exige una orden pedida; una orden cerrada o anulada ya no tiene pendientes y una anulada no tiene compras vigentes). */
const inalcanzableAnular = (f: Record<string, string>) => f["V"] === "CON_COMPRAS_VIGENTES" && (f["E"] === "BORRADOR" || f["E"] === "ANULADA");
const inalcanzableCerrar = (f: Record<string, string>) => f["W"] === "CON_COMPRAS_PENDIENTES" && f["E"] !== "PEDIDA";

describe("oráculo contra la base: anular la orden", () => {
  const filas = tablaDeOrden("Anular la orden").filas;
  it("las combinaciones inalcanzables con la base real son exactamente las declaradas (BORRADOR y ANULADA con compras vigentes)", () => {
    expect(filas.filter(inalcanzableAnular).map((f) => `${f["E"]}|${f["V"]}`).filter((v, i, a) => a.indexOf(v) === i).sort()).toEqual(["ANULADA|CON_COMPRAS_VIGENTES", "BORRADOR|CON_COMPRAS_VIGENTES"]);
  });
  it("cada combinación alcanzable estado × compras vigentes × motivo da el resultado de la tabla", async () => {
    for (const f of filas.filter((x) => !inalcanzableAnular(x))) {
      await limpiarOrdenes();
      const ordenId = await ordenEn(f["E"]!, f["V"] === "CON_COMPRAS_VIGENTES" ? "recibida" : "ninguna");
      const r = await anularOrdenDeCompraCasoDeUso(actor(), { ordenId, motivo: MOTIVO[f["T"]!]! });
      expect(r.ok ? "ANULA" : `RECHAZA_${r.codigo}`, `E=${f["E"]} V=${f["V"]} T=${f["T"]}`).toBe(f["Resultado"]);
      if (!r.ok && f["E"] !== "ANULADA") expect(await estadoDe(ordenId), "un rechazo no cambia el estado").toBe(f["E"]);
    }
  }, 120_000);
});

describe("oráculo contra la base: cerrar la orden", () => {
  const filas = tablaDeOrden("Cerrar la orden").filas;
  it("las combinaciones inalcanzables son exactamente las de compras pendientes en una orden que no está pedida", () => {
    expect(filas.filter(inalcanzableCerrar).map((f) => f["E"]).sort()).toEqual(["ANULADA", "BORRADOR", "CERRADA"]);
  });
  it("cada combinación alcanzable estado × compras pendientes da el resultado de la tabla", async () => {
    for (const f of filas.filter((x) => !inalcanzableCerrar(x))) {
      await limpiarOrdenes();
      const ordenId = await ordenEn(f["E"]!, f["W"] === "CON_COMPRAS_PENDIENTES" ? "pendiente" : "ninguna");
      const r = await cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId });
      expect(r.ok ? "CIERRA" : `RECHAZA_${r.codigo}`, `E=${f["E"]} W=${f["W"]}`).toBe(f["Resultado"]);
    }
  }, 120_000);
});

describe("oráculo contra la base: control de exceso al confirmar la recepción", () => {
  const filas = tablaDeOrden("Control de exceso contra la orden").filas;
  it("cada combinación nivel × confirmación × cantidad × renglón rechazado da el resultado de la tabla (pedido 10, ya recibido 4, este renglón 5 o 7)", async () => {
    expect(filas).toHaveLength(productoCartesiano({ N: DIMENSIONES["N"]!, X: DIMENSIONES["X"]!, Z: DIMENSIONES["Z"]!, K: DIMENSIONES["K"]! }).length);
    for (const f of filas) {
      await limpiarOrdenes();
      const ordenId = await crear();
      await pedir(ordenId);
      const previa = await cargarContra(ordenId, 4);
      expect((await confirmar(id(previa))).ok).toBe(true);
      // Se carga con el control en su valor por defecto (sin fila: PERMITIR) y el nivel de la combinación rige AL CONFIRMAR.
      const cantidad = f["Z"] === "EXCEDE_LO_PEDIDO" ? 7 : 5;
      const c = await cargarContra(ordenId, cantidad, f["X"] === "CONFIRMO_EXCESO");
      expect(c.ok, c.mensaje).toBe(true);
      if (f["N"] !== "SIN_FILA") await prismaAdmin.nivelDeControl.create({ data: { id: randomUUID(), empresaId: E, control: "compras.recepcion_excede_la_orden", nivel: f["N"]!, actualizadoPorId: admin } });
      if (f["K"] === "RENGLON_RECHAZADO") {
        const renglon = await prisma.facturaProveedorRenglon.findFirstOrThrow({ where: { facturaProveedorId: id(c) } });
        const ctl = await registrarControlDeRecepcionCasoDeUso(actor(), { facturaId: id(c), controles: [{ renglonId: renglon.id, condicion: "RECHAZADA", observacion: "Llegó vencida" }] }, azarDelProceso);
        expect(ctl.ok, ctl.mensaje).toBe(true);
      }
      const r = await confirmar(id(c));
      const resultado = r.ok ? "PASA" : r.codigo === "EXCEDE_LA_ORDEN_BLOQUEADA" ? "BLOQUEADA" : r.codigo === "EXCEDE_LA_ORDEN_SIN_CONFIRMAR" ? "SIN_CONFIRMAR" : `OTRO_${r.codigo}`;
      expect(resultado, `N=${f["N"]} X=${f["X"]} Z=${f["Z"]} K=${f["K"]}`).toBe(f["Resultado"]);
    }
  }, 240_000);
});

/** Cada combinación crea su propia orden y sus propias compras (no se pisan); lo único compartido es el nivel del control, que se borra para que cada una arranque «sin fila». */
async function limpiarOrdenes() {
  await prismaAdmin.nivelDeControl.deleteMany();
}

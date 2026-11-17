import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { mundoDeLaFila, tablaDeCuarentenaYRechazo, type FilaDeDestino } from "../setup/oraculo-compras-cuarentena-y-rechazo";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { confirmarRecepcionDeFacturaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/confirmar-recepcion-de-factura";
import { registrarControlDeRecepcionCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-control-de-recepcion";
import { confirmarRecepcionDeFactura } from "../../src/server/actions/movimientos/facturas-proveedor";
import { azarDelProceso } from "../../src/lib/azar";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario, sumarDias } from "../../src/core/tiempo/zona-horaria";
import type { ContextoDeAccion } from "../../src/server/actions/tipos";

/**
 * Compras, depósitos de uso RECHAZO y CUARENTENA, etapa (i) — el ORÁCULO DE COMBINACIONES contra la base real (regla «Combinaciones» del dueño). `docs/oraculo-combinaciones-compras-cuarentena-y-rechazo-2026-11-17.md` es la tabla de reglas esperadas, escrita aparte del
 * código; `test/core/combinaciones-compras-cuarentena-y-rechazo.test.ts` recorre TODAS sus filas contra la regla pura. Acá se recorre contra el caso de uso y la Server Action reales, con Postgres: para cada fila se arma el mundo de la sucursal (dos depósitos normales; de
 * cada uso especial 0, 1 o 2), se registra el control de la línea, se confirma eligiendo lo que dice la fila y se comprueba el resultado y, cuando confirma, a qué depósito entró el stock y qué quedó en la auditoría; cuando rechaza, que no entró NADA. Con el módulo apagado
 * la que decide es la Server Action (el guard real). Las filas NO_APLICA (pedir «otro depósito especial» sin tener ninguno) no se pueden armar y se saltean a propósito.
 */
const E = EMPRESA_POR_DEFECTO_ID;
const mediodia = (dias: number) => mediodiaDelDia(sumarDias(diaDeCalendario(new Date(), ZONA_ARGENTINA), dias), ZONA_ARGENTINA);

let s3: string, admin: string, harina: string, aceite: string, proveedorId: string;
let ids: Record<string, string>;

const actor3 = () => ({ usuarioId: admin, empresaId: E, sucursalId: s3, sucursalNombre: "Central", ahora: new Date(), membresias: [{ sucursalId: s3 }] as never, ...baseDeTest({ lectura: [s3], escritura: [s3] }) }) as unknown as ContextoDeAccion;

/** Arma el mundo de la fila y una factura pendiente de dos renglones: la harina lleva el control K de la fila; el aceite queda sin control y va a «A normal» (lo propuesto). Devuelve la factura y a qué depósito elige quien confirma para la harina. */
async function armar(f: FilaDeDestino) {
  const mundo = mundoDeLaFila(f);
  ids = {};
  for (const s of mundo.secciones) ids[s.clave] = (await prisma.seccion.create({ data: { sucursalId: s3, nombre: s.nombre, uso: s.uso } })).id;
  await fijarModulosActivos(E, [...MODULOS_VENDIBLES, "recepcion_de_compras"]);
  const r = await registrarFacturaProveedorCasoDeUso(actor3(), {
    fecha: mediodia(-3),
    proveedorId,
    nroFactura: "A-00001-00000100",
    seccionId: ids["A"]!,
    items: [
      { productoId: harina, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA },
      { productoId: aceite, cantidad: 5, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA },
    ],
    reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 100 }] },
    claveIdempotencia: randomUUID(),
  });
  expect(r.ok, r.mensaje).toBe(true);
  const facturaId = (r.ok && r.datos.facturaId) as string;
  const renglones = await prisma.facturaProveedorRenglon.findMany({ where: { facturaProveedorId: facturaId, productoId: { not: null } }, orderBy: { orden: "asc" } });
  if (f.K !== "SIN_CONTROL") {
    const c = await registrarControlDeRecepcionCasoDeUso(actor3(), { facturaId, controles: [{ renglonId: renglones[0]!.id, condicion: f.K as "CONFORME", observacion: f.K === "CONFORME" ? null : "Observación de prueba" }] }, azarDelProceso);
    expect(c.ok, c.mensaje).toBe(true);
  }
  const entradas = [{ renglonId: renglones[0]!.id, seccionId: ids[mundo.elegida!]! }, { renglonId: renglones[1]!.id, seccionId: ids["A"]! }];
  return { facturaId, entradas, elegidaId: ids[mundo.elegida!]! };
}

const nadaEscrito = async (facturaId: string) => {
  const parte = await prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { facturaProveedorId: facturaId } });
  expect([await prisma.movimientoStock.count({ where: { proceso: "COMPRA" } }), await prisma.operacion.count({ where: { proceso: "COMPRA" } }), parte.estadoRecepcion, await prisma.registroAuditoria.count({ where: { entidadId: facturaId, campo: "recepcion" } })]).toEqual([0, 0, "PENDIENTE", 0]);
};

beforeEach(async () => {
  __setCookieDeTestParaSucursal(undefined);
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  s3 = base.sucursal.id;
  admin = (await crearUsuarioConMembresia({ email: "admin3@test.com", sucursalId: s3, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  const litro = await prisma.unidad.create({ data: { nombre: "l", magnitud: "VOLUMEN", decimales: 2 } });
  const aceiteInsumo = await prisma.insumo.create({ data: { nombre: "Aceite" } });
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  aceite = (await prisma.producto.create({ data: { codigo: "MP_ACEITE", nombre: "Aceite", tipo: "MP", unidadStockId: litro.id, insumoId: aceiteInsumo.id } })).id;
  await prisma.disponibilidadProducto.createMany({ data: [harina, aceite].map((productoId) => ({ sucursalId: s3, productoId, disponible: true })) });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
});

const filas = tablaDeCuarentenaYRechazo("Destino de la línea al confirmar").filas as unknown as (FilaDeDestino & { Resultado: string })[];

describe("oráculo contra la base real: destino de la línea al confirmar (módulo encendido, rol administrador)", () => {
  const armables = filas.filter((f) => f.M === "ENCENDIDO" && f.Resultado !== "NO_APLICA");

  it("el recorte tiene las 32 combinaciones armables de control × depósitos × elección (36 menos las 4 NO_APLICA)", () => {
    expect(armables).toHaveLength(32);
    expect(filas.filter((f) => f.Resultado === "NO_APLICA")).toHaveLength(8); // 4 controles × (módulo apagado y encendido)
  });

  it.each(armables.map((f) => [`K=${f.K} U=${f.U} X=${f.X}`, f] as const))("%s", async (_clave, f) => {
    const { facturaId, entradas, elegidaId } = await armar(f);

    const r = await confirmarRecepcionDeFacturaCasoDeUso(actor3(), { facturaId, entradas });

    if (f.Resultado.startsWith("RECHAZA_")) {
      expect(r.ok, "tenía que rechazar").toBe(false);
      expect(r.ok ? "" : `RECHAZA_${r.codigo}`).toBe(f.Resultado);
      await nadaEscrito(facturaId);
    } else {
      expect(r.ok, r.mensaje).toBe(true);
      // La harina entra ENTERA al depósito elegido; el aceite, a «A normal».
      const parte = await prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { facturaProveedorId: facturaId } });
      expect(parte.estadoRecepcion).toBe("RECIBIDA");
      expect((await prisma.movimientoStock.findMany({ where: { productoId: harina, proceso: "COMPRA" } })).map((m) => [m.seccionId, Number(m.cantidad)])).toEqual([[elegidaId, 10]]);
      expect((await prisma.movimientoStock.findMany({ where: { productoId: aceite, proceso: "COMPRA" } })).map((m) => [m.seccionId, Number(m.cantidad)])).toEqual([[ids["A"], 5]]);
      const auditoria = await prisma.registroAuditoria.findMany({ where: { entidadId: facturaId, campo: "recepcion" } });
      expect(auditoria).toHaveLength(1);
      const detalle = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidadId: facturaId, campo: "destinoDeRecepcion" } });
      const destinos = JSON.parse(detalle.valorNuevo!) as { seccionElegidaId: string; cambiado: boolean }[];
      expect(destinos[0]!.seccionElegidaId, "lo elegido, por renglón").toBe(elegidaId);
      expect(destinos[0]!.cambiado).toBe(f.Resultado === "CONFIRMA_CAMBIADO");
    }
  });
});

describe("oráculo contra la base real: la puerta del módulo (Server Action, rol administrador)", () => {
  const armables = filas.filter((f) => f.M === "APAGADO" && f.Resultado !== "NO_APLICA");

  it("el recorte tiene las 32 combinaciones armables y todas dan RECHAZA_MODULO_NO_ACTIVO", () => {
    expect(armables).toHaveLength(32);
    expect(new Set(armables.map((f) => f.Resultado))).toEqual(new Set(["RECHAZA_MODULO_NO_ACTIVO"]));
  });

  it.each(armables.map((f) => [`K=${f.K} U=${f.U} X=${f.X}`, f] as const))("%s", async (_clave, f) => {
    const { facturaId, entradas } = await armar(f); // el módulo se enciende para cargar la factura pendiente y el control
    await fijarModulosActivos(E, MODULOS_VENDIBLES);
    __setCookieDeTestParaSucursal(s3);
    await mockearUsuarioActual({ id: admin, email: "admin3@test.com", nombre: null });

    const r = await confirmarRecepcionDeFactura(facturaId, entradas);

    expect(r.ok).toBe(false);
    await nadaEscrito(facturaId);
  });
});

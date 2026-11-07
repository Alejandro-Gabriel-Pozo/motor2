import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { aceptarPropuestaDeFacturaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/aceptar-propuesta-de-factura";
import { corregirFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/corregir-factura-proveedor";
import { anularFacturaProveedor } from "../../src/server/actions/movimientos/facturas-proveedor";
import { declararPagoDeFacturaProveedor } from "../../src/server/actions/movimientos/pagos-factura-proveedor";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { corregirFacturaProveedor } from "../../src/server/actions/movimientos/facturas-proveedor";
import { MENSAJE_FACTURA_DUPLICADA } from "../../src/core/movimientos/factura-unica";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario } from "../../src/core/tiempo/zona-horaria";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

/**
 * U1 de «una sola compra» — operaciones críticas de «corregir los datos de la factura» contra la aceptación, la anulación, el pago y una carga que quiere el mismo número, a la vez, con Postgres real (docs/diseno-una-sola-compra-2026-11-06.md §8.3 y §12.2).
 * Invariante I-NUM: al terminar, en TODA parte vigente `Operacion.nroFactura` y `Operacion.proveedorId` son los de su factura.
 *
 * Mutaciones (anotadas en el commit): `corregirFacturaProveedorCasoDeUso` sin copiar el cambio a la compra de cada parte → rojo «I-NUM»; sin la comparación de las partes (la sucursal que aceptó en el medio) → rojo «aceptar a la vez»; sin
 * el `excluirFacturaId` o sin `hayComprobanteVigenteEnLaEmpresa` → rojo «número que quiere otra carga»; sin el `FOR UPDATE` de la cabecera → ver la nota del primer caso.
 */
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);

let s3: string, s4: string, sec3: string, sec4: string;
let admin: string, op4: string;
let harina: string, molino: string;

// `membresias`: lo que `conAlcanceEnSucursal` exige para ensanchar el contexto a otra sucursal del usuario (el caso de uso lo hace al pedir `corregir_compra` en las sucursales de la factura).
const actorDe = (usuarioId: string, sucursalId: string, sucursalNombre: string) => ({ usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, sucursalNombre, ahora: new Date(), membresias: [{ sucursalId: s3 }, { sucursalId: s4 }] as never, ...baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }) });
const comoAdmin = async (sucursalId: string) => {
  __setCookieDeTestParaSucursal(sucursalId);
  await mockearUsuarioActual({ id: admin, email: "admin@test.com", nombre: null });
};

/** Una factura repartida 50/50 entre la 3 (entra en el acto) y la 4 (queda propuesta). */
async function repartida(nroFactura: string, extra: { condicionPago?: "CONTADO_PAGADA" | "PENDIENTE_DE_PAGO" } = {}) {
  const r = await registrarFacturaProveedorCasoDeUso(actorDe(admin, s3, "Central"), {
    fecha: mediodiaDeHoy(), proveedorId: molino, nroFactura, seccionId: sec3,
    items: [{ productoId: harina, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
    reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 50 }, { sucursalId: s4, valor: 50 }] }, claveIdempotencia: randomUUID(), ...extra,
  });
  expect(r.ok, r.mensaje).toBe(true);
  const facturaId = (r.ok && r.datos.facturaId) as string;
  const propuesta = await prisma.facturaProveedorPropuesta.findFirstOrThrow({ where: { facturaProveedorId: facturaId, destinoSucursalId: s4 } });
  return { facturaId, propuestaId: propuesta.id };
}

/** I-NUM: la compra de cada parte vigente lleva el número y el proveedor de su factura. */
async function verificarINum(facturaId: string, contexto: string) {
  const f = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId }, include: { partes: true } });
  for (const parte of f.partes) {
    const compra = await prisma.operacion.findUniqueOrThrow({ where: { id: parte.operacionId as string } });
    expect([compra.nroFactura, compra.proveedorId], `${contexto}: la compra de la parte en ${parte.sucursalId} lleva el número y el proveedor de su factura`).toEqual([f.nroFactura, f.proveedorId]);
  }
  return f;
}

beforeEach(async () => {
  __setCookieDeTestParaSucursal(undefined);
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  s3 = base.sucursal.id;
  s4 = (await prisma.sucursal.create({ data: { nombre: "Sucursal 4" } })).id;
  [sec3, sec4] = await Promise.all([s3, s4].map(async (s) => (await sembrarSeccion(s)).id));
  admin = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s3, rolId: base.admin.id })).id;
  await crearMembresia({ usuarioId: admin, sucursalId: s4, rolId: base.admin.id });
  op4 = (await crearUsuarioConMembresia({ email: "op4@test.com", sucursalId: s4, rolId: base.operador.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  await prisma.disponibilidadProducto.createMany({ data: [s3, s4].map((sucursalId) => ({ sucursalId, productoId: harina, disponible: true })) });
  molino = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
});

describe("corregir contra aceptar, a la vez (I-NUM)", () => {
  it("si la 4 acepta su parte mientras se corrige el número, al terminar NINGUNA parte queda con el número viejo", async () => {
    for (let i = 0; i < 6; i++) {
      const nuevo = `A-00050-${String(i + 1).padStart(8, "0")}`;
      const { facturaId, propuestaId } = await repartida(`A-00040-${String(i + 1).padStart(8, "0")}`);
      const f0 = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId } });
      const vista = { proveedorId: f0.proveedorId, nroFactura: f0.nroFactura, detalleLibre: f0.detalleLibre };

      const [corregida, aceptada] = await Promise.all([
        corregirFacturaProveedorCasoDeUso(actorDe(admin, s3, "Central") as never, { facturaId, nueva: { proveedorId: molino, nroFactura: nuevo, detalleLibre: "" }, esperado: vista }),
        aceptarPropuestaDeFacturaCasoDeUso(actorDe(op4, s4, "Sucursal 4"), { propuestaId, seccionId: sec4, fechaStock: mediodiaDeHoy(), claveIdempotencia: randomUUID() }),
      ]);

      expect(aceptada.ok, `iteración ${i}: la aceptación no se pierde: ${aceptada.mensaje}`).toBe(true);
      // La corrección o entró antes de la aceptación (y la parte de la 4 copió el número nuevo) o vio una parte que no esperaba y pidió repetir.
      if (!corregida.ok) {
        expect(corregida.codigo, `iteración ${i}: ${corregida.mensaje}`).toBe("CAMBIO_CONCURRENTE");
        const reintento = await corregirFacturaProveedorCasoDeUso(actorDe(admin, s3, "Central") as never, { facturaId, nueva: { proveedorId: molino, nroFactura: nuevo, detalleLibre: "" }, esperado: vista });
        expect(reintento.ok, `iteración ${i}: repetida con las dos partes: ${reintento.mensaje}`).toBe(true);
      }
      const f = await verificarINum(facturaId, `iteración ${i}`);
      expect(f.nroFactura).toBe(nuevo);
      expect(f.partes, `iteración ${i}: las dos partes están`).toHaveLength(2);
    }
  }, 120_000);
});

describe("corregir contra anular, a la vez", () => {
  it("una sola gana el último lugar del número: o se corrige y después se anula, o se anula y la corrección dice «anulada»; nunca queda a medias", async () => {
    for (let i = 0; i < 4; i++) {
      const original = `A-00060-${String(i + 1).padStart(8, "0")}`;
      const { facturaId } = await repartida(original);
      // Se acepta la parte de la 4 para que la factura tenga las dos partes antes de la carrera.
      const propuesta = await prisma.facturaProveedorPropuesta.findFirstOrThrow({ where: { facturaProveedorId: facturaId } });
      expect((await aceptarPropuestaDeFacturaCasoDeUso(actorDe(op4, s4, "Sucursal 4"), { propuestaId: propuesta.id, seccionId: sec4, fechaStock: mediodiaDeHoy(), claveIdempotencia: randomUUID() })).ok).toBe(true);
      const f0 = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId } });
      const vista = { proveedorId: f0.proveedorId, nroFactura: f0.nroFactura, detalleLibre: f0.detalleLibre };

      await comoAdmin(s3);
      const [corregida, anulada] = await Promise.allSettled([
        corregirFacturaProveedor(facturaId, { proveedorId: molino, nroFactura: `A-00070-${String(i + 1).padStart(8, "0")}`, detalleLibre: "" }, vista),
        anularFacturaProveedor(facturaId, "carrera", randomUUID()),
      ]);

      expect(corregida.status, `iteración ${i}: ${JSON.stringify(corregida)}`).toBe("fulfilled");
      expect(anulada.status, `iteración ${i}: ${JSON.stringify(anulada)}`).toBe("fulfilled");
      const f = await verificarINum(facturaId, `iteración ${i}`);
      expect(Boolean(f.anuladaEn), `iteración ${i}: la anulación gana siempre al final (es la única que no se rechaza)`).toBe(true);
      const c = corregida.status === "fulfilled" ? corregida.value : null;
      if (c && !c.ok) expect(c.mensaje, `iteración ${i}`).toMatch(/anulada|volvé a intentarlo|cambió mientras/);
    }
  }, 120_000);
});

describe("corregir el número contra una carga que quiere ese mismo número, a la vez", () => {
  it("exactamente una se queda con el número: la otra recibe el mensaje único de factura duplicada, sin nada a medias", async () => {
    await comoAdmin(s3);
    for (let i = 0; i < 4; i++) {
      const original = `A-00080-${String(i + 1).padStart(8, "0")}`;
      const querido = `A-00090-${String(i + 1).padStart(8, "0")}`;
      const { facturaId } = await repartida(original);
      const f0 = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId } });
      const vista = { proveedorId: f0.proveedorId, nroFactura: f0.nroFactura, detalleLibre: f0.detalleLibre };

      const [corregida, cargada] = await Promise.all([
        corregirFacturaProveedor(facturaId, { proveedorId: molino, nroFactura: querido, detalleLibre: "" }, vista),
        registrarMovimiento({ proceso: "COMPRA", fecha: mediodiaDeHoy(), seccionId: sec3, proveedorId: molino, nroFactura: querido, items: [{ productoId: harina, cantidad: 1, precioTotal: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: randomUUID() }),
      ]);

      expect([corregida.ok, cargada.ok].filter(Boolean), `iteración ${i}: exactamente una: ${corregida.mensaje} / ${cargada.mensaje}`).toHaveLength(1);
      expect((corregida.ok ? cargada : corregida).mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);
      expect(await prisma.facturaProveedor.count({ where: { proveedorId: molino, nroFacturaNormalizado: { in: ["A:90-" + (i + 1)] }, anuladaEn: null } }), `iteración ${i}: una sola factura con el número querido`).toBe(1);
      expect(await prisma.operacion.count({ where: { proveedorId: molino, nroFactura: querido, proceso: "COMPRA", anuladaEn: null, sucursalId: s3 } }), `iteración ${i}: una sola compra con el número querido en la sucursal`).toBe(1);
    }
  }, 120_000);
});

describe("anular contra declarar el pago, a la vez", () => {
  it("se turnan por el candado de la cabecera: nunca queda un pago vigente sobre una factura que se anuló sin que se vea", async () => {
    await comoAdmin(s3);
    for (let i = 0; i < 4; i++) {
      const { facturaId } = await repartida(`A-00100-${String(i + 1).padStart(8, "0")}`, { condicionPago: "PENDIENTE_DE_PAGO" });
      const dia = diaDeCalendario(new Date(), ZONA_ARGENTINA);

      const [anulada, pagada] = await Promise.all([
        anularFacturaProveedor(facturaId, "carrera con el pago", randomUUID()),
        declararPagoDeFacturaProveedor(facturaId, dia, "TRANSFERENCIA", randomUUID()),
      ]);

      // Anular no se puede rechazar por un pago (P5): siempre gana. Declarar el pago antes de anular es válido; después, se rechaza «factura anulada».
      expect(anulada.ok, `iteración ${i}: ${anulada.mensaje}`).toBe(true);
      if (!pagada.ok) expect(pagada.mensaje, `iteración ${i}`).toMatch(/anulada/);
      const f = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId } });
      expect(Boolean(f.anuladaEn)).toBe(true);
      expect(await prisma.pagoDeFacturaProveedor.count({ where: { facturaProveedorId: facturaId, anuladoEn: null } }), `iteración ${i}: a lo sumo un pago vigente`).toBeLessThanOrEqual(1);
    }
  }, 120_000);
});

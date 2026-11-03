import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { nroFacturaDePrueba } from "../setup/comprobante-de-prueba";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario } from "../../src/core/tiempo/zona-horaria";
import type { DatosMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";
import type { DatosFacturaProveedorInput } from "../../src/core/features/compras/factura-proveedor.schema";

/**
 * Etapa 1 de Compras, paso 4 (docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md, CU7, I12): «cómo lo llama el proveedor» es OBLIGATORIO en la PRIMERA compra de un producto a un proveedor (no existe ninguna
 * fila de `ProveedorPorProducto` para el par, con cualquier unidad de compra) y se guarda en el vínculo; si ya hay una fila, aunque tenga la referencia vacía, no se exige. Lo exige el servidor (compra simple y
 * factura repartida), después de la idempotencia y antes de escribir. Postgres real.
 * Mutaciones (revertidas editando): sacar el chequeo de uno de los dos casos de uso (a/h fallan); mirar el vínculo por unidad de compra en vez de por par (d falla); chequear antes de la idempotencia (f falla).
 */
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);
const MENSAJE = (nombre: string) => `Escribí cómo lo llama el proveedor a "${nombre}" (código y descripción, como dice la factura): es la primera compra de ese producto a este proveedor.`;

let sucursalId: string, seccionId: string, adminId: string;
let harinaId: string, azucarId: string, proveedorId: string, otroProveedorId: string, kgId: string;

const actor = () => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }) });
const item = (productoId: string, referenciaProveedor?: string) => ({ productoId, cantidad: 10, precioTotal: 1000, ...(referenciaProveedor === undefined ? {} : { referenciaProveedor }) });

const compra = (items: DatosMovimientoInput["items"], extra: Partial<DatosMovimientoInput> = {}): DatosMovimientoInput =>
  ({ proceso: "COMPRA", fecha: mediodiaDeHoy(), seccionId, proveedorId, nroFactura: nroFacturaDePrueba(), items, claveIdempotencia: randomUUID(), ...extra }) as DatosMovimientoInput;
const cargar = (items: DatosMovimientoInput["items"], extra: Partial<DatosMovimientoInput> = {}) => registrarMovimientoCasoDeUso(actor(), compra(items, extra));

const factura = (items: DatosFacturaProveedorInput["items"]): DatosFacturaProveedorInput => ({
  fecha: mediodiaDeHoy(),
  proveedorId,
  nroFactura: nroFacturaDePrueba(),
  seccionId,
  items,
  reparto: { modo: "PORCENTAJE", partes: [{ sucursalId, valor: 100 }] },
  claveIdempotencia: randomUUID(),
});

const conteos = async () => ({
  operaciones: await prisma.operacion.count(),
  movimientos: await prisma.movimientoStock.count(),
  vinculos: await prisma.proveedorPorProducto.count(),
  auditoria: await prisma.registroAuditoria.count(),
  facturas: await prisma.facturaProveedor.count(),
});
const referenciaDe = async (productoId: string, pId = proveedorId) => (await prisma.proveedorPorProducto.findFirst({ where: { productoId, proveedorId: pId }, select: { referenciaProveedor: true } }))?.referenciaProveedor;

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  sucursalId = base.sucursal.id;
  seccionId = (await sembrarSeccion(sucursalId)).id;
  adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  kgId = kg.id;
  harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  azucarId = (await prisma.producto.create({ data: { codigo: "MP_AZUCAR", nombre: "Azúcar", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  await prisma.disponibilidadProducto.createMany({ data: [harinaId, azucarId].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  otroProveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Distribuidora Sur" } })).id;
});

describe("compra simple: la primera compra del producto al proveedor exige la referencia", () => {
  it("(a) sin referencia: rechazo con el mensaje y NADA escrito", async () => {
    const antes = await conteos();
    for (const vacia of [undefined, "", "   "]) {
      const r = await cargar([item(harinaId, vacia)]);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.codigo).toBe("REFERENCIA_PROVEEDOR_OBLIGATORIA");
      expect(r.mensaje).toBe(MENSAJE("Harina"));
    }
    expect(await conteos()).toEqual(antes);
  });

  it("(b) con referencia: entra y queda guardada en el vínculo", async () => {
    const r = await cargar([item(harinaId, "  HAR-000 Harina 000 x 25 kg ")]);
    expect(r.ok).toBe(true);
    expect(await referenciaDe(harinaId)).toBe("HAR-000 Harina 000 x 25 kg");
  });

  it("(c) segunda compra del mismo par sin referencia: entra y NO pisa la anterior", async () => {
    expect((await cargar([item(harinaId, "HAR-000")])).ok).toBe(true);
    const r = await cargar([item(harinaId)]);
    expect(r.ok).toBe(true);
    expect(await referenciaDe(harinaId)).toBe("HAR-000");
  });

  it("(d) un par con fila vieja de referencia vacía: entra sin referencia", async () => {
    await prisma.proveedorPorProducto.create({ data: { productoId: harinaId, proveedorId, unidadCompraId: kgId, referenciaProveedor: null } });
    const r = await cargar([item(harinaId)]);
    expect(r.ok).toBe(true);
    expect(await referenciaDe(harinaId)).toBeNull();
  });

  it("(e) el mismo producto con OTRO proveedor sin vínculo: se exige", async () => {
    expect((await cargar([item(harinaId, "HAR-000")])).ok).toBe(true);
    const antes = await conteos();
    const r = await cargar([item(harinaId)], { proveedorId: otroProveedorId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("REFERENCIA_PROVEEDOR_OBLIGATORIA");
    expect(await conteos()).toEqual(antes);
    expect((await cargar([item(harinaId, "OTRO-1")], { proveedorId: otroProveedorId })).ok).toBe(true);
    expect(await referenciaDe(harinaId, otroProveedorId)).toBe("OTRO-1");
    expect(await referenciaDe(harinaId)).toBe("HAR-000");
  });

  it("(f) idempotencia: la misma compra reenviada devuelve «repetida», con una sola operación y un solo vínculo", async () => {
    const pedido = compra([item(harinaId, "HAR-000")]);
    const primera = await registrarMovimientoCasoDeUso(actor(), pedido);
    expect(primera.ok).toBe(true);
    const reenvio = await registrarMovimientoCasoDeUso(actor(), pedido);
    expect(reenvio.ok).toBe(true);
    if (reenvio.ok) expect(reenvio.datos.repetida).toBe(true);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(1);
    expect(await prisma.proveedorPorProducto.count()).toBe(1);
  });

  it("(g) dos líneas del mismo producto nuevo, una con referencia: entra; y una segunda línea de otro producto nuevo sin referencia se rechaza", async () => {
    const r = await cargar([item(harinaId), item(harinaId, "HAR-000")]);
    expect(r.ok).toBe(true);
    expect(await referenciaDe(harinaId)).toBe("HAR-000");

    const antes = await conteos();
    const parcial = await cargar([item(harinaId), item(azucarId)]);
    expect(parcial.ok).toBe(false);
    if (!parcial.ok) {
      expect(parcial.codigo).toBe("REFERENCIA_PROVEEDOR_OBLIGATORIA");
      expect(parcial.mensaje).toBe(MENSAJE("Azúcar"));
    }
    expect(await conteos()).toEqual(antes);
  });
});

describe("factura repartida: la misma regla", () => {
  it("(h) sin referencia en la primera compra: rechazo sin escribir nada; con referencia: se guarda", async () => {
    const antes = await conteos();
    const r = await registrarFacturaProveedorCasoDeUso(actor(), factura([item(harinaId)]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe("REFERENCIA_PROVEEDOR_OBLIGATORIA");
      expect(r.mensaje).toBe(MENSAJE("Harina"));
    }
    expect(await conteos()).toEqual(antes);

    const ok = await registrarFacturaProveedorCasoDeUso(actor(), factura([item(harinaId, "HAR-000 Harina")]));
    expect(ok.ok).toBe(true);
    expect(await referenciaDe(harinaId)).toBe("HAR-000 Harina");

    // El par ya existe: la siguiente factura no la exige.
    const segunda = await registrarFacturaProveedorCasoDeUso(actor(), factura([item(harinaId)]));
    expect(segunda.ok).toBe(true);
    expect(await referenciaDe(harinaId)).toBe("HAR-000 Harina");
  });
});

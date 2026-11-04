import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { datosDeFactura } from "../setup/factura-proveedor";
import { leerOraculoDeComprobante, type OraculoDeComprobante } from "../setup/oraculo-comprobante-unico";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { corregirCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/corregir-compra";
import { MENSAJE_FACTURA_DUPLICADA } from "../../src/core/movimientos/factura-unica";
import { normalizarNumeroDeComprobante } from "../../src/core/compras/public";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario } from "../../src/core/tiempo/zona-horaria";
import type { DatosMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";

/**
 * Compras, etapa 1: las 32 combinaciones N (número) × L (letra del existente) × P (permiso de ver la otra sucursal) × O (operación) del número de factura único en la empresa, contra Postgres real.
 * El ORÁCULO está escrito aparte, en `docs/oraculo-combinaciones-compras-etapa-1-2026-11-03.md`: este test PARSEA su tabla «Enumeración» (el resultado esperado de cada fila sale del .md, no del código) y arma el
 * escenario de cada fila. El guardián de dimensiones nuevas es `test/arquitectura/combinaciones-comprobante-unico-declaradas.test.ts`. Ya probadas aparte (solo citadas): concurrencia, reintento con la misma clave
 * y aceptar una parte de factura repartida, en `comprobante-unico-en-la-empresa.test.ts`.
 *
 * Escenario por fila (números únicos por fila: `n = 410000 + índice`, así las filas no se interfieren aunque compartan base):
 *  - N: NUEVO (no se siembra nada); REPETIDO_MISMA_SUCURSAL (Operación COMPRA vigente en la sucursal de quien carga, Central); REPETIDO_OTRA_SUCURSAL (en Norte); REPETIDO_FACTURA_REPARTIDA (cabecera FacturaProveedor vigente).
 *  - L: el existente se SIEMBRA DIRECTO en la base como dato ya guardado: CON_LETRA «A-00001-0000nnnn» o SIN_LETRA «0001-0000nnnn» (texto viejo, I15). La carga nueva se escribe siempre «A-1-nnnn».
 *  - P: quien carga ve (administrador) o no ve (rol sin ningún permiso) las compras de Norte. Solo con N = REPETIDO_OTRA_SUCURSAL hay un «otro lugar» real donde está el comprobante; en las demás filas P se aplica
 *    igual sobre Norte, una sucursal ajena irrelevante para ese escenario (el oráculo dice que P no cambia nada: este test lo comprueba también donde no tiene objeto, sin que sea un caso aparte).
 *  - O: COMPRA_NUEVA (`registrarMovimientoCasoDeUso`) o CORRECCION (`corregirCompraCasoDeUso` de OTRA compra vigente del mismo proveedor en Central, poniéndole ese número).
 */
const oraculo: OraculoDeComprobante = leerOraculoDeComprobante();
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);

let central: string, norte: string;
let seccionCentral: string;
let usuarioVe: string, usuarioNoVe: string, adminId: string;
let harinaId: string, proveedorId: string, otroProveedorId: string;

const nombres: Record<string, string> = {};
const actorDe = (usuarioId: string, sucursalId: string) => ({ usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, sucursalNombre: nombres[sucursalId]!, ahora: new Date(), ...baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }) });

const compra = (nroFactura: string, extra: Partial<DatosMovimientoInput> = {}): DatosMovimientoInput =>
  ({
    proceso: "COMPRA",
    fecha: mediodiaDeHoy(),
    seccionId: seccionCentral,
    proveedorId,
    nroFactura,
    items: [{ productoId: harinaId, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
    claveIdempotencia: randomUUID(),
    ...extra,
  }) as DatosMovimientoInput;

/** Una compra simple ya guardada, sembrada directo (dato viejo o canónico, tal cual). */
const sembrarCompra = (sucursalId: string, nroFactura: string, extra: { proveedor?: string; anulada?: boolean } = {}) =>
  prisma.operacion.create({
    data: {
      sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: adminId, proveedorId: extra.proveedor ?? proveedorId, nroFactura,
      ...(extra.anulada ? { anuladaEn: new Date(), anuladaPorId: adminId } : {}),
    },
  });

/** La cabecera de una factura repartida ya guardada: texto tal cual, su clave normalizada y la letra si la tiene. */
const sembrarFactura = (nroFactura: string, extra: { anulada?: boolean } = {}) =>
  prisma.facturaProveedor.create({
    data: {
      ...datosDeFactura({ usuarioId: adminId, proveedorId }, { nroFactura, nroFacturaNormalizado: normalizarNumeroDeComprobante(nroFactura), letra: /^[A-Z]/i.test(nroFactura) ? nroFactura[0]!.toUpperCase() : null }),
      ...(extra.anulada ? { anuladaEn: new Date(), anuladaPorId: adminId } : {}),
    },
  });

const conteos = async () => ({
  operacion: await prisma.operacion.count(),
  movimientoStock: await prisma.movimientoStock.count(),
  proveedorPorProducto: await prisma.proveedorPorProducto.count(),
  registroAuditoria: await prisma.registroAuditoria.count(),
  facturaProveedor: await prisma.facturaProveedor.count(),
});

const numeroEscrito = (n: number) => `A-1-${n}`;
const n8 = (n: number) => String(n).padStart(8, "0");

beforeAll(() => {
  // Si el .md no trae 32 filas el test no puede decir nada: el guardián explica por qué; acá se corta antes de armar escenarios.
  expect(oraculo.filas.length, "agregar un valor a una dimensión (N, L, P, O) cambia el tamaño del producto: actualizá este número a propósito (4 * 2 * 2 * 2 = 32)").toBe(32);
});

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  central = base.sucursal.id;
  norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
  Object.assign(nombres, { [central]: "Central", [norte]: "Norte" });
  seccionCentral = (await sembrarSeccion(central)).id;
  await sembrarSeccion(norte);
  // Quien carga siempre tiene Central. En Norte: P=SI es administrador (ve las compras); P=NO tiene un rol sin ningún permiso (la membresía sola no alcanza).
  usuarioVe = (await crearUsuarioConMembresia({ email: "ve@test.com", sucursalId: central, rolId: base.admin.id })).id;
  await crearMembresia({ usuarioId: usuarioVe, sucursalId: norte, rolId: base.admin.id });
  const rolSinPermisos = await prisma.rol.create({ data: { nombre: "Sin permisos" } });
  usuarioNoVe = (await crearUsuarioConMembresia({ email: "no-ve@test.com", sucursalId: central, rolId: base.admin.id })).id;
  await crearMembresia({ usuarioId: usuarioNoVe, sucursalId: norte, rolId: rolSinPermisos.id });
  adminId = usuarioVe;
  const { kg, insumo } = await sembrarCatalogoBase();
  harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  await prisma.disponibilidadProducto.createMany({ data: [central, norte].map((sucursalId) => ({ sucursalId, productoId: harinaId, disponible: true })) });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  otroProveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Distribuidora Sur" } })).id;
});

type Resultado = { ok: boolean; codigo?: string; mensaje?: string };

/** Corrige `operacionId` (una compra vigente de Central con otro número) poniéndole `nuevo`. */
async function corregir(usuarioId: string, operacionId: string, nuevo: string): Promise<Resultado> {
  const actual = await prisma.operacion.findUniqueOrThrow({ where: { id: operacionId } });
  const vista = { proveedorId, nroFactura: actual.nroFactura ?? "", detalleLibre: actual.detalleLibre ?? "" };
  return corregirCompraCasoDeUso(actorDe(usuarioId, central), { operacionId, nueva: { ...vista, nroFactura: nuevo }, esperado: vista }) as Promise<Resultado>;
}

describe("las 32 combinaciones del oráculo (N × L × P × O) contra la base real", () => {
  oraculo.filas.forEach((fila, indice) => {
    const { N, L, P, O, Resultado } = fila as Record<string, string>;
    it(`${indice + 1}. N=${N} L=${L} P=${P} O=${O} → ${Resultado}`, async () => {
      const n = 410_000 + indice;
      const existente = L === "CON_LETRA" ? `A-00001-${n8(n)}` : L === "SIN_LETRA" ? `0001-${n8(n)}` : null;
      if (existente === null) throw new Error(`Valor de L desconocido: ${L}`);
      switch (N) {
        case "NUEVO": break;
        case "REPETIDO_MISMA_SUCURSAL": await sembrarCompra(central, existente); break;
        case "REPETIDO_OTRA_SUCURSAL": await sembrarCompra(norte, existente); break;
        case "REPETIDO_FACTURA_REPARTIDA": await sembrarFactura(existente); break;
        default: throw new Error(`Valor de N desconocido: ${N}`);
      }
      const quien = P === "SI" ? usuarioVe : P === "NO" ? usuarioNoVe : null;
      if (quien === null) throw new Error(`Valor de P desconocido: ${P}`);

      // O=CORRECCION: otra compra vigente del mismo proveedor en Central, con otro número.
      const aCorregir = O === "CORRECCION" ? await sembrarCompra(central, `A-00002-${n8(n)}`) : null;
      if (O !== "CORRECCION" && O !== "COMPRA_NUEVA") throw new Error(`Valor de O desconocido: ${O}`);
      const antes = await conteos();
      const compraAntes = aCorregir ? await prisma.operacion.findUniqueOrThrow({ where: { id: aCorregir.id } }) : null;

      const r: Resultado = aCorregir ? await corregir(quien, aCorregir.id, numeroEscrito(n)) : await registrarMovimientoCasoDeUso(actorDe(quien, central), compra(numeroEscrito(n)));
      const despues = await conteos();

      if (Resultado === "ACEPTA") {
        expect(r.ok, r.mensaje).toBe(true);
        if (aCorregir) {
          const corregida = await prisma.operacion.findUniqueOrThrow({ where: { id: aCorregir.id } });
          expect(normalizarNumeroDeComprobante(corregida.nroFactura ?? "")).toBe(normalizarNumeroDeComprobante(numeroEscrito(n)));
          expect(despues.operacion).toBe(antes.operacion);
          expect(despues.registroAuditoria).toBeGreaterThan(antes.registroAuditoria);
        } else {
          expect(despues.operacion).toBe(antes.operacion + 1);
          expect(await prisma.operacion.count({ where: { sucursalId: central, proceso: "COMPRA", anuladaEn: null, nroFactura: `A-00001-${n8(n)}`, proveedorId } })).toBeGreaterThan(0);
        }
      } else if (Resultado === "RECHAZA") {
        expect(r).toMatchObject({ ok: false, codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA });
        // P2: ni la sucursal ni una fecha, vea o no vea quien carga la otra sucursal.
        expect(r.mensaje).not.toMatch(/Central|Norte/);
        expect(r.mensaje).not.toMatch(/\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/);
        expect(despues, "no se escribe NADA").toEqual(antes);
        if (aCorregir) expect(await prisma.operacion.findUniqueOrThrow({ where: { id: aCorregir.id } }), "la compra corregida queda intacta").toEqual(compraAntes);
      } else {
        throw new Error(`Resultado desconocido en el oráculo: ${Resultado}`);
      }
    }, 30_000);
  });
});

describe("dimensiones que NO cambian el resultado (cada una equivale a lo que dice el oráculo)", () => {
  const rechazo = { ok: false, codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA };
  const cargar = (nroFactura: string, extra: Partial<DatosMovimientoInput> = {}) => registrarMovimientoCasoDeUso(actorDe(usuarioVe, central), compra(nroFactura, extra));

  it("cómo está escrito el número (ceros, espacios, guiones): todas las escrituras son el mismo comprobante", async () => {
    await sembrarCompra(norte, "A-00023-00237728");
    for (const escrito of ["A-23-237728", "A-0023-237728", "A 23 237728", "A-00023-00237728"]) {
      expect(await cargar(escrito), escrito).toMatchObject(rechazo);
    }
  });

  it("mayúsculas de la letra: «a-23-237728» es «A-23-237728»", async () => {
    await sembrarCompra(norte, "A-00023-00237728");
    expect(await cargar("a-23-237728")).toMatchObject(rechazo);
  });

  it("otro proveedor con el mismo número: acepta, como si fuera NUEVO", async () => {
    await sembrarCompra(norte, "A-00023-00237728", { proveedor: otroProveedorId });
    await sembrarFactura("A-00023-00237729");
    expect((await cargar("A-23-237728")).ok, "la compra del otro proveedor").toBe(true);
    const otraFacturaDeOtroProveedor = await prisma.facturaProveedor.create({ data: datosDeFactura({ usuarioId: adminId, proveedorId: otroProveedorId }, { nroFactura: "A-00023-00237730", nroFacturaNormalizado: normalizarNumeroDeComprobante("A-00023-00237730"), letra: "A" }) });
    expect(otraFacturaDeOtroProveedor.id).toBeTruthy();
    expect((await cargar("A-23-237730")).ok, "la factura repartida del otro proveedor").toBe(true);
  });

  it("comprobante existente ANULADO (compra y cabecera): no es vigente, acepta como si fuera NUEVO", async () => {
    await sembrarCompra(norte, "A-00023-00237728", { anulada: true });
    await sembrarFactura("A-00023-00237729", { anulada: true });
    expect((await cargar("A-23-237728")).ok, "compra anulada").toBe(true);
    expect((await cargar("A-23-237729")).ok, "cabecera anulada").toBe(true);
  });

  it("otra empresa con el mismo número: no se ve (RLS), acepta como si fuera NUEVO", async () => {
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const sucursalAjena = await testigo.sucursal.create({ data: { nombre: "Ajena" } });
    const proveedorAjeno = await testigo.proveedor.create({ data: { codigo: "PRV_AJENO", nombre: "Molino SA (otra empresa)" } });
    await testigo.operacion.create({ data: { sucursalId: sucursalAjena.id, proceso: "COMPRA", fecha: new Date(), usuarioId: adminId, proveedorId: proveedorAjeno.id, nroFactura: "A-00023-00237728" } });
    await testigo.facturaProveedor.create({ data: datosDeFactura({ usuarioId: adminId, proveedorId: proveedorAjeno.id }, { nroFactura: "A-00023-00237729", nroFacturaNormalizado: normalizarNumeroDeComprobante("A-00023-00237729"), letra: "A" }) });
    expect((await cargar("A-23-237728")).ok, "compra de otra empresa").toBe(true);
    expect((await cargar("A-23-237729")).ok, "cabecera de otra empresa").toBe(true);
  });

  it("corregir una compra dejándole su mismo número acepta (la corrección excluye a la propia compra)", async () => {
    const propia = await sembrarCompra(central, "A-00023-00237728");
    const r = await corregir(usuarioVe, propia.id, "A-23-237728");
    expect(r.ok, r.mensaje).toBe(true);
  });

  it("citadas, probadas aparte en comprobante-unico-en-la-empresa.test.ts: concurrencia, reintento con la misma clave de idempotencia y aceptar una parte de factura repartida", () => {
    // Sin código a propósito: el oráculo las declara «probadas aparte»; si ese archivo cambia de nombre, el .md y esta cita se corrigen juntos.
    expect(oraculo.noAfectan.join("\n")).toMatch(/Concurrencia/);
    expect(oraculo.noAfectan.join("\n")).toMatch(/Reintento/);
    expect(oraculo.noAfectan.join("\n")).toMatch(/parte de factura repartida/);
  });
});

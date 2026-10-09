import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { construirReversion } from "../../src/core/compras/anulacion";
import { construirReversionDeVenta } from "../../src/core/movimientos/anulaciones";
import { cargarCompraParaAnular } from "../../src/server/persistencia/compras/cargar-compra-para-anular";
import { escribirAnulacionDeCompra } from "../../src/server/persistencia/compras/escribir-anulacion-de-compra";
import { escribirAnulacionDeVenta } from "../../src/server/persistencia/movimientos/escribir-anulacion-de-venta";
import { registrarResultadoIdempotente } from "../../src/server/persistencia/movimientos/idempotencia";
import { escribirAprobacionDeTraspaso } from "../../src/server/persistencia/traspasos/escribir-aprobacion-de-traspaso";
import { escribirEnvioDirectoDeTraspaso } from "../../src/server/persistencia/traspasos/escribir-creacion-de-traspaso";
import { escribirAceptacionDeTraspaso, escribirReingresoDeTraspaso } from "../../src/server/persistencia/traspasos/escribir-entrada-de-traspaso";

/**
 * HUELLA de los escritores del Kardex (Hito 5, pieza 5.4, A2 de `docs/plan-hito-5-pureza.md`; O.13 de `docs/pureza-integracion.md`).
 *
 * El Kardex tiene varios escritores de `Operacion` + `MovimientoStock` que hacen casi lo mismo con pequeñas diferencias que importan: la salida y la
 * entrada de un traspaso (`escribir-aprobacion-de-traspaso.ts`, `escribir-entrada-de-traspaso.ts`, `escribir-creacion-de-traspaso.ts`) y las dos
 * anulaciones (`escribir-anulacion-de-compra.ts`, `escribir-anulacion-de-venta.ts`). Reunirlos en una función por familia (A4 y A5) es una mudanza
 * pura, y esta huella es la red que lo prueba: cada escritura que llega a la base se anota TAL CUAL la recibió Prisma, con el modelo, la operación y los
 * `args` normalizados, y después se vuelca el estado en que quedaron `Operacion`, `MovimientoStock` y `TraspasoSucursal`.
 *
 * Lo que vigila, y por qué un test de comportamiento solo no alcanza:
 *  - la PRESENCIA o ausencia de cada clave (`claveIdempotencia: null` mandado a propósito vs. no mandado: en la base da lo mismo, en el código no, y la
 *    anulación de venta NUNCA manda las claves de I3 mientras que la de compra las manda siempre, con `null` si no hay);
 *  - la SECUENCIA de escrituras de cada caso (la `Operacion` antes que sus líneas, el `update` que marca la original DESPUÉS del `createMany`);
 *  - la forma de la escritura (`create` de UNA línea en los traspasos, `createMany` en las anulaciones), los signos y los tipos (número o `Decimal`).
 *
 * Normalización: las claves de cada objeto salen ordenadas; los ids de la base se reemplazan por nombres simbólicos (los de las fixtures, por el nombre
 * que les da el caso; los que genera una escritura, por `<op#n>` con `n` = el orden de esa escritura en el caso); las fechas, por su ISO; los `Decimal`,
 * por su texto; un valor `undefined` explícito se anota como `<undefined>` (distinto de una clave ausente); `creadoEn` y `empresaId` no se vuelcan (el
 * primero es `now()`, el segundo es siempre la empresa de prueba).
 *
 * Se escribió ANTES de A4 y A5 contra el código viejo y NO se edita en esos pasos. Regenerarlo a propósito (una decisión de producto, nunca una
 * mudanza): `REGENERAR_HUELLA_KARDEX=1 npx vitest run test/persistencia/kardex-escritores-huella.test.ts`; la regeneración se declara además en
 * `test/arquitectura/caracterizaciones-congeladas.test.ts`. Archivo propio y no snapshots de Vitest, para que `-u` no lo regenere en silencio.
 * Los casos corren DOS veces en el mismo test: si el resultado dependiera del azar de los ids o del reloj, las dos corridas diferirían.
 */
const ARCHIVO = join(__dirname, "__golden__", "kardex-escritores.golden.json");
const REGENERAR = process.env.REGENERAR_HUELLA_KARDEX === "1";
const AHORA = new Date("2026-10-01T15:00:00.000Z");
const LOTE = new Date("2027-01-31T00:00:00.000Z");
const CLAVE_I3 = "5b0a4a31-0000-4000-8000-000000000001";

const ESCRITURAS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"]);

afterAll(async () => {
  await limpiarBaseDeTest();
});

/** Anota las escrituras de un caso y traduce los ids de la base a nombres simbólicos. */
class Grabadora {
  private readonly nombres = new Map<string, string>();
  private contador = 0;
  readonly escrituras: unknown[] = [];

  /** Le da un nombre a un id de fixture. */
  nombrar(id: string, nombre: string): void {
    this.nombres.set(id, nombre);
  }

  normalizar(valor: unknown): unknown {
    if (valor === undefined) return "<undefined>";
    if (valor === null || typeof valor === "number" || typeof valor === "boolean") return valor;
    if (typeof valor === "string") return this.nombres.get(valor) ?? valor;
    if (valor instanceof Date) return { $fecha: valor.toISOString() };
    if (valor instanceof Prisma.Decimal) return { $decimal: valor.toString() };
    if (Array.isArray(valor)) return valor.map((v) => this.normalizar(v));
    const objeto = valor as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(objeto)
        .sort()
        .map((k) => [k, this.normalizar(objeto[k])])
    );
  }

  /** Un cliente que anota cada escritura (antes de ejecutarla) y le pone `<op#n>` al id de lo que crea. */
  cliente() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- el hook de Prisma corre con otro `this`.
    const grabadora = this;
    return prisma.$extends({
      query: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !ESCRITURAS.has(operation)) return query(args);
          const n = ++grabadora.contador;
          grabadora.escrituras.push({ n, modelo: model, operacion: operation, args: grabadora.normalizar(args) });
          const resultado = await query(args);
          const id = (resultado as { id?: unknown } | null)?.id;
          if (typeof id === "string" && !grabadora.nombres.has(id)) grabadora.nombres.set(id, `<op#${n}>`);
          return resultado;
        },
      },
    });
  }

  /** El estado en que quedaron las tres tablas del Kardex y del traspaso (sin `creadoEn` ni `empresaId`; ordenadas por su contenido, no por id). */
  async volcar(): Promise<Record<string, unknown[]>> {
    const fila = (r: Record<string, unknown>, sinId: boolean): unknown => {
      const { creadoEn: _creadoEn, empresaId: _empresaId, ...resto } = r;
      void _creadoEn;
      void _empresaId;
      const normalizada = this.normalizar(resto) as Record<string, unknown>;
      if (sinId && typeof resto.id === "string" && !this.nombres.has(resto.id)) delete normalizada.id;
      return normalizada;
    };
    const ordenadas = (filas: unknown[]) => filas.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0));
    return {
      operaciones: ordenadas((await prisma.operacion.findMany()).map((r) => fila(r, false))),
      movimientos: ordenadas((await prisma.movimientoStock.findMany()).map((r) => fila(r, true))),
      traspasos: ordenadas((await prisma.traspasoSucursal.findMany()).map((r) => fila(r, false))),
    };
  }
}

interface Mundo {
  origenId: string;
  destinoId: string;
  seccionOrigenId: string;
  seccionDestinoId: string;
  usuarioId: string;
  harinaId: string;
  panId: string;
}

async function sembrarMundo(g: Grabadora): Promise<Mundo> {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  const catalogo = await sembrarCatalogoBase();
  const destino = await prisma.sucursal.create({ data: { nombre: "Destino" } });
  const seccionOrigen = await sembrarSeccion(base.sucursal.id);
  const seccionDestino = await sembrarSeccion(destino.id, "Cocina");
  const usuario = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  const harina = await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id } });
  const pan = await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 } });
  g.nombrar(base.sucursal.id, "sucursal-origen");
  g.nombrar(destino.id, "sucursal-destino");
  g.nombrar(seccionOrigen.id, "seccion-origen");
  g.nombrar(seccionDestino.id, "seccion-destino");
  g.nombrar(usuario.id, "usuario");
  g.nombrar(harina.id, "producto-harina");
  g.nombrar(pan.id, "producto-pan");
  return { origenId: base.sucursal.id, destinoId: destino.id, seccionOrigenId: seccionOrigen.id, seccionDestinoId: seccionDestino.id, usuarioId: usuario.id, harinaId: harina.id, panId: pan.id };
}

type Cliente = ReturnType<Grabadora["cliente"]>;
type Tx = Prisma.TransactionClient;
const comoTx = (tx: unknown): Tx => tx as Tx;

async function traspasoSembrado(g: Grabadora, m: Mundo, datos: Partial<Prisma.TraspasoSucursalUncheckedCreateInput>) {
  const t = await prisma.traspasoSucursal.create({
    data: {
      origenSucursalId: m.origenId,
      destinoSucursalId: m.destinoId,
      productoId: m.harinaId,
      cantidad: 3,
      iniciadoPor: "DESTINO",
      estado: "SOLICITADA",
      creadoPorId: m.usuarioId,
      detalle: "pedido de prueba",
      ...datos,
    },
  });
  g.nombrar(t.id, "traspaso");
  return t;
}

/** Una compra de dos líneas (una con lote), igual a la de `test/persistencia/compras.test.ts`. */
async function compraSembrada(g: Grabadora, m: Mundo) {
  const op = await prisma.operacion.create({
    data: { sucursalId: m.origenId, proceso: "COMPRA", fecha: new Date("2026-08-10T12:00:00Z"), usuarioId: m.usuarioId, nroFactura: "A-0001", detalleLibre: "semanal" },
  });
  g.nombrar(op.id, "compra-original");
  await prisma.movimientoStock.createMany({
    data: [
      { operacionId: op.id, productoId: m.harinaId, seccionId: m.seccionOrigenId, proceso: "COMPRA", cantidad: 2.5, loteVencimiento: LOTE, detalle: "Compra con lote", precioTotal: 250.1, precioPorUnidadStock: 100.04 },
      { operacionId: op.id, productoId: m.harinaId, seccionId: m.seccionOrigenId, proceso: "COMPRA", cantidad: 4, detalle: "Compra sin lote", precioTotal: 400, precioPorUnidadStock: 100 },
    ],
  });
  return op;
}

async function anularCompra(g: Grabadora, m: Mundo, cliente: Cliente, conClave: boolean): Promise<void> {
  const op = await compraSembrada(g, m);
  await cliente.$transaction(async (tx) => {
    const c = (await cargarCompraParaAnular(comoTx(tx), { operacionId: op.id, sucursalId: m.origenId }))!;
    const r = await escribirAnulacionDeCompra(comoTx(tx), {
      compraId: op.id,
      sucursalId: m.origenId,
      usuarioId: m.usuarioId,
      ahora: AHORA,
      detalleLibre: "Anulación de la compra A-0001",
      claveIdempotencia: conClave ? CLAVE_I3 : null,
      payloadHash: conClave ? "hash-de-la-anulacion-de-compra" : null,
      reversion: construirReversion(c.lineas),
    });
    if (conClave) await registrarResultadoIdempotente(comoTx(tx), r.reversionId, "Compra anulada.");
  });
}

/** Cada caso arma lo que necesita y corre UNA transacción con los escritores bajo prueba. */
const CASOS: Array<{ nombre: string; correr: (g: Grabadora, m: Mundo, cliente: Cliente) => Promise<void> }> = [
  {
    nombre: "aprobación de una solicitud de traspaso",
    async correr(g, m, cliente) {
      const t = await traspasoSembrado(g, m, { seccionDestinoId: m.seccionDestinoId });
      await cliente.$transaction((tx) =>
        escribirAprobacionDeTraspaso(comoTx(tx), {
          traspasoId: t.id,
          productoId: m.harinaId,
          sucursalId: m.origenId,
          usuarioId: m.usuarioId,
          seccionOrigenId: m.seccionOrigenId,
          cantidad: 3,
          detalle: 'Transferencia a sucursal "Destino".',
          estadoNuevo: "ENVIADA",
          ahora: AHORA,
        })
      );
    },
  },
  {
    nombre: "envío directo de un traspaso",
    async correr(_g, m, cliente) {
      await cliente.$transaction((tx) =>
        escribirEnvioDirectoDeTraspaso(comoTx(tx), {
          origenSucursalId: m.origenId,
          destinoSucursalId: m.destinoId,
          productoId: m.harinaId,
          cantidad: 2.5,
          usuarioId: m.usuarioId,
          detalle: "envío de prueba",
          seccionOrigenId: m.seccionOrigenId,
          detalleSalida: 'Transferencia a sucursal "Destino".',
          ahora: AHORA,
        })
      );
    },
  },
  {
    nombre: "aceptación de un traspaso con clave I3",
    async correr(g, m, cliente) {
      const t = await traspasoSembrado(g, m, { estado: "ENVIADA", seccionOrigenId: m.seccionOrigenId, seccionDestinoId: m.seccionDestinoId });
      await cliente.$transaction(async (tx) => {
        const { operacionId } = await escribirAceptacionDeTraspaso(comoTx(tx), {
          traspasoId: t.id,
          productoId: m.harinaId,
          sucursalId: m.destinoId,
          usuarioId: m.usuarioId,
          seccionId: m.seccionDestinoId,
          cantidad: 3,
          detalle: 'Transferencia desde sucursal "Central".',
          estadoNuevo: "ACEPTADA",
          ahora: AHORA,
          idempotencia: { claveIdempotencia: CLAVE_I3, payloadHash: "hash-de-la-aceptacion" },
        });
        await registrarResultadoIdempotente(comoTx(tx), operacionId, "Traspaso aceptado.");
      });
    },
  },
  {
    nombre: "aceptación de un traspaso sin clave",
    async correr(g, m, cliente) {
      const t = await traspasoSembrado(g, m, { estado: "ENVIADA", seccionOrigenId: m.seccionOrigenId, seccionDestinoId: m.seccionDestinoId });
      await cliente.$transaction((tx) =>
        escribirAceptacionDeTraspaso(comoTx(tx), {
          traspasoId: t.id,
          productoId: m.harinaId,
          sucursalId: m.destinoId,
          usuarioId: m.usuarioId,
          seccionId: m.seccionDestinoId,
          cantidad: 3,
          detalle: 'Transferencia desde sucursal "Central".',
          estadoNuevo: "ACEPTADA",
          ahora: AHORA,
          idempotencia: null,
        })
      );
    },
  },
  {
    nombre: "reingreso de un traspaso sin clave",
    async correr(g, m, cliente) {
      const t = await traspasoSembrado(g, m, { estado: "RECHAZADA_DESTINO", seccionOrigenId: m.seccionOrigenId, seccionDestinoId: m.seccionDestinoId, motivoRechazoDestino: "no lo necesitamos" });
      await cliente.$transaction((tx) =>
        escribirReingresoDeTraspaso(comoTx(tx), {
          traspasoId: t.id,
          productoId: m.harinaId,
          sucursalId: m.origenId,
          usuarioId: m.usuarioId,
          seccionId: m.seccionOrigenId,
          cantidad: 3,
          detalle: "Reingreso por rechazo de Destino.",
          estadoNuevo: "CERRADA",
          ahora: AHORA,
          idempotencia: null,
        })
      );
    },
  },
  {
    nombre: "anulación de una compra con clave I3",
    correr: (g, m, cliente) => anularCompra(g, m, cliente, true),
  },
  {
    nombre: "anulación de una compra sin clave",
    correr: (g, m, cliente) => anularCompra(g, m, cliente, false),
  },
  {
    nombre: "anulación de una venta de dos líneas (una con cantidadExacta, otra con lote)",
    async correr(g, m, cliente) {
      const venta = await prisma.operacion.create({ data: { sucursalId: m.origenId, proceso: "VENTA", fecha: new Date("2026-09-30T20:00:00Z"), usuarioId: m.usuarioId } });
      g.nombrar(venta.id, "venta-original");
      await prisma.movimientoStock.createMany({
        data: [
          { operacionId: venta.id, productoId: m.harinaId, seccionId: m.seccionOrigenId, proceso: "CONSUMO", cantidad: -1, cantidadExacta: -0.75, detalle: "Consumo por venta de Pan", precioTotal: 0, precioPorUnidadStock: 0 },
          { operacionId: venta.id, productoId: m.panId, seccionId: m.seccionOrigenId, proceso: "VENTA", cantidad: -2, loteVencimiento: LOTE, detalle: "Venta de Pan", precioTotal: 200, precioPorUnidadStock: 100 },
        ],
      });
      const lineas = (await prisma.movimientoStock.findMany({ where: { operacionId: venta.id }, orderBy: { cantidad: "asc" } })).map((l) => ({
        productoId: l.productoId,
        seccionId: l.seccionId,
        proceso: l.proceso,
        cantidad: Number(l.cantidad),
        cantidadExacta: l.cantidadExacta === null ? null : Number(l.cantidadExacta),
        loteVencimiento: l.loteVencimiento,
        detalle: l.detalle,
        precioTotal: Number(l.precioTotal),
        precioPorUnidadStock: Number(l.precioPorUnidadStock),
      }));
      await cliente.$transaction((tx) =>
        escribirAnulacionDeVenta(comoTx(tx), {
          ventaId: venta.id,
          sucursalId: m.origenId,
          usuarioId: m.usuarioId,
          ahora: AHORA,
          detalleLibre: "Anulación de venta de prueba",
          reversion: construirReversionDeVenta(lineas),
        })
      );
    },
  },
];

async function correrCaso(caso: (typeof CASOS)[number]): Promise<unknown> {
  const g = new Grabadora();
  const m = await sembrarMundo(g);
  await caso.correr(g, m, g.cliente());
  return { escrituras: g.escrituras, filas: await g.volcar() };
}

async function correrTodos(): Promise<Record<string, unknown>> {
  const resultado: Record<string, unknown> = {};
  for (const caso of CASOS) resultado[caso.nombre] = await correrCaso(caso);
  return resultado;
}

describe("Huella de los escritores del Kardex (traspasos y anulaciones)", () => {
  it("cada caso escribe lo mismo que el golden, y dos corridas dan lo mismo", async () => {
    const primera = await correrTodos();
    const segunda = await correrTodos();
    expect(segunda, "dos corridas distintas: la huella depende de un id o del reloj").toEqual(primera);

    const texto = JSON.stringify(primera, null, 2) + "\n";
    expect(texto, "quedó un id de la base sin nombre simbólico").not.toMatch(/"c[a-z0-9]{20,}"/);
    // Si un caso no escribió nada, la huella no está mirando nada (el cliente con `$extends` no vio la transacción).
    for (const caso of CASOS) {
      const escrituras = (primera[caso.nombre] as { escrituras: unknown[] }).escrituras;
      expect(escrituras.length, caso.nombre).toBeGreaterThanOrEqual(3);
    }

    if (REGENERAR) {
      mkdirSync(join(__dirname, "__golden__"), { recursive: true });
      writeFileSync(ARCHIVO, texto, "utf8");
      return;
    }
    expect(existsSync(ARCHIVO), "falta kardex-escritores.golden.json: generalo contra el código ANTERIOR a la mudanza (REGENERAR_HUELLA_KARDEX=1)").toBe(true);
    expect(texto.replace(/\r\n/g, "\n")).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  }, 180_000);
});

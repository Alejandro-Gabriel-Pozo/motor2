import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../../setup/test-db";
import { mockearUsuarioActual } from "../../setup/mock-sesion";
import { registrarMovimiento } from "../../../src/server/actions/movimientos/movimientos";
import { anularVenta } from "../../../src/server/actions/movimientos/venta";
import { registrarVentaEnTx, type ActorVenta, type DatosVentaEnTx, type OpcionesVentaEnTx, type ResultadoVentaEnTx } from "../../../src/core/movimientos/registrar-venta";

/**
 * CARACTERIZACIÓN de la venta (Fase 4 del plan de pureza, tramo A: la venta sale de `core/movimientos` a `server/`). Se escribe ANTES de mover
 * nada y NO se edita en ningún paso posterior: si un paso cambia una fila, un mensaje, una consulta o su orden, este archivo lo tiene que
 * detectar en rojo. Para regenerarlo A PROPÓSITO (una decisión de producto, nunca una mudanza):
 * `REGENERAR_CARACTERIZACION_DE_VENTA=1 npx vitest run test/movimientos/caracterizacion/venta-matriz.test.ts`. Se usa un archivo propio y no los
 * snapshots de Vitest para que `-u` no lo pueda regenerar en silencio.
 *
 * Es UNA secuencia con estado (como un día de trabajo), y después de cada paso se vuelcan:
 *  1. el resultado (ok/mensaje/avisos);
 *  2. la TRAZA de consultas de ese paso: las lecturas como multiconjunto (el orden dentro de un `Promise.all` puede variar) y las escrituras EN SECUENCIA
 *     (de ese orden dependen la clave I3 en la primera Operación, el enlace del POS con su consumo y la reversión de la anulación);
 *  3. TODAS las filas de `Operacion` y `MovimientoStock`, con todas sus columnas, los decimales como texto exacto (un `Number` perdería un centavo) y los
 *     ids reemplazados por nombres simbólicos.
 * Un rechazo no escribe nada: su traza no tiene escrituras (todo rechazo sale ANTES de la primera escritura; un `fracaso` confirma la transacción).
 */
const ARCHIVO = join(__dirname, "venta-matriz.golden.txt");

type Delegados = Record<string, Record<string, (...args: unknown[]) => unknown>>;

/** Un `tx` que anota cada llamada a la base (`modelo.operación`, `$queryRaw`, `$executeRaw`) y la deja pasar. */
function conTraza(tx: Prisma.TransactionClient, traza: string[]): Prisma.TransactionClient {
  const crudo = tx as unknown as Record<string, unknown>;
  return new Proxy(crudo, {
    get(objetivo, propiedad) {
      const valor = objetivo[propiedad as string];
      if (typeof propiedad !== "string") return valor;
      if (propiedad.startsWith("$") && typeof valor === "function") {
        return (...args: unknown[]) => {
          traza.push(propiedad);
          return (valor as (...a: unknown[]) => unknown).apply(objetivo, args);
        };
      }
      if (valor && typeof valor === "object" && !propiedad.startsWith("_")) {
        return new Proxy(valor as Delegados[string], {
          get(modelo, operacion) {
            const f = modelo[operacion as string];
            if (typeof operacion !== "string" || typeof f !== "function") return f;
            return (...args: unknown[]) => {
              traza.push(`${propiedad}.${operacion}`);
              return f.apply(modelo, args);
            };
          },
        });
      }
      return valor;
    },
  }) as unknown as Prisma.TransactionClient;
}

const ESCRITURAS = /\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)$|^\$executeRaw/;

function resumenDeTraza(traza: readonly string[]): string[] {
  const lecturas = new Map<string, number>();
  for (const t of traza) if (!ESCRITURAS.test(t)) lecturas.set(t, (lecturas.get(t) ?? 0) + 1);
  const escrituras = traza.filter((t) => ESCRITURAS.test(t));
  return [
    `  lecturas (${[...lecturas.values()].reduce((a, b) => a + b, 0)}): ${[...lecturas].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => `${k}×${n}`).join(", ") || "ninguna"}`,
    `  escrituras en secuencia (${escrituras.length}): ${escrituras.join(" → ") || "ninguna"}`,
  ];
}

describe("Caracterización de la venta: una secuencia completa con filas y traza de consultas", () => {
  let sucursalId: string;
  let seccionId: string;
  let actor: ActorVenta;
  const nombres = new Map<string, string>();
  const desconocidos = new Map<string, string>();
  let ids: Record<string, string>;

  beforeEach(async () => {
    nombres.clear();
    desconocidos.clear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    actor = { usuarioId: admin.id, sucursalId, sucursalNombre: "Central" };

    const kg = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    const unidad = await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Bodega" } });
    const insumoMuzza = await prisma.insumo.create({ data: { nombre: "Muzzarella" } });
    const cliente = await prisma.cliente.create({ data: { nombre: "Ana", descuentoPorcentaje: 10 } });

    const mp = (codigo: string, nombre: string, extra: Record<string, unknown> = {}) =>
      sembrarProductoDisponible({ codigo, nombre, tipo: "MP", unidadStockId: kg.id, ...extra }, sucursalId).then((p) => p.id);
    const muzzaA = await mp("MP_MUZZA_A", "MuzzaA", { insumoId: insumoMuzza.id });
    const muzzaB = await mp("MP_MUZZA_B", "MuzzaB", { insumoId: insumoMuzza.id });
    const jamon = await mp("MP_JAMON", "Jamón");
    const vino = await mp("MP_VINO", "Vino", { esConsignacion: true, proveedorConsignacionId: proveedor.id, precioConsignacion: 100 });
    const bollo = (await sembrarProductoDisponible({ codigo: "MP_BOLLO", nombre: "Bollo", tipo: "MP", unidadStockId: unidad.id }, sucursalId)).id;

    const pv = (codigo: string, nombre: string, precioVenta: number, extra: Record<string, unknown> = {}) =>
      sembrarProductoDisponible({ codigo, nombre, tipo: "PV", unidadStockId: kg.id, precioVenta, ...extra }, sucursalId).then((p) => p.id);
    const pizza = await pv("PV_PIZZA", "Pizza", 12000);
    const copa = await pv("PV_COPA", "Copa", 2000);
    const sandwich = await pv("PV_SANDWICH", "Sandwich", 3000);
    const torta = await pv("PV_TORTA", "Torta", 5000, { seProduce: true });
    const pan = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidad.id, precioVenta: 800 }, sucursalId)).id;

    const receta = (productoId: string, insumoProductoId: string, cantidad: number, unidadId: string) =>
      prisma.recetaVersion.create({ data: { productoId, version: 1, ingredientes: { create: [{ insumoProductoId, cantidad, unidadId, mermaPorcentaje: 0 }] } } });
    await receta(pizza, muzzaA, 0.5, kg.id);
    await receta(copa, vino, 0.15, kg.id);
    await receta(sandwich, jamon, 0.2, kg.id);
    await receta(pan, bollo, 1, unidad.id);

    ids = { muzzaA, muzzaB, jamon, vino, bollo, pizza, copa, sandwich, torta, pan, cliente: cliente.id, proveedor: proveedor.id, seccion: seccionId, usuario: admin.id, sucursal: sucursalId };
    for (const [nombre, id] of Object.entries(ids)) nombres.set(id, nombre);

    // Costos de reposición determinísticos: MuzzaA y MuzzaB con costos DISTINTOS (1000 y 1200/kg); el costo de Pizza queda anclado a MuzzaA.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-01"), seccionId, items: [{ productoId: muzzaA, cantidad: 0.3, precioTotal: 300 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-01"), seccionId, items: [{ productoId: muzzaB, cantidad: 0.3, precioTotal: 360 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-01"), seccionId, items: [{ productoId: vino, cantidad: 2, precioTotal: 200 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-01"), seccionId, items: [{ productoId: bollo, cantidad: 3, precioTotal: 90 }] });
    await registrarMovimiento({ proceso: "PRODUCCION", fecha: new Date("2026-09-01"), seccionId, items: [{ productoId: torta, cantidad: 2, loteVencimiento: new Date("2026-10-01") }] });
  });

  const simbolo = (valor: string): string => {
    const conocido = nombres.get(valor);
    if (conocido) return conocido;
    if (!/^c[a-z0-9]{20,}$/.test(valor)) return valor;
    if (!desconocidos.has(valor)) desconocidos.set(valor, `id#${desconocidos.size + 1}`);
    return desconocidos.get(valor)!;
  };

  /** Una fila completa, columna por columna y en orden alfabético: lo que cambia por corrida (ids, horas de creación) se enmascara. */
  const fila = (f: Record<string, unknown>): string =>
    Object.keys(f)
      .sort()
      .map((columna) => {
        const v = f[columna];
        if (columna === "creadoEn" || columna === "anuladaEn" || columna === "payloadHash") return `${columna}=${v === null ? "null" : "<enmascarado>"}`;
        if (v === null || v === undefined) return `${columna}=null`;
        // La fecha de una Operación que escribe «ahora» (el contra-asiento de una anulación) cambia cada día: se enmascara.
        if (v instanceof Date) return `${columna}=${v.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10) ? "<hoy>" : v.toISOString().slice(0, 10)}`;
        if (v instanceof Prisma.Decimal) return `${columna}=${v.toString()}`;
        // Un texto puede citar ids («Anulación de la venta c…»): se reemplazan por su símbolo.
        if (typeof v === "string") return `${columna}=${simbolo(v).replace(/c[a-z0-9]{20,}/g, (id) => simbolo(id))}`;
        return `${columna}=${String(v)}`;
      })
      .join(" ");

  async function volcado(): Promise<string[]> {
    const operaciones = await prisma.operacion.findMany({ orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    // Se nombran primero las operaciones (por orden de creación) para que las filas del Kardex las citen con el mismo símbolo.
    operaciones.forEach((o, i) => nombres.set(o.id, `op${i + 1}`));
    const movimientos = await prisma.movimientoStock.findMany({ orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    return [
      ...operaciones.map((o) => `  OPERACION ${fila({ ...o, empresaId: "<empresa>", id: o.id })}`),
      ...movimientos.map((m) => `  KARDEX ${fila({ ...m, empresaId: "<empresa>", id: "<id>" })}`),
    ];
  }

  const lineas: string[] = [];

  /** Corre un paso de venta dentro de una transacción con traza y vuelca resultado, traza y filas. */
  async function paso(titulo: string, datos: DatosVentaEnTx, opciones?: OpcionesVentaEnTx): Promise<ResultadoVentaEnTx> {
    const traza: string[] = [];
    const r = await prisma.$transaction((tx) => registrarVentaEnTx(conTraza(tx, traza), actor, datos, opciones));
    lineas.push(`### ${titulo}`);
    if (r.ok) {
      r.operacionIds.forEach((id, i) => nombres.set(id, `venta${i + 1}`));
      lineas.push(`  resultado: ok «${r.mensaje}» avisos=${JSON.stringify(r.avisosStockNegativo.map((a) => ({ ...a, productoId: simbolo(a.productoId), seccionId: simbolo(a.seccionId) })))}`);
    } else {
      lineas.push(`  resultado: rechazo «${r.mensaje}»`);
    }
    lineas.push(...resumenDeTraza(traza), ...(await volcado()));
    return r;
  }

  it("la secuencia entera (POS con cliente y descuento, mostrador con I3, rechazo, fraccionada con arrastre, anulación) coincide con lo guardado", async () => {
    // 1. POS (origen automático, stock negativo permitido, cliente con descuento): hermanos repartidos, consignación, faltante con aviso, seProduce.
    const s1 = await paso(
      "1. POS: 4 líneas, cliente, descuento en Pizza, permitirStockNegativo",
      {
        fecha: new Date("2026-09-26"),
        origen: { tipo: "automatico" },
        clienteId: ids.cliente,
        lineas: [
          { productoId: ids.pizza, cantidadVendida: 1, precioUnitario: 10800, precioListaUnitario: 12000 },
          { productoId: ids.copa, cantidadVendida: 1, precioUnitario: 2000 },
          { productoId: ids.sandwich, cantidadVendida: 1, precioUnitario: 3000 },
          { productoId: ids.torta, cantidadVendida: 1, precioUnitario: 5000 },
        ],
      },
      { permitirStockNegativo: true },
    );
    expect(s1.ok).toBe(true);

    // 2. Reposición de MuzzaA y mostrador con clave I3 (queda en la PRIMERA Operación del lote).
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-27"), seccionId, items: [{ productoId: ids.muzzaA, cantidad: 2, precioTotal: 2000 }] });
    const s2 = await paso(
      "2. Mostrador: Pizza ×2 con clave de idempotencia, N.º de factura y detalle",
      { fecha: new Date("2026-09-27"), origen: { tipo: "seccion", seccionId }, nroFactura: "A-0001", detalle: "mesa 4", lineas: [{ productoId: ids.pizza, cantidadVendida: 2 }] },
      { idempotencia: { clave: "clave-1", payloadHash: "hash-1" } },
    );
    expect(s2.ok).toBe(true);

    // 3. Mostrador sin stock suficiente: se rechaza con el mensaje exacto y no se escribe nada.
    await paso("3. Mostrador: Sandwich sin Jamón → rechazo", { fecha: new Date("2026-09-28"), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: ids.sandwich, cantidadVendida: 1 }] });

    // 4. Venta fraccionada (0,5 + 0,5 de un Pan que consume 1 bollo): el arrastre de redondeo hace que el total sea 1 bollo, no 0 ni 2.
    await paso("4a. Mostrador: Pan ×0,5 (primera mitad)", { fecha: new Date("2026-09-28"), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: ids.pan, cantidadVendida: 0.5 }] });
    await paso("4b. Mostrador: Pan ×0,5 (segunda mitad)", { fecha: new Date("2026-09-28"), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: ids.pan, cantidadVendida: 0.5 }] });

    // 5. Anular la venta del paso 2 (contra-asiento AJUSTE por línea) y volver a anularla (rechazo).
    if (!s2.ok) return;
    const anulada = await anularVenta(s2.operacionIds[0]!);
    lineas.push("### 5. Anular la venta del paso 2");
    lineas.push(`  resultado: ${JSON.stringify(anulada)}`);
    lineas.push(...(await volcado()));
    const otraVez = await anularVenta(s2.operacionIds[0]!);
    lineas.push("### 6. Anularla otra vez");
    lineas.push(`  resultado: ${JSON.stringify(otraVez)}`);
    lineas.push(...(await volcado()));

    const actual = lineas.join("\n") + "\n";
    expect(actual.length).toBeGreaterThan(5_000); // si el escenario no armó nada, esto no está mirando nada

    if (process.env.REGENERAR_CARACTERIZACION_DE_VENTA === "1") {
      mkdirSync(__dirname, { recursive: true });
      writeFileSync(ARCHIVO, actual, "utf8");
      return;
    }
    expect(existsSync(ARCHIVO), "falta venta-matriz.golden.txt: generalo contra el código ANTERIOR a la mudanza").toBe(true);
    expect(actual.replace(/\r\n/g, "\n")).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  }, 120_000);
});

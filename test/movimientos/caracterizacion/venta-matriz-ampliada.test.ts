import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../../setup/test-db";
import { mockearUsuarioActual } from "../../setup/mock-sesion";
import { registrarMovimiento } from "../../../src/server/actions/movimientos/movimientos";
import type { ActorVenta, DatosVentaEnTx, OpcionesVentaEnTx } from "../../../src/core/movimientos/registrar-venta";
import type { DatosVentaInput } from "../../../src/core/features/ventas/venta.schema";
import type { Transaccion } from "../../../src/lib/db-tipos";
import { registrarVentaEnTx } from "../../../src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx";
import { registrarVentaCasoDeUso } from "../../../src/server/actions/movimientos/casos-de-uso/registrar-venta";
import { anularVentaCasoDeUso } from "../../../src/server/actions/movimientos/casos-de-uso/anular-venta";
import { cerrarCuentaCasoDeUso } from "../../../src/server/actions/pos/casos-de-uso/cerrar-cuenta";

/**
 * CARACTERIZACIÓN AMPLIADA de la venta (Hito 2 de docs/pureza-integracion.md, trabajo 2.7; origen: docs/plan-fase-4-pureza.md §10.4, fila 5). Completa la matriz
 * vigente (`venta-matriz.test.ts` + su golden, 7 pasos, que NO se tocan) con las ramas que esa matriz no ejercita, ANTES del segundo tiempo de la venta (5.1) y de
 * la frontera de la carta (4A-5, 5.2). Se escribe contra el código de hoy y NO se edita en ningún paso posterior: si una mudanza cambia una fila, un mensaje, una
 * consulta o su orden, este archivo lo tiene que detectar en rojo. Para regenerarlo A PROPÓSITO (una decisión de producto, nunca una mudanza):
 * `REGENERAR_CARACTERIZACION_DE_VENTA_AMPLIADA=1 npx vitest run test/movimientos/caracterizacion/venta-matriz-ampliada.test.ts`. Archivo propio y no los
 * snapshots de Vitest para que `-u` no lo pueda regenerar en silencio.
 *
 * Mismo patrón que la matriz vigente, en CINCO jornadas (cada una arranca de la base vacía con el mismo catálogo, para que el volcado no crezca sin fin): dentro de
 * una jornada los pasos son una secuencia con estado, y después de cada paso se vuelcan
 *  1. el resultado completo (ok/mensaje/avisos, o el `ResultadoCaso` entero de los casos de uso);
 *  2. la TRAZA de consultas del paso: lecturas como multiconjunto (el orden dentro de un `Promise.all` puede variar) y escrituras EN SECUENCIA;
 *  3. TODAS las filas de `Operacion` y `MovimientoStock` (y, cuando las hay, de `Cuenta`, `CuentaItem`, `PromoCuenta`, `EjemplarTicket` y `RegistroAuditoria`),
 *     con todas sus columnas, los decimales como texto exacto y los ids reemplazados por nombres simbólicos (los del catálogo por su nombre; las operaciones
 *     `opN` por orden de creación —`creadoEn`, desempate por id—; lo demás `id#N` por orden de aparición).
 * Un rechazo no escribe nada: su traza no tiene escrituras.
 *
 * Jornadas: A) mostrador: precio local (vigente y con la capacidad apagada), merma y rendimiento local, FEFO por lote de una MP, receta compartida entre platos
 * con hermanos, venta fraccionada con paso, stock insuficiente con pista, anulación de la fraccionada; B) POS automático (`registrarVentaEnTx` con origen
 * automático): sin y con stock negativo permitido, insumo sustituto, consignación con sección habitual, PV sin receta, sin respaldo y sin secciones activas;
 * C) caso de uso de mostrador con clave I3 (alta, repetición exacta, conflicto), PV que se produce con dos lotes y anulaciones; D) el cierre REAL de una cuenta
 * (`cerrarCuentaCasoDeUso`) con líneas netas, espejo de anulación, cliente con descuento, descuento de producto, promo y consignación, sus desenlaces YA_CERRADA,
 * ITEMS_SIN_ENVIAR y SIN_VENTA, y la anulación de una promo (con sus hermanas) y de una venta en consignación; R) rechazos de entrada.
 *
 * Reloj: solo `Date` congelado (los timers reales siguen andando: el pool de conexiones y los timeouts del cliente los usan) y AVANZADO un minuto antes de cada
 * acción, para que `creadoEn` (Prisma 7 lo genera en el cliente) ordene igual que en la vida real; el `ahora` de los casos de uso es ese mismo reloj.
 */
const ARCHIVO = join(__dirname, "venta-matriz-ampliada.golden.txt");
const RELOJ_INICIAL = new Date("2026-09-30T12:00:00.000Z").getTime();

type Delegados = Record<string, Record<string, (...args: unknown[]) => unknown>>;

/** Un `tx` que anota cada llamada a la base (`modelo.operación`, `$queryRaw`, `$executeRaw`) y la deja pasar (copia del de la matriz vigente). */
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

/** Columnas que cambian por corrida aunque el reloj esté congelado (las horas de alta las pone el cliente con el reloj, pero se enmascaran igual que en la matriz vigente). */
const ENMASCARADAS = new Set(["creadoEn", "abiertaEn", "payloadHash", "actualizadoEn"]);

describe("Caracterización ampliada de la venta: cinco jornadas con filas y traza de consultas", () => {
  let reloj = RELOJ_INICIAL;
  const tic = () => {
    reloj += 60_000;
    vi.setSystemTime(reloj);
    return new Date(reloj);
  };

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(reloj);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  const nombres = new Map<string, string>();
  const desconocidos = new Map<string, string>();
  const lineas: string[] = [];

  const simbolo = (valor: string): string => {
    const conocido = nombres.get(valor);
    if (conocido) return conocido;
    if (!/^c[a-z0-9]{20,}$/.test(valor)) return valor;
    if (!desconocidos.has(valor)) desconocidos.set(valor, `id#${desconocidos.size + 1}`);
    return desconocidos.get(valor)!;
  };
  /** Un texto que puede citar ids («Anulación de la venta c…»): cada uno se reemplaza por su símbolo. */
  const enTexto = (v: string) => simbolo(v).replace(/c[a-z0-9]{20,}/g, (id) => simbolo(id));
  const json = (v: unknown) => JSON.stringify(v, (_k, val: unknown) => (typeof val === "string" ? enTexto(val) : val));

  /** Una fila completa, columna por columna y en orden alfabético. */
  const fila = (f: Record<string, unknown>): string =>
    Object.keys(f)
      .sort()
      .map((columna) => {
        const v = f[columna];
        if (columna === "empresaId") return `${columna}=<empresa>`;
        if (ENMASCARADAS.has(columna)) return `${columna}=${v === null ? "null" : "<enmascarado>"}`;
        if (v === null || v === undefined) return `${columna}=null`;
        if (v instanceof Date) return `${columna}=${v.toISOString()}`;
        if (v instanceof Prisma.Decimal) return `${columna}=${v.toString()}`;
        if (typeof v === "string") return `${columna}=${enTexto(v)}`;
        if (Array.isArray(v)) return `${columna}=${json(v)}`;
        return `${columna}=${String(v)}`;
      })
      .join(" ");

  async function volcado(): Promise<string[]> {
    const operaciones = await prisma.operacion.findMany({ orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    // Primero las operaciones (por orden de creación), para que el Kardex, los ítems y la auditoría las citen con el mismo símbolo.
    operaciones.forEach((o, i) => nombres.set(o.id, `op${i + 1}`));
    const movimientos = await prisma.movimientoStock.findMany({ orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    const cuentas = await prisma.cuenta.findMany({ orderBy: [{ abiertaEn: "asc" }, { id: "asc" }] });
    const items = await prisma.cuentaItem.findMany({ orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    const promos = await prisma.promoCuenta.findMany({ orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    const tickets = await prisma.ejemplarTicket.findMany({ orderBy: [{ numero: "asc" }, { ejemplar: "asc" }] });
    const auditoria = await prisma.registroAuditoria.findMany({ orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    return [
      ...operaciones.map((o) => `  OPERACION ${fila(o)}`),
      ...movimientos.map((m) => `  KARDEX ${fila({ ...m, id: "<id>" })}`),
      ...cuentas.map((c) => `  CUENTA ${fila(c)}`),
      ...items.map((i) => `  CUENTA_ITEM ${fila(i)}`),
      ...promos.map((p) => `  PROMO_CUENTA ${fila(p)}`),
      ...tickets.map((t) => `  TICKET ${fila({ ...t, id: "<id>" })}`),
      ...auditoria.map((a) => `  AUDITORIA ${fila({ ...a, id: "<id>" })}`),
    ];
  }

  // ── El mundo de cada jornada ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  let actor: ActorVenta;
  let usuarioId: string;
  let sucursalId: string;
  let C: Record<string, string>;

  /** Base vacía, permisos, la sucursal «Central» con «Depósito» y «Barra», y el catálogo de la matriz ampliada (sin ningún movimiento). */
  async function abrirJornada(titulo: string): Promise<void> {
    nombres.clear();
    desconocidos.clear();
    lineas.push(`## ${titulo}`);
    tic();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const deposito = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const barra = (await sembrarSeccion(sucursalId, "Barra")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    usuarioId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    actor = { usuarioId, sucursalId, sucursalNombre: "Central" };

    const kg = (await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } })).id;
    const unidad = (await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } })).id;
    const litro = (await prisma.unidad.create({ data: { nombre: "litro", magnitud: "VOLUMEN", decimales: 3 } })).id;
    const bodega = (await prisma.proveedor.create({ data: { codigo: "PRV_BODEGA", nombre: "Bodega" } })).id;
    const insumoHarina = (await prisma.insumo.create({ data: { nombre: "Harina" } })).id;
    const insumoBife = (await prisma.insumo.create({ data: { nombre: "Bife de chorizo" } })).id;
    const insumoOjo = (await prisma.insumo.create({ data: { nombre: "Ojo de bife" } })).id;
    const ana = (await prisma.cliente.create({ data: { nombre: "Ana", descuentoPorcentaje: 10 } })).id;

    const mp = (codigo: string, nombre: string, unidadStockId: string, extra: Record<string, unknown> = {}) =>
      sembrarProductoDisponible({ codigo, nombre, tipo: "MP", unidadStockId, ...extra }, sucursalId).then((p) => p.id);
    const harinaA = await mp("MP_HARINA_A", "HarinaA", kg, { insumoId: insumoHarina });
    const harinaB = await mp("MP_HARINA_B", "HarinaB", kg, { insumoId: insumoHarina });
    const aceite = await mp("MP_ACEITE", "Aceite", litro);
    const tapa = await mp("MP_TAPA", "Tapa", unidad);
    const bife = await mp("MP_BIFE", "Bife", kg, { insumoId: insumoBife });
    const ojo = await mp("MP_OJO", "Ojo", kg, { insumoId: insumoOjo });
    const vino = await mp("MP_VINO", "Vino", litro, { esConsignacion: true, proveedorConsignacionId: bodega, precioConsignacion: 33.33 });
    // Queso: MP que NO está disponible en «Central» (sin fila de disponibilidad = no disponible).
    const queso = (await prisma.producto.create({ data: { codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: kg } })).id;

    const pv = (codigo: string, nombre: string, precioVenta: number, unidadStockId: string, extra: Record<string, unknown> = {}) =>
      sembrarProductoDisponible({ codigo, nombre, tipo: "PV", unidadStockId, precioVenta, ...extra }, sucursalId).then((p) => p.id);
    const fugazza = await pv("PV_FUGAZZA", "Fugazza", 9000, unidad);
    const focaccia = await pv("PV_FOCACCIA", "Focaccia", 7000, unidad);
    const pizza = await pv("PV_PIZZA", "Pizza", 12000, unidad);
    const empanada = await pv("PV_EMPANADA", "Empanada", 1500, unidad, { pasoVenta: 0.5 });
    const agua = await pv("PV_AGUA", "Agua", 1000, unidad);
    const flan = await pv("PV_FLAN", "Flan", 3000, unidad);
    const milanesa = await pv("PV_MILANESA", "Milanesa", 8000, unidad);
    const copa = await pv("PV_COPA", "Copa", 2000, unidad);
    const torta = await pv("PV_TORTA", "Torta", 5000, unidad, { seProduce: true });
    const tarta = await pv("PV_TARTA", "Tarta", 6000, unidad);
    // Licuado: PV con su fila de disponibilidad APAGADA en «Central».
    const licuado = (await prisma.producto.create({ data: { codigo: "PV_LICUADO", nombre: "Licuado", tipo: "PV", unidadStockId: unidad, precioVenta: 2500 } })).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: licuado, disponible: false } });

    type Ingrediente = Prisma.RecetaIngredienteUncheckedCreateWithoutRecetaVersionInput;
    const receta = (productoId: string, ingredientes: Ingrediente[]) => prisma.recetaVersion.create({ data: { productoId, version: 1, ingredientes: { create: ingredientes } } });
    const ing = (insumoProductoId: string, cantidad: number, unidadId: string, extra: Partial<Ingrediente> = {}): Ingrediente => ({ insumoProductoId, cantidad, unidadId, ...extra });
    // Fugazza: Harina con 10 % de merma y Aceite calibrado en «Central» (rendimiento local: 0,015 L en vez de 0,02).
    const recetaFugazza = await receta(fugazza, [ing(harinaA, 0.25, kg, { mermaPorcentaje: 10 })]);
    const ingAceite = await prisma.recetaIngrediente.create({ data: { recetaVersionId: recetaFugazza.id, insumoProductoId: aceite, cantidad: 0.02, unidadId: litro } });
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: ingAceite.id, sucursalId, cantidad: 0.015, mermaPorcentaje: null } });
    await receta(focaccia, [ing(harinaA, 0.3, kg)]);
    await receta(pizza, [ing(harinaA, 0.25, kg)]);
    await receta(empanada, [ing(tapa, 1, unidad)]);
    await receta(milanesa, [ing(bife, 0.3, kg, { sustitutos: { create: [{ insumoSustitutoId: insumoOjo, orden: 1 }] } })]);
    await receta(copa, [ing(vino, 0.15, litro)]);
    await receta(tarta, [ing(queso, 0.2, kg)]);

    C = { deposito, barra, kg, unidad, litro, bodega, insumoHarina, insumoBife, insumoOjo, ana, harinaA, harinaB, aceite, tapa, bife, ojo, vino, queso, fugazza, focaccia, pizza, empanada, agua, flan, milanesa, copa, torta, tarta, licuado, usuario: usuarioId, sucursal: sucursalId };
    for (const [nombre, id] of Object.entries(C)) nombres.set(id, nombre);
  }

  /** Movimiento de preparación (compra o producción) con la acción real, un minuto después del anterior. */
  async function preparar(datos: Parameters<typeof registrarMovimiento>[0]): Promise<void> {
    tic();
    const r = await registrarMovimiento(datos);
    if (!r.ok) throw new Error(`preparación rechazada: ${r.mensaje}`);
  }

  /** Una transacción real que pasa a la función un `tx` con traza (para los casos de uso, que abren la suya con `conTransaccionSerializable`). */
  const transaccionConTraza = (traza: string[]): Transaccion => (fn, opciones) => prisma.$transaction((tx) => fn(conTraza(tx, traza)), opciones);

  /** Vuelca un paso: primero las filas (nombran las operaciones nuevas), después el resultado con esos nombres, la traza y las filas. */
  async function volcarPaso(titulo: string, resultado: () => string, traza: readonly string[]): Promise<void> {
    const filas = await volcado();
    lineas.push(`### ${titulo}`, `  resultado: ${resultado()}`, ...resumenDeTraza(traza), ...filas);
  }

  /** Un paso del núcleo `registrarVentaEnTx` dentro de una transacción con traza. */
  async function pasoEnTx(titulo: string, datos: DatosVentaEnTx, opciones?: OpcionesVentaEnTx) {
    tic();
    const traza: string[] = [];
    const r = await prisma.$transaction((tx) => registrarVentaEnTx(conTraza(tx, traza), actor, datos, opciones));
    await volcarPaso(
      titulo,
      () =>
        r.ok
          ? `ok «${r.mensaje}» operaciones=${json(r.operacionIds)} avisos=${json(r.avisosStockNegativo)}`
          : `rechazo «${r.mensaje}»`,
      traza
    );
    return r;
  }

  /** Un paso de un caso de uso (venta de mostrador, anulación, cierre de cuenta), con su `ResultadoCaso` entero. */
  async function pasoCasoDeUso<T>(titulo: string, f: (transaccion: Transaccion, ahora: Date) => Promise<T>): Promise<T> {
    const ahora = tic();
    const traza: string[] = [];
    const r = await f(transaccionConTraza(traza), ahora);
    await volcarPaso(titulo, () => json(r), traza);
    return r;
  }

  const venderEnMostrador = (titulo: string, datos: DatosVentaInput) =>
    pasoCasoDeUso(titulo, (transaccion) => registrarVentaCasoDeUso({ ...actor, transaccion }, datos));
  const anular = (titulo: string, operacionId: string) =>
    pasoCasoDeUso(titulo, (transaccion, ahora) => anularVentaCasoDeUso({ usuarioId, sucursalId, transaccion, ahora }, { operacionId }));
  const cerrar = (titulo: string, cuentaId: string) =>
    pasoCasoDeUso(titulo, (transaccion, ahora) => cerrarCuentaCasoDeUso({ ...actor, email: "admin@test.com", transaccion, ahora }, { cuentaId }));

  const idsDe = (r: unknown): string[] => {
    const x = r as { ok: boolean; operacionIds?: string[]; datos?: { operacionIds?: string[] | null } };
    if (!x.ok) throw new Error(`se esperaba un ok: ${json(r)}`);
    return x.operacionIds ?? x.datos?.operacionIds ?? [];
  };

  it("las cinco jornadas (mostrador, POS automático, I3 y lotes, cierre real del POS, rechazos) coinciden con lo guardado", async () => {
    const mostrador = (seccionId: string, fecha: string, ventas: DatosVentaEnTx["lineas"], extra: Partial<DatosVentaEnTx> = {}): DatosVentaEnTx => ({
      fecha: new Date(fecha),
      origen: { tipo: "seccion", seccionId },
      lineas: ventas,
      ...extra,
    });

    // ── A. Mostrador ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await abrirJornada("A. Mostrador: precio local, merma y rendimiento local, FEFO por lote, receta compartida, fraccionada, pista de stock y anulación");
    // HarinaA en DOS lotes (0,4 kg que vencen antes y 1 kg después), HarinaB (hermana del mismo Insumo), Aceite, Tapas y Bife SOLO en «Barra».
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId: C.deposito, items: [{ productoId: C.harinaA, cantidad: 0.4, precioTotal: 320, loteVencimiento: new Date("2026-10-02") }] });
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-21"), seccionId: C.deposito, items: [{ productoId: C.harinaA, cantidad: 1, precioTotal: 900, loteVencimiento: new Date("2026-10-04") }] });
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-21"), seccionId: C.deposito, items: [{ productoId: C.harinaB, cantidad: 0.5, precioTotal: 500 }] });
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-21"), seccionId: C.deposito, items: [{ productoId: C.aceite, cantidad: 1, precioTotal: 5000 }] });
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-21"), seccionId: C.deposito, items: [{ productoId: C.tapa, cantidad: 10, precioTotal: 1000 }] });
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-21"), seccionId: C.barra, items: [{ productoId: C.bife, cantidad: 1, precioTotal: 10000 }] });
    await prisma.precioLocalProducto.create({ data: { sucursalId, productoId: C.agua, precio: 1200 } });

    await pasoEnTx("A1. Agua ×2 con Precio Local vigente (1200 en vez de 1000), PV sin receta", mostrador(C.deposito, "2026-09-25", [{ productoId: C.agua, cantidadVendida: 2 }]));
    await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId, habilitado: false } });
    await pasoEnTx("A2. Agua ×1 con la capacidad precio_local APAGADA: rige el precio central", mostrador(C.deposito, "2026-09-25", [{ productoId: C.agua, cantidadVendida: 1 }]));
    await pasoEnTx("A3. Fugazza ×2: merma 10 % (0,55 kg de Harina, FEFO entre dos lotes) y Aceite con rendimiento local (0,03 L, unidad de 3 decimales)", mostrador(C.deposito, "2026-09-26", [{ productoId: C.fugazza, cantidadVendida: 2 }]));
    await pasoEnTx(
      "A4. Fugazza ×1 + Focaccia ×2: receta compartida (HarinaA) entre dos platos de la misma venta, el resto sale de la hermana HarinaB",
      mostrador(C.deposito, "2026-09-26", [{ productoId: C.fugazza, cantidadVendida: 1 }, { productoId: C.focaccia, cantidadVendida: 2 }], { nroFactura: "  A-0002  ", detalle: "  " })
    );
    const fraccionada = await pasoEnTx("A5. Empanada ×1,5 (paso de venta 0,5): 1,5 tapas redondeadas a 2 con cantidad exacta", mostrador(C.deposito, "2026-09-27", [{ productoId: C.empanada, cantidadVendida: 1.5 }]));
    await pasoEnTx("A6. Empanada ×0,3: no cumple el paso de venta → rechazo", mostrador(C.deposito, "2026-09-27", [{ productoId: C.empanada, cantidadVendida: 0.3 }]));
    await pasoEnTx("A7. Milanesa desde «Depósito» sin Bife ni sustituto: rechazo con la pista de la sección que sí tiene", mostrador(C.deposito, "2026-09-27", [{ productoId: C.milanesa, cantidadVendida: 1 }]));
    await anular("A8. Anular la venta fraccionada (la reversión usa la cantidad exacta)", idsDe(fraccionada)[0]!);

    // ── B. POS automático ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await abrirJornada("B. POS automático (registrarVentaEnTx con origen automático): stock negativo, sustituto, consignación, sin receta, sin respaldo");
    const cocina = (await sembrarSeccion(sucursalId, "Cocina")).id;
    nombres.set(cocina, "cocina");
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId: C.barra, items: [{ productoId: C.harinaA, cantidad: 0.1, precioTotal: 100 }] });
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId: C.deposito, items: [{ productoId: C.bife, cantidad: 0.2, precioTotal: 2000 }] });
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId: cocina, items: [{ productoId: C.ojo, cantidad: 1, precioTotal: 9000 }] });
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId: C.deposito, items: [{ productoId: C.vino, cantidad: 1, precioTotal: 3333 }] });
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId: C.barra, items: [{ productoId: C.vino, cantidad: 2, precioTotal: 6666 }] });
    await prisma.seccionHabitualProducto.create({ data: { sucursalId, productoId: C.copa, seccionId: C.barra } });
    const automatico = (fecha: string, ventas: DatosVentaEnTx["lineas"], extra: Partial<DatosVentaEnTx> = {}): DatosVentaEnTx => ({ fecha: new Date(fecha), origen: { tipo: "automatico" }, lineas: ventas, ...extra });

    await pasoEnTx("B1. Focaccia ×1 SIN stock negativo permitido (0,1 kg en «Barra», pide 0,3): rechazo con pista", automatico("2026-09-25", [{ productoId: C.focaccia, cantidadVendida: 1 }]));
    await pasoEnTx("B2. La misma Focaccia CON stock negativo permitido: sale con aviso", automatico("2026-09-25", [{ productoId: C.focaccia, cantidadVendida: 1 }]), { permitirStockNegativo: true });
    await pasoEnTx("B3. Milanesa ×1: 0,2 kg de Bife en «Depósito» y el resto del sustituto (Ojo, en «Cocina»)", automatico("2026-09-26", [{ productoId: C.milanesa, cantidadVendida: 1, precioUnitario: 7500 }]), { permitirStockNegativo: true });
    await pasoEnTx(
      "B4. Copa ×3 con sección habitual «Barra» (consignación a 33,33 el litro) y cliente con precio de lista",
      automatico("2026-09-26", [{ productoId: C.copa, cantidadVendida: 3, precioUnitario: 1800, precioListaUnitario: 2000 }], { clienteId: C.ana, detalle: "Mesa 9" }),
      { permitirStockNegativo: true }
    );
    await pasoEnTx("B5. Flan ×1 (PV sin receta, sin habitual ni movimientos): la fila VENTA va a la primera sección de respaldo", automatico("2026-09-26", [{ productoId: C.flan, cantidadVendida: 1 }]), { permitirStockNegativo: true });
    await prisma.seccion.updateMany({ where: { sucursalId }, data: { sirveDeRespaldoEnVentas: false } });
    await pasoEnTx("B6. Ninguna sección sirve de respaldo y el Flan no tiene habitual: rechazo", automatico("2026-09-27", [{ productoId: C.flan, cantidadVendida: 1 }]), { permitirStockNegativo: true });
    await pasoEnTx("B7. La Copa SÍ tiene habitual: sale aunque ninguna sección sea de respaldo", automatico("2026-09-27", [{ productoId: C.copa, cantidadVendida: 1 }]), { permitirStockNegativo: true });
    await prisma.seccion.updateMany({ where: { sucursalId }, data: { activa: false } });
    await pasoEnTx("B8. Sin ninguna sección activa: rechazo", automatico("2026-09-27", [{ productoId: C.copa, cantidadVendida: 1 }]), { permitirStockNegativo: true });

    // ── C. I3 y lotes de un PV que se produce ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await abrirJornada("C. Caso de uso de mostrador con clave I3, PV que se produce con dos lotes, anulaciones");
    await preparar({ proceso: "PRODUCCION", fecha: new Date("2026-09-20"), seccionId: C.deposito, items: [{ productoId: C.torta, cantidad: 2, loteVencimiento: new Date("2026-10-04") }] });
    await preparar({ proceso: "PRODUCCION", fecha: new Date("2026-09-21"), seccionId: C.deposito, items: [{ productoId: C.torta, cantidad: 2, loteVencimiento: new Date("2026-10-02") }] });
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-21"), seccionId: C.deposito, items: [{ productoId: C.tapa, cantidad: 5, precioTotal: 500 }] });

    const conClave: DatosVentaInput = { fecha: new Date("2026-09-28"), seccionId: C.deposito, nroFactura: "B-0007", detalle: "retira", claveIdempotencia: "clave-C", ventas: [{ productoId: C.torta, cantidadVendida: 1 }, { productoId: C.empanada, cantidadVendida: 2 }] };
    const conI3 = await venderEnMostrador("C1. Torta ×1 + Empanada ×2 con clave I3 (la clave va solo en la PRIMERA Operación; la Torta sale del lote que vence antes)", conClave);
    await venderEnMostrador("C2. El mismo envío otra vez: repetida, sin escribir nada", conClave);
    await venderEnMostrador("C3. La misma clave con otro contenido: conflicto de idempotencia", { ...conClave, ventas: [{ productoId: C.torta, cantidadVendida: 2 }] });
    const tortas = await pasoEnTx("C4. Torta ×2 (al lote que vence antes le queda 1): se elige un solo lote, sin repartir", mostrador(C.deposito, "2026-09-29", [{ productoId: C.torta, cantidadVendida: 2 }]));
    await anular("C5. Anular la venta de Tortas (la reversión vuelve al mismo lote)", idsDe(tortas)[0]!);
    await anular("C6. Anular SOLO la primera Operación de la venta I3 (la Empanada, otra Operación, sigue vigente)", idsDe(conI3)[0]!);

    // ── D. Cierre real de cuentas del POS ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await abrirJornada("D. Cierre REAL de cuentas del POS (cerrarCuentaCasoDeUso) y anulación de promo y de consignación");
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId: C.deposito, items: [{ productoId: C.harinaA, cantidad: 0.3, precioTotal: 300 }] });
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId: C.barra, items: [{ productoId: C.vino, cantidad: 1, precioTotal: 3333 }] });
    const mesa = async (numero: number) => {
      const m = await prisma.mesa.create({ data: { sucursalId, numero } });
      nombres.set(m.id, `mesa${numero}`);
      return m.id;
    };
    const cuentaCon = async (nombre: string, mesaId: string, datos: Partial<Prisma.CuentaUncheckedCreateInput> = {}) => {
      tic();
      const cuenta = await prisma.cuenta.create({ data: { mesaId, abiertaPorId: usuarioId, ...datos } });
      nombres.set(cuenta.id, nombre);
      return cuenta.id;
    };
    const item = async (nombre: string, data: Omit<Prisma.CuentaItemUncheckedCreateInput, "creadoPorId">) => {
      tic(); // uno por minuto: el orden de los ítems (y de las líneas netas) es el de carga
      const creado = await prisma.cuentaItem.create({ data: { ...data, creadoPorId: usuarioId } });
      nombres.set(creado.id, nombre);
      return creado.id;
    };
    const seccionCarta = (await prisma.seccionCarta.create({ data: { nombre: "Menú" } })).id;
    const promoCarta = (await prisma.promoCarta.create({ data: { seccionCartaId: seccionCarta, titulo: "Menú del día", precio: 14000, sucursales: { create: { sucursalId } } } })).id;
    nombres.set(seccionCarta, "seccionCarta");
    nombres.set(promoCarta, "promoCarta");

    // Cuenta 1 (mesa 4, Ana con 10 % congelado): Pizza ×2 y su espejo −1, otra Pizza ×1 en el envío 2 (misma línea neta: 2), Flan con 20 % de descuento de
    // producto (gana sobre el 10 % del cliente), Copa ×2 (gana el cliente) y una promo de Pizza + Flan. HarinaA alcanza para 1,2 pizzas: queda negativo.
    const c1 = await cuentaCon("cuenta1", await mesa(4), { clienteId: C.ana, descuentoPorcentaje: 10, comensales: 3 });
    const pizza1 = await item("item.pizza×2", { cuentaId: c1, productoId: C.pizza, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 });
    await item("item.pizza−1", { cuentaId: c1, productoId: C.pizza, cantidad: -1, precioUnitario: 12000, numeroEnvio: 1, anulaAItemId: pizza1, motivoAnulacion: "Se equivocó" });
    await item("item.flan", { cuentaId: c1, productoId: C.flan, cantidad: 1, precioUnitario: 2400, precioCartaUnitario: 3000, numeroEnvio: 1 });
    await item("item.copa×2", { cuentaId: c1, productoId: C.copa, cantidad: 2, precioUnitario: 2000, numeroEnvio: 1 });
    tic();
    const promo = await prisma.promoCuenta.create({ data: { cuentaId: c1, promoCartaId: promoCarta, precio: 14000, titulo: "Menú del día", creadoPorId: usuarioId } });
    nombres.set(promo.id, "promoCuenta");
    await item("item.promo.pizza", { cuentaId: c1, productoId: C.pizza, cantidad: 1, precioUnitario: 10000, precioCartaUnitario: 12000, promoCuentaId: promo.id, numeroEnvio: 1 });
    await item("item.promo.flan", { cuentaId: c1, productoId: C.flan, cantidad: 1, precioUnitario: 4000, precioCartaUnitario: 3000, promoCuentaId: promo.id, numeroEnvio: 1 });
    await item("item.pizza×1.envio2", { cuentaId: c1, productoId: C.pizza, cantidad: 1, precioUnitario: 12000, numeroEnvio: 2 });
    // Cuenta 2 (mesa 5): un ítem todavía sin enviar. Cuenta 3 (mesa 6): un Flan y su espejo (neto cero).
    const c2 = await cuentaCon("cuenta2", await mesa(5));
    await item("item.c2.flan.enviado", { cuentaId: c2, productoId: C.flan, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 });
    await item("item.c2.flan.borrador", { cuentaId: c2, productoId: C.flan, cantidad: 1, precioUnitario: 3000, numeroEnvio: null });
    const c3 = await cuentaCon("cuenta3", await mesa(6));
    const flan3 = await item("item.c3.flan", { cuentaId: c3, productoId: C.flan, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 });
    await item("item.c3.flan−1", { cuentaId: c3, productoId: C.flan, cantidad: -1, precioUnitario: 3000, numeroEnvio: 1, anulaAItemId: flan3, motivoAnulacion: "Se fue" });

    const cierre = await cerrar("D1. Cerrar la cuenta 1: una Operación por línea neta, ticket, enlace de ítems, cuenta cerrada y auditoría del stock negativo", c1);
    await cerrar("D2. Cerrarla otra vez: YA_CERRADA, sin escribir nada", c1);
    await cerrar("D3. Cuenta 2 con un ítem sin enviar: rechazo", c2);
    await cerrar("D4. Cuenta 3 con neto cero: se cierra SIN venta", c3);
    const opsCierre = idsDe(cierre);
    const opPromoPizza = (await prisma.operacion.findFirstOrThrow({ where: { id: { in: opsCierre }, promoCuentaId: promo.id }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).id;
    const opCopa = (await prisma.movimientoStock.findFirstOrThrow({ where: { operacionId: { in: opsCierre }, productoId: C.copa, proceso: "VENTA" } })).operacionId;
    await anular("D5. Anular un componente de la promo: se anulan las dos hermanas", opPromoPizza);
    await anular("D6. Anular la Copa (consignación con descuento de cliente): revierte también la liquidación", opCopa);
    await anular("D7. Anular otra vez el componente de la promo: rechazo", opPromoPizza);

    // ── R. Rechazos de entrada ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await abrirJornada("R. Rechazos de entrada del núcleo (mostrador): ninguno escribe");
    await preparar({ proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId: C.deposito, items: [{ productoId: C.tapa, cantidad: 2, precioTotal: 200 }] });
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const seccionNorte = (await sembrarSeccion(norte.id, "Depósito Norte")).id;
    nombres.set(norte.id, "norte");
    nombres.set(seccionNorte, "seccionNorte");

    await pasoEnTx("R1. Licuado: no disponible en «Central»", mostrador(C.deposito, "2026-09-25", [{ productoId: C.licuado, cantidadVendida: 1 }]));
    await pasoEnTx("R2. Tarta: su receta usa Queso, que no está disponible en «Central»", mostrador(C.deposito, "2026-09-25", [{ productoId: C.tarta, cantidadVendida: 1 }]));
    await pasoEnTx("R3. Sección de OTRA sucursal", mostrador(seccionNorte, "2026-09-25", [{ productoId: C.empanada, cantidadVendida: 1 }]));
    await pasoEnTx("R4. Todas las líneas con cantidad 0", mostrador(C.deposito, "2026-09-25", [{ productoId: C.empanada, cantidadVendida: 0 }, { productoId: C.agua, cantidadVendida: 0 }]));
    await pasoEnTx("R5. Una línea válida y otra con cantidad negativa: nada se escribe", mostrador(C.deposito, "2026-09-25", [{ productoId: C.empanada, cantidadVendida: 1 }, { productoId: C.agua, cantidadVendida: -1 }]));
    await pasoEnTx("R6. Una MP vendida directo (Tapa)", mostrador(C.deposito, "2026-09-25", [{ productoId: C.tapa, cantidadVendida: 1 }]));

    const actual = lineas.join("\n") + "\n";
    expect(actual.length).toBeGreaterThan(20_000); // si el escenario no armó nada, esto no está mirando nada

    if (process.env.REGENERAR_CARACTERIZACION_DE_VENTA_AMPLIADA === "1") {
      mkdirSync(__dirname, { recursive: true });
      writeFileSync(ARCHIVO, actual, "utf8");
      return;
    }
    expect(existsSync(ARCHIVO), "falta venta-matriz-ampliada.golden.txt: generalo contra el código ANTERIOR a la mudanza").toBe(true);
    expect(actual.replace(/\r\n/g, "\n")).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  }, 300_000);
});

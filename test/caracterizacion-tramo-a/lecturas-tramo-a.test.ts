import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import type { Db } from "../../src/lib/db-tipos";
// POS
import { obtenerMapaDeMesas } from "../../src/server/consultas/pos/mesas";
import { obtenerDetalleDeMesa } from "../../src/server/consultas/pos/detalle-de-mesa";
import { obtenerTicketsRecientes } from "../../src/server/consultas/pos/tickets";
import { cargarSelectorCartaDeLaMesa } from "../../src/server/consultas/pos/selector-carta";
import { cargarPromoCartaParaAgregar } from "../../src/server/lecturas/pos/promo-para-agregar";
// Carta interna
import { cargarAdminCarta, cargarAdminItemsAgrupados, cargarAdminPortal, cargarPortalEmpresaAdmin, cargarTemaAdmin } from "../../src/server/consultas/carta/admin";
import { generarReporteVentasPorSeccion } from "../../src/server/consultas/carta/ventas-por-seccion";
import { resolverGrupoDeProducto } from "../../src/server/lecturas/carta/grupo-de-producto";
// Carta pública
import { resolverMenuCarta, resolverMenuCartaConDiagnostico } from "../../src/server/lecturas/carta/menu";
import { resolverEmpresaCarta, type EmpresaCarta } from "../../src/server/lecturas/carta/empresa";
import { resolverCartaPublica, resolverConfigPortal, resolverPortalCarta } from "../../src/server/lecturas/carta/publica";
import { descuentosConfiguradosEnSucursal, descuentosDeProductoEnSucursal, productoTieneDescuentoEnAlgunaSucursal } from "../../src/server/lecturas/carta/descuentos";
// Stock
import { calcularStockConsolidado } from "../../src/server/consultas/stock/consolidado";
import { calcularStockPorFamilia } from "../../src/server/consultas/stock/por-familia";
import { calcularAlertasStock, obtenerResumenAlertasStock } from "../../src/server/consultas/stock/alertas";
import { resolverStockMinimo } from "../../src/server/consultas/stock/stock-minimo";
// Catálogo
import { cargarArbolDeGrupos, creariaCiclo } from "../../src/server/lecturas/catalogo/grupos";
import { obtenerEstadoDeRecetaPropia } from "../../src/server/lecturas/catalogo/receta-propia";
// Auth (las lecturas de los scripts de auditoría de cuentas)
import { detectarCuentasDeGoogleSospechosas, medirPrecargadosSinGoogle } from "../../scripts/lecturas-de-auth";

/**
 * Caracterización del tramo A (Fase 3, paso .0): no se edita al migrar.
 *
 * Hito 2 de docs/pureza-integracion.md, trabajo 2.3 (origen: docs/plan-fase-4-pureza.md §11.2 #11 y docs/plan-fase-3-pureza.md, tramo A: «cada paso .0 escribe
 * tests de caracterización contra el código viejo, resultado completo con toEqual»). Las lecturas del tramo A se mudaron a `server/consultas` y
 * `server/lecturas` SIN esa red; esta es la red que faltaba, escrita contra el código de HOY, para que cualquier mudanza o retoque posterior (el «segundo
 * tiempo» de cada lectura, `ahora` obligatorio, H8) se haga con el resultado fijado. Al migrar solo cambia la ruta de los imports, nunca el golden.
 *
 * Una sola siembra realista (ids FIJOS escritos a mano y horas fijas), solo lectura después, y el reloj (`Date`, nada más: los timers reales siguen andando
 * para el pool y los timeouts del cliente) congelado en `AHORA`. Por cada función: un caso que corre la lectura sobre un cliente DERIVADO que anota cada
 * consulta (`$allOperations` de primer nivel: en Prisma 7 ya ve las de modelo y las crudas; sumarle `$allModels` contaría dos veces) y compara con `toEqual`
 * el par { consultas, resultado } ENTERO contra `lecturas-tramo-a.golden.json`:
 *  - `consultas`: el total y el multiconjunto `modelo.operación×n` ordenado (dentro de un `Promise.all` el orden de llegada varía; la cantidad no);
 *  - `resultado`: el objeto completo devuelto, en una forma JSON estable y ESTRICTA (fechas `<fecha ISO>`, `Decimal` `<decimal x>`, `Map`/`Set` como
 *    lista en su orden de inserción, `undefined` como `<undefined>` para que no se confunda con una clave ausente).
 * Algunas lecturas devuelven listas en el orden en que las entrega la base SIN `ORDER BY` (el árbol de grupos, las cuentas de Google de un usuario, las filas de
 * un `groupBy`): Postgres NO garantiza ese orden (un HashAggregate devuelve en el del hash, un scan secuencial en el físico). Con la misma siembra, ids fijos y la
 * misma versión de Postgres es estable corrida tras corrida, y es lo que este archivo fija; si una mudanza de versión mayor lo cambiara, o una mudanza de código le
 * agregara un `ORDER BY`, este archivo lo marca, y es a propósito (es un cambio de lo que ve la pantalla). Donde el CÓDIGO tiene un empate sin definir y el orden
 * de la base se nota (las alertas de stock de un mismo producto), el caso lo ordena con un criterio total para no depender del plan.
 * Regenerarlo es una decisión de producto, nunca una mudanza: `REGENERAR_CARACTERIZACION_TRAMO_A=1 npx vitest run test/caracterizacion-tramo-a/lecturas-tramo-a.test.ts`.
 * Archivo propio y no los snapshots de Vitest para que `-u` no lo pueda regenerar en silencio.
 *
 * Lo que NO se repite acá porque ya tiene su resultado completo con `toEqual` en otro test (anotado en el informe del trabajo 2.3):
 * `obtenerLimiteMesasAbiertas` (test/consultas/pos/mesas.test.ts) y el resultado de `medirPrecargadosSinGoogle` (test/auth/precargados.test.ts; acá solo
 * se fija su conteo de consultas).
 */
const ARCHIVO = join(__dirname, "lecturas-tramo-a.golden.json");
const REGENERAR = process.env.REGENERAR_CARACTERIZACION_TRAMO_A === "1";
const AHORA = new Date("2026-09-30T15:00:00.000Z");
const T0 = new Date("2026-09-30T10:00:00.000Z").getTime();
/** `t(n)`: n minutos después de las 10:00 UTC del día del escenario. */
const t = (minutos: number) => new Date(T0 + minutos * 60_000);

// ── Forma estable y conteo ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function normalizar(v: unknown): unknown {
  if (v === undefined) return "<undefined>";
  if (typeof v === "number" && !Number.isFinite(v)) return `<${v}>`;
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Date) return `<fecha ${v.toISOString()}>`;
  if (v instanceof Prisma.Decimal) return `<decimal ${v.toString()}>`;
  if (v instanceof Map) return { "<map>": [...v].map(([k, x]) => [normalizar(k), normalizar(x)]) };
  if (v instanceof Set) return { "<set>": [...v].map(normalizar) };
  if (Array.isArray(v)) return v.map(normalizar);
  const objeto = v as Record<string, unknown>;
  return Object.fromEntries(Object.keys(objeto).map((k) => [k, normalizar(objeto[k])]));
}

async function medir<T>(f: (db: Db) => Promise<T>): Promise<{ resultado: T; consultas: string[] }> {
  const consultas: string[] = [];
  const db = prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        consultas.push(model ? `${model.charAt(0).toLowerCase()}${model.slice(1)}.${operation}` : operation);
        return query(args);
      },
    },
  }) as unknown as Db;
  const resultado = await f(db);
  return { resultado, consultas };
}

function resumenDeConsultas(consultas: readonly string[]): string {
  const porTipo = new Map<string, number>();
  for (const c of consultas) porTipo.set(c, (porTipo.get(c) ?? 0) + 1);
  return `${consultas.length}: ${[...porTipo].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, n]) => `${k}×${n}`).join(", ") || "ninguna"}`;
}

type Registro = { consultas: string; resultado: unknown };
const golden: Record<string, Registro> = !REGENERAR && existsSync(ARCHIVO) ? (JSON.parse(readFileSync(ARCHIVO, "utf8")) as Record<string, Registro>) : {};
const obtenidos: Record<string, Registro> = {};
const claves: string[] = [];

/**
 * Un caso: corre la lectura contando consultas y compara `{ consultas, resultado }` entero. `soloConsultas`: el resultado ya está fijado con `toEqual` en otro
 * test (se dice cuál), acá solo se fija el conteo.
 */
function caso<T>(clave: string, f: (db: Db) => Promise<T>, opciones: { soloConsultas?: string } = {}): void {
  claves.push(clave);
  it(clave, async () => {
    const { resultado, consultas } = await medir(f);
    const actual: Registro = { consultas: resumenDeConsultas(consultas), resultado: opciones.soloConsultas ? `<resultado fijado en ${opciones.soloConsultas}>` : normalizar(resultado) };
    if (REGENERAR) {
      obtenidos[clave] = actual;
      return;
    }
    expect(golden[clave], `falta «${clave}» en lecturas-tramo-a.golden.json: generalo contra el código ANTERIOR a la mudanza`).toBeDefined();
    expect(actual).toEqual(golden[clave]);
  });
}

// ── Ids fijos del escenario ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CENTRAL = "suc-central";
const NORTE = "suc-norte";
const SUR = "suc-sur";
const MOZA = "usr-moza";
const CAJERO = "usr-cajero";

/**
 * El escenario: tres sucursales (Central con todo, Norte con poco, Sur apagada), un salón con mesas libre / con cuenta abierta (espejo de anulación,
 * borrador, cliente con descuento, descuento de producto, promo) / abierta sin ítems / con tickets (uno corregido, una venta anulada, una cuenta cerrada sin
 * venta), una carta con secciones (una apagada), géneros, contenidos, ítems agrupados (uno apagado, uno sin opciones, uno en sección apagada), precio
 * local (habilitado y no), descuentos de producto, promos (armable con cupos, informativa, apagada), portal y tema; un Kardex con lote, conteo físico y
 * movimiento posterior, stock mínimo por sección y global, árbol de grupos, una receta propia basada en una central que después cambió, y usuarios con
 * cuentas de Google (limpia, doble, ajena) y precargados.
 */
async function sembrarEscenario(): Promise<void> {
  // Sucursales, portal y tema.
  await prisma.sucursal.create({ data: { id: CENTRAL, nombre: "Central", maxMesasAbiertas: 5, creadoEn: t(-600) } });
  await prisma.sucursal.create({ data: { id: NORTE, nombre: "Norte", creadoEn: t(-600) } });
  await prisma.sucursal.create({ data: { id: SUR, nombre: "Sur", activo: false, creadoEn: t(-600) } });
  await prisma.sucursalPublica.createMany({
    data: [
      { id: "pub-central", sucursalId: CENTRAL, slug: "central", subtituloPortal: "Palermo", posX: 10, posY: 20, posW: 30, posH: 40, orden: 1, publicada: true },
      { id: "pub-norte", sucursalId: NORTE, slug: "norte", etiqueta: "Norte Express", orden: 0, publicada: true },
      { id: "pub-sur", sucursalId: SUR, slug: "sur", orden: 2, publicada: true },
    ],
  });
  await prisma.temaCartaSucursal.create({
    data: { id: "tema-central", sucursalId: CENTRAL, aplicarEnCarta: true, valores: { restaurante_nombre: "La Central", restaurante_subtitulo: "Desde 1990", inventada: "no es una clave", restaurante_descripcion: 42 } },
  });
  await prisma.portalCartaEmpresa.create({ data: { id: "portal-empresa", valores: { portal_titulo: "Nuestras sucursales", portal_header_bg: "#112233", basura: "x" } } });

  // Usuarios y cuentas de Google.
  const idToken = (email: string) => `cabecera.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.firma`;
  await prisma.user.createMany({
    data: [
      { id: MOZA, email: "moza@test.com", name: "Moza", creadoEn: t(-600) },
      { id: CAJERO, email: "cajero@test.com", creadoEn: t(-600) },
      { id: "usr-ajeno", email: "ajeno@test.com", creadoEn: t(-600) },
      { id: "usr-pendiente", email: "pendiente@test.com", creadoEn: t(-600) },
      { id: "usr-apagado", email: "apagado@test.com", activoGlobal: false, creadoEn: t(-600) },
    ],
  });
  await prisma.account.createMany({
    data: [
      { id: "acc-moza", userId: MOZA, type: "oidc", provider: "google", providerAccountId: "g-moza", id_token: idToken("moza@test.com") },
      { id: "acc-cajero-1", userId: CAJERO, type: "oidc", provider: "google", providerAccountId: "g-cajero-1", id_token: idToken("cajero@test.com") },
      { id: "acc-cajero-2", userId: CAJERO, type: "oidc", provider: "google", providerAccountId: "g-cajero-2", id_token: null },
      { id: "acc-ajeno", userId: "usr-ajeno", type: "oidc", provider: "google", providerAccountId: "g-ajeno", id_token: idToken("intruso@test.com") },
      { id: "acc-pendiente", userId: "usr-pendiente", type: "oidc", provider: "github", providerAccountId: "gh-pendiente" },
    ],
  });

  // Catálogo: unidades, categorías, grupos, insumos, productos y disponibilidad.
  await prisma.unidad.createMany({ data: [{ id: "un-u", nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 }, { id: "un-kg", nombre: "kg", magnitud: "PESO", decimales: 2 }] });
  await prisma.categoriaProducto.createMany({ data: [{ id: "cat-platos", nombre: "Platos" }, { id: "cat-bebidas", nombre: "Bebidas" }] });
  await prisma.grupo.create({ data: { id: "grp-lacteos", nombre: "Lácteos" } });
  await prisma.grupo.create({ data: { id: "grp-quesos", nombre: "Quesos", grupoPadreId: "grp-lacteos" } });
  await prisma.grupo.create({ data: { id: "grp-secos", nombre: "Secos" } });
  await prisma.insumo.createMany({ data: [{ id: "ins-queso", nombre: "Queso", grupoId: "grp-quesos" }, { id: "ins-harina", nombre: "Harina", grupoId: "grp-secos" }] });
  const producto = (id: string, nombre: string, tipo: "PV" | "MP", unidadStockId: string, extra: Partial<Prisma.ProductoUncheckedCreateInput> = {}) =>
    prisma.producto.create({ data: { id, codigo: id.toUpperCase(), nombre, tipo, unidadStockId, creadoEn: t(-500), ...extra } });
  await producto("mp-muzza", "Muzzarella", "MP", "un-kg", { insumoId: "ins-queso" });
  await producto("mp-harina", "Harina 000", "MP", "un-kg", { insumoId: "ins-harina" });
  await producto("pv-pizza", "Pizza", "PV", "un-u", { precioVenta: 12000, categoriaId: "cat-platos" });
  await producto("pv-empanada", "Empanada", "PV", "un-u", { precioVenta: 1500, pasoVenta: 0.5, categoriaId: "cat-platos" });
  await producto("pv-flan", "Flan", "PV", "un-u", { precioVenta: 3000 });
  await producto("pv-torta", "Torta", "PV", "un-u", { precioVenta: 5000, seProduce: true });
  await producto("pv-coca", "Coca-Cola 500cc", "PV", "un-u", { precioVenta: 5000, categoriaId: "cat-bebidas" });
  await producto("pv-sprite", "Sprite 500cc", "PV", "un-u", { precioVenta: 5000, categoriaId: "cat-bebidas" });
  await producto("pv-fanta", "Fanta 500cc", "PV", "un-u", { precioVenta: 5000, categoriaId: "cat-bebidas" });
  await producto("pv-jugo", "Jugo de naranja", "PV", "un-u", { precioVenta: 4000 });
  const disponibles = ["mp-muzza", "mp-harina", "pv-pizza", "pv-empanada", "pv-flan", "pv-torta", "pv-coca", "pv-sprite", "pv-jugo"];
  await prisma.disponibilidadProducto.createMany({
    data: [
      ...disponibles.map((productoId) => ({ id: `disp-c-${productoId}`, sucursalId: CENTRAL, productoId, disponible: true })),
      { id: "disp-c-pv-fanta", sucursalId: CENTRAL, productoId: "pv-fanta", disponible: false },
      { id: "disp-n-pv-pizza", sucursalId: NORTE, productoId: "pv-pizza", disponible: true },
      { id: "disp-n-pv-fanta", sucursalId: NORTE, productoId: "pv-fanta", disponible: true },
      { id: "disp-n-pv-empanada", sucursalId: NORTE, productoId: "pv-empanada", disponible: true },
      { id: "disp-s-pv-pizza", sucursalId: SUR, productoId: "pv-pizza", disponible: true },
    ],
  });

  // Recetas: la central de Pizza (v1 y después v2) y una receta PROPIA de Central basada en la v1, habilitada (la central cambió desde entonces).
  await prisma.recetaVersion.create({
    data: { id: "rv-pizza-1", productoId: "pv-pizza", version: 1, creadoEn: t(-400), ingredientes: { create: [{ id: "ri-1-muzza", insumoProductoId: "mp-muzza", cantidad: 0.25, unidadId: "un-kg" }] } },
  });
  await prisma.recetaVersion.create({
    data: {
      id: "rv-pizza-central-1",
      productoId: "pv-pizza",
      version: 1,
      sucursalId: CENTRAL,
      basadaEnVersionId: "rv-pizza-1",
      creadoEn: t(-300),
      comentarios: "Más queso",
      ingredientes: { create: [{ id: "ri-c1-muzza", insumoProductoId: "mp-muzza", cantidad: 0.3, unidadId: "un-kg", mermaPorcentaje: 5 }] },
    },
  });
  await prisma.recetaVersion.create({
    data: {
      id: "rv-pizza-2",
      productoId: "pv-pizza",
      version: 2,
      creadoEn: t(-200),
      ingredientes: { create: [{ id: "ri-2-muzza", insumoProductoId: "mp-muzza", cantidad: 0.25, unidadId: "un-kg" }, { id: "ri-2-harina", insumoProductoId: "mp-harina", cantidad: 0.2, unidadId: "un-kg" }] },
    },
  });
  await prisma.recetaSucursal.create({ data: { id: "rs-central-pizza", sucursalId: CENTRAL, productoId: "pv-pizza", habilitada: true } });

  // Secciones de stock, Kardex con lote, conteo físico y un movimiento posterior; stock mínimo.
  await prisma.seccion.createMany({
    data: [
      { id: "sec-salon", sucursalId: CENTRAL, nombre: "Salón" },
      { id: "sec-deposito", sucursalId: CENTRAL, nombre: "Depósito" },
      { id: "sec-norte", sucursalId: NORTE, nombre: "Depósito Norte" },
    ],
  });
  const operacion = (id: string, proceso: "COMPRA" | "VENTA" | "CONTROL", minuto: number, extra: Partial<Prisma.OperacionUncheckedCreateInput> = {}) =>
    prisma.operacion.create({ data: { id, sucursalId: CENTRAL, proceso, fecha: t(minuto), usuarioId: MOZA, creadoEn: t(minuto), ...extra } });
  const movimiento = (id: string, operacionId: string, minuto: number, data: Omit<Prisma.MovimientoStockUncheckedCreateInput, "id" | "operacionId" | "creadoEn" | "precioTotal" | "precioPorUnidadStock"> & { precioTotal?: number; precioPorUnidadStock?: number }) =>
    prisma.movimientoStock.create({ data: { id, operacionId, creadoEn: t(minuto), precioTotal: 0, precioPorUnidadStock: 0, ...data } });
  await operacion("op-compra", "COMPRA", -100);
  await movimiento("ms-compra-muzza", "op-compra", -100, { productoId: "mp-muzza", seccionId: "sec-deposito", proceso: "COMPRA", cantidad: 2, detalle: "COMPRA", precioTotal: 16000, precioPorUnidadStock: 8000 });
  await movimiento("ms-compra-muzza-lote", "op-compra", -100, { productoId: "mp-muzza", seccionId: "sec-salon", proceso: "COMPRA", cantidad: 0.5, detalle: "COMPRA", loteVencimiento: new Date("2026-10-04"), precioTotal: 4000, precioPorUnidadStock: 8000 });
  await movimiento("ms-compra-harina", "op-compra", -100, { productoId: "mp-harina", seccionId: "sec-deposito", proceso: "COMPRA", cantidad: 0.5, detalle: "COMPRA", precioTotal: 500, precioPorUnidadStock: 1000 });
  await prisma.conteoFisico.create({
    data: { id: "cf-muzza", sucursalId: CENTRAL, fecha: t(-50), productoId: "mp-muzza", seccionId: "sec-deposito", saldoSistema: 2, conteoReal: 1.9, diferencia: -0.1, accion: "AJUSTAR", estado: "RESUELTO", usuarioId: MOZA, creadoEn: t(-50) },
  });
  await operacion("op-control", "CONTROL", -50);
  await movimiento("ms-control-muzza", "op-control", -50, { productoId: "mp-muzza", seccionId: "sec-deposito", proceso: "CONTROL", cantidad: -0.1, detalle: "Conteo físico", conteoFisicoId: "cf-muzza" });
  await prisma.stockMinimoProducto.createMany({
    data: [
      { id: "min-muzza-global", sucursalId: CENTRAL, productoId: "mp-muzza", seccionId: null, minimo: 3 },
      { id: "min-harina-deposito", sucursalId: CENTRAL, productoId: "mp-harina", seccionId: "sec-deposito", minimo: 1 },
    ],
  });

  // Clientes, mesas y cuentas.
  await prisma.cliente.create({ data: { id: "cli-ana", nombre: "Ana", descuentoPorcentaje: 10, creadoEn: t(-600) } });
  await prisma.mesa.createMany({
    data: [
      { id: "mesa-1", sucursalId: CENTRAL, numero: 1, creadoEn: t(-600) },
      { id: "mesa-2", sucursalId: CENTRAL, numero: 2, creadoEn: t(-600) },
      { id: "mesa-3", sucursalId: CENTRAL, numero: 3, creadoEn: t(-600) },
      { id: "mesa-4", sucursalId: CENTRAL, numero: 4, creadoEn: t(-600) },
      { id: "mesa-9", sucursalId: NORTE, numero: 9, creadoEn: t(-600) },
    ],
  });
  const item = (id: string, cuentaId: string, minuto: number, data: Omit<Prisma.CuentaItemUncheckedCreateInput, "id" | "cuentaId" | "creadoEn">) =>
    prisma.cuentaItem.create({ data: { id, cuentaId, creadoEn: t(minuto), creadoPorId: MOZA, ...data } });

  // Mesa 4: dos cuentas cerradas CON venta (la segunda, con cliente; su venta de Coca anulada y el ticket reimpreso corregido) y una cerrada SIN venta.
  await prisma.cuenta.create({ data: { id: "c-cerrada-1", mesaId: "mesa-4", abiertaPorId: MOZA, abiertaEn: t(0), cerradaEn: t(20), cerradaPorId: CAJERO, comensales: 2 } });
  await operacion("op-v1", "VENTA", 20, { detalleLibre: "Mesa 4" });
  await operacion("op-v2", "VENTA", 20, { detalleLibre: "Mesa 4" });
  await movimiento("ms-v1-consumo", "op-v1", 20, { productoId: "mp-muzza", seccionId: "sec-deposito", proceso: "CONSUMO", cantidad: -0.25, detalle: 'Consumo por venta de "Pizza".' });
  await movimiento("ms-v1-venta", "op-v1", 20, { productoId: "pv-pizza", seccionId: "sec-deposito", proceso: "VENTA", cantidad: -1, detalle: "Mesa 4", precioTotal: 12000, precioPorUnidadStock: 12000, costoUnitarioVenta: 2000 });
  await movimiento("ms-v2-venta", "op-v2", 20, { productoId: "pv-flan", seccionId: "sec-salon", proceso: "VENTA", cantidad: -1, detalle: "Mesa 4", precioTotal: 3000, precioPorUnidadStock: 3000 });
  await item("it-c1-pizza", "c-cerrada-1", 1, { productoId: "pv-pizza", cantidad: 1, precioUnitario: 12000, numeroEnvio: 1, operacionId: "op-v1" });
  await item("it-c1-flan", "c-cerrada-1", 2, { productoId: "pv-flan", cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, operacionId: "op-v2" });
  await prisma.ejemplarTicket.create({ data: { id: "tk-1", sucursalId: CENTRAL, cuentaId: "c-cerrada-1", numero: 1, ejemplar: 1, emitidoEn: t(20), emitidoPorId: CAJERO } });

  await prisma.cuenta.create({ data: { id: "c-cerrada-2", mesaId: "mesa-4", abiertaPorId: CAJERO, abiertaEn: t(25), cerradaEn: t(40), cerradaPorId: CAJERO, clienteId: "cli-ana", descuentoPorcentaje: 10 } });
  await operacion("op-v3", "VENTA", 40, { detalleLibre: "Mesa 4", clienteId: "cli-ana", anuladaEn: t(45), anuladaPorId: CAJERO });
  await operacion("op-v4", "VENTA", 40, { detalleLibre: "Mesa 4", clienteId: "cli-ana" });
  await movimiento("ms-v3-venta", "op-v3", 40, { productoId: "pv-coca", seccionId: "sec-salon", proceso: "VENTA", cantidad: -2, detalle: "Mesa 4", precioTotal: 9000, precioPorUnidadStock: 4500, precioListaUnitario: 5000 });
  await movimiento("ms-v4-venta", "op-v4", 40, { productoId: "pv-empanada", seccionId: "sec-salon", proceso: "VENTA", cantidad: -1.5, detalle: "Mesa 4", precioTotal: 2025, precioPorUnidadStock: 1350, precioListaUnitario: 1500 });
  await item("it-c2-coca", "c-cerrada-2", 26, { productoId: "pv-coca", cantidad: 2, precioUnitario: 5000, numeroEnvio: 1, operacionId: "op-v3" });
  await item("it-c2-empanada", "c-cerrada-2", 27, { productoId: "pv-empanada", cantidad: 1.5, precioUnitario: 1500, numeroEnvio: 1, operacionId: "op-v4" });
  await prisma.ejemplarTicket.create({ data: { id: "tk-2a", sucursalId: CENTRAL, cuentaId: "c-cerrada-2", numero: 2, ejemplar: 1, emitidoEn: t(40), emitidoPorId: CAJERO } });
  await prisma.ejemplarTicket.create({ data: { id: "tk-2b", sucursalId: CENTRAL, cuentaId: "c-cerrada-2", numero: 2, ejemplar: 2, emitidoEn: t(46), emitidoPorId: CAJERO, corrigeAId: "tk-2a", motivo: "Se anuló la Coca" } });

  await prisma.cuenta.create({ data: { id: "c-sin-venta", mesaId: "mesa-4", abiertaPorId: MOZA, abiertaEn: t(41), cerradaEn: t(43), cerradaPorId: MOZA } });
  await item("it-sv-flan", "c-sin-venta", 42, { productoId: "pv-flan", cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 });
  await item("it-sv-flan-espejo", "c-sin-venta", 43, { productoId: "pv-flan", cantidad: -1, precioUnitario: 3000, numeroEnvio: 1, anulaAItemId: "it-sv-flan", motivoAnulacion: "Se fue" });

  // Carta: secciones, géneros, contenidos, ítems agrupados, precios locales, descuentos y promos.
  await prisma.seccionCarta.createMany({
    data: [
      { id: "sc-platos", nombre: "Platos", titulo: "Nuestros platos", descripcion: "De la casa", orden: 1 },
      { id: "sc-bebidas", nombre: "Bebidas", orden: 2 },
      { id: "sc-postres", nombre: "Postres", orden: 3 },
      { id: "sc-barra", nombre: "Barra", orden: 0, activa: false },
    ],
  });
  await prisma.generoCarta.createMany({
    data: [
      { id: "gen-veggie", sucursalId: CENTRAL, nombre: "Veggie", orden: 1, creadoEn: t(-600) },
      { id: "gen-viejo", sucursalId: CENTRAL, nombre: "Viejo", orden: 0, activo: false, creadoEn: t(-600) },
      { id: "gen-norte", sucursalId: NORTE, nombre: "Norteño", creadoEn: t(-600) },
    ],
  });
  await prisma.contenidoCartaProducto.createMany({
    data: [
      { id: "cc-pizza", sucursalId: CENTRAL, productoId: "pv-pizza", visibleEnCarta: true, seccionCartaId: "sc-platos", orden: 2, descripcion: "Muzza y orégano", tags: ["clásica", "horno"], especial: true, generoCartaId: "gen-veggie" },
      { id: "cc-empanada", sucursalId: CENTRAL, productoId: "pv-empanada", visibleEnCarta: true, seccionCartaId: "sc-platos", orden: 1, generoCartaId: "gen-viejo" },
      { id: "cc-flan", sucursalId: CENTRAL, productoId: "pv-flan", visibleEnCarta: true, seccionCartaId: "sc-postres" },
      { id: "cc-torta", sucursalId: CENTRAL, productoId: "pv-torta", visibleEnCarta: false, seccionCartaId: "sc-postres" },
      { id: "cc-jugo", sucursalId: CENTRAL, productoId: "pv-jugo", visibleEnCarta: true, seccionCartaId: "sc-barra" },
      { id: "cc-n-pizza", sucursalId: NORTE, productoId: "pv-pizza", visibleEnCarta: true, seccionCartaId: "sc-platos", generoCartaId: "gen-norte" },
      { id: "cc-n-empanada", sucursalId: NORTE, productoId: "pv-empanada", visibleEnCarta: true, seccionCartaId: "sc-platos" },
    ],
  });
  await prisma.itemAgrupadoCarta.createMany({
    data: [
      { id: "ag-gaseosa", sucursalId: CENTRAL, nombre: "Gaseosa 500cc", seccionCartaId: "sc-bebidas", orden: 1, descripcion: "Bien fría", generoCartaId: "gen-veggie", creadoEn: t(-600) },
      { id: "ag-jugos", sucursalId: CENTRAL, nombre: "Jugos", seccionCartaId: "sc-bebidas", orden: 2, activo: false, creadoEn: t(-600) },
      { id: "ag-vinos", sucursalId: CENTRAL, nombre: "Vinos", seccionCartaId: "sc-bebidas", orden: 3, creadoEn: t(-600) },
      { id: "ag-tragos", sucursalId: CENTRAL, nombre: "Tragos", seccionCartaId: "sc-barra", orden: 4, creadoEn: t(-600) },
    ],
  });
  await prisma.opcionItemAgrupadoCarta.createMany({
    data: [
      { id: "op-ag-sprite", sucursalId: CENTRAL, itemAgrupadoCartaId: "ag-gaseosa", productoId: "pv-sprite", orden: 2, creadoEn: t(-600) },
      { id: "op-ag-coca", sucursalId: CENTRAL, itemAgrupadoCartaId: "ag-gaseosa", productoId: "pv-coca", orden: 1, creadoEn: t(-600) },
      { id: "op-ag-fanta", sucursalId: CENTRAL, itemAgrupadoCartaId: "ag-gaseosa", productoId: "pv-fanta", orden: 3, creadoEn: t(-600) },
      { id: "op-ag-torta", sucursalId: CENTRAL, itemAgrupadoCartaId: "ag-tragos", productoId: "pv-torta", orden: 1, creadoEn: t(-600) },
    ],
  });
  await prisma.precioLocalProducto.createMany({
    data: [
      { id: "pl-sprite", sucursalId: CENTRAL, productoId: "pv-sprite", precio: 5200, habilitado: true },
      { id: "pl-pizza", sucursalId: CENTRAL, productoId: "pv-pizza", precio: 20000, habilitado: false },
      { id: "pl-n-pizza", sucursalId: NORTE, productoId: "pv-pizza", precio: 13000, habilitado: true },
    ],
  });
  await prisma.descuentoProductoSucursal.createMany({
    data: [
      { id: "dp-flan", sucursalId: CENTRAL, productoId: "pv-flan", porcentaje: 20 },
      { id: "dp-n-empanada", sucursalId: NORTE, productoId: "pv-empanada", porcentaje: 10 },
    ],
  });
  await prisma.promoCarta.create({
    data: {
      id: "pc-menu",
      seccionCartaId: "sc-platos",
      titulo: "Menú del día",
      descripcion: "Plato + postre",
      precio: 14000,
      orden: 1,
      creadoEn: t(-600),
      sucursales: { create: [{ id: "pcs-menu-central", sucursalId: CENTRAL, precioLocal: 13000 }, { id: "pcs-menu-norte", sucursalId: NORTE, activa: false }] },
      cupos: { create: [{ id: "cupo-platos", seccionCartaId: "sc-platos", cantidadMinima: 1, cantidadMaxima: 1, orden: 1 }, { id: "cupo-postres", seccionCartaId: "sc-postres", cantidadMinima: 0, cantidadMaxima: 1, orden: 2 }] },
    },
  });
  await prisma.promoCarta.create({ data: { id: "pc-info", seccionCartaId: "sc-bebidas", titulo: "2x1 los jueves", precio: 5000, orden: 2, creadoEn: t(-600), sucursales: { create: [{ id: "pcs-info-central", sucursalId: CENTRAL }] } } });
  await prisma.promoCarta.create({ data: { id: "pc-apagada", seccionCartaId: "sc-postres", titulo: "Vieja", precio: 1, activa: false, creadoEn: t(-600), sucursales: { create: [{ id: "pcs-apagada-central", sucursalId: CENTRAL }] } } });

  // Mesa 2: cuenta ABIERTA con cliente (10 %), Pizza ×2 y su espejo −1, Flan con descuento de producto, una Coca todavía sin enviar y una promo (envío 2).
  await prisma.cuenta.create({ data: { id: "c-abierta", mesaId: "mesa-2", abiertaPorId: MOZA, abiertaEn: t(60), comensales: 2, clienteId: "cli-ana", descuentoPorcentaje: 10 } });
  await item("it-a-pizza", "c-abierta", 61, { productoId: "pv-pizza", cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 });
  await item("it-a-pizza-espejo", "c-abierta", 62, { productoId: "pv-pizza", cantidad: -1, precioUnitario: 12000, numeroEnvio: 1, anulaAItemId: "it-a-pizza", motivoAnulacion: "Se equivocó", creadoPorId: CAJERO });
  await item("it-a-flan", "c-abierta", 63, { productoId: "pv-flan", cantidad: 1, precioUnitario: 2400, precioCartaUnitario: 3000, numeroEnvio: 1 });
  await item("it-a-coca", "c-abierta", 64, { productoId: "pv-coca", cantidad: 1, precioUnitario: 5000, numeroEnvio: null });
  await prisma.promoCuenta.create({ data: { id: "prc-menu", cuentaId: "c-abierta", promoCartaId: "pc-menu", precio: 13000, titulo: "Menú del día", creadoPorId: MOZA, creadoEn: t(65) } });
  await item("it-a-promo-pizza", "c-abierta", 65, { productoId: "pv-pizza", cantidad: 1, precioUnitario: 10400, precioCartaUnitario: 12000, numeroEnvio: 2, promoCuentaId: "prc-menu" });
  await item("it-a-promo-flan", "c-abierta", 66, { productoId: "pv-flan", cantidad: 1, precioUnitario: 2600, precioCartaUnitario: 3000, numeroEnvio: 2, promoCuentaId: "prc-menu" });
  // Mesa 3: cuenta abierta sin ítems. Mesa 9 (Norte): una cuenta abierta que Central no tiene que ver.
  await prisma.cuenta.create({ data: { id: "c-vacia", mesaId: "mesa-3", abiertaPorId: CAJERO, abiertaEn: t(70) } });
  await prisma.cuenta.create({ data: { id: "c-norte", mesaId: "mesa-9", abiertaPorId: MOZA, abiertaEn: t(71) } });
}

describe("Caracterización del tramo A (Fase 3, paso .0): resultado completo y conteo de consultas de cada lectura", () => {
  let empresa: EmpresaCarta;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    await limpiarBaseDeTest();
    await sembrarEscenario();
    const resuelta = await resolverEmpresaCarta("principal", prisma);
    if (!resuelta) throw new Error("la empresa de prueba no tiene el slug «principal»");
    empresa = resuelta;
  }, 120_000);

  afterAll(() => {
    vi.useRealTimers();
    if (REGENERAR) writeFileSync(ARCHIVO, JSON.stringify(obtenidos, null, 2) + "\n", "utf8");
  });

  describe("POS: mesas, cuenta, tickets, selector de carta y promo para agregar", () => {
    caso("pos.obtenerMapaDeMesas(Central)", (db) => obtenerMapaDeMesas(CENTRAL, db, AHORA));
    caso("pos.obtenerDetalleDeMesa(Central, mesa 2: cuenta abierta con espejo, borrador, cliente, descuento de producto y promo)", (db) => obtenerDetalleDeMesa(CENTRAL, "mesa-2", db, AHORA));
    caso("pos.obtenerDetalleDeMesa(Central, mesa 3: cuenta abierta sin ítems)", (db) => obtenerDetalleDeMesa(CENTRAL, "mesa-3", db, AHORA));
    caso("pos.obtenerDetalleDeMesa(Central, mesa 1: libre)", (db) => obtenerDetalleDeMesa(CENTRAL, "mesa-1", db, AHORA));
    caso("pos.obtenerDetalleDeMesa(Central, mesa 9 de Norte: null)", (db) => obtenerDetalleDeMesa(CENTRAL, "mesa-9", db, AHORA));
    caso("pos.obtenerTicketsRecientes(Central, mesa 4)", (db) => obtenerTicketsRecientes(CENTRAL, "mesa-4", db, undefined, AHORA));
    caso("pos.obtenerTicketsRecientes(Central, mesa 4, límite 1)", (db) => obtenerTicketsRecientes(CENTRAL, "mesa-4", db, 1, AHORA));
    caso("pos.obtenerTicketsRecientes(Norte, mesa 4 de Central: vacío)", (db) => obtenerTicketsRecientes(NORTE, "mesa-4", db, undefined, AHORA));
    caso("pos.cargarSelectorCartaDeLaMesa(Central)", (db) => cargarSelectorCartaDeLaMesa(CENTRAL, db));
    caso("pos.cargarSelectorCartaDeLaMesa(Norte)", (db) => cargarSelectorCartaDeLaMesa(NORTE, db));
    caso("pos.cargarPromoCartaParaAgregar(Central, Menú del día)", (db) => cargarPromoCartaParaAgregar(CENTRAL, "pc-menu", db));
    caso("pos.cargarPromoCartaParaAgregar(Central, informativa sin cupos: null)", (db) => cargarPromoCartaParaAgregar(CENTRAL, "pc-info", db));
    caso("pos.cargarPromoCartaParaAgregar(Norte, apagada ahí: null)", (db) => cargarPromoCartaParaAgregar(NORTE, "pc-menu", db));
  });

  describe("Carta interna: administración, ítems agrupados, grupo de un producto, portal, tema y ventas por sección", () => {
    caso("carta.cargarAdminCarta(Central)", (db) => cargarAdminCarta(CENTRAL, db));
    caso("carta.cargarAdminCarta(Norte)", (db) => cargarAdminCarta(NORTE, db));
    caso("carta.cargarAdminItemsAgrupados(Central)", (db) => cargarAdminItemsAgrupados(CENTRAL, db));
    caso("carta.resolverGrupoDeProducto(Sprite, Central)", (db) => resolverGrupoDeProducto("pv-sprite", CENTRAL, db));
    caso("carta.resolverGrupoDeProducto(Pizza, Central: suelta, null)", (db) => resolverGrupoDeProducto("pv-pizza", CENTRAL, db));
    caso("carta.cargarAdminPortal()", (db) => cargarAdminPortal(db));
    caso("carta.cargarTemaAdmin(Central)", (db) => cargarTemaAdmin(CENTRAL, db));
    caso("carta.cargarTemaAdmin(Norte: sin tema)", (db) => cargarTemaAdmin(NORTE, db));
    caso("carta.cargarTemaAdmin(inexistente: null)", (db) => cargarTemaAdmin("no-existe", db));
    caso("carta.cargarPortalEmpresaAdmin()", (db) => cargarPortalEmpresaAdmin(db));
    caso("carta.generarReporteVentasPorSeccion(Central, el día)", (db) => generarReporteVentasPorSeccion(CENTRAL, new Date("2026-09-30T00:00:00.000Z"), new Date("2026-09-30T00:00:00.000Z"), db));
  });

  describe("Carta pública: menú, empresa, portal, carta por slug y descuentos", () => {
    caso("carta.resolverMenuCartaConDiagnostico(Central)", (db) => resolverMenuCartaConDiagnostico(CENTRAL, db, AHORA));
    caso("carta.resolverMenuCartaConDiagnostico(Sur apagada: null)", (db) => resolverMenuCartaConDiagnostico(SUR, db, AHORA));
    caso("carta.resolverMenuCarta(Norte)", (db) => resolverMenuCarta(NORTE, db, AHORA));
    caso("carta.resolverEmpresaCarta(«principal»)", (db) => resolverEmpresaCarta("principal", db));
    caso("carta.resolverEmpresaCarta(«no-existe»: null)", (db) => resolverEmpresaCarta("no-existe", db));
    caso("carta.resolverPortalCarta(empresa)", (db) => resolverPortalCarta(empresa, db));
    caso("carta.resolverConfigPortal(empresa)", (db) => resolverConfigPortal(empresa, db));
    caso("carta.resolverCartaPublica(empresa, «central»)", (db) => resolverCartaPublica(empresa, "central", db, AHORA));
    caso("carta.resolverCartaPublica(empresa, «norte»: sin tema)", (db) => resolverCartaPublica(empresa, "norte", db, AHORA));
    caso("carta.resolverCartaPublica(empresa, «sur»: sucursal apagada, null)", (db) => resolverCartaPublica(empresa, "sur", db, AHORA));
    caso("carta.descuentosDeProductoEnSucursal(Central)", (db) => descuentosDeProductoEnSucursal(CENTRAL, db));
    caso("carta.descuentosConfiguradosEnSucursal(Norte)", (db) => descuentosConfiguradosEnSucursal(NORTE, db));
    caso("carta.productoTieneDescuentoEnAlgunaSucursal(Empanada)", (db) => productoTieneDescuentoEnAlgunaSucursal("pv-empanada", db));
  });

  describe("Stock: consolidado, por familia, alertas y stock mínimo", () => {
    caso("stock.calcularStockConsolidado(Central)", (db) => calcularStockConsolidado(CENTRAL, db));
    caso("stock.calcularStockPorFamilia(Central)", (db) => calcularStockPorFamilia(CENTRAL, db));
    // El desempate de las alertas de un mismo producto y estado en dos secciones lo define el código (estado, producto, sección, id: O.40 (4)); este caso fija el resultado de esa regla.
    caso("stock.calcularAlertasStock(Central)", (db) => calcularAlertasStock(CENTRAL, db));
    caso("stock.obtenerResumenAlertasStock(Central)", (db) => obtenerResumenAlertasStock(CENTRAL, db));
    caso("stock.resolverStockMinimo(Central, Harina, Depósito: el de la sección)", (db) => resolverStockMinimo(CENTRAL, "mp-harina", "sec-deposito", db));
    caso("stock.resolverStockMinimo(Central, Muzzarella, Salón: el global)", (db) => resolverStockMinimo(CENTRAL, "mp-muzza", "sec-salon", db));
  });

  describe("Catálogo: árbol de grupos y receta propia", () => {
    caso("catalogo.cargarArbolDeGrupos()", (db) => cargarArbolDeGrupos(db));
    caso("catalogo.creariaCiclo(Lácteos bajo Quesos: sí)", (db) => creariaCiclo("grp-lacteos", "grp-quesos", db));
    caso("catalogo.obtenerEstadoDeRecetaPropia(Pizza, Central: la central cambió)", (db) => obtenerEstadoDeRecetaPropia("pv-pizza", CENTRAL, db));
  });

  describe("Auth: cuentas de Google vinculadas y precargados (lecturas de los scripts)", () => {
    caso("auth.detectarCuentasDeGoogleSospechosas()", (db) => detectarCuentasDeGoogleSospechosas(db as unknown as Parameters<typeof detectarCuentasDeGoogleSospechosas>[0]));
    caso("auth.medirPrecargadosSinGoogle()", (db) => medirPrecargadosSinGoogle(db as unknown as Parameters<typeof medirPrecargadosSinGoogle>[0]), { soloConsultas: "test/auth/precargados.test.ts" });
  });

  it("el golden no tiene entradas que ningún caso use", () => {
    if (REGENERAR) return;
    expect(Object.keys(golden).sort()).toEqual([...claves].sort());
  });
});

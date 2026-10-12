import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { EMPRESA_A, SUC, crearMundoDeSucursales, sqlBueno, type MundoDeSucursales } from "./rls-sucursal-mundo";
import { guardComandoDatosDeProducto } from "../../src/core/features/catalogo/productos.guard";
import { ALCANCE_CENTRAL, whereConReceta } from "../../src/core/catalogo/public";

/**
 * P2 del Paquete 1: la LECTURA DE VERIFICACIÓN contra las políticas por sucursal REALES (las del generador, `test/setup/politicas-de-alcance-de-sucursal.ts`) en una base temporal, con el código real de la app
 * (`base.ts`, `alcance.ts` y los lectores). Hoy la base de producción NO tiene esas políticas (llegan en las migraciones B1 a B6): este archivo prueba, por adelantado, el efecto que va a tener el cambio cuando las tengan.
 *
 * Cada caso siembra el dato que contradice al control EN OTRA sucursal (a2) y mide dos cosas con un usuario cuyo alcance es solo a1:
 *  - SIN la lectura de verificación (la base de siempre, `[a1]`) el control NO ve a2 y se equivoca (es el defecto que el cambio evita);
 *  - CON ella (`lecturaDeVerificacionEnLaEmpresa`: lectura `[a1, a2, a3]`, escritura `[a1]`) lo ve y responde bien, y la ESCRITURA sigue acotada a a1 (un INSERT en a2 sigue dando 42501).
 * Mutaciones (revertidas editando): sacar el ensanche de un sitio; que `lecturaDeVerificacionEnLaEmpresa` ensanche también la escritura; que arme la lista con las sucursales de otra empresa (`b1`).
 * Si el Postgres no tiene el rol `motor2_app` (un entorno sin el paso de roles) los casos se omiten con motivo, como el resto de `test/aislamiento/rls-sucursal*`.
 */
type Base = typeof import("../../src/server/sesion/base");
type Alcance = typeof import("../../src/server/acceso/alcance");
type Cliente = import("@prisma/client").PrismaClient;

let mundo: MundoDeSucursales;
let base: Base;
let alcance: Alcance;
let prisma: Cliente;
const previo = { url: process.env.DATABASE_URL, cliente: (globalThis as { prisma?: unknown }).prisma };

/** Lo del mundo que esta prueba suma, como dueño: productos disponibles SOLO en a2, insumos, historia y una compra, todos de la empresa A. */
async function sembrarLoQueContradice(c: Client): Promise<void> {
  const insertar = async (tabla: string, fila: Record<string, unknown>) => {
    const columnas = Object.keys(fila);
    await c.query(`INSERT INTO "${tabla}" (${columnas.map((k) => `"${k}"`).join(",")}) VALUES (${columnas.map((_, i) => `$${i + 1}`).join(",")})`, columnas.map((k) => fila[k]));
  };
  const e = EMPRESA_A;
  await insertar("Unidad", { id: "uniG", empresaId: e, nombre: "Gramo", magnitud: "PESO" });
  // Un producto (MP, unidad uniA) disponible SOLO en a2.
  await insertar("Producto", { id: "soloA2", empresaId: e, codigo: "MP_SOLO_A2", nombre: "Solo Norte", tipo: "MP", unidadStockId: "uniA" });
  await insertar("DisponibilidadProducto", { id: "dispSoloA2", empresaId: e, sucursalId: SUC.a2, productoId: "soloA2", disponible: true });
  // Insumo X: su único producto disponible (uniA) está en a2. Insumo Y: un producto en otra unidad (uniG) disponible en a1.
  await insertar("Insumo", { id: "insX", empresaId: e, nombre: "Insumo X" });
  await insertar("Insumo", { id: "insY", empresaId: e, nombre: "Insumo Y" });
  await insertar("Producto", { id: "prodX", empresaId: e, codigo: "MP_X", nombre: "Producto X", tipo: "MP", unidadStockId: "uniA", insumoId: "insX" });
  await insertar("DisponibilidadProducto", { id: "dispProdX", empresaId: e, sucursalId: SUC.a2, productoId: "prodX", disponible: true });
  await insertar("Producto", { id: "prodY", empresaId: e, codigo: "MP_Y", nombre: "Producto Y", tipo: "MP", unidadStockId: "uniG", insumoId: "insY" });
  await insertar("DisponibilidadProducto", { id: "dispProdY", empresaId: e, sucursalId: SUC.a1, productoId: "prodY", disponible: true });
  // Un PV con receta central, disponible SOLO en a2.
  await insertar("Producto", { id: "pvA2", empresaId: e, codigo: "PV_A2", nombre: "Plato Norte", tipo: "PV", unidadStockId: "uniA" });
  await insertar("DisponibilidadProducto", { id: "dispPvA2", empresaId: e, sucursalId: SUC.a2, productoId: "pvA2", disponible: true });
  await insertar("RecetaVersion", { id: "rvPvA2", empresaId: e, productoId: "pvA2", version: 1, sucursalId: null });
  await insertar("RecetaIngrediente", { id: "riPvA2", empresaId: e, recetaVersionId: "rvPvA2", insumoProductoId: "ingA", cantidad: 1, unidadId: "uniA" });
  // Un producto con historia SOLO en a2 (un movimiento de la sección de a2) y otro con una liquidación de consignación SOLO en a2.
  await insertar("Producto", { id: "conHistoria", empresaId: e, codigo: "MP_HIST", nombre: "Con historia", tipo: "MP", unidadStockId: "uniA" });
  await insertar("DisponibilidadProducto", { id: "dispConHistoria", empresaId: e, sucursalId: SUC.a1, productoId: "conHistoria", disponible: true });
  await insertar("MovimientoStock", { id: "movHist", empresaId: e, operacionId: "opA2", productoId: "conHistoria", seccionId: "secA2", proceso: "COMPRA", cantidad: 1, detalle: "d" });
  await insertar("Producto", { id: "conLiquidacion", empresaId: e, codigo: "MP_LIQ", nombre: "Con liquidación", tipo: "MP", unidadStockId: "uniA" });
  await insertar("MovimientoStock", { id: "movLiq", empresaId: e, operacionId: "opA2", productoId: "conLiquidacion", seccionId: "secA2", proceso: "LIQUIDACION_CONSIGNACION", cantidad: 0, detalle: "d", precioTotal: 30, precioPorUnidadStock: 30 });
  // Una compra del proveedor P en a2 (aviso de factura repetida).
  await insertar("Proveedor", { id: "prv1", empresaId: e, codigo: "PRV1", nombre: "Proveedor 1" });
  await insertar("Operacion", { id: "opCompraA2", empresaId: e, sucursalId: SUC.a2, proceso: "COMPRA", fecha: new Date("2026-01-02T15:00:00Z"), usuarioId: "u1", proveedorId: "prv1" });
  await insertar("MovimientoStock", { id: "movCompraA2", empresaId: e, operacionId: "opCompraA2", productoId: "ingA", seccionId: "secA2", proceso: "COMPRA", cantidad: 5, detalle: "d", precioTotal: 1500, precioPorUnidadStock: 300 });
}

beforeAll(async () => {
  mundo = await crearMundoDeSucursales();
  if (!mundo.hayRol) return;
  await mundo.aplicar(sqlBueno());
  await sembrarLoQueContradice(mundo.base.cliente);
  process.env.DATABASE_URL = mundo.urlComoApp();
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  base = await import("../../src/server/sesion/base");
  alcance = await import("../../src/server/acceso/alcance");
  prisma = (await import("../../src/lib/db")).prisma;
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect().catch(() => undefined);
  if (previo.url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previo.url;
  if (previo.cliente === undefined) delete (globalThis as { prisma?: unknown }).prisma;
  else (globalThis as { prisma?: unknown }).prisma = previo.cliente;
  await mundo?.cerrar();
});

const SOLO_A1 = { lectura: [SUC.a1], escritura: [SUC.a1] };
const TODAS = [SUC.a1, SUC.a2, SUC.a3];

/** El contexto de un usuario cuyo alcance es solo a1 (lo que arma `obtenerContextoUsuario`), y el mismo con la lectura de verificación. */
async function contextos() {
  const ctx = { ...base.baseDeEmpresa(EMPRESA_A, SOLO_A1), empresaId: EMPRESA_A, usuarioId: "u1" };
  return { ctx, verificacion: await alcance.lecturaDeVerificacionEnLaEmpresa(ctx) };
}

describe("la base de verificación contra las políticas por sucursal", () => {
  it("la conexión es a la base temporal y como motor2_app (si no, nada de lo de abajo prueba lo que dice)", async (t) => {
    if (!mundo.hayRol) return t.skip();
    const r = await prisma.$queryRaw<{ base: string; rol: string }[]>`SELECT current_database() AS base, current_user AS rol`;
    expect(r[0].rol).toBe("motor2_app");
    expect(r[0].base).toMatch(/_paridad_\d+$/);
  });

  it("lee TODAS las sucursales de la empresa A (no las de B) y la escritura sigue acotada a a1: un INSERT en a2 da 42501", async (t) => {
    if (!mundo.hayRol) return t.skip();
    const { ctx, verificacion } = await contextos();
    expect(ctx.alcance).toEqual(SOLO_A1);
    expect([...(verificacion.alcance?.lectura ?? [])].sort()).toEqual(TODAS);
    expect(verificacion.alcance?.escritura).toEqual([SUC.a1]);
    expect(verificacion.alcance?.lectura).not.toContain(SUC.b1);
    // Con la lectura ampliada se ven las secciones de a1, a2 y a3 (la de a3 no tiene filas), y la escritura sigue siendo solo a1.
    expect((await verificacion.db.seccion.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((s) => s.id)).toEqual(["secA1", "secA2"]);
    expect((await ctx.db.seccion.findMany({ select: { id: true } })).map((s) => s.id)).toEqual(["secA1"]);
    const rechazo = await verificacion.db.seccion.create({ data: { id: "intruso", nombre: "intruso", sucursalId: SUC.a2 } }).then(
      () => null,
      (e: unknown) => JSON.stringify([(e as { code?: string }).code, (e as { message?: string }).message, (e as { cause?: unknown }).cause]),
    );
    expect(rechazo, "el INSERT en a2 con la base de verificación tiene que fallar").not.toBeNull();
    expect(rechazo).toMatch(/42501|row-level security/);
    // y la transacción ampliada también lee todo (su escritura está acotada igual: se probó arriba con la base)
    const enTx = await verificacion.transaccion(async (tx) => (await tx.seccion.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((s) => s.id));
    expect(enTx).toEqual(["secA1", "secA2"]);
  });

  describe("nombre repetido y unidad mezclada (validarDatosDeProducto, validarUnidadInsumo)", () => {
    it("un producto disponible SOLO en a2 con el mismo nombre: sin la verificación no se ve (el defecto), con ella se rechaza", async (t) => {
      if (!mundo.hayRol) return t.skip();
      const { validarDatosDeProducto } = await import("../../src/server/lecturas/catalogo/datos-de-producto");
      const { ctx, verificacion } = await contextos();
      const datos = { nombre: "Solo Norte", tipo: "MP" as const, unidadStockId: "uniA", factorConversion: 1 };
      const puerta = guardComandoDatosDeProducto({ datos });
      expect(await validarDatosDeProducto(ctx.db, datos, undefined, puerta)).toHaveProperty("numeros");
      expect(await validarDatosDeProducto(verificacion.db, datos, undefined, puerta)).toEqual({ error: 'Ya existe un producto disponible llamado "Solo Norte".' });
    });

    it("la unidad de un insumo cuyo producto disponible está SOLO en a2: sin la verificación el insumo parece vacío, con ella rechaza la otra unidad", async (t) => {
      if (!mundo.hayRol) return t.skip();
      const { validarUnidadInsumo } = await import("../../src/server/lecturas/catalogo/unidad-de-insumo");
      const { ctx, verificacion } = await contextos();
      expect(await validarUnidadInsumo("insX", "uniG", undefined, ctx.db)).toBeNull();
      expect(await validarUnidadInsumo("insX", "uniG", undefined, verificacion.db)).toMatch(/Este Insumo ya tiene productos disponibles con otra unidad de stock \(ej\. "Producto X" en Unidad\)/);
      // la misma unidad no es mezcla, con cualquiera de las dos bases
      expect(await validarUnidadInsumo("insX", "uniA", undefined, verificacion.db)).toBeNull();
    });

    it("fusionar insumos: el producto del origen disponible SOLO en a2 cuenta contra el destino con otra unidad", async (t) => {
      if (!mundo.hayRol) return t.skip();
      const { validarFusionInsumos } = await import("../../src/server/lecturas/catalogo/unidad-de-insumo");
      const { ctx, verificacion } = await contextos();
      expect(await validarFusionInsumos("insX", "insY", ctx.db)).toBeNull();
      expect(await validarFusionInsumos("insX", "insY", verificacion.db)).toMatch(/otra unidad de stock \(ej\. "Producto Y" en Gramo\)/);
    });
  });

  describe("receta: ingrediente disponible, lista de recetas, materias primas y sustitutos", () => {
    it("cargarDatosParaValidarReceta: un ingrediente disponible SOLO en a2 figura como disponible con la verificación y no sin ella", async (t) => {
      if (!mundo.hayRol) return t.skip();
      const { cargarDatosParaValidarReceta } = await import("../../src/server/persistencia/catalogo/cargar-datos-para-validar-receta");
      const { ctx, verificacion } = await contextos();
      const items = [{ insumoProductoId: "soloA2", cantidad: 1, unidadId: "uniA" }];
      expect([...(await cargarDatosParaValidarReceta(ctx.db, items, {})).disponiblesEnAlguna]).toEqual([]);
      expect([...(await cargarDatosParaValidarReceta(verificacion.db, items, {})).disponiblesEnAlguna]).toEqual(["soloA2"]);
    });

    it("la lista de recetas (listarProductosConReceta) incluye el plato disponible SOLO en a2 con la verificación", async (t) => {
      if (!mundo.hayRol) return t.skip();
      const { listarProductosConReceta } = await import("../../src/server/consultas/catalogo/recetas");
      const { ctx, verificacion } = await contextos();
      expect(whereConReceta(ALCANCE_CENTRAL)).toBeDefined();
      expect((await listarProductosConReceta(ctx.db)).map((p) => p.id)).not.toContain("pvA2");
      expect((await listarProductosConReceta(verificacion.db)).map((p) => p.id)).toContain("pvA2");
    });

    it("las materias primas del editor (listarMpDisponiblesEnAlguna) y los sustitutos (listarOpcionesDeSustituto) ven lo disponible SOLO en a2", async (t) => {
      if (!mundo.hayRol) return t.skip();
      const { listarMpDisponiblesEnAlguna, listarOpcionesDeSustituto } = await import("../../src/server/consultas/catalogo/recetas");
      const { ctx, verificacion } = await contextos();
      expect((await listarMpDisponiblesEnAlguna(ctx.db)).map((p) => p.id)).not.toContain("soloA2");
      expect((await listarMpDisponiblesEnAlguna(verificacion.db)).map((p) => p.id)).toContain("soloA2");
      // Sustitutos de un ingrediente en uniA: el insumo X (con un MP en uniA disponible solo en a2) es opción solo con la verificación.
      const pedido = { insumoIdExcluido: null, unidadId: "uniA" };
      expect((await listarOpcionesDeSustituto(pedido, ctx.db)).map((i) => i.id)).not.toContain("insX");
      expect((await listarOpcionesDeSustituto(pedido, verificacion.db)).map((i) => i.id)).toContain("insX");
    });

    it("el catálogo del reporte de ventas sin receta (construirMapaProductos sin sucursal) marca disponible lo que solo está en a2 con la verificación", async (t) => {
      if (!mundo.hayRol) return t.skip();
      const { construirMapaProductos } = await import("../../src/server/lecturas/reportes/comun");
      const { ctx, verificacion } = await contextos();
      expect((await construirMapaProductos(undefined, ctx.db)).get("soloA2")?.disponible).toBe(false);
      expect((await construirMapaProductos(undefined, verificacion.db)).get("soloA2")?.disponible).toBe(true);
    });
  });

  describe("CAT-1 (E1): historia y liquidaciones de un producto en otra sucursal", () => {
    it("productoTieneHistoria y productoTieneLiquidaciones: dentro de la transacción ampliada ven lo que está SOLO en a2; en la de siempre no", async (t) => {
      if (!mundo.hayRol) return t.skip();
      const { productoTieneHistoria, productoTieneLiquidaciones } = await import("../../src/server/lecturas/catalogo/historia-de-producto");
      const { ctx, verificacion } = await contextos();
      expect(await ctx.transaccion((tx) => productoTieneHistoria(tx, "conHistoria"))).toBe(false);
      expect(await verificacion.transaccion((tx) => productoTieneHistoria(tx, "conHistoria"))).toBe(true);
      expect(await ctx.transaccion((tx) => productoTieneLiquidaciones(tx, "conLiquidacion"))).toBe(false);
      expect(await verificacion.transaccion((tx) => productoTieneLiquidaciones(tx, "conLiquidacion"))).toBe(true);
    });

    it("el caso de uso de edición rechaza cambiar la unidad de stock de un producto con historia solo en a2, y el consignante de uno con liquidaciones solo en a2", async (t) => {
      if (!mundo.hayRol) return t.skip();
      const { actualizarProductoCasoDeUso } = await import("../../src/server/actions/catalogo/casos-de-uso/actualizar-producto");
      const { ctx } = await contextos();
      const comando = (productoId: string, nombre: string, cambios: Record<string, unknown>) => {
        const datos = { nombre, tipo: "MP" as const, unidadStockId: "uniA", factorConversion: 1, ...cambios };
        return { productoId, datos, puerta: guardComandoDatosDeProducto({ datos }), puedeGestionarConsignacion: true, puedeEditarCamposSensibles: true };
      };
      const unidad = await actualizarProductoCasoDeUso(ctx, comando("conHistoria", "Con historia", { unidadStockId: "uniG" }));
      expect(unidad).toMatchObject({ ok: false, codigo: "UNIDAD_CON_HISTORIA" });
      const consignante = await actualizarProductoCasoDeUso(ctx, comando("conLiquidacion", "Con liquidación", { esConsignacion: true, proveedorConsignacionId: "prv1", precioConsignacion: 5 }));
      expect(consignante).toMatchObject({ ok: false, codigo: "CONSIGNANTE_CON_HISTORIA" });
    });
  });

  describe("C25: compras candidatas del aviso de factura repetida", () => {
    it("la compra del proveedor en a2 se ve con la verificación (con el nombre de su sucursal) y no con la base de siempre", async (t) => {
      if (!mundo.hayRol) return t.skip();
      const { cargarComprasParaAvisoDeDuplicado } = await import("../../src/server/persistencia/movimientos/cargar-validaciones-de-movimiento");
      const { ctx, verificacion } = await contextos();
      const pedido = { proveedorId: "prv1", desde: "2025-12-27", hasta: "2026-01-09" };
      expect(await cargarComprasParaAvisoDeDuplicado(ctx.db, pedido)).toEqual([]);
      expect(await cargarComprasParaAvisoDeDuplicado(verificacion.db, pedido)).toEqual([
        { id: "opCompraA2", proveedorId: "prv1", sucursalId: SUC.a2, sucursalNombre: "Norte", dia: "2026-01-02", importe: 1500, anulado: false },
      ]);
    });

    it("una compra de OTRA empresa con el mismo proveedor (no existe en esta empresa) no se ve ni con la verificación", async (t) => {
      if (!mundo.hayRol) return t.skip();
      const { cargarComprasParaAvisoDeDuplicado } = await import("../../src/server/persistencia/movimientos/cargar-validaciones-de-movimiento");
      const { verificacion } = await contextos();
      // La compra de la empresa B (sucursal b1, misma factura y proveedor B) la crea el dueño; desde la empresa A ni se ve.
      await mundo.base.cliente.query(`INSERT INTO "Proveedor" ("id","empresaId","codigo","nombre") VALUES ('prvB','empB','PRVB','Proveedor B')`);
      await mundo.base.cliente.query(
        `INSERT INTO "Operacion" ("id","empresaId","sucursalId","proceso","fecha","usuarioId","proveedorId") VALUES ('opCompraB','empB','${SUC.b1}','COMPRA','2026-01-02T15:00:00Z','u1','prvB')`,
      );
      expect(await cargarComprasParaAvisoDeDuplicado(verificacion.db, { proveedorId: "prvB", desde: "2025-12-27", hasta: "2026-01-09" })).toEqual([]);
    });
  });
});

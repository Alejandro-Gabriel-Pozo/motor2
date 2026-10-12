import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { AHORA_DE_LA_CORRIDA, DIA_MS } from "../setup/tiempo";
import { conEscrituraMasAnchaQue, deVerificacion, observarAlcances } from "../setup/alcances-observados";
import { obtenerContextoUsuario, type ContextoUsuario } from "../../src/server/sesion/contexto";
import { baseDeEmpresa } from "../../src/server/sesion/base";
import { lecturaDeVerificacionEnLaEmpresa } from "../../src/server/acceso/alcance";
import { actualizarProducto, buscarProductosSelector, darDeAltaProducto, darDeAltaProductoRapido, asignarInsumoAProducto, listarProductosPagina, type DatosProducto } from "../../src/server/actions/catalogo/productos";
import { renombrarOFusionarInsumo } from "../../src/server/actions/catalogo/insumos";
import { detectarInsumosConUnidadMezclada } from "../../src/server/actions/catalogo/unidades";
import { crearEnvioDirectoDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/crear-envio-directo-de-traspaso";
import { crearSolicitudDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/crear-solicitud-de-traspaso";
import { aprobarYEnviarTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/aprobar-y-enviar-traspaso";
import { actualizarActivoSucursalCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/actualizar-activo-sucursal";
import { guardarVersionDeRecetaCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/guardar-version-de-receta";
import RecetasPage from "../../src/app/(app)/catalogo/recetas/page";
import RecetaPage from "../../src/app/(app)/catalogo/recetas/[productoId]/page";
import SinRecetaPage from "../../src/app/(app)/reportes/sin-receta/page";

/**
 * P2 del Paquete 1 (RLS por sucursal): los controles que preguntan «¿hay algo en ALGUNA sucursal?» corren con la LECTURA DE VERIFICACIÓN (`lecturaDeVerificacionEnLaEmpresa`: lectura en todas las sucursales de la empresa,
 * escritura como estaba). Postgres real, tres sucursales (A activa, B y C) y un usuario con membresía solo en A, así que su alcance es [A]/[A]. Todavía no hay políticas por sucursal (Fase B): lo que se mide es CON QUÉ
 * ALCANCE corre cada control (`test/setup/alcances-observados.ts`); el efecto con las políticas puestas lo prueba `test/aislamiento/lectura-de-verificacion-con-politicas.test.ts`.
 *
 * Cada caso siembra el dato que contradice al control EN OTRA sucursal (un producto disponible solo en B, una historia solo en B, un ingrediente disponible solo en C) y exige dos cosas: (1) el control responde bien
 * (ve la empresa entera) y (2) corrió con lectura = A, B y C y escritura = solo A; y que ninguna operación del control escribió con un alcance más ancho.
 * Mutaciones (revertidas editando): sacar `lecturaDeVerificacionEnLaEmpresa` de cada sitio; ensancharla también en escritura; llamarla sin la condición del filtro (el selector sin `soloDisponiblesEnAlguna`).
 */
const textoDe = (nodo: ReactNode): string => {
  if (nodo === null || nodo === undefined || typeof nodo === "boolean") return "";
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join(" ");
  return textoDe((nodo as { props?: { children?: ReactNode } }).props?.children);
};

describe("P2: los controles de «alguna sucursal» leen con la base de verificación", () => {
  let A: string;
  let B: string;
  let C: string;
  let TODAS: string[];
  let adminId: string;
  let kgId: string;
  let gId: string;
  let insumoId: string;
  let ctx: ContextoUsuario;
  let obs: ReturnType<typeof observarAlcances>;

  /** Un producto que SOLO está disponible en la sucursal `donde`. */
  const productoSoloEn = async (donde: string, data: { codigo: string; nombre: string; tipo?: "MP" | "PV"; unidadStockId?: string; insumoId?: string }) => {
    const p = await prisma.producto.create({ data: { tipo: "MP", unidadStockId: kgId, ...data } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: donde, productoId: p.id, disponible: true } });
    return p;
  };
  const verificacion = () => deVerificacion(obs.vistos(), TODAS, [A]);
  const sinEscrituraAncha = () => conEscrituraMasAnchaQue(obs.vistos(), [A]);

  beforeEach(async () => {
    vi.restoreAllMocks();
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
    const base = await sembrarBase();
    A = base.sucursal.id;
    B = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    C = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;
    TODAS = [A, B, C];
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    insumoId = catalogo.insumo.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: A, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    ctx = (await obtenerContextoUsuario())!;
    expect(ctx.alcance).toEqual({ lectura: [A], escritura: [A] });
    obs = observarAlcances();
  });

  afterEach(() => obs.restaurar());

  describe("la función: lecturaDeVerificacionEnLaEmpresa", () => {
    const variables = async (db: ContextoUsuario["db"]) =>
      (await (db.$queryRaw as unknown as (q: TemplateStringsArray) => Promise<{ lectura: string | null; escritura: string | null }[]>)`SELECT current_setting('app.sucursales_lectura', true) AS lectura, current_setting('app.sucursales_escritura', true) AS escritura`)[0]!;
    const lista = (v: string | null) => (v ? v.split(",").sort() : []);

    it("devuelve un contexto NUEVO que lee A, B y C y escribe solo en A (la base se rearma con esas listas); el original no cambia", async () => {
      const ampliado = await lecturaDeVerificacionEnLaEmpresa(ctx);
      expect(ampliado.alcance).toEqual({ lectura: expect.arrayContaining(TODAS), escritura: [A] });
      expect([...(ampliado.alcance?.lectura ?? [])].sort()).toEqual([...TODAS].sort());
      expect(ctx.alcance).toEqual({ lectura: [A], escritura: [A] });
      expect(ampliado.db).not.toBe(ctx.db);
      const vistas = await variables(ampliado.db);
      expect([lista(vistas.lectura), lista(vistas.escritura)]).toEqual([[...TODAS].sort(), [A]]);
      expect(await ampliado.transaccion((tx) => tx.$queryRaw<{ l: string }[]>`SELECT current_setting('app.sucursales_escritura', true) AS l`)).toEqual([{ l: A }]);
      // lo demás del contexto queda igual
      expect(ampliado.usuarioId).toBe(ctx.usuarioId);
      expect(ampliado.empresaId).toBe(ctx.empresaId);
    });

    it("pide SOLO las sucursales de la empresa del contexto (nunca las de otra) y no repite las que ya lee", async () => {
      const findMany = vi.fn(async () => [{ id: "s1" }, { id: "s2" }, { id: "s3" }]);
      const falso = { ...ctx, ...baseDeEmpresa(ctx.empresaId, { lectura: ["s2"], escritura: ["s2"] }), db: { sucursal: { findMany } } as never };
      const ampliado = await lecturaDeVerificacionEnLaEmpresa(falso);
      expect(findMany).toHaveBeenCalledWith({ where: { empresaId: ctx.empresaId }, select: { id: true }, orderBy: { id: "asc" } });
      expect([...(ampliado.alcance?.lectura ?? [])].sort()).toEqual(["s1", "s2", "s3"]);
      expect(ampliado.alcance?.escritura).toEqual(["s2"]);
    });

    it("si el alcance ya lee todas las sucursales devuelve el MISMO contexto, y uno sin alcance (armado a mano) no se ensancha ni lee nada", async () => {
      const ya = await lecturaDeVerificacionEnLaEmpresa(ctx);
      expect(await lecturaDeVerificacionEnLaEmpresa(ya)).toBe(ya);
      const findMany = vi.fn(async () => [{ id: A }]);
      const sinAlcance = { ...ctx, ...baseDeEmpresa(ctx.empresaId), alcance: undefined, db: { sucursal: { findMany } } as never };
      expect(await lecturaDeVerificacionEnLaEmpresa(sinAlcance)).toBe(sinAlcance);
      expect(findMany).not.toHaveBeenCalled();
    });

    it("las sucursales de OTRA empresa nunca entran a la lista: B y C son de esta empresa, la de la empresa testigo no", async () => {
      const ajena = (await prismaAdmin.sucursal.create({ data: { empresaId: (await prismaAdmin.empresa.create({ data: { id: "empresa_otra_vd", nombre: "Otra", slug: "otra-vd", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } })).id, nombre: "De otra empresa" } })).id;
      const ampliado = await lecturaDeVerificacionEnLaEmpresa(ctx);
      expect(ampliado.alcance?.lectura).not.toContain(ajena);
      expect([...(ampliado.alcance?.lectura ?? [])].sort()).toEqual([...TODAS].sort());
    });
  });

  describe("nombre repetido de un producto disponible", () => {
    it("alta completa: un producto disponible solo en B con ese nombre se rechaza; el control lee toda la empresa y no escribe fuera de la activa", async () => {
      await productoSoloEn(B, { codigo: "MP_HARINA", nombre: "Harina" });
      obs.limpiar();
      expect(await darDeAltaProducto({ nombre: "harina", tipo: "MP", unidadStockId: kgId, factorConversion: 1 })).toMatchObject({ ok: false, mensaje: 'Ya existe un producto disponible llamado "harina".' });
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });

    it("alta rápida: lo mismo, y tampoco ensancha la escritura cuando rechaza", async () => {
      await productoSoloEn(B, { codigo: "MP_HARINA", nombre: "Harina" });
      obs.limpiar();
      expect(await darDeAltaProductoRapido("HARINA", kgId)).toMatchObject({ ok: false, mensaje: 'Ya existe un producto disponible llamado "HARINA".' });
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });

    it("edición: renombrar a un nombre de un producto disponible solo en C se rechaza (la transacción lee toda la empresa y solo escribe en la activa)", async () => {
      await productoSoloEn(C, { codigo: "MP_AZUCAR", nombre: "Azúcar" });
      const sal = await sembrarProductoDisponible({ codigo: "MP_SAL", nombre: "Sal", tipo: "MP", unidadStockId: kgId }, A);
      obs.limpiar();
      expect(await actualizarProducto(sal.id, datosDe({ nombre: "Azúcar", unidadStockId: kgId }))).toMatchObject({ ok: false, mensaje: 'Ya existe un producto disponible llamado "Azúcar".' });
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });
  });

  describe("unidad de stock mezclada en un insumo (no hay restricción en la base: es integridad real)", () => {
    it("alta con un insumo cuyo otro producto disponible (solo en B) tiene otra unidad: se rechaza", async () => {
      await productoSoloEn(B, { codigo: "MP_HARINA_000", nombre: "Harina 000", insumoId });
      obs.limpiar();
      const r = await darDeAltaProducto({ nombre: "Harina 0000", tipo: "MP", unidadStockId: gId, factorConversion: 1, insumoId });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/Este Insumo ya tiene productos disponibles con otra unidad de stock \(ej\. "Harina 000" en kg\)/);
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });

    it("asignar el insumo a una materia prima ya existente: mismo control", async () => {
      await productoSoloEn(B, { codigo: "MP_HARINA_000", nombre: "Harina 000", insumoId });
      const sal = await sembrarProductoDisponible({ codigo: "MP_SAL", nombre: "Sal", tipo: "MP", unidadStockId: gId }, A);
      obs.limpiar();
      const r = await asignarInsumoAProducto(sal.id, insumoId);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/otra unidad de stock/);
      expect(await prisma.producto.findUniqueOrThrow({ where: { id: sal.id } })).toMatchObject({ insumoId: null });
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });

    it("«insumos con unidad mezclada»: un insumo con productos en kg (en A) y en g (solo en B) aparece, con las dos unidades", async () => {
      await sembrarProductoDisponible({ codigo: "MP_H_KG", nombre: "Harina kg", tipo: "MP", unidadStockId: kgId, insumoId }, A);
      await productoSoloEn(B, { codigo: "MP_H_G", nombre: "Harina g", unidadStockId: gId, insumoId });
      obs.limpiar();
      const r = await detectarInsumosConUnidadMezclada();
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.datos).toEqual([{ insumo: "Harina", unidades: expect.arrayContaining(["kg", "g"]), cantidadProductos: 2 }]);
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });
  });

  describe("fusión de insumos", () => {
    it("fusionar un insumo cuyo producto (disponible solo en B) está en kg con uno que tiene productos en g se rechaza", async () => {
      const integral = await prisma.insumo.create({ data: { nombre: "Harina integral" } });
      await productoSoloEn(B, { codigo: "MP_H_KG", nombre: "Harina kg", unidadStockId: kgId, insumoId });
      await sembrarProductoDisponible({ codigo: "MP_I_G", nombre: "Integral g", tipo: "MP", unidadStockId: gId, insumoId: integral.id }, A);
      obs.limpiar();
      const r = await renombrarOFusionarInsumo(insumoId, "Harina integral", true);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/otra unidad de stock/);
      expect(await prisma.insumo.count()).toBe(2);
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });

    it("un simple renombre (sin fusión) no ensancha nada", async () => {
      obs.limpiar();
      expect((await renombrarOFusionarInsumo(insumoId, "Harina de trigo")).ok).toBe(true);
      expect(verificacion()).toEqual([]);
    });
  });

  describe("selector de producto y contador del listado", () => {
    it("el selector con `soloDisponiblesEnAlguna` trae un producto disponible solo en B y lee toda la empresa; sin el filtro no ensancha nada", async () => {
      await productoSoloEn(B, { codigo: "MP_HARINA", nombre: "Harina" });
      obs.limpiar();
      expect((await buscarProductosSelector("", { soloDisponiblesEnAlguna: true })).map((p) => p.nombre)).toEqual(["Harina"]);
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);

      obs.limpiar();
      await buscarProductosSelector("", { soloDisponibles: true });
      expect(verificacion()).toEqual([]);
    });

    it("el contador «Sucursales N de M» cuenta B aunque la activa sea A: N = 2 disponibles de M = 3", async () => {
      const queso = await sembrarProductoDisponible({ codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: kgId }, A);
      await prisma.disponibilidadProducto.create({ data: { sucursalId: B, productoId: queso.id, disponible: true } });
      obs.limpiar();
      const pagina = await listarProductosPagina();
      expect(pagina.items).toMatchObject([{ nombre: "Queso", disponibleAca: true, sucursalesDisponibles: 2, totalSucursales: 3 }]);
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });
  });

  describe("CAT-1: historia y liquidaciones de un producto (E1)", () => {
    let quesoId: string;
    let seccionB: string;
    beforeEach(async () => {
      quesoId = (await sembrarProductoDisponible({ codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: kgId, unidadCompraId: gId, factorConversion: 25 }, A)).id;
      seccionB = (await sembrarSeccion(B, "Depósito Norte")).id;
    });
    const movimientoEnB = async (proceso: "COMPRA" | "LIQUIDACION_CONSIGNACION") => {
      const op = await prisma.operacion.create({ data: { sucursalId: B, proceso: proceso === "COMPRA" ? "COMPRA" : "VENTA", fecha: new Date(AHORA_DE_LA_CORRIDA.getTime() - 5 * DIA_MS), usuarioId: adminId } });
      // La compra suma stock (+1); la liquidación de consignación no mueve stock (0) y lleva el importe liquidado, como exige el CHECK de signo por proceso del Kardex.
      await prisma.movimientoStock.create({
        data: { operacionId: op.id, productoId: quesoId, seccionId: seccionB, proceso, cantidad: proceso === "COMPRA" ? 1 : 0, detalle: "x", ...(proceso === "COMPRA" ? {} : { precioTotal: 30, precioPorUnidadStock: 30 }) },
      });
    };

    it("cambiar la unidad de stock de un producto con historia SOLO en B se rechaza; la transacción lee toda la empresa y escribe solo en la activa", async () => {
      await movimientoEnB("COMPRA");
      obs.limpiar();
      const r = await actualizarProducto(quesoId, datosDe({ nombre: "Queso", unidadStockId: gId, unidadCompraId: gId, factorConversion: 25 }));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/La unidad de stock no se puede cambiar/);
      expect((await prisma.producto.findUniqueOrThrow({ where: { id: quesoId } })).unidadStockId).toBe(kgId);
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });

    it("cambiar el consignante de un producto con liquidaciones SOLO en B se rechaza", async () => {
      await movimientoEnB("LIQUIDACION_CONSIGNACION");
      const proveedor = await prisma.proveedor.create({ data: { codigo: "PROV_A", nombre: "Lácteos A" } });
      obs.limpiar();
      const r = await actualizarProducto(quesoId, datosDe({ nombre: "Queso", unidadStockId: kgId, unidadCompraId: gId, factorConversion: 25, esConsignacion: true, proveedorConsignacionId: proveedor.id, precioConsignacion: 10 }));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/El consignante no se puede cambiar/);
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });

    it("una edición común (sin historia) sigue funcionando con la transacción ampliada, y la auditoría y el update escriben solo en la activa", async () => {
      obs.limpiar();
      expect((await actualizarProducto(quesoId, datosDe({ nombre: "Queso cremoso", unidadStockId: kgId, unidadCompraId: gId, factorConversion: 25 }))).ok).toBe(true);
      expect((await prisma.producto.findUniqueOrThrow({ where: { id: quesoId } })).nombre).toBe("Queso cremoso");
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });
  });

  describe("receta: el ingrediente está disponible en alguna sucursal", () => {
    let pizzaId: string;
    let harinaId: string;
    beforeEach(async () => {
      pizzaId = (await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, A)).id;
      harinaId = (await productoSoloEn(C, { codigo: "MP_HARINA", nombre: "Harina" })).id;
    });
    const comando = () => ({ productoId: pizzaId, items: [{ insumoProductoId: harinaId, cantidad: 0.3, unidadId: kgId }], pasos: [], cabecera: {}, versionEsperada: null });

    it("un ingrediente disponible solo en C vale: se guarda la receta central (la verificación va antes del ensanche de escritura)", async () => {
      obs.limpiar();
      expect((await guardarVersionDeRecetaCasoDeUso(ctx, comando())).ok).toBe(true);
      expect(verificacion().length).toBeGreaterThan(0);
    });

    it("receta PROPIA de la sucursal activa: también verifica en toda la empresa y no ensancha NUNCA la escritura", async () => {
      obs.limpiar();
      expect((await guardarVersionDeRecetaCasoDeUso(ctx, comando(), { sucursalId: A, habilitadaEsperada: false })).ok).toBe(true);
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });
  });

  describe("traspasos entre sucursales: ¿el producto está disponible en la OTRA punta?", () => {
    let harinaId: string;
    let seccionA: string;
    let seccionB: string;
    const conLaHora = () => ({ ...ctx, ahora: AHORA_DE_LA_CORRIDA });
    beforeEach(async () => {
      harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kgId }, A)).id;
      await prisma.disponibilidadProducto.create({ data: { sucursalId: B, productoId: harinaId, disponible: true } });
      seccionA = (await sembrarSeccion(A, "Depósito Central")).id;
      seccionB = (await sembrarSeccion(B, "Depósito Norte")).id;
      // Stock en A para poder enviar.
      const compra = await prisma.operacion.create({ data: { sucursalId: A, proceso: "COMPRA", fecha: new Date(AHORA_DE_LA_CORRIDA.getTime() - 3 * DIA_MS), usuarioId: adminId } });
      await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId: harinaId, seccionId: seccionA, proceso: "COMPRA", cantidad: 10, detalle: "x" } });
      obs.limpiar();
    });

    it("envío directo A → B: la transacción SERIALIZABLE lee toda la empresa (para ver la disponibilidad en B) y escribe solo en A", async () => {
      const r = await crearEnvioDirectoDeTraspasoCasoDeUso(conLaHora(), { destinoSucursalId: B, productoId: harinaId, cantidad: 4, seccionOrigenId: seccionA, detalle: null });
      expect(r.ok, r.mensaje).toBe(true);
      expect(deVerificacion(obs.transacciones(), TODAS, [A]).length).toBeGreaterThan(0);
      expect(conEscrituraMasAnchaQue(obs.vistos(), [A])).toEqual([]);
    });

    it("el producto NO disponible en la otra punta sigue rechazándose con el mismo texto (la verificación no cambia la regla)", async () => {
      await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: B, productoId: harinaId } }, data: { disponible: false } });
      const r = await crearEnvioDirectoDeTraspasoCasoDeUso(conLaHora(), { destinoSucursalId: B, productoId: harinaId, cantidad: 4, seccionOrigenId: seccionA, detalle: null });
      expect(r).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_TRANSFERIBLE", mensaje: "«Harina» no está disponible en «Norte»: activalo allá antes de enviar." });
      expect(await prisma.traspasoSucursal.count()).toBe(0);
    });

    it("solicitud A pide a B: lo mismo, con la disponibilidad del ORIGEN", async () => {
      const r = await crearSolicitudDeTraspasoCasoDeUso(conLaHora(), { origenSucursalId: B, productoId: harinaId, cantidad: 2, seccionDestinoId: seccionA, detalle: null });
      expect(r.ok, r.mensaje).toBe(true);
      expect(deVerificacion(obs.transacciones(), TODAS, [A]).length).toBeGreaterThan(0);
      expect(conEscrituraMasAnchaQue(obs.vistos(), [A])).toEqual([]);
    });

    it("aprobar y enviar una solicitud de B a A: lee la disponibilidad en B (destino) con toda la empresa", async () => {
      const solicitud = await prisma.traspasoSucursal.create({ data: { origenSucursalId: A, destinoSucursalId: B, productoId: harinaId, cantidad: 3, seccionDestinoId: seccionB, iniciadoPor: "DESTINO", estado: "SOLICITADA", creadoPorId: adminId } });
      obs.limpiar();
      const r = await aprobarYEnviarTraspasoCasoDeUso(conLaHora(), { traspasoId: solicitud.id, seccionOrigenId: seccionA });
      expect(r.ok, r.mensaje).toBe(true);
      expect(deVerificacion(obs.transacciones(), TODAS, [A]).length).toBeGreaterThan(0);
      expect(conEscrituraMasAnchaQue(obs.vistos(), [A])).toEqual([]);
    });
  });

  describe("apagar una sucursal (P15): los pendientes de la que se apaga", () => {
    it("un traspaso en camino ENTRE B y C (que quien apaga desde A no ve con su alcance) bloquea apagar B; la transacción de gobierno lee toda la empresa y escribe solo en A", async () => {
      const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kgId }, A);
      await prisma.traspasoSucursal.create({ data: { origenSucursalId: C, destinoSucursalId: B, productoId: harina.id, cantidad: 4, iniciadoPor: "ORIGEN", estado: "ENVIADA", creadoPorId: adminId } });
      obs.limpiar();
      const r = await actualizarActivoSucursalCasoDeUso(ctx, { sucursalId: B, activo: false });
      expect(r).toMatchObject({ ok: false, codigo: "TIENE_PENDIENTES" });
      expect(r.mensaje).toContain('recibí o rechazá el traspaso de 4 kg de "Harina" que mandó "Sur"');
      expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: B } })).activo).toBe(true);
      expect(deVerificacion(obs.transacciones(), TODAS, [A]).length).toBeGreaterThan(0);
      expect(conEscrituraMasAnchaQue(obs.vistos(), [A])).toEqual([]);
    });

    it("sin pendientes se apaga igual, y reactivar no mira nada", async () => {
      expect(await actualizarActivoSucursalCasoDeUso(ctx, { sucursalId: B, activo: false })).toMatchObject({ ok: true });
      expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: B } })).activo).toBe(false);
      expect(await actualizarActivoSucursalCasoDeUso(ctx, { sucursalId: B, activo: true })).toMatchObject({ ok: true });
    });
  });

  describe("pantallas de recetas y reporte de ventas sin receta", () => {
    let pizzaId: string;
    let harinaId: string;
    beforeEach(async () => {
      pizzaId = (await productoSoloEn(B, { codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kgId })).id;
      harinaId = (await productoSoloEn(C, { codigo: "MP_HARINA", nombre: "Harina" })).id;
      expect((await guardarVersionDeRecetaCasoDeUso(ctx, { productoId: pizzaId, items: [{ insumoProductoId: harinaId, cantidad: 0.3, unidadId: kgId }], pasos: [], cabecera: {}, versionEsperada: null })).ok).toBe(true);
      obs.limpiar();
    });

    it("la lista de recetas muestra un producto disponible solo en B y lee toda la empresa", async () => {
      expect(textoDe(await RecetasPage())).toContain("Pizza");
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });

    it("el editor de la receta lee las materias primas Y los sustitutos (una lectura de cada una) con toda la empresa; el usuario solo ve A en lo demás", async () => {
      await RecetaPage({ params: Promise.resolve({ productoId: pizzaId }), searchParams: Promise.resolve({}) });
      // Dos lecturas de verificación: `listarMpDisponiblesEnAlguna` (una) y `listarOpcionesDeSustituto` (una por ingrediente: la receta tiene uno). Si falta cualquiera de las dos, hay menos.
      expect(verificacion().length).toBeGreaterThanOrEqual(2);
      expect(sinEscrituraAncha()).toEqual([]);
    });

    it("ventas sin receta: el catálogo del reporte se lee con toda la empresa y las ventas con la base de siempre", async () => {
      // Una venta de la sucursal activa sin receta (sin CONSUMO): el reporte solo arma el catálogo de productos cuando hay ventas que mostrar.
      const platoId = (await sembrarProductoDisponible({ codigo: "PV_PLATO", nombre: "Plato", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, A)).id;
      const seccionA = (await sembrarSeccion(A, "Salón")).id;
      const venta = await prisma.operacion.create({ data: { sucursalId: A, proceso: "VENTA", fecha: new Date(AHORA_DE_LA_CORRIDA.getTime() - 2 * DIA_MS), usuarioId: adminId } });
      await prisma.movimientoStock.create({ data: { operacionId: venta.id, productoId: platoId, seccionId: seccionA, proceso: "VENTA", cantidad: -1, detalle: "x" } });
      obs.limpiar();
      expect(textoDe(await SinRecetaPage())).toBeDefined();
      expect(verificacion().length).toBeGreaterThan(0);
      expect(sinEscrituraAncha()).toEqual([]);
    });
  });
});

/** Los datos que manda el formulario de edición de un producto (los mínimos de un MP), con los cambios pedidos encima. */
function datosDe(cambios: Partial<DatosProducto> & Pick<DatosProducto, "nombre" | "unidadStockId">): DatosProducto {
  return { tipo: "MP", factorConversion: 1, ...cambios };
}

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// Los efectos de Next se CUENTAN (no se ejecutan): un rechazo no refresca la vista ni revalida la carta pública.
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { refresh } from "next/cache";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { actualizarActivaCategoriaProducto } from "../../src/server/actions/catalogo/categorias-producto";
import { actualizarActivoGrupo, actualizarActivoInsumo, actualizarGrupoDeInsumo } from "../../src/server/actions/catalogo/insumos";
import { actualizarActivaPresentacion } from "../../src/server/actions/catalogo/productos";
import { actualizarActivaProveedor } from "../../src/server/actions/catalogo/proveedores";
import { actualizarActivaUnidad } from "../../src/server/actions/catalogo/unidades";
import { actualizarActivoCliente } from "../../src/server/actions/clientes/cliente";
import { actualizarActivoDestinoConsumo, actualizarActivoMotivoMerma } from "../../src/server/actions/movimientos/motivos";
import { actualizarActivaSeccion } from "../../src/server/actions/movimientos/secciones";
import { actualizarActivaPromoCarta, actualizarActivaPromoCartaEnSucursal } from "../../src/server/actions/carta/promos";

/**
 * O.44 (Hito 4, bloque D; arreglo aprobado por el dueño, `docs/pureza-integracion.md`): TODAS las acciones del catálogo, la carta y el stock que activan o
 * desactivan un registro por id (las que pasan por un caso de uso de `src/server/actions/<dominio>/casos-de-uso/`) devuelven su «no encontrado» con un id que no
 * existe o que es de OTRA empresa (invisible por RLS), sin escribir nada, sin auditar y sin refrescar la vista ni revalidar la carta pública. Antes, seis de
 * ellas (categoría, grupo, insumo, presentación, unidad y proveedor) hacían lanzar a Prisma (`update` sobre un id inexistente: un 500 sin tipar); las otras seis
 * ya leían la fila antes y se fijan acá con el mismo molde.
 *
 * Las seis arregladas escriben con `updateMany` (atómico, sin una lectura más) y miran `count === 0`. En un `where` de `updateMany` un id `undefined` o un objeto
 * (`{ not: "x" }`) no significa «ningún id» sino «todas las filas» (S-07): la persistencia descarta lo que no es texto antes de escribir. El último caso lo fija.
 */

/** Las tablas que estas acciones podrían tocar, leídas con el dueño (todas las empresas), para ver que un rechazo no cambió NINGUNA fila. */
async function foto() {
  const orden = { orderBy: { id: "asc" as const } };
  return {
    categorias: await prismaAdmin.categoriaProducto.findMany(orden),
    grupos: await prismaAdmin.grupo.findMany(orden),
    insumos: await prismaAdmin.insumo.findMany(orden),
    presentaciones: await prismaAdmin.presentacion.findMany(orden),
    unidades: await prismaAdmin.unidad.findMany(orden),
    proveedores: await prismaAdmin.proveedor.findMany(orden),
    clientes: await prismaAdmin.cliente.findMany(orden),
    motivos: await prismaAdmin.motivoMerma.findMany(orden),
    destinos: await prismaAdmin.destinoConsumo.findMany(orden),
    secciones: await prismaAdmin.seccion.findMany(orden),
    promos: await prismaAdmin.promoCarta.findMany(orden),
    promosSucursal: await prismaAdmin.promoCartaSucursal.findMany({ orderBy: [{ promoCartaId: "asc" }, { sucursalId: "asc" }] }),
    auditoria: await prismaAdmin.registroAuditoria.count(),
  };
}

/** Siembra en la empresa TESTIGO (otra empresa) una fila de cada tabla, todas activas: un id de acá es «ajeno» para el admin de la empresa de prueba. */
async function sembrarAjenas() {
  const empresaId = EMPRESA_TESTIGO_ID;
  const sucursal = await prismaAdmin.sucursal.create({ data: { empresaId, nombre: "Sucursal ajena" } });
  const unidad = await prismaAdmin.unidad.create({ data: { empresaId, nombre: "unidad ajena", magnitud: "CANTIDAD" } });
  const caja = await prismaAdmin.unidad.create({ data: { empresaId, nombre: "caja ajena", magnitud: "CANTIDAD" } });
  const producto = await prismaAdmin.producto.create({ data: { empresaId, codigo: "MP_AJENO", nombre: "Harina ajena", tipo: "MP", unidadStockId: unidad.id } });
  const seccionCarta = await prismaAdmin.seccionCarta.create({ data: { empresaId, nombre: "Platos ajenos" } });
  return {
    categoria: (await prismaAdmin.categoriaProducto.create({ data: { empresaId, nombre: "Categoría ajena" } })).id,
    grupo: (await prismaAdmin.grupo.create({ data: { empresaId, nombre: "Grupo ajeno" } })).id,
    insumo: (await prismaAdmin.insumo.create({ data: { empresaId, nombre: "Insumo ajeno" } })).id,
    presentacion: (await prismaAdmin.presentacion.create({ data: { empresaId, productoId: producto.id, unidadCompraId: caja.id, factorConversion: 10 } })).id,
    unidad: unidad.id,
    proveedor: (await prismaAdmin.proveedor.create({ data: { empresaId, codigo: "PRV-AJENO", nombre: "Proveedor ajeno" } })).id,
    cliente: (await prismaAdmin.cliente.create({ data: { empresaId, nombre: "Cliente ajeno", descuentoPorcentaje: 0 } })).id,
    motivo: (await prismaAdmin.motivoMerma.create({ data: { empresaId, nombre: "Motivo ajeno" } })).id,
    destino: (await prismaAdmin.destinoConsumo.create({ data: { empresaId, nombre: "Destino ajeno" } })).id,
    seccion: (await prismaAdmin.seccion.create({ data: { empresaId, sucursalId: sucursal.id, nombre: "Depósito ajeno" } })).id,
    promo: (await prismaAdmin.promoCarta.create({ data: { empresaId, seccionCartaId: seccionCarta.id, titulo: "Promo ajena", precio: 1000, sucursales: { create: { sucursalId: sucursal.id } } } })).id,
  };
}

type Ajenas = Awaited<ReturnType<typeof sembrarAjenas>>;

interface Caso {
  accion: string;
  /** Desactiva (el rechazo tiene que llegar igual con `true`; se prueba con `false`, el clic más común). */
  llamar: (id: string) => Promise<unknown>;
  mensaje: string;
  ajena: keyof Ajenas;
  /** Una de las seis que antes hacían lanzar a Prisma (escriben con `updateMany` y descartan el id que no es texto: S-07). */
  arreglada: boolean;
}

const CASOS: Caso[] = [
  { accion: "actualizarActivaCategoriaProducto", llamar: (id) => actualizarActivaCategoriaProducto(id, false), mensaje: "No se encontró la categoría.", ajena: "categoria", arreglada: true },
  { accion: "actualizarActivoGrupo", llamar: (id) => actualizarActivoGrupo(id, false), mensaje: "No se encontró el grupo.", ajena: "grupo", arreglada: true },
  { accion: "actualizarActivoInsumo", llamar: (id) => actualizarActivoInsumo(id, false), mensaje: "No se encontró el insumo.", ajena: "insumo", arreglada: true },
  { accion: "actualizarActivaPresentacion", llamar: (id) => actualizarActivaPresentacion(id, false), mensaje: "No se encontró la presentación.", ajena: "presentacion", arreglada: true },
  { accion: "actualizarActivaUnidad", llamar: (id) => actualizarActivaUnidad(id, false), mensaje: "No se encontró la unidad.", ajena: "unidad", arreglada: true },
  { accion: "actualizarActivaProveedor", llamar: (id) => actualizarActivaProveedor(id, false), mensaje: "No se encontró ese proveedor.", ajena: "proveedor", arreglada: true },
  { accion: "actualizarActivoCliente", llamar: (id) => actualizarActivoCliente(id, false), mensaje: "No se encontró ese cliente.", ajena: "cliente", arreglada: false },
  { accion: "actualizarActivoMotivoMerma", llamar: (id) => actualizarActivoMotivoMerma(id, false), mensaje: "No se encontró el motivo.", ajena: "motivo", arreglada: false },
  { accion: "actualizarActivoDestinoConsumo", llamar: (id) => actualizarActivoDestinoConsumo(id, false), mensaje: "No se encontró el destino.", ajena: "destino", arreglada: false },
  { accion: "actualizarActivaSeccion", llamar: (id) => actualizarActivaSeccion(id, false), mensaje: "No se encontró la sección.", ajena: "seccion", arreglada: false },
  { accion: "actualizarActivaPromoCarta", llamar: (id) => actualizarActivaPromoCarta(id, false), mensaje: "No se encontró la promo.", ajena: "promo", arreglada: false },
  { accion: "actualizarActivaPromoCartaEnSucursal", llamar: (id) => actualizarActivaPromoCartaEnSucursal(id, false), mensaje: "No se encontró la promo.", ajena: "promo", arreglada: false },
];

describe("O.44: activar o desactivar con un id que no existe o es ajeno", () => {
  let ajenas: Ajenas;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    ajenas = await sembrarAjenas();
    vi.mocked(refresh).mockClear();
    vi.mocked(revalidarCartasPublicas).mockClear();
  });

  const sinEfectos = () => {
    expect(vi.mocked(refresh), "no refresca la vista").not.toHaveBeenCalled();
    expect(vi.mocked(revalidarCartasPublicas), "no revalida la carta pública").not.toHaveBeenCalled();
  };

  it.each(CASOS)("$accion: un id que no existe → «$mensaje», sin escribir", async ({ llamar, mensaje }) => {
    const antes = await foto();
    expect(await llamar("cnoexiste000000000000000")).toEqual({ ok: false, mensaje });
    expect(await foto()).toEqual(antes);
    sinEfectos();
  });

  it.each(CASOS)("$accion: un id de OTRA empresa → «$mensaje», sin tocar la fila ajena", async ({ llamar, mensaje, ajena }) => {
    const antes = await foto();
    expect(await llamar(ajenas[ajena])).toEqual({ ok: false, mensaje });
    expect(await foto()).toEqual(antes);
    sinEfectos();
  });

  // O.44b (Hito 4, bloque E1): también las seis que ya leían la fila (antes, con un id `undefined` o un objeto, su `findUnique` hacía lanzar a Prisma: un 500).
  it.each(CASOS)("$accion: un id que no es texto (S-07) → «$mensaje», sin tocar ninguna fila", async ({ llamar, mensaje }) => {
    const antes = await foto();
    for (const roto of [undefined, { not: "x" }]) expect(await llamar(roto as unknown as string)).toEqual({ ok: false, mensaje });
    expect(await foto()).toEqual(antes);
    sinEfectos();
  });

  it("control: con un id propio, las seis arregladas siguen desactivando (y refrescan una vez cada una)", async () => {
    const unidad = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD" } });
    const caja = await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD" } });
    const producto = await prisma.producto.create({ data: { codigo: "MP_H", nombre: "Harina", tipo: "MP", unidadStockId: unidad.id } });
    const presentacion = await prisma.presentacion.create({ data: { productoId: producto.id, unidadCompraId: caja.id, factorConversion: 25 } });
    const categoria = await prisma.categoriaProducto.create({ data: { nombre: "Almacén" } });
    const grupo = await prisma.grupo.create({ data: { nombre: "Harinas" } });
    const insumo = await prisma.insumo.create({ data: { nombre: "Harina" } });
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV-1", nombre: "Molino" } });

    expect(await actualizarActivaCategoriaProducto(categoria.id, false)).toEqual({ ok: true, mensaje: "Categoría desactivada." });
    expect(await actualizarActivoGrupo(grupo.id, false)).toEqual({ ok: true, mensaje: "Grupo desactivado." });
    expect(await actualizarActivoInsumo(insumo.id, false)).toEqual({ ok: true, mensaje: "Insumo desactivado." });
    expect(await actualizarActivaPresentacion(presentacion.id, false)).toEqual({ ok: true, mensaje: "Presentación desactivada." });
    expect(await actualizarActivaUnidad(caja.id, false)).toEqual({ ok: true, mensaje: "Unidad desactivada." });
    expect(await actualizarActivaProveedor(proveedor.id, false)).toEqual({ ok: true, mensaje: "Proveedor desactivado." });

    expect((await prisma.categoriaProducto.findUniqueOrThrow({ where: { id: categoria.id } })).activo).toBe(false);
    expect((await prisma.grupo.findUniqueOrThrow({ where: { id: grupo.id } })).activo).toBe(false);
    expect((await prisma.insumo.findUniqueOrThrow({ where: { id: insumo.id } })).activo).toBe(false);
    expect((await prisma.presentacion.findUniqueOrThrow({ where: { id: presentacion.id } })).activa).toBe(false);
    expect((await prisma.unidad.findUniqueOrThrow({ where: { id: caja.id } })).activa).toBe(false);
    expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: proveedor.id } })).activo).toBe(false);
    // La presentación no refrescaba antes ni ahora (la acción nunca llamó a `refrescarVistaSiHaceFalta`): 5 refrescos para 6 acciones.
    expect(vi.mocked(refresh)).toHaveBeenCalledTimes(5);
    // Las filas de la otra empresa siguen activas.
    expect((await prismaAdmin.unidad.findUniqueOrThrow({ where: { id: ajenas.unidad } })).activa).toBe(true);
    expect((await prismaAdmin.proveedor.findUniqueOrThrow({ where: { id: ajenas.proveedor } })).activo).toBe(true);
  });

  /**
   * O.44b (Hito 4, bloque E1; arreglo chico aprobado por el principio de fallo cerrado): cambiar el grupo de un insumo con un id roto —el insumo o el grupo—
   * hacía lanzar a Prisma (un `update` sobre un insumo que no existe, o la FK compuesta `(empresaId, grupoId)` con un grupo inexistente o ajeno). Ahora
   * devuelve el «no encontrado» de cada uno, sin escribir y sin refrescar la vista.
   */
  describe("actualizarGrupoDeInsumo con un id roto (O.44b)", () => {
    const NO_INSUMO = { ok: false, mensaje: "No se encontró el insumo." };
    const NO_GRUPO = { ok: false, mensaje: "No se encontró el grupo." };

    it("un insumo que no existe, ajeno o que no es texto → «No se encontró el insumo.», sin escribir ni refrescar", async () => {
      const grupo = await prisma.grupo.create({ data: { nombre: "Harinas" } });
      const antes = await foto();
      for (const insumoId of ["cnoexiste000000000000000", ajenas.insumo, undefined, { not: "x" }]) {
        expect(await actualizarGrupoDeInsumo(insumoId as unknown as string, grupo.id), JSON.stringify(insumoId)).toEqual(NO_INSUMO);
        expect(await actualizarGrupoDeInsumo(insumoId as unknown as string, null), JSON.stringify(insumoId)).toEqual(NO_INSUMO);
      }
      expect(await foto()).toEqual(antes);
      sinEfectos();
    });

    it("un grupo que no existe, ajeno o que no es texto (ni null) → «No se encontró el grupo.», sin escribir ni refrescar", async () => {
      const insumo = await prisma.insumo.create({ data: { nombre: "Harina" } });
      const antes = await foto();
      for (const grupoId of ["cnoexiste000000000000000", ajenas.grupo, undefined, { not: "x" }]) {
        expect(await actualizarGrupoDeInsumo(insumo.id, grupoId as unknown as string), JSON.stringify(grupoId)).toEqual(NO_GRUPO);
      }
      expect(await foto()).toEqual(antes);
      sinEfectos();
    });

    it("control: con ids propios asigna y saca el grupo, y refresca una vez cada una", async () => {
      const insumo = await prisma.insumo.create({ data: { nombre: "Harina" } });
      const grupo = await prisma.grupo.create({ data: { nombre: "Harinas" } });
      expect(await actualizarGrupoDeInsumo(insumo.id, grupo.id)).toEqual({ ok: true, mensaje: "Grupo del insumo actualizado." });
      expect((await prisma.insumo.findUniqueOrThrow({ where: { id: insumo.id } })).grupoId).toBe(grupo.id);
      expect(await actualizarGrupoDeInsumo(insumo.id, null)).toEqual({ ok: true, mensaje: "Grupo del insumo actualizado." });
      expect((await prisma.insumo.findUniqueOrThrow({ where: { id: insumo.id } })).grupoId).toBeNull();
      expect(vi.mocked(refresh)).toHaveBeenCalledTimes(2);
    });
  });
});

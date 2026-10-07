import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { activarTodosLosModulos, fijarModulosActivos } from "../setup/modulos";
import { contextoDeAccion, moduloDeAccion, nivelMinimoDeAccion, type AccionClave, type AccionDeEmpresa, type AccionDeSucursal } from "../../src/core/permisos/acciones";
import { moduloDelCatalogo } from "../../src/core/modulos/catalogo";
import { requierePermisoVer, requierePermisoVerDeEmpresa } from "../../src/server/acceso/gate";
import { buscarProductosSelector, listarPresentaciones, obtenerInsumoDeProducto, obtenerProductoOpcion } from "../../src/server/actions/catalogo/productos";
import { listarInsumos } from "../../src/server/actions/catalogo/insumos";
import { listarCategoriasProducto } from "../../src/server/actions/catalogo/categorias-producto";
import { listarUnidadesActivas } from "../../src/server/actions/catalogo/unidades";

/**
 * Lecturas que consumen pantallas con claves DISTINTAS (H8, trabajo D.1 de `pureza-integracion`; decisión D-1 del dueño): exigen el «Ver» de ALGUNA de esas
 * pantallas (`requerirVerAlguna` / `requerirVerAlgunaEnSucursal`, src/server/actions/con-sesion.ts). Antes bastaba la sesión: cualquier usuario logueado las
 * podía invocar directo aunque su rol no abriera ninguna de esas pantallas.
 *
 * Por lectura y por clave: un rol con SOLO el «Ver» de esa clave pasa (para una clave de piso administrador, el rol `admin`, como `darSoloVer` en
 * lecturas-con-permiso-de-ver.test.ts; un rol de operario con la misma fila no, porque el piso manda); el rol sin permisos y el rol con el «Ver» de una clave
 * ajena se rechazan con el mensaje de permiso; sin el módulo de las claves activo se rechaza con el mensaje de módulo. Y en cada caso la respuesta de la
 * lectura coincide con la del gate de cada clave (`requierePermisoVer` / `requierePermisoVerDeEmpresa`): pasa si y solo si alguna clave pasa.
 *
 * La lista de claves de cada fila está escrita a mano A PROPÓSITO (no se lee del código): es el oráculo. Que sea exactamente la de las pantallas consumidoras lo
 * fija `test/arquitectura/consumidores-de-lecturas-declarados.test.ts`.
 */
interface Fila {
  nombre: string;
  claves: readonly AccionClave[];
  llamar: (sucursalId: string) => Promise<unknown>;
}

const LECTURAS: Fila[] = [
  {
    nombre: "buscarProductosSelector",
    claves: [
      "proceso_compra",
      "proceso_produccion",
      "proceso_consumo",
      "proceso_ajuste",
      "proceso_transferencia",
      "proceso_merma",
      "proceso_devolucion_consignacion",
      "proceso_devolucion_cliente",
      "proceso_devolucion_proveedor",
      "proceso_venta",
      "proceso_control",
      "precio_local",
      "traspaso_solicitar",
      "traspaso_enviar_directo",
      "stock_minimo",
      "stock_seccion_habitual",
      "stock_reclasificar",
      "conteo_frecuencia",
      "reporte_conteos",
      "reporte_historial",
      "guardar_receta",
      "pos_mesas",
      "alta_producto",
      "producto_ver_catalogo",
    ],
    llamar: () => buscarProductosSelector(""),
  },
  { nombre: "obtenerProductoOpcion", claves: ["proceso_control", "reporte_conteos"], llamar: () => obtenerProductoOpcion("x") },
  { nombre: "obtenerInsumoDeProducto", claves: ["alta_producto", "producto_ver_catalogo"], llamar: () => obtenerInsumoDeProducto("x") },
  { nombre: "listarPresentaciones", claves: ["producto_ver_catalogo", "proceso_compra", "proceso_devolucion_proveedor"], llamar: () => listarPresentaciones("x") },
  { nombre: "listarInsumos", claves: ["grupos_familia", "alta_producto", "producto_ver_catalogo"], llamar: () => listarInsumos() },
  { nombre: "listarCategoriasProducto", claves: ["categorias", "alta_producto", "producto_ver_catalogo"], llamar: () => listarCategoriasProducto() },
  { nombre: "listarUnidadesActivas", claves: ["proceso_compra", "guardar_receta", "alta_producto", "producto_ver_catalogo"], llamar: () => listarUnidadesActivas() },
];

/** Una clave que ninguna de estas lecturas acepta (de piso operario, así la puede tener el rol de prueba). */
const CLAVE_AJENA: AccionClave = "ver_stock";

const CASOS = LECTURAS.flatMap((l) => l.claves.map((clave) => ({ nombre: l.nombre, clave, llamar: l.llamar })));

describe("lecturas con el «Ver» de alguna de sus pantallas (H8)", () => {
  let sucursalId: string;
  let rolLectorId: string;
  let rolAdminId: string;
  let usuarioId: string;

  beforeAll(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    rolAdminId = base.admin.id;
    rolLectorId = (await prisma.rol.create({ data: { nombre: "lector" } })).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "lector@test.com", sucursalId, rolId: rolLectorId })).id;
  });

  beforeEach(async () => {
    // Cada caso arranca sin ningún permiso (ni en el rol de prueba ni en el admin), en el rol de prueba y con todos los módulos.
    await prisma.permisoRol.deleteMany({ where: { rolId: { in: [rolLectorId, rolAdminId] } } });
    await prisma.usuarioSucursal.updateMany({ where: { usuarioId }, data: { rolId: rolLectorId } });
    await activarTodosLosModulos(EMPRESA_POR_DEFECTO_ID);
    await mockearUsuarioActual({ id: usuarioId, email: "lector@test.com", nombre: null });
  });

  const gateVer = (clave: AccionClave) =>
    contextoDeAccion(clave) === "empresa"
      ? requierePermisoVerDeEmpresa(usuarioId, EMPRESA_POR_DEFECTO_ID, clave as AccionDeEmpresa, prisma)
      : requierePermisoVer(usuarioId, sucursalId, clave as AccionDeSucursal, prisma);

  async function gatesQuePasan(claves: readonly AccionClave[]): Promise<AccionClave[]> {
    const res = await Promise.all(claves.map(gateVer));
    return claves.filter((_, i) => res[i].ok);
  }

  /** «Ver» sin «Editar» de una clave: en el rol de prueba si es de piso operario; si no, en el rol `admin` (el único que alcanza el piso administrador). */
  async function darSoloVer(clave: AccionClave) {
    const rolId = nivelMinimoDeAccion(clave) === "operario" ? rolLectorId : rolAdminId;
    if (rolId === rolAdminId) await prisma.usuarioSucursal.updateMany({ where: { usuarioId }, data: { rolId: rolAdminId } });
    await prisma.permisoRol.create({ data: { rolId, accionClave: clave, puedeVer: true, puedeEditar: false } });
  }

  it.each(CASOS)("$nombre con solo el «Ver» de $clave responde, igual que el gate de $clave", async ({ llamar, clave }) => {
    if (nivelMinimoDeAccion(clave) !== "operario") {
      // El piso manda: un rol de operario con la fila de una clave de administrador no la ve, y la lectura tampoco.
      await prisma.permisoRol.create({ data: { rolId: rolLectorId, accionClave: clave, puedeVer: true, puedeEditar: false } });
      expect((await gateVer(clave)).ok).toBe(false);
      await expect(llamar(sucursalId)).rejects.toThrow(/No tenés permiso/);
    }
    await darSoloVer(clave);
    expect(await gatesQuePasan([clave])).toEqual([clave]);
    await expect(llamar(sucursalId)).resolves.not.toThrow();
  });

  it.each(LECTURAS)("$nombre sin ningún permiso se rechaza con el mensaje de permiso, y ningún gate de sus claves pasa", async ({ llamar, claves }) => {
    expect(await gatesQuePasan(claves)).toEqual([]);
    await expect(llamar(sucursalId)).rejects.toThrow(/No tenés permiso/);
  });

  it.each(LECTURAS)("$nombre con el «Ver» de una clave ajena se rechaza", async ({ llamar, claves }) => {
    expect(claves).not.toContain(CLAVE_AJENA);
    await darSoloVer(CLAVE_AJENA);
    expect((await gateVer(CLAVE_AJENA)).ok).toBe(true);
    expect(await gatesQuePasan(claves)).toEqual([]);
    await expect(llamar(sucursalId)).rejects.toThrow(/No tenés permiso/);
  });

  // Las claves de Administración (módulo fijo) no se apagan: esas lecturas no tienen caso de módulo.
  const CON_MODULO_APAGABLE = LECTURAS.filter((l) => l.claves.every((c) => moduloDelCatalogo(moduloDeAccion(c)).tipo !== "fijo"));

  it.each(CON_MODULO_APAGABLE)("$nombre sin los módulos de sus claves se rechaza con el mensaje de módulo (el de la primera clave)", async ({ llamar, claves }) => {
    await prisma.usuarioSucursal.updateMany({ where: { usuarioId }, data: { rolId: rolAdminId } });
    await prisma.permisoRol.createMany({ data: claves.map((accionClave) => ({ rolId: rolAdminId, accionClave, puedeVer: true, puedeEditar: false })) });
    await expect(llamar(sucursalId)).resolves.not.toThrow();

    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, []);
    expect(await gatesQuePasan(claves)).toEqual([]);
    const nombreDelModulo = moduloDelCatalogo(moduloDeAccion(claves[0])).nombre;
    await expect(llamar(sucursalId)).rejects.toThrow(`módulo "${nombreDelModulo}"`);
  });
});

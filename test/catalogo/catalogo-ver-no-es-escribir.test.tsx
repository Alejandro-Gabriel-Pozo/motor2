import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Los formularios y botones son componentes de cliente: fuera de Next no hay router. Esta prueba mide lo que la PÁGINA real arma (el árbol de React, sin dibujarlo).
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import type { AccionClave } from "../../src/core/permisos/acciones";
import { FormConResultado } from "../../src/components/form-con-resultado";
import { AvisoSoloLecturaDeCatalogo } from "../../src/components/catalogo/aviso-solo-lectura";
import { FormRenombrarInsumo } from "../../src/components/catalogo/form-renombrar-insumo";
import { crearUnidad } from "../../src/server/actions/catalogo/unidades";
import { altaCliente } from "../../src/server/actions/clientes/cliente";
import { actualizarActivaProveedor } from "../../src/server/actions/catalogo/proveedores";
import { crearInsumo } from "../../src/server/actions/catalogo/insumos";
import CategoriasPage from "../../src/app/(app)/catalogo/categorias/page";
import UnidadesPage from "../../src/app/(app)/catalogo/unidades/page";
import MargenObjetivoPage from "../../src/app/(app)/catalogo/margen-objetivo/page";
import InsumosGruposPage from "../../src/app/(app)/catalogo/insumos-grupos/page";
import ClientesPage from "../../src/app/(app)/catalogo/clientes/page";
import ProveedoresPage from "../../src/app/(app)/catalogo/proveedores/page";
import FichaProveedorPage from "../../src/app/(app)/catalogo/proveedores/[id]/page";
import RecetasPage from "../../src/app/(app)/catalogo/recetas/page";
import { NuevaReceta } from "../../src/app/(app)/catalogo/recetas/nueva-receta";
import PrecioLocalPage from "../../src/app/(app)/movimientos/precio-local/page";
import { PrecioLocalForm } from "../../src/app/(app)/movimientos/precio-local/precio-local-form";

/** Cuántos elementos de cada `tipo` lleva el árbol que arma la página (sin dibujarlo: los componentes de servidor anidados no se ejecutan). */
function cuantos(arbol: ReactNode, tipo: unknown): number {
  let n = 0;
  const recorrer = (nodo: ReactNode) => {
    if (Array.isArray(nodo)) return nodo.forEach(recorrer);
    if (!nodo || typeof nodo !== "object" || !("props" in nodo)) return;
    const el = nodo as ReactElement<{ children?: ReactNode }>;
    if (el.type === tipo) n++;
    recorrer(el.props.children);
  };
  recorrer(arbol);
  return n;
}

/** Busca un texto en las hojas del árbol (los `<Link>` y botones dejan su texto como hijo). */
function tieneTexto(arbol: ReactNode, texto: string): boolean {
  let hallado = false;
  const recorrer = (nodo: ReactNode) => {
    if (hallado) return;
    if (typeof nodo === "string") hallado = nodo.includes(texto);
    else if (Array.isArray(nodo)) nodo.forEach(recorrer);
    else if (nodo && typeof nodo === "object" && "props" in nodo) recorrer((nodo as ReactElement<{ children?: ReactNode }>).props.children);
  };
  recorrer(arbol);
  return hallado;
}

/**
 * Fase 7 (DEC-33, diseño `docs/diseno-modulo-catalogo-2026-10-28.md` I2 e I3): en las pantallas de escritura de Catálogo, ver no es poder escribir, con los NIVELES de la misma clave (sin claves nuevas).
 * Con «Editar» la página arma sus formularios; con solo «Ver» de las claves de sus comandos, no arma NINGUNO y muestra el aviso de solo lectura; y el comando, llamado directo, sigue rechazando.
 *
 * Las claves de estas pantallas tienen piso administrador (o llegan al operario, las de alta): solo el rol de sistema `admin` las alcanza. «Ver sin Editar» se arma bajándole al rol administrador la fila
 * de cada clave a solo «Ver», como lo haría la matriz de permisos.
 */
describe("Catálogo: ver una pantalla no es poder escribir en ella (DEC-33)", () => {
  let sucursalId: string;
  let rolAdminId: string;
  let proveedorId: string;

  const soloVer = async (...claves: AccionClave[]) => {
    const { count } = await prisma.permisoRol.updateMany({ where: { rolId: rolAdminId, accionClave: { in: claves } }, data: { puedeVer: true, puedeEditar: false } });
    expect(count, `control: el rol administrador tiene la fila de ${claves.join(", ")}`).toBe(claves.length);
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    rolAdminId = base.admin.id;
    await sembrarCatalogoBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: rolAdminId });
    await mockearUsuarioActual({ id: admin.id, email: "admin@test.com", nombre: null });
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Lácteos del Sur" } })).id;
    await prisma.cliente.create({ data: { nombre: "Club del Barrio", descuentoPorcentaje: 10 } });
  });

  const casos: { pantalla: string; pagina: () => Promise<ReactNode>; claves: AccionClave[]; formularios: number }[] = [
    { pantalla: "Categorías", pagina: () => CategoriasPage(), claves: ["categorias", "categoria_alta"], formularios: 2 },
    { pantalla: "Unidades", pagina: () => UnidadesPage(), claves: ["unidades"], formularios: 5 },
    { pantalla: "Margen objetivo", pagina: () => MargenObjetivoPage(), claves: ["margen_objetivo_editar"], formularios: 2 },
    { pantalla: "Insumos", pagina: () => InsumosGruposPage(), claves: ["grupos_familia", "insumo_alta", "insumo_renombrar_fusionar"], formularios: 4 },
    { pantalla: "Clientes con descuento", pagina: () => ClientesPage(), claves: ["clientes"], formularios: 3 },
    { pantalla: "Proveedores", pagina: () => ProveedoresPage(), claves: ["proveedores", "proveedor_alta"], formularios: 1 },
  ];

  it.each(casos)("$pantalla: con «Editar» arma sus formularios y no muestra el aviso", async ({ pagina, formularios }) => {
    const arbol = await pagina();
    expect(cuantos(arbol, FormConResultado)).toBe(formularios);
    expect(cuantos(arbol, AvisoSoloLecturaDeCatalogo)).toBe(0);
  });

  it.each(casos)("$pantalla: con solo «Ver» no arma ningún formulario y muestra el aviso", async ({ pagina, claves }) => {
    await soloVer(...claves);
    const arbol = await pagina();
    expect(cuantos(arbol, FormConResultado)).toBe(0);
    expect(cuantos(arbol, AvisoSoloLecturaDeCatalogo)).toBe(1);
  });

  it("Insumos: cada control sigue a LA clave de su comando (con solo `insumo_alta` editable, solo el alta)", async () => {
    await soloVer("grupos_familia", "insumo_renombrar_fusionar");
    const arbol = await InsumosGruposPage();
    expect(cuantos(arbol, FormConResultado)).toBe(1);
    expect(cuantos(arbol, FormRenombrarInsumo)).toBe(0);
    expect(cuantos(arbol, AvisoSoloLecturaDeCatalogo)).toBe(0);
  });

  it("Maestros: quien ve otro maestro pero no los insumos entra a la entrada y lee «Elegí arriba» (ni la tabla ni sus lecturas)", async () => {
    const { count } = await prisma.permisoRol.updateMany({ where: { rolId: rolAdminId, accionClave: "grupos_familia" }, data: { puedeVer: false, puedeEditar: false } });
    expect(count).toBe(1);
    const arbol = await InsumosGruposPage();
    expect(tieneTexto(arbol, "Tu rol no ve los insumos")).toBe(true);
    expect(cuantos(arbol, FormConResultado)).toBe(0);
    // Sin ningún maestro, la guarda de la entrada niega.
    await prisma.permisoRol.updateMany({ where: { rolId: rolAdminId, accionClave: { in: ["categorias", "unidades", "margen_objetivo_editar"] } }, data: { puedeVer: false, puedeEditar: false } });
    expect(tieneTexto(await InsumosGruposPage(), "No tenés permiso")).toBe(true);
  });

  it("Proveedores: «Editar» y «Desactivar» de la lista y «Editar» de la ficha solo con el «Editar» de `proveedores`", async () => {
    expect(tieneTexto(await ProveedoresPage(), "Editar")).toBe(true);
    expect(tieneTexto(await FichaProveedorPage({ params: Promise.resolve({ id: proveedorId }), searchParams: Promise.resolve({}) }), "Editar")).toBe(true);
    await soloVer("proveedores");
    expect(tieneTexto(await ProveedoresPage(), "Editar")).toBe(false);
    expect(tieneTexto(await FichaProveedorPage({ params: Promise.resolve({ id: proveedorId }), searchParams: Promise.resolve({}) }), "Editar")).toBe(false);
  });

  it("Recetas: «Nueva receta» solo con el «Editar» de `guardar_receta`", async () => {
    expect(cuantos(await RecetasPage(), NuevaReceta)).toBe(1);
    await soloVer("guardar_receta");
    const arbol = await RecetasPage();
    expect(cuantos(arbol, NuevaReceta)).toBe(0);
    expect(cuantos(arbol, AvisoSoloLecturaDeCatalogo)).toBe(1);
  });

  it("Precio local: el formulario de la sucursal activa solo con el «Editar» de `precio_local`", async () => {
    expect(cuantos(await PrecioLocalPage(), PrecioLocalForm)).toBe(1);
    await soloVer("precio_local");
    const arbol = await PrecioLocalPage();
    expect(cuantos(arbol, PrecioLocalForm)).toBe(0);
    expect(cuantos(arbol, FormConResultado)).toBe(0);
    expect(cuantos(arbol, AvisoSoloLecturaDeCatalogo)).toBe(1);
  });

  it("el servidor rechaza igual: con solo «Ver», los comandos no escriben", async () => {
    await soloVer("unidades", "clientes", "proveedores", "insumo_alta");
    const antes = await Promise.all([prisma.unidad.count(), prisma.cliente.count(), prisma.insumo.count()]);
    expect((await crearUnidad({ nombre: "caja", magnitud: "CANTIDAD" })).ok).toBe(false);
    expect((await altaCliente("Otro club", 5)).ok).toBe(false);
    expect((await crearInsumo("Leche")).ok).toBe(false);
    expect((await actualizarActivaProveedor(proveedorId, false)).ok).toBe(false);
    expect(await Promise.all([prisma.unidad.count(), prisma.cliente.count(), prisma.insumo.count()])).toEqual(antes);
    expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: proveedorId } })).activo).toBe(true);
  });
});

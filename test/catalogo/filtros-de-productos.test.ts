import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darRecetaDeReventa } from "../setup/receta-de-venta";
import { fijarModulosActivos } from "../setup/modulos";
import { EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { listarProductosPagina } from "../../src/server/actions/catalogo/productos";
import { faltasQueSePuedenFiltrar } from "../../src/server/lecturas/catalogo/filtros-de-productos";
import { hechosDelProducto, leerProductoDelEspacio } from "../../src/server/consultas/catalogo/espacio-del-producto";
import { pendientesDelProducto, type EntradaDeFiltrosDeProductos } from "../../src/core/catalogo/public";

/**
 * Fase 6, bloque 3, 3b: los filtros de la lista de Productos, contra Postgres real y por la acción de verdad (`listarProductosPagina`). Lo que se afirma:
 *  - cada filtro (búsqueda, tipo, cómo se vende, disponibilidad, «le falta algo») devuelve exactamente los productos que dice su etiqueta;
 *  - «le falta algo» coincide, producto por producto, con los pendientes que marca el espacio del producto (si una regla cambia en un lado y no en el otro, esto se pone rojo);
 *  - PRIVACIDAD: «sin receta» y «fuera de la carta» no se aplican a quien no ve esa pantalla (ni con el módulo apagado): la lista sale como sin el filtro, sin revelar nada;
 *  - un valor que no es de la lista cerrada (o un tipo raro) se ignora: nunca un error ni una consulta armada con lo que mandó el cliente;
 *  - la paginación conserva el filtro, y nada de otra empresa aparece con ningún filtro.
 */
describe("listarProductosPagina: filtros de la lista de Productos", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let rolAdminId: string;
  let adminId: string;
  let unidadId: string;
  const ids: Record<string, string> = {};

  // El tipo de la acción dice «textos»; el cliente puede mandar cualquier cosa, y varios casos de abajo lo hacen a propósito.
  const nombres = async (filtros?: unknown, termino?: string) => (await listarProductosPagina(undefined, termino, filtros as EntradaDeFiltrosDeProductos | undefined)).items.map((i) => i.nombre).sort();
  const TODOS = async () => nombres();

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    rolAdminId = base.admin.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const catalogo = await sembrarCatalogoBase();
    unidadId = catalogo.kg.id;
    const pv = (codigo: string, nombre: string, precioVenta: number, extra: object = {}) => sembrarProductoDisponible({ codigo, nombre, tipo: "PV", precioVenta, unidadStockId: unidadId, ...extra }, sucursalId);

    const milanesas = await pv("PV_MILA", "Milanesas", 20000);
    const cafe = await pv("PV_CAFE", "Café", 3000);
    await darRecetaDeReventa(prisma, { id: cafe.id, nombre: cafe.nombre, codigo: cafe.codigo, unidadStockId: unidadId }, { sucursalIds: [sucursalId] });
    const sinPrecio = await pv("PV_SINP", "Sin precio", 0);
    const porOpcion = await pv("PV_BASE", "Pizza por opción", 0, { modoDeVenta: "BASE_CONFIGURABLE" });
    const ancla = await pv("PV_SHOT", "Shot extra (ancla)", 0);
    const grupo = await prisma.grupoDeOpciones.create({ data: { nombre: "Extras", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 3 } });
    await prisma.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre: "Shot extra", orden: 1, productoId: ancla.id } });
    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadId }, sucursalId);
    const masa = await sembrarProductoDisponible({ codigo: "MP_MASA", nombre: "Masa madre", tipo: "MP", unidadStockId: unidadId, seProduce: true }, sucursalId);
    const masaLista = await sembrarProductoDisponible({ codigo: "MP_MASA2", nombre: "Masa lista", tipo: "MP", unidadStockId: unidadId, seProduce: true }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: masaLista.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 1, unidadId, mermaPorcentaje: 0 }] } } });
    // Disponibilidad: uno solo en OTRA sucursal, uno apagado en todas y uno sin ninguna fila.
    const soloEnOtra = await prisma.producto.create({ data: { codigo: "PV_OTRA", nombre: "Solo en otra", tipo: "PV", unidadStockId: unidadId, precioVenta: 10 } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursalId, productoId: soloEnOtra.id, disponible: true } });
    const apagado = await pv("PV_APAGADO", "Apagado", 10);
    await prisma.disponibilidadProducto.updateMany({ where: { productoId: apagado.id }, data: { disponible: false } });
    const sinFilas = await prisma.producto.create({ data: { codigo: "PV_NUNCA", nombre: "Nunca activado", tipo: "PV", unidadStockId: unidadId, precioVenta: 10 } });
    // La carta de esta sucursal: Café visible en una sección; «Oculto» con contenido oculto; «Agrupado» como opción de un ítem agrupado activo.
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
    const enLaCarta = async (productoId: string, visibleEnCarta: boolean) => prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId, visibleEnCarta, seccionCartaId: visibleEnCarta ? seccion.id : null } });
    await enLaCarta(cafe.id, true);
    const oculto = await pv("PV_OCULTO", "Oculto en carta", 100);
    await enLaCarta(oculto.id, false);
    const agrupado = await pv("PV_AGRUP", "Agrupado en carta", 100);
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Combo", seccionCartaId: seccion.id } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: item.id, productoId: agrupado.id } });

    Object.assign(ids, { milanesas: milanesas.id, cafe: cafe.id, sinPrecio: sinPrecio.id, porOpcion: porOpcion.id, ancla: ancla.id, harina: harina.id, masa: masa.id, masaLista: masaLista.id, soloEnOtra: soloEnOtra.id, apagado: apagado.id, sinFilas: sinFilas.id, oculto: oculto.id, agrupado: agrupado.id });

    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
  }, 60_000);

  describe("búsqueda", () => {
    it("por nombre o por código, sin distinguir mayúsculas; el % y el _ se buscan tal cual", async () => {
      expect(await nombres(undefined, "mila")).toEqual(["Milanesas"]);
      expect(await nombres(undefined, "pv_mila")).toEqual(["Milanesas"]);
      // Como comodines, «pv%mila» y «pv_mil_» encontrarían «PV_MILA»; tal cual, no.
      expect(await nombres(undefined, "pv%mila")).toEqual([]);
      expect(await nombres(undefined, "pv_mil_")).toEqual([]);
    });

    it("se combina con los filtros: ambos tienen que cumplirse", async () => {
      expect(await nombres({ tipo: "materia-prima" }, "masa")).toEqual(["Masa lista", "Masa madre"]);
      expect(await nombres({ tipo: "venta" }, "masa")).toEqual([]);
    });
  });

  describe("tipo", () => {
    it("«Producto de venta» no incluye materias primas ni el producto de respaldo de un adicional", async () => {
      const venta = await nombres({ tipo: "venta" });
      expect(venta).toContain("Milanesas");
      expect(venta).not.toContain("Harina");
      expect(venta).not.toContain("Shot extra (ancla)");
    });

    it("«Materia prima», «que se produce» y «de respaldo»", async () => {
      const mp = await nombres({ tipo: "materia-prima" });
      expect(mp).toEqual(expect.arrayContaining(["Harina", "Masa madre", "Masa lista"]));
      expect(mp).not.toContain("Milanesas");
      expect(await nombres({ tipo: "se-produce" })).toEqual(["Masa lista", "Masa madre"]);
      expect(await nombres({ tipo: "respaldo" })).toEqual(["Shot extra (ancla)"]);
    });
  });

  describe("cómo se vende", () => {
    it("directo y por opción", async () => {
      expect(await nombres({ modo: "por-opcion" })).toEqual(["Pizza por opción"]);
      const directo = await nombres({ modo: "directo" });
      expect(directo).toContain("Milanesas");
      expect(directo).not.toContain("Pizza por opción");
    });
  });

  describe("disponibilidad (el «activo» del producto es la disponibilidad por sucursal)", () => {
    it("acá y no acá miran la sucursal ACTIVA", async () => {
      const aca = await nombres({ disponible: "aca" });
      expect(aca).toContain("Milanesas");
      expect(aca).not.toContain("Solo en otra");
      expect(aca).not.toContain("Apagado");
      const noAca = await nombres({ disponible: "no-aca" });
      expect(noAca).toEqual(expect.arrayContaining(["Solo en otra", "Apagado", "Nunca activado"]));
      expect(noAca).not.toContain("Milanesas");
    });

    it("«alguna sucursal» incluye lo que solo está activo en OTRA sucursal; «ninguna» es lo apagado en todas o nunca activado", async () => {
      const alguna = await nombres({ disponible: "en-alguna" });
      expect(alguna).toEqual(expect.arrayContaining(["Milanesas", "Solo en otra"]));
      expect(alguna).not.toContain("Apagado");
      expect(alguna).not.toContain("Nunca activado");
      expect(await nombres({ disponible: "en-ninguna" })).toEqual(["Apagado", "Nunca activado"]);
    });
  });

  describe("le falta algo", () => {
    it("sin precio: solo un producto de venta DIRECTO con precio 0 (no el que se vende por opción ni el de respaldo)", async () => {
      expect(await nombres({ falta: "sin-precio" })).toEqual(["Sin precio"]);
    });

    it("sin receta: el producto de venta sin ingredientes (no el de stock propio ni el de respaldo) y la materia prima que se produce sin ingredientes", async () => {
      const sin = await nombres({ falta: "sin-receta" });
      expect(sin).toEqual(expect.arrayContaining(["Milanesas", "Sin precio", "Masa madre"]));
      for (const conOrigen of ["Café", "Masa lista", "Harina", "Shot extra (ancla)"]) expect(sin).not.toContain(conOrigen);
    });

    it("fuera de la carta: disponible acá y sin contenido ni grupo; no el oculto, no el agrupado, no el que ya está, no el apagado", async () => {
      const fuera = await nombres({ falta: "fuera-de-la-carta" });
      expect(fuera).toEqual(expect.arrayContaining(["Milanesas", "Sin precio"]));
      for (const no of ["Café", "Oculto en carta", "Agrupado en carta", "Apagado", "Solo en otra", "Nunca activado", "Harina", "Shot extra (ancla)"]) expect(fuera).not.toContain(no);
    });

    it("COINCIDE producto por producto con los pendientes del espacio del producto", async () => {
      const sinPrecio = new Set(await nombres({ falta: "sin-precio" }));
      const sinReceta = new Set(await nombres({ falta: "sin-receta" }));
      const fuera = new Set(await nombres({ falta: "fuera-de-la-carta" }));
      const todos = await prisma.producto.findMany({ select: { id: true, nombre: true } });
      for (const { id, nombre } of todos) {
        const producto = (await leerProductoDelEspacio(prisma, id))!;
        const hechos = await hechosDelProducto(prisma, producto, sucursalId, { opciones: false, receta: true, carta: true });
        const pendiente = pendientesDelProducto(hechos);
        expect({ nombre, sinPrecio: sinPrecio.has(nombre), sinReceta: sinReceta.has(nombre), fuera: fuera.has(nombre) }).toEqual({
          nombre,
          sinPrecio: pendiente.datos.tipo === "pendiente",
          sinReceta: pendiente.receta.tipo === "pendiente",
          fuera: hechos.carta?.estado === "fuera",
        });
      }
    });
  });

  describe("PRIVACIDAD de «le falta algo»", () => {
    const comoSoloCatalogo = async () => {
      const rol = await prisma.rol.create({ data: { nombre: "Solo catálogo" } });
      await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: "producto_ver_catalogo", puedeVer: true, puedeEditar: false } });
      const usuario = await crearUsuarioConMembresia({ email: "catalogo@test.com", sucursalId, rolId: rol.id });
      await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });
      return usuario;
    };

    it("quien no ve recetas ni carta: «sin receta» y «fuera de la carta» no filtran nada (la lista sale entera), «sin precio» sí", async () => {
      const todos = await TODOS();
      const usuario = await comoSoloCatalogo();
      expect(await nombres({ falta: "sin-receta" })).toEqual(todos);
      expect(await nombres({ falta: "fuera-de-la-carta" })).toEqual(todos);
      expect(await nombres({ falta: "sin-precio" })).toEqual(["Sin precio"]);
      expect(await faltasQueSePuedenFiltrar({ usuarioId: usuario.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, db: prisma })).toEqual(["sin-precio"]);
    });

    it("el administrador ve las tres; con el módulo apagado, la suya desaparece y el filtro se ignora", async () => {
      const ctx = { usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, db: prisma };
      expect(await faltasQueSePuedenFiltrar(ctx)).toEqual(["sin-precio", "sin-receta", "fuera-de-la-carta"]);
      const todos = await TODOS();
      await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["stock", "carta"]);
      expect(await faltasQueSePuedenFiltrar(ctx)).toEqual(["sin-precio", "fuera-de-la-carta"]);
      expect(await nombres({ falta: "sin-receta" })).toEqual(todos);
      await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["stock", "recetas"]);
      expect(await faltasQueSePuedenFiltrar(ctx)).toEqual(["sin-precio", "sin-receta"]);
      expect(await nombres({ falta: "fuera-de-la-carta" })).toEqual(todos);
    });

    it("un administrador al que se le quita el Ver de la receta o de la carta tampoco puede filtrar por eso", async () => {
      const todos = await TODOS();
      await prisma.permisoRol.updateMany({ where: { rolId: rolAdminId, accionClave: "guardar_receta" }, data: { puedeVer: false, puedeEditar: false } });
      expect(await nombres({ falta: "sin-receta" })).toEqual(todos);
      await prisma.permisoRol.updateMany({ where: { rolId: rolAdminId, accionClave: "carta_ver" }, data: { puedeVer: false, puedeEditar: false } });
      expect(await nombres({ falta: "fuera-de-la-carta" })).toEqual(todos);
    });
  });

  describe("valores que no son de la lista cerrada", () => {
    it("se ignoran: la lista sale como sin filtro, sin error", async () => {
      const todos = await TODOS();
      const raros: unknown[] = [
        { tipo: "'; DROP TABLE \"Producto\"; --", modo: "x", disponible: "todos", falta: "mucho" },
        { tipo: ["venta"], modo: { is: "directo" }, disponible: 5, falta: null },
        { tipo: "VENTA", modo: " directo", disponible: "aca ", falta: "" },
        { tipo: "__proto__", constructor: "venta" },
        "venta",
        42,
        null,
        [],
      ];
      for (const filtros of raros) expect(await nombres(filtros)).toEqual(todos);
    });

    it("el término de búsqueda raro (NUL, larguísimo) no rompe ni devuelve de más", async () => {
      expect(await nombres(undefined, "hari\u0000na")).toEqual(["Harina"]);
      expect(await nombres(undefined, "x".repeat(5000))).toEqual([]);
    });
  });

  describe("paginación y aislamiento", () => {
    it("la página siguiente conserva el filtro y no repite ni pierde filas", async () => {
      for (let i = 0; i < 52; i++) await sembrarProductoDisponible({ codigo: `MP_BULK_${String(i).padStart(2, "0")}`, nombre: `Bulk ${String(i).padStart(2, "0")}`, tipo: "MP", unidadStockId: unidadId }, sucursalId);
      const primera = await listarProductosPagina(undefined, undefined, { tipo: "materia-prima" });
      expect(primera.items).toHaveLength(50);
      expect(primera.nextCursor).not.toBeNull();
      const segunda = await listarProductosPagina(primera.nextCursor!, undefined, { tipo: "materia-prima" });
      const todas = [...primera.items, ...segunda.items];
      expect(new Set(todas.map((p) => p.id)).size).toBe(todas.length);
      expect(todas.every((p) => p.tipo === "MP")).toBe(true);
      expect(segunda.nextCursor).toBeNull();
      expect(todas.length).toBe(await prisma.producto.count({ where: { tipo: "MP" } }));
    });

    it("lo de OTRA empresa no aparece con ningún filtro (ni con los que miran a toda la empresa)", async () => {
      const otra = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
      const unidadAjena = await otra.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
      await otra.producto.create({ data: { codigo: "PV_AJENO", nombre: "Ajeno sin nada", tipo: "PV", unidadStockId: unidadAjena.id, precioVenta: 0 } });
      await otra.producto.create({ data: { codigo: "MP_AJENA", nombre: "Ajena produce", tipo: "MP", unidadStockId: unidadAjena.id, seProduce: true } });
      const filtros: Record<string, unknown>[] = [{}, { tipo: "venta" }, { tipo: "se-produce" }, { disponible: "en-ninguna" }, { disponible: "no-aca" }, { falta: "sin-precio" }, { falta: "sin-receta" }, { falta: "fuera-de-la-carta" }];
      for (const f of filtros) expect(await nombres(f)).not.toEqual(expect.arrayContaining(["Ajeno sin nada"]));
      for (const f of filtros) expect(await nombres(f, "Ajen")).toEqual([]);
    });
  });
});

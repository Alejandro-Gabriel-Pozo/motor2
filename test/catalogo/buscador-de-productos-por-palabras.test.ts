import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import type { AccionClave } from "../../src/core/permisos/acciones";
import { buscarProductosSelector, listarProductosPagina } from "../../src/server/actions/catalogo/productos";

/**
 * Compras etapa 1, paso 5 (diseño `docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md` §5.2), contra Postgres real: búsqueda por palabras (en el buscador y en la lista de Productos: «las dos buscan
 * igual») y orden del buscador con el proveedor elegido. Lectura pura: sin escrituras ni concurrencia que probar.
 */
describe("buscador de productos por palabras y con proveedor elegido", () => {
  let sucursalId: string;
  let rolAdminId: string;
  let proveedorP: string;
  let proveedorQ: string;

  const sinVer = async (...claves: AccionClave[]) => {
    const { count } = await prisma.permisoRol.updateMany({ where: { rolId: rolAdminId, accionClave: { in: claves } }, data: { puedeVer: false, puedeEditar: false } });
    expect(count).toBe(claves.length);
  };
  const buscador = async (t: string, proveedorId?: string) => (await buscarProductosSelector(t, undefined, proveedorId)).map((p) => p.nombre);
  const lista = async (t: string) => (await listarProductosPagina(undefined, t)).items.map((p) => p.nombre).sort();

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    rolAdminId = base.admin.id;
    const { kg } = await sembrarCatalogoBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: rolAdminId });
    await mockearUsuarioActual({ id: admin.id, email: "admin@test.com", nombre: null });

    const mp = (codigo: string, nombre: string) => sembrarProductoDisponible({ codigo, nombre, tipo: "MP", unidadStockId: kg.id }, sucursalId);
    await mp("MP_H25", "Harina 000 x 25 kg");
    await mp("MP_H1", "Harina 000 x 1 kg");
    const bifeAncho = await mp("MP_BIFEA", "Bife ancho");
    const bifeAngosto = await mp("MP_BIFEN", "Bife angosto");
    await mp("MP_ABIFE", "Abadejo bife de mar");
    await mp("MP_X1067", "Cuadril");
    const codigoExacto = await mp("A1067", "Zapallo");

    proveedorP = (await prisma.proveedor.create({ data: { codigo: "PRV_P", nombre: "Proveedor P" } })).id;
    proveedorQ = (await prisma.proveedor.create({ data: { codigo: "PRV_Q", nombre: "Proveedor Q" } })).id;
    const vincular = (productoId: string, proveedorId: string, referenciaProveedor: string) =>
      prisma.proveedorPorProducto.create({ data: { productoId, proveedorId, unidadCompraId: kg.id, referenciaProveedor } });
    await vincular(bifeAngosto.id, proveedorP, "A1067000007 Bife Angosto Con Cordon");
    await vincular(bifeAncho.id, proveedorQ, "BAN-0045 Bife ancho Q");
    void codigoExacto;

    // La OTRA empresa: una harina que no tiene que aparecer.
    const otra = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const u = await otra.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    await otra.producto.create({ data: { codigo: "MP_AJENO", nombre: "Harina 000 x 25 kg ajena", tipo: "MP", unidadStockId: u.id } });
  });

  it("«harina 25» encuentra «Harina 000 x 25 kg» y no «Harina 000 x 1 kg»; el orden de las palabras da igual", async () => {
    expect(await buscador("harina 25")).toEqual(["Harina 000 x 25 kg"]);
    expect(await buscador("25 HARINA")).toEqual(["Harina 000 x 25 kg"]);
  });

  it("una palabra que no está: no matchea", async () => {
    expect(await buscador("harina 25 pan")).toEqual([]);
  });

  it("cada palabra puede estar en un campo distinto: «A1067000007 angosto» (referencia + nombre)", async () => {
    expect(await buscador("A1067000007 angosto")).toEqual(["Bife angosto"]);
  });

  it("aislamiento: la harina de otra empresa no aparece, ni en el buscador ni en la lista", async () => {
    expect(await buscador("ajena")).toEqual([]);
    expect(await lista("ajena")).toEqual([]);
  });

  it("la lista de Productos también busca por palabras", async () => {
    expect(await lista("harina 25")).toEqual(["Harina 000 x 25 kg"]);
    expect(await lista("25 harina")).toEqual(["Harina 000 x 25 kg"]);
    expect(await lista("harina 25 pan")).toEqual([]);
  });

  it("orden con proveedor elegido: lo que P ya llama así va antes que lo alfabéticamente anterior", async () => {
    // Sin proveedor: orden por nombre, pero «empieza con» antes que el resto.
    expect(await buscador("bife")).toEqual(["Bife ancho", "Bife angosto", "Abadejo bife de mar"]);
    // Con P: «Bife angosto» (vinculado a P) primero. Con Q: «Bife ancho».
    expect(await buscador("bife", proveedorP)).toEqual(["Bife angosto", "Bife ancho", "Abadejo bife de mar"]);
    expect(await buscador("bife", proveedorQ)).toEqual(["Bife ancho", "Bife angosto", "Abadejo bife de mar"]);
  });

  it("código exacto primero: nuestro código y la palabra completa de la referencia del proveedor elegido", async () => {
    // «A1067» es el código de «Zapallo» (primero); «Bife angosto» también aparece (la referencia lo contiene) pero después.
    expect(await buscador("a1067", proveedorP)).toEqual(["Zapallo", "Bife angosto"]);
    expect(await buscador("A1067000007", proveedorP)).toEqual(["Bife angosto"]);
    // Código exacto antes que lo vinculado al proveedor.
    const orden = await buscador("bife", proveedorP);
    expect(orden[0]).toBe("Bife angosto");
    await prisma.producto.updateMany({ where: { codigo: "MP_ABIFE" }, data: { codigo: "BIFE" } });
    expect((await buscador("bife", proveedorP))[0]).toBe("Abadejo bife de mar");
  });

  it("sin permiso para ver referencias: no busca por referencia y el proveedor elegido no cambia el orden", async () => {
    await sinVer("proveedores", "proceso_compra");
    expect(await buscador("A1067000007")).toEqual([]);
    expect(await buscador("A1067000007", proveedorP)).toEqual([]);
    const sin = await buscador("bife");
    expect(await buscador("bife", proveedorP)).toEqual(sin);
    expect(await buscador("bife", proveedorQ)).toEqual(sin);
  });

  it("un proveedor inexistente o de otra empresa solo ordena: no rompe ni filtra", async () => {
    expect(await buscador("bife", "no-existe")).toEqual(await buscador("bife"));
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { resolverMenuCarta, resolverMenuCartaConDiagnostico } from "../../src/core/carta/menu-consulta";

/**
 * resolverMenuCarta contra Postgres real (docs/plan-carta-catalogo-2026-09-24.md, M3): qué PV entran a la carta pública de
 * una sucursal y con qué precio. El criterio de "disponible" es el de `whereDisponibleEn` (fila ausente = no disponible) y el
 * de "visible" es opt-in (sin fila de ContenidoCartaProducto = no se muestra, D3). Cada contenido elige su sección de carta
 * DIRECTO (docs/plan-carta-seccion-directa-2026-09-25.md): la categoría del producto no ubica nada.
 */
describe("resolverMenuCarta", () => {
  let central: string;
  let otra: string;
  let inactiva: string;
  let ids: Record<string, string>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    otra = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    inactiva = (await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } })).id;

    const cat = async (nombre: string) => (await prisma.categoriaProducto.create({ data: { nombre } })).id;
    const [cBife, cEmp, cSuelta, cTragos] = await Promise.all([cat("Bife"), cat("Empanadas"), cat("Suelta"), cat("Tragos")]);

    const entradas = await prisma.seccionCarta.create({ data: { nombre: "Entradas", orden: 1 } });
    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos Principales", titulo: "Del fuego", descripcion: "A las brasas", orden: 2 } });
    const promos = await prisma.seccionCarta.create({ data: { nombre: "Promos", orden: 3 } });
    const apagada = await prisma.seccionCarta.create({ data: { nombre: "Barra", orden: 0, activa: false } });
    // Una sección activa sin nada ubicado: no sale.
    await prisma.seccionCarta.create({ data: { nombre: "Sin nada", orden: 0 } });

    let n = 0;
    const pv = async (nombre: string, categoriaId: string | null, precioVenta: number, opciones: { sucursal?: string | null; tipo?: "PV" | "MP" } = {}) => {
      const data = { codigo: `CARTA_${++n}`, nombre, tipo: opciones.tipo ?? "PV", categoriaId, precioVenta, unidadStockId: u.id } as const;
      const sucursal = opciones.sucursal === undefined ? central : opciones.sucursal;
      const p = sucursal ? await sembrarProductoDisponible(data, sucursal) : await prisma.producto.create({ data });
      return p.id;
    };
    ids = {
      bife: await pv("Bife de chorizo", cBife, 34000),
      ojo: await pv("Ojo de bife", cBife, 36000),
      empanada: await pv("Empanada de carne", cEmp, 2500),
      empanadaLocalOff: await pv("Empanada de verdura", cEmp, 2400),
      noDisponible: await pv("Bife apagado", cBife, 1),
      sinFilaDisponibilidad: await pv("Bife sin fila", cBife, 1, { sucursal: null }),
      oculto: await pv("Bife oculto", cBife, 1),
      sinContenido: await pv("Bife sin contenido", cBife, 1),
      mp: await pv("Carne cruda", cBife, 1, { tipo: "MP" }),
      soloOtra: await pv("Bife de la otra", cBife, 1, { sucursal: otra }),
      suelto: await pv("Plato suelto", cSuelta, 1),
      sinCategoria: await pv("Sin categoría", null, 1),
      trago: await pv("Fernet", cTragos, 1),
    };
    await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: central, productoId: ids.noDisponible } }, data: { disponible: false } });

    // Dónde se ve cada uno (null = sin sección: no sale, va al diagnóstico). "Fernet" está en una sección apagada.
    const seccionDe: Record<string, string | null> = {
      bife: platos.id,
      ojo: platos.id,
      empanada: entradas.id,
      empanadaLocalOff: entradas.id,
      noDisponible: platos.id,
      sinFilaDisponibilidad: platos.id,
      mp: platos.id,
      soloOtra: platos.id,
      suelto: null,
      sinCategoria: null,
      trago: apagada.id,
    };
    await prisma.contenidoCartaProducto.createMany({
      data: [
        ...Object.entries(seccionDe).map(([k, seccionCartaId]) => ({ productoId: ids[k], visibleEnCarta: true, seccionCartaId })),
        { productoId: ids.oculto, visibleEnCarta: false, seccionCartaId: platos.id },
      ],
    });
    await prisma.contenidoCartaProducto.update({
      where: { productoId: ids.bife },
      data: { descripcion: "400 g", tags: ["Regional"], especial: true, orden: 2 },
    });
    await prisma.contenidoCartaProducto.update({ where: { productoId: ids.ojo }, data: { orden: 1 } });

    await prisma.precioLocalProducto.createMany({
      data: [
        { sucursalId: central, productoId: ids.empanada, precio: 3000, habilitado: true },
        { sucursalId: central, productoId: ids.empanadaLocalOff, precio: 9999, habilitado: false },
        { sucursalId: otra, productoId: ids.bife, precio: 1, habilitado: true },
      ],
    });

    await prisma.promoCarta.createMany({
      data: [
        { sucursalId: central, seccionCartaId: promos.id, titulo: "1 pizza + coca 1,5L", precio: 25000, orden: 1 },
        { sucursalId: central, seccionCartaId: promos.id, titulo: "Promo vieja", precio: 1, activa: false },
        { sucursalId: otra, seccionCartaId: promos.id, titulo: "Promo de la otra", precio: 1 },
        { sucursalId: central, seccionCartaId: apagada.id, titulo: "Promo en sección apagada", precio: 1 },
      ],
    });
  });

  it("sucursal inexistente o inactiva → null", async () => {
    expect(await resolverMenuCarta("no-existe")).toBeNull();
    expect(await resolverMenuCarta(inactiva)).toBeNull();
  });

  it("devuelve la carta v1 de la sucursal, con fecha ISO y la sucursal", async () => {
    const carta = await resolverMenuCarta(central, undefined, new Date("2026-09-24T10:00:00.000Z"));
    expect(carta?.version).toBe(1);
    expect(carta?.generadoEn).toBe("2026-09-24T10:00:00.000Z");
    expect(carta?.sucursal).toEqual({ id: central, nombre: "Central" });
  });

  it("solo entran PV disponibles acá Y visibles en la carta; secciones apagadas o vacías no aparecen", async () => {
    const carta = (await resolverMenuCarta(central))!;
    expect(carta.secciones.map((s) => s.nombre)).toEqual(["Entradas", "Platos Principales", "Promos"]);
    const nombres = carta.secciones.flatMap((s) => s.items.map((i) => i.nombre));
    expect(nombres.sort()).toEqual(["Bife de chorizo", "Empanada de carne", "Empanada de verdura", "Ojo de bife"]);
    for (const fuera of ["Bife apagado", "Bife sin fila", "Bife oculto", "Bife sin contenido", "Carne cruda", "Bife de la otra", "Plato suelto", "Sin categoría", "Fernet"]) {
      expect(nombres, fuera).not.toContain(fuera);
    }
  });

  it("la disponibilidad de otra sucursal no se filtra: la otra sucursal ve lo suyo", async () => {
    const carta = (await resolverMenuCarta(otra))!;
    const items = carta.secciones.flatMap((s) => s.items);
    expect(items.map((i) => i.nombre)).toEqual(["Bife de la otra"]);
    expect(carta.secciones.flatMap((s) => s.promos).map((p) => p.titulo)).toEqual(["Promo de la otra"]);
  });

  it("precio: el local habilitado pisa al de venta; el deshabilitado no; siempre numérico", async () => {
    const carta = (await resolverMenuCarta(central))!;
    const precio = Object.fromEntries(carta.secciones.flatMap((s) => s.items).map((i) => [i.nombre, i.precio]));
    expect(precio).toEqual({ "Bife de chorizo": 34000, "Ojo de bife": 36000, "Empanada de carne": 3000, "Empanada de verdura": 2400 });
    for (const v of Object.values(precio)) expect(typeof v).toBe("number");
  });

  it("contenido de carta: descripción, tags, especial; orden por ContenidoCartaProducto.orden dentro de la sección", async () => {
    const carta = (await resolverMenuCarta(central))!;
    const platos = carta.secciones.find((s) => s.nombre === "Platos Principales")!;
    expect(platos.titulo).toBe("Del fuego");
    expect(platos.descripcion).toBe("A las brasas");
    expect(platos.items.map((i) => i.nombre)).toEqual(["Ojo de bife", "Bife de chorizo"]);
    expect(platos.items[1]).toEqual({
      productoId: ids.bife,
      nombre: "Bife de chorizo",
      categoria: "Bife",
      descripcion: "400 g",
      precio: 34000,
      tags: ["Regional"],
      especial: true,
      imagenUrl: null,
    });
  });

  it("promos: solo las activas de esta sucursal y en secciones activas, con precio numérico", async () => {
    const carta = (await resolverMenuCarta(central))!;
    const promos = carta.secciones.flatMap((s) => s.promos);
    expect(promos).toEqual([{ id: expect.any(String), titulo: "1 pizza + coca 1,5L", descripcion: null, precio: 25000, orden: 1 }]);
  });

  it("diagnóstico: los PV visibles sin sección de carta, o con la suya apagada (no se exponen en la carta)", async () => {
    const armado = (await resolverMenuCartaConDiagnostico(central))!;
    expect(armado.diagnostico.visiblesSinSeccion.map((p) => p.nombre)).toEqual(["Fernet", "Plato suelto", "Sin categoría"]);
    expect(JSON.stringify(armado.carta)).not.toContain("visiblesSinSeccion");
  });

  it("la categoría no ubica nada: un PV sin categoría con sección sale (con `categoria` = su sección), y uno de «Bife» puede ir a Entradas", async () => {
    const entradas = await prisma.seccionCarta.findUniqueOrThrow({ where: { nombre: "Entradas" } });
    await prisma.contenidoCartaProducto.update({ where: { productoId: ids.sinCategoria }, data: { seccionCartaId: entradas.id } });
    await prisma.contenidoCartaProducto.update({ where: { productoId: ids.ojo }, data: { seccionCartaId: entradas.id } });
    const carta = (await resolverMenuCarta(central))!;
    const seccionEntradas = carta.secciones.find((s) => s.nombre === "Entradas")!;
    expect(seccionEntradas.items.map((i) => [i.nombre, i.categoria])).toEqual([
      ["Empanada de carne", "Empanadas"],
      ["Empanada de verdura", "Empanadas"],
      ["Sin categoría", "Entradas"],
      // orden 1 (los demás, 0): el orden de cada ítem manda, no su categoría.
      ["Ojo de bife", "Bife"],
    ]);
    expect(carta.secciones.find((s) => s.nombre === "Platos Principales")!.items.map((i) => i.nombre)).toEqual(["Bife de chorizo"]);
  });

  it("imagen: la de la sección sale; ningún ítem tiene imagen propia (imagenUrl siempre null)", async () => {
    await prisma.seccionCarta.update({ where: { nombre: "Platos Principales" }, data: { imagenUrl: "https://cdn.ejemplo.com/platos.jpg" } });
    const carta = (await resolverMenuCarta(central))!;
    const platos = carta.secciones.find((s) => s.nombre === "Platos Principales")!;
    expect(platos.imagenUrl).toBe("https://cdn.ejemplo.com/platos.jpg");
    for (const i of carta.secciones.flatMap((s) => s.items)) expect(i).toHaveProperty("imagenUrl", null);
  });

  it("apagar la disponibilidad saca el PV de la carta en la próxima lectura", async () => {
    await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: central, productoId: ids.bife } }, data: { disponible: false } });
    const carta = (await resolverMenuCarta(central))!;
    expect(carta.secciones.flatMap((s) => s.items).map((i) => i.nombre)).not.toContain("Bife de chorizo");
  });

  it("no escribe nada: la cantidad de filas de las tablas de carta y catálogo no cambia", async () => {
    const contar = async () =>
      Promise.all([prisma.seccionCarta.count(), prisma.contenidoCartaProducto.count(), prisma.promoCarta.count(), prisma.producto.count(), prisma.disponibilidadProducto.count()]);
    const antes = await contar();
    await resolverMenuCarta(central);
    await resolverMenuCarta(otra);
    expect(await contar()).toEqual(antes);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { cargarAdminCarta, estadoDelProductoEnLaCarta } from "../../src/server/consultas/carta/admin";
import { resolverMenuCarta } from "../../src/server/lecturas/carta/menu";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import type { EstadoEnLaCarta } from "../../src/core/catalogo/public";

/**
 * Fase 6, paso 6.17b: la lectura de UN producto en la carta (`cargarAdminCarta` con `soloProductoId` y `estadoDelProductoEnLaCarta`), contra Postgres real. Lo que se afirma:
 *  - la fila de un producto es IGUAL a la que trae el lote completo (con contenido, género, descuento y agrupado), y lo demás de la pantalla no cambia;
 *  - no trae contenido de otra sucursal: la carta es propia de cada sucursal (ADR-009);
 *  - el estado del producto coincide con lo que la carta pública muestra de verdad (`resolverMenuCarta`), con un caso de cada estado.
 */
describe("la carta de UN producto", () => {
  let sucursalA: string;
  let sucursalB: string;
  let seccionActiva: string;
  let seccionApagada: string;
  const ids: Record<string, string> = {};

  beforeEach(async () => {
    await limpiarBaseDeTest();
    for (const k of Object.keys(ids)) delete ids[k];
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    sucursalA = (await prisma.sucursal.create({ data: { nombre: "Sucursal A" } })).id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    seccionActiva = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
    seccionApagada = (await prisma.seccionCarta.create({ data: { nombre: "Apagada", orden: 2, activa: false } })).id;
    const genero = await prisma.generoCarta.create({ data: { sucursalId: sucursalA, nombre: "Pizzas", orden: 1 } });

    const pv = async (nombre: string, precioVenta: number, tambienEnB = false) => {
      const p = await sembrarProductoDisponible({ codigo: `PV_${nombre.toUpperCase().replace(/\W/g, "_")}`, nombre, tipo: "PV", precioVenta, unidadStockId: u.id }, sucursalA);
      if (tambienEnB) await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalB, productoId: p.id, disponible: true } });
      ids[nombre] = p.id;
      return p.id;
    };
    const contenido = (nombre: string, datos: { seccionCartaId: string | null; visibleEnCarta: boolean; sucursalId?: string } & Record<string, unknown>) =>
      prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalA, productoId: ids[nombre], orden: 3, descripcion: `Descripción de ${nombre}`, tags: ["Regional"], ...datos } });

    await pv("Visible", 10000, true);
    await contenido("Visible", { seccionCartaId: seccionActiva, visibleEnCarta: true, especial: true, generoCartaId: genero.id });
    await pv("Oculto", 11000);
    await contenido("Oculto", { seccionCartaId: seccionActiva, visibleEnCarta: false });
    await pv("Fuera", 12000);
    await pv("SinSeccion", 13000);
    await contenido("SinSeccion", { seccionCartaId: null, visibleEnCarta: true });
    await pv("SeccionApagada", 14000);
    await contenido("SeccionApagada", { seccionCartaId: seccionApagada, visibleEnCarta: true });
    // Dos agrupados: uno en un ítem prendido y otro en un ítem apagado.
    const prendido = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalA, nombre: "Gaseosas", seccionCartaId: seccionActiva, orden: 4 } });
    const apagado = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalA, nombre: "Cervezas", seccionCartaId: seccionActiva, orden: 5, activo: false } });
    await pv("Coca", 3000);
    await pv("Quilmes", 4000);
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: sucursalA, itemAgrupadoCartaId: prendido.id, productoId: ids["Coca"], orden: 0 } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: sucursalA, itemAgrupadoCartaId: apagado.id, productoId: ids["Quilmes"], orden: 0 } });
    // Un producto con carta SOLO en la otra sucursal (visible y con una descripción que no tiene que filtrarse a la carta de A).
    await pv("SoloEnB", 15000, true);
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalB, productoId: ids["SoloEnB"], seccionCartaId: seccionActiva, visibleEnCarta: true, descripcion: "SECRETO-DE-LA-SUCURSAL-B", tags: ["Solo B"], orden: 9 } });
    // Un producto que no está disponible en A (solo en B).
    const noDisponibleEnA = await prisma.producto.create({ data: { codigo: "PV_SOLO_B", nombre: "NoDisponibleEnA", tipo: "PV", precioVenta: 16000, unidadStockId: u.id } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalB, productoId: noDisponibleEnA.id, disponible: true } });
    ids["NoDisponibleEnA"] = noDisponibleEnA.id;
    // Descuento de producto en A (el lote lo trae por producto).
    await prisma.descuentoProductoSucursal.create({ data: { sucursalId: sucursalA, productoId: ids["Visible"], porcentaje: 15 } });
  });

  describe("cargarAdminCarta con soloProductoId", () => {
    it("trae exactamente la fila que el lote completo trae para ese producto (uno por uno, con todos los estados)", async () => {
      const lote = await cargarAdminCarta(sucursalA, prisma, AHORA_DE_LA_CORRIDA);
      expect(lote.productos.length).toBeGreaterThanOrEqual(8);
      // La comparación no es vacía: entre las filas hay descuento, género, agrupado y producto sin contenido.
      expect(lote.productos.some((p) => p.descuento === 15 && p.generoCarta === "Pizzas")).toBe(true);
      expect(lote.productos.some((p) => p.agrupadoEn === "Gaseosas")).toBe(true);
      expect(lote.productos.some((p) => p.contenido === null)).toBe(true);
      for (const fila of lote.productos) {
        const solo = await cargarAdminCarta(sucursalA, prisma, AHORA_DE_LA_CORRIDA, { soloProductoId: fila.id });
        expect(solo.productos, fila.nombre).toEqual([fila]);
      }
    });

    it("lo demás de la pantalla (secciones, géneros, promos, precio local, estado de la carta) es lo de siempre", async () => {
      const lote = await cargarAdminCarta(sucursalA, prisma, AHORA_DE_LA_CORRIDA);
      const solo = await cargarAdminCarta(sucursalA, prisma, AHORA_DE_LA_CORRIDA, { soloProductoId: ids["Visible"] });
      const sinProductos = ({ productos, sinContenido, ...resto }: typeof lote) => (void productos, void sinContenido, resto);
      const restoDelLote = sinProductos(lote);
      const restoDeUno = sinProductos(solo);
      expect(restoDeUno).toEqual(restoDelLote);
      expect(solo.sinContenido).toEqual([]);
      expect((await cargarAdminCarta(sucursalA, prisma, AHORA_DE_LA_CORRIDA, { soloProductoId: ids["Fuera"] })).sinContenido.map((p) => p.nombre)).toEqual(["Fuera"]);
    });

    it("un producto que no es un PV disponible acá, o que no existe, no trae ninguna fila", async () => {
      for (const soloProductoId of [ids["NoDisponibleEnA"], "no-existe-este-id"]) {
        expect((await cargarAdminCarta(sucursalA, prisma, AHORA_DE_LA_CORRIDA, { soloProductoId })).productos).toEqual([]);
      }
    });

    it("no trae el contenido de otra sucursal: en A «SoloEnB» no tiene contenido, en B sí (y solo el suyo)", async () => {
      const enA = await cargarAdminCarta(sucursalA, prisma, AHORA_DE_LA_CORRIDA, { soloProductoId: ids["SoloEnB"] });
      expect(enA.productos).toHaveLength(1);
      expect(enA.productos[0].contenido).toBeNull();
      expect(JSON.stringify(enA)).not.toContain("SECRETO-DE-LA-SUCURSAL-B");
      const enB = await cargarAdminCarta(sucursalB, prisma, AHORA_DE_LA_CORRIDA, { soloProductoId: ids["SoloEnB"] });
      expect(enB.productos[0].contenido?.descripcion).toBe("SECRETO-DE-LA-SUCURSAL-B");
      // Contraespejo: el producto con carta en A no la trae en B.
      const visibleEnB = await cargarAdminCarta(sucursalB, prisma, AHORA_DE_LA_CORRIDA, { soloProductoId: ids["Visible"] });
      expect(visibleEnB.productos[0].contenido).toBeNull();
      expect(JSON.stringify(visibleEnB)).not.toContain("Descripción de Visible");
    });
  });

  describe("estadoDelProductoEnLaCarta", () => {
    const esperado: Record<string, EstadoEnLaCarta> = {
      Visible: "visible",
      Oculto: "oculto",
      Fuera: "fuera",
      SinSeccion: "sin-seccion",
      SeccionApagada: "sin-seccion",
      Coca: "agrupado",
      Quilmes: "oculto",
      NoDisponibleEnA: "no-disponible",
    };

    it.each(Object.entries(esperado))("%s ⇒ %s", async (nombre, estado) => {
      expect(await estadoDelProductoEnLaCarta(prisma, sucursalA, ids[nombre])).toBe(estado);
    });

    it("un id que no existe es «no-disponible» (la carta tampoco distingue)", async () => {
      expect(await estadoDelProductoEnLaCarta(prisma, sucursalA, "no-existe-este-id")).toBe("no-disponible");
    });

    it("es de la carta de ESA sucursal: «SoloEnB» está visible en B y fuera en A", async () => {
      expect(await estadoDelProductoEnLaCarta(prisma, sucursalB, ids["SoloEnB"])).toBe("visible");
      expect(await estadoDelProductoEnLaCarta(prisma, sucursalA, ids["SoloEnB"])).toBe("fuera");
    });

    it("coincide con lo que la carta pública muestra de verdad: sale si y solo si el estado es visible o agrupado", async () => {
      const carta = await resolverMenuCarta(sucursalA, prisma, AHORA_DE_LA_CORRIDA);
      const quePublica = new Set(carta!.secciones.flatMap((s) => s.items.flatMap((i) => [i.nombre, ...(i.opciones ?? []).map((o) => o.nombre)])));
      for (const [nombre, estado] of Object.entries(esperado)) {
        expect(quePublica.has(nombre), `${nombre} (${estado})`).toBe(estado === "visible" || estado === "agrupado");
      }
    });
  });
});

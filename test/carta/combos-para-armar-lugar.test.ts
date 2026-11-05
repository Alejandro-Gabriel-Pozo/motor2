import { beforeEach, describe, expect, it } from "vitest";
import { cargarCombosDeLaCarta } from "../../src/server/consultas/carta/combos";
import { agregarEntradaDeCupoCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/agregar-entrada-de-cupo";
import { actorDeCombos, sembrarCombosGo3b, type EscenarioDeCombosGo3b } from "../setup/combos-go3b";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * Promo «a elegir» (etapa N1, PR B): lo que la pantalla de ADMINISTRACIÓN lee para armar un lugar (`cargarCombosDeLaCarta`) contra Postgres real, como `motor2_app` con el alcance de la sucursal A. Fija: de cada
 * producto de venta, DE DÓNDE sale en la carta de ESTA sucursal (suelto en una sección, dentro de un ítem agrupado —que manda sobre su contenido suelto— o «no está en la carta»), su categoría, y todos los grupos que
 * admite con sus límites y el ADICIONAL marcado; y que una entrada «a elegir» se nombra con sus opciones permitidas. La carta es PROPIA de cada sucursal: lo ubicado en la B no cuenta para la A.
 */
describe("lo que la administración lee para armar el lugar de una promo", () => {
  let e: EscenarioDeCombosGo3b;
  const actor = () => actorDeCombos(e.usuarioId, e.sucursalA);
  const leer = async () => (await cargarCombosDeLaCarta(actor().db, e.sucursalA)).productos;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarCombosGo3b();
  });

  it("cada producto trae su origen: la sección donde está suelto, la del ítem agrupado que lo contiene, o «no está en la carta»", async () => {
    const principales = await prisma.seccionCarta.create({ data: { nombre: "Platos principales" } });
    const entradas = await prisma.seccionCarta.create({ data: { nombre: "Entradas" } });
    // Suelto y visible en «Platos principales»; la Sopa, visible suelto en «Entradas» pero DENTRO de un ítem agrupado de «Platos principales»: manda el ítem (D3).
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: e.sucursalA, productoId: e.milanesaId, visibleEnCarta: true, seccionCartaId: principales.id } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: e.sucursalA, productoId: e.sopaId, visibleEnCarta: true, seccionCartaId: entradas.id } });
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: e.sucursalA, nombre: "Sopas", seccionCartaId: principales.id } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: e.sucursalA, itemAgrupadoCartaId: item.id, productoId: e.sopaId } });
    // Oculto (no visible en carta): «no está en la carta». Ubicado en la OTRA sucursal: no cuenta para la A.
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: e.sucursalA, productoId: e.guisoId, visibleEnCarta: false, seccionCartaId: null } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: e.sucursalB, productoId: e.flanId, visibleEnCarta: true, seccionCartaId: entradas.id } });

    const origenes = new Map((await leer()).map((p) => [p.productoId, p.seccionCartaId]));
    expect(origenes.get(e.milanesaId)).toBe(principales.id);
    expect(origenes.get(e.sopaId)).toBe(principales.id);
    expect(origenes.get(e.guisoId)).toBeNull();
    expect(origenes.get(e.flanId)).toBeNull();
  });

  it("trae la categoría del producto y TODOS los grupos que admite con sus límites, con el adicional marcado", async () => {
    const categoria = await prisma.categoriaProducto.create({ data: { nombre: "Bebidas calientes" } });
    await prisma.producto.update({ where: { id: e.cafeId }, data: { categoriaId: categoria.id } });
    const productos = await leer();
    expect(productos.find((p) => p.productoId === e.milanesaId)).toMatchObject({ categoria: null, gruposAElegir: [] });
    const cafe = productos.find((p) => p.productoId === e.cafeId)!;
    expect(cafe.categoria).toEqual({ id: categoria.id, nombre: "Bebidas calientes" });
    const porNombre = new Map(cafe.gruposAElegir.map((g) => [g.nombre, g]));
    expect([...porNombre.keys()].sort()).toEqual(["Extras", "Leche", "Tamaño", "Viene con"]);
    expect(porNombre.get("Extras")).toMatchObject({ adicional: true });
    expect(porNombre.get("Tamaño")).toMatchObject({ adicional: false, cantidadMinima: 1, cantidadMaxima: 1 });
    expect(porNombre.get("Tamaño")!.opciones.map((o) => o.opcionId)).toEqual(expect.arrayContaining([e.chicoId, e.medianoId]));
    // Solo los grupos de una sola elección y sin adicional siguen alimentando la configuración FIJA (lo de siempre).
    expect(cafe.grupos.map((g) => g.nombre).sort()).toEqual(["Leche", "Tamaño", "Viene con"]);
  });

  it("una entrada «el mozo elige» se nombra con sus opciones permitidas", async () => {
    const r = await agregarEntradaDeCupoCasoDeUso(actor(), { cupoId: e.cupoEntradaId, productoId: e.cafeId, modoDeOpciones: "A_ELEGIR", opciones: [{ opcionId: e.chicoId, cantidad: 10 }, { opcionId: e.medianoId, cantidad: 10 }, { opcionId: e.azucarId, cantidad: 10 }] });
    expect(r, r.mensaje).toMatchObject({ ok: true });
    const combos = await cargarCombosDeLaCarta(actor().db, e.sucursalA);
    const entrada = combos.porPromo[e.promoId]!.lugares.find((l) => l.id === e.cupoEntradaId)!.entradas[0]!;
    expect(entrada.activa).toBe(true);
    expect(entrada.nombre).toMatch(/^.+ · el mozo elige entre: .*Chico.*Mediano|.+ · el mozo elige entre: .*Mediano.*Chico/);
    expect(entrada.nombre).toContain("Azúcar");
  });
});

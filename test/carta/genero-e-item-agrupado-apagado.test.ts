import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// El interruptor APAGADO, como en producción (el setup global de los tests lo enciende; este archivo lo apaga a propósito).
vi.mock("../../src/core/carta/genero-e-item-agrupado", async (original) => ({ ...(await original<typeof import("../../src/core/carta/genero-e-item-agrupado")>()), GENERO_E_ITEM_AGRUPADO_VISIBLE: false }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { MENSAJE_GENERO_E_ITEM_AGRUPADO_APAGADO } from "../../src/core/carta/genero-e-item-agrupado";
import { guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";
import { guardarGeneroCarta } from "../../src/server/actions/carta/generos";
import { agregarOpcionItemAgrupadoCarta, guardarItemAgrupadoCarta, quitarOpcionItemAgrupadoCarta } from "../../src/server/actions/carta/items-agrupados";
import { agregarProductoALaCarta, quitarProductoDeLaCarta } from "../../src/server/actions/carta/mantenimiento";
import { sincronizarPrecioGrupoCarta } from "../../src/server/actions/catalogo/productos";
import { itemAgrupadoDelProductoEn, resolverGrupoDeProducto } from "../../src/server/lecturas/carta/grupo-de-producto";
import { resolverMenuCarta } from "../../src/server/lecturas/carta/menu";
import { cargarSelectorCartaPos } from "../../src/server/lecturas/pos/selector-carta";
import { fotoDeLaEstructura, sembrarCartaConGeneros } from "./genero-e-item-agrupado.semilla";

/**
 * Interruptor de género de carta e ítem agrupado APAGADO (el valor de producción, decisión del dueño 2026-11-06), con un género y un ítem agrupado YA cargados (como si alguien los hubiera
 * dejado): el servidor rechaza escribirlos aunque el pedido se arme a mano, y lo cargado ni se muestra ni se rompe. Los dos estados completos están en `genero-e-item-agrupado-combinaciones.test.ts`.
 */
describe("género e ítem agrupado APAGADOS, con datos cargados (contra Postgres)", () => {
  let s: Awaited<ReturnType<typeof sembrarCartaConGeneros>>;
  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarCartaConGeneros(true);
    await mockearUsuarioActual({ id: s.admin.id, email: s.admin.email, nombre: null });
  });

  it("el valor real del interruptor (sin ningún mock) es apagado", async () => {
    const real = await vi.importActual<typeof import("../../src/core/carta/genero-e-item-agrupado")>("../../src/core/carta/genero-e-item-agrupado");
    expect(real.GENERO_E_ITEM_AGRUPADO_VISIBLE).toBe(false);
  });

  it("falla cerrado: ninguna escritura de géneros o agrupados pasa, repetirla da lo mismo y no cambia nada", async () => {
    const antes = await fotoDeLaEstructura();
    const rechazo = { ok: false, mensaje: MENSAJE_GENERO_E_ITEM_AGRUPADO_APAGADO };
    for (let vez = 0; vez < 2; vez++) {
      expect(await guardarGeneroCarta({ nombre: "Gaseosas" })).toEqual(rechazo);
      expect(await guardarItemAgrupadoCarta({ nombre: "Otro", seccionCartaId: s.bebidas, productoIds: [s.ids.cafe] })).toEqual(rechazo);
      expect(await agregarOpcionItemAgrupadoCarta(s.agrupadoId!, s.ids.cafe)).toEqual(rechazo);
      expect(await quitarOpcionItemAgrupadoCarta(s.opcionPatagoniaId!)).toEqual(rechazo);
    }
    expect(await fotoDeLaEstructura()).toBe(antes);
  });

  it("guardar el contenido de un producto NO pisa el género que ya tenía ni deja asignar uno a mano", async () => {
    const generoDelCafe = () => prisma.contenidoCartaProducto.findFirstOrThrow({ where: { productoId: s.ids.cafe }, select: { generoCartaId: true } }).then((c) => c.generoCartaId);
    expect(await generoDelCafe()).toBe(s.generos!.agua);
    // El formulario (sin el campo) guarda otra descripción: el género queda como estaba.
    expect(await guardarContenidoCartaProducto(s.ids.cafe, { visibleEnCarta: true, seccionCartaId: s.bebidas, descripcion: "Espresso", orden: 1 })).toMatchObject({ ok: true });
    expect(await generoDelCafe()).toBe(s.generos!.agua);
    // Un pedido armado a mano con OTRO género se ignora (ni se valida ni se escribe).
    expect(await guardarContenidoCartaProducto(s.ids.cafe, { visibleEnCarta: true, seccionCartaId: s.bebidas, descripcion: "Espresso", orden: 1, generoCartaId: s.generos!.huinganco })).toMatchObject({ ok: true });
    expect(await generoDelCafe()).toBe(s.generos!.agua);
    // Un producto sin contenido previo queda sin género.
    expect(await guardarContenidoCartaProducto(s.ids.huinganco, { visibleEnCarta: true, seccionCartaId: s.bebidas, orden: 9, generoCartaId: s.generos!.agua })).toMatchObject({ ok: true });
    expect(await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { productoId: s.ids.huinganco } })).toMatchObject({ generoCartaId: null });
  });

  it("«aplicar el mismo precio» a los hermanos del agrupado no se ofrece (no hay grupo) ni se ejecuta: precios intactos", async () => {
    expect(await resolverGrupoDeProducto(s.ids.patagonia, s.sucursalId, prisma)).toBeNull();
    expect(await itemAgrupadoDelProductoEn(s.ids.patagonia, [s.sucursalId], prisma)).toBeNull();
    const antes = await fotoDeLaEstructura();
    const vistos = { [s.ids.patagonia]: 14000, [s.ids.huinganco]: 14000 };
    expect(await sincronizarPrecioGrupoCarta([s.ids.patagonia, s.ids.huinganco], 15000, vistos)).toEqual({ ok: false, mensaje: MENSAJE_GENERO_E_ITEM_AGRUPADO_APAGADO });
    expect(await fotoDeLaEstructura()).toBe(antes);
  });

  it("agregar y quitar un producto de la carta no lo trata como 'miembro de un agrupado' (la carta ignora los agrupados)", async () => {
    // La Cerveza Huinganco está en el agrupado oculto y sin contenido: se agrega suelta a Bebidas sin chocar con «ES_MIEMBRO_DE_AGRUPADO».
    const alta = await agregarProductoALaCarta({ sucursalId: s.sucursalId, productoId: s.ids.huinganco, seccionCartaId: s.bebidas });
    expect(alta, alta.mensaje).toMatchObject({ ok: true });
    const baja = await quitarProductoDeLaCarta({ sucursalId: s.sucursalId, productoId: s.ids.patagonia, confirmado: true });
    expect(baja.mensaje).toContain("volvió a «Fuera de carta»");
  });

  it("la carta pública y el POS dan la lista plana, sin errores, aunque los datos sigan en la base", async () => {
    const carta = await resolverMenuCarta(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    expect(carta?.secciones.find((x) => x.nombre === "Bebidas")?.items.map((i) => i.nombre).sort()).toEqual(["Café", "Capuccino", "Cerveza Patagonia"]);
    expect(carta?.secciones.flatMap((x) => x.items).some((i) => i.opciones)).toBe(false);
    const sel = await cargarSelectorCartaPos(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    const bebidas = sel.seccionesCarta.find((x) => x.nombre === "Bebidas")!;
    expect(bebidas.entradas.every((e) => e.tipo === "producto")).toBe(true);
    // Lo cargado sigue en la base (reversible): nada se borró.
    expect(await prisma.generoCarta.count()).toBe(3);
    expect(await prisma.itemAgrupadoCarta.count()).toBe(1);
    expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(2);
  });
});

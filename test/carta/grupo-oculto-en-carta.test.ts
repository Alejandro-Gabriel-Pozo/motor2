import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { darRecetaDeReventa } from "../setup/receta-de-venta";
import { sembrarCatalogoPrecioYCarta, type CatalogoPrecioYCarta } from "../setup/siembra-precio-y-carta";
import { sembrarSalon } from "../pos/salon-fixture";
import { basesDeUnEjeEnLaCarta } from "../../src/server/consultas/carta/admin";
import { cargarCartaParaMantener } from "../../src/server/consultas/carta/mantenimiento";
import { cargarVistaPreviaDeLaCarta } from "../../src/server/consultas/carta/vista-previa-de-un-producto";
import { resolverMenuCartaConDiagnostico } from "../../src/server/lecturas/carta/menu";

/**
 * «Mostrar este grupo en la carta» (decisión del dueño, 2026-10-29: plato por plato), paso 3: la carta LEE la columna `ProductoAdmiteGrupo.seMuestraEnCarta`, contra Postgres, con el bife del dueño
 * («vendo solo Bife y le pregunto al cliente si quiere ojo de bife o bife de chorizo, pero que no salga en la carta»): un producto «Bife» de $20.000 con el grupo «Corte» (variante obligatoria,
 * «Ojo de bife» y «Bife de chorizo», sin recargo).
 *  - con el interruptor prendido la carta pública lee la línea «Corte: …»; apagado, «Bife $20.000» sin aclaraciones (forma `simple`);
 *  - la carta impresa (`seccionesImpresas`) sigue la misma regla: con UN corte agotado hoy la carta en pantalla y la impresa son iguales; con los DOS agotados el plato sale de la pantalla (un grupo
 *    obligatorio sin nada que elegir: «no se puede pedir», se calcula con el grupo oculto incluido) y sigue en la impresa (DEC-20);
 *  - la vista previa del producto («En la carta de {sucursal}») y el «Va a mostrar» de Carta › Hoy leen lo mismo que la carta pública;
 *  - `basesDeUnEjeEnLaCarta` (el interruptor «Mostrar el nombre arriba»): una base con una proteína de filas («De …») es de dos ejes; con la proteína oculta pasa a ser de un solo eje;
 *  - si alguien le carga un recargo a un corte (una versión nueva desde la Biblioteca), la carta vuelve a mostrar el grupo SIN escribir nada: la decisión guardada sigue en `false` (I2).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let cat: CatalogoPrecioYCarta;
let bife: { productoId: string; grupoId: string; ojo: string; chorizo: string };

afterAll(async () => {
  await limpiarBaseDeTest();
});

/** El bife del dueño: PV directo de $20.000 en «Platos», con el grupo «Corte» (variante obligatoria de una elección, sin recargo). */
async function sembrarBife() {
  const pv = await prisma.producto.create({ data: { codigo: "PV_BIFE_DEL_DUENO", nombre: "Bife", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: "20000.00" } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: pv.id, disponible: true } });
  await darRecetaDeReventa(prisma, pv, { sucursalIds: [s.sucursalId] });
  const platos = [...cat.nombres.entries()].find(([, nombre]) => nombre === "seccion«Platos»")![0];
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: pv.id, visibleEnCarta: true, seccionCartaId: platos, orden: 9 } });
  const grupoId = (await prisma.grupoDeOpciones.create({ data: { nombre: "Corte", tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1 } })).id;
  await prisma.productoAdmiteGrupo.create({ data: { productoId: pv.id, grupoId, orden: 0 } });
  const opciones: Record<string, string> = {};
  for (const [orden, nombre] of ["Ojo de bife", "Bife de chorizo"].entries()) {
    const opcionId = (await prisma.opcionDeGrupo.create({ data: { grupoId, nombre, orden } })).id;
    await prisma.versionDeOpcion.create({ data: { opcionId, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: s.admin.id } });
    await prisma.productoAdmiteOpcion.create({ data: { productoId: pv.id, opcionId } });
    opciones[nombre] = opcionId;
  }
  bife = { productoId: pv.id, grupoId, ojo: opciones["Ojo de bife"]!, chorizo: opciones["Bife de chorizo"]! };
}

const ocultarElCorte = () => prismaAdmin.productoAdmiteGrupo.updateMany({ where: { productoId: bife.productoId, grupoId: bife.grupoId }, data: { seMuestraEnCarta: false } });
const agotar = (opcionId: string) => prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: s.sucursalId, opcionId, apagada: true, actualizadoPorId: s.admin.id } });

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  cat = await sembrarCatalogoPrecioYCarta(s);
  await sembrarBife();
});

const armada = async () => (await resolverMenuCartaConDiagnostico(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA, undefined, "publico", true))!.carta;
const itemDe = (secciones: readonly { items: readonly { nombre: string; precio: number; presentacion?: unknown }[] }[], nombre: string) => secciones.flatMap((x) => x.items).find((i) => i.nombre === nombre);

const LINEA_DEL_CORTE = { tipo: "eleccion", rotulo: "Corte", opciones: ["ojo de bife", "bife de chorizo"] };

describe("«Mostrar este grupo en la carta»: la carta pública y la impresa", () => {
  it("por defecto (la columna vale true) la carta lee el grupo: «Corte: ojo de bife o bife de chorizo»", async () => {
    expect(await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: bife.productoId }, select: { seMuestraEnCarta: true } })).toEqual({ seMuestraEnCarta: true });
    const item = itemDe((await armada()).secciones, "Bife")!;
    expect(item.precio).toBe(20000);
    expect(item.presentacion).toEqual({ forma: "simple", aclaraciones: [LINEA_DEL_CORTE] });
  });

  it("apagado y sin recargo, la carta pública muestra «Bife $20.000» sin aclaraciones", async () => {
    await ocultarElCorte();
    const item = itemDe((await armada()).secciones, "Bife")!;
    expect(item.precio).toBe(20000);
    expect(item.presentacion).toEqual({ forma: "simple", aclaraciones: [] });
  });

  it("con un corte agotado hoy y el grupo oculto, la carta en pantalla y la impresa son iguales: «Bife $20.000»", async () => {
    await ocultarElCorte();
    await agotar(bife.ojo);
    const carta = await armada();
    expect(itemDe(carta.secciones, "Bife")!.presentacion).toEqual({ forma: "simple", aclaraciones: [] });
    expect(carta.seccionesImpresas, "nada cambia en el papel: no viaja una carta aparte").toBeUndefined();
  });

  it("con los DOS cortes agotados hoy, Bife sale de la carta en pantalla pero sigue en la impresa, y sin el grupo", async () => {
    await ocultarElCorte();
    await agotar(bife.ojo);
    await agotar(bife.chorizo);
    const carta = await armada();
    expect(itemDe(carta.secciones, "Bife"), "un grupo obligatorio oculto sin nada que elegir: no se puede pedir").toBeUndefined();
    expect(itemDe(carta.seccionesImpresas!, "Bife")!.presentacion).toEqual({ forma: "simple", aclaraciones: [] });
    expect(itemDe(carta.seccionesImpresas!, "Wok de verduras"), "el resto de la carta sigue en el papel").toBeDefined();
  });

  it("con los dos agotados y el grupo SIN ocultar pasa lo mismo (ocultar no cambia qué se puede pedir): fuera de la pantalla, en la impresa con su línea", async () => {
    await agotar(bife.ojo);
    await agotar(bife.chorizo);
    const carta = await armada();
    expect(itemDe(carta.secciones, "Bife")).toBeUndefined();
    expect(itemDe(carta.seccionesImpresas!, "Bife")!.presentacion).toEqual({ forma: "simple", aclaraciones: [LINEA_DEL_CORTE] });
  });

  it("con un recargo de versión en «Ojo de bife» (+$500 desde la Biblioteca), la carta vuelve a mostrar el grupo aunque siga apagado, sin escribir nada", async () => {
    await ocultarElCorte();
    await prisma.versionDeOpcion.create({ data: { opcionId: bife.ojo, numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "500.00", creadoPorId: s.admin.id } });
    const item = itemDe((await armada()).secciones, "Bife")!;
    expect(item.presentacion).toEqual({
      forma: "lista",
      encabezado: true,
      filas: [
        { rotulo: "Ojo de bife", precio: 20500 },
        { rotulo: "Bife de chorizo", precio: 20000 },
      ],
      aclaraciones: [],
    });
    expect(await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: bife.productoId }, select: { seMuestraEnCarta: true, version: true } }), "la decisión del dueño sigue guardada, sin escribir").toEqual({ seMuestraEnCarta: false, version: 1 });
    // Si el recargo vuelve a 0, el grupo se oculta solo otra vez.
    await prisma.versionDeOpcion.create({ data: { opcionId: bife.ojo, numero: 3, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: s.admin.id } });
    expect(itemDe((await armada()).secciones, "Bife")!.presentacion).toEqual({ forma: "simple", aclaraciones: [] });
  });

  it("otro producto con el mismo grupo no se ve afectado: la decisión es de cada plato", async () => {
    await ocultarElCorte();
    const otro = await prisma.producto.create({ data: { codigo: "PV_LOMO", nombre: "Lomo", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: "25000.00" } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: otro.id, disponible: true } });
    await darRecetaDeReventa(prisma, otro, { sucursalIds: [s.sucursalId] });
    const platos = [...cat.nombres.entries()].find(([, nombre]) => nombre === "seccion«Platos»")![0];
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: otro.id, visibleEnCarta: true, seccionCartaId: platos, orden: 10 } });
    await prisma.productoAdmiteGrupo.create({ data: { productoId: otro.id, grupoId: bife.grupoId, orden: 0 } });
    for (const opcionId of [bife.ojo, bife.chorizo]) await prisma.productoAdmiteOpcion.create({ data: { productoId: otro.id, opcionId } });
    const carta = await armada();
    expect(itemDe(carta.secciones, "Bife")!.presentacion).toEqual({ forma: "simple", aclaraciones: [] });
    expect(itemDe(carta.secciones, "Lomo")!.presentacion).toEqual({ forma: "simple", aclaraciones: [LINEA_DEL_CORTE] });
  });
});

describe("«Mostrar este grupo en la carta»: la vista previa del producto y el «Va a mostrar» de Carta › Hoy", () => {
  const productoParaLaVistaPrevia = () => ({ id: bife.productoId, precioVenta: 20000, esBase: false });

  it("la vista previa «En la carta de {sucursal}» lee lo mismo que la carta pública", async () => {
    expect(await cargarVistaPreviaDeLaCarta(prisma, s.sucursalId, productoParaLaVistaPrevia(), false)).toEqual({ tipo: "forma", presentacion: { forma: "simple", aclaraciones: [LINEA_DEL_CORTE] }, rotulos: [] });
    await ocultarElCorte();
    expect(await cargarVistaPreviaDeLaCarta(prisma, s.sucursalId, productoParaLaVistaPrevia(), false)).toEqual({ tipo: "forma", presentacion: { forma: "simple", aclaraciones: [] }, rotulos: [] });
  });

  it("con los dos cortes agotados la vista previa sigue diciendo «no se puede pedir» (se calcula con el grupo oculto incluido)", async () => {
    await ocultarElCorte();
    await agotar(bife.ojo);
    await agotar(bife.chorizo);
    expect(await cargarVistaPreviaDeLaCarta(prisma, s.sucursalId, productoParaLaVistaPrevia(), false)).toEqual({ tipo: "no-se-puede-pedir" });
  });

  it("el «Va a mostrar» de un producto fuera de la carta: sin el grupo oculto, con su precio", async () => {
    await prisma.contenidoCartaProducto.deleteMany({ where: { sucursalId: s.sucursalId, productoId: bife.productoId } });
    const vistaPrevia = async () => (await cargarCartaParaMantener(prisma, s.sucursalId)).fueraDeCarta.find((p) => p.id === bife.productoId)?.vistaPrevia;
    expect(await vistaPrevia()).toBe("Va a mostrar «Bife» con su precio · Corte: ojo de bife o bife de chorizo.");
    await ocultarElCorte();
    expect(await vistaPrevia()).toBe("Va a mostrar «Bife» con su precio.");
  });
});

describe("«Mostrar este grupo en la carta»: «Mostrar el nombre arriba» (`basesDeUnEjeEnLaCarta`)", () => {
  it("una base con una proteína de filas («De …») es de dos ejes; con la proteína oculta pasa a ser de un solo eje y el interruptor aparece", async () => {
    const pv = await prisma.producto.create({ data: { codigo: "PV_BIFE_BASE", nombre: "Bife base", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: "0.00", modoDeVenta: "BASE_CONFIGURABLE" } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: pv.id, disponible: true } });
    const preparacion = (await prisma.grupoDeOpciones.create({ data: { nombre: "Preparación del bife", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 } })).id;
    await prisma.productoAdmiteGrupo.create({ data: { productoId: pv.id, grupoId: preparacion, orden: 0, modoPrecio: "ABSOLUTO" } });
    for (const [orden, nombre] of ["A la criolla", "Con chimichurri"].entries()) {
      const opcionId = (await prisma.opcionDeGrupo.create({ data: { grupoId: preparacion, nombre, orden } })).id;
      await prisma.versionDeOpcion.create({ data: { opcionId, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: s.admin.id } });
      await prisma.productoAdmiteOpcion.create({ data: { productoId: pv.id, opcionId, precioAbsoluto: "30000.00" } });
    }
    const proteina = (await prisma.grupoDeOpciones.create({ data: { nombre: "Proteína del bife", tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, prefijoEnCarta: "De" } })).id;
    await prisma.productoAdmiteGrupo.create({ data: { productoId: pv.id, grupoId: proteina, orden: 1 } });
    for (const [orden, nombre] of ["Nalga", "Bife de chorizo"].entries()) {
      const opcionId = (await prisma.opcionDeGrupo.create({ data: { grupoId: proteina, nombre, orden } })).id;
      await prisma.versionDeOpcion.create({ data: { opcionId, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: s.admin.id } });
      await prisma.productoAdmiteOpcion.create({ data: { productoId: pv.id, opcionId } });
    }
    expect((await basesDeUnEjeEnLaCarta(s.sucursalId, prisma)).has(pv.id), "dos ejes: tabla siempre con el nombre arriba").toBe(false);
    await prismaAdmin.productoAdmiteGrupo.updateMany({ where: { productoId: pv.id, grupoId: proteina }, data: { seMuestraEnCarta: false } });
    expect((await basesDeUnEjeEnLaCarta(s.sucursalId, prisma)).get(pv.id), "con la proteína oculta queda un solo eje: «Mostrar el nombre arriba» decide").toBe(false);
  });
});

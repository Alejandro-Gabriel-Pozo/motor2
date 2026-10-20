import { beforeEach, describe, expect, it, vi } from "vitest";

// S-26: la carta pública se cachea con `unstable_cache` (necesita el caché de Next, que fuera de un pedido no existe): en esta prueba corre directo.
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), unstable_cache: (fn: () => unknown) => fn }));

import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { cartaPublica, configPortalPublica, portalCartaPublico } from "../../src/server/carta-publica/sin-sesion";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * Lo que la carta pública devuelve SIN sesión está inventariado: cada clave que sale hacia el navegador figura en una lista cerrada
 * (S-25: se mide en la ENTRADA pública, `server/carta-publica/sin-sesion.ts`, la que ven las páginas —no en la lectura interna—, y la lista ya no tiene ningún id de fila; falla cerrado: un campo nuevo en la salida rompe esta prueba hasta que alguien lo revise y lo agregue acá) y ninguno de los datos
 * internos que el modelo guarda junto al producto, la sucursal o la empresa (canarios sembrados abajo) aparece en lo serializado.
 */
const CANARIO = "CANARIO-INTERNO-7f3a";
const empresa = { id: EMPRESA_POR_DEFECTO_ID, slug: "principal", nombre: "Principal" };

/** `a.b[].c` por cada clave de cada objeto del árbol (los arreglos se colapsan en `[]`). */
function rutasDeClaves(valor: unknown, prefijo = ""): string[] {
  if (Array.isArray(valor)) return valor.flatMap((v) => rutasDeClaves(v, `${prefijo}[]`));
  if (valor === null || typeof valor !== "object") return [];
  return Object.entries(valor as Record<string, unknown>).flatMap(([clave, v]) => {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    return [ruta, ...rutasDeClaves(v, ruta)];
  });
}

const unicas = (rutas: string[]) => [...new Set(rutas)].sort();

const CLAVES_DE_LA_CARTA = [
  "carta",
  "carta.generadoEn",
  "carta.secciones",
  "carta.secciones[].descripcion",
  "carta.secciones[].imagenUrl",
  "carta.secciones[].items",
  "carta.secciones[].items[].categoria",
  "carta.secciones[].items[].descripcion",
  "carta.secciones[].items[].descuentoPorcentaje",
  "carta.secciones[].items[].especial",
  "carta.secciones[].items[].imagenUrl",
  "carta.secciones[].items[].nombre",
  "carta.secciones[].items[].opciones",
  "carta.secciones[].items[].opciones[].nombre",
  "carta.secciones[].items[].opciones[].precio",
  "carta.secciones[].items[].precio",
  // GO-2d (GO-0 §4, aprobado por el dueño el 2026-10-13) y CARTA-B (variante B, 2026-10-14): SOLO las opciones de venta de un PV que CAMBIAN EL PRECIO, sin el tipo interno, sin ningún id y sin los
  // límites del grupo (obligatorio, máximo) ni el «desde»: la carta ya no los dibuja, así que dejaron de salir.
  "carta.secciones[].items[].grupos",
  "carta.secciones[].items[].grupos[].nombre",
  "carta.secciones[].items[].grupos[].opciones",
  "carta.secciones[].items[].grupos[].opciones[].nombre",
  "carta.secciones[].items[].grupos[].opciones[].precio",
  "carta.secciones[].items[].grupos[].opciones[].recargo",
  // Fase 5 («carta pareja», paso 2): la opción pasa a ser una unión DISCRIMINADA: `tipo` dice si es un precio final («final») o un recargo («recargo»). Una sola clave nueva, con dos valores fijos (no
  // es el tipo interno del grupo: «MEDIDA»/«ADICIONAL» siguen sin salir, lo vigila el canario de abajo).
  "carta.secciones[].items[].grupos[].opciones[].tipo",
  // CARTA-C (pastillas, decisión del dueño 2026-10-14): UN campo nuevo por ítem, SOLO textos: el nombre del grupo y los nombres de sus opciones SIN costo (preparación, guarnición, punto de
  // cocción), que antes no salían. Sin ids, sin precios, sin la «ninguna» ni lo agotado (se decide en el servidor). El ítem sin ninguna no lleva la clave.
  "carta.secciones[].items[].opcionesSinCosto",
  "carta.secciones[].items[].opcionesSinCosto[].grupo",
  "carta.secciones[].items[].opcionesSinCosto[].opciones",
  "carta.secciones[].items[].precioLista",
  // Fase 5 («carta pareja», paso 7; aditivo): la FORMA ya resuelta en el servidor de un PV con opciones. Solo rótulos (el nombre del grupo o la opción como se lee) y precios finales o recargos: sin
  // ids, sin el tipo interno del grupo («MEDIDA», «ADICIONAL»), sin el prefijo suelto ni «Mostrar el nombre arriba» (salen ya aplicados). `tipo` de una aclaración y `forma` tienen valores fijos.
  "carta.secciones[].items[].presentacion",
  "carta.secciones[].items[].presentacion.aclaraciones",
  "carta.secciones[].items[].presentacion.aclaraciones[].opciones",
  "carta.secciones[].items[].presentacion.aclaraciones[].opciones[].nombre",
  "carta.secciones[].items[].presentacion.aclaraciones[].opciones[].recargo",
  "carta.secciones[].items[].presentacion.aclaraciones[].rotulo",
  "carta.secciones[].items[].presentacion.aclaraciones[].tipo",
  "carta.secciones[].items[].presentacion.celdas",
  "carta.secciones[].items[].presentacion.columnas",
  "carta.secciones[].items[].presentacion.encabezado",
  // Fase 5 tanda C (aditivo): quién protagoniza una lista; valor fijo.
  "carta.secciones[].items[].presentacion.protagonista",
  "carta.secciones[].items[].presentacion.filas",
  "carta.secciones[].items[].presentacion.filas[].celdas",
  "carta.secciones[].items[].presentacion.filas[].precio",
  "carta.secciones[].items[].presentacion.filas[].rotulo",
  "carta.secciones[].items[].presentacion.forma",
  "carta.secciones[].items[].tags",
  "carta.secciones[].nombre",
  "carta.secciones[].orden",
  "carta.secciones[].promos",
  "carta.secciones[].promos[].descripcion",
  "carta.secciones[].promos[].orden",
  "carta.secciones[].promos[].precio",
  "carta.secciones[].promos[].titulo",
  // Fase 5 (paso 7; aditivo): las tandas de columnas compartidas de la sección (índices de sus ítems y los rótulos de las columnas). Solo si hay alguna.
  "carta.secciones[].tandas",
  "carta.secciones[].tandas[].primero",
  "carta.secciones[].tandas[].rotulos",
  "carta.secciones[].tandas[].ultimo",
  "carta.secciones[].titulo",
  "carta.sucursal",
  "carta.sucursal.nombre",
  "carta.version",
];

/**
 * Fase 5, paso 10b (DEC-20; aditivo): si hoy hay algo agotado, la carta COMPLETA del papel (`seccionesImpresas`), con EXACTAMENTE las mismas claves que `secciones` (la misma proyección, campo por
 * campo): ninguna clave propia.
 */
const CLAVES_DE_LA_CARTA_CON_PAPEL = [
  ...CLAVES_DE_LA_CARTA,
  "carta.seccionesImpresas",
  ...CLAVES_DE_LA_CARTA.filter((r) => r.startsWith("carta.secciones[]")).map((r) => r.replace(/^carta\.secciones\[\]/, "carta.seccionesImpresas[]")),
];

describe("la salida de la carta pública está inventariada", () => {
  let central: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    central = (await prisma.sucursal.create({ data: { nombre: "Central", maxMesasAbiertas: 4242 } })).id;
    await prisma.sucursalPublica.create({ data: { sucursalId: central, slug: "central", publicada: true } });
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
    const unico = await prisma.producto.create({
      data: {
        codigo: `COD-${CANARIO}`,
        nombre: "Bife",
        tipo: "PV",
        precioVenta: 1000,
        unidadStockId: u.id,
        observaciones: `obs ${CANARIO}`,
        esConsignacion: true,
        precioConsignacion: 555.55,
      },
    });
    const otro = await prisma.producto.create({ data: { codigo: "OPC", nombre: "Opción", tipo: "PV", precioVenta: 900, unidadStockId: u.id } });
    for (const p of [unico, otro]) await prisma.disponibilidadProducto.create({ data: { sucursalId: central, productoId: p.id, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: central, productoId: unico.id, visibleEnCarta: true, seccionCartaId: seccion.id, descripcion: "400 g", tags: ["Regional"], especial: true } });
    await prisma.descuentoProductoSucursal.create({ data: { productoId: unico.id, sucursalId: central, porcentaje: 10 } });
    const agrupado = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: central, nombre: "Combo", seccionCartaId: seccion.id, orden: 2 } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: central, itemAgrupadoCartaId: agrupado.id, productoId: otro.id, orden: 0 } });
    await prisma.promoCarta.create({ data: { seccionCartaId: seccion.id, titulo: "Promo", descripcion: "x", precio: 100, sucursales: { create: [{ sucursalId: central }] } } });

    // GO-2d: un café con opciones (tamaño, leche con una agotada, un adicional) y 10 % de descuento, y un té cuyo único tamaño está agotado (no se puede pedir: no sale). Canarios de
    // lo que NUNCA sale: la alícuota del producto, el factor de escala y el consumo de la versión, y el código del producto que respalda el adicional.
    const autor = await prisma.user.create({ data: { email: "autor-opciones@test.com" } });
    const leche = await prisma.producto.create({ data: { codigo: "MP-LECHE", nombre: "Leche", tipo: "MP", unidadStockId: u.id } });
    const cafe = await prisma.producto.create({ data: { codigo: "PV-CAFE", nombre: "Café", tipo: "PV", precioVenta: 1000, unidadStockId: u.id, alicuotaIvaVenta: "IVA_27" } });
    const te = await prisma.producto.create({ data: { codigo: "PV-TE", nombre: "Té", tipo: "PV", precioVenta: 800, unidadStockId: u.id } });
    const ancla = await prisma.producto.create({ data: { codigo: `ANCLA-${CANARIO}`, nombre: "Medialuna", tipo: "PV", precioVenta: 0, unidadStockId: u.id } });
    for (const [orden, p] of [cafe, te].entries()) {
      await prisma.disponibilidadProducto.create({ data: { sucursalId: central, productoId: p.id, disponible: true } });
      await prisma.contenidoCartaProducto.create({ data: { sucursalId: central, productoId: p.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 10 + orden } });
    }
    await prisma.descuentoProductoSucursal.create({ data: { productoId: cafe.id, sucursalId: central, porcentaje: 10 } });
    const grupo = async (nombre: string, tipo: string, cantidadMinima: number, cantidadMaxima: number) => (await prisma.grupoDeOpciones.create({ data: { nombre, tipo, cantidadMinima, cantidadMaxima } })).id;
    const opcion = async (grupoId: string, nombre: string, orden: number, diferenciaPrecio: string, extra: { productoId?: string; factorEscala?: string } = {}) => {
      const o = await prisma.opcionDeGrupo.create({ data: { grupoId, nombre, orden, ...(extra.productoId ? { productoId: extra.productoId } : {}) } });
      const v = await prisma.versionDeOpcion.create({ data: { opcionId: o.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio, factorEscala: extra.factorEscala ?? null, creadoPorId: autor.id } });
      return { opcionId: o.id, versionId: v.id };
    };
    const tamano = await grupo("Tamaño", "MEDIDA", 1, 1);
    const chico = await opcion(tamano, "Chico", 1, "-100.00", { factorEscala: "1.2345" });
    const grande = await opcion(tamano, "Grande", 2, "300.00", { factorEscala: "1.5000" });
    const lecheGrupo = await grupo("Leche", "VARIANTE", 0, 1);
    const vaca = await opcion(lecheGrupo, "Vaca", 1, "0.00");
    const agotada = await opcion(lecheGrupo, "Agotada hoy", 2, "50.00");
    const extras = await grupo("Extras", "ADICIONAL", 0, 2);
    const medialuna = await opcion(extras, "Medialuna", 1, "600.00", { productoId: ancla.id });
    await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: medialuna.versionId, efecto: "SUMA", insumoProductoId: leche.id, cantidad: "0.7777", unidadId: u.id } });
    await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: central, opcionId: agotada.opcionId, apagada: true, actualizadoPorId: autor.id } });
    for (const [orden, grupoId] of [tamano, lecheGrupo, extras].entries()) await prisma.productoAdmiteGrupo.create({ data: { productoId: cafe.id, grupoId, orden, ...(grupoId === tamano ? { modoPrecio: "DIFERENCIA" } : {}) } });
    for (const o of [chico, grande, vaca, agotada]) await prisma.productoAdmiteOpcion.create({ data: { productoId: cafe.id, opcionId: o.opcionId } });
    await prisma.productoAdmiteOpcion.create({ data: { productoId: cafe.id, opcionId: medialuna.opcionId, cantidadMaxima: 2 } });
    const taza = await grupo("Taza", "MEDIDA", 1, 1);
    const unica = await opcion(taza, "Única", 1, "0.00");
    await prisma.productoAdmiteGrupo.create({ data: { productoId: te.id, grupoId: taza, orden: 0, modoPrecio: "DIFERENCIA" } });
    await prisma.productoAdmiteOpcion.create({ data: { productoId: te.id, opcionId: unica.opcionId } });
    await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: central, opcionId: unica.opcionId, apagada: true, actualizadoPorId: autor.id } });

    // CARTA-B y CARTA-C: una milanesa cuya guarnición (Puré, Papas) y punto de cocción (una sola opción) no cambian el precio, y un jugo cuyos dos tamaños cuestan lo mismo (no sale la lista de precios).
    const milanesa = await prisma.producto.create({ data: { codigo: "PV-MILA", nombre: "Milanesa", tipo: "PV", precioVenta: 9500, unidadStockId: u.id } });
    const jugo = await prisma.producto.create({ data: { codigo: "PV-JUGO", nombre: "Jugo", tipo: "PV", precioVenta: 2000, unidadStockId: u.id } });
    for (const [orden, p] of [milanesa, jugo].entries()) {
      await prisma.disponibilidadProducto.create({ data: { sucursalId: central, productoId: p.id, disponible: true } });
      await prisma.contenidoCartaProducto.create({ data: { sucursalId: central, productoId: p.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 20 + orden } });
    }
    const guarnicion = await grupo("Guarnición", "INCLUIDA", 1, 1);
    const pure = await opcion(guarnicion, "Puré", 1, "0.00");
    const papas = await opcion(guarnicion, "Papas", 2, "0.00");
    const cocion = await grupo("Punto de cocción", "VARIANTE", 1, 1);
    const jugoso = await opcion(cocion, "Jugoso", 1, "0.00");
    await prisma.productoAdmiteGrupo.create({ data: { productoId: milanesa.id, grupoId: guarnicion, orden: 0 } });
    await prisma.productoAdmiteGrupo.create({ data: { productoId: milanesa.id, grupoId: cocion, orden: 1 } });
    for (const o of [pure, papas, jugoso]) await prisma.productoAdmiteOpcion.create({ data: { productoId: milanesa.id, opcionId: o.opcionId } });
    const vaso = await grupo("Vaso", "MEDIDA", 1, 1);
    const chicoJugo = await opcion(vaso, "Chico", 1, "0.00");
    const grandeJugo = await opcion(vaso, "Grande", 2, "0.00");
    await prisma.productoAdmiteGrupo.create({ data: { productoId: jugo.id, grupoId: vaso, orden: 0, modoPrecio: "DIFERENCIA" } });
    for (const o of [chicoJugo, grandeJugo]) await prisma.productoAdmiteOpcion.create({ data: { productoId: jugo.id, opcionId: o.opcionId } });
  });

  it("carta: cada clave que sale está en la lista cerrada, y el costo/consignación/observaciones internos no viajan", async () => {
    const resuelta = await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA);
    expect(resuelta).not.toBeNull();
    const { carta, estilo } = resuelta!;
    expect(carta.secciones[0].items.some((i) => i.precioLista !== undefined)).toBe(true);
    expect(carta.secciones[0].items.some((i) => i.opciones !== undefined)).toBe(true);
    expect(carta.secciones[0].promos).toHaveLength(1);

    const sobrantes = unicas(rutasDeClaves({ carta })).filter((r) => !CLAVES_DE_LA_CARTA_CON_PAPEL.includes(r));
    expect(sobrantes, "la carta pública emite una clave nueva: revisá que sea pública y agregala a CLAVES_DE_LA_CARTA").toEqual([]);

    const serializado = JSON.stringify({ carta, estilo });
    for (const interno of [CANARIO, "555.55", "4242", "COD-", "IVA_27", "1.2345", "0.7777", "ANCLA-", "MEDIDA", "ADICIONAL"]) expect(serializado, `la salida pública contiene «${interno}»`).not.toContain(interno);
  });

  it("paso 10b (DEC-20): con algo agotado hoy, la carta del papel sale COMPLETA (el té, cuyo único tamaño está agotado, y la leche agotada) y la de la pantalla no", async () => {
    const { carta } = (await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA))!;
    expect(carta.secciones[0].items.map((i) => i.nombre)).not.toContain("Té");
    const papel = carta.seccionesImpresas![0].items;
    expect(papel.map((i) => i.nombre)).toContain("Té");
    // En papel la leche agotada vuelve: suma dentro del precio y el café tiene descuento, así que no se puede leer exacta en una forma y el café sale como antes (con sus `grupos`).
    expect(papel.find((i) => i.nombre === "Café")!.grupos).toContainEqual({ nombre: "Leche", opciones: [{ nombre: "Agotada hoy", tipo: "recargo", recargo: 50 }] });
    // Sin nada agotado hoy, no viaja la carta del papel (es la misma que la de la pantalla).
    await prisma.opcionApagadaEnSucursal.updateMany({ data: { apagada: false } });
    expect("seccionesImpresas" in (await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA))!.carta).toBe(false);
  });

  it("GO-2d y CARTA-B: el café sale SOLO con lo que cambia el precio (lo agotado y lo gratis no), el descuento solo sobre el tamaño, y el té sin nada para elegir no sale", async () => {
    const { carta } = (await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA))!;
    const items = carta.secciones[0].items;
    expect(items.map((i) => i.nombre)).not.toContain("Té");
    expect(items.find((i) => i.nombre === "Café")).toEqual({
      nombre: "Café",
      categoria: "Platos",
      descripcion: null,
      // Lo más barato con lo que se pide (Chico: 1.000 − 100) con el 10 % sobre el tamaño; el tachado, sin descuento.
      precio: 810,
      precioLista: 900,
      descuentoPorcentaje: 10,
      tags: [],
      especial: false,
      imagenUrl: null,
      grupos: [
        { nombre: "Tamaño", opciones: [{ nombre: "Chico", tipo: "final", precio: 810 }, { nombre: "Grande", tipo: "final", precio: 1170 }] },
        // El recargo del adicional NO lleva el descuento de producto.
        { nombre: "Extras", opciones: [{ nombre: "Medialuna", tipo: "recargo", recargo: 600 }] },
      ],
      // «Leche» (Vaca, sin costo; la otra, agotada hoy) se queda con UNA sola opción disponible: no hay nada que elegir, no sale como pastillas.
      // Fase 5 («carta pareja», paso 7): la forma, ya resuelta: una fila de una tanda con el precio de cada tamaño (con el descuento sobre lo compuesto) y el adicional SIN descuento.
      presentacion: { forma: "columnas", celdas: [810, 1170], aclaraciones: [{ tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "medialuna", recargo: 600 }] }] },
    });
    expect(Object.keys(items.find((i) => i.nombre === "Café")!)).not.toContain("opcionesSinCosto");
    const indiceDelCafe = items.findIndex((i) => i.nombre === "Café");
    expect(carta.secciones[0].tandas).toEqual([{ primero: indiceDelCafe, ultimo: indiceDelCafe, rotulos: ["Chico", "Grande"] }]);
  });

  it("CARTA-C: la milanesa lleva su guarnición como pastillas (el punto de cocción, con una sola opción, no), el jugo sus tamaños iguales como pastillas «Vaso», y ninguno lleva `grupos`", async () => {
    const { carta } = (await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA))!;
    const items = carta.secciones[0].items;
    expect(items.find((i) => i.nombre === "Milanesa")).toEqual({
      nombre: "Milanesa",
      categoria: "Platos",
      descripcion: null,
      precio: 9500,
      tags: [],
      especial: false,
      imagenUrl: null,
      opcionesSinCosto: [{ grupo: "Guarnición", opciones: ["Puré", "Papas"] }],
      presentacion: { forma: "simple", aclaraciones: [{ tipo: "eleccion", rotulo: "Guarnición", opciones: ["puré", "papas"] }] },
    });
    expect(items.find((i) => i.nombre === "Jugo")).toEqual({
      nombre: "Jugo",
      categoria: "Platos",
      descripcion: null,
      precio: 2000,
      tags: [],
      especial: false,
      imagenUrl: null,
      opcionesSinCosto: [{ grupo: "Vaso", opciones: ["Chico", "Grande"] }],
      presentacion: { forma: "simple", aclaraciones: [{ tipo: "eleccion", rotulo: "Vaso", opciones: ["chico", "grande"] }] },
    });
    // La carta de la PANTALLA (la del papel, completa, puede llevar lo agotado hoy: lo prueba el paso 10b).
    const serializado = JSON.stringify(carta.secciones);
    for (const oculto of ["Punto de cocción", "Jugoso", "Agotada hoy", "Vaca"]) expect(serializado, `la carta muestra «${oculto}»: una sola opción o agotada, no hay nada que elegir`).not.toContain(oculto);
  });

  it("portal: solo slug/etiqueta/subtítulo/posición; la configuración del portal no trae ids ni datos de la empresa", async () => {
    await prisma.sucursalPublica.update({ where: { empresaId_slug: { empresaId: empresa.id, slug: "central" } }, data: { posX: 10, posY: 20, posW: 30, posH: 5 } });
    const portal = await portalCartaPublico(empresa);
    expect(unicas(rutasDeClaves(portal))).toEqual(["[].etiqueta", "[].posicion", "[].posicion.h", "[].posicion.w", "[].posicion.x", "[].posicion.y", "[].slug", "[].subtitulo"]);
    const config = await configPortalPublica(empresa);
    expect(JSON.stringify(config)).not.toContain(empresa.id);
    expect(JSON.stringify(portal)).not.toContain(central);
  });
});

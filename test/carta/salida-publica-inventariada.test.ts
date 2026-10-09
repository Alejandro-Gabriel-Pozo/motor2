import { beforeEach, describe, expect, it } from "vitest";
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
  "carta.secciones[].items[].precioLista",
  "carta.secciones[].items[].tags",
  "carta.secciones[].nombre",
  "carta.secciones[].orden",
  "carta.secciones[].promos",
  "carta.secciones[].promos[].descripcion",
  "carta.secciones[].promos[].orden",
  "carta.secciones[].promos[].precio",
  "carta.secciones[].promos[].titulo",
  "carta.secciones[].titulo",
  "carta.sucursal",
  "carta.sucursal.nombre",
  "carta.version",
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
  });

  it("carta: cada clave que sale está en la lista cerrada, y el costo/consignación/observaciones internos no viajan", async () => {
    const resuelta = await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA);
    expect(resuelta).not.toBeNull();
    const { carta, estilo } = resuelta!;
    expect(carta.secciones[0].items.some((i) => i.precioLista !== undefined)).toBe(true);
    expect(carta.secciones[0].items.some((i) => i.opciones !== undefined)).toBe(true);
    expect(carta.secciones[0].promos).toHaveLength(1);

    const sobrantes = unicas(rutasDeClaves({ carta })).filter((r) => !CLAVES_DE_LA_CARTA.includes(r));
    expect(sobrantes, "la carta pública emite una clave nueva: revisá que sea pública y agregala a CLAVES_DE_LA_CARTA").toEqual([]);

    const serializado = JSON.stringify({ carta, estilo });
    for (const interno of [CANARIO, "555.55", "4242", "COD-"]) expect(serializado, `la salida pública contiene «${interno}»`).not.toContain(interno);
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

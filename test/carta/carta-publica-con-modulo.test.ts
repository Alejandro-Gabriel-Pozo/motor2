import { beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { fijarModulosActivos } from "../setup/modulos";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { cartaPublica, configPortalPublica, empresaCartaPublica, portalCartaPublico } from "../../src/server/carta-publica/sin-sesion";

/**
 * S-23 (plan de endurecimiento de seguridad, tanda T9; D2 del dueño, decisión 15: «la carta pública no se publica con el módulo apagado»).
 *
 * El ATAQUE (o, sin atacante, el error de configuración que lo vuelve una brecha): la carta pública resolvía la empresa por su slug y la sucursal por su
 * registro público, y NUNCA miraba el registro de módulos. Una empresa que no contrató Carta (o a la que la consola se la apagó) seguía publicando su carta
 * a cualquier anónimo que conociera el slug; y sin Promociones, seguía publicando sus promos. Los módulos se hacen cumplir en el servidor (el gate de cada
 * acción), pero esta puerta no pasa por el gate: no hay sesión.
 *
 * Esta prueba va por la ENTRADA pública (`server/carta-publica/sin-sesion.ts`, lo que importan las páginas), con la empresa resuelta por su slug desde la base,
 * no por la lectura interna: es el último punto donde se decide.
 */
const E = EMPRESA_POR_DEFECTO_ID;
const SLUG = "principal";
/** Registros de la empresa (la clausura del catálogo manda): `carta` requiere `catalogo_basico`; `promociones` requiere `carta`. */
const CON_TODO = ["carta", "promociones"];
const SIN_PROMOCIONES = ["carta"];
const SIN_CARTA = ["stock"];

async function sembrarCartaPublicada() {
  const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
  const central = await prisma.sucursal.create({ data: { nombre: "Central" } });
  await prisma.sucursalPublica.create({ data: { sucursalId: central.id, slug: "central", publicada: true } });
  const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
  const bife = await prisma.producto.create({ data: { codigo: "BIFE", nombre: "Bife", tipo: "PV", precioVenta: 1000, unidadStockId: u.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId: central.id, productoId: bife.id, disponible: true } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: central.id, productoId: bife.id, visibleEnCarta: true, seccionCartaId: platos.id } });
  await prisma.promoCarta.create({ data: { seccionCartaId: platos.id, titulo: "Promo del día", precio: 100, sucursales: { create: [{ sucursalId: central.id }] } } });
}

async function empresaPublica() {
  const empresa = await empresaCartaPublica(SLUG);
  expect(empresa, "la empresa de prueba tiene que resolver por su slug (ACTIVE)").not.toBeNull();
  return empresa!;
}

describe("S-23: la carta pública se publica solo con los módulos contratados", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    await sembrarCartaPublicada();
  });

  it("control: con Carta y Promociones la carta sale con su ítem y su promo, y el portal lista la sucursal", async () => {
    await fijarModulosActivos(E, CON_TODO);
    const empresa = await empresaPublica();
    const resuelta = await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA);
    expect(resuelta).not.toBeNull();
    expect(resuelta!.carta.secciones[0].items.map((i) => i.nombre)).toEqual(["Bife"]);
    expect(resuelta!.carta.secciones[0].promos.map((p) => p.titulo)).toEqual(["Promo del día"]);
    expect((await portalCartaPublico(empresa)).map((s) => s.slug)).toEqual(["central"]);
  });

  it("ATAQUE: con Carta apagada la carta de una sucursal publicada NO se sirve (404, el mismo null que un slug inexistente)", async () => {
    await fijarModulosActivos(E, SIN_CARTA);
    const empresa = await empresaPublica();
    expect(await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA)).toBeNull();
  });

  it("ATAQUE: con Carta apagada el portal no lista ninguna sucursal ni entrega la apariencia de la empresa", async () => {
    await fijarModulosActivos(E, SIN_CARTA);
    const empresa = await empresaPublica();
    expect(await portalCartaPublico(empresa)).toEqual([]);
    await prisma.portalCartaEmpresa.create({ data: { valores: { portal_titulo: "Titulo propio del portal" } } });
    const apariencia = await configPortalPublica(empresa);
    expect(JSON.stringify(apariencia)).not.toContain("Titulo propio del portal");
  });

  it("falla cerrado: una empresa sin ninguna fila en el registro de módulos no publica nada", async () => {
    await fijarModulosActivos(E, []);
    const empresa = await empresaPublica();
    expect(await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA)).toBeNull();
    expect(await portalCartaPublico(empresa)).toEqual([]);
  });

  it("falla cerrado: un módulo con la fila INACTIVA tampoco publica (solo cuenta el estado ACTIVO)", async () => {
    await fijarModulosActivos(E, SIN_PROMOCIONES);
    await prismaAdmin.moduloEmpresa.updateMany({ where: { empresaId: E, modulo: "carta" }, data: { estado: "INACTIVO" } });
    const empresa = await empresaPublica();
    expect(await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA)).toBeNull();
  });

  it("ATAQUE: con Promociones apagado y Carta prendida, la carta se sirve pero SIN las promos", async () => {
    await fijarModulosActivos(E, SIN_PROMOCIONES);
    const empresa = await empresaPublica();
    const resuelta = await cartaPublica(empresa, "central", AHORA_DE_LA_CORRIDA);
    expect(resuelta).not.toBeNull();
    expect(resuelta!.carta.secciones[0].items.map((i) => i.nombre)).toEqual(["Bife"]);
    expect(resuelta!.carta.secciones[0].promos).toEqual([]);
    expect(JSON.stringify(resuelta)).not.toContain("Promo del día");
  });
});

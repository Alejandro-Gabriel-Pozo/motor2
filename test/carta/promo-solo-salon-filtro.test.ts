import { beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarSalon } from "../pos/salon-fixture";
import { dbDeEmpresa } from "../../src/server/sesion/base";
import { wherePromoOfrecidaEn, type AudienciaDePromo } from "../../src/core/carta/promo-sucursal";
import { resolverCartaPublica } from "../../src/server/lecturas/carta/publica";
import { resolverMenuCarta, resolverMenuCartaConDiagnostico } from "../../src/server/lecturas/carta/menu";
import { cargarSelectorCartaPos } from "../../src/server/lecturas/pos/selector-carta";
import { cargarPromoCartaParaAgregar } from "../../src/server/lecturas/pos/promo-para-agregar";
import { resumirParametrizacionDeCarta } from "../../src/server/consultas/carta/mantenimiento";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

const empresa = { id: EMPRESA_POR_DEFECTO_ID, slug: "principal", nombre: "Principal" };
const basesDe = (empresaId: string) => ({
  deLaEmpresa: dbDeEmpresa(empresaId),
  deLaSucursal: (sucursalId: string) => dbDeEmpresa(empresaId, { lectura: [sucursalId], escritura: [] }),
});

/**
 * Interruptor «solo salón» (docs/diseno-promo-solo-salon-2026-10-26.md, paso 3), contra Postgres real. Invariantes: I1 una promo en «solo salón» NUNCA sale en la carta pública (ni la sección que solo la tenía); I2 el POS la
 * ofrece igual que hoy (y su sección, aunque solo tenga promos de «solo salón»); el filtro FALLA CERRADO (la audiencia es obligatoria y el valor por defecto es el público). I3 (con todas en `false` nada cambia) lo cubre
 * `promo-audiencia-caracterizacion.test.ts`, que no se toca.
 */
describe("wherePromoOfrecidaEn: la audiencia manda (puro)", () => {
  it("«salon» es exactamente el criterio de siempre; «publico» le suma soloSalon: false", () => {
    expect(wherePromoOfrecidaEn("s1", "salon")).toEqual({ activa: true, sucursales: { some: { sucursalId: "s1", activa: true } } });
    expect(wherePromoOfrecidaEn("s1", "publico")).toEqual({ activa: true, sucursales: { some: { sucursalId: "s1", activa: true } }, soloSalon: false });
  });

  it("FALLA CERRADO: un valor que no es «salon» (un cast, un dato roto) se trata como público", () => {
    for (const raro of ["Salon", "salón", "", "todas", undefined, null, 1] as unknown[]) {
      expect(wherePromoOfrecidaEn("s1", raro as AudienciaDePromo), String(raro)).toHaveProperty("soloSalon", false);
    }
  });
});

describe("promo en «solo salón»: carta pública y POS", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let seccionPlatosId: string;
  let seccionPactadaId: string;
  let promoSalonId: string;
  let promoPublicaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    seccionPlatosId = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
    seccionPactadaId = (await prisma.seccionCarta.create({ data: { nombre: "Menú pactado", orden: 2 } })).id;
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.milanesa.id, visibleEnCarta: true, seccionCartaId: seccionPlatosId } });
    await prisma.sucursalPublica.create({ data: { sucursalId: s.sucursalId, slug: "central", publicada: true } });
    // Una promo en «solo salón» sola en su sección, y otra pública en la sección de los platos; las dos armables con un cupo de «Platos».
    promoSalonId = (await prisma.promoCarta.create({ data: { seccionCartaId: seccionPactadaId, titulo: "Combo pactado", precio: 20000, soloSalon: true, sucursales: { create: { sucursalId: s.sucursalId } } } })).id;
    promoPublicaId = (await prisma.promoCarta.create({ data: { seccionCartaId: seccionPlatosId, titulo: "Combo de todos", precio: 15000, sucursales: { create: { sucursalId: s.sucursalId } } } })).id;
    for (const promoCartaId of [promoSalonId, promoPublicaId]) await prisma.promoCartaCupo.create({ data: { promoCartaId, seccionCartaId: seccionPlatosId, cantidadMinima: 1, cantidadMaxima: 1 } });
  });

  const titulosDe = (carta: { secciones: { promos: { titulo: string }[] }[] } | null) => carta!.secciones.flatMap((x) => x.promos).map((p) => p.titulo);

  it("I1: la carta pública NO muestra la promo en «solo salón» ni la sección que solo la tenía; la otra promo sale", async () => {
    const resuelta = (await resolverCartaPublica(empresa, "central", basesDe(empresa.id), AHORA_DE_LA_CORRIDA))!;
    expect(titulosDe(resuelta.carta)).toEqual(["Combo de todos"]);
    expect(resuelta.carta.secciones.map((x) => x.nombre)).toEqual(["Platos"]);
    expect(JSON.stringify(resuelta.carta)).not.toContain("Combo pactado");
    expect(JSON.stringify(resuelta.carta)).not.toContain("Menú pactado");
  });

  it("FALLA CERRADO: sin decir la audiencia (el valor por defecto), el menú y el menú con diagnóstico son los públicos", async () => {
    expect(titulosDe(await resolverMenuCarta(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA))).toEqual(["Combo de todos"]);
    expect(titulosDe((await resolverMenuCartaConDiagnostico(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA))!.carta)).toEqual(["Combo de todos"]);
    expect(titulosDe(await resolverMenuCarta(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA, undefined, "publico"))).toEqual(["Combo de todos"]);
  });

  it("«ninguna» (empresa sin el módulo Promociones) sigue sin traer promos; «salon» las trae todas", async () => {
    expect(titulosDe(await resolverMenuCarta(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA, undefined, "ninguna"))).toEqual([]);
    expect(titulosDe(await resolverMenuCarta(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA, undefined, "salon")).sort()).toEqual(["Combo de todos", "Combo pactado"]);
    const sinPromos = (await resolverCartaPublica(empresa, "central", basesDe(empresa.id), AHORA_DE_LA_CORRIDA, false))!;
    expect(titulosDe(sinPromos.carta)).toEqual([]);
  });

  it("I2: el POS ofrece las dos promos, la de «solo salón» en su sección aunque sea lo único que tiene", async () => {
    const selector = await cargarSelectorCartaPos(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    const seccion = selector.seccionesCarta.find((x) => x.seccionCartaId === seccionPactadaId);
    expect(seccion?.nombre).toBe("Menú pactado");
    expect(seccion?.entradas.map((e) => (e.tipo === "promo" ? e.titulo : e.tipo))).toEqual(["Combo pactado"]);
    const todas = selector.seccionesCarta.flatMap((x) => x.entradas.flatMap((e) => (e.tipo === "promo" ? [e.titulo] : [])));
    expect(todas.sort()).toEqual(["Combo de todos", "Combo pactado"]);
  });

  it("I2: la promo en «solo salón» se puede agregar a la cuenta y el contador del hub cuenta las dos", async () => {
    expect(await cargarPromoCartaParaAgregar(s.sucursalId, promoSalonId, prisma, AHORA_DE_LA_CORRIDA)).toMatchObject({ id: promoSalonId, titulo: "Combo pactado", precio: 20000 });
    expect(await cargarPromoCartaParaAgregar(s.sucursalId, promoPublicaId, prisma, AHORA_DE_LA_CORRIDA)).toMatchObject({ id: promoPublicaId });
    expect((await resumirParametrizacionDeCarta(prisma, s.sucursalId)).promosActivas).toBe(2);
  });

  it("prender «solo salón» en una promo que ya se veía la saca de la carta pública en el próximo pedido (y apagarlo la devuelve)", async () => {
    await prisma.promoCarta.update({ where: { id: promoPublicaId }, data: { soloSalon: true } });
    expect(titulosDe(await resolverMenuCarta(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA))).toEqual([]);
    await prisma.promoCarta.update({ where: { id: promoPublicaId }, data: { soloSalon: false } });
    expect(titulosDe(await resolverMenuCarta(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA))).toEqual(["Combo de todos"]);
  });

  it("el filtro sigue respetando lo de siempre: una promo en «solo salón» apagada o sin fila de la sucursal no se ofrece ni al salón", async () => {
    await prisma.promoCarta.update({ where: { id: promoSalonId }, data: { activa: false } });
    const ofrecidasAlSalon = async () => (await prisma.promoCarta.findMany({ where: wherePromoOfrecidaEn(s.sucursalId, "salon") })).map((p) => p.titulo);
    expect(await ofrecidasAlSalon()).toEqual(["Combo de todos"]);
    await prisma.promoCarta.update({ where: { id: promoSalonId }, data: { activa: true } });
    await prisma.promoCartaSucursal.updateMany({ where: { promoCartaId: promoSalonId }, data: { activa: false } });
    expect(await ofrecidasAlSalon()).toEqual(["Combo de todos"]);
  });
});

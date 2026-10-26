import { beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarSalon } from "../pos/salon-fixture";
import { dbDeEmpresa } from "../../src/server/sesion/base";
import { resolverCartaPublica } from "../../src/server/lecturas/carta/publica";
import { resolverMenuCartaConDiagnostico } from "../../src/server/lecturas/carta/menu";
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
 * CARACTERIZACIÓN (docs/diseno-promo-solo-salon-2026-10-26.md, paso 1): hoy una promo ofrecida en la sucursal se ve en la carta pública Y en el POS, y la
 * sección que SOLO tiene la promo sale en los dos (el POS ubica sus promos dentro de la carta armada y `armarMenuCarta` borra las secciones vacías). Este archivo
 * se escribió ANTES del interruptor «solo salón» y tiene que seguir verde DESPUÉS (invariante I3: con todas las promos en `soloSalon = false`, nada cambia).
 * Sin golden: afirma la forma que importa, contra Postgres real.
 */
describe("promo ofrecida en la sucursal: carta pública y POS (línea de base del interruptor «solo salón»)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let seccionPlatosId: string;
  let seccionSoloPromoId: string;
  let promoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    seccionPlatosId = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
    seccionSoloPromoId = (await prisma.seccionCarta.create({ data: { nombre: "Menú pactado", orden: 2 } })).id;
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.milanesa.id, visibleEnCarta: true, seccionCartaId: seccionPlatosId } });
    await prisma.sucursalPublica.create({ data: { sucursalId: s.sucursalId, slug: "central", publicada: true } });
    // La promo vive en una sección que no tiene ningún otro contenido y arma su combo con la sección «Platos».
    promoId = (await prisma.promoCarta.create({ data: { seccionCartaId: seccionSoloPromoId, titulo: "Combo pactado", precio: 20000, sucursales: { create: { sucursalId: s.sucursalId } } } })).id;
    await prisma.promoCartaCupo.create({ data: { promoCartaId: promoId, seccionCartaId: seccionPlatosId, cantidadMinima: 1, cantidadMaxima: 1 } });
  });

  it("la carta pública muestra la promo y la sección que solo la tiene", async () => {
    const resuelta = (await resolverCartaPublica(empresa, "central", basesDe(empresa.id), AHORA_DE_LA_CORRIDA))!;
    const seccion = resuelta.carta.secciones.find((x) => x.nombre === "Menú pactado");
    expect(seccion?.promos.map((p) => p.titulo)).toEqual(["Combo pactado"]);
    expect(resuelta.carta.secciones.map((x) => x.nombre)).toEqual(["Platos", "Menú pactado"]);
  });

  it("el menú con diagnóstico (lo que lee el admin) trae la promo con los valores por defecto", async () => {
    const armado = (await resolverMenuCartaConDiagnostico(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA))!;
    expect(armado.carta.secciones.flatMap((x) => x.promos).map((p) => p.titulo)).toEqual(["Combo pactado"]);
  });

  it("el selector del POS ofrece la promo en su sección, y esa sección sale aunque solo tenga la promo", async () => {
    const selector = await cargarSelectorCartaPos(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    const seccion = selector.seccionesCarta.find((x) => x.seccionCartaId === seccionSoloPromoId);
    expect(seccion?.nombre).toBe("Menú pactado");
    expect(seccion?.entradas.map((e) => (e.tipo === "promo" ? e.titulo : e.tipo))).toEqual(["Combo pactado"]);
  });

  it("la promo se puede agregar a la cuenta (lectura de «promo para agregar») y el contador del hub la cuenta", async () => {
    const def = await cargarPromoCartaParaAgregar(s.sucursalId, promoId, prisma, AHORA_DE_LA_CORRIDA);
    expect(def).toMatchObject({ id: promoId, titulo: "Combo pactado", precio: 20000 });
    expect((await resumirParametrizacionDeCarta(prisma, s.sucursalId)).promosActivas).toBe(1);
  });
});

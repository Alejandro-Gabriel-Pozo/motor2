import { beforeEach, describe, expect, it } from "vitest";
import { ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItemsCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/agregar-items";
import type { ComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.schema";
import { cargarOpcionesParaVender } from "../../src/server/lecturas/opciones/opciones-para-vender";
import { clasificarPlatoDeSeccion } from "../../src/core/pos/plato-de-seccion";

/**
 * Parte de promo «Toda la sección» con OPCIONES (diseño docs/diseno-promo-parte-de-seccion-2026-11-11.md, etapa E1b), contra Postgres real y por el caso de uso: el mozo arma una promo por sección y elige las
 * opciones de un plato con grupos (el tamaño del café), en cada unidad. Fija: el precio de la promo es el de siempre y el reparto pesa con la lista de la configuración elegida (I1, I8); lo no permitido
 * (un adicional, una opción apagada, una versión vieja, el mínimo del grupo) se rechaza sin escribir nada; «pedilo suelto» solo para lo que no se puede armar; idempotencia (misma clave, reintento y a la vez) y
 * concurrencia (dos «Agregar promo» a la vez sobre la misma cuenta); y la paridad entre lo que la lectura clasifica de cada plato y lo que el servidor hace con él.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let cuentaId: string;
let bebidasId: string;
let postresId: string;
let promoCartaId: string;

const actor = () => ({
  usuarioId: s.admin.id,
  empresaId: EMPRESA_POR_DEFECTO_ID,
  sucursalId: s.sucursalId,
  sucursalNombre: s.sucursal.nombre,
  empresaZonaHoraria: ZONA_ARGENTINA,
  ahora: new Date(),
  ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }),
});
type Promos = ComandoAgregarItems["promos"];
const agregar = (promos: Promos, claveIdempotencia?: string) => agregarItemsCasoDeUso(actor(), { cuentaId, items: [], promos, ...(claveIdempotencia ? { claveIdempotencia } : {}) });
const lineas = () => prisma.cuentaItem.findMany({ where: { cuentaId }, include: { opcionesElegidas: { orderBy: { orden: "asc" } } }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
const delCafe = async () => (await lineas()).filter((i) => i.productoId === c.cafeId);
const importe = (i: { cantidad: unknown; precioUnitario: unknown }) => Number(i.cantidad) * Number(i.precioUnitario);
const totalDeLasLineas = async () => Math.round((await lineas()).reduce((suma, i) => suma + importe(i), 0) * 100) / 100;
const nadaEscrito = async () => {
  expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(0);
  expect(await prisma.promoCuenta.count()).toBe(0);
  expect(await prisma.opcionElegidaEnLinea.count()).toBe(0);
};

/** La elección de «Merienda»: un café (con las opciones que se pasen) de «Bebidas» y un flan de «Postres». */
const merienda = (opcionesDelCafe?: ReturnType<typeof elegida>[], cantidadDelCafe = 1): Promos => [
  {
    promoCartaId,
    elecciones: [
      { seccionCartaId: bebidasId, elegidos: [{ productoId: c.cafeId, cantidad: cantidadDelCafe, ...(opcionesDelCafe ? { opciones: opcionesDelCafe } : {}) }] },
      { seccionCartaId: postresId, elegidos: [{ productoId: s.flan.id, cantidad: 1 }] },
    ],
  },
];

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
  bebidasId = (await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } })).id;
  postresId = (await prisma.seccionCarta.create({ data: { nombre: "Postres" } })).id;
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: c.cafeId, visibleEnCarta: true, seccionCartaId: bebidasId } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.flan.id, visibleEnCarta: true, seccionCartaId: postresId } });
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: bebidasId, titulo: "Merienda", precio: 3500 } });
  promoCartaId = promo.id;
  await prisma.promoCartaCupo.createMany({
    data: [
      { promoCartaId, seccionCartaId: bebidasId, cantidadMinima: 1, cantidadMaxima: 2, orden: 0 },
      { promoCartaId, seccionCartaId: postresId, cantidadMinima: 1, cantidadMaxima: 1, orden: 1 },
    ],
  });
});

describe("«Toda la sección» con opciones: lo que se acepta", () => {
  it("el café Grande (obligatorio) dentro de la promo: se cobra el precio de la promo, el café lleva su foto y su huella, y pesa con la lista de la configuración (1.100), no con el precio guardado (1.000)", async () => {
    const r = await agregar(merienda([elegida(c, c.grandeId)]));
    expect(r.ok, r.mensaje).toBe(true);
    expect(await totalDeLasLineas()).toBe(3500);
    expect(await lineas()).toHaveLength(2);
    const [cafe] = await delCafe();
    const flan = (await lineas()).find((i) => i.productoId === s.flan.id);
    expect(cafe!.promoCuentaId).not.toBeNull();
    expect(cafe!.huellaOpciones).toMatch(/^[0-9a-f]{64}$/);
    expect(cafe!.opcionesElegidas.map((f) => [f.nombreGrupo, f.nombreOpcion, f.versionDeOpcionId])).toEqual([["Tamaño", "Grande", c.versionDe[c.grandeId]]]);
    // La lista compuesta de la configuración (1.000 + 100) es la referencia del reparto; el flan, su precio de carta.
    expect(Number(cafe!.precioCartaUnitario)).toBe(1100);
    const precioDelFlan = Number((await prisma.producto.findUniqueOrThrow({ where: { id: s.flan.id } })).precioVenta);
    expect(Math.abs(Number(cafe!.precioUnitario) - (3500 * 1100) / (1100 + precioDelFlan))).toBeLessThanOrEqual(0.01);
    expect(flan).toBeDefined();
  });

  it("I8: elegir otro tamaño cambia el reparto entre los platos y NO el total (Chico 950 vs Grande 1.100)", async () => {
    expect((await agregar(merienda([elegida(c, c.chicoId)]))).ok).toBe(true);
    const chico = Number((await delCafe())[0]!.precioUnitario);
    expect(await totalDeLasLineas()).toBe(3500);
    await prisma.cuentaItem.deleteMany({ where: { cuentaId } });
    await prisma.promoCuenta.deleteMany();
    expect((await agregar(merienda([elegida(c, c.grandeId)]))).ok).toBe(true);
    const grande = Number((await delCafe())[0]!.precioUnitario);
    expect(await totalDeLasLineas()).toBe(3500);
    expect(grande).toBeGreaterThan(chico);
  });

  it("el 2x1: el mismo café en una fila de 2 unidades se acepta; con DOS configuraciones distintas son dos líneas; con la MISMA configuración repetida en dos filas, se rechaza", async () => {
    const dos = await agregar([
      { promoCartaId, elecciones: [{ seccionCartaId: bebidasId, elegidos: [{ productoId: c.cafeId, cantidad: 2, opciones: [elegida(c, c.grandeId)] }] }, { seccionCartaId: postresId, elegidos: [{ productoId: s.flan.id, cantidad: 1 }] }] },
    ]);
    expect(dos.ok, dos.mensaje).toBe(true);
    expect(await totalDeLasLineas()).toBe(3500);
    expect((await lineas()).filter((i) => i.productoId === c.cafeId).reduce((suma, i) => suma + Number(i.cantidad), 0)).toBe(2);
    await prisma.cuentaItem.deleteMany({ where: { cuentaId } });
    await prisma.promoCuenta.deleteMany();
    const distintas = await agregar([
      { promoCartaId, elecciones: [{ seccionCartaId: bebidasId, elegidos: [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.chicoId)] }, { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }] }, { seccionCartaId: postresId, elegidos: [{ productoId: s.flan.id, cantidad: 1 }] }] },
    ]);
    expect(distintas.ok, distintas.mensaje).toBe(true);
    expect((await lineas()).filter((i) => i.productoId === c.cafeId)).toHaveLength(2);
    expect(await totalDeLasLineas()).toBe(3500);
    await prisma.cuentaItem.deleteMany({ where: { cuentaId } });
    await prisma.promoCuenta.deleteMany();
    const repetida = await agregar([
      { promoCartaId, elecciones: [{ seccionCartaId: bebidasId, elegidos: [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }, { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }] }, { seccionCartaId: postresId, elegidos: [{ productoId: s.flan.id, cantidad: 1 }] }] },
    ]);
    expect(repetida).toMatchObject({ ok: false });
    await nadaEscrito();
  });

  it("también se aceptan las opciones solo OPCIONALES (la leche) junto con la obligatoria, y el mozo puede dejar la opcional sin elegir", async () => {
    expect((await agregar(merienda([elegida(c, c.medianoId), elegida(c, c.almendrasId)]))).ok).toBe(true);
    const [cafe] = await delCafe();
    expect(cafe!.opcionesElegidas.map((f) => f.nombreOpcion)).toEqual(["Mediano", "Almendras"]);
    expect(await totalDeLasLineas()).toBe(3500);
  });
});

describe("«Toda la sección» con opciones: lo que se rechaza (y no deja nada escrito)", () => {
  it("un plato con grupo obligatorio SIN elegirlo: «Elegí…» (OPCIONES_INVALIDAS), ya no «pedilo suelto»", async () => {
    const r = await agregar(merienda());
    expect(r).toMatchObject({ ok: false, codigo: "OPCIONES_INVALIDAS" });
    await nadaEscrito();
  });

  it("un adicional (el shot extra) nunca se ofrece dentro de una promo de precio fijo", async () => {
    const r = await agregar(merienda([elegida(c, c.grandeId), elegida(c, c.shotId)]));
    expect(r).toMatchObject({ ok: false, codigo: "OPCION_NO_PERMITIDA_EN_PROMO" });
    await nadaEscrito();
  });

  it("una opción apagada en la sucursal, o una opción que el café no admite, se rechazan", async () => {
    await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: s.sucursalId, opcionId: c.grandeId, apagada: true, actualizadoPorId: s.admin.id } });
    expect(await agregar(merienda([elegida(c, c.grandeId)]))).toMatchObject({ ok: false, codigo: "OPCION_NO_PERMITIDA_EN_PROMO" });
    expect(await agregar(merienda([elegida(c, c.chicoId), elegida(c, "id-que-no-existe", 1, "v-x")]))).toMatchObject({ ok: false, codigo: "OPCION_NO_PERMITIDA_EN_PROMO" });
    await nadaEscrito();
  });

  it("la versión que vio el mozo ya no es la vigente: OPCION_CAMBIO", async () => {
    const r = await agregar(merienda([elegida(c, c.grandeId, 1, "version-vieja")]));
    expect(r).toMatchObject({ ok: false, codigo: "OPCION_CAMBIO" });
    await nadaEscrito();
  });

  it("opciones mandadas a un plato que no las lleva (el flan), o mínimo y máximo de la parte rotos, se rechazan", async () => {
    const aUnFlan = await agregar([
      { promoCartaId, elecciones: [{ seccionCartaId: bebidasId, elegidos: [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }] }, { seccionCartaId: postresId, elegidos: [{ productoId: s.flan.id, cantidad: 1, opciones: [elegida(c, c.grandeId)] }] }] },
    ]);
    expect(aUnFlan).toMatchObject({ ok: false });
    // Máximo de la parte de bebidas: 2 unidades en total (3 sería de más), con o sin opciones.
    expect(await agregar(merienda([elegida(c, c.grandeId)], 3))).toMatchObject({ ok: false });
    await nadaEscrito();
  });

  it("«pedilo suelto» queda SOLO para lo que no se puede armar: un adicional obligatorio deja el plato afuera (PROMO_CON_OPCIONES)", async () => {
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: c.cafeId, grupoId: c.grupoExtrasId }, data: { cantidadMinima: 1 } });
    const r = await agregar(merienda());
    expect(r).toMatchObject({ ok: false, codigo: "PROMO_CON_OPCIONES" });
    // Y si el cliente le manda opciones igual, tampoco se arma (el plato no se ofrece con opciones).
    expect(await agregar(merienda([elegida(c, c.grandeId)]))).toMatchObject({ ok: false });
    await nadaEscrito();
  });

  it("un grupo obligatorio sin ninguna opción activa en la sucursal: el plato no se ofrece (la carta ya no lo ubica en su sección) y la promo no se arma", async () => {
    for (const opcionId of [c.chicoId, c.medianoId, c.grandeId]) await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: s.sucursalId, opcionId, apagada: true, actualizadoPorId: s.admin.id } });
    expect(await agregar(merienda())).toMatchObject({ ok: false, codigo: "PROMO_INVALIDA" });
    expect(await agregar(merienda([elegida(c, c.grandeId)]))).toMatchObject({ ok: false });
    await nadaEscrito();
  });

  it("un plato apagado en la sucursal no se puede elegir", async () => {
    await prisma.disponibilidadProducto.updateMany({ where: { sucursalId: s.sucursalId, productoId: c.cafeId }, data: { disponible: false } });
    expect((await agregar(merienda([elegida(c, c.grandeId)]))).ok).toBe(false);
    await nadaEscrito();
  });

  it("atomicidad: si la SEGUNDA promo del pedido es inválida, no se escribe ni la primera", async () => {
    const buena = merienda([elegida(c, c.grandeId)])[0]!;
    const mala = merienda([elegida(c, c.grandeId), elegida(c, c.shotId)])[0]!;
    expect((await agregar([buena, mala])).ok).toBe(false);
    await nadaEscrito();
  });
});

describe("idempotencia y concurrencia al agregar la promo con opciones", () => {
  it("la misma clave dos veces seguidas (reintento): una sola promo y un solo comprobante; el reintento devuelve el mismo mensaje", async () => {
    const clave = crypto.randomUUID();
    const primera = await agregar(merienda([elegida(c, c.grandeId)]), clave);
    const reintento = await agregar(merienda([elegida(c, c.grandeId)]), clave);
    expect(primera.ok).toBe(true);
    expect(reintento).toEqual(primera);
    expect(await prisma.promoCuenta.count()).toBe(1);
    expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(2);
    expect(await prisma.agregadoDeCuenta.count({ where: { claveIdempotencia: clave } })).toBe(1);
    expect(await totalDeLasLineas()).toBe(3500);
  });

  it("la misma clave con OTRA elección (otro tamaño) es un conflicto: no escribe nada de más", async () => {
    const clave = crypto.randomUUID();
    expect((await agregar(merienda([elegida(c, c.grandeId)]), clave)).ok).toBe(true);
    expect(await agregar(merienda([elegida(c, c.chicoId)]), clave)).toMatchObject({ ok: false, codigo: "CONFLICTO_IDEMPOTENCIA" });
    expect(await prisma.promoCuenta.count()).toBe(1);
  });

  it("dos «Agregar promo» IGUALES a la vez con la MISMA clave (doble clic): se escribe una sola vez y las dos responden lo mismo", async () => {
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      await prisma.cuentaItem.deleteMany({ where: { cuentaId } });
      await prisma.promoCuenta.deleteMany();
      const clave = crypto.randomUUID();
      const [a, b] = await Promise.all([agregar(merienda([elegida(c, c.grandeId)]), clave), agregar(merienda([elegida(c, c.grandeId)]), clave)]);
      expect(a.ok && b.ok, `vuelta ${vuelta}: ${a.mensaje} / ${b.mensaje}`).toBe(true);
      expect(a).toEqual(b);
      expect(await prisma.promoCuenta.count(), `vuelta ${vuelta}`).toBe(1);
      expect(await prisma.cuentaItem.count({ where: { cuentaId } }), `vuelta ${vuelta}`).toBe(2);
      expect(await totalDeLasLineas(), `vuelta ${vuelta}`).toBe(3500);
    }
  });

  it("dos «Agregar promo» a la vez sobre la MISMA cuenta con claves distintas (dos pedidos): se agregan las dos, cada una completa (todo o nada) y cada una suma el precio de su promo", async () => {
    const [a, b] = await Promise.all([agregar(merienda([elegida(c, c.chicoId)]), crypto.randomUUID()), agregar(merienda([elegida(c, c.grandeId)]), crypto.randomUUID())]);
    expect(a.ok && b.ok, `${a.mensaje} / ${b.mensaje}`).toBe(true);
    expect(await prisma.promoCuenta.count()).toBe(2);
    expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(4);
    expect(await totalDeLasLineas()).toBe(7000);
    for (const promo of await prisma.promoCuenta.findMany()) {
      const filas = await prisma.cuentaItem.findMany({ where: { promoCuentaId: promo.id } });
      expect(Math.round(filas.reduce((suma, i) => suma + importe(i), 0) * 100) / 100).toBe(3500);
    }
  });

  it("una opción apagada justo antes de confirmar: el servidor relee dentro de la transacción y rechaza sin escribir (no confía en lo que el mozo vio)", async () => {
    // Lo que el mozo vio (Grande disponible) ya no vale: la lectura de adentro de la transacción manda.
    await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: s.sucursalId, opcionId: c.grandeId, apagada: true, actualizadoPorId: s.admin.id } });
    expect(await agregar(merienda([elegida(c, c.grandeId)]), crypto.randomUUID())).toMatchObject({ ok: false, codigo: "OPCION_NO_PERMITIDA_EN_PROMO" });
    await nadaEscrito();
    expect(await prisma.agregadoDeCuenta.count()).toBe(0);
  });
});

describe("paridad: lo que la lectura clasifica de cada plato es lo que el servidor hace con él", () => {
  it("con opciones (café), sin nada que elegir (flan) y no armable (café con adicional obligatorio)", async () => {
    const clasificar = async (productoId: string) => {
      const leidas = await cargarOpcionesParaVender(prisma, { sucursalId: s.sucursalId, productoIds: [productoId] });
      return clasificarPlatoDeSeccion(leidas.get(productoId)?.grupos ?? []).tipo;
    };
    expect(await clasificar(c.cafeId)).toBe("CON_OPCIONES");
    expect(await clasificar(s.flan.id)).toBe("SIN_OPCIONES");
    // CON_OPCIONES: el servidor acepta con opciones. SIN_OPCIONES: acepta sin ellas (y las rechaza si llegan). NO_SE_OFRECE: PROMO_CON_OPCIONES.
    expect((await agregar(merienda([elegida(c, c.grandeId)]))).ok).toBe(true);
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: c.cafeId, grupoId: c.grupoExtrasId }, data: { cantidadMinima: 1 } });
    expect(await clasificar(c.cafeId)).toBe("NO_SE_OFRECE");
    expect(await agregar(merienda())).toMatchObject({ ok: false, codigo: "PROMO_CON_OPCIONES" });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { cerrarConexiones } from "../setup/gasto";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarCombosAjenos } from "../setup/combos-go3b";
import { sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItemsCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/agregar-items";
import type { ComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.schema";
import { claveDeConfiguracion } from "../../src/core/pos/promo-combo";
import { ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import { importeDeLinea, redondearMoneda } from "../../src/core/moneda";

/**
 * Promo «a elegir» (etapa N1 PR A, ADR-032 D-6 enmendada, docs/diseno-promo-subconjunto-2026-11-04.md): vender una promo cuya entrada deja ELEGIR opciones al mozo, solo entre lo permitido, contra Postgres real y por
 * el caso de uso. La promo «Café y flan» ($ 2000) tiene un lugar «Café» (1 a 2) con UNA entrada «a elegir» (el Café, que permite Chico, Mediano, De vaca y Almendras; NO Grande, NO el adicional Shot) y un postre fijo (Flan).
 *
 * Fija: el precio de la promo es el mismo elija lo que elija el mozo (I4) y la foto de lo elegido se congela (I5); lo que no está permitido (Grande, el Shot, una opción apagada en la sucursal) se rechaza con
 * `OPCION_NO_PERMITIDA_EN_PROMO` sin escribir nada; el mínimo del grupo (`OPCIONES_INVALIDAS`) y la versión que vio el mozo (`OPCION_CAMBIO`) se exigen como en una venta suelta; una entrada FIJAS no admite opciones; dos
 * configuraciones del mismo café son dos líneas y la misma dos veces es un repetido; sin ninguna opción permitida activa el café deja de ofrecerse (`ENTRADA_NO_DISPONIBLE`, falla cerrado); cambiar lo permitido es
 * otra entrada y la vieja se rechaza; idempotencia (la misma clave dos veces = una promo; otra huella = conflicto); concurrencia (dos pedidos a la vez; el mismo con la misma clave; agregar contra dar de baja la entrada);
 * aislamiento (una promo de otra empresa, o no prendida en la sucursal, no existe).
 *
 * Mutaciones demostradas (rojo y revertidas): pasar a `armarLineaConfigurada` los grupos de la lectura SIN filtrar a lo permitido (rojo: «Grande» y «Shot»); sacar el `claveComponente` de la configuración elegida
 * (rojo: «dos configuraciones»); armar la línea FUERA de la transacción con una lectura previa (rojo: «agregar contra dar de baja»); sacar `aElegir` del selector (rojo: el oráculo y «sin ninguna opción activa»).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let cuentaId: string;

const actor = () => ({
  usuarioId: s.admin.id,
  empresaId: EMPRESA_POR_DEFECTO_ID,
  sucursalId: s.sucursalId,
  sucursalNombre: s.sucursal.nombre,
  empresaZonaHoraria: ZONA_ARGENTINA,
  ahora: new Date(),
  ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }),
});
const agregar = (promos: ComandoAgregarItems["promos"], claveIdempotencia?: string, cuenta = cuentaId) =>
  agregarItemsCasoDeUso(actor(), { cuentaId: cuenta, items: [], promos, ...(claveIdempotencia ? { claveIdempotencia } : {}) });
const lineas = (cuenta = cuentaId) => prisma.cuentaItem.findMany({ where: { cuentaId: cuenta }, include: { opcionesElegidas: { orderBy: { orden: "asc" } } }, orderBy: [{ precioUnitario: "desc" }, { id: "asc" }] });
const totalDeLaPromo = async (promoCuentaId: string) => redondearMoneda((await prisma.cuentaItem.findMany({ where: { promoCuentaId } })).reduce((suma, l) => suma + importeDeLinea(Number(l.cantidad), Number(l.precioUnitario)), 0));
const nada = async () => {
  expect(await prisma.cuentaItem.count({ where: { cuentaId } }), "no se escribió ninguna línea").toBe(0);
  expect(await prisma.promoCuenta.count({ where: { cuentaId } }), "no se escribió ninguna promo").toBe(0);
};

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});
afterEach(cerrarConexiones);

/** La promo «Café y flan» a $ 2000: el lugar «Café» (1 a 2) con la entrada «a elegir» y el postre fijo. */
async function cafeYFlan(permitidas: string[] = [c.chicoId, c.medianoId, c.vacaId, c.almendrasId], extra: { titulo?: string; conSucursal?: boolean } = {}) {
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `Sección ${extra.titulo ?? "Café y flan"}` } });
  const promoCartaId = (await prisma.promoCarta.create({ data: { ...(extra.conSucursal === false ? {} : { sucursales: { create: { sucursalId: s.sucursalId } } }), seccionCartaId: seccion.id, titulo: extra.titulo ?? "Café y flan", precio: "2000.00" } })).id;
  const cupoCafe = await prisma.promoCartaCupo.create({ data: { promoCartaId, tipo: "LISTA", nombre: "Café", orden: 0, cantidadMinima: 1, cantidadMaxima: 2 } });
  const cupoPostre = await prisma.promoCartaCupo.create({ data: { promoCartaId, tipo: "LISTA", nombre: "Postre", orden: 1, cantidadMinima: 1, cantidadMaxima: 1 } });
  const entradaCafe = await entradaAElegir(cupoCafe.id, permitidas);
  await prisma.entradaDeCupo.create({ data: { cupoId: cupoPostre.id, productoId: s.flan.id } });
  const pedir = (cafes: { opciones: string[]; cantidad?: number; versiones?: Record<string, string> }[], extra2: Record<string, unknown> = {}, entradaId = entradaCafe.id) => ({
    promoCartaId,
    elecciones: [{ cupoId: cupoCafe.id, elegidos: cafes.map((k) => ({ entradaId, cantidad: k.cantidad ?? 1, opciones: k.opciones.map((o) => elegida(c, o, 1, k.versiones?.[o])) })) }],
    ...extra2,
  });
  return { promoCartaId, cupoCafe, cupoPostre, entradaCafe, pedir };
}
const entradaAElegir = (cupoId: string, permitidas: string[]) =>
  prisma.entradaDeCupo.create({
    data: { cupoId, productoId: c.cafeId, modoDeOpciones: "A_ELEGIR", claveConfiguracion: claveDeConfiguracion(permitidas.map((opcionId) => ({ opcionId, cantidad: 1 })))!, opciones: { create: permitidas.map((opcionId) => ({ opcionId, cantidad: 1 })) } },
  });

describe("vender una promo «a elegir»", () => {
  it("el mozo elige Mediano + Almendras: la promo cobra $ 2000 exactos, la línea del café lleva su huella y su foto, y el flan va fijo", async () => {
    const m = await cafeYFlan();
    const r = await agregar([m.pedir([{ opciones: [c.medianoId, c.almendrasId] }], { precioEsperado: 2000 })]);
    expect(r, r.mensaje).toMatchObject({ ok: true });
    const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId } });
    expect([promoCuenta.titulo, Number(promoCuenta.precio)]).toEqual(["Café y flan", 2000]);
    const todas = await lineas();
    expect(todas.map((l) => l.productoId).sort()).toEqual([c.cafeId, s.flan.id].sort());
    const cafe = todas.find((l) => l.productoId === c.cafeId)!;
    const flan = todas.find((l) => l.productoId === s.flan.id)!;
    expect(cafe.huellaOpciones).toMatch(/^[0-9a-f]{64}$/);
    expect(cafe.opcionesElegidas.map((f) => [f.nombreGrupo, f.nombreOpcion, Number(f.importeUnitario)])).toEqual([["Tamaño", "Mediano", 0], ["Leche", "Almendras", 150]]);
    expect([Number(cafe.precioCartaUnitario), Number(flan.precioCartaUnitario)]).toEqual([1150, 3000]);
    expect(flan.huellaOpciones).toBeNull();
    expect(await totalDeLaPromo(promoCuenta.id)).toBe(2000);
  });

  it("I4: el precio de la promo es el mismo elija lo que elija el mozo; lo que cambia es el reparto entre las líneas", async () => {
    const m = await cafeYFlan();
    const repartos = new Set<string>();
    for (const opciones of [[c.chicoId], [c.medianoId], [c.chicoId, c.vacaId], [c.medianoId, c.almendrasId]]) {
      const antes = await prisma.promoCuenta.count({ where: { cuentaId } });
      expect(await agregar([m.pedir([{ opciones }])])).toMatchObject({ ok: true });
      const promos = await prisma.promoCuenta.findMany({ where: { cuentaId }, orderBy: { creadoEn: "asc" } });
      expect(promos).toHaveLength(antes + 1);
      const nueva = promos.at(-1)!;
      expect(await totalDeLaPromo(nueva.id), JSON.stringify(opciones)).toBe(2000);
      repartos.add((await prisma.cuentaItem.findMany({ where: { promoCuentaId: nueva.id, productoId: c.cafeId } })).map((l) => Number(l.precioUnitario)).join());
    }
    expect(repartos.size, "elegir otra cosa cambia el reparto").toBeGreaterThan(1);
  });

  it("DOS configuraciones del mismo café son dos líneas (mínimo 1, máximo 2 del lugar); la MISMA dos veces se rechaza como repetida", async () => {
    const m = await cafeYFlan();
    expect(await agregar([m.pedir([{ opciones: [c.chicoId] }, { opciones: [c.medianoId, c.almendrasId] }])])).toMatchObject({ ok: true });
    const cafes = (await lineas()).filter((l) => l.productoId === c.cafeId);
    expect(cafes).toHaveLength(2);
    expect(new Set(cafes.map((l) => l.huellaOpciones)).size).toBe(2);
    expect(cafes.map((l) => l.opcionesElegidas.map((f) => f.nombreOpcion).join("+")).sort()).toEqual(["Chico", "Mediano+Almendras"]);
    const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId } });
    expect(await totalDeLaPromo(promoCuenta.id)).toBe(2000);
    expect(await agregar([m.pedir([{ opciones: [c.chicoId, c.vacaId] }, { opciones: [c.vacaId, c.chicoId] }])])).toMatchObject({ ok: false, codigo: "PROMO_INVALIDA" });
    expect(await prisma.promoCuenta.count({ where: { cuentaId } })).toBe(1);
  });

  describe("lo que no está permitido o no cumple se rechaza, y ninguno escribe nada", () => {
    it("una opción del producto que la promo NO permite (Grande) y el adicional (Shot): OPCION_NO_PERMITIDA_EN_PROMO, nombrando la opción", async () => {
      const m = await cafeYFlan();
      const grande = await agregar([m.pedir([{ opciones: [c.grandeId] }])]);
      expect(grande).toMatchObject({ ok: false, codigo: "OPCION_NO_PERMITIDA_EN_PROMO" });
      expect(grande.mensaje).toBe("«Café y flan»: «Café» no admite «Grande» en esta promo.");
      const shot = await agregar([m.pedir([{ opciones: [c.medianoId, c.shotId] }])]);
      expect(shot).toMatchObject({ ok: false, codigo: "OPCION_NO_PERMITIDA_EN_PROMO" });
      expect(shot.mensaje).toContain("«Shot extra»");
      // Aunque el dueño la hubiera permitido por error en la base: nunca un adicional en una promo de precio fijo (I6).
      const sucia = await cafeYFlan([c.chicoId, c.shotId], { titulo: "Con shot" });
      expect(await agregar([sucia.pedir([{ opciones: [c.chicoId, c.shotId] }])])).toMatchObject({ ok: false, codigo: "OPCION_NO_PERMITIDA_EN_PROMO" });
      expect(await agregar([sucia.pedir([{ opciones: [c.chicoId] }])])).toMatchObject({ ok: true });
      expect(await prisma.cuentaItem.count({ where: { cuentaId, productoId: c.anclaDelShotId } })).toBe(0);
    });

    it("falta el tamaño obligatorio (OPCIONES_INVALIDAS) y la versión que vio el mozo ya no es la vigente (OPCION_CAMBIO)", async () => {
      const m = await cafeYFlan();
      expect(await agregar([m.pedir([{ opciones: [c.vacaId] }])])).toMatchObject({ ok: false, codigo: "OPCIONES_INVALIDAS" });
      expect(await agregar([m.pedir([{ opciones: [] }])])).toMatchObject({ ok: false, codigo: "OPCIONES_INVALIDAS" });
      expect(await agregar([m.pedir([{ opciones: [c.medianoId], versiones: { [c.medianoId]: "version-vieja" } }])])).toMatchObject({ ok: false, codigo: "OPCION_CAMBIO" });
      expect(await agregar([m.pedir([{ opciones: [c.chicoId, c.medianoId] }])])).toMatchObject({ ok: false, codigo: "OPCIONES_INVALIDAS" });
      await nada();
    });

    it("el mínimo y el máximo del LUGAR (1 a 2 cafés) siguen valiendo; sin elegir nada, también", async () => {
      const m = await cafeYFlan();
      expect(await agregar([m.pedir([{ opciones: [c.chicoId], cantidad: 3 }])])).toMatchObject({ ok: false, codigo: "PROMO_INVALIDA" });
      expect(await agregar([m.pedir([])])).toMatchObject({ ok: false, codigo: "PROMO_INVALIDA" });
      await nada();
    });

    it("una entrada de configuración FIJA no deja elegir opciones: lo que manda de más se rechaza (no se ignora)", async () => {
      const seccion = await prisma.seccionCarta.create({ data: { nombre: "Fijo" } });
      const promoCartaId = (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccion.id, titulo: "Café fijo", precio: "1500.00" } })).id;
      const cupo = await prisma.promoCartaCupo.create({ data: { promoCartaId, tipo: "LISTA", nombre: "Café", orden: 0, cantidadMinima: 1, cantidadMaxima: 1 } });
      const fijas = [{ opcionId: c.medianoId, cantidad: 1 }];
      const entrada = await prisma.entradaDeCupo.create({ data: { cupoId: cupo.id, productoId: c.cafeId, claveConfiguracion: claveDeConfiguracion(fijas)!, opciones: { create: fijas } } });
      // Un componente fijo se completa solo; elegir de más o mandar opciones se rechaza.
      expect(await agregar([{ promoCartaId, elecciones: [{ cupoId: cupo.id, elegidos: [{ entradaId: entrada.id, cantidad: 1, opciones: [elegida(c, c.chicoId)] }] }] }])).toMatchObject({ ok: false });
      await nada();
      expect(await agregar([{ promoCartaId, elecciones: [] }])).toMatchObject({ ok: true });
      expect((await lineas())[0]!.opcionesElegidas.map((f) => f.nombreOpcion)).toEqual(["Mediano"]);
    });
  });

  describe("lo permitido se calcula hoy y en la sucursal que vende", () => {
    it("una opción permitida pero APAGADA en la sucursal ya no se acepta; si se apagan todos los tamaños permitidos, el café deja de ofrecerse (falla cerrado)", async () => {
      const m = await cafeYFlan();
      await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: s.sucursalId, opcionId: c.chicoId, apagada: true, actualizadoPorId: s.admin.id } });
      expect(await agregar([m.pedir([{ opciones: [c.chicoId] }])])).toMatchObject({ ok: false, codigo: "OPCION_NO_PERMITIDA_EN_PROMO" });
      expect(await agregar([m.pedir([{ opciones: [c.medianoId] }])])).toMatchObject({ ok: true });
      await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: s.sucursalId, opcionId: c.medianoId, apagada: true, actualizadoPorId: s.admin.id } });
      expect(await agregar([m.pedir([{ opciones: [c.medianoId] }])])).toMatchObject({ ok: false, codigo: "ENTRADA_NO_DISPONIBLE" });
      expect(await prisma.promoCuenta.count({ where: { cuentaId } }), "solo la primera quedó").toBe(1);
    });

    it("cambiar lo permitido es OTRA entrada: la vieja se da de baja y se rechaza; la nueva admite Grande; lo ya cargado no cambia (I5)", async () => {
      const m = await cafeYFlan();
      expect(await agregar([m.pedir([{ opciones: [c.chicoId] }])])).toMatchObject({ ok: true });
      const primera = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId } });
      const deLaPrimera = async () => (await prisma.cuentaItem.findMany({ where: { promoCuentaId: primera.id }, orderBy: { id: "asc" } })).map((l) => [l.productoId, Number(l.precioUnitario), l.huellaOpciones]);
      const antes = await deLaPrimera();
      await prismaAdmin.entradaDeCupo.update({ where: { id: m.entradaCafe.id }, data: { activa: false } });
      const nueva = await entradaAElegir(m.cupoCafe.id, [c.chicoId, c.medianoId, c.grandeId]);
      expect(await agregar([m.pedir([{ opciones: [c.chicoId] }])])).toMatchObject({ ok: false, codigo: "ENTRADA_NO_DISPONIBLE" });
      expect(await agregar([m.pedir([{ opciones: [c.grandeId] }], {}, nueva.id)])).toMatchObject({ ok: true });
      expect(await deLaPrimera()).toEqual(antes);
      expect(await prisma.promoCuenta.count({ where: { cuentaId } })).toBe(2);
    });
  });

  describe("idempotencia", () => {
    it("la MISMA clave dos veces agrega la promo UNA vez (el reintento devuelve el mensaje original); con otro contenido es un conflicto", async () => {
      const m = await cafeYFlan();
      const clave = "11111111-1111-4111-8111-111111111111";
      const pedido = m.pedir([{ opciones: [c.medianoId, c.almendrasId] }]);
      const primera = await agregar([pedido], clave);
      expect(primera).toMatchObject({ ok: true });
      expect(await agregar([pedido], clave)).toEqual(primera);
      expect(await prisma.promoCuenta.count({ where: { cuentaId } })).toBe(1);
      expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(2);
      expect(await agregar([m.pedir([{ opciones: [c.chicoId] }])], clave)).toMatchObject({ ok: false, codigo: "CONFLICTO_IDEMPOTENCIA" });
      expect(await prisma.promoCuenta.count({ where: { cuentaId } })).toBe(1);
    });
  });

  describe("concurrencia real", () => {
    it("dos mozos agregan la promo a la vez con claves distintas: son dos intenciones, entran las dos enteras, cada una a $ 2000", async () => {
      const m = await cafeYFlan();
      const [a, b] = await Promise.all([
        agregar([m.pedir([{ opciones: [c.chicoId] }])], "22222222-2222-4222-8222-222222222222"),
        agregar([m.pedir([{ opciones: [c.medianoId, c.vacaId] }])], "33333333-3333-4333-8333-333333333333"),
      ]);
      expect([a.ok, b.ok]).toEqual([true, true]);
      const promos = await prisma.promoCuenta.findMany({ where: { cuentaId } });
      expect(promos).toHaveLength(2);
      for (const p of promos) expect(await totalDeLaPromo(p.id)).toBe(2000);
      expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(4);
    });

    it("el MISMO pedido con la MISMA clave a la vez (doble clic): una sola promo", async () => {
      const m = await cafeYFlan();
      const clave = "44444444-4444-4444-8444-444444444444";
      const pedido = m.pedir([{ opciones: [c.medianoId] }]);
      const [a, b] = await Promise.all([agregar([pedido], clave), agregar([pedido], clave)]);
      expect([a.ok, b.ok]).toEqual([true, true]);
      expect(await prisma.promoCuenta.count({ where: { cuentaId } })).toBe(1);
      expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(2);
    });

    it("agregar la promo contra darla de baja la entrada a la vez (10 veces): o la promo ENTERA o el rechazo; nunca una promo a medias", async () => {
      for (let i = 0; i < 10; i++) {
        await limpiarBaseDeTest();
        s = await sembrarSalon();
        c = await sembrarCafeDelSalon(s);
        cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
        const m = await cafeYFlan();
        const [r] = await Promise.all([agregar([m.pedir([{ opciones: [c.medianoId] }])]), prismaAdmin.entradaDeCupo.update({ where: { id: m.entradaCafe.id }, data: { activa: false } })]);
        const items = await prisma.cuentaItem.count({ where: { cuentaId } });
        if (r.ok) expect([items, await prisma.promoCuenta.count({ where: { cuentaId } })], `vuelta ${i}`).toEqual([2, 1]);
        else {
          expect(r.codigo, `vuelta ${i}`).toBe("ENTRADA_NO_DISPONIBLE");
          expect([items, await prisma.promoCuenta.count({ where: { cuentaId } })]).toEqual([0, 0]);
        }
      }
    }, 120_000);
  });

  describe("aislamiento", () => {
    it("una promo de OTRA empresa, o no prendida en esta sucursal, no existe (PROMO_INVALIDA, sin escribir nada)", async () => {
      const ajeno = await sembrarCombosAjenos();
      expect(await agregar([{ promoCartaId: ajeno.promo.id, elecciones: [] }])).toMatchObject({ ok: false, codigo: "PROMO_INVALIDA" });
      const apagada = await cafeYFlan(undefined, { titulo: "Sin sucursal", conSucursal: false });
      expect(await agregar([apagada.pedir([{ opciones: [c.medianoId] }])])).toMatchObject({ ok: false, codigo: "PROMO_INVALIDA" });
      await nada();
    });

    it("la entrada «a elegir» de otra empresa no se lee desde ésta (la RLS la oculta): la promo propia sigue entera", async () => {
      const m = await cafeYFlan();
      await sembrarCombosAjenos();
      expect(await agregar([m.pedir([{ opciones: [c.medianoId] }])])).toMatchObject({ ok: true });
      expect(await prisma.entradaDeCupo.count({ where: { modoDeOpciones: "A_ELEGIR" } })).toBe(1);
    });
  });
});

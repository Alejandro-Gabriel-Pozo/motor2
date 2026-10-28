import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { MENSAJE_MENU_DEL_DIA_APAGADO, MENU_DEL_DIA_VISIBLE, lugarDelDiaApagado, type CupoExistente, type CupoPedido } from "../../src/core/carta/public";
import { GRUPOS_NAV, RUTAS_DE_UNA_ENTRADA } from "../../src/core/navegacion/estructura";
import { guardComandoGuardarCuposPromoCarta } from "../../src/core/features/carta/promos.guard";
import { guardarCuposPromoCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/guardar-cupos-promo-carta";
import { agregarPlatoDelDia, copiarMenuDelDiaAnterior, quitarPlatoDelDia } from "../../src/server/actions/carta/menu-del-dia";
import MenuDelDiaPage from "../../src/app/(app)/movimientos/menu-del-dia/page";
import { CamposLugares } from "../../src/app/(app)/carta/parametrizacion/formularios";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actorDePrueba } from "../setup/opciones-de-venta";

/**
 * Interruptor del MENÚ DEL DÍA (`MENU_DEL_DIA_VISIBLE`, `src/core/carta/menu-del-dia.ts`; decisión del dueño 2026-10-20: hasta que se rediseñe, no se ve; no se borra nada ni se toca la base).
 * Fija los DOS estados:
 *  - APAGADO (el valor de hoy): Carta (adonde se mudó la entrada, Fase 7) no tiene la entrada «Menú del día»; su pantalla responde «no existe» (el 404 de Next, no un error); el formulario de la promo no ofrece «Plato del día»;
 *    y el servidor rechaza sumar un lugar del día (nuevo o reactivado) y cargar o copiar platos, aunque el pedido se arme a mano. Lo que ya existía se puede seguir cambiando o quitar.
 *  - ENCENDIDO (reversibilidad: cargando los módulos con el interruptor en `true`): vuelve todo lo de antes, en el mismo lugar.
 *
 * Mutaciones demostradas (rojo y revertidas; ver `logs/fase5b`): poner el interruptor en `true`; sacar el `notFound()` de la página; dejar la entrada del menú fija; dejar la opción «Plato del día»
 * fija; sacar el rechazo del caso de uso de los cupos; sacar el rechazo de cargar un plato.
 */

const cupo = (tipo: CupoPedido["tipo"], nombre: string): CupoPedido => ({ tipo, seccionCartaId: null, nombre, cantidadMinima: 1, cantidadMaxima: 1, orden: 1 });
const existente = (tipo: CupoPedido["tipo"], nombre: string, activo: boolean): CupoExistente => ({ ...cupo(tipo, nombre), id: `c-${nombre}`, activo });
const hrefsDe = (grupos: typeof GRUPOS_NAV, id: string) => grupos.find((g) => g.id === id)!.items.map((i) => i.href);

/** Lo que dibuja la fila «Sumar un lugar» del formulario de cupos, con un lugar del día que ya existía. */
const formularioDeLugares = (Campos: typeof CamposLugares) =>
  renderToStaticMarkup(<Campos lugares={[{ id: "l1", tipo: "DEL_DIA", nombre: "Plato del día", cantidadMinima: 1, cantidadMaxima: 1, orden: 1, entradas: [] }]} />);

/** El error que tira `notFound()` de Next (el que dibuja el 404). */
const esNoExiste = (e: unknown) => typeof (e as { digest?: unknown })?.digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404");

describe("menú del día APAGADO (decisión del dueño 2026-10-20)", () => {
  it("el interruptor está apagado", () => {
    expect(MENU_DEL_DIA_VISIBLE).toBe(false);
  });

  it("Carta no muestra «Menú del día» (ni como entrada ni como pestaña de Promociones, DEC-24), ni ningún otro grupo", () => {
    const hrefs = hrefsDe(GRUPOS_NAV, "carta");
    expect(hrefs).not.toContain("/movimientos/menu-del-dia");
    expect(hrefs).toEqual(["/carta", "/carta/parametrizacion/promociones", "/carta/parametrizacion/apariencia"]);
    expect(GRUPOS_NAV.flatMap((g) => g.items.map((i) => i.href))).not.toContain("/movimientos/menu-del-dia");
    expect(RUTAS_DE_UNA_ENTRADA.map((r) => r.href)).not.toContain("/movimientos/menu-del-dia");
  });

  it("la pantalla /movimientos/menu-del-dia responde «no existe» (404), antes de leer la sesión", async () => {
    const { getUsuarioActual } = await import("../../src/server/sesion/session");
    vi.mocked(getUsuarioActual).mockClear();
    const error = await MenuDelDiaPage({ searchParams: Promise.resolve({}) }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(esNoExiste(error)).toBe(true);
    expect(getUsuarioActual).not.toHaveBeenCalled();
  });

  it("el formulario de la promo no ofrece «Plato del día» para un lugar nuevo, pero sigue listando el lugar del día que ya existía", () => {
    const html = formularioDeLugares(CamposLugares);
    expect(html).not.toContain('<option value="DEL_DIA"');
    expect(html).toContain('<option value="LISTA"');
    expect(html).toContain('data-cupo-lugar="Plato del día"');
  });

  it("lugarDelDiaApagado: rechaza crear o reactivar un lugar del día; cambiar uno activo o una lista, no", () => {
    expect(lugarDelDiaApagado({ crear: [cupo("DEL_DIA", "Plato")], cambiar: [] }, false)).toBe(MENSAJE_MENU_DEL_DIA_APAGADO);
    expect(lugarDelDiaApagado({ crear: [], cambiar: [{ estaba: existente("DEL_DIA", "Plato", false), queda: cupo("DEL_DIA", "Plato") }] }, false)).toBe(MENSAJE_MENU_DEL_DIA_APAGADO);
    expect(lugarDelDiaApagado({ crear: [], cambiar: [{ estaba: existente("DEL_DIA", "Plato", true), queda: { ...cupo("DEL_DIA", "Plato"), cantidadMaxima: 2 } }] }, false)).toBeNull();
    expect(lugarDelDiaApagado({ crear: [cupo("LISTA", "Bebida")], cambiar: [] }, false)).toBeNull();
    // Encendido, nada se rechaza (reversibilidad de la regla pura).
    expect(lugarDelDiaApagado({ crear: [cupo("DEL_DIA", "Plato")], cambiar: [{ estaba: existente("DEL_DIA", "Otro", false), queda: cupo("DEL_DIA", "Otro") }] }, true)).toBeNull();
  });
});

describe("menú del día APAGADO: el servidor rechaza aunque el pedido se arme a mano (contra Postgres)", () => {
  let actor: ReturnType<typeof actorDePrueba> & { empresaZonaHoraria: string };
  let promoCartaId: string;
  let sucursalId: string;
  const guardar = (cupos: unknown[]) => guardarCuposPromoCartaCasoDeUso(actor, { promoCartaId, cupos: guardComandoGuardarCuposPromoCarta({ cupos }) });
  const cupos = async () => (await prismaAdmin.promoCartaCupo.findMany({ where: { promoCartaId }, orderBy: { nombre: "asc" } })).map((c) => [c.tipo, c.nombre, c.activo, c.cantidadMaxima]);
  const auditoria = () => prismaAdmin.registroAuditoria.count({ where: { entidad: "PromoCartaCupo" } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    actor = { ...actorDePrueba(admin.id, sucursalId), empresaZonaHoraria: "America/Argentina/Buenos_Aires" };
    const menus = (await prisma.seccionCarta.create({ data: { nombre: "Menús" } })).id;
    promoCartaId = (await prisma.promoCarta.create({ data: { seccionCartaId: menus, titulo: "Menú ejecutivo", precio: 9500 } })).id;
  });

  it("sumar un lugar del día nuevo se rechaza sin escribir nada (ni la lista que venía con él)", async () => {
    const r = await guardar([
      { tipo: "LISTA", nombre: "Bebida", cantidadMinima: 1, cantidadMaxima: 1 },
      { tipo: "DEL_DIA", nombre: "Plato del día", cantidadMinima: 1, cantidadMaxima: 1 },
    ]);
    expect(r).toMatchObject({ ok: false, codigo: "CUPO_INVALIDO", mensaje: MENSAJE_MENU_DEL_DIA_APAGADO });
    expect(await cupos()).toEqual([]);
    expect(await auditoria()).toBe(0);
    // Una lista sola se sigue pudiendo sumar.
    expect(await guardar([{ tipo: "LISTA", nombre: "Bebida", cantidadMinima: 1, cantidadMaxima: 1 }])).toMatchObject({ ok: true });
  });

  it("un lugar del día que ya existía se puede cambiar y quitar, pero no volver a sumar", async () => {
    await prismaAdmin.promoCartaCupo.create({ data: { promoCartaId, tipo: "DEL_DIA", nombre: "Plato del día", cantidadMinima: 1, cantidadMaxima: 1, orden: 1 } });
    expect(await guardar([{ tipo: "DEL_DIA", nombre: "Plato del día", cantidadMinima: 1, cantidadMaxima: 2 }])).toMatchObject({ ok: true });
    expect(await cupos()).toEqual([["DEL_DIA", "Plato del día", true, 2]]);
    expect(await guardar([])).toMatchObject({ ok: true });
    expect(await cupos()).toEqual([["DEL_DIA", "Plato del día", false, 2]]);
    expect(await guardar([{ tipo: "DEL_DIA", nombre: "Plato del día", cantidadMinima: 1, cantidadMaxima: 2 }])).toMatchObject({ ok: false, mensaje: MENSAJE_MENU_DEL_DIA_APAGADO });
    expect(await cupos()).toEqual([["DEL_DIA", "Plato del día", false, 2]]);
  });

  it("cargar o copiar un plato del día se rechaza (después del permiso); quitar uno no se bloquea", async () => {
    const hoy = "2026-10-20";
    expect(await agregarPlatoDelDia({ sucursalId, cupoId: "x", fecha: hoy, productoId: "y" })).toEqual({ ok: false, mensaje: MENSAJE_MENU_DEL_DIA_APAGADO });
    expect(await copiarMenuDelDiaAnterior({ sucursalId, fecha: hoy })).toEqual({ ok: false, mensaje: MENSAJE_MENU_DEL_DIA_APAGADO });
    const quitar = await quitarPlatoDelDia({ sucursalId, platoId: "no-existe" });
    expect(quitar.ok).toBe(false);
    expect(quitar.ok === false && quitar.mensaje).not.toBe(MENSAJE_MENU_DEL_DIA_APAGADO);
    // Sin sesión, el permiso sigue siendo lo primero (manda al login; no se delata el interruptor a un anónimo).
    const { getUsuarioActual } = await import("../../src/server/sesion/session");
    vi.mocked(getUsuarioActual).mockResolvedValueOnce(null);
    await expect(agregarPlatoDelDia({ sucursalId, cupoId: "x", fecha: hoy, productoId: "y" })).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("menú del día ENCENDIDO (reversibilidad: con el interruptor en true vuelve lo de antes)", () => {
  /** Carga de nuevo los módulos con el interruptor encendido (el resto del módulo, tal cual). */
  async function conInterruptorEncendido() {
    vi.resetModules();
    vi.doMock("../../src/core/carta/menu-del-dia", async (original) => ({ ...(await original<typeof import("../../src/core/carta/menu-del-dia")>()), MENU_DEL_DIA_VISIBLE: true }));
    return {
      rutas: (await import("../../src/core/navegacion/estructura")).RUTAS_DE_UNA_ENTRADA,
      pagina: (await import("../../src/app/(app)/movimientos/menu-del-dia/page")).default,
      formulario: (await import("../../src/app/(app)/carta/parametrizacion/formularios")).CamposLugares,
      sesion: await import("../../src/server/sesion/session"),
    };
  }
  afterEach(() => {
    vi.doUnmock("../../src/core/carta/menu-del-dia");
    vi.resetModules();
  });

  it("Promociones vuelve a tener la pestaña «Menú del día» (DEC-24: cuelga de esa entrada), con su permiso de siempre", async () => {
    const { rutas } = await conInterruptorEncendido();
    expect(rutas.find((r) => r.href === "/movimientos/menu-del-dia")).toEqual({ href: "/movimientos/menu-del-dia", label: "Menú del día", accion: "promo_menu_del_dia", panel: "sucursal", entrada: "/carta/parametrizacion/promociones" });
  });

  it("la pantalla deja de responder «no existe»: sin sesión manda al login, como cualquier pantalla", async () => {
    const { pagina, sesion } = await conInterruptorEncendido();
    vi.mocked(sesion.getUsuarioActual).mockResolvedValue(null);
    const error = await pagina({ searchParams: Promise.resolve({}) }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(esNoExiste(error)).toBe(false);
    expect(String((error as { digest?: string })?.digest)).toMatch(/^NEXT_REDIRECT/);
  });

  it("el formulario vuelve a ofrecer «Plato del día»", async () => {
    const { formulario } = await conInterruptorEncendido();
    expect(formularioDeLugares(formulario)).toContain('<option value="DEL_DIA">Plato del día</option>');
  });
});

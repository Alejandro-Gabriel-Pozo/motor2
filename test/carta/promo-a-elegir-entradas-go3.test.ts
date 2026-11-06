import { beforeEach, describe, expect, it } from "vitest";
import { agregarEntradaDeCupoCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/agregar-entrada-de-cupo";
import { actualizarActivaEntradaDeCupoCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/actualizar-activa-entrada-de-cupo";
import { guardComandoAgregarEntradaDeCupo } from "../../src/core/features/carta/combos.guard";
import { claveDeConfiguracion } from "../../src/core/pos/promo-combo";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { actorDeCombos, sembrarCombosAjenos, sembrarCombosGo3b, type EscenarioDeCombosGo3b } from "../setup/combos-go3b";

/**
 * Promo «a elegir» (etapa N1 PR A), el GUARDADO de la entrada: `agregarEntradaDeCupoCasoDeUso` con `modoDeOpciones = 'A_ELEGIR'` (las opciones del comando son las PERMITIDAS) contra Postgres real, como `motor2_app` con el
 * alcance de la sucursal A. El Café del escenario admite Tamaño (MEDIDA 1 a 1), Leche (0 a 1), «Viene con» (INCLUIDA 1 a 1, Azúcar) y Extras (ADICIONAL, Shot).
 *
 * Fija: se guarda con su modo, su clave canónica y sus opciones permitidas, con auditoría, por estado (repetir no escribe) y una sola fila con dos altas a la vez; rechaza (sin escribir) lo vacío, un adicional (I6, el
 * precio de la promo es fijo), una opción que el producto no admite, un grupo obligatorio sin ninguna opción permitida (falla cerrado: nunca una entrada que no se puede armar, I8) y mezclar el modo (la misma clave como
 * entrada FIJA); reactivarla la valida como «a elegir» (no como configuración fija); otra empresa no se ve (RLS).
 *
 * Mutaciones demostradas (rojo y revertidas): sacar el rechazo de ADICIONAL de `validarComponenteEnTx` (rojo: «adicional»); no pasar `modoDeOpciones` al reactivar (rojo: «reactivar»); sacar la comparación de modo con la
 * entrada existente (rojo: «mezclar»).
 */
describe("guardar una entrada «a elegir» (promo, etapa N1)", () => {
  let e: EscenarioDeCombosGo3b;
  const actor = () => actorDeCombos(e.usuarioId, e.sucursalA);
  const agregar = (cupoId: string, productoId: string, opciones: unknown, modoDeOpciones?: unknown) => {
    const comando = guardComandoAgregarEntradaDeCupo({ cupoId, productoId, opciones, ...(modoDeOpciones === undefined ? {} : { modoDeOpciones }) });
    if (!comando.ok) throw new Error(comando.mensaje);
    return agregarEntradaDeCupoCasoDeUso(actor(), comando.valor);
  };
  const auditoria = async () => (await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "EntradaDeCupo" }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).map((f) => [f.valorAnterior, f.valorNuevo, f.descripcion]);
  const permitidas = () => [{ opcionId: e.chicoId }, { opcionId: e.medianoId }, { opcionId: e.azucarId }];

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarCombosGo3b();
  });

  it("se guarda con su modo, su clave canónica de lo permitido y sus opciones; con auditoría; repetir no escribe ni audita", async () => {
    const r = await agregar(e.cupoEntradaId, e.cafeId, permitidas(), "A_ELEGIR");
    expect(r, r.mensaje).toMatchObject({ ok: true, datos: { huboCambio: true } });
    const entrada = await prisma.entradaDeCupo.findFirstOrThrow({ where: { productoId: e.cafeId }, include: { opciones: true } });
    expect(entrada.modoDeOpciones).toBe("A_ELEGIR");
    expect(entrada.claveConfiguracion).toBe(claveDeConfiguracion([e.chicoId, e.medianoId, e.azucarId].map((opcionId) => ({ opcionId, cantidad: 1 })))!);
    expect(entrada.opciones.map((o) => [o.opcionId, o.cantidad]).sort()).toEqual([[e.chicoId, 1], [e.medianoId, 1], [e.azucarId, 1]].sort());
    expect(await auditoria()).toEqual([[null, "true", expect.stringContaining("el mozo elige entre las opciones permitidas")]]);
    expect(await agregar(e.cupoEntradaId, e.cafeId, permitidas().reverse(), "A_ELEGIR")).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect(await prisma.entradaDeCupo.count()).toBe(1);
    expect(await auditoria()).toHaveLength(1);
    // Sin `modoDeOpciones` el comando sigue siendo el de siempre (configuración fija): los dos tamaños juntos no valen (1 a 1).
    expect(await agregar(e.cupoEntradaId, e.cafeId, permitidas())).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await prisma.entradaDeCupo.count()).toBe(1);
  });

  it("rechaza, sin escribir nada: lo vacío, un ADICIONAL (I6), una opción que el producto no admite y un grupo obligatorio sin ninguna opción permitida", async () => {
    const casos: [string, string, { opcionId: string }[], RegExp][] = [
      ["sin opciones permitidas", e.cafeId, [], /al menos una opción permitida/],
      ["un adicional", e.cafeId, [...permitidas(), { opcionId: e.shotId }], /no lleva adicionales/],
      ["una opción de otro producto", e.guisoId, [{ opcionId: e.medianoId }], /no es de este producto/],
      ["falta el grupo obligatorio «Tamaño»", e.cafeId, [{ opcionId: e.azucarId }], /Tamaño/],
      ["falta el grupo obligatorio «Viene con»", e.cafeId, [{ opcionId: e.chicoId }], /Viene con/],
    ];
    for (const [nombre, productoId, opciones, mensaje] of casos) {
      const r = await agregar(e.cupoEntradaId, productoId, opciones, "A_ELEGIR");
      expect(r, nombre).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      expect(r.mensaje, nombre).toMatch(mensaje);
    }
    expect(await prisma.entradaDeCupo.count()).toBe(0);
    expect(await auditoria()).toEqual([]);
  });

  it("una opción permitida APAGADA en el producto o en la empresa no cuenta: si deja un grupo obligatorio sin nada, se rechaza", async () => {
    await prisma.opcionDeGrupo.updateMany({ where: { id: { in: [e.chicoId, e.medianoId] } }, data: { activa: false } });
    const r = await agregar(e.cupoEntradaId, e.cafeId, permitidas(), "A_ELEGIR");
    expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(r.mensaje).toContain("Tamaño");
    expect(await prisma.entradaDeCupo.count()).toBe(0);
  });

  it("no se mezcla el modo: lo mismo como configuración FIJA (o al revés) con la misma clave se rechaza y no cambia la entrada que ya existe", async () => {
    expect(await agregar(e.cupoEntradaId, e.cafeId, [{ opcionId: e.medianoId }, { opcionId: e.azucarId }])).toMatchObject({ ok: true });
    const r = await agregar(e.cupoEntradaId, e.cafeId, [{ opcionId: e.medianoId }, { opcionId: e.azucarId }], "A_ELEGIR");
    expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(r.mensaje).toContain("con esas opciones fijas");
    expect((await prisma.entradaDeCupo.findMany()).map((x) => x.modoDeOpciones)).toEqual(["FIJAS"]);
  });

  it("reactivar una entrada dada de baja la valida como «a elegir» y conserva su modo", async () => {
    const creada = await agregar(e.cupoEntradaId, e.cafeId, permitidas(), "A_ELEGIR");
    if (!creada.ok) throw new Error(creada.mensaje);
    const { entradaId } = creada.datos;
    expect(await actualizarActivaEntradaDeCupoCasoDeUso(actor(), { entradaId, activa: false })).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect(await actualizarActivaEntradaDeCupoCasoDeUso(actor(), { entradaId, activa: true })).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect(await prisma.entradaDeCupo.findUniqueOrThrow({ where: { id: entradaId } })).toMatchObject({ activa: true, modoDeOpciones: "A_ELEGIR" });
    // Y volver a dar de alta lo mismo la encuentra (no crea otra).
    expect(await agregar(e.cupoEntradaId, e.cafeId, permitidas(), "A_ELEGIR")).toMatchObject({ ok: true, datos: { huboCambio: false, entradaId } });
    expect(await prisma.entradaDeCupo.count()).toBe(1);
  });

  it("concurrencia real: dos altas iguales a la vez dejan UNA fila y las dos responden bien (10 veces)", async () => {
    for (let i = 0; i < 10; i++) {
      await limpiarBaseDeTest();
      e = await sembrarCombosGo3b();
      const [a, b] = await Promise.all([agregar(e.cupoEntradaId, e.cafeId, permitidas(), "A_ELEGIR"), agregar(e.cupoEntradaId, e.cafeId, permitidas(), "A_ELEGIR")]);
      expect([a.ok, b.ok], `vuelta ${i}`).toEqual([true, true]);
      expect(await prisma.entradaDeCupo.count({ where: { modoDeOpciones: "A_ELEGIR" } }), `vuelta ${i}`).toBe(1);
      expect(await prisma.opcionDeEntradaDeCupo.count(), `vuelta ${i}`).toBe(3);
    }
  }, 120_000);

  it("aislamiento: un lugar de OTRA empresa no existe; el modo no se puede cambiar con un UPDATE de la app (la identidad es inmutable)", async () => {
    const ajeno = await sembrarCombosAjenos();
    expect(await agregar(ajeno.cupoLista.id, e.cafeId, permitidas(), "A_ELEGIR")).toMatchObject({ ok: false, codigo: "CUPO_NO_ENCONTRADO" });
    expect(await agregar(e.cupoEntradaId, e.cafeId, permitidas(), "A_ELEGIR")).toMatchObject({ ok: true });
    await expect(prisma.entradaDeCupo.updateMany({ data: { modoDeOpciones: "FIJAS" } })).rejects.toMatchObject({ meta: expect.anything() });
    expect((await prisma.entradaDeCupo.findFirstOrThrow()).modoDeOpciones).toBe("A_ELEGIR");
  });

  it("el guard: sin modo es FIJAS; un modo que no es FIJAS ni A_ELEGIR se rechaza antes de tocar la base", () => {
    expect(guardComandoAgregarEntradaDeCupo({ cupoId: "c", productoId: "p" })).toMatchObject({ ok: true, valor: { modoDeOpciones: "FIJAS" } });
    expect(guardComandoAgregarEntradaDeCupo({ cupoId: "c", productoId: "p", modoDeOpciones: "A_ELEGIR" })).toMatchObject({ ok: true, valor: { modoDeOpciones: "A_ELEGIR" } });
    for (const malo of ["", "a_elegir", "TODAS", 1, true]) expect(guardComandoAgregarEntradaDeCupo({ cupoId: "c", productoId: "p", modoDeOpciones: malo }), JSON.stringify(malo)).toMatchObject({ ok: false });
  });
});

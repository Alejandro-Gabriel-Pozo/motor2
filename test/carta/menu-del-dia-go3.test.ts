import { beforeEach, describe, expect, it, vi } from "vitest";
import { agregarPlatoDelDiaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/agregar-plato-del-dia";
import { quitarPlatoDelDiaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/quitar-plato-del-dia";
import { copiarMenuDelDiaAnteriorCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/copiar-menu-del-dia-anterior";
import { guardComandoAgregarPlatoDelDia, guardComandoQuitarPlatoDelDia } from "../../src/core/features/carta/menu-del-dia.guard";
import { validarFechaDeMenuDelDia } from "../../src/core/carta/public";
import { crearPlatoDelDia } from "../../src/server/persistencia/carta/combos";
import { ZONA_ARGENTINA, diaDeCalendario, fechaDeColumnaDate, sumarDias } from "../../src/core/tiempo/zona-horaria";
import { limpiarBaseDeTest, prisma, prismaAdmin, prismaSinEmpresa } from "../setup/test-db";
import { actorDeCombos, sembrarCombosAjenos, sembrarCombosGo3b, type EscenarioDeCombosGo3b } from "../setup/combos-go3b";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * GO-3b (ADR-032, paso D5): el MENÚ DEL DÍA de la sucursal (D-1: por fecha y por sucursal; D-5: `promo_menu_del_dia`, delegable al encargado). El encargado elige productos de venta que YA existen
 * (D-9: sin receta no entra), de hoy a hoy + 13 en la zona de la empresa, solo en la sucursal activa (eco del guard y políticas de la base). Contra Postgres real como `motor2_app` con el alcance de la
 * sucursal A.
 *
 * Mutaciones demostradas (rojo y revertidas): calcular «hoy» en UTC en vez de en la zona de la empresa (rojo: «23:30 del 13/10»); sacar `validarPlatoDelDiaEnTx` de la copia (rojo: «todo o nada»);
 * buscar el plato a quitar sin la sucursal de la sesión (no rojo: la RLS por sucursal lo oculta igual —es la segunda barrera, la que prueba «otra sucursal»—).
 */
const ITERACIONES = 10;

describe("el menú del día de la sucursal (GO-3b, D5)", () => {
  let e: EscenarioDeCombosGo3b;
  const hoy = diaDeCalendario(AHORA_DE_LA_CORRIDA, ZONA_ARGENTINA);
  const actor = (ahora: Date = AHORA_DE_LA_CORRIDA) => actorDeCombos(e.usuarioId, e.sucursalA, ahora);
  const agregar = (productoId: string, fecha = hoy, ahora?: Date, cupoId?: string) => {
    const c = guardComandoAgregarPlatoDelDia({ sucursalId: e.sucursalA, sucursalActivaId: e.sucursalA, cupoId: cupoId ?? e.cupoDelDiaId, fecha, productoId });
    if (!c.ok) throw new Error(c.mensaje);
    return agregarPlatoDelDiaCasoDeUso(actor(ahora), c.valor);
  };
  const platos = async (fecha = hoy) =>
    (await prisma.entradaDelDiaDeCupo.findMany({ where: { fecha: fechaDeColumnaDate(fecha) }, orderBy: { productoId: "asc" } })).map((p) => [p.productoId, p.sucursalId, p.activa]);
  const auditoria = async () =>
    (await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "EntradaDelDiaDeCupo" }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).map((f) => [f.entidadId, f.valorAnterior, f.valorNuevo, f.sucursalId]);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarCombosGo3b();
  });

  it("carga un producto existente con receta como plato de HOY en la sucursal activa, auditado con la sucursal; repetir no escribe", async () => {
    expect(await agregar(e.milanesaId)).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect(await platos()).toEqual([[e.milanesaId, e.sucursalA, true]]);
    const id = (await prisma.entradaDelDiaDeCupo.findFirstOrThrow()).id;
    expect(await auditoria()).toEqual([[id, null, "true", e.sucursalA]]);
    expect(await agregar(e.milanesaId)).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect(await auditoria()).toHaveLength(1);
    expect((await prisma.entradaDelDiaDeCupo.findFirstOrThrow()).actualizadoPorId).toBe(e.usuarioId);
  });

  it("la fecha es la de la ZONA DE LA EMPRESA: a las 23:30 del 13/10 en Buenos Aires (02:30 del 14 en UTC) hoy es el 13; de hoy a hoy + 13", async () => {
    const tarde = new Date("2026-10-14T02:30:00.000Z");
    expect(await agregar(e.milanesaId, "2026-10-13", tarde)).toMatchObject({ ok: true });
    expect(await agregar(e.guisoId, "2026-10-12", tarde)).toMatchObject({ ok: false, codigo: "FECHA_INVALIDA" });
    expect(await agregar(e.guisoId, "2026-10-26", tarde)).toMatchObject({ ok: true });
    expect(await agregar(e.guisoId, "2026-10-27", tarde)).toMatchObject({ ok: false, codigo: "FECHA_INVALIDA" });
    expect(validarFechaDeMenuDelDia("2026-02-30", "2026-02-01").ok).toBe(false);
  });

  it("D-9 y compañía: sin receta, no disponible en la sucursal, con opciones obligatorias o en un lugar que no es del día se rechaza sin escribir", async () => {
    const sinReceta = await agregar(e.sinRecetaId);
    expect(sinReceta).toMatchObject({ ok: false, codigo: "COMPONENTE_SIN_RECETA" });
    expect(sinReceta.mensaje).toContain("Catálogo → Recetas");
    await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: e.sucursalA, productoId: e.guisoId } }, data: { disponible: false } });
    expect(await agregar(e.guisoId)).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_DISPONIBLE" });
    expect(await agregar(e.cafeId)).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await agregar(e.milanesaId, hoy, undefined, e.cupoEntradaId)).toMatchObject({ ok: false, codigo: "CUPO_INVALIDO" });
    expect(await prisma.entradaDelDiaDeCupo.count()).toBe(0);
    expect(await auditoria()).toEqual([]);
  });

  it("D-2: un plato con una alícuota declarada distinta de otra opción del menú se rechaza", async () => {
    await prisma.producto.update({ where: { id: e.sopaId }, data: { alicuotaIvaVenta: "IVA_21" } });
    await prisma.producto.update({ where: { id: e.milanesaId }, data: { alicuotaIvaVenta: "IVA_10_5" } });
    await prisma.entradaDeCupo.create({ data: { cupoId: e.cupoEntradaId, productoId: e.sopaId } });
    expect(await agregar(e.milanesaId)).toMatchObject({ ok: false, codigo: "COMBO_ALICUOTAS_DISTINTAS" });
  });

  it("aislamiento: el eco rechaza otra sucursal; la base no deja escribir en S2 desde S1 (42501); un plato de S2 o un lugar de otra empresa no se encuentran", async () => {
    expect(guardComandoAgregarPlatoDelDia({ sucursalId: e.sucursalB, sucursalActivaId: e.sucursalA, cupoId: e.cupoDelDiaId, fecha: hoy, productoId: e.milanesaId }).ok).toBe(false);
    expect(guardComandoQuitarPlatoDelDia({ sucursalId: e.sucursalB, sucursalActivaId: e.sucursalA, platoId: "x" }).ok).toBe(false);
    // La segunda barrera: aunque un error del código intentara escribir en S2 con el alcance de S1, la política RESTRICTIVE de la base lo rechaza.
    await expect(
      actor().transaccion((tx) => crearPlatoDelDia(tx, { cupoId: e.cupoDelDiaId, sucursalId: e.sucursalB, fecha: fechaDeColumnaDate(hoy), productoId: e.milanesaId, actualizadoPorId: e.usuarioId, ahora: AHORA_DE_LA_CORRIDA })),
    ).rejects.toThrow(/row-level security|42501/);
    const deB = await prisma.entradaDelDiaDeCupo.create({ data: { cupoId: e.cupoDelDiaId, sucursalId: e.sucursalB, fecha: fechaDeColumnaDate(hoy), productoId: e.milanesaId, actualizadoPorId: e.usuarioId } });
    expect(await quitarPlatoDelDiaCasoDeUso(actor(), { platoId: deB.id })).toMatchObject({ ok: false, codigo: "PLATO_NO_ENCONTRADO" });
    expect((await prisma.entradaDelDiaDeCupo.findUniqueOrThrow({ where: { id: deB.id } })).activa).toBe(true);
    const ajeno = await sembrarCombosAjenos();
    expect(await agregar(e.milanesaId, hoy, undefined, ajeno.cupoDelDia.id)).toMatchObject({ ok: false, codigo: "CUPO_NO_ENCONTRADO" });
    expect(await agregar(ajeno.producto.id)).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO" });
  });

  it("quitar deja la fila inactiva (no borra), auditado; volver a cargarlo reactiva la MISMA fila", async () => {
    expect(await agregar(e.milanesaId)).toMatchObject({ ok: true });
    const id = (await prisma.entradaDelDiaDeCupo.findFirstOrThrow()).id;
    expect(await quitarPlatoDelDiaCasoDeUso(actor(), { platoId: id })).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect(await quitarPlatoDelDiaCasoDeUso(actor(), { platoId: id })).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect(await platos()).toEqual([[e.milanesaId, e.sucursalA, false]]);
    expect(await agregar(e.milanesaId)).toMatchObject({ ok: true, datos: { huboCambio: true } });
    expect((await prisma.entradaDelDiaDeCupo.findMany()).map((p) => [p.id, p.activa])).toEqual([[id, true]]);
    expect(await auditoria()).toEqual([
      [id, null, "true", e.sucursalA],
      [id, "true", "false", e.sucursalA],
      [id, "false", "true", e.sucursalA],
    ]);
  });

  it("copiar el día anterior: copia los activos (no los quitados), por estado, y es todo o nada", async () => {
    const manana = sumarDias(hoy, 1);
    expect(await agregar(e.milanesaId)).toMatchObject({ ok: true });
    expect(await agregar(e.guisoId)).toMatchObject({ ok: true });
    expect(await agregar(e.sopaId)).toMatchObject({ ok: true });
    await quitarPlatoDelDiaCasoDeUso(actor(), { platoId: (await prisma.entradaDelDiaDeCupo.findFirstOrThrow({ where: { productoId: e.sopaId } })).id });
    const copiar = (fecha: string) => copiarMenuDelDiaAnteriorCasoDeUso(actor(), { fecha });
    expect(await copiar(manana)).toMatchObject({ ok: true, datos: { copiados: 2 } });
    expect(await platos(manana)).toEqual([[e.guisoId, e.sucursalA, true], [e.milanesaId, e.sucursalA, true]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    expect(await copiar(manana)).toMatchObject({ ok: true, datos: { copiados: 0 } });
    // Todo o nada: si un plato del día anterior perdió la receta, no se copia ninguno.
    const pasado = sumarDias(hoy, 2);
    await prismaAdmin.recetaIngrediente.deleteMany({ where: { recetaVersion: { productoId: e.guisoId } } });
    const r = await copiar(pasado);
    expect(r).toMatchObject({ ok: false, codigo: "COMPONENTE_SIN_RECETA" });
    expect(r.mensaje).toContain("Guiso");
    expect(await platos(pasado)).toEqual([]);
    expect(await copiar(sumarDias(hoy, 5))).toMatchObject({ ok: false, codigo: "SIN_PLATOS_PARA_COPIAR" });
  });

  it("concurrencia real: dos encargados cargan el MISMO plato a la vez: una sola fila y una sola alta auditada (loop de 10)", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < ITERACIONES; i++) {
      const fecha = sumarDias(hoy, i);
      const resultados = await Promise.allSettled([agregar(e.milanesaId, fecha), agregar(e.milanesaId, fecha)]);
      expect(resultados.map((r) => r.status), `iteración ${i}`).toEqual(["fulfilled", "fulfilled"]);
      const valores = resultados.map((r) => (r.status === "fulfilled" ? r.value : null));
      expect(valores.every((v) => v?.ok), `iteración ${i}: ${valores.map((v) => v?.mensaje).join(" | ")}`).toBe(true);
      expect(valores.filter((v) => v?.ok && v.datos.huboCambio), `iteración ${i}`).toHaveLength(1);
      const filas = await prisma.entradaDelDiaDeCupo.findMany({ where: { fecha: fechaDeColumnaDate(fecha) } });
      expect(filas, `iteración ${i}`).toHaveLength(1);
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "EntradaDelDiaDeCupo", entidadId: filas[0]!.id } })).toBe(1);
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración chocaron: el test no ejercitó el único ni el reintento").toBeGreaterThan(2 * ITERACIONES);
    intentos.mockRestore();
  });
});

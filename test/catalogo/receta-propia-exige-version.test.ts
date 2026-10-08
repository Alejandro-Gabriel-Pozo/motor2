import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import {
  actualizarIngredienteDeRecetaPropia,
  agregarIngredienteARecetaPropia,
  copiarRecetaPropiaDeOtraSucursal,
  crearRecetaPropiaDesdeLaCentral,
  quitarIngredienteDeRecetaPropia,
} from "../../src/server/actions/catalogo/receta-sucursal";
import { guardarRecetaACiegas } from "../../src/server/actions/catalogo/receta-a-ciegas";

type AccionSinTipos = (...args: unknown[]) => Promise<{ ok: boolean; mensaje: string }>;

/**
 * O.45 de `docs/pureza-integracion.md` (cierre del Hito 4, hallazgo menor 1 de la auditoría independiente; mismo hueco que O.1 cerró en la receta central —
 * CAMBIA COMPORTAMIENTO, decisión del orquestador con el criterio del dueño): las cinco acciones de la receta PROPIA que guardan una versión (`crear`, `agregar`,
 * `actualizar`, `quitar`, `copiar`) ya no aceptan un guardado «a ciegas» desde la red. Antes `guardarEnLaPropia` llamaba al guard SIN `exigirVersion`: con
 * `versionVista` `undefined`/`null`/omitida se guardaba una versión nueva sobre la serie propia sin chequear la versión. Ahora la versión vista tiene que ser un entero
 * ≥ 0 — el MISMO texto que la acción pública `guardarReceta` — y se valida antes de la primera lectura (por eso `agregar`, `actualizar` y `quitar`, que antes contestaban
 * con un mensaje armado DESPUÉS de leer el estado, ahora contestan con el de la versión). Se llama a las acciones SIN tipos porque desde la red llega cualquier cosa.
 *
 * Escenario: Central (la sucursal activa) sin receta propia; Norte con su propia habilitada; la Pizza con receta central (harina). Con una versión mala, en Central no
 * se escribe nada (ni versión propia ni fila de `RecetaSucursal`) y la propia de Norte queda igual. ROJO contra `39425653`: `crear` y `copiar` con `undefined`/`null`/
 * omitida guardaban (a ciegas), y `agregar`/`actualizar`/`quitar` contestaban con su mensaje de estado.
 */
describe("O.45: la receta propia exige la versión vista", () => {
  let centralId: string;
  let norteId: string;
  let kgId: string;
  let pvId: string;
  let harinaId: string;
  let quesoId: string;
  const MENSAJE = "La versión de la receta que se esperaba no es válida.";
  const linea = (insumoProductoId: string) => ({ insumoProductoId, cantidad: 1, unidadId: kgId, mermaPorcentaje: 0 });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    kgId = (await sembrarCatalogoBase()).kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    await crearMembresia({ usuarioId: admin.id, sucursalId: norteId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    harinaId = (await sembrarProductoDisponible({ codigo: "MP_H", nombre: "Harina", tipo: "MP", unidadStockId: kgId }, centralId)).id;
    quesoId = (await sembrarProductoDisponible({ codigo: "MP_Q", nombre: "Queso", tipo: "MP", unidadStockId: kgId }, centralId)).id;
    pvId = (await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, centralId)).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norteId, productoId: pvId, disponible: true } });
    __setCookieDeTestParaSucursal(centralId);
    expect((await guardarRecetaACiegas(pvId, [linea(harinaId)])).ok).toBe(true);
    __setCookieDeTestParaSucursal(norteId);
    expect((await crearRecetaPropiaDesdeLaCentral(pvId, 0, false)).ok).toBe(true); // propia de Norte v1
    __setCookieDeTestParaSucursal(centralId);
  });

  const nadaEscritoEnCentral = async () => {
    expect(await prisma.recetaVersion.count({ where: { sucursalId: centralId } })).toBe(0);
    expect(await prisma.recetaSucursal.count({ where: { sucursalId: centralId } })).toBe(0);
    expect(await prisma.recetaVersion.count({ where: { sucursalId: norteId } })).toBe(1);
  };

  const MALAS: [string, unknown][] = [
    ["undefined", undefined],
    ["null", null],
    ["negativa", -1],
    ["no entera", 1.5],
    ["texto", "1"],
  ];

  const ACCIONES: [string, (version: unknown) => Promise<{ ok: boolean; mensaje: string }>][] = [
    ["crear", (v) => (crearRecetaPropiaDesdeLaCentral as unknown as AccionSinTipos)(pvId, v, false)],
    ["agregar", (v) => (agregarIngredienteARecetaPropia as unknown as AccionSinTipos)(pvId, linea(quesoId), v, false)],
    ["actualizar", (v) => (actualizarIngredienteDeRecetaPropia as unknown as AccionSinTipos)(pvId, harinaId, { cantidad: 2, unidadId: kgId }, v, false)],
    ["quitar", (v) => (quitarIngredienteDeRecetaPropia as unknown as AccionSinTipos)(pvId, harinaId, v, false)],
    ["copiar", (v) => (copiarRecetaPropiaDeOtraSucursal as unknown as AccionSinTipos)(pvId, norteId, true, v, false)],
  ];

  it.each(ACCIONES)("%s: una versión vista undefined, null, negativa, no entera o de texto se rechaza con el texto de siempre y no escribe nada", async (_nombre, llamar) => {
    for (const [cual, version] of MALAS) {
      expect(await llamar(version), cual).toEqual({ ok: false, mensaje: MENSAJE });
    }
    await nadaEscritoEnCentral();
  });

  it("la versión vista omitida (la llamada sin los dos últimos argumentos) se rechaza igual en las cinco y no escribe nada", async () => {
    const sinTipos = (f: unknown) => f as AccionSinTipos;
    expect(await sinTipos(crearRecetaPropiaDesdeLaCentral)(pvId)).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await sinTipos(agregarIngredienteARecetaPropia)(pvId, linea(quesoId))).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await sinTipos(actualizarIngredienteDeRecetaPropia)(pvId, harinaId, { cantidad: 2, unidadId: kgId })).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await sinTipos(quitarIngredienteDeRecetaPropia)(pvId, harinaId)).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await sinTipos(copiarRecetaPropiaDeOtraSucursal)(pvId, norteId, true)).toEqual({ ok: false, mensaje: MENSAJE });
    await nadaEscritoEnCentral();
  });

  it("con la versión vista sigue guardando (crear y copiar en Central)", async () => {
    expect(await crearRecetaPropiaDesdeLaCentral(pvId, 0, false)).toMatchObject({ ok: true });
    expect(await copiarRecetaPropiaDeOtraSucursal(pvId, norteId, true, 1, true)).toMatchObject({ ok: true });
    expect(await prisma.recetaVersion.count({ where: { sucursalId: centralId } })).toBe(2);
  });
});

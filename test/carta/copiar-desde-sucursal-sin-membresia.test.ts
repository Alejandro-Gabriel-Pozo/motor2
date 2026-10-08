import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { habilitadaDeRecetaPropia, versionVigenteDeReceta } from "../setup/version-de-receta";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { copiarCartaDeSucursal } from "../../src/server/actions/carta/copiar-carta";
import { copiarRecetaPropiaDeOtraSucursal, crearRecetaPropiaDesdeLaCentral } from "../../src/server/actions/catalogo/receta-sucursal";
import { guardarRecetaACiegas } from "../../src/server/actions/catalogo/receta-a-ciegas";
import { listarSucursalesConRecetaPropia } from "../../src/server/consultas/catalogo/receta-propia";
import { cargarAdminCarta, origenesDeCopiaVisibles } from "../../src/server/consultas/carta/admin";

/**
 * S-07 del plan de endurecimiento de seguridad (fila O.56 de `docs/pureza-integracion.md`; CAMBIA COMPORTAMIENTO, aprobado por el dueño): copiar la receta propia o la carta
 * propia de OTRA sucursal solo se puede con membresía activa en el ORIGEN y «Ver» de esa clave allá. Antes el origen se buscaba solo por id bajo la RLS de empresa (que
 * separa empresas, no sucursales): un administrador de la sucursal 1 copiaba, con el id de la sucursal 2, la receta y la carta de una sucursal donde no tiene ni membresía
 * (ADR-009 lo daba por diseño; la regla «dentro de la empresa la sucursal es el punto débil» lo cierra).
 *
 * Escenario: una empresa con Central (S1) y Norte (S2). Norte tiene receta propia de la Pizza y carta propia. `atacante` es admin SOLO de Central; `mixto` es admin de
 * Central y operador de Norte (sin `receta_sucursal_copiar` ni `carta_ver` allá); `dueno` es admin de las dos (el control que sí copia). La sucursal destino (Central)
 * está vacía. Con acceso denegado no se escribe nada y la respuesta no nombra nada de Norte.
 */
const SIN_ACCESO = "No tenés acceso a esa sucursal.";

describe("S-07: copiar desde una sucursal sin membresía en el origen", () => {
  let centralId: string;
  let norteId: string;
  let surId: string;
  let kgId: string;
  let pvId: string;
  let atacanteId: string;
  let mixtoId: string;
  let duenoId: string;
  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const linea = (insumoProductoId: string) => ({ insumoProductoId, cantidad: 1, unidadId: kgId, mermaPorcentaje: 0 });
  const cartaDe = async (sucursalId: string) => ({
    contenidos: await prisma.contenidoCartaProducto.count({ where: { sucursalId } }),
    generos: await prisma.generoCarta.count({ where: { sucursalId } }),
    items: await prisma.itemAgrupadoCarta.count({ where: { sucursalId } }),
  });
  const recetasPropiasDe = async (sucursalId: string) => ({
    filas: await prisma.recetaSucursal.count({ where: { sucursalId } }),
    versiones: await prisma.recetaVersion.count({ where: { sucursalId } }),
  });
  /** Copia la receta propia de `origen` a la sucursal activa del usuario (Central), con la versión que la pantalla mostraría. */
  const copiarReceta = async (origen: string) =>
    copiarRecetaPropiaDeOtraSucursal(pvId, origen, true, await versionVigenteDeReceta(pvId, centralId), await habilitadaDeRecetaPropia(pvId, centralId));

  beforeEach(async () => {
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    surId = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;
    kgId = (await sembrarCatalogoBase()).kg.id;

    const dueno = await crearUsuarioConMembresia({ email: "dueno@test.com", sucursalId: centralId, rolId: base.admin.id });
    await crearMembresia({ usuarioId: dueno.id, sucursalId: norteId, rolId: base.admin.id });
    duenoId = dueno.id;
    atacanteId = (await crearUsuarioConMembresia({ email: "atacante@test.com", sucursalId: centralId, rolId: base.admin.id })).id;
    const mixto = await crearUsuarioConMembresia({ email: "mixto@test.com", sucursalId: centralId, rolId: base.admin.id });
    await crearMembresia({ usuarioId: mixto.id, sucursalId: norteId, rolId: base.operador.id });
    mixtoId = mixto.id;

    const harina = await sembrarProductoDisponible({ codigo: "MP_H", nombre: "Harina", tipo: "MP", unidadStockId: kgId }, centralId);
    const pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, centralId);
    pvId = pizza.id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norteId, productoId: pvId, disponible: true } });

    // Norte arma su receta propia (la central de la Pizza + la propia como administrador de las dos) y su carta propia.
    await como(dueno.id, dueno.email);
    __setCookieDeTestParaSucursal(centralId);
    expect((await guardarRecetaACiegas(pvId, [linea(harina.id)])).ok).toBe(true);
    __setCookieDeTestParaSucursal(norteId);
    expect((await crearRecetaPropiaDesdeLaCentral(pvId, 0, false)).ok).toBe(true);
    __setCookieDeTestParaSucursal(undefined);
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
    await prisma.generoCarta.create({ data: { sucursalId: norteId, nombre: "Pizzas", orden: 1 } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: norteId, productoId: pvId, visibleEnCarta: true, seccionCartaId: seccion.id, descripcion: "Muzza" } });
  });

  describe("la carta propia", () => {
    it("un administrador de Central SIN membresía en Norte no copia la carta de Norte: sin acceso, sin filas nuevas y sin nombrar nada de Norte", async () => {
      await como(atacanteId, "atacante@test.com");
      const r = await copiarCartaDeSucursal(norteId, true);
      expect(r).toEqual({ ok: false, mensaje: SIN_ACCESO });
      expect(r.mensaje).not.toContain("Norte");
      expect(await cartaDe(centralId)).toEqual({ contenidos: 0, generos: 0, items: 0 });
      expect(await prisma.registroAuditoria.count({ where: { entidad: "CartaSucursal" } })).toBe(0);
    });

    it("con membresía en Norte pero un rol sin «Ver» de la carta allá (operador) tampoco copia", async () => {
      await como(mixtoId, "mixto@test.com");
      expect(await copiarCartaDeSucursal(norteId, true)).toEqual({ ok: false, mensaje: SIN_ACCESO });
      expect(await cartaDe(centralId)).toEqual({ contenidos: 0, generos: 0, items: 0 });
    });

    it("no hay oráculo: una sucursal con carta y una sin carta, ambas sin membresía, contestan lo mismo", async () => {
      await como(atacanteId, "atacante@test.com");
      const conCarta = await copiarCartaDeSucursal(norteId, true);
      const sinCarta = await copiarCartaDeSucursal(surId, true);
      expect(sinCarta).toEqual(conCarta);
    });

    it("una sucursal DESACTIVADA no es origen ni para quien tiene membresía allá", async () => {
      await prisma.sucursal.update({ where: { id: norteId }, data: { activo: false } });
      await como(duenoId, "dueno@test.com");
      const r = await copiarCartaDeSucursal(norteId, true);
      expect(r).toEqual({ ok: false, mensaje: "No se encontró esa sucursal." });
      expect(await cartaDe(centralId)).toEqual({ contenidos: 0, generos: 0, items: 0 });
    });

    it("CONTROL: con membresía y «Ver» en Norte, la copia entra", async () => {
      await como(duenoId, "dueno@test.com");
      const r = await copiarCartaDeSucursal(norteId, true);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await cartaDe(centralId)).toEqual({ contenidos: 1, generos: 1, items: 0 });
    });

    it("la lista de lo copiable solo muestra las sucursales donde el usuario tiene «Ver» de la carta", async () => {
      const datos = await cargarAdminCarta(centralId, prisma, AHORA_DE_LA_CORRIDA);
      expect(datos.sucursalesConCarta.map((s) => s.id)).toEqual([norteId]);
      expect(await origenesDeCopiaVisibles(atacanteId, datos.sucursalesConCarta, prisma)).toEqual([]);
      expect(await origenesDeCopiaVisibles(mixtoId, datos.sucursalesConCarta, prisma)).toEqual([]);
      expect((await origenesDeCopiaVisibles(duenoId, datos.sucursalesConCarta, prisma)).map((s) => s.id)).toEqual([norteId]);
    });
  });

  describe("la receta propia", () => {
    it("un administrador de Central SIN membresía en Norte no copia la receta propia de Norte: sin acceso, sin filas y sin nombrar nada de Norte", async () => {
      await como(atacanteId, "atacante@test.com");
      const r = await copiarReceta(norteId);
      expect(r).toEqual({ ok: false, mensaje: SIN_ACCESO });
      expect(r.mensaje).not.toContain("Norte");
      expect(await recetasPropiasDe(centralId)).toEqual({ filas: 0, versiones: 0 });
    });

    it("con membresía en Norte pero un rol sin «Ver» de la copia allá (operador) tampoco copia", async () => {
      await como(mixtoId, "mixto@test.com");
      expect(await copiarReceta(norteId)).toEqual({ ok: false, mensaje: SIN_ACCESO });
      expect(await recetasPropiasDe(centralId)).toEqual({ filas: 0, versiones: 0 });
    });

    it("no hay oráculo: una sucursal con receta propia y una sin ella, ambas sin membresía, contestan lo mismo", async () => {
      await como(atacanteId, "atacante@test.com");
      const conPropia = await copiarReceta(norteId);
      const sinPropia = await copiarReceta(surId);
      expect(sinPropia).toEqual(conPropia);
    });

    it("una sucursal DESACTIVADA no es origen ni para quien tiene membresía allá", async () => {
      await prisma.sucursal.update({ where: { id: norteId }, data: { activo: false } });
      await como(duenoId, "dueno@test.com");
      expect(await copiarReceta(norteId)).toEqual({ ok: false, mensaje: "No se encontró esa sucursal." });
      expect(await recetasPropiasDe(centralId)).toEqual({ filas: 0, versiones: 0 });
    });

    it("CONTROL: con membresía y «Ver» en Norte, la copia entra", async () => {
      await como(duenoId, "dueno@test.com");
      const r = await copiarReceta(norteId);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await recetasPropiasDe(centralId)).toEqual({ filas: 1, versiones: 1 });
    });

    it("la lista de lo copiable solo muestra las sucursales donde el usuario tiene «Ver» de la copia", async () => {
      expect((await listarSucursalesConRecetaPropia(pvId, centralId, duenoId, prisma)).map((s) => s.nombre)).toEqual(["Norte"]);
      expect(await listarSucursalesConRecetaPropia(pvId, centralId, atacanteId, prisma)).toEqual([]);
      expect(await listarSucursalesConRecetaPropia(pvId, centralId, mixtoId, prisma)).toEqual([]);
    });
  });

  it("el origen de otra EMPRESA sigue sin existir (la RLS lo separa antes que cualquier chequeo de sucursal)", async () => {
    await prismaAdmin.empresa.create({ data: { id: "otra", nombre: "Otra", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    const ajena = await prismaAdmin.sucursal.create({ data: { nombre: "Ajena", empresaId: "otra" } });
    await como(duenoId, "dueno@test.com");
    expect(await copiarCartaDeSucursal(ajena.id, true)).toEqual({ ok: false, mensaje: "No se encontró esa sucursal." });
    expect(await copiarReceta(ajena.id)).toEqual({ ok: false, mensaje: "No se encontró esa sucursal." });
  });
});

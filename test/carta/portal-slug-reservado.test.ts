import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { dbDeEmpresa } from "../../src/server/sesion/base";
import { resolverCartaPublica, resolverPortalCarta } from "../../src/server/lecturas/carta/publica";
import { agregarSucursalAlPortal, guardarSucursalPublica, quitarSucursalDelPortal, type DatosSucursalPublica } from "../../src/server/actions/carta/registro-publico";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * P16 (decisión del dueño, 2026-10-11): «Quitar del portal» APAGA la sucursal (`publicada = false`), no borra su fila. El slug queda RESERVADO (otra sucursal no lo puede tomar ni por el alta
 * ni por la edición) y, si se vuelve a publicar, la misma dirección —la del QR ya impreso— vuelve a funcionar. Con el slug apagado la carta pública da el MISMO `null` (404 neutro) que uno
 * inexistente y NO abre la base de la sucursal: es un borde sin sesión, no puede dar ningún dato de ella.
 * Rojo previo (con `deleteMany`): el slug se liberaba y lo tomaba otra sucursal; el QR impreso no se podía recuperar.
 */
const empresa = { id: EMPRESA_POR_DEFECTO_ID, slug: "principal", nombre: "Principal" };
const OTRA_EMPRESA_ID = "empresa_otra";
const otraEmpresa = { id: OTRA_EMPRESA_ID, slug: "otra", nombre: "Otra empresa" };
const datos = (p: Partial<DatosSucursalPublica> = {}): DatosSucursalPublica => ({ slug: "central", publicada: false, ...p });

/** Las dos bases de la carta pública como las arma `server/carta-publica/sin-sesion.ts`, con un espía en la de la sucursal. */
function basesDe(empresaId: string) {
  const deLaSucursal = vi.fn((sucursalId: string) => dbDeEmpresa(empresaId, { lectura: [sucursalId], escritura: [] }));
  return { bases: { deLaEmpresa: dbDeEmpresa(empresaId), deLaSucursal }, deLaSucursal };
}

/** Una segunda empresa (PROVISIONING: la por defecto sigue siendo la única ACTIVE y `app_empresa_actual()` resuelve) con una sucursal propia. */
async function crearSucursalDeOtraEmpresa(nombre: string): Promise<string> {
  await prismaAdmin.empresa.upsert({
    where: { id: OTRA_EMPRESA_ID },
    update: {},
    create: { id: OTRA_EMPRESA_ID, nombre: "Otra empresa", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" },
  });
  return (await prismaAdmin.sucursal.create({ data: { nombre, empresaId: OTRA_EMPRESA_ID } })).id;
}

describe("P16: sacar una sucursal del portal la apaga y reserva su slug", () => {
  let centralId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    await agregarSucursalAlPortal(centralId);
    expect(await guardarSucursalPublica(centralId, datos({ publicada: true }))).toMatchObject({ ok: true });
  });

  it("reserva: apagada «Central» (central), otra sucursal con el mismo nombre en otra grafía recibe central-2 y no puede editarse el slug a central", async () => {
    expect(await quitarSucursalDelPortal(centralId)).toMatchObject({ ok: true });
    const otra = (await prisma.sucursal.create({ data: { nombre: "CENTRAL" } })).id;
    expect(await agregarSucursalAlPortal(otra)).toEqual({ ok: true, mensaje: '"CENTRAL" agregada al portal con el slug central-2 (sin publicar todavía).' });
    expect(await guardarSucursalPublica(otra, datos({ slug: "central" }))).toEqual({ ok: false, mensaje: 'El slug central ya lo usa "Central".' });
    expect((await prisma.sucursalPublica.findMany({ select: { sucursalId: true, slug: true }, orderBy: { slug: "asc" } }))).toEqual([
      { sucursalId: centralId, slug: "central" },
      { sucursalId: otra, slug: "central-2" },
    ]);
  });

  it("volver a publicar: apagada da null (404); publicarla con el mismo slug devuelve la carta de siempre y sigue habiendo UNA sola fila", async () => {
    const antes = await resolverCartaPublica(empresa, "central", basesDe(empresa.id).bases, AHORA_DE_LA_CORRIDA);
    expect(antes?.carta.sucursal.id).toBe(centralId);

    expect(await quitarSucursalDelPortal(centralId)).toMatchObject({ ok: true });
    await expect(resolverCartaPublica(empresa, "central", basesDe(empresa.id).bases, AHORA_DE_LA_CORRIDA)).resolves.toBeNull();
    expect(await prisma.sucursalPublica.count({ where: { sucursalId: centralId } })).toBe(1);

    // «Agregar» ya no sirve para volver (la fila existe): se vuelve marcando «Publicada» y guardando, con el mismo slug.
    expect(await agregarSucursalAlPortal(centralId)).toEqual({ ok: false, mensaje: '"Central" ya está en el portal (slug central).' });
    expect(await guardarSucursalPublica(centralId, datos({ publicada: true }))).toMatchObject({ ok: true });
    const despues = await resolverCartaPublica(empresa, "central", basesDe(empresa.id).bases, AHORA_DE_LA_CORRIDA);
    expect(despues?.carta.sucursal.id).toBe(centralId);
    expect(await prisma.sucursalPublica.count({ where: { sucursalId: centralId } })).toBe(1);
  });

  it("borde sin sesión: con el slug apagado NO se abre la base de la sucursal, la respuesta es la de un slug inexistente y el portal no la lista", async () => {
    expect(await quitarSucursalDelPortal(centralId)).toMatchObject({ ok: true });
    const apagado = basesDe(empresa.id);
    const inexistente = basesDe(empresa.id);
    const respuestaApagado = await resolverCartaPublica(empresa, "central", apagado.bases, AHORA_DE_LA_CORRIDA);
    const respuestaInexistente = await resolverCartaPublica(empresa, "no-existe", inexistente.bases, AHORA_DE_LA_CORRIDA);
    expect(respuestaApagado).toBeNull();
    expect(respuestaApagado).toEqual(respuestaInexistente);
    expect(apagado.deLaSucursal).not.toHaveBeenCalled();
    expect((await resolverPortalCarta(empresa, dbDeEmpresa(empresa.id))).map((p) => p.slug)).toEqual([]);
  });

  it("aislamiento entre empresas: quitar la sucursal de OTRA empresa no encuentra nada ni la toca; apagar un slug no afecta al mismo slug de la otra empresa", async () => {
    const ajena = await crearSucursalDeOtraEmpresa("Ajena");
    await prismaAdmin.sucursalPublica.create({ data: { sucursalId: ajena, empresaId: OTRA_EMPRESA_ID, slug: "central", publicada: true } });

    expect(await quitarSucursalDelPortal(ajena)).toEqual({ ok: false, mensaje: "Esta sucursal no está en el portal." });
    expect(await prismaAdmin.sucursalPublica.findFirstOrThrow({ where: { sucursalId: ajena } })).toMatchObject({ slug: "central", publicada: true });

    expect(await quitarSucursalDelPortal(centralId)).toMatchObject({ ok: true });
    await expect(resolverCartaPublica(empresa, "central", basesDe(empresa.id).bases, AHORA_DE_LA_CORRIDA)).resolves.toBeNull();
    const deLaOtra = await resolverCartaPublica(otraEmpresa, "central", basesDe(otraEmpresa.id).bases, AHORA_DE_LA_CORRIDA);
    expect(deLaOtra?.carta.sucursal.id).toBe(ajena);
  });
});

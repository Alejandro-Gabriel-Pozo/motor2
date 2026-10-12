import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { lecturaEnSucursalesVisibles } from "../../src/server/acceso/alcance";
import { cargarAdminCarta, origenesDeCopiaVisibles } from "../../src/server/consultas/carta/admin";
import { obtenerContextoUsuario } from "../../src/server/sesion/contexto";

/**
 * ADR-028 (D1): la pantalla de la carta ofrece «copiar desde» las sucursales que tienen carta propia (`sucursalesConCarta` de `cargarAdminCarta`, que cuenta la carta de las OTRAS sucursales). Con la RLS
 * por sucursal esa cuenta, hecha con la base de la sucursal activa, da cero en todas las demás (sin error): la pantalla diría que ninguna otra sucursal tiene carta. La página (`carta/page.tsx`) le pasa a
 * quien puede copiar la base ensanchada con `lecturaEnSucursalesVisibles(ctx, "carta_ver")` (ver `test/auth/alcance-de-lectores.test.tsx`, que mide con qué alcance la llama). Acá se mide el RESULTADO con
 * datos reales: lo que cuenta es solo lo de las sucursales que el usuario ve, nunca el resto de la empresa.
 *
 * Escenario: Central (activa, sin carta), Norte y Sur (cada una con su carta propia) y Este (con carta propia, donde el usuario no tiene membresía). El `gerente` es administrador de Central, Norte y Sur;
 * el `mixto`, administrador de Central y operador de Norte (el operador no ve `carta_ver` allá); `solo`, administrador de Central únicamente. Tiene que pasar CON y SIN las políticas por sucursal.
 */
describe("origen de la copia de la carta: solo las sucursales con carta que el usuario ve", () => {
  let central: string;
  let norte: string;
  let sur: string;
  let este: string;
  let gerenteId: string;
  let mixtoId: string;
  let soloId: string;
  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
    const base = await sembrarBase();
    central = base.sucursal.id;
    norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    sur = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;
    este = (await prisma.sucursal.create({ data: { nombre: "Este" } })).id;

    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: central, rolId: base.admin.id });
    await crearMembresia({ usuarioId: gerente.id, sucursalId: norte, rolId: base.admin.id });
    await crearMembresia({ usuarioId: gerente.id, sucursalId: sur, rolId: base.admin.id });
    const mixto = await crearUsuarioConMembresia({ email: "mixto@test.com", sucursalId: central, rolId: base.admin.id });
    await crearMembresia({ usuarioId: mixto.id, sucursalId: norte, rolId: base.operador.id });
    const solo = await crearUsuarioConMembresia({ email: "solo@test.com", sucursalId: central, rolId: base.admin.id });
    gerenteId = gerente.id;
    mixtoId = mixto.id;
    soloId = solo.id;

    // Cada sucursal con carta propia tiene un género (basta para que cuente como «con carta»); Central no.
    for (const [sucursalId, nombre] of [[norte, "Pizzas"], [sur, "Postres"], [este, "Bebidas"]] as const) await prisma.generoCarta.create({ data: { sucursalId, nombre, orden: 1 } });
  });

  /** Lo que arma la página para quien puede copiar: la base ensanchada a las sucursales donde el usuario ve `carta_ver`, y la lista de orígenes que ofrece. */
  async function origenesQueOfreceLaPantalla(email: string, id: string) {
    await como(id, email);
    const ctx = (await obtenerContextoUsuario())!;
    const origenes = await lecturaEnSucursalesVisibles(ctx, "carta_ver");
    const datos = await cargarAdminCarta(ctx.sucursalId, origenes.db, AHORA_DE_LA_CORRIDA);
    expect(ctx.sucursalId).toBe(central);
    return { cartaVacia: datos.cartaVacia, ofrecidas: await origenesDeCopiaVisibles(ctx.usuarioId, datos.sucursalesConCarta, ctx.db) };
  }

  it("el escenario es real: Norte, Sur y Este tienen carta propia en la base (la ve el dueño de la base) y Central no", async () => {
    expect((await prisma.generoCarta.findMany({ select: { sucursalId: true } })).map((g) => g.sucursalId).sort()).toEqual([este, norte, sur].sort());
  });

  it("quien ve `carta_ver` en Norte y en Sur recibe las dos como origen; Este, donde no tiene membresía, no se ofrece ni se nombra", async () => {
    const r = await origenesQueOfreceLaPantalla("gerente@test.com", gerenteId);
    expect(r.cartaVacia).toBe(true);
    expect(r.ofrecidas.map((s) => s.nombre)).toEqual(["Norte", "Sur"]);
  });

  it("donde el rol no ve `carta_ver` (Norte como operador) esa sucursal no se ofrece (y Sur y Este, sin membresía, tampoco)", async () => {
    const r = await origenesQueOfreceLaPantalla("mixto@test.com", mixtoId);
    expect(r.ofrecidas).toEqual([]);
  });

  it("con una sola membresía no hay de dónde copiar", async () => {
    const r = await origenesQueOfreceLaPantalla("solo@test.com", soloId);
    expect(r.ofrecidas).toEqual([]);
  });

  it("la sucursal activa que elige la cookie no agranda lo que se ve: con Este de cookie (sin membresía) la activa sigue siendo Central", async () => {
    __setCookieDeTestParaSucursal(este);
    await como(gerenteId, "gerente@test.com");
    const ctx = (await obtenerContextoUsuario())!;
    expect(ctx.sucursalId).toBe(central);
    const origenes = await lecturaEnSucursalesVisibles(ctx, "carta_ver");
    const datos = await cargarAdminCarta(ctx.sucursalId, origenes.db, AHORA_DE_LA_CORRIDA);
    expect((await origenesDeCopiaVisibles(ctx.usuarioId, datos.sucursalesConCarta, ctx.db)).map((s) => s.nombre)).toEqual(["Norte", "Sur"]);
  });
});

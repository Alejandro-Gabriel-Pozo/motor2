import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { enviadorEnMemoriaDelCanal } from "../../src/core/correo/enviar";
import { agregarOActualizarUsuario, listarInvitacionesPendientes } from "../../src/server/actions/auth/usuarios";

/**
 * S-16 del plan de endurecimiento de seguridad (fila O.65 de `docs/pureza-integracion.md`; CAMBIA COMPORTAMIENTO, aprobado por el dueño): «Invitaciones pendientes» de Administración →
 * Usuarios listaba, de cada invitación que incluye la sucursal activa, TODOS sus accesos con el nombre de la sucursal y el rol, también los de sucursales donde quien mira no tiene
 * `gestion_usuarios` (la RLS separa empresas, no sucursales): un administrador de Central veía a qué sucursales y con qué rol invitó un administrador de Norte. Ahora cada fila trae solo
 * los accesos de las sucursales donde quien mira puede ver `gestion_usuarios`, y el resto se cuenta (`enOtrasSucursales`) sin nombres ni roles.
 *
 * Escenario: la empresa con Central (S1) y Norte (S2); `admin` es administrador de las dos y deja una invitación con un acceso en cada una (operador en Central, «gerencia-norte» en Norte);
 * `soloCentral` es administrador de Central solamente; `operadorNorte` es administrador de Central y operador en Norte (sin `gestion_usuarios` allá); `ambas` es administrador de las dos.
 */
const AUTH_URL = "https://app.ejemplo.test";
const correo = enviadorEnMemoriaDelCanal("avisos");

describe("S-16: las invitaciones pendientes solo muestran los accesos de las sucursales visibles", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  let central: string;
  let norte: string;
  let admin: { id: string; email: string };
  let soloCentral: { id: string; email: string };
  let operadorNorte: { id: string; email: string };
  let ambas: { id: string; email: string };
  const como = (u: { id: string; email: string }) => mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });

  beforeEach(async () => {
    vi.stubEnv("AUTH_URL", AUTH_URL);
    correo.vaciar();
    await limpiarBaseDeTest();
    base = await sembrarBase();
    central = base.sucursal.id;
    norte = (await prismaAdmin.sucursal.create({ data: { nombre: "Norte secreto", empresaId: base.sucursal.empresaId } })).id;
    const rolNorte = await prismaAdmin.rol.create({ data: { nombre: "gerencia-norte", empresaId: base.sucursal.empresaId } });

    admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: central, rolId: base.admin.id });
    await crearMembresia({ usuarioId: admin.id, sucursalId: norte, rolId: base.admin.id });
    soloCentral = await crearUsuarioConMembresia({ email: "solo-central@test.com", sucursalId: central, rolId: base.admin.id });
    operadorNorte = await crearUsuarioConMembresia({ email: "operador-norte@test.com", sucursalId: central, rolId: base.admin.id });
    await crearMembresia({ usuarioId: operadorNorte.id, sucursalId: norte, rolId: base.operador.id });
    ambas = await crearUsuarioConMembresia({ email: "ambas@test.com", sucursalId: central, rolId: base.admin.id });
    await crearMembresia({ usuarioId: ambas.id, sucursalId: norte, rolId: base.admin.id });

    // El administrador de las dos deja UNA invitación con un acceso en cada sucursal.
    await como(admin);
    expect((await agregarOActualizarUsuario({ email: "nueva@test.com", sucursalId: central, rolId: base.operador.id })).ok).toBe(true);
    expect((await agregarOActualizarUsuario({ email: "nueva@test.com", sucursalId: norte, rolId: rolNorte.id })).ok).toBe(true);
    expect(await prismaAdmin.invitacionSucursal.count()).toBe(2);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("ATAQUE: un administrador de Central SIN gestion_usuarios en Norte no ve el nombre de Norte ni el rol del acceso allá; solo cuenta que hay uno más", async () => {
    await como(soloCentral);
    const pendientes = await listarInvitacionesPendientes(central);

    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]).toMatchObject({ email: "nueva@test.com", accesos: [{ sucursal: "Central", rol: "operador" }], enOtrasSucursales: 1 });
    const texto = JSON.stringify(pendientes);
    expect(texto).not.toContain("Norte secreto");
    expect(texto).not.toContain("gerencia-norte");
  });

  it("ATAQUE: con membresía en Norte pero un rol SIN gestion_usuarios allá (operador) tampoco lo ve", async () => {
    await como(operadorNorte);
    const pendientes = await listarInvitacionesPendientes(central);

    expect(pendientes[0]).toMatchObject({ accesos: [{ sucursal: "Central", rol: "operador" }], enOtrasSucursales: 1 });
    expect(JSON.stringify(pendientes)).not.toContain("Norte secreto");
  });

  it("CONTROL: quien administra usuarios en las dos sucursales ve los dos accesos y ninguno oculto", async () => {
    await como(ambas);
    const pendientes = await listarInvitacionesPendientes(central);

    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].accesos).toEqual(
      expect.arrayContaining([
        { sucursal: "Central", rol: "operador" },
        { sucursal: "Norte secreto", rol: "gerencia-norte" },
      ]),
    );
    expect(pendientes[0].accesos).toHaveLength(2);
    expect(pendientes[0].enOtrasSucursales).toBe(0);
  });

  it("CONTROL: una invitación que solo da acceso a la sucursal activa se ve igual que siempre, sin accesos ocultos", async () => {
    await como(admin);
    expect((await agregarOActualizarUsuario({ email: "solo-central-nueva@test.com", sucursalId: central, rolId: base.operador.id })).ok).toBe(true);
    await como(soloCentral);
    const pendientes = await listarInvitacionesPendientes(central);

    const propia = pendientes.find((p) => p.email === "solo-central-nueva@test.com");
    expect(propia).toMatchObject({ accesos: [{ sucursal: "Central", rol: "operador" }], enOtrasSucursales: 0 });
  });

  it("desde Norte, quien solo administra Norte ve su acceso y no el de Central", async () => {
    const soloNorte = await crearUsuarioConMembresia({ email: "solo-norte@test.com", sucursalId: norte, rolId: base.admin.id });
    await como(soloNorte);
    const pendientes = await listarInvitacionesPendientes(norte);

    expect(pendientes[0]).toMatchObject({ accesos: [{ sucursal: "Norte secreto", rol: "gerencia-norte" }], enOtrasSucursales: 1 });
    expect(JSON.stringify(pendientes)).not.toContain("Central");
  });
});

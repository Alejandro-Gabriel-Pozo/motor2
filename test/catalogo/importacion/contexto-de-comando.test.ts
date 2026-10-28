import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../../setup/test-db";
import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "../../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../../setup/rol-de-pruebas";
import { crearMembresia } from "../../setup/membresia";
import { contextoDeActorParaComando } from "../../../src/server/sesion/contexto-de-comando";
import { sembrarEmpresaDelImportador } from "./base-de-importacion";

/**
 * E1.6: el contexto de actor SIN sesión del comando del importador (superficie de seguridad, diseño §8). Contra Postgres real como `motor2_app`: arma el contexto solo para un usuario activo de una
 * empresa activa con alguna sucursal activa, con el alcance en UNA sucursal (la primera), y falla cerrado en todo lo demás. No da permisos: los decide el gate del caso de uso.
 */
describe("contextoDeActorParaComando", () => {
  let semilla: Awaited<ReturnType<typeof sembrarEmpresaDelImportador>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    semilla = await sembrarEmpresaDelImportador();
  });

  it("arma el contexto de la dueña (por slug o por id, el correo sin distinguir mayúsculas): sus membresías activas y el alcance SOLO en la primera sucursal", async () => {
    for (const empresa of ["principal", "empresa_principal"]) {
      const ctx = await contextoDeActorParaComando({ empresa, email: "  DUENA@importador.test " });
      expect(ctx).toMatchObject({ usuarioId: semilla.duena.id, empresaId: "empresa_principal", empresaSlug: "principal", sucursalId: semilla.sucursales.Huinganco, esAdminEnSucursal: true });
      expect(ctx.membresias).toHaveLength(7);
      expect(ctx.alcance).toEqual({ lectura: [semilla.sucursales.Huinganco], escritura: [semilla.sucursales.Huinganco] });
      // La base del contexto está bajo su empresa y su alcance: ve las sucursales de su empresa, no las de otra.
      expect((await ctx.db.sucursal.findMany({ select: { id: true } })).map((s) => s.id)).toContain(semilla.sucursales.Varvarco);
    }
  });

  it("una membresía inactiva o de una sucursal dada de baja no cuenta", async () => {
    await prisma.usuarioSucursal.updateMany({ where: { usuarioId: semilla.duena.id, sucursalId: semilla.sucursales.Varvarco }, data: { activo: false } });
    await prisma.sucursal.update({ where: { id: semilla.oficinas }, data: { activo: false } });
    const ctx = await contextoDeActorParaComando({ empresa: "principal", email: "duena@importador.test" });
    expect(ctx.membresias.map((m) => m.sucursalId)).not.toContain(semilla.sucursales.Varvarco);
    expect(ctx.membresias.map((m) => m.sucursalId)).not.toContain(semilla.oficinas);
    expect(ctx.membresias).toHaveLength(5);
  });

  it("falla cerrado: correo desconocido, empresa desconocida o suspendida, usuario de OTRA empresa, sin sucursal activa", async () => {
    await expect(contextoDeActorParaComando({ empresa: "principal", email: "nadie@importador.test" })).rejects.toThrow(/No existe un usuario/);
    await expect(contextoDeActorParaComando({ empresa: "no-existe", email: "duena@importador.test" })).rejects.toThrow(/No existe la empresa/);

    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const rolT = await testigo.rol.create({ data: { nombre: "admin", clave: "admin" } });
    const sucT = await testigo.sucursal.create({ data: { nombre: "Huinganco" } });
    const ajeno = await prisma.user.create({ data: { email: "ajeno@importador.test" } });
    await crearMembresia({ usuarioId: ajeno.id, sucursalId: sucT.id, rolId: rolT.id });
    await expect(contextoDeActorParaComando({ empresa: "principal", email: "ajeno@importador.test" })).rejects.toThrow(/no pertenece/);

    await prisma.usuarioSucursal.updateMany({ where: { usuarioId: semilla.duena.id }, data: { activo: false } });
    await expect(contextoDeActorParaComando({ empresa: "principal", email: "duena@importador.test" })).rejects.toThrow(/ninguna sucursal activa/);

    await prismaAdmin.empresa.update({ where: { id: "empresa_principal" }, data: { estado: "SUSPENDED" } });
    await expect(contextoDeActorParaComando({ empresa: "principal", email: "duena@importador.test" })).rejects.toThrow(/no está activa/);
  });
});

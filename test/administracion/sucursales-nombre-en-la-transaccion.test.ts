import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { renombrarSucursalCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/renombrar-sucursal";
import { crearSucursalConAdminCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/crear-sucursal-con-admin";

/**
 * M22 (S-51 de `docs/pureza-integracion.md`; hallazgo de la auditoría de acciones): el nombre de una sucursal se chequeaba FUERA de la transacción (con `actor.db`): dos altas o dos renombres a la
 * vez con el mismo nombre pasaban los dos el chequeo y el segundo chocaba con el índice único (`Sucursal_empresaId_nombre_key`) como un 500, y el alta no distinguía mayúsculas (el renombre sí).
 * Ahora el chequeo y la escritura van en UNA transacción SERIALIZABLE: el reintento relee y responde «Ya existe una sucursal».
 */
describe("sucursales: el nombre se chequea dentro de la transacción (M22)", () => {
  let usuarioId: string;
  let email: string;

  const dbProhibida = new Proxy({}, { get: (_t, p) => { throw new Error(`lectura FUERA de la transacción: actor.db.${String(p)}`); } }) as never;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    usuarioId = admin.id;
    email = admin.email;
  });

  it("renombrar: sin tocar `actor.db` (todo con el tx), y un nombre ya tomado (sin distinguir mayúsculas) sigue rechazándose", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Sucursal Norte" } });
    const sur = await prisma.sucursal.create({ data: { nombre: "Sucursal Sur" } });
    const actor = { usuarioId, transaccion: baseDeTest.transaccion, db: dbProhibida };

    expect(await renombrarSucursalCasoDeUso(actor, { sucursalId: sur.id, nombre: "sucursal norte" })).toMatchObject({ ok: false, codigo: "NOMBRE_TOMADO" });
    const ok = await renombrarSucursalCasoDeUso(actor, { sucursalId: sur.id, nombre: "Sucursal Este" });
    expect(ok.ok, ok.ok ? "" : ok.mensaje).toBe(true);
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: sur.id } })).nombre).toBe("Sucursal Este");
    void norte;
  });

  it("carrera: dos renombres a la vez al MISMO nombre → uno gana, el otro responde NOMBRE_TOMADO (antes, un 500 del índice único)", async () => {
    const actor = { usuarioId, transaccion: baseDeTest.transaccion };
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      const a = await prisma.sucursal.create({ data: { nombre: `A${vuelta}` } });
      const b = await prisma.sucursal.create({ data: { nombre: `B${vuelta}` } });
      const [ra, rb] = await Promise.all([
        renombrarSucursalCasoDeUso(actor, { sucursalId: a.id, nombre: `Nueva${vuelta}` }),
        renombrarSucursalCasoDeUso(actor, { sucursalId: b.id, nombre: `NUEVA${vuelta}` }),
      ]);
      expect([ra.ok, rb.ok].filter(Boolean), `vuelta ${vuelta}`).toHaveLength(1);
      const perdedor = ra.ok ? rb : ra;
      expect(perdedor).toMatchObject({ ok: false, codigo: "NOMBRE_TOMADO" });
    }
  });

  it("alta: dos altas a la vez con el MISMO nombre → una crea la sucursal, la otra responde NOMBRE_TOMADO y no queda una sucursal repetida", async () => {
    const actor = { usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, transaccion: baseDeTest.transaccion, db: baseDeTest.db };
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      const nombre = `Nueva ${vuelta}`;
      const [r1, r2] = await Promise.all([crearSucursalConAdminCasoDeUso(actor, { nombre, email }), crearSucursalConAdminCasoDeUso(actor, { nombre, email })]);
      expect([r1.ok, r2.ok].filter(Boolean), `vuelta ${vuelta}: ${JSON.stringify([r1, r2])}`).toHaveLength(1);
      expect(await prisma.sucursal.count({ where: { nombre } })).toBe(1);
      expect([r1, r2].find((r) => !r.ok)).toMatchObject({ ok: false, codigo: "NOMBRE_TOMADO" });
    }
  });

  it("alta: un nombre que ya existe con otras mayúsculas también se rechaza (como el renombre) y dice el nombre existente", async () => {
    await prisma.sucursal.create({ data: { nombre: "Sucursal Norte" } });
    const r = await crearSucursalConAdminCasoDeUso({ usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, transaccion: baseDeTest.transaccion, db: baseDeTest.db }, { nombre: "sucursal norte", email });
    expect(r).toMatchObject({ ok: false, codigo: "NOMBRE_TOMADO", mensaje: 'Ya existe una sucursal "Sucursal Norte".' });
  });
});

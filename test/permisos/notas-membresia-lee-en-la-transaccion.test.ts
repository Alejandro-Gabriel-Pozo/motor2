import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin, sembrarBase } from "../setup/test-db";
import { actualizarNotasMembresiaCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/actualizar-notas-membresia";

/**
 * M18 (S-51 de `docs/pureza-integracion.md`; hallazgo de la auditoría de acciones): en las notas de una membresía, la membresía, quien se toca y quien actúa se leían con `actor.db`, FUERA de la
 * transacción de la escritura: si a quien actúa le bajaban el rol (o al objetivo lo subían a admin) entre la lectura y la escritura, el techo se medía contra un estado viejo. Ahora todo se lee
 * con el `tx` de una transacción SERIALIZABLE. Reproductor determinista: un `actor.db` que EXPLOTA ante cualquier uso. Que a quien actúa le bajen el rol DESPUÉS de armar el contexto ya lo
 * cubre `actor-releido-en-la-transaccion.test.ts`.
 */
describe("actualizarNotasMembresiaCasoDeUso: todo se lee dentro de la transacción (M18)", () => {
  let actor: { usuarioId: string; empresaId: string; sucursalId: string; sucursalNombre: string; transaccion: typeof baseDeTest.transaccion; db: never };
  let membresiaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const operador = await crearUsuarioConMembresia({ email: "op@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    membresiaId = (await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { usuarioId_sucursalId: { usuarioId: operador.id, sucursalId: base.sucursal.id } } })).id;
    const dbProhibida = new Proxy({}, { get: (_t, p) => { throw new Error(`lectura FUERA de la transacción: actor.db.${String(p)}`); } }) as never;
    actor = { usuarioId: admin.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: base.sucursal.id, sucursalNombre: base.sucursal.nombre, transaccion: baseDeTest.transaccion, db: dbProhibida };
  });

  it("deja las notas (y su auditoría) sin tocar `actor.db`: antes explotaba al leer la membresía afuera", async () => {
    const r = await actualizarNotasMembresiaCasoDeUso(actor, { membresiaId, notas: "  turno noche  " });
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    expect((await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { id: membresiaId } })).notas).toBe("turno noche");
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "UsuarioSucursal", entidadId: membresiaId, campo: "notas" } })).toBe(1);
  });

  it("una membresía que no existe sigue siendo MEMBRESIA_NO_ENCONTRADA", async () => {
    expect(await actualizarNotasMembresiaCasoDeUso(actor, { membresiaId: "no-existe", notas: "x" })).toMatchObject({ ok: false, codigo: "MEMBRESIA_NO_ENCONTRADA" });
  });
});

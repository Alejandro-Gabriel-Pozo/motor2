import { describe, expect, it } from "vitest";
import { guardComandoAgregarOActualizarUsuario } from "../../../../src/core/features/permisos/usuario.guard";

/**
 * Hito 3, I.5j: el formato del alta de Administración › Usuarios, que antes corría en línea al principio de `agregarOActualizarUsuario`. Lo mismo, con el mismo
 * texto: el email recortado y en minúsculas, obligatorio; la sucursal, el rol y las notas pasan tal cual (las notas, solo si vinieron).
 */
describe("guardComandoAgregarOActualizarUsuario", () => {
  const base = { email: "  Nueva@Test.COM ", sucursalId: "s1", rolId: "r1" };

  it("recorta y pasa a minúsculas el email; sucursal y rol pasan tal cual; sin notas no hay campo notas", () => {
    const r = guardComandoAgregarOActualizarUsuario(base);
    expect(r).toEqual({ ok: true, valor: { email: "nueva@test.com", sucursalId: "s1", rolId: "r1" } });
    expect(r.ok && "notas" in r.valor).toBe(false);
  });

  it("las notas pasan tal cual cuando vienen, aunque estén vacías (sin normalizar)", () => {
    expect(guardComandoAgregarOActualizarUsuario({ ...base, notas: "  turno noche " })).toMatchObject({ ok: true, valor: { notas: "  turno noche " } });
    expect(guardComandoAgregarOActualizarUsuario({ ...base, notas: "" })).toMatchObject({ ok: true, valor: { notas: "" } });
  });

  it.each(["", "   "])("un email vacío (%j) se rechaza con el mensaje de siempre", (email) => {
    expect(guardComandoAgregarOActualizarUsuario({ ...base, email })).toEqual({ ok: false, codigo: "vacio", mensaje: "El email es obligatorio." });
  });
});

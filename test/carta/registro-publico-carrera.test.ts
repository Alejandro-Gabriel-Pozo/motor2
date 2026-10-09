import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { agregarSucursalAlPortal, guardarSucursalPublica } from "../../src/server/actions/carta/registro-publico";

/**
 * La CARRERA del registro público (Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1), ANTES de mudarlo a casos de uso: el alta calcula el slug UNA vez por intento y,
 * si el índice único se lo gana otro pedido (error de unicidad), reintenta hasta 5 veces y recién entonces responde «Otra carga simultánea tomó el mismo slug»; la edición
 * responde «Otra sucursal tomó ese slug mientras guardabas»; un error que no es de unicidad no se disfraza: sigue lanzando. Ningún test pasaba por esos `catch`.
 * Se simula con un trigger de la base DE PRUEBA que tira un error de unicidad (23505) las primeras N veces que se lo invoca (la cuenta la lleva una secuencia, que NO
 * se deshace con la transacción): así se cuenta cuántos intentos hace de verdad. Los objetos de la trampa se borran siempre. Verde contra el código de antes de la mudanza y después.
 */
async function limpiarTrampas() {
  await prismaAdmin.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_d12_alta ON "SucursalPublica"');
  await prismaAdmin.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_d12_edicion ON "SucursalPublica"');
  await prismaAdmin.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_d12_fallar()");
  await prismaAdmin.$executeRawUnsafe("DROP SEQUENCE IF EXISTS test_d12_intentos");
}

describe("registro público: la carrera del índice único (reintentos del slug y choque al editar)", () => {
  let centralId: string;

  beforeEach(async () => {
    await limpiarTrampas();
    vi.mocked(revalidarCartasPublicas).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });
  afterEach(limpiarTrampas);

  /** Arma un trigger que, en cada `operacion` (INSERT o UPDATE) de `SucursalPublica`, tira el error `codigo` mientras la cuenta de invocaciones sea <= `hasta`. */
  async function armarTrampa(operacion: "INSERT" | "UPDATE", hasta: number, codigo: "23505" | "P0001") {
    await prismaAdmin.$executeRawUnsafe("CREATE SEQUENCE test_d12_intentos");
    await prismaAdmin.$executeRawUnsafe(`
      CREATE FUNCTION test_d12_fallar() RETURNS trigger AS $$
      BEGIN
        IF nextval('test_d12_intentos') <= ${hasta} THEN
          RAISE EXCEPTION 'trampa de la carrera' USING ERRCODE = '${codigo}';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    const nombre = operacion === "INSERT" ? "test_d12_alta" : "test_d12_edicion";
    await prismaAdmin.$executeRawUnsafe(`CREATE TRIGGER ${nombre} BEFORE ${operacion} ON "SucursalPublica" FOR EACH ROW EXECUTE FUNCTION test_d12_fallar()`);
  }
  const invocaciones = async () => Number((await prismaAdmin.$queryRawUnsafe<{ last_value: bigint }[]>("SELECT last_value FROM test_d12_intentos"))[0].last_value);

  it("agregar: si el primer intento choca, REINTENTA y el segundo entra (con el mismo slug, el ganador no quedó)", async () => {
    await armarTrampa("INSERT", 1, "23505");
    expect(await agregarSucursalAlPortal(centralId)).toEqual({ ok: true, mensaje: '"Central" agregada al portal con el slug central (sin publicar todavía).' });
    expect(await invocaciones()).toBe(2);
    expect(await prisma.sucursalPublica.count()).toBe(1);
    expect(vi.mocked(revalidarCartasPublicas)).toHaveBeenCalledTimes(1);
  });

  it("agregar: si choca las 5 veces, se rinde con «Otra carga simultánea…» después de EXACTAMENTE 5 intentos, sin escribir ni revalidar", async () => {
    await armarTrampa("INSERT", 99, "23505");
    expect(await agregarSucursalAlPortal(centralId)).toEqual({ ok: false, mensaje: "Otra carga simultánea tomó el mismo slug. Volvé a intentar." });
    expect(await invocaciones()).toBe(5);
    expect(await prisma.sucursalPublica.count()).toBe(0);
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();
  });

  it("agregar: un error que NO es de unicidad no se disfraza ni se reintenta: la acción lanza (un solo intento)", async () => {
    await armarTrampa("INSERT", 99, "P0001");
    await expect(agregarSucursalAlPortal(centralId)).rejects.toThrow();
    expect(await invocaciones()).toBe(1);
    expect(await prisma.sucursalPublica.count()).toBe(0);
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();
  });

  it("guardar: otro tomó el slug entre el chequeo y la escritura → «Otra sucursal tomó ese slug…», sin tocar la fila ni revalidar; un error que no es de unicidad lanza", async () => {
    expect((await agregarSucursalAlPortal(centralId)).ok).toBe(true);
    vi.mocked(revalidarCartasPublicas).mockClear();
    const antes = await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } });

    await armarTrampa("UPDATE", 1, "23505");
    expect(await guardarSucursalPublica(centralId, { slug: "otro", publicada: true })).toEqual({
      ok: false,
      mensaje: "Otra sucursal tomó ese slug mientras guardabas. Revisalo y volvé a intentar.",
    });
    expect(await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: centralId } })).toEqual(antes);
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();

    await limpiarTrampas();
    await armarTrampa("UPDATE", 99, "P0001");
    await expect(guardarSucursalPublica(centralId, { slug: "otro", publicada: true })).rejects.toThrow();
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();
  });
});

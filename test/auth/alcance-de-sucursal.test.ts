import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, prismaSinEmpresa, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { crearMembresia } from "../setup/membresia";
import { obtenerContextoUsuario, type ContextoUsuario } from "../../src/core/auth/contexto";
import { baseDeEmpresa, transaccionDeEmpresa } from "../../src/core/auth/base";
import { conAlcanceEnSucursal, conEscrituraEnLaEmpresa, incluirSucursalCreadaEnLaTransaccion, lecturaEnSucursalesVisibles } from "../../src/server/acceso/alcance";
import { requerirVerAlgunaEnSucursal, requerirVerEnSucursal } from "../../src/server/actions/con-sesion";
import { permisoYAlcanceEnSucursal } from "../../src/server/actions/con-permiso";

/**
 * M.3-A4: los ENSANCHES del alcance por sucursal (`src/server/acceso/alcance.ts`) y las escrituras de empresa entera que los usan. Postgres real, tres sucursales (A activa, B con membresía,
 * C sin membresía) y una segunda empresa con la suya. Todavía no hay políticas por sucursal (Fase B): lo que se mide es CON QUÉ ALCANCE corre cada base y que nada cambie de lo que ya hacían.
 * Mutaciones (revertidas editando): alcance con la membresía de C sin chequearla; `LECTURA` fijo por `LECTURA_Y_ESCRITURA`; `conEscrituraEnLaEmpresa` sin el filtro de empresa;
 * `incluirSucursalCreadaEnLaTransaccion` sin la comprobación de que existe; el alta de producto sin su ensanche.
 */
type Variables = { empresa: string | null; lectura: string | null; escritura: string | null };
const variables = async (cliente: Pick<typeof prisma, "$queryRaw">): Promise<Variables> =>
  (
    await cliente.$queryRaw<Variables[]>`
      SELECT current_setting('app.empresa_id', true) AS empresa, current_setting('app.sucursales_lectura', true) AS lectura, current_setting('app.sucursales_escritura', true) AS escritura`
  )[0]!;
const lista = (v: string | null) => (v ? v.split(",").sort() : []);

describe("ensanches del alcance por sucursal (M.3-A4/A6)", () => {
  let A: string;
  let B: string;
  let C: string;
  let ctx: ContextoUsuario;
  let rolAdminId: string;
  let rolOperadorId: string;
  let usuarioId: string;
  let ajenaEmpresa: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
    const base = await sembrarBase();
    A = base.sucursal.id;
    B = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    C = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;
    rolAdminId = base.admin.id;
    rolOperadorId = base.operador.id;
    const usuario = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: A, rolId: rolAdminId });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: B, rolId: rolAdminId, activo: true });
    usuarioId = usuario.id;
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });
    ctx = (await obtenerContextoUsuario())!;
    // Una sucursal de OTRA empresa: ningún ensanche la alcanza.
    await prismaAdmin.empresa.upsert({ where: { id: "empresa_testigo" }, update: {}, create: { id: "empresa_testigo", nombre: "Testigo", slug: "testigo", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    ajenaEmpresa = (await prismaAdmin.sucursal.create({ data: { empresaId: "empresa_testigo", nombre: "De otra empresa" } })).id;
  });

  describe("conAlcanceEnSucursal", () => {
    it("parte de lectura = escritura = [A]; LECTURA suma B solo a la lectura, y devuelve un contexto NUEVO (el original no cambia)", async () => {
      expect(ctx.alcance).toEqual({ lectura: [A], escritura: [A] });
      const ampliado = conAlcanceEnSucursal(ctx, B, "LECTURA");
      expect(ampliado.alcance).toEqual({ lectura: [A, B], escritura: [A] });
      expect(ctx.alcance).toEqual({ lectura: [A], escritura: [A] });
      expect(ampliado.db).not.toBe(ctx.db);
      expect(lista((await variables(ampliado.db)).lectura)).toEqual([A, B].sort());
      expect(lista((await variables(ampliado.db)).escritura)).toEqual([A]);
      expect(await ampliado.transaccion((tx) => variables(tx))).toMatchObject({ lectura: [A, B].join(","), escritura: A });
      // lo demás del contexto queda igual
      expect(ampliado.usuarioId).toBe(ctx.usuarioId);
      expect(ampliado.empresaId).toBe(ctx.empresaId);
      expect(ampliado.membresias).toBe(ctx.membresias);
    });

    it("LECTURA_Y_ESCRITURA suma B a las dos; repetir el ensanche (o pedir uno que ya está) devuelve el mismo contexto, sin repetir ids", async () => {
      const ampliado = conAlcanceEnSucursal(ctx, B, "LECTURA_Y_ESCRITURA");
      expect(ampliado.alcance).toEqual({ lectura: [A, B], escritura: [A, B] });
      expect(conAlcanceEnSucursal(ampliado, B, "LECTURA_Y_ESCRITURA")).toBe(ampliado);
      expect(conAlcanceEnSucursal(ampliado, B, "LECTURA")).toBe(ampliado);
      expect(conAlcanceEnSucursal(ctx, A, "LECTURA_Y_ESCRITURA")).toBe(ctx);
      const soloLectura = conAlcanceEnSucursal(ctx, B, "LECTURA");
      expect(conAlcanceEnSucursal(soloLectura, B, "LECTURA_Y_ESCRITURA").alcance).toEqual({ lectura: [A, B], escritura: [A, B] });
    });

    it("sin membresía vigente en la sucursal (C, una de otra empresa, una inexistente) FALLA: el ensanche nunca va más allá de lo que el usuario tiene", () => {
      for (const ajena of [C, ajenaEmpresa, "no-existe"]) {
        expect(() => conAlcanceEnSucursal(ctx, ajena, "LECTURA")).toThrow("No tenés acceso a esa sucursal.");
        expect(() => conAlcanceEnSucursal(ctx, ajena, "LECTURA_Y_ESCRITURA")).toThrow("No tenés acceso a esa sucursal.");
      }
    });

    it("un contexto SIN alcance (armado a mano) no se ensancha: se devuelve tal cual", () => {
      const sinAlcance = { ...ctx, ...baseDeEmpresa(ctx.empresaId), alcance: undefined };
      expect(sinAlcance.alcance).toBeUndefined();
      expect(conAlcanceEnSucursal(sinAlcance, B, "LECTURA_Y_ESCRITURA")).toBe(sinAlcance);
    });
  });

  describe("SUCURSAL_CON_GATE: requerirVerEnSucursal y requerirVerAlgunaEnSucursal ensanchan la LECTURA después del gate", () => {
    it("con el «Ver» en B: el contexto devuelto lee A y B y escribe solo en A", async () => {
      const lectura = await requerirVerEnSucursal(B, "gestion_usuarios");
      expect(lectura.alcance).toEqual({ lectura: [A, B], escritura: [A] });
      expect(lista((await variables(lectura.db)).lectura)).toEqual([A, B].sort());
      const variasClaves = await requerirVerAlgunaEnSucursal(B, ["gestion_usuarios", "secciones"]);
      expect(variasClaves.alcance).toEqual({ lectura: [A, B], escritura: [A] });
    });

    it("en la sucursal ACTIVA no cambia nada; sin membresía en C, o sin la clave en B, lanza y no hay contexto ampliado", async () => {
      expect((await requerirVerEnSucursal(A, "gestion_usuarios")).alcance).toEqual({ lectura: [A], escritura: [A] });
      await expect(requerirVerEnSucursal(C, "gestion_usuarios")).rejects.toThrow("No tenés acceso a esa sucursal.");
      // el mismo usuario con un rol sin la clave en B: el gate dice que no
      await prisma.usuarioSucursal.updateMany({ where: { usuarioId, sucursalId: B }, data: { rolId: rolOperadorId } });
      const sinClave = await obtenerContextoUsuario();
      expect(sinClave).not.toBeNull();
      await expect(requerirVerEnSucursal(B, "gestion_usuarios")).rejects.toThrow();
      await expect(requerirVerAlgunaEnSucursal(B, ["gestion_usuarios"])).rejects.toThrow();
    });
  });

  describe("lecturaEnSucursalesVisibles", () => {
    it("suma a la lectura las sucursales de las membresías donde se VE la clave; la escritura no cambia; no suma C (sin membresía)", async () => {
      const ampliado = await lecturaEnSucursalesVisibles(ctx, "gestion_usuarios");
      expect(ampliado.alcance).toEqual({ lectura: [A, B], escritura: [A] });
      expect(lista((await variables(ampliado.db)).lectura)).toEqual([A, B].sort());
      expect(ampliado.alcance?.lectura).not.toContain(C);
    });

    it("donde el rol no tiene la clave (B como operador) no la suma; si no suma nada devuelve el mismo contexto", async () => {
      await prisma.usuarioSucursal.updateMany({ where: { usuarioId, sucursalId: B }, data: { rolId: rolOperadorId } });
      const sinB = (await obtenerContextoUsuario())!;
      const sinSumar = await lecturaEnSucursalesVisibles(sinB, "gestion_usuarios");
      expect(sinSumar.alcance).toEqual({ lectura: [A], escritura: [A] });
      expect(sinSumar).toBe(sinB);
    });

    it("un contexto sin alcance no se ensancha", async () => {
      const sinAlcance = { ...ctx, ...baseDeEmpresa(ctx.empresaId), alcance: undefined };
      expect(await lecturaEnSucursalesVisibles(sinAlcance, "gestion_usuarios")).toBe(sinAlcance);
    });
  });

  describe("GATE_EN_ESA_SUCURSAL: permisoYAlcanceEnSucursal", () => {
    it("con la clave en B ensancha lectura Y escritura; sin ella (operador en B) o sin membresía (C) devuelve el rechazo del gate y no ensancha", async () => {
      const bien = await permisoYAlcanceEnSucursal(ctx, B, "gestion_usuarios");
      expect(bien.ok).toBe(true);
      if (bien.ok) expect(bien.ctx.alcance).toEqual({ lectura: [A, B], escritura: [A, B] });
      const sinMembresia = await permisoYAlcanceEnSucursal(ctx, C, "gestion_usuarios");
      expect(sinMembresia.ok).toBe(false);
      await prisma.usuarioSucursal.updateMany({ where: { usuarioId, sucursalId: B }, data: { rolId: rolOperadorId } });
      const sinClave = await permisoYAlcanceEnSucursal(ctx, B, "gestion_usuarios");
      expect(sinClave.ok).toBe(false);
      if (!sinClave.ok) expect(sinClave.mensaje).toBeTruthy();
      expect(ctx.alcance).toEqual({ lectura: [A], escritura: [A] });
    });
  });

  describe("conEscrituraEnLaEmpresa", () => {
    it("lectura y escritura en TODAS las sucursales de la empresa (la lista cerrada leída en el momento), nunca en las de otra empresa", async () => {
      const amplio = await conEscrituraEnLaEmpresa(ctx);
      expect([...amplio.sucursalIdsDeLaEmpresa].sort()).toEqual([A, B, C].sort());
      expect([...(amplio.alcance?.lectura ?? [])].sort()).toEqual([A, B, C].sort());
      expect([...(amplio.alcance?.escritura ?? [])].sort()).toEqual([A, B, C].sort());
      expect(amplio.alcance?.escritura).not.toContain(ajenaEmpresa);
      expect(lista((await variables(amplio.db)).escritura)).toEqual([A, B, C].sort());
      expect(await amplio.transaccion((tx) => variables(tx))).toMatchObject({ empresa: ctx.empresaId });
      expect(ctx.alcance).toEqual({ lectura: [A], escritura: [A] });
    });

    it("incluye también las sucursales inactivas de la empresa (la siembra de un producto nuevo las incluía antes), y un contexto sin alcance solo devuelve la lista", async () => {
      await prisma.sucursal.update({ where: { id: C }, data: { activo: false } });
      expect([...(await conEscrituraEnLaEmpresa(ctx)).sucursalIdsDeLaEmpresa].sort()).toEqual([A, B, C].sort());
      const sinAlcance = { ...ctx, ...baseDeEmpresa(ctx.empresaId), alcance: undefined };
      const r = await conEscrituraEnLaEmpresa(sinAlcance);
      expect(r.alcance).toBeUndefined();
      expect([...r.sucursalIdsDeLaEmpresa].sort()).toEqual([A, B, C].sort());
    });
  });

  describe("incluirSucursalCreadaEnLaTransaccion", () => {
    it("suma la sucursal creada en ESTA transacción a las dos listas, sin repetirla, y no sobrevive a la transacción", async () => {
      const dentro = await ctx.transaccion(async (tx) => {
        const nueva = await tx.sucursal.create({ data: { nombre: "Recién creada" } });
        await incluirSucursalCreadaEnLaTransaccion(tx, nueva.id);
        const primera = await variables(tx);
        await incluirSucursalCreadaEnLaTransaccion(tx, nueva.id);
        return { nueva: nueva.id, primera, segunda: await variables(tx) };
      });
      expect(lista(dentro.primera.lectura)).toEqual([A, dentro.nueva].sort());
      expect(lista(dentro.primera.escritura)).toEqual([A, dentro.nueva].sort());
      expect(dentro.segunda).toEqual(dentro.primera);
      const despues = await Promise.all(Array.from({ length: 12 }, () => variables(prismaSinEmpresa)));
      expect(despues.every((v) => !v.lectura && !v.escritura && !v.empresa)).toBe(true);
    });

    it("desde un alcance vacío o desde uno ensanchado, parte de lo que había; con un id inexistente, de otra empresa o mal formado, FALLA", async () => {
      const desdeVacio = await transaccionDeEmpresa(ctx.empresaId, async (tx) => {
        await incluirSucursalCreadaEnLaTransaccion(tx, B);
        return variables(tx);
      });
      expect(desdeVacio).toMatchObject({ lectura: B, escritura: B });
      const desdeVarias = await transaccionDeEmpresa(ctx.empresaId, async (tx) => {
        await incluirSucursalCreadaEnLaTransaccion(tx, C);
        return variables(tx);
      }, undefined, { lectura: [A, B], escritura: [A] });
      expect(lista(desdeVarias.lectura)).toEqual([A, B, C].sort());
      expect(lista(desdeVarias.escritura)).toEqual([A, C].sort());
      for (const malo of ["no-existe", ajenaEmpresa, "a,b", "", "*"]) {
        await expect(ctx.transaccion((tx) => incluirSucursalCreadaEnLaTransaccion(tx, malo)), malo).rejects.toThrow();
      }
    });
  });


});

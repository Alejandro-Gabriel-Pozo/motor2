import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { prismaAdmin } from "../setup/test-db";
import { HAY_ROL_DE_PLATAFORMA, plataformaReal } from "../setup/cliente-plataforma-real";
import { cambiarModulosDesdeLaConsola, leerModulosDeEmpresa } from "../../plataforma/src/servidor/modulos";

/**
 * Módulos de una empresa desde la consola (E7, ADR-023) contra Postgres real. El primer bloque usa la conexión del DUEÑO; el segundo, el rol REAL `motor2_plataforma`,
 * solo si hay `PLATAFORMA_DATABASE_URL` (en CI corre).
 */
const AUTOR = { adminId: "admin-modulos", adminEmail: "admin@plataforma.test" };
const SLUG = "empresa-modulos-consola";
let empresaId: string;
let otraId: string;

async function crearEmpresa(slug: string, estado: "ACTIVE" | "DELETING" = "ACTIVE"): Promise<string> {
  return (await prismaAdmin.empresa.create({ data: { nombre: `Empresa ${slug}`, slug, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado } })).id;
}

async function limpiar() {
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "ModuloEmpresa" WHERE "empresaId" IN (SELECT "id" FROM "Empresa" WHERE "slug" LIKE \'empresa-modulos-%\')');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "Empresa" WHERE "slug" LIKE \'empresa-modulos-%\'');
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "AdminPlataforma"');
}

beforeEach(async () => {
  await limpiar();
  empresaId = await crearEmpresa(SLUG);
  otraId = await crearEmpresa("empresa-modulos-otra");
});

afterAll(async () => {
  await limpiar();
  await plataformaReal.$disconnect();
});

const activosDe = async (id: string) => (await prismaAdmin.moduloEmpresa.findMany({ where: { empresaId: id, estado: "ACTIVO" }, select: { modulo: true } })).map((f) => f.modulo).sort();
const auditorias = () => prismaAdmin.auditoriaPlataforma.findMany({ orderBy: { creadoEn: "asc" } });

function pruebas(nombre: string, via: () => PrismaClient) {
  describe(nombre, () => {
    it("activar crea la fila y una auditoría de plataforma con el administrador, sin tocar la auditoría de la empresa", async () => {
      const antes = await prismaAdmin.registroAuditoria.count();
      const r = await cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, { activar: ["salon"] });
      expect(r).toMatchObject({ ok: true });
      expect(await activosDe(empresaId)).toEqual(["salon"]);
      const [a, ...resto] = await auditorias();
      expect(resto).toHaveLength(0);
      expect(a).toMatchObject({ accion: "modulo-activado", adminId: AUTOR.adminId, adminEmail: AUTOR.adminEmail, empresaAfectadaId: empresaId, detalle: { modulo: "salon", antes: "sin fila" } });
      expect(await prismaAdmin.registroAuditoria.count()).toBe(antes);
    });

    it("activar Salón no le crea fila a Stock: entra por la clausura", async () => {
      await cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, { activar: ["salon"] });
      expect(await prismaAdmin.moduloEmpresa.count({ where: { empresaId, modulo: "stock" } })).toBe(0);
      const vista = (await leerModulosDeEmpresa(via(), empresaId))!.vista.find((f) => f.id === "stock")!;
      expect(vista).toMatchObject({ efectivo: true, incluidoPor: ["salon"], puedeDesactivar: false });
    });

    it("desactivar deja la fila en INACTIVO y nunca la borra", async () => {
      await cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, { activar: ["carta"] });
      const r = await cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, { desactivar: ["carta"] });
      expect(r).toMatchObject({ ok: true });
      expect(await prismaAdmin.moduloEmpresa.findFirst({ where: { empresaId, modulo: "carta" } })).toMatchObject({ estado: "INACTIVO" });
      expect((await auditorias()).map((a) => a.accion)).toEqual(["modulo-activado", "modulo-desactivado"]);
    });

    it("lo que no cambia no se audita", async () => {
      await cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, { activar: ["carta"] });
      const r = await cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, { activar: ["carta"], desactivar: ["recetas"] });
      expect(r).toMatchObject({ ok: true, cambiados: [] });
      expect(await auditorias()).toHaveLength(1);
    });

    it("no se desactiva un módulo que otro activo requiere: ok:false con el mensaje y sin cambios", async () => {
      await cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, { activar: ["stock", "traspasos"] });
      const r = await cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, { desactivar: ["stock"] });
      expect(r).toEqual({ ok: false, mensaje: "Stock no se puede desactivar mientras estén activos: Traspasos." });
      expect(await activosDe(empresaId)).toEqual(["stock", "traspasos"]);
      expect(await auditorias()).toHaveLength(2);
    });

    it("es atómico: un cambio válido junto a uno inválido no aplica nada", async () => {
      const r = await cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, { activar: ["carta", "no-existe"] });
      expect(r.ok).toBe(false);
      expect(await activosDe(empresaId)).toEqual([]);
      expect(await auditorias()).toHaveLength(0);
    });

    it("una empresa inexistente o en baja no cambia de módulos", async () => {
      expect(await cambiarModulosDesdeLaConsola(via(), AUTOR, "no-existe", { activar: ["carta"] })).toEqual({ ok: false, mensaje: "La empresa no existe." });
      const baja = await crearEmpresa("empresa-modulos-baja", "DELETING");
      expect(await cambiarModulosDesdeLaConsola(via(), AUTOR, baja, { activar: ["carta"] })).toMatchObject({ ok: false });
      expect(await activosDe(baja)).toEqual([]);
    });

    it("un pedido mal formado o vacío se rechaza", async () => {
      expect(await cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, "basura")).toMatchObject({ ok: false });
      expect(await cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, {})).toMatchObject({ ok: false });
    });

    it("dos «activar Salón» a la vez dejan una sola fila y una sola auditoría", async () => {
      const resultados = await Promise.all([cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, { activar: ["salon"] }), cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, { activar: ["salon"] })]);
      expect(resultados.every((r) => r.ok)).toBe(true);
      expect(await prismaAdmin.moduloEmpresa.count({ where: { empresaId, modulo: "salon" } })).toBe(1);
      expect(await auditorias()).toHaveLength(1);
    });

    it("no toca los módulos de otra empresa", async () => {
      await cambiarModulosDesdeLaConsola(via(), AUTOR, empresaId, { activar: ["salon"] });
      expect(await activosDe(otraId)).toEqual([]);
    });
  });
}

pruebas("con la conexión del dueño", () => prismaAdmin);

describe.skipIf(!HAY_ROL_DE_PLATAFORMA)("con el rol motor2_plataforma real", () => {
  pruebas("cambios de módulos", () => plataformaReal);

  it("la plataforma no tiene DELETE sobre el registro de módulos", async () => {
    await cambiarModulosDesdeLaConsola(plataformaReal, AUTOR, empresaId, { activar: ["carta"] });
    await expect(plataformaReal.moduloEmpresa.deleteMany({ where: { empresaId } })).rejects.toThrow();
    expect(await activosDe(empresaId)).toEqual(["carta"]);
  });
});

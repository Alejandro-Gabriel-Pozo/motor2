import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PlanesError } from "../../src/core/features/empresa/planes";
import { asignarPlanAEmpresa, crearPlan, guardarBorradorDePlan, publicarVersionDePlan } from "../../src/server/operaciones-de-plataforma/planes";
import type { AutorDeCambioDePlataforma } from "../../src/server/operaciones-de-plataforma/auditar-cambio-de-plataforma";
import { HAY_ROL_DE_PLATAFORMA, plataformaReal } from "../setup/cliente-plataforma-real";
import { limpiarBaseDeTest, prismaAdmin, prismaSinEmpresa } from "../setup/test-db";

/**
 * Planes versionados (frente 4, M1) contra Postgres real. Los casos corren con el cliente del DUEÑO (como `cambiar-politica-empresa.test.ts`: escriben `AuditoriaPlataforma`); el bloque final usa el rol REAL
 * `motor2_plataforma` y el de la app, solo si hay `PLATAFORMA_DATABASE_URL`. Cubre: idempotencia (misma clave = lo ya hecho; misma clave con otro pedido = error), concurrencia (dos corridas a la vez: una gana, o se serializan),
 * atomicidad (todo o nada con su auditoría), inmutabilidad de lo publicado (trigger, ni el dueño) y aislamiento entre empresas.
 */
const AUTOR: AutorDeCambioDePlataforma = { adminId: "admin-planes", adminEmail: "admin@plataforma.test", instalacionId: "prueba", instalacionNombre: "prueba" };
const nuevaClave = () => randomUUID();

async function crearEmpresa(slug: string, estado: "ACTIVE" | "DELETING" = "ACTIVE"): Promise<string> {
  return (await prismaAdmin.empresa.create({ data: { nombre: `Empresa ${slug}`, slug, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado } })).id;
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
});

afterAll(async () => {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "PlanDeEmpresa", "VersionDePlan", "Plan"');
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await plataformaReal.$disconnect();
});

const auditorias = () => prismaAdmin.auditoriaPlataforma.findMany({ orderBy: { creadoEn: "asc" } });
const versiones = (codigo: string) => prismaAdmin.versionDePlan.findMany({ where: { plan: { codigo } }, orderBy: { creadoEn: "asc" } });

/** Un plan con su versión 1 publicada. */
async function planPublicado(codigo = "basico", modulos: string[] = ["stock", "compras"]) {
  await crearPlan(prismaAdmin, { clave: nuevaClave(), codigo, nombreComercial: "Básico", modulos }, AUTOR);
  await publicarVersionDePlan(prismaAdmin, { codigo, numeroEsperado: 1, motivo: "Primera versión" }, AUTOR);
}

describe("crear un plan", () => {
  it("crea el plan y su primer borrador, y deja una fila de auditoría de plataforma", async () => {
    const r = await crearPlan(prismaAdmin, { clave: nuevaClave(), codigo: "basico", nombreComercial: "Básico", modulos: ["compras", "stock"] }, AUTOR);
    expect(r.creado).toBe(true);
    const v = await versiones("basico");
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ estado: "BORRADOR", numero: null, nombreComercial: "Básico", modulos: ["compras", "stock"] });
    expect(await auditorias()).toMatchObject([{ accion: "plan-creado", adminEmail: AUTOR.adminEmail, empresaAfectadaId: null }]);
  });

  it("IDEMPOTENCIA: repetir con la misma clave y el mismo pedido no crea nada nuevo; con otro pedido, error", async () => {
    const clave = nuevaClave();
    const pedido = { clave, codigo: "basico", nombreComercial: "Básico", modulos: ["stock"] };
    const primera = await crearPlan(prismaAdmin, pedido, AUTOR);
    const segunda = await crearPlan(prismaAdmin, pedido, AUTOR);
    expect(segunda).toMatchObject({ planId: primera.planId, creado: false });
    expect(await prismaAdmin.plan.count()).toBe(1);
    expect(await prismaAdmin.versionDePlan.count()).toBe(1);
    expect(await auditorias()).toHaveLength(1);
    await expect(crearPlan(prismaAdmin, { ...pedido, nombreComercial: "Otro" }, AUTOR)).rejects.toMatchObject({ codigo: "CLAVE_REUTILIZADA" });
  });

  it("CONCURRENCIA: dos creaciones del mismo código a la vez con claves distintas: una gana, la otra recibe un error claro, queda UN plan", async () => {
    const pedido = (clave: string) => ({ clave, codigo: "basico", nombreComercial: "Básico", modulos: ["stock"] });
    const resultados = await Promise.allSettled([crearPlan(prismaAdmin, pedido(nuevaClave()), AUTOR), crearPlan(prismaAdmin, pedido(nuevaClave()), AUTOR)]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(PlanesError);
    expect(await prismaAdmin.plan.count()).toBe(1);
    expect(await auditorias()).toHaveLength(1);
  });

  it("CONCURRENCIA: dos reintentos a la vez con la MISMA clave devuelven el mismo plan (uno crea, el otro ve lo hecho)", async () => {
    const pedido = { clave: nuevaClave(), codigo: "basico", nombreComercial: "Básico", modulos: ["stock"] };
    const [a, b] = await Promise.all([crearPlan(prismaAdmin, pedido, AUTOR), crearPlan(prismaAdmin, pedido, AUTOR)]);
    expect(a.planId).toBe(b.planId);
    expect([a.creado, b.creado].filter(Boolean)).toHaveLength(1);
    expect(await prismaAdmin.plan.count()).toBe(1);
  });

  it("rechaza (y no escribe nada) un módulo que no es vendible disponible, un código inválido y un código repetido", async () => {
    await expect(crearPlan(prismaAdmin, { clave: nuevaClave(), codigo: "basico", nombreComercial: "B", modulos: ["gastos"] }, AUTOR)).rejects.toBeInstanceOf(PlanesError);
    await expect(crearPlan(prismaAdmin, { clave: nuevaClave(), codigo: "Basico", nombreComercial: "B", modulos: [] }, AUTOR)).rejects.toBeInstanceOf(PlanesError);
    expect(await prismaAdmin.plan.count()).toBe(0);
    await crearPlan(prismaAdmin, { clave: nuevaClave(), codigo: "basico", nombreComercial: "B", modulos: [] }, AUTOR);
    await expect(crearPlan(prismaAdmin, { clave: nuevaClave(), codigo: "basico", nombreComercial: "B", modulos: [] }, AUTOR)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  });
});

describe("guardar el borrador y publicar una versión", () => {
  it("guarda el borrador (mismo registro), y repetir la misma clave no escribe ni audita de nuevo", async () => {
    await crearPlan(prismaAdmin, { clave: nuevaClave(), codigo: "basico", nombreComercial: "Básico", modulos: ["stock"] }, AUTOR);
    const clave = nuevaClave();
    const pedido = { clave, codigo: "basico", nombreComercial: "Básico plus", modulos: ["stock", "carta"] };
    const a = await guardarBorradorDePlan(prismaAdmin, pedido, AUTOR);
    const b = await guardarBorradorDePlan(prismaAdmin, pedido, AUTOR);
    expect(a.cambiado).toBe(true);
    expect(b).toMatchObject({ versionDePlanId: a.versionDePlanId, cambiado: false });
    expect((await versiones("basico"))[0]).toMatchObject({ nombreComercial: "Básico plus", modulos: ["carta", "stock"] });
    expect((await auditorias()).filter((f) => f.accion === "plan-borrador-guardado")).toHaveLength(1);
    await expect(guardarBorradorDePlan(prismaAdmin, { ...pedido, nombreComercial: "Otro" }, AUTOR)).rejects.toMatchObject({ codigo: "CLAVE_REUTILIZADA" });
  });

  it("publicar congela la versión con el número 1 y quien la publicó; un borrador nuevo después arranca la versión 2", async () => {
    await planPublicado();
    const [v1] = await versiones("basico");
    expect(v1).toMatchObject({ estado: "PUBLICADA", numero: 1, publicadaPor: AUTOR.adminEmail, motivo: "Primera versión" });
    await guardarBorradorDePlan(prismaAdmin, { clave: nuevaClave(), codigo: "basico", nombreComercial: "Básico", modulos: ["stock", "compras", "carta"] }, AUTOR);
    const r = await publicarVersionDePlan(prismaAdmin, { codigo: "basico", numeroEsperado: 2, motivo: "Suma carta" }, AUTOR);
    expect(r.numero).toBe(2);
    expect((await versiones("basico")).map((v) => [v.numero, v.modulos.join(",")])).toEqual([[1, "compras,stock"], [2, "carta,compras,stock"]]);
  });

  it("IDEMPOTENCIA / VERSIÓN DESACTUALIZADA: publicar de nuevo el mismo número no duplica ni pisa; sin borrador tampoco se publica", async () => {
    await planPublicado();
    await expect(publicarVersionDePlan(prismaAdmin, { codigo: "basico", numeroEsperado: 1, motivo: "otra vez" }, AUTOR)).rejects.toMatchObject({ codigo: "VERSION_DESACTUALIZADA" });
    await expect(publicarVersionDePlan(prismaAdmin, { codigo: "basico", numeroEsperado: 2, motivo: "sin borrador" }, AUTOR)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    expect(await versiones("basico")).toHaveLength(1);
  });

  it("CONCURRENCIA: dos publicaciones a la vez del mismo número: una gana y la otra recibe VERSION_DESACTUALIZADA; queda UNA versión publicada", async () => {
    await crearPlan(prismaAdmin, { clave: nuevaClave(), codigo: "basico", nombreComercial: "Básico", modulos: ["stock"] }, AUTOR);
    const publicar = () => publicarVersionDePlan(prismaAdmin, { codigo: "basico", numeroEsperado: 1, motivo: "Primera" }, AUTOR);
    const resultados = await Promise.allSettled([publicar(), publicar()]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((resultados.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ codigo: "VERSION_DESACTUALIZADA" });
    expect((await versiones("basico")).filter((v) => v.estado === "PUBLICADA")).toHaveLength(1);
    expect((await auditorias()).filter((f) => f.accion === "plan-version-publicada")).toHaveLength(1);
  });

  it("INMUTABLE: una versión publicada no se edita ni se borra, ni siquiera con el rol dueño; un plan no se borra ni cambia de código", async () => {
    await planPublicado();
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "VersionDePlan" SET "nombreComercial" = 'x' WHERE "estado" = 'PUBLICADA'`)).rejects.toThrow(/inmutable/);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "VersionDePlan"`)).rejects.toThrow(/no se borra/);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "Plan"`)).rejects.toThrow(/no se borra/);
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "Plan" SET "codigo" = 'otro'`)).rejects.toThrow(/no cambia/);
  });

  it("la base impone sola: un borrador por plan, versión que nace en BORRADOR y número publicado = el siguiente", async () => {
    await crearPlan(prismaAdmin, { clave: nuevaClave(), codigo: "basico", nombreComercial: "Básico", modulos: [] }, AUTOR);
    const plan = await prismaAdmin.plan.findUniqueOrThrow({ where: { codigo: "basico" } });
    const insertar = (estado: string, extra = "") =>
      prismaAdmin.$executeRawUnsafe(`INSERT INTO "VersionDePlan" ("id","planId","estado","nombreComercial","modulos","claveIdempotencia","payloadHash"${extra ? ',"numero","publicadaEn","publicadaPor"' : ""}) VALUES ('${randomUUID()}','${plan.id}','${estado}','x','{}','${randomUUID()}','h'${extra})`);
    await expect(insertar("BORRADOR")).rejects.toThrow(); // ya hay un borrador
    await expect(insertar("PUBLICADA", ", 1, now(), 'x'")).rejects.toThrow(/nace en BORRADOR/);
  });
});

describe("asignar un plan a una empresa", () => {
  it("asigna, audita a nombre del administrador con la empresa afectada y avisa qué módulos activos quedarían fuera del techo", async () => {
    await planPublicado("basico", ["stock"]);
    const empresaId = await crearEmpresa("emp-planes-a");
    await prismaAdmin.moduloEmpresa.createMany({ data: [{ empresaId, modulo: "stock" }, { empresaId, modulo: "salon" }] });
    const r = await asignarPlanAEmpresa(prismaAdmin, { clave: nuevaClave(), slug: "emp-planes-a", codigoDePlan: "basico", numeroDeVersion: 1, motivo: "Contrato" }, AUTOR);
    expect(r).toMatchObject({ empresaId, numero: 1, asignado: true, fueraDelTecho: { salon: "SOLO_LECTURA" } });
    const fila = await prismaAdmin.planDeEmpresa.findFirstOrThrow({ where: { empresaId } });
    expect(fila).toMatchObject({ origen: "CAMBIO", asignadoPor: AUTOR.adminEmail, motivo: "Contrato" });
    expect((await auditorias()).filter((f) => f.accion === "plan-asignado")).toMatchObject([{ empresaAfectadaId: empresaId, adminId: AUTOR.adminId }]);
    // M1 NO toca lo que la empresa tiene: el registro de módulos sigue igual.
    expect((await prismaAdmin.moduloEmpresa.findMany({ where: { empresaId, estado: "ACTIVO" } })).map((f) => f.modulo).sort()).toEqual(["salon", "stock"]);
  });

  it("IDEMPOTENCIA: la misma clave devuelve lo ya hecho; la misma versión ya vigente no escribe; la misma clave con otro pedido o empresa es error", async () => {
    await planPublicado();
    await crearEmpresa("emp-planes-a");
    await crearEmpresa("emp-planes-b");
    const clave = nuevaClave();
    const pedido = { clave, slug: "emp-planes-a", codigoDePlan: "basico", numeroDeVersion: 1, motivo: "Contrato" };
    const a = await asignarPlanAEmpresa(prismaAdmin, pedido, AUTOR);
    const b = await asignarPlanAEmpresa(prismaAdmin, pedido, AUTOR);
    expect(b).toMatchObject({ planDeEmpresaId: a.planDeEmpresaId, asignado: false });
    const c = await asignarPlanAEmpresa(prismaAdmin, { ...pedido, clave: nuevaClave() }, AUTOR); // otra clave, misma versión ya vigente
    expect(c).toMatchObject({ planDeEmpresaId: a.planDeEmpresaId, asignado: false });
    expect(await prismaAdmin.planDeEmpresa.count()).toBe(1);
    expect((await auditorias()).filter((f) => f.accion === "plan-asignado")).toHaveLength(1);
    await expect(asignarPlanAEmpresa(prismaAdmin, { ...pedido, motivo: "Otro" }, AUTOR)).rejects.toMatchObject({ codigo: "CLAVE_REUTILIZADA" });
    await expect(asignarPlanAEmpresa(prismaAdmin, { ...pedido, slug: "emp-planes-b" }, AUTOR)).rejects.toMatchObject({ codigo: "CLAVE_REUTILIZADA" });
  });

  it("CONCURRENCIA: dos asignaciones DISTINTAS a la misma empresa a la vez se serializan: números 1 y 2, sin huecos ni duplicados; el vigente es el 2", async () => {
    await planPublicado();
    await guardarBorradorDePlan(prismaAdmin, { clave: nuevaClave(), codigo: "basico", nombreComercial: "Básico", modulos: ["stock"] }, AUTOR);
    await publicarVersionDePlan(prismaAdmin, { codigo: "basico", numeroEsperado: 2, motivo: "v2" }, AUTOR);
    await crearEmpresa("emp-planes-a");
    const asignar = (numeroDeVersion: number) => asignarPlanAEmpresa(prismaAdmin, { clave: nuevaClave(), slug: "emp-planes-a", codigoDePlan: "basico", numeroDeVersion, motivo: `v${numeroDeVersion}` }, AUTOR);
    const resultados = await Promise.all([asignar(1), asignar(2)]);
    expect(resultados.every((r) => r.asignado)).toBe(true);
    expect((await prismaAdmin.planDeEmpresa.findMany({ orderBy: { numero: "asc" } })).map((f) => f.numero)).toEqual([1, 2]);
  });

  it("rechaza (sin escribir) una versión sin publicar o inexistente, un plan retirado, una empresa inexistente o en baja", async () => {
    await planPublicado();
    await crearPlan(prismaAdmin, { clave: nuevaClave(), codigo: "solo-borrador", nombreComercial: "B", modulos: [] }, AUTOR);
    await crearEmpresa("emp-planes-a");
    await crearEmpresa("emp-planes-baja", "DELETING");
    const base = { clave: nuevaClave(), slug: "emp-planes-a", codigoDePlan: "basico", numeroDeVersion: 1, motivo: "x" };
    await expect(asignarPlanAEmpresa(prismaAdmin, { ...base, codigoDePlan: "solo-borrador" }, AUTOR)).rejects.toMatchObject({ codigo: "NO_EXISTE" });
    await expect(asignarPlanAEmpresa(prismaAdmin, { ...base, clave: nuevaClave(), numeroDeVersion: 9 }, AUTOR)).rejects.toMatchObject({ codigo: "NO_EXISTE" });
    await expect(asignarPlanAEmpresa(prismaAdmin, { ...base, clave: nuevaClave(), slug: "no-existe" }, AUTOR)).rejects.toMatchObject({ codigo: "NO_EXISTE" });
    await expect(asignarPlanAEmpresa(prismaAdmin, { ...base, clave: nuevaClave(), slug: "emp-planes-baja" }, AUTOR)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    await prismaAdmin.$executeRawUnsafe(`UPDATE "Plan" SET "estado" = 'RETIRADO' WHERE "codigo" = 'basico'`);
    await expect(asignarPlanAEmpresa(prismaAdmin, { ...base, clave: nuevaClave() }, AUTOR)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    expect(await prismaAdmin.planDeEmpresa.count()).toBe(0);
  });

  it("la asignación solo se agrega: ningún UPDATE ni DELETE (ni del dueño), número = el siguiente y solo versiones PUBLICADAS", async () => {
    await planPublicado();
    const empresaId = await crearEmpresa("emp-planes-a");
    await asignarPlanAEmpresa(prismaAdmin, { clave: nuevaClave(), slug: "emp-planes-a", codigoDePlan: "basico", numeroDeVersion: 1, motivo: "x" }, AUTOR);
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "PlanDeEmpresa" SET "motivo" = 'otro'`)).rejects.toThrow(/solo se agrega/);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "PlanDeEmpresa"`)).rejects.toThrow(/solo se agrega/);
    const version = await prismaAdmin.versionDePlan.findFirstOrThrow({ where: { estado: "PUBLICADA" } });
    const insertar = (numero: number, versionId: string) =>
      prismaAdmin.$executeRawUnsafe(`INSERT INTO "PlanDeEmpresa" ("id","empresaId","versionDePlanId","numero","aplicaDesde","origen","motivo","asignadoPor","claveIdempotencia","payloadHash") VALUES ('${randomUUID()}','${empresaId}','${versionId}',${numero},now(),'CAMBIO','m','a','${randomUUID()}','h')`);
    await expect(insertar(5, version.id)).rejects.toThrow(/siguiente de la empresa/);
    await crearPlan(prismaAdmin, { clave: nuevaClave(), codigo: "otro", nombreComercial: "O", modulos: [] }, AUTOR);
    const borrador = await prismaAdmin.versionDePlan.findFirstOrThrow({ where: { estado: "BORRADOR" } });
    await expect(insertar(2, borrador.id)).rejects.toThrow(/PUBLICADA/);
  });

  it("AISLAMIENTO: una empresa no ve la asignación de otra (la app lee solo la de su empresa)", async () => {
    await planPublicado();
    const a = await crearEmpresa("emp-planes-a");
    const b = await crearEmpresa("emp-planes-b");
    await asignarPlanAEmpresa(prismaAdmin, { clave: nuevaClave(), slug: "emp-planes-a", codigoDePlan: "basico", numeroDeVersion: 1, motivo: "x" }, AUTOR);
    const comoApp = async (empresaId: string) =>
      prismaSinEmpresa.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
        return tx.planDeEmpresa.count();
      });
    expect(await comoApp(a)).toBe(1);
    expect(await comoApp(b)).toBe(0);
  });
});

describe.skipIf(!HAY_ROL_DE_PLATAFORMA)("con los roles reales (motor2_plataforma y motor2_app)", () => {
  it("la plataforma escribe planes y asignaciones; la app NO puede escribirlos ni leer Plan ni VersionDePlan", async () => {
    await crearEmpresa("emp-planes-a");
    await crearPlan(plataformaReal, { clave: nuevaClave(), codigo: "basico", nombreComercial: "Básico", modulos: ["stock"] }, AUTOR);
    await publicarVersionDePlan(plataformaReal, { codigo: "basico", numeroEsperado: 1, motivo: "v1" }, AUTOR);
    const r = await asignarPlanAEmpresa(plataformaReal, { clave: nuevaClave(), slug: "emp-planes-a", codigoDePlan: "basico", numeroDeVersion: 1, motivo: "x" }, AUTOR);
    expect(r.asignado).toBe(true);
    await expect(prismaSinEmpresa.$executeRawUnsafe(`INSERT INTO "Plan" ("id","codigo","claveIdempotencia","payloadHash") VALUES ('${randomUUID()}','intruso','${randomUUID()}','h')`)).rejects.toThrow(/permission denied|permiso denegado|insufficient/i);
    await expect(prismaSinEmpresa.$queryRawUnsafe(`SELECT count(*) FROM "Plan"`)).rejects.toThrow(/permission denied|permiso denegado/i);
    await expect(prismaSinEmpresa.$queryRawUnsafe(`SELECT count(*) FROM "VersionDePlan"`)).rejects.toThrow(/permission denied|permiso denegado/i);
    await expect(prismaSinEmpresa.$executeRawUnsafe(`DELETE FROM "PlanDeEmpresa"`)).rejects.toThrow(/permission denied|permiso denegado|insufficient/i);
  });
});

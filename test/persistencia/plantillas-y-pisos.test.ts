import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { PlantillasError, semillaDePlantillas } from "../../src/core/permisos/plantillas-y-pisos";
import { fijarPisoDePlataforma, publicarVersionDePlantilla, sincronizarAccionesNuevas } from "../../src/server/operaciones-de-plataforma/plantillas-y-pisos";
import type { AutorDeCambioDePlataforma } from "../../src/server/operaciones-de-plataforma/auditar-cambio-de-plataforma";
import { HAY_ROL_DE_PLATAFORMA, plataformaReal } from "../setup/cliente-plataforma-real";
import { prismaAdmin, prismaSinEmpresa } from "../setup/test-db";
import { restaurarSemillaDePlantillasYPisos, sembrarSoloEstasAcciones } from "../setup/semilla-de-plantillas-sql";
import { tablaDelOraculoDePlantillas } from "../setup/oraculo-plantillas-y-pisos";

/**
 * Plantillas y pisos (roles propios, EB-1) contra Postgres real. Los casos corren con el cliente del DUEÑO (como `planes-versionados.test.ts`: escriben `AuditoriaPlataforma`); el bloque final usa los roles REALES `motor2_plataforma`
 * y `motor2_app`, solo si hay `PLATAFORMA_DATABASE_URL`. Cubre: concurrencia (dos corridas a la vez: una gana, o se serializan), idempotencia, inmutabilidad (triggers, ni el dueño), las reglas de la base y la parte P × F del oráculo contra el trigger.
 * Cada test arranca de la semilla de la migración (`restaurarSemillaDePlantillasYPisos`).
 *
 * MUTACIONES (a mano, una por una, ya REVERTIDAS; cada una puso rojo lo que dice):
 *  (1) `PISO_INICIAL_POR_NIVEL.administrador_sistema = null` → rojo la paridad de `test/core/plantillas-y-pisos.test.ts` (y la migración ya no semilla las 12 del gobierno).
 *  (2) sacar el CHECK `accionesEditar <@ accionesVer` → rojo «rechaza Editar fuera de Ver» de este archivo.
 *  (3) sacar el trigger `VersionDePlantilla_solo_se_agrega` → rojo «la versión publicada es inmutable» de este archivo.
 *  (4) calcular mal el número siguiente (`max + 2`) en `alta_de_version_de_plantilla` → rojo «el número de una versión tiene que ser el siguiente» y la migración (semilla).
 *  (6) sacar la regla de «sin pisos legibles» → rojo «con los pisos vaciados se rechaza cualquier versión».
 *  (7) sacar el candado advisory y la traducción de P2002 → rojo los dos tests de CONCURRENCIA de publicar (una de las dos corridas termina con un error crudo o las dos publican).
 *  (8) no comparar `payloadHash` → rojo «misma clave con otro pedido: CLAVE_REUTILIZADA».
 *  (9) sacar la regla transitoria de nivel (3) de `incumplimientosDeLaPlantilla` → rojo «el operador no recibe acciones de administrador» de este archivo y el oráculo de combinaciones.
 */
const AUTOR: AutorDeCambioDePlataforma = { adminId: "admin-plantillas", adminEmail: "admin@plataforma.test", instalacionId: "prueba", instalacionNombre: "prueba" };
const nuevaClave = () => randomUUID();

const semilla = semillaDePlantillas();
/** Acciones de nivel operario que OPERADOR no tiene en la versión 1 (se le pueden dar sin romper ninguna regla). */
const OPERARIO_FUERA_DEL_OPERADOR = ACCIONES.filter((a) => a.nivelMinimo === "operario" && !semilla.listas.OPERADOR.ver.includes(a.clave)).map((a) => a.clave).sort();

beforeEach(async () => {
  await restaurarSemillaDePlantillasYPisos(prismaAdmin);
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
});

afterAll(async () => {
  await restaurarSemillaDePlantillasYPisos(prismaAdmin);
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await plataformaReal.$disconnect();
});

const auditorias = () => prismaAdmin.auditoriaPlataforma.findMany({ orderBy: { creadoEn: "asc" } });
const versiones = (plantilla: string) => prismaAdmin.versionDePlantilla.findMany({ where: { plantillaClave: plantilla }, orderBy: { numero: "asc" } });
const publicarOperador = (extra: Partial<Parameters<typeof publicarVersionDePlantilla>[1]> = {}) =>
  publicarVersionDePlantilla(prismaAdmin, { clave: nuevaClave(), plantilla: "OPERADOR", numeroEsperado: 2, darVer: [OPERARIO_FUERA_DEL_OPERADOR[0]!], motivo: "Suma una acción", ...extra }, AUTOR);

describe("publicar una versión de plantilla", () => {
  it("publica la versión 2 con las listas nuevas (Ver y Editar), el autor y una fila de auditoría de plataforma", async () => {
    const [a, b] = OPERARIO_FUERA_DEL_OPERADOR;
    const r = await publicarOperador({ darVer: [a!], darEditar: [b!] });
    expect(r).toMatchObject({ numero: 2, publicada: true });
    const [v1, v2] = await versiones("OPERADOR");
    expect(v1!.numero).toBe(1);
    expect(v2).toMatchObject({ id: r.versionId, numero: 2, autor: AUTOR.adminEmail });
    expect(v2!.accionesVer).toEqual([...semilla.listas.OPERADOR.ver, a!, b!].sort());
    expect(v2!.accionesEditar).toEqual([...semilla.listas.OPERADOR.editar, b!].sort());
    const filas = await auditorias();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ accion: "plantilla-version-publicada", adminEmail: AUTOR.adminEmail, empresaAfectadaId: null });
    expect(filas[0]!.detalle).toMatchObject({ plantilla: "OPERADOR", numero: 2, agregadas: [a!, b!].sort().join(",") });
  });

  it("IDEMPOTENCIA: repetir con la misma clave y el mismo pedido devuelve lo hecho sin fila ni auditoría nuevas; con otro pedido, CLAVE_REUTILIZADA", async () => {
    const pedido = { clave: nuevaClave(), plantilla: "OPERADOR", numeroEsperado: 2, darVer: [OPERARIO_FUERA_DEL_OPERADOR[0]!], motivo: "Una vez" };
    const primera = await publicarVersionDePlantilla(prismaAdmin, pedido, AUTOR);
    const segunda = await publicarVersionDePlantilla(prismaAdmin, pedido, AUTOR);
    expect(segunda).toEqual({ versionId: primera.versionId, numero: 2, publicada: false });
    expect(await versiones("OPERADOR")).toHaveLength(2);
    expect(await auditorias()).toHaveLength(1);
    await expect(publicarVersionDePlantilla(prismaAdmin, { ...pedido, darVer: [OPERARIO_FUERA_DEL_OPERADOR[1]!] }, AUTOR)).rejects.toMatchObject({ codigo: "CLAVE_REUTILIZADA" });
    expect(await versiones("OPERADOR")).toHaveLength(2);
  });

  it("si el número esperado no es el siguiente: VERSION_DESACTUALIZADA con el número correcto en el mensaje, y no escribe", async () => {
    const error = await publicarOperador({ numeroEsperado: 5 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlantillasError);
    expect(error).toMatchObject({ codigo: "VERSION_DESACTUALIZADA" });
    expect((error as Error).message).toContain("es la 2");
    expect(await versiones("OPERADOR")).toHaveLength(1);
    expect(await auditorias()).toHaveLength(0);
  });

  it("GERENTE no lleva versiones y una plantilla inexistente no existe", async () => {
    await expect(publicarOperador({ plantilla: "GERENTE" })).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    await expect(publicarOperador({ plantilla: "ENCARGADO" })).rejects.toMatchObject({ codigo: "NO_EXISTE" });
    expect(await prismaAdmin.versionDePlantilla.count()).toBe(2);
  });

  it("rechaza (y no escribe nada) lo que rompe las reglas: el operador no recibe acciones de administrador ni de gerente; el administrador no recibe las de gerente ni pierde las que conserva siempre", async () => {
    await expect(publicarOperador({ darVer: ["carta_ver"] })).rejects.toMatchObject({ codigo: "PEDIDO_INVALIDO" });
    await expect(publicarOperador({ darVer: ["traspasar_gerencia"] })).rejects.toMatchObject({ codigo: "PEDIDO_INVALIDO" });
    await expect(publicarVersionDePlantilla(prismaAdmin, { clave: nuevaClave(), plantilla: "ADMINISTRADOR", numeroEsperado: 2, darVer: ["traspasar_gerencia"], motivo: "x" }, AUTOR)).rejects.toMatchObject({ codigo: "PEDIDO_INVALIDO" });
    await expect(publicarVersionDePlantilla(prismaAdmin, { clave: nuevaClave(), plantilla: "ADMINISTRADOR", numeroEsperado: 2, quitar: ["gestion_roles"], motivo: "x" }, AUTOR)).rejects.toMatchObject({ codigo: "PEDIDO_INVALIDO" });
    await expect(publicarOperador({ darVer: ["no_existe_en_el_catalogo"] })).rejects.toMatchObject({ codigo: "PEDIDO_INVALIDO" });
    await expect(publicarOperador({ darVer: [] })).rejects.toMatchObject({ codigo: "PEDIDO_INVALIDO" }); // no cambia nada
    expect(await prismaAdmin.versionDePlantilla.count()).toBe(2);
    expect(await auditorias()).toHaveLength(0);
  });

  it("CONCURRENCIA: dos publicaciones a la vez del mismo número con claves distintas: una gana, la otra recibe VERSION_DESACTUALIZADA, queda UNA versión 2 y UNA auditoría", async () => {
    const resultados = await Promise.allSettled([
      publicarOperador({ darVer: [OPERARIO_FUERA_DEL_OPERADOR[0]!] }),
      publicarOperador({ darVer: [OPERARIO_FUERA_DEL_OPERADOR[1]!] }),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(PlantillasError);
    expect(rechazo.reason).toMatchObject({ codigo: "VERSION_DESACTUALIZADA" });
    expect((await versiones("OPERADOR")).map((v) => v.numero)).toEqual([1, 2]);
    expect(await auditorias()).toHaveLength(1);
  });

  it("CONCURRENCIA: dos reintentos a la vez con la MISMA clave devuelven la misma versión (una sola publicada:true)", async () => {
    const pedido = { clave: nuevaClave(), plantilla: "OPERADOR", numeroEsperado: 2, darVer: [OPERARIO_FUERA_DEL_OPERADOR[0]!], motivo: "A la vez" };
    const [a, b] = await Promise.all([publicarVersionDePlantilla(prismaAdmin, pedido, AUTOR), publicarVersionDePlantilla(prismaAdmin, pedido, AUTOR)]);
    expect(a.versionId).toBe(b.versionId);
    expect([a.publicada, b.publicada].filter(Boolean)).toHaveLength(1);
    expect(await versiones("OPERADOR")).toHaveLength(2);
    expect(await auditorias()).toHaveLength(1);
  });
});

describe("fijar el piso de una acción", () => {
  const ACCION = OPERARIO_FUERA_DEL_OPERADOR[0]!;

  it("una acción sin piso: lo crea (versión 0 esperada), avisa qué plantillas la tienen y audita; el mismo tipo después es «sin cambios» y no audita", async () => {
    const r = await fijarPisoDePlataforma(prismaAdmin, { accion: "ver_stock", tipo: "TODOS_LOS_ROLES", versionEsperada: 0, motivo: "Todos ven el stock" }, AUTOR);
    expect(r).toEqual({ cambiado: true, version: 1, plantillasQueLaTienen: ["ADMINISTRADOR", "OPERADOR"] });
    expect(await prismaAdmin.pisoDePlataforma.findUnique({ where: { accionClave: "ver_stock" } })).toMatchObject({ tipo: "TODOS_LOS_ROLES", version: 1, autor: AUTOR.adminEmail });
    expect(await auditorias()).toMatchObject([{ accion: "piso-fijado", empresaAfectadaId: null }]);
    const otra = await fijarPisoDePlataforma(prismaAdmin, { accion: "ver_stock", tipo: "TODOS_LOS_ROLES", versionEsperada: 1, motivo: "Otra vez" }, AUTOR);
    expect(otra.cambiado).toBe(false);
    expect(await auditorias()).toHaveLength(1);
  });

  it("cambiar el tipo de un piso existente sube la versión y la fecha, y audita el tipo anterior; el piso manda sobre las plantillas (la próxima publicación tiene que ajustarlas)", async () => {
    const antes = await prismaAdmin.pisoDePlataforma.findUniqueOrThrow({ where: { accionClave: "traspasar_gerencia" } });
    const r = await fijarPisoDePlataforma(prismaAdmin, { accion: "traspasar_gerencia", tipo: "TODOS_LOS_ROLES", versionEsperada: 1, motivo: "Prueba" }, AUTOR);
    expect(r).toMatchObject({ cambiado: true, version: 2, plantillasQueLaTienen: [] });
    const despues = await prismaAdmin.pisoDePlataforma.findUniqueOrThrow({ where: { accionClave: "traspasar_gerencia" } });
    expect(despues).toMatchObject({ tipo: "TODOS_LOS_ROLES", version: 2 });
    expect(despues.actualizadoEn.getTime()).toBeGreaterThanOrEqual(antes.actualizadoEn.getTime());
    expect((await auditorias())[0]!.detalle).toMatchObject({ accion: "traspasar_gerencia", tipo: "TODOS_LOS_ROLES", tipoAnterior: "SOLO_GERENTE", version: 2 });
    // Ahora ninguna plantilla cumple el piso nuevo: publicar se rechaza hasta que alguien decida.
    await expect(publicarOperador()).rejects.toThrow(/TODOS_LOS_ROLES/);
  });

  it("versión esperada que no coincide (o 0 con piso existente): VERSION_DESACTUALIZADA, sin escribir", async () => {
    await expect(fijarPisoDePlataforma(prismaAdmin, { accion: "traspasar_gerencia", tipo: "TODOS_LOS_ROLES", versionEsperada: 7, motivo: "x" }, AUTOR)).rejects.toMatchObject({ codigo: "VERSION_DESACTUALIZADA" });
    await expect(fijarPisoDePlataforma(prismaAdmin, { accion: ACCION, tipo: "SOLO_GERENTE", versionEsperada: 3, motivo: "x" }, AUTOR)).rejects.toMatchObject({ codigo: "VERSION_DESACTUALIZADA" });
    expect((await prismaAdmin.pisoDePlataforma.findUniqueOrThrow({ where: { accionClave: "traspasar_gerencia" } })).version).toBe(1);
    expect(await auditorias()).toHaveLength(0);
  });

  it("rechaza una acción fuera del catálogo y un tipo que no es de la lista", async () => {
    await expect(fijarPisoDePlataforma(prismaAdmin, { accion: "no_existe", tipo: "SOLO_GERENTE", versionEsperada: 0, motivo: "x" }, AUTOR)).rejects.toMatchObject({ codigo: "PEDIDO_INVALIDO" });
    await expect(fijarPisoDePlataforma(prismaAdmin, { accion: ACCION, tipo: "NADIE", versionEsperada: 0, motivo: "x" }, AUTOR)).rejects.toMatchObject({ codigo: "PEDIDO_INVALIDO" });
  });

  it("CONCURRENCIA: dos pisos distintos para la misma acción a la vez: una gana, la otra VERSION_DESACTUALIZADA; queda UNA fila y UNA auditoría", async () => {
    const pedido = (tipo: string) => fijarPisoDePlataforma(prismaAdmin, { accion: ACCION, tipo, versionEsperada: 0, motivo: "A la vez" }, AUTOR);
    const resultados = await Promise.allSettled([pedido("SOLO_GERENTE"), pedido("TODOS_LOS_ROLES")]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((resultados.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ codigo: "VERSION_DESACTUALIZADA" });
    expect(await prismaAdmin.pisoDePlataforma.count({ where: { accionClave: ACCION } })).toBe(1);
    expect((await auditorias()).filter((f) => f.accion === "piso-fijado")).toHaveLength(1);
  });

  it("CONCURRENCIA: el mismo piso pedido dos veces a la vez: uno lo crea y el otro ve que ya está (cambiado:false)", async () => {
    const pedido = () => fijarPisoDePlataforma(prismaAdmin, { accion: ACCION, tipo: "SOLO_GERENTE", versionEsperada: 0, motivo: "A la vez" }, AUTOR);
    const [a, b] = await Promise.all([pedido(), pedido()]);
    expect([a.cambiado, b.cambiado].filter(Boolean)).toHaveLength(1);
    expect(await auditorias()).toHaveLength(1);
  });
});

describe("sincronizar las acciones nuevas del catálogo", () => {
  it("sin acciones nuevas no escribe nada (ni audita)", async () => {
    expect(await sincronizarAccionesNuevas(prismaAdmin, AUTOR)).toEqual({ introducidas: 0, versiones: 0, pisos: 0 });
    expect(await auditorias()).toHaveLength(0);
    expect(await prismaAdmin.versionDePlantilla.count()).toBe(2);
  });

  // La base «conoce» solo parte del catálogo: ver_stock (operario, admin y operador), guardar_receta (administrador, admin), gestion_usuarios (gobierno, admin) y traspasar_gerencia (gerente, nadie) son las nuevas.
  const NUEVAS = ["ver_stock", "guardar_receta", "gestion_usuarios", "traspasar_gerencia"];
  const conocidas = ACCIONES.filter((a) => !NUEVAS.includes(a.clave));

  it("suma cada acción nueva a las plantillas que su semilla indica (una versión por plantilla), crea su piso por nivel, la marca introducida y audita; la segunda vez no hace nada", async () => {
    await sembrarSoloEstasAcciones(prismaAdmin, conocidas);
    expect((await versiones("ADMINISTRADOR"))[0]!.accionesVer).not.toContain("guardar_receta");
    const r = await sincronizarAccionesNuevas(prismaAdmin, AUTOR);
    expect(r).toEqual({ introducidas: 4, versiones: 2, pisos: 2 });
    const [, admin2] = await versiones("ADMINISTRADOR");
    const [, operador2] = await versiones("OPERADOR");
    expect(admin2!.accionesVer).toEqual(semilla.listas.ADMINISTRADOR.ver);
    expect(operador2!.accionesVer).toEqual(semilla.listas.OPERADOR.ver);
    expect((await prismaAdmin.pisoDePlataforma.findMany({ orderBy: { accionClave: "asc" } })).map((p) => [p.accionClave, p.tipo])).toEqual(semilla.pisos.map((p) => [p.accionClave, p.tipo]));
    expect(await prismaAdmin.accionIntroducida.count()).toBe(ACCIONES.length);
    expect(await auditorias()).toMatchObject([{ accion: "acciones-sincronizadas", empresaAfectadaId: null }]);
    expect(await sincronizarAccionesNuevas(prismaAdmin, AUTOR)).toEqual({ introducidas: 0, versiones: 0, pisos: 0 });
    expect(await auditorias()).toHaveLength(1);
  });

  it("NO repone: una acción que la plataforma sacó de una plantilla no vuelve sola (solo entran las nuevas) y no pisa un piso que ya existe", async () => {
    await sembrarSoloEstasAcciones(prismaAdmin, conocidas);
    // La plataforma ya fijó a mano un piso TODOS_LOS_ROLES para una de las acciones nuevas (fila existente): la sincronización no lo cambia.
    await prismaAdmin.$executeRawUnsafe(`INSERT INTO "PisoDePlataforma" ("id", "accionClave", "tipo", "autor") VALUES ('${randomUUID()}', 'ver_stock', 'TODOS_LOS_ROLES', 'a-mano@plataforma.test')`);
    const r = await sincronizarAccionesNuevas(prismaAdmin, AUTOR);
    expect(r.pisos).toBe(2);
    expect((await prismaAdmin.pisoDePlataforma.findUniqueOrThrow({ where: { accionClave: "ver_stock" } })).tipo).toBe("TODOS_LOS_ROLES");
    expect((await versiones("OPERADOR"))[1]!.accionesVer).toContain("ver_stock");
  });

  it("CONCURRENCIA: dos sincronizaciones a la vez: una trabaja y la otra ve que ya está hecho; queda UNA versión nueva por plantilla y UNA auditoría", async () => {
    await sembrarSoloEstasAcciones(prismaAdmin, conocidas);
    const resultados = await Promise.all([sincronizarAccionesNuevas(prismaAdmin, AUTOR), sincronizarAccionesNuevas(prismaAdmin, AUTOR)]);
    expect(resultados.map((r) => r.introducidas).sort()).toEqual([0, 4]);
    expect((await versiones("ADMINISTRADOR")).map((v) => v.numero)).toEqual([1, 2]);
    expect((await versiones("OPERADOR")).map((v) => v.numero)).toEqual([1, 2]);
    expect(await auditorias()).toHaveLength(1);
  });
});

describe("la base impone sus reglas (como dueño, sin pasar por la aplicación)", () => {
  const insertarVersion = (plantilla: string, numero: number, ver: string[], editar: string[] = ver) =>
    prismaAdmin.$executeRawUnsafe(
      `INSERT INTO "VersionDePlantilla" ("id", "plantillaClave", "numero", "accionesVer", "accionesEditar", "autor", "claveIdempotencia", "payloadHash") VALUES ($1::uuid, $2, $3, $4::text[], $5::text[], 'a-mano@plataforma.test', $6::uuid, 'h')`,
      randomUUID(),
      plantilla,
      numero,
      ver,
      editar,
      randomUUID(),
    );
  const operador = semilla.listas.OPERADOR.ver;
  const admin = semilla.listas.ADMINISTRADOR.ver;

  it("la versión publicada es inmutable: ningún UPDATE ni DELETE (ni del dueño); lo mismo para plantillas y acciones introducidas; un piso no se borra", async () => {
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "VersionDePlantilla" SET "autor" = 'otro'`)).rejects.toThrow(/solo se agrega/);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "VersionDePlantilla"`)).rejects.toThrow(/solo se agrega/);
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "PlantillaDeRol" SET "clave" = 'X'`)).rejects.toThrow(/solo se agrega/);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "PlantillaDeRol"`)).rejects.toThrow(/solo se agrega/);
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "AccionIntroducida" SET "accionClave" = 'otra'`)).rejects.toThrow(/solo se agrega/);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "AccionIntroducida"`)).rejects.toThrow(/solo se agrega/);
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "PisoDePlataforma"`)).rejects.toThrow(/solo se agrega/);
  });

  it("un piso cambia de tipo pero nunca de acción; cada cambio de tipo sube la versión y la fecha", async () => {
    await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "PisoDePlataforma" SET "accionClave" = 'otra_accion' WHERE "accionClave" = 'traspasar_gerencia'`)).rejects.toThrow(/nunca de acción/);
    await prismaAdmin.$executeRawUnsafe(`UPDATE "PisoDePlataforma" SET "tipo" = 'TODOS_LOS_ROLES' WHERE "accionClave" = 'traspasar_gerencia'`);
    const p = await prismaAdmin.pisoDePlataforma.findUniqueOrThrow({ where: { accionClave: "traspasar_gerencia" } });
    expect(p.version).toBe(2);
    expect(p.actualizadoEn.getTime()).toBeGreaterThanOrEqual(p.creadoEn.getTime());
  });

  it("el número de una versión tiene que ser el siguiente de la plantilla", async () => {
    await expect(insertarVersion("OPERADOR", 5, operador)).rejects.toThrow(/siguiente de la plantilla/);
    await expect(insertarVersion("OPERADOR", 1, operador)).rejects.toThrow(/siguiente de la plantilla/);
    await insertarVersion("OPERADOR", 2, [...operador, OPERARIO_FUERA_DEL_OPERADOR[0]!]);
    expect(await versiones("OPERADOR")).toHaveLength(2);
  });

  it("rechaza la plantilla GERENTE (no lleva versiones), Editar fuera de Ver, claves de forma inválida y claves repetidas", async () => {
    await expect(insertarVersion("GERENTE", 1, operador)).rejects.toThrow(/VersionDePlantilla_plantilla_check/);
    await expect(insertarVersion("OPERADOR", 2, operador, [...operador, OPERARIO_FUERA_DEL_OPERADOR[0]!])).rejects.toThrow(/VersionDePlantilla_editar_en_ver_check/);
    await expect(insertarVersion("OPERADOR", 2, [...operador, "Mala Clave"])).rejects.toThrow(/VersionDePlantilla_acciones_(ver|editar)_check/);
    await expect(insertarVersion("OPERADOR", 2, [...operador, "ver_stock"])).rejects.toThrow(/VersionDePlantilla_acciones_(ver|editar)_check/);
    await expect(prismaAdmin.$executeRawUnsafe(`INSERT INTO "PisoDePlataforma" ("id", "accionClave", "tipo", "autor") VALUES ('${randomUUID()}', 'Mala Clave', 'SOLO_GERENTE', 'x')`)).rejects.toThrow(/PisoDePlataforma_accion_check/);
    expect(await prismaAdmin.versionDePlantilla.count()).toBe(2);
  });

  it("un OPERADOR con una acción SOLO_GERENTE se rechaza; un ADMINISTRADOR con las del gobierno es válido (diferencia D-E con Pedernal)", async () => {
    await expect(insertarVersion("OPERADOR", 2, [...operador, "traspasar_gerencia"])).rejects.toThrow(/VersionDePlantilla_pisos|SOLO_GERENTE/);
    await insertarVersion("ADMINISTRADOR", 2, admin); // lleva las 12 del gobierno (SOLO_GERENTE) y la base la acepta
    expect(await versiones("ADMINISTRADOR")).toHaveLength(2);
  });

  it("una lista sin una acción TODOS_LOS_ROLES se rechaza", async () => {
    await prismaAdmin.$executeRawUnsafe(`INSERT INTO "PisoDePlataforma" ("id", "accionClave", "tipo", "autor") VALUES ('${randomUUID()}', '${OPERARIO_FUERA_DEL_OPERADOR[0]}', 'TODOS_LOS_ROLES', 'a-mano@plataforma.test')`);
    await expect(insertarVersion("OPERADOR", 2, operador)).rejects.toThrow(/TODOS_LOS_ROLES/);
    await insertarVersion("OPERADOR", 2, [...operador, OPERARIO_FUERA_DEL_OPERADOR[0]!]);
  });

  it("con los pisos vaciados se rechaza cualquier versión (no se publica a ciegas)", async () => {
    await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "PisoDePlataforma"');
    await expect(insertarVersion("OPERADOR", 2, operador)).rejects.toThrow(/no se pueden leer los pisos/);
    await expect(insertarVersion("ADMINISTRADOR", 2, admin)).rejects.toThrow(/no se pueden leer los pisos/);
  });

  it("ORÁCULO P × F contra el trigger: para las acciones de nivel operario, el resultado de agregar y de quitar coincide con la tabla del oráculo", async () => {
    const agregar = tablaDelOraculoDePlantillas("Agregar a Ver").filas.filter((f) => f.N === "operario");
    const quitar = tablaDelOraculoDePlantillas("Quitar de Ver y Editar").filas.filter((f) => f.N === "operario" && f.A === "NO");
    expect(agregar).toHaveLength(6);
    expect(quitar).toHaveLength(6);
    // La base no mira el catálogo (solo la forma de la clave): una clave sintética sirve para ambas plantillas aunque el catálogo real ya se la dé al administrador.
    const X_AGREGAR = "accion_sintetica_x";
    const X_QUITAR = "ver_stock"; // operario, en las dos plantillas, no la conserva el administrador siempre
    const conPiso = async (accion: string, f: string) => {
      await restaurarSemillaDePlantillasYPisos(prismaAdmin);
      if (f !== "SIN_PISO") await prismaAdmin.$executeRawUnsafe(`INSERT INTO "PisoDePlataforma" ("id", "accionClave", "tipo", "autor") VALUES ('${randomUUID()}', '${accion}', '${f}', 'a-mano@plataforma.test')`);
    };
    const resultado = async (plantilla: string, ver: string[]) => insertarVersion(plantilla, 2, ver).then(() => "PUBLICA", () => "RECHAZA");
    for (const f of agregar) {
      await conPiso(X_AGREGAR, f.F!);
      const ver = [...semilla.listas[f.P as "ADMINISTRADOR" | "OPERADOR"].ver, X_AGREGAR];
      expect(await resultado(f.P!, ver), JSON.stringify(f)).toBe(f.Resultado!.startsWith("RECHAZA") ? "RECHAZA" : "PUBLICA");
    }
    for (const f of quitar) {
      await conPiso(X_QUITAR, f.F!);
      const ver = semilla.listas[f.P as "ADMINISTRADOR" | "OPERADOR"].ver.filter((c) => c !== X_QUITAR);
      expect(await resultado(f.P!, ver), JSON.stringify(f)).toBe(f.Resultado!.startsWith("RECHAZA") ? "RECHAZA" : "PUBLICA");
    }
  });
});

describe.skipIf(!HAY_ROL_DE_PLATAFORMA)("con los roles reales (motor2_plataforma y motor2_app)", () => {
  it("la plataforma publica una versión y fija un piso con sus grants; el resto de lo que podría hacer se rechaza", async () => {
    const r = await publicarVersionDePlantilla(plataformaReal, { clave: nuevaClave(), plantilla: "OPERADOR", numeroEsperado: 2, darVer: [OPERARIO_FUERA_DEL_OPERADOR[0]!], motivo: "Con el rol real" }, AUTOR);
    expect(r.publicada).toBe(true);
    const p = await fijarPisoDePlataforma(plataformaReal, { accion: OPERARIO_FUERA_DEL_OPERADOR[1]!, tipo: "SOLO_GERENTE", versionEsperada: 0, motivo: "Con el rol real" }, AUTOR);
    expect(p.cambiado).toBe(true);
    const rechazada = /permission denied|permiso denegado|insufficient|solo se agrega|solo lo escribe/i;
    await expect(plataformaReal.$executeRawUnsafe(`TRUNCATE TABLE "VersionDePlantilla"`)).rejects.toThrow(rechazada);
    await expect(plataformaReal.$executeRawUnsafe(`DELETE FROM "VersionDePlantilla"`)).rejects.toThrow(rechazada);
    await expect(plataformaReal.$executeRawUnsafe(`UPDATE "VersionDePlantilla" SET "autor" = 'x'`)).rejects.toThrow(rechazada);
    await expect(plataformaReal.$executeRawUnsafe(`DELETE FROM "PisoDePlataforma"`)).rejects.toThrow(rechazada);
    await expect(plataformaReal.$executeRawUnsafe(`INSERT INTO "PlantillaDeRol" ("id", "clave") VALUES ('${randomUUID()}', 'OPERADOR')`)).rejects.toThrow(rechazada);
  });

  it("la app (motor2_app) no puede leer ni escribir ninguna de las cuatro tablas", async () => {
    for (const tabla of ["PlantillaDeRol", "VersionDePlantilla", "PisoDePlataforma", "AccionIntroducida"]) {
      await expect(prismaSinEmpresa.$queryRawUnsafe(`SELECT count(*) FROM "${tabla}"`), tabla).rejects.toThrow(/permission denied|permiso denegado/i);
      await expect(prismaSinEmpresa.$executeRawUnsafe(`DELETE FROM "${tabla}"`), tabla).rejects.toThrow(/permission denied|permiso denegado|insufficient/i);
    }
  });
});

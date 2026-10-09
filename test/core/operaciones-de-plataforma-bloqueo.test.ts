import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { cambiarModulosDeEmpresa } from "../../src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa";
import { cambiarPoliticaDeEmpresa } from "../../src/server/operaciones-de-plataforma/cambiar-politica-de-empresa";
import type { AutorDeCambioDePlataforma } from "../../src/server/operaciones-de-plataforma/auditar-cambio-de-plataforma";

/**
 * S-33: las operaciones de plataforma (`modulos-empresa`, `politica-empresa`) leen el estado de la empresa, calculan el cambio y escriben, y dos corridas a la vez (dos operadores, un
 * reintento) leían el MISMO estado anterior: la segunda pisaba a la primera y su auditoría decía «antes» algo que ya no era cierto. Ahora la transacción empieza tomando la fila de la
 * `Empresa` con `FOR UPDATE`: la segunda espera a que la primera termine y lee lo que dejó. El ataque se reproduce sosteniendo ese bloqueo desde otra transacción y viendo si la
 * operación espera.
 */
const AUTOR: AutorDeCambioDePlataforma = { adminId: "admin-1", adminEmail: "operador@plataforma.com", instalacionId: "principal", instalacionNombre: "principal" };
const NORTE = "norte";

afterAll(async () => {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await prismaAdmin.empresa.create({ data: { id: NORTE, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
  await prismaAdmin.moduloEmpresa.deleteMany({ where: { empresaId: NORTE } });
});

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sostiene la fila de la empresa bloqueada (`FOR UPDATE`) hasta que se llame a `soltar`; resuelve cuando el bloqueo ya está tomado. */
async function sostenerBloqueo(): Promise<{ soltar: () => void; terminada: Promise<void> }> {
  let soltar!: () => void;
  const liberar = new Promise<void>((r) => (soltar = r));
  let tomado!: () => void;
  const yaTomado = new Promise<void>((r) => (tomado = r));
  const terminada = prismaAdmin.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empresa" WHERE id = ${NORTE} FOR UPDATE`;
      tomado();
      await liberar;
    },
    { timeout: 20_000 },
  );
  await yaTomado;
  return { soltar, terminada };
}

/** `true` si la promesa NO resolvió ni rechazó dentro de `ms`. */
async function sigueEsperando(promesa: Promise<unknown>, ms: number): Promise<boolean> {
  let termino = false;
  promesa.then(
    () => (termino = true),
    () => (termino = true),
  );
  await esperar(ms);
  return !termino;
}

describe("S-33: las operaciones de plataforma serializan por empresa (FOR UPDATE)", () => {
  it("cambiarModulosDeEmpresa espera a que otra transacción suelte la fila de la empresa, y después se aplica", async () => {
    const bloqueo = await sostenerBloqueo();
    const operacion = cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock"] }, AUTOR);
    expect(await sigueEsperando(operacion, 600), "con la fila tomada por otra transacción la operación tiene que esperar").toBe(true);
    bloqueo.soltar();
    await bloqueo.terminada;
    const r = await operacion;
    expect(r.cambiados.map((c) => c.modulo)).toEqual(["stock"]);
  });

  it("cambiarPoliticaDeEmpresa espera a que otra transacción suelte la fila de la empresa, y lee lo que esa dejó", async () => {
    const bloqueo = await sostenerBloqueo();
    const operacion = cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "norte", perfil: "lite" }, AUTOR);
    expect(await sigueEsperando(operacion, 600), "con la fila tomada por otra transacción la operación tiene que esperar").toBe(true);
    bloqueo.soltar();
    await bloqueo.terminada;
    const r = await operacion;
    expect([...r.cambiadas].sort()).toEqual(["dosPaneles", "permisosEditables"]);
  });

  // Estos dos son los que distinguen de verdad: las esperas de arriba también las provoca la clave foránea al escribir (FOR KEY SHARE), pero las lecturas de «antes» ya habían pasado.
  it("política: dos corridas simultáneas del mismo cambio: una cambia y la otra ve el resultado de la primera (sin pisarse)", async () => {
    const [a, b] = await Promise.all([
      cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "norte", perfil: "lite" }, AUTOR),
      cambiarPoliticaDeEmpresa(prismaAdmin, { slug: "norte", perfil: "lite" }, AUTOR),
    ]);
    expect([a.cambiadas.length, b.cambiadas.length].sort()).toEqual([0, 2]);
    const filas = await prismaAdmin.auditoriaPlataforma.count({ where: { accion: "politica-cambiada", empresaAfectadaId: NORTE } });
    expect(filas, "cada perilla deja UNA fila de auditoría, no dos").toBe(2);
  });

  it("módulos: dos corridas simultáneas que activan el mismo módulo: una lo activa y la otra ve que ya estaba (una sola fila de auditoría)", async () => {
    const [a, b] = await Promise.all([
      cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock"] }, AUTOR),
      cambiarModulosDeEmpresa(prismaAdmin, { slug: "norte", activar: ["stock"] }, AUTOR),
    ]);
    expect([a.cambiados.length, b.cambiados.length].sort()).toEqual([0, 1]);
    expect(await prismaAdmin.auditoriaPlataforma.count({ where: { accion: "modulo-activado" } }), "una sola fila de auditoría").toBe(1);
  });
});

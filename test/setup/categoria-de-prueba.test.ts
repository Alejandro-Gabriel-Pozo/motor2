import { describe, expect, it, vi } from "vitest";
import { esBaseLocalParaLimpiar, limpiarCategoriasDeTest, type ClienteConCategorias } from "./categoria-de-prueba";

/** El camino de limpieza es SOLO LOCAL y cierra ante la duda (E1-D1, dueño 2026-11-17, «como pedernal»: las categorías no se borran fuera de las pruebas locales). */
describe("limpiarCategoriasDeTest: solo en una base local", () => {
  const LOCAL = { DATABASE_URL: "postgresql://motor2_app:x@localhost:5432/motor2_dev", DIRECT_URL: "postgresql://motor2:x@127.0.0.1:5432/motor2_dev" };

  it.each([
    ["servidor local por nombre y por IP", LOCAL, true],
    ["socket de unix (host en el parámetro)", { DATABASE_URL: "postgresql:///motor2_dev?host=/var/run/postgresql" }, true],
    ["una base remota (Neon)", { DATABASE_URL: "postgresql://u:x@ep-algo.neon.tech/neondb" }, false],
    ["una local y una remota: alcanza una remota para negar", { ...LOCAL, MOTOR2_E2E_DATABASE_URL: "postgresql://u:x@ep-algo.neon.tech/x_e2e" }, false],
    ["ninguna variable de conexión: cierra", {}, false],
    ["una URL ilegible: cierra", { DATABASE_URL: "no es una url" }, false],
    ["NODE_ENV=production niega aunque la base sea local", { ...LOCAL, NODE_ENV: "production" }, false],
    ["`host=` de la query a otra máquina niega aunque la URL diga localhost (GT-22, M-29)", { DATABASE_URL: "postgresql://u:x@localhost/motor2_dev?host=10.0.0.5" }, false],
    ["`hostaddr=` a otra máquina niega aunque la URL diga localhost", { DATABASE_URL: "postgresql://u:x@localhost/motor2_dev?hostaddr=10.0.0.5" }, false],
    ["lista de hosts con uno no local niega", { DATABASE_URL: "postgresql://u:x@localhost/motor2_dev?host=localhost,10.0.0.5" }, false],
    ["socket de unix (sin servidor en la URL) es local", { DATABASE_URL: "postgresql:///motor2_dev?host=/var/run/postgresql" }, true],
    ["socket con `hostaddr` a otra máquina niega", { DATABASE_URL: "postgresql:///motor2_dev?host=/var/run/postgresql&hostaddr=10.0.0.5" }, false],
    ["sin servidor y sin socket niega", { DATABASE_URL: "postgresql:///motor2_dev" }, false],
  ])("%s", (_nombre, entorno, esperado) => {
    expect(esBaseLocalParaLimpiar(entorno as Record<string, string>)).toBe(esperado);
  });

  it("con una base no local se NIEGA y no llama a la base", async () => {
    const deleteMany = vi.fn();
    const cliente = { categoriaProducto: { create: vi.fn(), createMany: vi.fn(), deleteMany } } as unknown as ClienteConCategorias;
    await expect(limpiarCategoriasDeTest(cliente, undefined, { DATABASE_URL: "postgresql://u:x@ep-algo.neon.tech/neondb" })).rejects.toThrow(/se niega a borrar/);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("con una base local borra lo pedido y devuelve cuántas", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const cliente = { categoriaProducto: { create: vi.fn(), createMany: vi.fn(), deleteMany } } as unknown as ClienteConCategorias;
    expect(await limpiarCategoriasDeTest(cliente, { nombre: "x" }, LOCAL)).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({ where: { nombre: "x" } });
  });
});

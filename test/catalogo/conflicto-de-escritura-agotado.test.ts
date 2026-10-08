import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { fijarRendimientoLocalCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/fijar-rendimiento-local";
import { volverAlRendimientoCentralCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/volver-al-rendimiento-central";

/**
 * Hito 4, bloque 4.2 (H4C-5): el `.catch(esConflictoDeEscritura)` de las acciones de la receta por sucursal que corren en una transacción SERIALIZABLE pasó de la
 * Server Action al caso de uso (precedente: `test/permisos/guardar-permisos-reintentos-agotados.test.ts`, Hito 3, I.3). Ningún test cubría ese camino: agotar los
 * reintentos (la transacción ya hizo rollback, no se guardó nada) tiene que volver como el MISMO mensaje de negocio que el choque de versión, y cualquier OTRO
 * error tiene que seguir de largo (no se disfraza de conflicto). Se prueba el caso de uso con una transacción armada a mano que falla en cada intento: no
 * necesita base.
 */
const conflictoDeEscritura = () => new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", { code: "P2034", clientVersion: "test" });

const actor = (transaccion: ReturnType<typeof vi.fn>) =>
  ({ transaccion, usuarioId: "u-prueba", sucursalId: "s-prueba", sucursalNombre: "Central" }) as unknown as Parameters<typeof fijarRendimientoLocalCasoDeUso>[0];

const CASOS = [
  {
    nombre: "fijarRendimientoLocal",
    llamar: (t: ReturnType<typeof vi.fn>) => fijarRendimientoLocalCasoDeUso(actor(t), { recetaIngredienteId: "linea", cantidad: 0.3, mermaPorcentaje: null, origen: null }),
    mensaje: "La receta cambió mientras mirabas el reporte; recargá.",
  },
  {
    nombre: "volverAlRendimientoCentral",
    llamar: (t: ReturnType<typeof vi.fn>) => volverAlRendimientoCentralCasoDeUso(actor(t), { recetaIngredienteId: "linea" }),
    mensaje: "La receta cambió mientras mirabas el reporte; recargá.",
  },
];

describe("receta por sucursal: conflicto de escritura agotado y otros errores, en el caso de uso", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(CASOS.map((c) => [c.nombre, c] as const))("%s: un conflicto en cada intento reintenta 5 veces y vuelve como el mensaje de negocio", async (_n, c) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const transaccion = vi.fn(async () => {
      throw conflictoDeEscritura();
    });
    const r = await c.llamar(transaccion);
    expect(r).toEqual({ ok: false, codigo: "RECETA_CAMBIADA", mensaje: c.mensaje });
    expect(transaccion).toHaveBeenCalledTimes(5);
  });

  it.each(CASOS.map((c) => [c.nombre, c] as const))("%s: cualquier otro error sigue de largo, sin reintentar ni disfrazarse de conflicto", async (_n, c) => {
    const otro = new Error("se cortó la conexión");
    const transaccion = vi.fn(async () => {
      throw otro;
    });
    await expect(c.llamar(transaccion)).rejects.toBe(otro);
    expect(transaccion).toHaveBeenCalledTimes(1);
  });
});

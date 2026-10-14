import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";
import { archivarOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/archivar-opciones";

/**
 * OPCIONES-LIMPIEZA: «archivar» una opción contra «vender» con esa opción, A LA VEZ (Promise.allSettled contra Postgres real, transacciones SERIALIZABLE de verdad, loop de 10).
 * Siempre un estado válido: o la venta entró antes (la línea con su foto de «Almendras», que queda como se vendió para siempre) o el pedido se rechaza porque la opción ya no está
 * disponible (sin líneas a medias). Y una vez archivada, ningún pedido la vende.
 */
const ITERACIONES = 10;
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let cuentaId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  await entrarComo(s.admin);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});

const conAlmendras = () => [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), elegida(c, c.almendrasId)] }];

describe("archivar una opción mientras se vende (OPCIONES-LIMPIEZA)", () => {
  it("o la línea con la foto de lo vendido (que no cambia después), o el rechazo por «ya no está disponible»; nunca otra cosa", async () => {
    const actor = actorDePrueba(s.admin.id, s.sucursalId);
    let vendidas = 0;
    let rechazadas = 0;
    for (let i = 0; i < ITERACIONES; i++) {
      expect(await archivarOpcionesCasoDeUso(actor, { grupoIds: [], opcionIds: [c.almendrasId], archivar: false })).toMatchObject({ ok: true });
      const lineasAntes = await prisma.cuentaItem.count({ where: { cuentaId } });
      const [venta, archivo] = await Promise.allSettled([agregarItems(cuentaId, conAlmendras()), archivarOpcionesCasoDeUso(actor, { grupoIds: [], opcionIds: [c.almendrasId], archivar: true })]);
      expect(venta.status === "fulfilled" && archivo.status === "fulfilled", `vuelta ${i}: una promesa rechazó`).toBe(true);
      if (venta.status !== "fulfilled" || archivo.status !== "fulfilled") continue;
      expect(archivo.value, `vuelta ${i}`).toMatchObject({ ok: true, datos: { cambiados: 1 } });
      const lineas = await prisma.cuentaItem.count({ where: { cuentaId } });
      if (venta.value.ok) {
        vendidas++;
        expect(lineas, `vuelta ${i}`).toBe(lineasAntes + 1);
      } else {
        rechazadas++;
        expect(venta.value.mensaje, `vuelta ${i}`).toMatch(/ya no está disponible/);
        expect(lineas, `vuelta ${i}: quedó una línea a medias`).toBe(lineasAntes);
      }
      expect((await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: c.almendrasId } })).activa).toBe(false);
    }
    expect(vendidas + rechazadas).toBe(ITERACIONES);

    // Lo vendido queda como se vendió: cada foto de «Almendras» con su nombre, su versión y su importe de entonces, aunque la opción esté archivada.
    const fotos = await prisma.opcionElegidaEnLinea.findMany({ where: { opcionId: c.almendrasId }, select: { nombreOpcion: true, nombreGrupo: true, versionDeOpcionId: true, importeUnitario: true } });
    expect(fotos).toHaveLength(vendidas);
    for (const f of fotos) expect({ ...f, importeUnitario: Number(f.importeUnitario) }).toEqual({ nombreOpcion: "Almendras", nombreGrupo: "Leche", versionDeOpcionId: c.versionDe[c.almendrasId], importeUnitario: 150 });

    // Archivada, ningún pedido la vende.
    const despues = await agregarItems(cuentaId, conAlmendras());
    expect(despues.ok).toBe(false);
    expect(despues.mensaje).toMatch(/ya no está disponible/);
  });
});

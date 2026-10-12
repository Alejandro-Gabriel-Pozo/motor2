import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { obtenerBandejaTransferencias } from "../../src/server/actions/traspasos/lecturas";

/**
 * D7 de la RLS por sucursal (paquete 1; ADR-028): la Bandeja de traspasos pide `seccionOrigen` y `seccionDestino`, dos relaciones OPCIONALES a `Seccion` (que es de UNA sucursal). Un traspaso
 * lo ve cada lado (la política de `TraspasoSucursal` mira origen O destino), pero la sección del OTRO lado no: con las políticas puestas Prisma devuelve `null` en vez de la sección, sin error. La
 * pantalla (`app/(app)/traspasos/page.tsx`) ya lo tolera —`t.seccionOrigen?.nombre ?? null`— y `bandeja.tsx` dibuja «Sección: Depósito A → —». Lo que fija este test, en las DOS bases:
 *  - la sección PROPIA viene siempre con su nombre (la que eligió esta sucursal al aprobar o al aceptar);
 *  - la del otro lado viene con su nombre sin las políticas (la base de CI de hoy) y `null` con ellas (la base de producción después del paquete); en ningún caso rompe la Bandeja ni se pierde el traspaso;
 *  - la sección que la otra sucursal todavía no eligió es `null` siempre.
 * Con las políticas puestas se corre contra una base local a la que se le aplicó el SQL del generador (`test/setup/politicas-de-alcance-de-sucursal.ts`); el test detecta cuál de las dos es.
 */
describe("la Bandeja de traspasos con la sección del otro lado", () => {
  let sucursalAId: string;
  let sucursalBId: string;
  let seccionAId: string;
  let seccionBId: string;
  let productoId: string;
  let adminAId: string;
  let adminBId: string;
  let creadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase(); // «Central» = sucursal A
    sucursalAId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionAId = (await sembrarSeccion(sucursalAId, "Depósito A")).id;
    sucursalBId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;
    adminAId = (await crearUsuarioConMembresia({ email: "admin-a@test.com", sucursalId: sucursalAId, rolId: base.admin.id })).id;
    adminBId = (await crearUsuarioConMembresia({ email: "admin-b@test.com", sucursalId: sucursalBId, rolId: base.admin.id })).id;
    creadorId = adminBId;
    productoId = (await prisma.producto.create({ data: { codigo: "MP_SECCIONES", nombre: "MP secciones", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
  });

  const comoA = () => mockearUsuarioActual({ id: adminAId, email: "admin-a@test.com", nombre: null });
  const comoB = () => mockearUsuarioActual({ id: adminBId, email: "admin-b@test.com", nombre: null });

  /** Un traspaso de A (origen) a B (destino) en el estado dado, con las secciones que ya eligió cada lado. Se siembra con el rol de pruebas: el test mira la LECTURA, no los casos de uso que lo crean. */
  const traspaso = (estado: "ENVIADA" | "ACEPTADA", secciones: { origen?: string; destino?: string }) =>
    prisma.traspasoSucursal.create({
      data: {
        origenSucursalId: sucursalAId, destinoSucursalId: sucursalBId, productoId, cantidad: 2, iniciadoPor: "DESTINO", estado, creadoPorId: creadorId,
        seccionOrigenId: secciones.origen ?? null, seccionDestinoId: secciones.destino ?? null,
      },
    });

  /** ¿Esta base tiene las políticas por sucursal? Cambia lo que se espera de la sección del OTRO lado. */
  async function hayPoliticasDeSucursal(): Promise<boolean> {
    const [fila] = await prismaAdmin.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_policies WHERE policyname = 'alcance_sucursal_select' AND tablename = 'Seccion'`;
    return Number(fila.n) > 0;
  }

  const nombres = (t: { seccionOrigen: { nombre: string } | null; seccionDestino: { nombre: string } | null }) => [t.seccionOrigen?.nombre ?? null, t.seccionDestino?.nombre ?? null];

  it("un traspaso ya aceptado (historial): cada lado ve su propia sección con nombre, y la del otro lado con nombre o como null según haya políticas, sin perder el traspaso", async () => {
    const conPoliticas = await hayPoliticasDeSucursal();
    const t = await traspaso("ACEPTADA", { origen: seccionAId, destino: seccionBId });

    await comoA();
    const filaDeA = (await obtenerBandejaTransferencias(sucursalAId)).historial.find((x) => x.id === t.id);
    expect(filaDeA, "A ve el traspaso en su historial").toBeDefined();
    expect(nombres(filaDeA!)).toEqual(["Depósito A", conPoliticas ? null : "Depósito B"]);

    await comoB();
    const filaDeB = (await obtenerBandejaTransferencias(sucursalBId)).historial.find((x) => x.id === t.id);
    expect(filaDeB, "B ve el traspaso en su historial").toBeDefined();
    expect(nombres(filaDeB!)).toEqual([conPoliticas ? null : "Depósito A", "Depósito B"]);
  });

  it("un envío en tránsito: el destino ve la sección de origen (o null si no la puede ver) y su propia sección todavía vacía; el nombre de la otra sucursal sigue viniendo", async () => {
    const conPoliticas = await hayPoliticasDeSucursal();
    const t = await traspaso("ENVIADA", { origen: seccionAId });

    await comoA();
    const filaDeA = (await obtenerBandejaTransferencias(sucursalAId)).esperando.find((x) => x.id === t.id);
    expect(filaDeA, "A lo tiene esperando").toBeDefined();
    expect(nombres(filaDeA!)).toEqual(["Depósito A", null]);
    expect(filaDeA!.destinoSucursal.nombre).toBe("Sucursal B");

    await comoB();
    const filaDeB = (await obtenerBandejaTransferencias(sucursalBId)).paraAceptar.find((x) => x.id === t.id);
    expect(filaDeB, "B tiene algo para aceptar").toBeDefined();
    expect(nombres(filaDeB!)).toEqual([conPoliticas ? null : "Depósito A", null]);
    expect(filaDeB!.origenSucursal.nombre).toBe("Central");
  });
});

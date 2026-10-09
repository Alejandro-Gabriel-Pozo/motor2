import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarCompraDeKardex, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { DIA_MS, enElPasado } from "../setup/tiempo";
import ConteoFrecuenciaPage from "../../src/app/(app)/stock/conteo-frecuencia/page";
import { sugerirInsumosClaseA } from "../../src/server/consultas/stock/sugerencia-clase-a";

/**
 * S-13 (plan de endurecimiento de seguridad, tanda T7; B-A2 del informe B). «Frecuencia de conteo» sugiere agendar los insumos que concentran el 80 % de lo COMPRADO en los últimos
 * 30 días, y junto a cada nombre dibujaba el IMPORTE comprado («Carne ($987.654)»). La pantalla la abre quien tiene `conteo_frecuencia` (piso operario, semilla admin y operador),
 * pero el gasto en compras por insumo es dato del reporte «Compras registradas» (`reporte_compras`, piso administrador): un operario con la clave del conteo veía lo que no
 * podría ver en ese reporte. Método del dueño (denegar por defecto, en el último punto donde se decide): la CONSULTA devuelve el importe solo si se lo pide con
 * `conImportes: true`, y la página lo pide solo con `reporte_compras`. Sin la clave la sugerencia sigue (nombre y enlace «Agendar semanal»), sin dinero.
 */
describe("S-13: el gasto en compras por insumo de Frecuencia de conteo es de quien tiene reporte_compras", () => {
  const IMPORTE = 987654;
  let sucursalId: string;
  let adminId: string;
  let operadorId: string;
  let carneId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });

  /** Todos los textos y números que el árbol de la página lleva en sus props y sus hijos (lo que se dibuja y lo que viaja a los componentes de cliente). */
  function textosDe(nodo: unknown, salida: string[] = []): string[] {
    if (nodo === null || nodo === undefined || typeof nodo === "boolean" || typeof nodo === "function") return salida;
    if (typeof nodo === "string" || typeof nodo === "number") {
      salida.push(String(nodo));
      return salida;
    }
    if (Array.isArray(nodo)) {
      nodo.forEach((n) => textosDe(n, salida));
      return salida;
    }
    if (typeof nodo === "object") {
      const props = "props" in nodo ? (nodo as ReactElement<Record<string, unknown>>).props : (nodo as Record<string, unknown>);
      for (const valor of Object.values(props)) textosDe(valor, salida);
    }
    return salida;
  }

  const pagina = async (searchParams: Record<string, string> = {}) => textosDe(await ConteoFrecuenciaPage({ searchParams: Promise.resolve(searchParams) })).join(" | ");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    const seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    carneId = (await sembrarProductoDisponible({ codigo: "MP_CARNE", nombre: "Carne vacuna", tipo: "MP", unidadStockId: catalogo.kg.id }, sucursalId)).id;
    const proveedorId = (await prisma.proveedor.create({ data: { codigo: "PROV_C", nombre: "Frigorífico" } })).id;
    await sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId: adminId, productoId: carneId, proveedorId, fecha: enElPasado(3 * DIA_MS).toISOString(), precioPorUnidadStock: IMPORTE });
    await como(operadorId, "operador@test.com");
  });

  describe("la pantalla", () => {
    it("EL ATAQUE: un rol con conteo_frecuencia y sin reporte_compras no recibe el importe comprado (antes: «Carne vacuna ($987.654)»)", async () => {
      const textos = await pagina();
      expect(textos).toContain("Carne vacuna");
      expect(textos).not.toMatch(/987\.?654/);
      expect(textos).not.toContain("$");
    });

    it("sin la clave la sugerencia sigue: el nombre y el enlace para agendar el conteo", async () => {
      const textos = await pagina();
      expect(textos).toContain("Carne vacuna");
      expect(textos).toContain(`/stock/conteo-frecuencia?sugerido=${carneId}`);
    });

    it("el enlace del producto elegido (?sugerido=) pre-marca el formulario sin llevar el gasto", async () => {
      const textos = await pagina({ sugerido: carneId });
      expect(textos).toContain("Carne vacuna");
      expect(textos).not.toMatch(/987\.?654/);
    });

    it("control: el administrador (que tiene reporte_compras) ve el importe como siempre", async () => {
      await como(adminId, "admin@test.com");
      const textos = await pagina();
      expect(textos).toContain("Carne vacuna");
      expect(textos).toMatch(/987\.?654/);
    });
  });

  describe("la consulta niega por defecto", () => {
    const desde = enElPasado(10 * DIA_MS);
    const hasta = enElPasado(1 * DIA_MS);

    it("sin pedir los importes devuelve solo el producto y el nombre: ni importe ni porcentaje acumulado", async () => {
      const filas = await sugerirInsumosClaseA(sucursalId, desde, hasta, prisma);
      expect(filas).toEqual([{ productoId: carneId, nombre: "Carne vacuna" }]);
      expect(JSON.stringify(filas)).not.toMatch(/987654|importe|porcentaje/);
    });

    it("con conImportes: true devuelve el gasto y el porcentaje acumulado", async () => {
      const filas = await sugerirInsumosClaseA(sucursalId, desde, hasta, prisma, { conImportes: true });
      expect(filas).toEqual([{ productoId: carneId, nombre: "Carne vacuna", importe: IMPORTE, porcentajeAcumulado: 100 }]);
    });
  });
});

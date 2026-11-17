import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { ModulosDeEmpresaError } from "../../src/core/features/empresa/cambio-de-modulos";
import { cambiarModulosDeEmpresa } from "../../src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa";
import type { AutorDeCambioDePlataforma } from "../../src/server/operaciones-de-plataforma/auditar-cambio-de-plataforma";
import { cambiarModulosDesdeLaConsola } from "../../plataforma/src/servidor/modulos";
import { EMPRESA_DE_PRUEBA_ID } from "../setup/empresa-de-prueba";
import { HAY_ROL_DE_PLATAFORMA, plataformaReal } from "../setup/cliente-plataforma-real";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import {
  actualizarModulo, conexionDeLaApp, conexionDelQueApaga, estadoDelModulo, fijarModuloSaltandoLaGuarda, insertarParte, MODULO, nuevaCabecera, sembrarMundo, sembrarPartes, SLUG_DE_LA_EMPRESA_DE_PRUEBA, type DondeEstan, type EstadoDeLasPartes, type Mundo,
} from "../setup/guarda-de-apagado";
import { dimensionesDeLaGuarda, filasDeApagado, filasDeCarga, productoCartesiano } from "../setup/oraculo-compras-guarda-de-apagado";

/**
 * Regla «Combinaciones» del dueño (AGENTS.md, 2026-10-28): recorre TODAS las combinaciones de la guarda de apagado de la recepción separada contra la tabla escrita aparte (`docs/oraculo-combinaciones-compras-guarda-de-apagado-2026-11-17.md`),
 * ejecutando de verdad contra Postgres: la consola (con el rol real `motor2_plataforma` si la base de test lo tiene), el script de emergencia y un UPDATE directo, con el resultado, el estado final del módulo y el rastro de auditoría. Y la otra mitad:
 * el INSERT de una parte pendiente o recibida con el módulo ACTIVO, INACTIVO o sin fila. El guardián `combinaciones-compras-guarda-de-apagado-declaradas.test.ts` falla si aparece una dimensión nueva sin declarar.
 */
afterAll(async () => {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await limpiarBaseDeTest();
  await plataformaReal.$disconnect();
  await prismaAdmin.$disconnect();
});

const AUTOR: AutorDeCambioDePlataforma = { adminId: "admin-combinaciones", adminEmail: "operador@plataforma.com", instalacionId: "principal", instalacionNombre: "principal" };
const AUTOR_CONSOLA = { adminId: AUTOR.adminId, adminEmail: AUTOR.adminEmail, instalacionId: "principal" };
const dbDeLaVia = () => (HAY_ROL_DE_PLATAFORMA ? plataformaReal : prismaAdmin);
const RASTRO: Record<string, string[]> = { DESACTIVADO: ["modulo-desactivado"], ACTIVADO: ["modulo-activado"], RECHAZADO: ["modulo-desactivar-rechazado"], NINGUNO: [] };

let m: Mundo;
const abiertos: Client[] = [];
beforeEach(async () => {
  await limpiarBaseDeTest();
  m = await sembrarMundo();
});
afterEach(async () => {
  await Promise.all(abiertos.splice(0).map((c) => c.end().catch(() => undefined)));
});

describe("el oráculo cubre el producto cartesiano de sus dimensiones, sin faltas ni repetidos", () => {
  it("apagar: V × P × L × A", () => {
    const d = dimensionesDeLaGuarda();
    const esperadas = productoCartesiano({ V: d["V"]!, P: d["P"]!, L: d["L"]!, A: d["A"]! }).map((f) => `${f["V"]}|${f["P"]}|${f["L"]}|${f["A"]}`).sort();
    expect(filasDeApagado().map((f) => `${f.V}|${f.P}|${f.L}|${f.A}`).sort()).toEqual(esperadas);
    expect(esperadas).toHaveLength(48);
  });
  it("cargar: módulo × estado de la parte", () => {
    expect(filasDeCarga().map((f) => `${f["Módulo de la empresa"]}|${f["Estado de la parte que se inserta"]}`).sort()).toEqual(
      productoCartesiano({ M: ["ACTIVO", "INACTIVO", "SIN_FILA"], E: ["PENDIENTE", "RECIBIDA"] }).map((f) => `${f["M"]}|${f["E"]}`).sort(),
    );
  });
});

describe("apagar o encender: cada fila del oráculo, contra la base real", () => {
  for (const fila of filasDeApagado()) {
    it(`${fila.V} · partes ${fila.P} · ${fila.L} · ${fila.A} → ${fila.Resultado} (rastro ${fila.Rastro})`, async () => {
      const apaga = fila.A === "DESACTIVAR";
      // El estado de partida: para apagar, la recepción encendida; para encender, apagada (con las partes ya cargadas: el estado que dejó el sistema antes de la guarda).
      await sembrarPartes(m, fila.P as EstadoDeLasPartes, fila.L as DondeEstan);
      if (!apaga) await fijarModuloSaltandoLaGuarda(EMPRESA_DE_PRUEBA_ID, "INACTIVO");
      await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
      const pedido = apaga ? { desactivar: [MODULO] } : { activar: [MODULO] };

      let resultado: "APLICA" | "RECHAZA_CON_PENDIENTES";
      let rechazoDeLaVia = "";
      if (fila.V === "CONSOLA") {
        const r = await cambiarModulosDesdeLaConsola(dbDeLaVia(), AUTOR_CONSOLA, EMPRESA_DE_PRUEBA_ID, pedido);
        resultado = r.ok ? "APLICA" : "RECHAZA_CON_PENDIENTES";
        if (!r.ok) rechazoDeLaVia = r.mensaje;
      } else if (fila.V === "SCRIPT") {
        try {
          await cambiarModulosDeEmpresa(dbDeLaVia(), { slug: SLUG_DE_LA_EMPRESA_DE_PRUEBA, ...pedido }, AUTOR);
          resultado = "APLICA";
        } catch (error) {
          expect(error, "el script rechaza con su error de negocio, no con una excepción cruda").toBeInstanceOf(ModulosDeEmpresaError);
          resultado = "RECHAZA_CON_PENDIENTES";
          rechazoDeLaVia = (error as Error).message;
        }
      } else {
        const c = await conexionDelQueApaga();
        abiertos.push(c);
        const r = await actualizarModulo(c, EMPRESA_DE_PRUEBA_ID, apaga ? "INACTIVO" : "ACTIVO");
        resultado = r.ok ? "APLICA" : "RECHAZA_CON_PENDIENTES";
        if (!r.ok) {
          expect(r).toMatchObject({ codigo: "23514", restriccion: "ModuloEmpresa_recepcion_pendientes_chk" });
          rechazoDeLaVia = r.mensaje;
        }
      }

      expect(resultado).toBe(fila.Resultado);
      if (resultado === "RECHAZA_CON_PENDIENTES") {
        expect(rechazoDeLaVia, "el rechazo dice cuántas compras y de qué sucursal").toMatch(fila.V === "UPDATE_DIRECTO" ? /^GUARDA_APAGADO_RECEPCION\|1\|Norte$/ : /hay 1 compra\(s\) pendientes de recibir \(sucursales: Norte\)/);
      }
      // El estado final: lo pedido si aplica; si se rechazó, el módulo sigue encendido (nada cambió).
      expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe(resultado === "APLICA" ? (apaga ? "INACTIVO" : "ACTIVO") : "ACTIVO");
      expect((await prismaAdmin.auditoriaPlataforma.findMany({ orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).map((f) => f.accion)).toEqual(RASTRO[fila.Rastro]);
    });
  }
});

describe("cargar una parte: cada fila del oráculo, contra la base real (como motor2_app)", () => {
  for (const fila of filasDeCarga()) {
    const modulo = fila["Módulo de la empresa"];
    const estado = fila["Estado de la parte que se inserta"] as "PENDIENTE" | "RECIBIDA";
    it(`módulo ${modulo} · parte ${estado} → ${fila.Resultado}`, async () => {
      if (modulo === "SIN_FILA") await prismaAdmin.moduloEmpresa.deleteMany({ where: { empresaId: EMPRESA_DE_PRUEBA_ID, modulo: MODULO } });
      else await fijarModuloSaltandoLaGuarda(EMPRESA_DE_PRUEBA_ID, modulo === "ACTIVO" ? "ACTIVO" : "INACTIVO");
      const app = await conexionDeLaApp(m.e);
      abiertos.push(app);
      const factura = await nuevaCabecera(m, "0010-00000001");
      const intento = insertarParte(app, m, factura, estado);
      if (fila.Resultado === "ACEPTA") {
        await intento;
        expect(await prismaAdmin.facturaProveedorSucursal.count({ where: { facturaProveedorId: factura } })).toBe(1);
      } else {
        await expect(intento).rejects.toMatchObject({ code: "23514", constraint: "FacturaProveedorSucursal_modulo_recepcion_chk" });
        expect(await prismaAdmin.facturaProveedorSucursal.count({ where: { facturaProveedorId: factura } })).toBe(0);
      }
    });
  }
});

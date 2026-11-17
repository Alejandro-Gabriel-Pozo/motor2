import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { CUENTAS_ADMITIDAS, TIPOS_DE_CUENTA as TIPOS_DE_CUENTA_DEL_CODIGO, TIPOS_DE_MEDIO as TIPOS_DE_MEDIO_DEL_CODIGO } from "../../src/core/caja/public";
import { entrarComo, sembrarSalon } from "../pos/salon-fixture";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { crearApoyo, cuentasEscritas, type Renglon, type Salon } from "./apoyo-cuenta-por-defecto";
import { quitarIndiceDeUnaActiva, restituirIndiceDeUnaActiva } from "./indice-una-activa";
import {
  ALCANCES,
  CANTIDADES_DE_COMPATIBLES,
  CUENTAS_QUE_ADMITE,
  LO_QUE_TRAE,
  TIPOS_DE_CUENTA,
  TIPOS_DE_MEDIO,
  esperado,
  existeLaCombinacion,
  tipoDeCuentaCompatible,
  tipoDeCuentaIncompatible,
  type Tipo,
} from "./oraculo-de-cuenta-por-defecto";

/**
 * ORÁCULO DE LA CUENTA POR DEFECTO DEL COBRO (etapa P-C3), contra Postgres real y el caso de uso `cobrarCuentaCasoDeUso`: tipo de medio (6) × cuentas activas compatibles en la sucursal (0, 1, 2) × la cuenta que trae el renglón
 * (ninguna, compatible, incompatible, de otra sucursal, inactiva) × alcance de lectura (normal, ancho) contra la tabla escrita aparte (`oraculo-de-cuenta-por-defecto.ts`). Cada combinación deja en la base, además, «distractores» que NO deben contar: una cuenta compatible
 * INACTIVA, una compatible ACTIVA de OTRA sucursal y una activa INCOMPATIBLE. Para armar «dos activas» en una sucursal se quita el índice C3b dentro de la prueba y se restituye SIEMPRE (`afterAll`).
 * El guardián falla si aparece un tipo de medio o de cuenta nuevo sin declarar en el oráculo.
 *
 * MUTACIONES (rojo/verde, hechas a mano sobre `src/core/caja/medios.ts` y `cargarCuentasActivasDeLaSucursal`, ver la sección «Construido» del diseño):
 *   - quitar el filtro de compatibilidad de `cuentaPorDefectoDelRenglon` → rojo (el distractor «activa incompatible» cuenta de más);
 *   - quitar `activa: true` de `cargarCuentasActivasDeLaSucursal` → rojo (el distractor «inactiva» cuenta de más);
 *   - asignar también con 2 o más (tomar la primera) → rojo («A_ELEGIR» esperado).
 */

describe("guardián: el oráculo declara todos los tipos del código", () => {
  it("los vocabularios y la compatibilidad coinciden", () => {
    expect([...TIPOS_DE_MEDIO_DEL_CODIGO].sort(), "un tipo de medio nuevo: declaralo en el oráculo (¿cambia dinero, permisos, visibilidad o stock?)").toEqual([...TIPOS_DE_MEDIO].sort());
    expect([...TIPOS_DE_CUENTA_DEL_CODIGO].sort(), "un tipo de cuenta nuevo: declaralo en el oráculo").toEqual([...TIPOS_DE_CUENTA].sort());
    for (const t of TIPOS_DE_MEDIO) expect([...CUENTAS_ADMITIDAS[t]].sort(), t).toEqual([...CUENTAS_QUE_ADMITE[t]].sort());
  });
});

describe("base real: el cobro con cuenta por defecto da lo que dice el oráculo", () => {
  let s: Salon;
  let sucursalBId: string;

  beforeAll(restituirIndiceDeUnaActiva);
  afterAll(restituirIndiceDeUnaActiva);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
    sucursalBId = (await prismaAdmin.sucursal.create({ data: { nombre: "Norte" } })).id;
  });

  it("cada (tipo de medio × compatibles activas × lo que trae el renglón)", async () => {
    const aps = { NORMAL: crearApoyo(s), ANCHA: crearApoyo(s, [s.sucursalId, sucursalBId]) };
    const ap = aps.NORMAL;
    expect((await ap.abrirCaja()).ok).toBe(true);
    const medios = {} as Record<Tipo, string>;
    for (const t of TIPOS_DE_MEDIO) medios[t] = await ap.medio(t);
    await quitarIndiceDeUnaActiva();
    let recorridas = 0;
    try {
      for (const tipo of TIPOS_DE_MEDIO) {
        for (const cantidad of CANTIDADES_DE_COMPATIBLES) {
          for (const trae of LO_QUE_TRAE) for (const alcance of ALCANCES) {
            if (!existeLaCombinacion(tipo, cantidad, trae)) continue;
            // Estado limpio: ninguna cuenta activa, y se arma lo de esta combinación.
            await prismaAdmin.cuentaDeCobro.updateMany({ data: { activa: false } });
            const tipoCompat = tipoDeCuentaCompatible(tipo);
            const compatibles: string[] = [];
            for (let i = 0; i < cantidad; i++) compatibles.push(await ap.cuentaDirecta(tipoCompat));
            const inactiva = await ap.cuentaDirecta(tipoCompat, { activa: false });
            const deOtraSucursal = await ap.cuentaDirecta(tipoCompat, { sucursalId: sucursalBId });
            const incompatibleTipo = tipoDeCuentaIncompatible(tipo);
            const incompatible = incompatibleTipo === null ? null : await ap.cuentaDirecta(incompatibleTipo);
            const etiqueta = `${tipo} · ${cantidad} compatibles · trae ${trae} · alcance ${alcance}`;

            let cuentaQueTrae: string | null = null;
            if (trae === "COMPATIBLE") cuentaQueTrae = compatibles[0] ?? (await ap.cuentaDirecta(tipoCompat));
            else if (trae === "INCOMPATIBLE") cuentaQueTrae = incompatible;
            else if (trae === "OTRA_SUCURSAL") cuentaQueTrae = deOtraSucursal;
            else if (trae === "INACTIVA") cuentaQueTrae = inactiva;

            const cuentaPos = await ap.cuentaCerrada();
            const renglon: Renglon = { medioDePagoId: medios[tipo], importeEnCentavos: BigInt(3000_00), ...(cuentaQueTrae === null ? {} : { cuentaDeCobroId: cuentaQueTrae }) };
            const r = await aps[alcance].cobrar(cuentaPos.id, [renglon]);
            const e = esperado(tipo, cantidad, trae, alcance);
            if (e.resultado === "OK") {
              expect(r, etiqueta).toMatchObject({ ok: true, datos: { yaExistia: false } });
              const final = e.cuenta === "NINGUNA" ? null : e.cuenta === "LA_UNICA" ? compatibles[0] : cuentaQueTrae;
              const escritas = await cuentasEscritas(cuentaPos.id);
              expect(escritas, etiqueta).toEqual({ enCobro: [final], enMovimiento: [final] });
            } else {
              expect(r, etiqueta).toMatchObject({ ok: false, codigo: e.resultado });
              // Nada escrito: ni cobranza (con su clave de reintento) ni movimientos.
              expect(await prismaAdmin.cobranza.count({ where: { cuentaId: cuentaPos.id } }), etiqueta).toBe(0);
            }
            recorridas += 1;
          }
        }
      }
    } finally {
      await restituirIndiceDeUnaActiva();
    }
    expect(recorridas).toBeGreaterThan(120);
  }, 600_000);
});

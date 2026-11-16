import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { CUENTAS_ADMITIDAS, DATOS_ADMITIDOS_POR_MEDIO, DATOS_DEL_COBRO, TIPOS_DE_CUENTA, TIPOS_DE_MEDIO, validarDatosDelCobro, validarDatosQuePide, validarParDeCobro } from "../../src/core/caja/public";
import type { DatoDelCobro, DatosDelCobro, TipoDeCuenta, TipoDeMedio } from "../../src/core/caja/public";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import {
  COLUMNAS_DECLARADAS,
  CUENTAS_QUE_ADMITE,
  DATOS,
  DATOS_QUE_PUEDE_PEDIR,
  ESTADOS_DE_CUENTA,
  TIPOS_DE_CUENTA as CUENTAS,
  TIPOS_DE_MEDIO as TIPOS,
  cuentaIncompatibleDe,
  esperadoDeUnRenglon,
  existeLaCombinacion,
  subconjuntos,
  type Dato,
  type Esperado,
  type Tipo,
} from "./oraculo-de-combinaciones-del-cobro";

/**
 * ORÁCULO DE COMBINACIONES DEL COBRO (etapa C3): recorre TODAS las combinaciones de tipo de medio × datos pedidos × datos mandados × cuenta de cobro contra la tabla escrita aparte
 * (`oraculo-de-combinaciones-del-cobro.ts`), primero sobre el núcleo puro (exhaustivo: 6 × los pedidos que el techo permite × 32 × 5) y después sobre la base real (los disparadores, en una transacción que se revierte).
 * El guardián de dimensiones falla si aparece una columna de `MedioDePago`, `Cobro` o `CuentaDeCobro` sin declarar si afecta o no.
 */

const VALOR_VALIDO: Record<Dato, string | number> = { cupon: "A123", ultimos4: "1234", marca: "(se pone con el id real)", cuotas: 3, dni: "12345678" };
const CAMPO: Record<Dato, keyof DatosDelCobro> = { cupon: "cupon", ultimos4: "ultimos4", marca: "marcaDeTarjetaId", cuotas: "cuotas", dni: "dni" };

function datosMandados(manda: readonly Dato[], marcaId: string): DatosDelCobro {
  return Object.fromEntries(manda.map((d) => [CAMPO[d], d === "marca" ? marcaId : VALOR_VALIDO[d]])) as DatosDelCobro;
}

/** Los pedidos posibles de un tipo: los subconjuntos de lo que el techo admite. */
const pedidosPosibles = (tipo: Tipo) => subconjuntos(DATOS_QUE_PUEDE_PEDIR[tipo]);

describe("las tablas del código son las del oráculo escrito aparte", () => {
  it("los vocabularios coinciden", () => {
    expect([...TIPOS_DE_MEDIO]).toEqual([...TIPOS]);
    expect([...TIPOS_DE_CUENTA]).toEqual([...CUENTAS]);
    expect([...DATOS_DEL_COBRO]).toEqual([...DATOS]);
  });
  it("qué cuentas admite cada medio y qué datos puede pedir", () => {
    for (const t of TIPOS) {
      expect([...CUENTAS_ADMITIDAS[t]].sort(), t).toEqual([...CUENTAS_QUE_ADMITE[t]].sort());
      expect([...DATOS_ADMITIDOS_POR_MEDIO[t]].sort(), t).toEqual([...DATOS_QUE_PUEDE_PEDIR[t]].sort());
    }
  });
});

describe("núcleo puro: recorrido EXHAUSTIVO contra el oráculo", () => {
  const SUCURSAL = "suc-a";
  const marcaId = randomUUID();

  it("cada combinación de medio × datos pedidos × datos mandados × cuenta da lo que dice la tabla", () => {
    let recorridas = 0;
    for (const tipo of TIPOS) {
      for (const pide of pedidosPosibles(tipo)) {
        for (const manda of subconjuntos(DATOS)) {
          for (const estado of ESTADOS_DE_CUENTA) {
            if (!existeLaCombinacion(tipo, estado)) continue;
            // La cuenta según su estado.
            const tipoDeCuenta: TipoDeCuenta | null =
              estado === "NINGUNA" ? null : estado === "INCOMPATIBLE" ? (cuentaIncompatibleDe(tipo) as TipoDeCuenta) : (CUENTAS_QUE_ADMITE[tipo][0] ?? "TERMINAL");
            const cuenta = tipoDeCuenta === null ? null : { tipo: tipoDeCuenta, activa: estado !== "INACTIVA", sucursalId: estado === "OTRA_SUCURSAL" ? "suc-b" : SUCURSAL };
            const par = validarParDeCobro({ medio: { tipo: tipo as TipoDeMedio, activo: true }, cuentaDeCobroId: cuenta ? "cuenta-1" : null, cuenta, sucursalDeLaCaja: SUCURSAL });
            const pideTodo = Object.fromEntries(DATOS.map((d) => [d, pide.includes(d)])) as Record<DatoDelCobro, boolean>;
            let obtenido: Esperado;
            if (!par.ok) obtenido = par.error as Esperado;
            else {
              const v = validarDatosDelCobro(datosMandados(manda, marcaId), pideTodo);
              obtenido = v.ok ? "OK" : (`${v.error.codigo}:${v.error.dato}` as Esperado);
            }
            expect(obtenido, `${tipo} pide[${pide}] manda[${manda}] cuenta ${estado}`).toBe(esperadoDeUnRenglon(tipo, estado, pide, manda));
            recorridas += 1;
          }
        }
      }
    }
    expect(recorridas).toBeGreaterThan(2000);
  });

  it("el techo por tipo: pedir un dato que el tipo no admite se rechaza y nombra el primero", () => {
    for (const tipo of TIPOS) {
      for (const pide of subconjuntos(DATOS)) {
        const sobrante = DATOS.find((d) => pide.includes(d) && !DATOS_QUE_PUEDE_PEDIR[tipo].includes(d));
        const r = validarDatosQuePide(tipo, Object.fromEntries(DATOS.map((d) => [d, pide.includes(d)])) as Record<DatoDelCobro, boolean>);
        expect(r.ok, `${tipo} pide[${pide}]`).toBe(sobrante === undefined);
        if (!r.ok) expect(r.dato).toBe(sobrante);
      }
    }
  });
});

describe("guardián de dimensiones: toda columna está declarada", () => {
  const esquema = readFileSync("prisma/schema.prisma", "utf8");
  const ESCALARES = new Set(["String", "Int", "Boolean", "DateTime", "Decimal", "BigInt", "Float", "Json", "Bytes"]);

  function columnasDe(modelo: string): string[] {
    const cuerpo = new RegExp(`^model ${modelo} \\{([\\s\\S]*?)^\\}`, "m").exec(esquema)?.[1] ?? "";
    return cuerpo
      .split("\n")
      .map((l) => /^\s{2}(\w+)\s+(\w+)(\[\])?\??/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null && ESCALARES.has(m[2]) && !m[3])
      .map((m) => m[1]);
  }

  it.each(["MedioDePago", "Cobro", "CuentaDeCobro"] as const)("%s: ninguna columna del esquema falta en la declaración, ni sobra", (modelo) => {
    const delEsquema = columnasDe(modelo).sort();
    expect(delEsquema.length).toBeGreaterThan(5);
    expect(delEsquema, `una columna nueva de ${modelo}: declarala en COLUMNAS_DECLARADAS (¿afecta dinero, permisos, visibilidad o stock?)`).toEqual(Object.keys(COLUMNAS_DECLARADAS[modelo]).sort());
  });

  it("toda columna pide* de MedioDePago es un dato declarado del cobro, y al revés", () => {
    const pide = columnasDe("MedioDePago").filter((c) => c.startsWith("pide")).map((c) => c.slice(4).toLowerCase());
    const mapa: Record<string, string> = { cupon: "cupon", ultimos4: "ultimos4", marca: "marca", cuotas: "cuotas", dni: "dni" };
    expect(pide.sort()).toEqual(Object.values(mapa).sort());
    expect(pide.sort()).toEqual([...DATOS].sort());
  });
});

describe("base real: los disparadores dan lo mismo que el oráculo", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let sesionId: string;
  let cuentaPosId: string;
  let sucursalBId: string;
  let marcaId: string;
  let medios: Record<Tipo, string>;
  let cuentas: { ok: Record<Tipo, string | null>; inactiva: Record<Tipo, string | null>; otraSucursal: Record<Tipo, string | null>; incompatible: Record<Tipo, string | null> };

  class Revertir extends Error {}

  beforeAll(async () => {
    marcaId = (await prismaAdmin.valorDeLista.findFirstOrThrow({ where: { lista: "MARCAS_DE_TARJETA", nombre: "Visa" } })).id;
  });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
    sucursalBId = (await prismaAdmin.sucursal.create({ data: { nombre: "Norte" } })).id;
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    cuentaPosId = cuenta.id;
    const caja = await prismaAdmin.caja.create({ data: { id: randomUUID(), sucursalId: s.sucursalId, nombre: "Caja 1" } });
    sesionId = randomUUID();
    // C2: la sesión cuelga de la jornada ABIERTA de su sucursal y su fecha de negocio sale de `abiertaEn` (15:00Z = 12:00 en Argentina).
    await prismaAdmin.jornadaDeSucursal.create({ data: { id: randomUUID(), sucursalId: s.sucursalId, fechaDeNegocio: new Date("2026-01-15") } });
    await prismaAdmin.sesionCaja.create({ data: { id: sesionId, sucursalId: s.sucursalId, cajaId: caja.id, estado: "ABIERTA", fechaDeNegocio: new Date("2026-01-15"), abiertaEn: new Date("2026-01-15T15:00:00Z"), zonaHoraria: "America/Argentina/Buenos_Aires", abiertaPorId: s.admin.id, claveIdempotencia: randomUUID(), huella: "a".repeat(64) } });
    medios = {} as Record<Tipo, string>;
    for (const t of TIPOS) medios[t] = (await prismaAdmin.medioDePago.create({ data: { id: randomUUID(), tipo: t } })).id;
    const crear = async (tipo: TipoDeCuenta, opciones: { activa?: boolean; sucursalId?: string }) =>
      (await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), sucursalId: opciones.sucursalId ?? s.sucursalId, tipo, nombre: `${tipo} ${randomUUID().slice(0, 8)}`, activa: opciones.activa ?? true } })).id;
    const vacio = () => Object.fromEntries(TIPOS.map((t) => [t, null])) as Record<Tipo, string | null>;
    cuentas = { ok: vacio(), inactiva: vacio(), otraSucursal: vacio(), incompatible: vacio() };
    for (const t of TIPOS) {
      const admitido = CUENTAS_QUE_ADMITE[t][0] ?? CUENTAS_QUE_ADMITE.QR[0];
      cuentas.ok[t] = await crear(admitido, {});
      cuentas.inactiva[t] = await crear(admitido, { activa: false });
      cuentas.otraSucursal[t] = await crear(admitido, { sucursalId: sucursalBId });
      const inc = t === "EFECTIVO" ? null : cuentaIncompatibleDe(t);
      cuentas.incompatible[t] = inc === null ? null : await crear(inc, {});
    }
  });

  const MENSAJE_DE_LA_BASE: Record<string, string> = {
    CUENTA_DE_COBRO_NO_ADMITIDA: "movimiento_caja_cuenta_no_admitida",
    CUENTA_DE_COBRO_DE_OTRA_SUCURSAL: "movimiento_caja_cuenta_de_otra_sucursal",
    CUENTA_DE_COBRO_INACTIVA: "movimiento_caja_cuenta_inactiva",
    CUENTA_DE_COBRO_INCOMPATIBLE: "movimiento_caja_cuenta_incompatible",
    DATO_DE_COBRO_NO_HABILITADO: "cobro_dato_no_habilitado",
  };

  /** Inserta cobranza + movimiento + cobro en una transacción que SIEMPRE se revierte y devuelve el mensaje del rechazo de la base, o «OK». */
  async function intentar(tipo: Tipo, cuentaId: string | null, manda: readonly Dato[]): Promise<string> {
    const cobranzaId = randomUUID();
    const movimientoId = randomUUID();
    try {
      await prismaAdmin.$transaction(async (tx) => {
        await tx.cobranza.create({ data: { id: cobranzaId, sucursalId: s.sucursalId, cuentaId: cuentaPosId, sesionId, total: "1.00", claveIdempotencia: randomUUID(), huella: "a".repeat(64), creadoPorId: s.admin.id } });
        await tx.movimientoCaja.create({ data: { id: movimientoId, sucursalId: s.sucursalId, sesionId, clase: "COBRO", medioDePagoId: medios[tipo], cuentaDeCobroId: cuentaId, importe: "1.00", creadoPorId: s.admin.id } });
        const d = datosMandados(manda, marcaId);
        await tx.cobro.create({ data: { id: randomUUID(), sucursalId: s.sucursalId, cobranzaId, orden: 1, medioDePagoId: medios[tipo], movimientoId, cuentaDeCobroId: cuentaId, importe: "1.00", cupon: d.cupon ?? null, ultimos4: d.ultimos4 ?? null, marcaDeTarjetaId: d.marcaDeTarjetaId ?? null, cuotas: d.cuotas ?? null, dni: d.dni ?? null } });
        throw new Revertir();
      });
    } catch (e) {
      if (e instanceof Revertir) return "OK";
      return String((e as Error).message);
    }
    return "OK";
  }

  it("cada (tipo × cuenta × lo pedido × lo mandado) se comporta como el oráculo", async () => {
    let recorridas = 0;
    for (const tipo of TIPOS) {
      const todoLoPedible = DATOS_QUE_PUEDE_PEDIR[tipo];
      for (const pide of [[], [...todoLoPedible]] as Dato[][]) {
        await prismaAdmin.medioDePago.update({ where: { id: medios[tipo] }, data: { pideCupon: pide.includes("cupon"), pideUltimos4: pide.includes("ultimos4"), pideMarca: pide.includes("marca"), pideCuotas: pide.includes("cuotas"), pideDni: pide.includes("dni") } });
        for (const manda of [[], ...DATOS.map((d) => [d]), [...DATOS]] as Dato[][]) {
          for (const estado of ESTADOS_DE_CUENTA) {
            if (!existeLaCombinacion(tipo, estado)) continue;
            // El efectivo no tiene cuentas propias: se prueba con las del QR para ver que no admite ninguna.
            const deQuien = tipo === "EFECTIVO" ? "QR" : tipo;
            const cuentaId = estado === "NINGUNA" ? null : estado === "COMPATIBLE" ? cuentas.ok[deQuien] : estado === "INACTIVA" ? cuentas.inactiva[deQuien] : estado === "OTRA_SUCURSAL" ? cuentas.otraSucursal[deQuien] : cuentas.incompatible[deQuien];
            const resultado = await intentar(tipo, cuentaId, manda);
            const esperado = esperadoDeUnRenglon(tipo, estado, pide, manda);
            const [codigo] = esperado.split(":");
            if (esperado === "OK") expect(resultado, `${tipo} pide[${pide}] manda[${manda}] ${estado}`).toBe("OK");
            else expect(resultado, `${tipo} pide[${pide}] manda[${manda}] ${estado}`).toContain(MENSAJE_DE_LA_BASE[codigo]);
            recorridas += 1;
          }
        }
      }
    }
    expect(recorridas).toBeGreaterThan(300);
  });

  it("el techo por tipo lo hace cumplir la base: pedir un dato fuera de la lista del tipo no entra, y lo permitido sí", async () => {
    for (const tipo of TIPOS) {
      for (const dato of DATOS) {
        const columna = { cupon: "pideCupon", ultimos4: "pideUltimos4", marca: "pideMarca", cuotas: "pideCuotas", dni: "pideDni" }[dato];
        const intento = prismaAdmin.medioDePago.update({ where: { id: medios[tipo] }, data: { [columna]: true } });
        if (DATOS_QUE_PUEDE_PEDIR[tipo].includes(dato)) await intento;
        else await expect(intento, `${tipo} no puede pedir ${dato}`).rejects.toThrow(/MedioDePago_datos_chk/);
        await prismaAdmin.medioDePago.update({ where: { id: medios[tipo] }, data: { [columna]: false } });
      }
    }
  });

  it("la función de compatibilidad de la base es la tabla del oráculo", async () => {
    for (const t of TIPOS) {
      for (const c of CUENTAS) {
        const [{ r }] = await prismaAdmin.$queryRaw<{ r: boolean }[]>`SELECT "CuentaDeCobro_admitida_por_medio"(${t}, ${c}) AS r`;
        expect(r, `${t} con ${c}`).toBe(CUENTAS_QUE_ADMITE[t].includes(c));
      }
    }
  });
});

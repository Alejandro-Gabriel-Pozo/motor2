import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarTemaSimpleCarta } from "../../src/server/actions/carta/tema";
import { limitadorMutaciones } from "../../src/server/actions/limitador-de-mutaciones";
import { MENSAJE_TEMA_SIMPLE_APAGADO } from "../../src/core/carta/tema-simple";
import { ALGO_AJENO_CARGADO, EXTREMOS, PALETAS_ESPERADAS, TODO_LO_AJENO_CARGADO } from "./tema-simple.oraculo";

/**
 * COMBINACIONES del guardado simple (regla del dueño, 2026-10-28; PASO A de «Apariencia y publicación»): color × valores ya cargados × interruptor × logo × marcador previo, contra la tabla de reglas esperadas de abajo, escrita aparte del
 * código (un oráculo legible). Exhaustivo: 10 colores × 3 × 2 × 2 × 3 = 360 combinaciones. El guardián de claves sin declarar está en `tema-simple.test.ts`.
 *
 * REGLAS ESPERADAS (el oráculo):
 *  R1. Interruptor apagado → siempre rechazado con el mensaje del interruptor, y la base queda exactamente como estaba.
 *  R2. Interruptor encendido → éxito; `color_marca` queda con el color ELEGIDO (nunca uno ajustado) y `marca_derivada` queda en «oscura» (cualquiera sea el marcador previo: ninguno, «si» u «oscura»).
 *  R3. Logo con → queda guardado tal cual; logo sin → la clave no queda.
 *  R4. Toda otra clave que había cargada (ninguna, algunas o todas) queda idéntica, y `aplicarEnCarta` no cambia.
 *
 * SEGUNDA TABLA (rubro, lugar y foto de portada; dueño, 2026-11-17): cada subconjunto de los tres pedidos (8) × si ya estaban cargados (2) × lo ajeno cargado (3) × marcador previo (3) × interruptor (2) = 288 combinaciones.
 *  R5. Apagado → rechazado y la base intacta (como R1). Encendido: cada uno de los tres que VIENE queda guardado tal cual; cada uno que NO viene se saca aunque estuviera cargado (vacío = default de la carta); lo ajeno y `aplicarEnCarta` quedan (R4).
 *  El guardián de dimensiones nuevas (una clave nueva del Tema sin declarar) está en `tema-simple.test.ts`.
 */
const COLORES = [...Object.values(PALETAS_ESPERADAS), "#ffffff", "#000000", EXTREMOS[2]!, EXTREMOS[4]!];
const CARGADOS = { ninguno: {}, algunos: ALGO_AJENO_CARGADO, todos: Object.fromEntries(Object.entries(TODO_LO_AJENO_CARGADO).filter(([k]) => k !== "marca_derivada")) } as const;
const MARCADORES = { ninguno: {}, si: { marca_derivada: "si" }, oscura: { marca_derivada: "oscura" } } as const;
const LOGO = "https://cdn.example.com/logo.png";

describe("combinaciones del guardado simple del tema", () => {
  let centralId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    // 360 guardados en una prueba pasan el tope de 300 por minuto del limitador (es del proceso, no de esta regla).
    vi.spyOn(limitadorMutaciones, "excedeLimite").mockReturnValue(false);
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  afterEach(() => {
    delete process.env.MOTOR2_PRUEBAS_TEMA_SIMPLE;
  });

  it("las 360 combinaciones cumplen R1 a R4", async () => {
    let corridas = 0;
    for (const color of COLORES) {
      for (const [cargado, ajenos] of Object.entries(CARGADOS)) {
        for (const encendido of [false, true]) {
          for (const conLogo of [false, true]) {
            for (const [marcador, valorMarcador] of Object.entries(MARCADORES)) {
              const etiqueta = `${color} · cargado ${cargado} · ${encendido ? "encendido" : "apagado"} · logo ${conLogo ? "con" : "sin"} · marcador ${marcador}`;
              if (encendido) process.env.MOTOR2_PRUEBAS_TEMA_SIMPLE = "si";
              else delete process.env.MOTOR2_PRUEBAS_TEMA_SIMPLE;
              await prisma.temaCartaSucursal.deleteMany();
              const previo = { ...ajenos, ...valorMarcador };
              await prisma.temaCartaSucursal.create({ data: { sucursalId: centralId, valores: previo, aplicarEnCarta: cargado !== "ninguno" } });
              const antes = (await prisma.temaCartaSucursal.findFirstOrThrow())!;

              const r = await guardarTemaSimpleCarta(centralId, { color_marca: color, ...(conLogo ? { restaurante_logo_url: LOGO } : {}) }, antes.actualizadoEn.toISOString());
              const despues = (await prisma.temaCartaSucursal.findFirstOrThrow())!;

              if (!encendido) {
                expect(r, `R1 ${etiqueta}`).toEqual({ ok: false, mensaje: MENSAJE_TEMA_SIMPLE_APAGADO });
                expect(despues, `R1 ${etiqueta}`).toEqual(antes);
              } else {
                expect(r.ok, `R2 ${etiqueta}`).toBe(true);
                const v = despues.valores as Record<string, unknown>;
                expect(v.color_marca, `R2 ${etiqueta}`).toBe(color);
                expect(v.marca_derivada, `R2 ${etiqueta}`).toBe("oscura");
                expect(v.restaurante_logo_url, `R3 ${etiqueta}`).toBe(conLogo ? LOGO : undefined);
                for (const [clave, valor] of Object.entries(ajenos)) expect(v[clave], `R4 ${etiqueta} ${clave}`).toBe(valor);
                expect(Object.keys(v).length, `R4 ${etiqueta}`).toBe(Object.keys(ajenos).length + 2 + (conLogo ? 1 : 0));
                expect(despues.aplicarEnCarta, `R4 ${etiqueta}`).toBe(antes.aplicarEnCarta);
              }
              corridas++;
            }
          }
        }
      }
    }
    expect(corridas).toBe(360);
  }, 120_000);

  it("las 288 combinaciones de rubro, lugar y foto cumplen R4 y R5", async () => {
    const PEDIBLES = { hero_etiqueta_superior: "Hotel y spa", restaurante_subtitulo: "Huinganco, Neuquén", hero_imagen_fondo_url: "https://cdn.example.com/portada.jpg" } as const;
    const YA_CARGADOS = { hero_etiqueta_superior: "Viejo rubro", restaurante_subtitulo: "Viejo lugar", hero_imagen_fondo_url: "https://cdn.example.com/vieja.jpg" } as const;
    const claves = Object.keys(PEDIBLES) as (keyof typeof PEDIBLES)[];
    let corridas = 0;
    for (let mascara = 0; mascara < 8; mascara++) {
      const pedido = Object.fromEntries(claves.filter((_, i) => mascara & (1 << i)).map((c) => [c, PEDIBLES[c]]));
      for (const yaCargados of [false, true]) {
        for (const [cargado, ajenos] of Object.entries(CARGADOS)) {
          for (const [marcador, valorMarcador] of Object.entries(MARCADORES)) {
            for (const encendido of [false, true]) {
              const etiqueta = `pedido ${mascara.toString(2).padStart(3, "0")} · ${yaCargados ? "ya cargados" : "sin cargar"} · cargado ${cargado} · marcador ${marcador} · ${encendido ? "encendido" : "apagado"}`;
              if (encendido) process.env.MOTOR2_PRUEBAS_TEMA_SIMPLE = "si";
              else delete process.env.MOTOR2_PRUEBAS_TEMA_SIMPLE;
              await prisma.temaCartaSucursal.deleteMany();
              const previo = { ...ajenos, ...valorMarcador, ...(yaCargados ? YA_CARGADOS : {}) };
              await prisma.temaCartaSucursal.create({ data: { sucursalId: centralId, valores: previo, aplicarEnCarta: cargado !== "ninguno" } });
              const antes = (await prisma.temaCartaSucursal.findFirstOrThrow())!;

              const r = await guardarTemaSimpleCarta(centralId, { color_marca: "#17562f", ...pedido }, antes.actualizadoEn.toISOString());
              const despues = (await prisma.temaCartaSucursal.findFirstOrThrow())!;

              if (!encendido) {
                expect(r, `R5 ${etiqueta}`).toEqual({ ok: false, mensaje: MENSAJE_TEMA_SIMPLE_APAGADO });
                expect(despues, `R5 ${etiqueta}`).toEqual(antes);
              } else {
                expect(r.ok, `R5 ${etiqueta}`).toBe(true);
                const v = despues.valores as Record<string, unknown>;
                for (const c of claves) expect(v[c], `R5 ${etiqueta} ${c}`).toBe(c in pedido ? PEDIBLES[c] : undefined);
                for (const [clave, valor] of Object.entries(ajenos)) expect(v[clave], `R4 ${etiqueta} ${clave}`).toBe(valor);
                expect(Object.keys(v).length, `R4 ${etiqueta}`).toBe(Object.keys(ajenos).length + 2 + Object.keys(pedido).length);
                expect(despues.aplicarEnCarta, `R4 ${etiqueta}`).toBe(antes.aplicarEnCarta);
              }
              corridas++;
            }
          }
        }
      }
    }
    expect(corridas).toBe(288);
  }, 120_000);
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarSalon } from "../pos/salon-fixture";
import { dbDeEmpresa } from "../../src/server/sesion/base";
import { resolverCartaPublica } from "../../src/server/lecturas/carta/publica";
import { cargarSelectorCartaPos } from "../../src/server/lecturas/pos/selector-carta";
import { cargarPromoCartaParaAgregar } from "../../src/server/lecturas/pos/promo-para-agregar";
import { diaDeCalendario, ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * MATRIZ DE VISIBILIDAD DE LAS PROMOS (pedido del dueño, 2026-10-28; docs/diseno-modulo-carta-2026-10-28.md): enfoque híbrido «declarar + generar».
 *  - DECLARAR: las REGLAS de abajo son el oráculo, escrito aparte del código y legible para el dueño («solo salón nunca sale en el público», …).
 *  - GENERAR: se enumeran TODAS las combinaciones de las dimensiones que deciden si una promo se ofrece y a quién, se siembra una promo por combinación (contra Postgres real) y se compara lo que
 *    devuelven los lectores reales —la carta pública (`resolverCartaPublica`) y el salón (el selector del POS y la promo para agregar a la cuenta)— con lo que dicen las reglas. Exhaustivo es barato.
 *  - GUARDIÁN: cada columna de `PromoCarta` y de `PromoCartaSucursal` está declarada como dimensión de la matriz, como dimensión PENDIENTE o como «no afecta la visibilidad», con su motivo. Una
 *    columna nueva sin declarar pone este test en rojo: quien la agrega tiene que decir si cambia a quién se le ofrece la promo (y, si cambia, sumarla a la matriz).
 *
 * Fuera de la matriz, la VIGENCIA (fechas «desde»/«hasta») y los DÍAS de la semana: RETIRADOS por decisión del dueño (2026-10-20: la promo se maneja con activar/desactivar; la pantalla ya no los
 * ofrece y las columnas se borrarán con una migración autorizada). Todas las promos de la matriz van sin vigencia. El hallazgo conocido (la carta pública ignora la vigencia que una promo traiga de antes) queda
 * DOCUMENTADO abajo con su evidencia, sin arreglar (por decisión del dueño no se arregla: la vigencia se retira).
 */

type Audiencia = "publico" | "salon";
type EstadoEnLaSucursal = "prendida" | "apagada" | "sin-fila";

interface Combinacion {
  audiencia: Audiencia;
  /** El módulo Promociones de la empresa (sin él, la carta pública y el POS no leen promos). */
  modulo: boolean;
  /** `PromoCarta.activa`: la promo de la EMPRESA. */
  activa: boolean;
  /** `PromoCartaSucursal`: la fila de esta sucursal, prendida, apagada o inexistente. */
  sucursal: EstadoEnLaSucursal;
  /** `PromoCarta.soloSalon`. */
  soloSalon: boolean;
  /** Si la promo tiene al menos un cupo de sección activo (sin cupos es «solo informativa»). */
  conCupo: boolean;
}

/** EL ORÁCULO: una promo se le ofrece a la audiencia si y solo si se cumplen TODAS estas reglas. */
const REGLAS: { id: string; regla: string; cumple: (c: Combinacion) => boolean }[] = [
  { id: "R1", regla: "Sin el módulo Promociones no se ofrece ninguna promo, a nadie.", cumple: (c) => c.modulo },
  { id: "R2", regla: "Una promo apagada en la empresa no se ofrece en ninguna sucursal.", cumple: (c) => c.activa },
  { id: "R3", regla: "Se ofrece en una sucursal solo si esa sucursal la tiene prendida (sin fila, o con la fila apagada, no).", cumple: (c) => c.sucursal === "prendida" },
  { id: "R4", regla: "Una promo «solo salón» nunca sale en la carta pública (web, QR ni impresa).", cumple: (c) => !(c.audiencia === "publico" && c.soloSalon) },
  { id: "R5", regla: "El salón solo ofrece una promo con al menos un cupo (sin cupos es solo informativa: el POS la ignora); la carta pública la muestra igual.", cumple: (c) => c.audiencia === "publico" || c.conCupo },
];
const seOfrece = (c: Combinacion) => REGLAS.every((r) => r.cumple(c));

/**
 * Las columnas de las dos tablas que deciden la visibilidad, cada una declarada. `matriz`: es una dimensión de la matriz; `retirada`: la promo ya no la usa por decisión del dueño (sigue en la base hasta
 * una migración destructiva autorizada; con NULL no decide nada); `no-afecta`: no cambia a quién se le ofrece la promo (con el motivo).
 */
type Declaracion = { tipo: "matriz" | "retirada" | "no-afecta"; motivo: string };
const COLUMNAS: Record<"PromoCarta" | "PromoCartaSucursal", Record<string, Declaracion>> = {
  PromoCarta: {
    id: { tipo: "no-afecta", motivo: "identidad" },
    empresaId: { tipo: "no-afecta", motivo: "aislamiento por empresa (RLS); lo prueban los tests de aislamiento, no esta matriz" },
    empresa: { tipo: "no-afecta", motivo: "relación de empresaId" },
    seccionCartaId: { tipo: "no-afecta", motivo: "dónde se ubica en la carta; una sección apagada esconde TODO lo suyo (regla de la sección, no de la promo)" },
    seccionCarta: { tipo: "no-afecta", motivo: "relación de seccionCartaId" },
    titulo: { tipo: "no-afecta", motivo: "texto" },
    descripcion: { tipo: "no-afecta", motivo: "texto" },
    precio: { tipo: "no-afecta", motivo: "dinero: cuánto cuesta, no si se ofrece" },
    orden: { tipo: "no-afecta", motivo: "orden dentro de la sección" },
    activa: { tipo: "matriz", motivo: "R2" },
    creadoEn: { tipo: "no-afecta", motivo: "registro" },
    vigenteDesde: { tipo: "retirada", motivo: "vigencia por fechas: retirada por decisión del dueño (2026-10-20: la promo se maneja con activar/desactivar); oculta en la pantalla; ver el hallazgo abajo" },
    vigenteHasta: { tipo: "retirada", motivo: "vigencia por fechas: retirada por decisión del dueño (2026-10-20); oculta en la pantalla; ver el hallazgo abajo" },
    diasDeSemana: { tipo: "retirada", motivo: "días de la semana: retirados por decisión del dueño (2026-10-20); ocultos en la pantalla" },
    version: { tipo: "no-afecta", motivo: "control optimista de la edición" },
    soloSalon: { tipo: "matriz", motivo: "R4" },
    cupos: { tipo: "matriz", motivo: "R5 (con o sin cupo de sección activo)" },
    instancias: { tipo: "no-afecta", motivo: "las promos ya vendidas en cuentas (historia)" },
    sucursales: { tipo: "matriz", motivo: "R3 (la fila de la sucursal)" },
  },
  PromoCartaSucursal: {
    id: { tipo: "no-afecta", motivo: "identidad" },
    empresaId: { tipo: "no-afecta", motivo: "aislamiento por empresa (RLS)" },
    empresa: { tipo: "no-afecta", motivo: "relación de empresaId" },
    promoCartaId: { tipo: "no-afecta", motivo: "a qué promo pertenece la fila" },
    promoCarta: { tipo: "no-afecta", motivo: "relación de promoCartaId" },
    sucursalId: { tipo: "matriz", motivo: "R3: que exista la fila de ESTA sucursal" },
    sucursal: { tipo: "no-afecta", motivo: "relación de sucursalId" },
    activa: { tipo: "matriz", motivo: "R3: la fila prendida" },
    precioLocal: { tipo: "no-afecta", motivo: "dinero: el precio en la sucursal, no si se ofrece" },
  },
};

/** Los campos de un modelo de `prisma/schema.prisma` (las líneas que empiezan con un nombre, sin los `@@` del modelo). */
function camposDelModelo(modelo: string): string[] {
  const esquema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8").replace(/\r\n/g, "\n");
  const bloque = esquema.match(new RegExp(`\\nmodel ${modelo} \\{\\n([\\s\\S]*?)\\n\\}`))?.[1];
  if (!bloque) throw new Error(`No se encontró el modelo ${modelo} en prisma/schema.prisma`);
  return bloque
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[a-zA-Z]/.test(l))
    .map((l) => l.split(/\s+/)[0]!);
}

describe("guardián: toda columna de las promos está declarada (dimensión, retirada o «no afecta la visibilidad»)", () => {
  it.each(["PromoCarta", "PromoCartaSucursal"] as const)("%s", (modelo) => {
    expect(camposDelModelo(modelo).sort(), `Declará cada columna nueva de ${modelo} en COLUMNAS (¿cambia a quién se le ofrece la promo?)`).toEqual(Object.keys(COLUMNAS[modelo]).sort());
  });

  it("lo retirado es exactamente la vigencia y los días de la semana (fuera de la matriz por decisión del dueño)", () => {
    const retiradas = Object.entries(COLUMNAS.PromoCarta).filter(([, d]) => d.tipo === "retirada").map(([c]) => c);
    expect(retiradas.sort()).toEqual(["diasDeSemana", "vigenteDesde", "vigenteHasta"]);
  });
});

/** Todas las combinaciones de la matriz: 2 audiencias × 2 (módulo) × 2 (activa) × 3 (fila de la sucursal) × 2 (solo salón) × 2 (cupo) = 96. */
function todasLasCombinaciones(): Combinacion[] {
  const salida: Combinacion[] = [];
  for (const audiencia of ["publico", "salon"] as const)
    for (const modulo of [true, false])
      for (const activa of [true, false])
        for (const sucursal of ["prendida", "apagada", "sin-fila"] as const)
          for (const soloSalon of [true, false])
            for (const conCupo of [true, false]) salida.push({ audiencia, modulo, activa, sucursal, soloSalon, conCupo });
  return salida;
}

const tituloDe = (c: Pick<Combinacion, "activa" | "sucursal" | "soloSalon" | "conCupo">) =>
  `M ${c.activa ? "activa" : "apagada"} · ${c.sucursal} · ${c.soloSalon ? "solo-salon" : "publica"} · ${c.conCupo ? "con-cupo" : "sin-cupo"}`;

describe("matriz de visibilidad de las promos (contra Postgres real)", () => {
  const empresa = { id: EMPRESA_POR_DEFECTO_ID, slug: "principal", nombre: "Principal" };
  const bases = { deLaEmpresa: dbDeEmpresa(empresa.id), deLaSucursal: (sucursalId: string) => dbDeEmpresa(empresa.id, { lectura: [sucursalId], escritura: [] }) };
  const dia = diaDeCalendario(AHORA_DE_LA_CORRIDA, ZONA_ARGENTINA);
  let sucursalId: string;
  const idPorTitulo = new Map<string, string>();

  beforeAll(async () => {
    await limpiarBaseDeTest();
    const s = await sembrarSalon();
    sucursalId = s.sucursalId;
    // Una sección con un plato (la que las promos usan de cupo) y otra donde viven las promos; la carta publicada en el portal.
    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
    const promos = await prisma.seccionCarta.create({ data: { nombre: "Promos", orden: 2 } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: s.milanesa.id, visibleEnCarta: true, seccionCartaId: platos.id } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug: "central", publicada: true } });
    for (const activa of [true, false])
      for (const sucursal of ["prendida", "apagada", "sin-fila"] as const)
        for (const soloSalon of [true, false])
          for (const conCupo of [true, false]) {
            const titulo = tituloDe({ activa, sucursal, soloSalon, conCupo });
            const fila = sucursal === "sin-fila" ? {} : { sucursales: { create: { sucursalId, activa: sucursal === "prendida" } } };
            const promo = await prisma.promoCarta.create({ data: { seccionCartaId: promos.id, titulo, precio: 15000, activa, soloSalon, ...fila } });
            if (conCupo) await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, seccionCartaId: platos.id, cantidadMinima: 1, cantidadMaxima: 1 } });
            idPorTitulo.set(titulo, promo.id);
          }
  });

  /** Lo que de verdad ofrece cada audiencia, con o sin el módulo: los títulos que devuelven los lectores reales. */
  async function ofrecidas(audiencia: Audiencia, modulo: boolean): Promise<Set<string>> {
    if (audiencia === "publico") {
      const carta = (await resolverCartaPublica(empresa, "central", bases, AHORA_DE_LA_CORRIDA, modulo))!.carta;
      return new Set(carta.secciones.flatMap((x) => x.promos.map((p) => p.titulo)));
    }
    const selector = await cargarSelectorCartaPos(sucursalId, prisma, AHORA_DE_LA_CORRIDA, undefined, { carta: true, promociones: modulo }, dia);
    return new Set(selector.seccionesCarta.flatMap((x) => x.entradas.flatMap((e) => (e.tipo === "promo" ? [e.titulo] : []))));
  }

  it("las 96 combinaciones: lo que ofrece cada lector es exactamente lo que dicen las reglas", async () => {
    const combinaciones = todasLasCombinaciones();
    expect(combinaciones).toHaveLength(96);
    const vistas = new Map<string, Set<string>>();
    for (const audiencia of ["publico", "salon"] as const) for (const modulo of [true, false]) vistas.set(`${audiencia}|${modulo}`, await ofrecidas(audiencia, modulo));
    const diferencias = combinaciones.flatMap((c) => {
      const esperado = seOfrece(c);
      const visto = vistas.get(`${c.audiencia}|${c.modulo}`)!.has(tituloDe(c));
      if (esperado === visto) return [];
      const rotas = REGLAS.filter((r) => !r.cumple(c)).map((r) => r.id);
      return [`${c.audiencia} · módulo ${c.modulo ? "sí" : "no"} · ${tituloDe(c)}: las reglas dicen ${esperado ? "SE OFRECE" : `NO se ofrece (${rotas.join(", ")})`}, el lector dice ${visto ? "se ofrece" : "no se ofrece"}`];
    });
    expect(diferencias).toEqual([]);
    // Ni de más ni de menos: cada lector ofrece solo promos de la matriz.
    for (const [clave, titulos] of vistas) for (const t of titulos) expect(idPorTitulo.has(t), `${clave}: ${t}`).toBe(true);
  });

  it("el salón: agregar la promo a la cuenta sigue las mismas reglas que el selector (con cupo)", async () => {
    for (const modulo of [true, false])
      for (const activa of [true, false])
        for (const sucursal of ["prendida", "apagada", "sin-fila"] as const)
          for (const soloSalon of [true, false]) {
            const c: Combinacion = { audiencia: "salon", modulo, activa, sucursal, soloSalon, conCupo: true };
            const promo = await cargarPromoCartaParaAgregar(sucursalId, idPorTitulo.get(tituloDe(c))!, prisma, AHORA_DE_LA_CORRIDA, { carta: true, promociones: modulo }, dia);
            expect(promo !== null, `agregar · módulo ${modulo ? "sí" : "no"} · ${tituloDe(c)}`).toBe(seOfrece(c));
          }
  });
});

describe("HALLAZGO documentado, SIN arreglar (decisión del dueño: la vigencia se retira, 2026-10-20): la carta pública ignora la vigencia que una promo traiga de antes", () => {
  const empresa = { id: EMPRESA_POR_DEFECTO_ID, slug: "principal", nombre: "Principal" };
  const bases = { deLaEmpresa: dbDeEmpresa(empresa.id), deLaSucursal: (sucursalId: string) => dbDeEmpresa(empresa.id, { lectura: [sucursalId], escritura: [] }) };

  it("una promo cuya vigencia ya terminó (hasta el 2020-01-01) SALE en la carta pública, mientras el POS ya no la ofrece", async () => {
    await limpiarBaseDeTest();
    const s = await sembrarSalon();
    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.milanesa.id, visibleEnCarta: true, seccionCartaId: platos.id } });
    await prisma.sucursalPublica.create({ data: { sucursalId: s.sucursalId, slug: "central", publicada: true } });
    // Una fecha PASADA (segura para siempre, test/setup/tiempo.ts): la promo terminó hace años.
    const promo = await prisma.promoCarta.create({
      data: { seccionCartaId: platos.id, titulo: "Promo vencida", precio: 15000, vigenteHasta: new Date("2020-01-01T00:00:00Z"), sucursales: { create: { sucursalId: s.sucursalId } } },
    });
    await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, seccionCartaId: platos.id, cantidadMinima: 1, cantidadMaxima: 1 } });
    const dia = diaDeCalendario(AHORA_DE_LA_CORRIDA, ZONA_ARGENTINA);

    const publica = (await resolverCartaPublica(empresa, "central", bases, AHORA_DE_LA_CORRIDA))!.carta;
    const selector = await cargarSelectorCartaPos(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA, undefined, { carta: true, promociones: true }, dia);

    // Evidencia: el cliente la ve (HOY, sin arreglo) …
    expect(publica.secciones.flatMap((x) => x.promos.map((p) => p.titulo))).toContain("Promo vencida");
    // … y el mozo no la puede vender.
    expect(selector.seccionesCarta.flatMap((x) => x.entradas.flatMap((e) => (e.tipo === "promo" ? [e.titulo] : [])))).not.toContain("Promo vencida");
    expect(await cargarPromoCartaParaAgregar(s.sucursalId, promo.id, prisma, AHORA_DE_LA_CORRIDA, { carta: true, promociones: true }, dia)).toBeNull();
  });
});

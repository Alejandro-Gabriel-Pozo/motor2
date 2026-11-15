import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { MENSAJE_GENERO_E_ITEM_AGRUPADO_APAGADO } from "../../src/core/carta/genero-e-item-agrupado";
import type { EntradaSelectorCarta, SelectorCartaPos } from "../../src/core/pos/selector-carta";
import {
  ACCIONES_DE_ESCRITURA,
  CAMPOS_AJENOS_QUE_APUNTAN,
  CAMPOS_DECLARADOS,
  DATOS,
  INTERRUPTOR,
  SUPERFICIES_DE_LECTURA,
  fueraDeCartaDelPos,
  opcionesDelAgrupadoEnLaCartaPublica,
  rechazadaPorElInterruptor,
  seccionesDeLaCartaPublica,
  seccionesDelPos,
  type AccionDeEscritura,
  type Interruptor,
} from "./genero-e-item-agrupado.oraculo";
import { fotoDeLaEstructura, sembrarCartaConGeneros } from "./genero-e-item-agrupado.semilla";

/**
 * COMBINACIONES de la poda de «género de carta» e «ítem agrupado» (2026-11-06): recorre TODAS las combinaciones interruptor × datos × superficie contra el ORÁCULO escrito aparte
 * (`genero-e-item-agrupado.oraculo.ts`; versión legible en `docs/oraculo-combinaciones-poda-genero-agrupado-2026-11-06.md`) contra Postgres real. Es exhaustivo: 2 × 2 × (2 lecturas + 9 acciones) = 44 casos.
 * Más los GUARDIANES: fallan si aparece una dimensión nueva sin declarar (una acción de escritura, una columna o relación de las tablas, un lector de esas tablas en `src/server`).
 */

const RAIZ = join(__dirname, "../..");

/** Carga los módulos con el interruptor en la posición pedida (el resto del módulo, tal cual) y con la sesión del administrador. */
async function conInterruptor(interruptor: Interruptor, usuario: { id: string; email: string }) {
  vi.resetModules();
  vi.doMock("../../src/core/carta/genero-e-item-agrupado", async (original) => ({
    ...(await original<typeof import("../../src/core/carta/genero-e-item-agrupado")>()),
    GENERO_E_ITEM_AGRUPADO_VISIBLE: interruptor === "encendido",
  }));
  const sesion = await import("../../src/server/sesion/session");
  vi.mocked(sesion.getUsuarioActual).mockResolvedValue({ id: usuario.id, email: usuario.email, nombre: null });
  return {
    menu: await import("../../src/server/lecturas/carta/menu"),
    selector: await import("../../src/server/lecturas/pos/selector-carta"),
    generos: await import("../../src/server/actions/carta/generos"),
    agrupados: await import("../../src/server/actions/carta/items-agrupados"),
    productos: await import("../../src/server/actions/catalogo/productos"),
    precioLocal: await import("../../src/server/actions/catalogo/precio-local"),
  };
}

const etiquetaPos = (e: EntradaSelectorCarta): string => {
  if (e.tipo === "producto") return e.producto.nombre;
  if (e.tipo === "agrupado") return `agrupado:${e.nombre}[${e.opciones.map((o) => o.nombre).sort().join(",")}]`;
  if (e.tipo === "carpeta") return `carpeta:${e.nombre}{${e.entradas.map(etiquetaPos).sort().join(",")}}`;
  return `promo:${e.titulo}`;
};
const seccionesPos = (sel: SelectorCartaPos) => Object.fromEntries(sel.seccionesCarta.filter((s) => ["Bebidas", "Postres"].includes(s.nombre)).map((s) => [s.nombre, s.entradas.map(etiquetaPos).sort()]));
const ordenado = (o: Record<string, string[]>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]));

describe("combinaciones: interruptor × datos × superficie contra el oráculo (contra Postgres)", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/carta/genero-e-item-agrupado");
    vi.resetModules();
  });

  for (const interruptor of INTERRUPTOR) {
    for (const datos of DATOS) {
      describe(`interruptor ${interruptor} · datos ${datos}`, () => {
        let semilla: Awaited<ReturnType<typeof sembrarCartaConGeneros>>;
        beforeEach(async () => {
          await limpiarBaseDeTest();
          semilla = await sembrarCartaConGeneros(datos === "con");
        });

        it("carta-publica: lo que ve el cliente es lo del oráculo", async () => {
          const { menu } = await conInterruptor(interruptor, semilla.admin);
          const carta = await menu.resolverMenuCarta(semilla.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
          const secciones = Object.fromEntries((carta?.secciones ?? []).map((s) => [s.nombre, s.items.map((i) => i.nombre).sort()]));
          expect(secciones).toEqual(ordenado(seccionesDeLaCartaPublica(interruptor, datos)));
          const cerveza = carta?.secciones.flatMap((s) => s.items).find((i) => i.nombre === "Cerveza");
          expect(cerveza?.opciones?.map((o) => o.nombre).sort() ?? null).toEqual(opcionesDelAgrupadoEnLaCartaPublica(interruptor, datos));
        });

        it("pos: el selector del mozo es el del oráculo (carpetas y agrupados, o la lista plana), sin errores", async () => {
          const { selector } = await conInterruptor(interruptor, semilla.admin);
          const sel = await selector.cargarSelectorCartaPos(semilla.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
          expect(seccionesPos(sel)).toEqual(ordenado(seccionesDelPos(interruptor, datos)));
          const sembrados = new Set(["Café", "Capuccino", "Cerveza Patagonia", "Cerveza Cordillera", "Brownie"]);
          expect(sel.fueraDeCarta.map((p) => p.nombre).filter((n) => sembrados.has(n)).sort()).toEqual([...fueraDeCartaDelPos(interruptor, datos)].sort());
        });

        const pedido = (accion: AccionDeEscritura, m: Awaited<ReturnType<typeof conInterruptor>>) => {
          const agrupadoId = semilla.agrupadoId ?? "no-existe";
          const opcionId = semilla.opcionPatagoniaId ?? "no-existe";
          const hermanos = [semilla.ids.patagonia, semilla.ids.cordillera];
          switch (accion) {
            case "guardarGeneroCarta": return m.generos.guardarGeneroCarta({ nombre: "Gaseosas" });
            case "actualizarActivoGeneroCarta": return m.generos.actualizarActivoGeneroCarta(semilla.generos?.agua ?? "no-existe", false);
            case "guardarItemAgrupadoCarta": return m.agrupados.guardarItemAgrupadoCarta({ nombre: "Otro agrupado", seccionCartaId: semilla.bebidas });
            case "actualizarActivoItemAgrupadoCarta": return m.agrupados.actualizarActivoItemAgrupadoCarta(agrupadoId, false);
            case "agregarOpcionItemAgrupadoCarta": return m.agrupados.agregarOpcionItemAgrupadoCarta(agrupadoId, semilla.ids.cafe);
            case "actualizarOrdenOpcionItemAgrupadoCarta": return m.agrupados.actualizarOrdenOpcionItemAgrupadoCarta(opcionId, 7);
            case "quitarOpcionItemAgrupadoCarta": return m.agrupados.quitarOpcionItemAgrupadoCarta(opcionId);
            case "sincronizarPrecioGrupoCarta": return m.productos.sincronizarPrecioGrupoCarta(hermanos, 15000, { [hermanos[0]]: 14000, [hermanos[1]]: 14000 });
            case "sincronizarPrecioLocalGrupoCarta": return m.precioLocal.sincronizarPrecioLocalGrupoCarta(semilla.sucursalId, hermanos, 15000, true, {});
          }
        };

        for (const accion of ACCIONES_DE_ESCRITURA) {
          it(`accion ${accion}: ${rechazadaPorElInterruptor(interruptor) ? "rechazada por el interruptor y sin cambios" : "no la rechaza el interruptor"}`, async () => {
            const m = await conInterruptor(interruptor, semilla.admin);
            const antes = await fotoDeLaEstructura();
            const r = await pedido(accion, m);
            if (rechazadaPorElInterruptor(interruptor)) {
              expect(r).toEqual({ ok: false, mensaje: MENSAJE_GENERO_E_ITEM_AGRUPADO_APAGADO });
              expect(await fotoDeLaEstructura()).toBe(antes);
              // Idempotencia: repetirla da lo mismo y tampoco cambia nada.
              expect(await pedido(accion, m)).toEqual(r);
              expect(await fotoDeLaEstructura()).toBe(antes);
            } else {
              expect(r.mensaje).not.toBe(MENSAJE_GENERO_E_ITEM_AGRUPADO_APAGADO);
            }
          });
        }
      });
    }
  }

  it("el recorrido es exhaustivo: 2 × 2 × (lecturas + acciones)", () => {
    expect(INTERRUPTOR).toHaveLength(2);
    expect(DATOS).toHaveLength(2);
    expect(SUPERFICIES_DE_LECTURA).toEqual(["carta-publica", "pos"]);
    expect(ACCIONES_DE_ESCRITURA).toHaveLength(9);
  });
});

describe("guardianes: una dimensión nueva sin declarar hace fallar", () => {
  const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");
  const exportadas = (ruta: string) => [...leer(ruta).matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);

  it("las acciones de escritura: las que exportan los dos archivos de carta están TODAS declaradas, y cada una (más las dos de igualar precio) rechaza con el interruptor apagado", () => {
    const deCarta = [...exportadas("src/server/actions/carta/generos.ts"), ...exportadas("src/server/actions/carta/items-agrupados.ts")].sort();
    expect(deCarta).toEqual(ACCIONES_DE_ESCRITURA.filter((a) => !a.startsWith("sincronizar")).sort());
    const archivoDe = (a: string) => (a.startsWith("sincronizarPrecioLocal") ? "src/server/actions/catalogo/precio-local.ts" : a.startsWith("sincronizar") ? "src/server/actions/catalogo/productos.ts" : /Genero/.test(a) ? "src/server/actions/carta/generos.ts" : "src/server/actions/carta/items-agrupados.ts");
    for (const accion of ACCIONES_DE_ESCRITURA) {
      const texto = leer(archivoDe(accion));
      const desde = texto.indexOf(`export async function ${accion}`);
      expect(desde, `${accion} existe`).toBeGreaterThanOrEqual(0);
      const hasta = texto.indexOf("\nexport ", desde + 10);
      const cuerpo = texto.slice(desde, hasta === -1 ? undefined : hasta);
      expect(cuerpo, `${accion} rechaza con el interruptor apagado`).toContain("if (!GENERO_E_ITEM_AGRUPADO_VISIBLE) return error(MENSAJE_GENERO_E_ITEM_AGRUPADO_APAGADO);");
    }
  });

  it("las columnas y relaciones de las tablas de la estructura están todas declaradas (una nueva exige decidir si el interruptor la afecta)", () => {
    const schema = leer("prisma/schema.prisma");
    const campos = (modelo: string) => {
      const m = schema.match(new RegExp(`^model ${modelo} \\{([\\s\\S]*?)^\\}`, "m"));
      expect(m, `modelo ${modelo}`).not.toBeNull();
      return m![1].split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//") && !l.startsWith("@@")).map((l) => l.split(/\s+/)[0]);
    };
    for (const [modelo, declarados] of Object.entries(CAMPOS_DECLARADOS)) expect(campos(modelo).sort(), `campos de ${modelo}`).toEqual(Object.keys(declarados).sort());
    for (const [modelo, quedan] of Object.entries(CAMPOS_AJENOS_QUE_APUNTAN)) for (const campo of quedan) expect(campos(modelo), `${modelo}.${campo}`).toContain(campo);
  });

  /** Cada lector/escritor de la estructura en `src/server` y cómo responde al interruptor. Un archivo nuevo que toque estas tablas hace fallar el guardián hasta que se lo clasifique. */
  const CLASIFICACION: Record<string, "aplica" | "por-la-accion" | "pantalla-etapa-2" | "sin-efecto"> = {
    "server/lecturas/carta/menu.ts": "aplica",
    "server/lecturas/pos/selector-carta.ts": "aplica",
    "server/consultas/carta/combos.ts": "aplica",
    "server/consultas/carta/ventas-por-seccion.ts": "aplica",
    "server/lecturas/carta/choque-de-nombre.ts": "aplica",
    "server/lecturas/carta/componentes-de-promo.ts": "aplica",
    "server/lecturas/carta/grupo-de-producto.ts": "aplica",
    "server/lecturas/catalogo/filtros-de-productos.ts": "aplica",
    "server/actions/carta/casos-de-uso/agregar-producto-a-la-carta.ts": "aplica",
    "server/actions/carta/casos-de-uso/quitar-producto-de-la-carta.ts": "aplica",
    // Detrás de una Server Action que rechaza con el interruptor apagado (el guardián de las acciones de arriba): solo las llaman ellas.
    "server/actions/carta/casos-de-uso/actualizar-activo-genero-carta.ts": "por-la-accion",
    "server/actions/carta/casos-de-uso/actualizar-activo-item-agrupado-carta.ts": "por-la-accion",
    "server/actions/carta/casos-de-uso/actualizar-orden-opcion-item-agrupado-carta.ts": "por-la-accion",
    "server/actions/carta/casos-de-uso/agregar-opcion-item-agrupado-carta.ts": "por-la-accion",
    "server/actions/carta/casos-de-uso/guardar-genero-carta.ts": "por-la-accion",
    "server/actions/carta/casos-de-uso/guardar-item-agrupado-carta.ts": "por-la-accion",
    "server/actions/carta/casos-de-uso/quitar-opcion-item-agrupado-carta.ts": "por-la-accion",
    "server/persistencia/carta/generos.ts": "por-la-accion",
    "server/persistencia/carta/items-agrupados.ts": "por-la-accion",
    // Etapa 2 (PR2): las pantallas de administración y su consulta.
    "server/consultas/carta/admin.ts": "pantalla-etapa-2",
    "server/consultas/carta/mantenimiento.ts": "pantalla-etapa-2",
    // Sin efecto, a propósito: valida el género de un contenido (lo llama `guardar-contenido-carta-producto.ts` SOLO con el interruptor encendido) y copiar la carta de otra sucursal
    // lleva lo que existe tal cual (los géneros y agrupados ocultos viajan, para que al encender vuelvan completos); el alcance de sucursal es un documento.
    "server/actions/carta/generos-compartido.ts": "sin-efecto",
    "server/actions/carta/casos-de-uso/copiar-carta-de-sucursal.ts": "sin-efecto",
    "server/persistencia/carta/copiar-carta.ts": "sin-efecto",
    "core/carta/carta-de-sucursal.ts": "sin-efecto",
  };

  it("todo archivo que toca las tablas de la estructura está clasificado frente al interruptor, y los que 'aplican' lo leen", () => {
    const recorrer = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? recorrer(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));
    const TOCA = /\b(generoCarta|itemAgrupadoCarta|opcionItemAgrupadoCarta)\s*\.\s*\w+|opcionesItemAgrupadoCarta\s*:\s*\{|itemsAgrupadosCarta|generosCarta\b/;
    const encontrados = recorrer(join(RAIZ, "src"))
      .map((f) => relative(join(RAIZ, "src"), f).split(sep).join("/"))
      .filter((f) => TOCA.test(readFileSync(join(RAIZ, "src", f), "utf8")))
      .sort();
    expect(encontrados).toEqual(Object.keys(CLASIFICACION).sort());
    for (const [archivo, clase] of Object.entries(CLASIFICACION)) {
      if (clase === "aplica") expect(readFileSync(join(RAIZ, "src", archivo), "utf8"), `${archivo} lee el interruptor`).toContain("GENERO_E_ITEM_AGRUPADO_VISIBLE");
    }
  });
});

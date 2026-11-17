import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LugarDeCombo, ProductoParaEntrada } from "../../src/core/carta/public";

/**
 * CRITERIO MEDIBLE del dueño (2026-11-17): las palabras visibles de cada pantalla de combos (lista, ficha, «Nuevo combo» vacío, hoja) no pasan las de la maqueta (`combos.html` de Pedernal) más 10 %, contadas con los DATOS DE EJEMPLO de la maqueta
 * (Combo Funghi, Hamburguesa Funghi, 1 de Bebidas a elección…). Cuenta lo que se ve a 375 px con los `<details>` CERRADOS (su `<summary>` sí cuenta, su contenido no): texto de interfaz y datos; no cuenta valores de campos, `aria-label` ni símbolos sin letras ni dígitos (‹ − +).
 * Presupuestos medidos en la maqueta: lista 57 (tope 62), ficha de un combo con 2 componentes 101 (tope 111), «Nuevo combo» vacío 15 (tope 16), hoja 78 (tope 85; la maqueta trae 4 tipos, acá hay 2 pasos: la sección y lo que entra de ella). El barra de la pantalla de la carta (título y sucursal) se suma aparte.
 * Los conteos se imprimen (`console.info`) para listarlos en el PR.
 */
const RUTA = "../../src/core/carta/armado-de-promo-como-pedernal";

export function palabrasVisibles(html: string): string[] {
  let h = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "");
  // Los <details> cerrados solo muestran su <summary>.
  h = h.replace(/<details(?![^>]*\sopen)[^>]*>([\s\S]*?)<\/details>/g, (_t, dentro: string) => dentro.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "");
  // Un <select> muestra su opción elegida (o la primera).
  h = h.replace(/<select[\s\S]*?<\/select>/g, (sel) => {
    const elegida = sel.match(/<option[^>]*selected[^>]*>([^<]*)<\/option>/) ?? sel.match(/<option[^>]*>([^<]*)<\/option>/);
    return elegida ? ` ${elegida[1]} ` : "";
  });
  h = h.replace(/<textarea[\s\S]*?<\/textarea>/g, "");
  const texto = h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return texto.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
}

const PRODUCTOS: ProductoParaEntrada[] = [
  { productoId: "p-funghi", nombre: "Hamburguesa Funghi", nombreParaMostrar: "Hamburguesa Funghi", grupos: [], seccionCartaId: "s-hamb", categoria: null, gruposAElegir: [] },
  { productoId: "p-gaseosa", nombre: "Gaseosa 500 ml", nombreParaMostrar: "Gaseosa 500 ml", grupos: [], seccionCartaId: "s-beb", categoria: null, gruposAElegir: [] },
  { productoId: "p-jugo", nombre: "Jugo 200 ml", nombreParaMostrar: "Jugo 200 ml", grupos: [], seccionCartaId: "s-beb", categoria: null, gruposAElegir: [] },
];
const SECCIONES = [
  { id: "s-hamb", nombre: "Hamburguesas", activa: true },
  { id: "s-beb", nombre: "Bebidas", activa: true },
  { id: "s-caf", nombre: "Cafés", activa: true },
];
/** Combo Funghi: «Hamburguesa Funghi» fija + 1 de Bebidas a elección (la sección entera: Gaseosa 500 ml y Jugo 200 ml). */
const LUGARES_FUNGHI: LugarDeCombo[] = [
  { id: "l1", tipo: "LISTA", nombre: "Hamburguesas", cantidadMinima: 1, cantidadMaxima: 1, orden: 1, entradas: [{ id: "e1", activa: true, productoId: "p-funghi", nombre: "Hamburguesa Funghi", modoDeOpciones: "FIJAS", opciones: [] }] },
];
const CUPOS_FUNGHI = [{ seccionCartaId: "s-beb", cantidadMinima: 1, cantidadMaxima: 1 }];
const guardar = async () => ({ ok: true as const, mensaje: "" });

async function cargar() {
  vi.resetModules();
  vi.doMock(RUTA, async (original) => ({ ...(await original<typeof import("../../src/core/carta/armado-de-promo-como-pedernal")>()), ARMADO_DE_PROMO_COMO_PEDERNAL: true }));
  const publico = await import("../../src/core/carta/public");
  const base = "../../src/app/(app)/carta/parametrizacion/promociones/";
  const { ListaDeCombos } = await import(`${base}lista-de-combos`);
  const { FichaDelCombo } = await import(`${base}ficha-del-combo`);
  const { ComponentesDelCombo, HojaDeComponente } = await import(`${base}componentes-del-combo`);
  const { ComoLoVeElCliente, RepartoDelPrecio } = await import(`${base}reparto-del-precio`);
  const { ParteDePromo } = await import(`${base}parte-de-promo`);
  return { publico, ListaDeCombos, FichaDelCombo, ComponentesDelCombo, HojaDeComponente, ComoLoVeElCliente, RepartoDelPrecio, ParteDePromo };
}

afterEach(() => {
  vi.doUnmock(RUTA);
  vi.resetModules();
});

const TOPES = { lista: 62, ficha: 111, nuevo: 16, hoja: 85 };

describe("palabras visibles de las pantallas de combos (maqueta + 10 %)", () => {
  it("LISTA con los tres combos de la maqueta (más el título y la sucursal de la barra)", async () => {
    const { ListaDeCombos } = await cargar();
    const html = renderToStaticMarkup(
      <ListaDeCombos
        rutaDeLaFicha="/x"
        puedeDefinir
        filas={[
          { id: "1", titulo: "Combo Funghi", loQueLleva: "Hamburguesa Funghi + 1 de Bebidas a elección", activo: true, precio: 14000 },
          { id: "2", titulo: "Combo Merienda", loQueLleva: "1 de Cafés a elección + 1 de Tortas a elección", activo: true, precio: 5000 },
          { id: "3", titulo: "Combo Familiar", loQueLleva: "2 × Hamburguesa Barbacoa + 2 de Bebidas a elección", activo: false, precio: 32000 },
        ]}
      />
    );
    const n = palabrasVisibles(html).length + 3; // «Combos» y «Sucursal Centro» de la barra
    console.info(`[palabras] LISTA: ${n} (maqueta 57, tope ${TOPES.lista})`);
    expect(n).toBeLessThanOrEqual(TOPES.lista);
  });

  it("FICHA de Combo Funghi con 2 componentes, «Cómo lo ve el cliente» y «Reparto del precio»", async () => {
    const { publico, FichaDelCombo, ComponentesDelCombo, ComoLoVeElCliente, RepartoDelPrecio } = await cargar();
    const filas = publico.armarFilasDeLaPromo({ secciones: SECCIONES, cuposDeSeccion: CUPOS_FUNGHI, lugares: LUGARES_FUNGHI });
    const componentes = publico.componentesDeLaFicha(filas, PRODUCTOS);
    expect(componentes.map((c) => c.nombre).sort()).toEqual(["1 de Bebidas a elección", "Hamburguesa Funghi"]);
    const html = renderToStaticMarkup(
      <FichaDelCombo
        nuevo={false}
        inicial={{ titulo: "Combo Funghi", precio: "14000", seccionCartaId: "s-hamb", descripcion: "", orden: "0" }}
        secciones={SECCIONES}
        puedeDefinir
        rutaDeLaLista="/x"
        guardar={guardar}
        componentes={<ComponentesDelCombo componentes={componentes} paraAgregar={publico.filasParaAgregar(filas)} productos={PRODUCTOS} puedeEditar sinGuardar={false} guardar={guardar} />}
        lecturas={
          <>
            <ComoLoVeElCliente titulo="Combo Funghi" precio={14000} loQueLleva={publico.loQueLlevaLaPromo(componentes.map((c) => c.parte))} />
            <RepartoDelPrecio
              precio={14000}
              partes={[
                { nombre: "Hamburguesas", cantidadMinima: 1, cantidadMaxima: 1, ejemplo: { nombre: "Hamburguesa Funghi", precioLista: 12500 } },
                { nombre: "Bebidas", cantidadMinima: 1, cantidadMaxima: 1, ejemplo: { nombre: "Gaseosa 500 ml", precioLista: 2200 } },
              ]}
            />
          </>
        }
        extra={null}
      />
    );
    expect(html).toContain("11.904,76");
    const n = palabrasVisibles(html).length;
    console.info(`[palabras] FICHA: ${n} (maqueta 101, tope ${TOPES.ficha})`);
    expect(n).toBeLessThanOrEqual(TOPES.ficha);
  });

  it("«NUEVO COMBO» vacío", async () => {
    const { FichaDelCombo, ComponentesDelCombo } = await cargar();
    const html = renderToStaticMarkup(
      <FichaDelCombo
        nuevo
        inicial={{ titulo: "", precio: "", seccionCartaId: "", descripcion: "", orden: "0" }}
        secciones={SECCIONES}
        puedeDefinir
        rutaDeLaLista="/x"
        guardar={guardar}
        componentes={<ComponentesDelCombo componentes={[]} paraAgregar={[]} productos={[]} puedeEditar sinGuardar guardar={guardar} />}
        lecturas={null}
        extra={null}
      />
    );
    const n = palabrasVisibles(html).length;
    console.info(`[palabras] NUEVO COMBO vacío: ${n} (maqueta 15, tope ${TOPES.nuevo})`);
    expect(n).toBeLessThanOrEqual(TOPES.nuevo);
  });

  it("HOJA «Agregar componente» con la sección Bebidas elegida (la hoja vacía + lo que entra de la sección; «Cancelar» no se cuenta dos veces)", async () => {
    const { publico, HojaDeComponente, ParteDePromo } = await cargar();
    const filas = publico.armarFilasDeLaPromo({ secciones: SECCIONES, cuposDeSeccion: [], lugares: [] });
    const bebidas = filas.deSecciones.find((f) => f.nombre === "Bebidas")!;
    const hoja = renderToStaticMarkup(<HojaDeComponente abierta paraAgregar={publico.filasParaAgregar(filas)} productos={PRODUCTOS} guardar={guardar} alCerrar={() => undefined} />);
    const parte = renderToStaticMarkup(<ParteDePromo fila={{ ...bebidas, modo: "NO_ENTRA" }} productos={PRODUCTOS} guardar={guardar} alGuardar={() => undefined} alCancelar={() => undefined} />);
    const n = palabrasVisibles(hoja).length + palabrasVisibles(parte).length - 1;
    console.info(`[palabras] HOJA: ${n} (maqueta 78, tope ${TOPES.hoja})`);
    expect(n).toBeLessThanOrEqual(TOPES.hoja);
  });
});

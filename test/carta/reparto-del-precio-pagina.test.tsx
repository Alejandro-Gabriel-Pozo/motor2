import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * La pantalla Carta › Promociones con el interruptor `ARMADO_DE_PROMO_COMO_PEDERNAL` en sus dos estados (vi.doMock + vi.resetModules, como `sumar-lugar-interruptor.test.tsx`): APAGADO, la pantalla de siempre y la
 * lectura del reparto NO se ejecuta (no suma costo); ENCENDIDO, se lee UNA vez y se dibuja «Reparto del precio» de la promo con componentes (con el precio de ESTA sucursal, `precioAca`).
 */
const RUTA = "../../src/app/(app)/carta/parametrizacion/promociones/page";
const PROMO = { id: "p1", titulo: "Combo Barbacoa", descripcion: "", precio: 13500, precioAca: 13500, precioLocal: null, orden: 0, activa: true, prendidaAca: true, seccionCarta: "Menús", seccionCartaId: "s0", cupos: [{ id: "c1", seccionCartaId: "s1", seccionCarta: "Platos", cantidadMinima: 1, cantidadMaxima: 1, orden: 0 }] };

async function dibujar(encendido: boolean) {
  vi.resetModules();
  const lectura = vi.fn(async () => ({ p1: [{ nombre: "Platos", cantidadMinima: 1, cantidadMaxima: 1, ejemplo: { nombre: "Barbacoa", precioLista: 12000 } }, { nombre: "Bebidas", cantidadMinima: 1, cantidadMaxima: 1, ejemplo: { nombre: "Gaseosa", precioLista: 2200 } }] }));
  vi.doMock("../../src/core/carta/armado-de-promo-como-pedernal", async (original) => ({ ...(await original<typeof import("../../src/core/carta/armado-de-promo-como-pedernal")>()), ARMADO_DE_PROMO_COMO_PEDERNAL: encendido }));
  vi.doMock("../../src/server/sesion/contexto", () => ({ obtenerContextoUsuario: async () => ({ usuarioId: "u", empresaId: "e", sucursalId: "su", sucursalNombre: "Centro", db: {} }) }));
  vi.doMock("../../src/server/actions/limitador-de-lecturas", () => ({ MENSAJE_DEMASIADAS_LECTURAS: "x", lecturaSinCupo: () => false }));
  vi.doMock("../../src/server/acceso/gate", () => ({ requierePermisoVer: async () => ({ ok: true }), obtenerMiNivelPermiso: async () => ({ editar: false }), obtenerMiNivelPermisoDeEmpresa: async () => ({ editar: false }) }));
  vi.doMock("../../src/server/consultas/carta/admin", () => ({ cargarAdminCarta: async () => ({ promos: [PROMO], secciones: [], precioLocalActivo: true }) }));
  vi.doMock("../../src/server/consultas/carta/combos", () => ({ cargarCombosDeLaCarta: async () => ({ porPromo: { p1: { lugares: [], version: 1, soloSalon: false } }, productos: [] }) }));
  vi.doMock("../../src/server/consultas/carta/reparto-de-las-promos", () => ({ cargarRepartoDeLasPromos: lectura }));
  vi.doMock("../../src/components/fila-de-carta", () => ({ FilaDeCarta: () => null }));
  vi.doMock("../../src/app/(app)/carta/encabezado-de-carta", () => ({ EncabezadoDeCarta: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
  vi.doMock("../../src/server/actions/refrescar", () => ({ refrescarVistaSiHaceFalta: () => undefined }));
  const { default: Pagina } = await import(RUTA);
  return { html: renderToStaticMarkup(await Pagina()), lectura };
}

afterEach(() => {
  vi.doUnmock("../../src/core/carta/armado-de-promo-como-pedernal");
  vi.resetModules();
});

describe("Carta › Promociones: «Reparto del precio» según el interruptor", () => {
  it("ENCENDIDO: lee el reparto una vez y lo dibuja con la parte de cada componente", async () => {
    const { html, lectura } = await dibujar(true);
    expect(lectura).toHaveBeenCalledTimes(1);
    expect(html).toContain("data-reparto-del-precio");
    expect(html).toMatch(/Barbacoa[^<]*11\.408,45 \(Lista [^<]*12\.000,00\)/);
    expect(html).toMatch(/Gaseosa[^<]*2\.091,55/);
  });

  it("APAGADO: la pantalla de siempre, sin el bloque y SIN ejecutar la lectura nueva", async () => {
    const { html, lectura } = await dibujar(false);
    expect(lectura).not.toHaveBeenCalled();
    expect(html).not.toContain("data-reparto-del-precio");
    expect(html).not.toContain("Reparto del precio");
    expect(html).toContain("Combo Barbacoa");
  });
});

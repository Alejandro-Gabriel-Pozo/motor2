import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * La ficha de un combo (`/carta/parametrizacion/promociones/[id]`) con el interruptor `ARMADO_DE_PROMO_COMO_PEDERNAL` en sus dos estados (vi.doMock + vi.resetModules): APAGADO, la ruta no existe («no encontrada») y la lectura del reparto NO se
 * ejecuta (no suma costo); ENCENDIDO, se lee UNA vez y se dibuja «Reparto del precio» del combo con componentes (con el precio de ESTA sucursal, `precioAca`). Una promo que no existe da «no encontrada» y `nuevo` abre la ficha vacía.
 */
const RUTA = "../../src/app/(app)/carta/parametrizacion/promociones/[id]/page";
const PROMO = { id: "p1", titulo: "Combo Barbacoa", descripcion: "", precio: 13500, precioAca: 13500, precioLocal: null, orden: 0, activa: true, prendidaAca: true, seccionCarta: "Menús", seccionCartaId: "s0", cupos: [{ id: "c1", seccionCartaId: "s1", seccionCarta: "Platos", cantidadMinima: 1, cantidadMaxima: 1, orden: 0 }] };
const SECCIONES = [
  { id: "s0", nombre: "Menús", activa: true },
  { id: "s1", nombre: "Platos", activa: true },
];

async function dibujar(encendido: boolean, id: string, puedeEditar = false) {
  vi.resetModules();
  const lectura = vi.fn(async () => ({ p1: [{ nombre: "Platos", cantidadMinima: 1, cantidadMaxima: 1, ejemplo: { nombre: "Barbacoa", precioLista: 12000 } }, { nombre: "Bebidas", cantidadMinima: 1, cantidadMaxima: 1, ejemplo: { nombre: "Gaseosa", precioLista: 2200 } }] }));
  vi.doMock("../../src/core/carta/armado-de-promo-como-pedernal", async (original) => ({ ...(await original<typeof import("../../src/core/carta/armado-de-promo-como-pedernal")>()), ARMADO_DE_PROMO_COMO_PEDERNAL: encendido }));
  vi.doMock("../../src/server/sesion/contexto", () => ({ obtenerContextoUsuario: async () => ({ usuarioId: "u", empresaId: "e", sucursalId: "su", sucursalNombre: "Centro", db: {} }) }));
  vi.doMock("../../src/server/actions/limitador-de-lecturas", () => ({ MENSAJE_DEMASIADAS_LECTURAS: "x", lecturaSinCupo: () => false }));
  vi.doMock("../../src/server/acceso/gate", () => ({ requierePermisoVer: async () => ({ ok: true }), obtenerMiNivelPermiso: async () => ({ editar: puedeEditar }), obtenerMiNivelPermisoDeEmpresa: async () => ({ editar: puedeEditar }) }));
  vi.doMock("../../src/server/consultas/carta/admin", () => ({ cargarAdminCarta: async () => ({ promos: [PROMO], secciones: SECCIONES, precioLocalActivo: true }) }));
  vi.doMock("../../src/server/consultas/carta/combos", () => ({ cargarCombosDeLaCarta: async () => ({ porPromo: { p1: { lugares: [], version: 1, soloSalon: false } }, productos: [] }) }));
  vi.doMock("../../src/server/consultas/carta/reparto-de-las-promos", () => ({ cargarRepartoDeLasPromos: lectura }));
  vi.doMock("../../src/components/fila-de-carta", () => ({ FilaDeCarta: () => null }));
  vi.doMock("../../src/app/(app)/carta/encabezado-de-carta", () => ({ EncabezadoDeCarta: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
  vi.doMock("../../src/server/actions/refrescar", () => ({ refrescarVistaSiHaceFalta: () => undefined }));
  const { default: Pagina } = await import(RUTA);
  return { pagina: () => Pagina({ params: Promise.resolve({ id }) }), lectura };
}

afterEach(() => {
  vi.doUnmock("../../src/core/carta/armado-de-promo-como-pedernal");
  vi.resetModules();
});

describe("Ficha del combo: «Reparto del precio» y la ruta según el interruptor", () => {
  it("ENCENDIDO: lee el reparto una vez y lo dibuja con la parte de cada componente", async () => {
    const { pagina, lectura } = await dibujar(true, "p1");
    const html = renderToStaticMarkup(await pagina());
    expect(lectura).toHaveBeenCalledTimes(1);
    expect(html).toContain("data-reparto-del-precio");
    expect(html).toMatch(/Barbacoa.*?11\.408,45.*?Lista [^<]*12\.000,00/);
    expect(html).toMatch(/Gaseosa.*?2\.091,55/);
    expect(html).toContain("Cómo lo ve el cliente");
  });

  it("APAGADO: la ruta no existe y NO se ejecuta la lectura del reparto", async () => {
    const { pagina, lectura } = await dibujar(false, "p1");
    await expect(pagina()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NOT_FOUND/);
    expect(lectura).not.toHaveBeenCalled();
  });

  it("ENCENDIDO: una promo que no existe da «no encontrada»; «nuevo» sin permiso de definir también (los ids de la URL no abren nada ajeno)", async () => {
    const otra = await dibujar(true, "no-existe");
    await expect(otra.pagina()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NOT_FOUND/);
    const nuevoSinPermiso = await dibujar(true, "nuevo", false);
    await expect(nuevoSinPermiso.pagina()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NOT_FOUND/);
  });

  it("ENCENDIDO: «nuevo» con permiso abre la ficha vacía, sin lecturas del reparto", async () => {
    const { pagina, lectura } = await dibujar(true, "nuevo", true);
    const html = renderToStaticMarkup(await pagina());
    expect(html).toContain("Nuevo combo");
    expect(html).toContain("Todavía no lleva nada");
    expect(lectura).not.toHaveBeenCalled();
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envoltoriosDe, type Envoltorio } from "./guardas/envoltorio-y-clave";

/**
 * Server Action del POS → envoltorio y clave (Hito 4, paso 0.3 de `docs/plan-hito-4-pureza.md` §5; mismo guardián que `gobierno-envoltorio-y-clave.test.ts`
 * para las 16 de gobierno, con el mismo analizador: `guardas/envoltorio-y-clave.ts`).
 *
 * Las 10 mutaciones del POS que todavía no pasan por un caso de uso se mudan en el bloque 4.1. Lo que NO puede cambiar en esa mudanza es con qué envoltorio y
 * con qué clave entra cada una: todas las claves del salón son `AccionDeSucursal`, así que cambiar `"pos_liberar_mesa"` por `"pos_tomar_pedido"` compila y
 * le abre la acción a quien solo toma pedidos; y un guard de formato puesto ANTES del envoltorio le contestaría a quien no tiene permiso. Por cada archivo de
 * Server Actions del POS se exige: que las funciones exportadas que llaman a un envoltorio de mutación sean EXACTAMENTE las declaradas (lista cerrada: una
 * mutación nueva se declara acá), que su PRIMERA sentencia sea `return <envoltorio>("<clave>", …)` y que envoltorio y clave sean los declarados. Incluye las
 * 4 ya migradas (anular y cerrar): son las 14 de `test/pos/pos-rechaza-sin-permiso.test.ts`.
 */
const RAIZ = join(__dirname, "../../src/server/actions/pos");

/** `archivo` (relativo a `src/server/actions/pos`) → función exportada → envoltorio y clave. */
const DECLARADAS: Record<string, Record<string, { envoltorio: Envoltorio; clave: string }>> = {
  "mesas.ts": {
    crearMesa: { envoltorio: "conPermiso", clave: "pos_alta_mesa" },
    actualizarMaxMesasAbiertas: { envoltorio: "conPermiso", clave: "pos_limite_mesas_abiertas" },
  },
  "cuenta-apertura.ts": {
    abrirCuenta: { envoltorio: "conPermiso", clave: "pos_abrir_cuenta" },
    corregirComensales: { envoltorio: "conPermiso", clave: "pos_abrir_cuenta" },
    asignarClienteACuenta: { envoltorio: "conPermiso", clave: "pos_asignar_cliente" },
    liberarMesa: { envoltorio: "conPermiso", clave: "pos_liberar_mesa" },
  },
  "cuenta-pedido.ts": {
    agregarItems: { envoltorio: "conPermiso", clave: "pos_tomar_pedido" },
    quitarPromoSinEnviar: { envoltorio: "conPermiso", clave: "pos_tomar_pedido" },
    quitarItemSinEnviar: { envoltorio: "conPermiso", clave: "pos_tomar_pedido" },
    enviarACocina: { envoltorio: "conPermiso", clave: "pos_enviar_a_cocina" },
  },
  "cuenta-anulacion.ts": {
    anularItemEnviado: { envoltorio: "conPermiso", clave: "pos_anular_item" },
    anularPromoEnviada: { envoltorio: "conPermiso", clave: "pos_anular_item" },
  },
  "cuenta-cierre.ts": {
    cerrarCuenta: { envoltorio: "conPermiso", clave: "pos_cerrar_cuenta" },
    emitirTicketCorregido: { envoltorio: "conPermiso", clave: "pos_emitir_ticket_corregido" },
  },
};

describe("POS: cada Server Action entra por su envoltorio y su clave", () => {
  it.each(Object.keys(DECLARADAS))("%s: las mutaciones son las declaradas, con su envoltorio y su clave como primera sentencia", (archivo) => {
    const encontradas = Object.fromEntries(Object.entries(envoltoriosDe(readFileSync(join(RAIZ, archivo), "utf8"))).map(([f, e]) => [f, e.entrada]));
    const esperadas = Object.fromEntries(Object.entries(DECLARADAS[archivo]).map(([f, d]) => [f, `${d.envoltorio}:${d.clave}`]));
    expect(
      encontradas,
      `pos/${archivo}: una mutación cambió de envoltorio o de clave, hay una sentencia antes del envoltorio, o hay una mutación nueva sin declarar. Todas las claves del salón compilan en cualquier conPermiso: si el cambio es a propósito, declaralo acá.`
    ).toEqual(esperadas);
  });

  it("son las 14 mutaciones del POS", () => {
    expect(Object.values(DECLARADAS).reduce((n, fs) => n + Object.keys(fs).length, 0)).toBe(14);
  });

  it('los archivos "use server" de src/server/actions/pos son exactamente los declarados (una acción nueva del POS no queda afuera)', () => {
    const conUseServer = readdirSync(RAIZ, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.ts$/.test(e.name))
      .filter((e) => /^\s*["']use server["']/.test(readFileSync(join(RAIZ, e.name), "utf8")))
      .map((e) => e.name)
      .sort();
    expect(conUseServer).toEqual(Object.keys(DECLARADAS).sort());
  });
});

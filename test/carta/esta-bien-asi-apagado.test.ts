import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// El interruptor APAGADO, como en producción (el setup global de los tests lo enciende; este archivo lo apaga a propósito).
vi.mock("../../src/core/carta/esta-bien-asi", async (original) => ({ ...(await original<typeof import("../../src/core/carta/esta-bien-asi")>()), ESTA_BIEN_ASI_VISIBLE: false }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { MENSAJE_ESTA_BIEN_ASI_APAGADO } from "../../src/core/carta/esta-bien-asi";
import { confirmarNombreEnCarta } from "../../src/server/actions/carta/contenido-producto";
import { resolverMenuCarta } from "../../src/server/lecturas/carta/menu";

/**
 * «Está bien así» APAGADO (el valor de producción, decisión del dueño 2026-11-11; `docs/diseno-apagar-esta-bien-asi-2026-11-11.md`), contra Postgres real.
 * ORÁCULO (escrito a mano, aparte del código): estado del nombre {pendiente, propio, confirmado} × tipo {directo, base}. Para cada combinación: la acción rechaza con el mensaje fijo, no escribe ni audita;
 * y, en los directos, la carta pública sigue mostrando `nombreEnCarta ?? nombre` (el interruptor no la toca).
 */
type Estado = "pendiente" | "propio" | "confirmado";
type Tipo = "directo" | "base";
const ESTADOS: Estado[] = ["pendiente", "propio", "confirmado"];
const TIPOS: Tipo[] = ["directo", "base"];
const NOMBRE_DEL_PRODUCTO = "Milanesa napolitana";
const NOMBRE_EN_CARTA_ESPERADO: Record<Estado, string> = { pendiente: NOMBRE_DEL_PRODUCTO, propio: "Milanesas", confirmado: NOMBRE_DEL_PRODUCTO };
const NOMBRE_GUARDADO: Record<Estado, string | null> = { pendiente: null, propio: "Milanesas", confirmado: NOMBRE_DEL_PRODUCTO };

describe("«Está bien así» APAGADO (contra Postgres)", () => {
  let sucursalId: string;
  let seccionCartaId: string;
  let unidadId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionCartaId = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
  });

  it("el valor real del interruptor (sin ningún mock) es apagado", async () => {
    const real = await vi.importActual<typeof import("../../src/core/carta/esta-bien-asi")>("../../src/core/carta/esta-bien-asi");
    expect(real.ESTA_BIEN_ASI_VISIBLE).toBe(false);
  });

  for (const estado of ESTADOS) {
    for (const tipo of TIPOS) {
      it(`estado ${estado} × ${tipo}: la acción rechaza sin escribir ni auditar (repetida también) y la carta pública no cambia`, async () => {
        const p = await sembrarProductoDisponible({ codigo: `PV_${estado}_${tipo}`, nombre: NOMBRE_DEL_PRODUCTO, tipo: "PV", precioVenta: 1000, unidadStockId: unidadId }, sucursalId);
        if (tipo === "base") await prisma.producto.update({ where: { id: p.id }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });
        await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: p.id, seccionCartaId, orden: 0, visibleEnCarta: true, nombreEnCarta: NOMBRE_GUARDADO[estado] } });
        const antes = await prisma.contenidoCartaProducto.findMany({ where: { productoId: p.id } });

        for (let vez = 0; vez < 2; vez++) expect(await confirmarNombreEnCarta(p.id)).toEqual({ ok: false, mensaje: MENSAJE_ESTA_BIEN_ASI_APAGADO });

        expect(await prisma.contenidoCartaProducto.findMany({ where: { productoId: p.id } })).toEqual(antes);
        expect(await prisma.registroAuditoria.count({ where: { entidad: "ContenidoCartaProducto", campo: "nombreEnCarta" } })).toBe(0);
        if (tipo === "directo") {
          const carta = await resolverMenuCarta(sucursalId, prisma, AHORA_DE_LA_CORRIDA);
          expect(carta?.secciones.flatMap((x) => x.items).map((i) => i.nombre)).toContain(NOMBRE_EN_CARTA_ESPERADO[estado]);
        }
      });
    }
  }

  it("el permiso sigue siendo lo primero: sin él el rechazo es el de permisos, no el del interruptor", async () => {
    const base = await prisma.rol.findFirstOrThrow({ where: { nombre: { not: "admin" } } });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.id });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const r = await confirmarNombreEnCarta("cualquiera");
    expect(r.ok).toBe(false);
    expect(r.mensaje).not.toBe(MENSAJE_ESTA_BIEN_ASI_APAGADO);
  });

  // GUARDIÁN: las 3 superficies de administración leen el interruptor (si aparece una cuarta que dibuje el aviso o la lista, hay que declararla acá).
  it("las 3 superficies de administración leen el interruptor", () => {
    const leer = (ruta: string) => readFileSync(ruta, "utf8");
    for (const ruta of ["src/app/(app)/carta/page.tsx", "src/app/(app)/catalogo/productos/[id]/en-la-carta/page.tsx", "src/server/actions/carta/contenido-producto.ts", "src/components/carta/contenido-del-producto.tsx"]) {
      expect(leer(ruta), ruta).toContain("ESTA_BIEN_ASI_VISIBLE");
    }
    const usanElComponente = (ruta: string) => leer(ruta).includes("<NombresDeCartaPendientes");
    expect(usanElComponente("src/app/(app)/carta/page.tsx")).toBe(true);
  });
});

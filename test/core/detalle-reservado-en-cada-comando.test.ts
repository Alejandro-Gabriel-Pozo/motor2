import { describe, expect, it } from "vitest";
import { guardComandoRegistrarFacturaProveedor } from "../../src/core/features/compras/factura-proveedor.guard";
import { guardComandoConteoFisico } from "../../src/core/features/movimientos/conteo-fisico.guard";
import { guardComandoReclasificarStock } from "../../src/core/features/movimientos/reclasificacion.guard";
import { guardComandoRegistrarMovimiento } from "../../src/core/features/movimientos/movimiento.guard";
import { guardComandoCrearEnvioDirectoTraspaso, guardComandoCrearSolicitudTraspaso } from "../../src/core/features/traspasos/traspaso-comandos.guard";
import { validarCorreccion } from "../../src/core/compras/correccion";
import { detalleReversionDeCompra, detalleReversionDeVenta, MENSAJE_DETALLE_RESERVADO, validarDetalleLibreDeOperacion } from "../../src/core/movimientos/anulaciones";
import { registrarVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta";
import type { DatosVentaInput } from "../../src/core/features/ventas/venta.schema";
import { mediodiaDelDia, ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

/**
 * Lote 2 de la deuda (auditoría del catálogo común, 2026-11-06): el comienzo «Anulación de la venta/compra …» está reservado para las reversiones, que los reportes reconocen SOLO por ese texto
 * (`diferencias-ajustes`, `rendimiento-recetas`, `OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION`). Antes lo rechazaban 2 guards; los demás comandos con un detalle libre que llega a
 * `Operacion.detalleLibre` lo dejaban pasar y quien lo escribía se hacía pasar por una reversión.
 *
 * Tabla de ejemplos: CADA comando con un detalle libre, el mismo detalle reservado (en sus variantes) y el mismo mensaje; y los detalles legítimos siguen pasando.
 * Si aparece un comando nuevo con un detalle libre, se agrega una fila acá (y usa `validarDetalleLibreDeOperacion`, no una copia de la comparación).
 */
const CLAVE = "3f0b8f5e-2c1d-4f6a-9b7e-1a2b3c4d5e6f";
const HOY = mediodiaDelDia("2026-10-28", ZONA_ARGENTINA);

type Veredicto = { ok: boolean; mensaje?: string; codigo?: string };

/** Cada comando recibe un detalle y devuelve si lo aceptó (con el mensaje y el código si lo rechazó). */
const COMANDOS: ReadonlyArray<readonly [nombre: string, correr: (detalle: string) => Veredicto | Promise<Veredicto>]> = [
  ["registrarMovimiento (ajuste)", (d) => guardComandoRegistrarMovimiento({ proceso: "AJUSTE", items: [{ productoId: "p", cantidad: 1 }], seccionId: "s", fecha: AHORA_DE_LA_CORRIDA, claveIdempotencia: CLAVE, detalleLibre: d }, AHORA_DE_LA_CORRIDA)],
  [
    "registrarFacturaProveedor",
    (d) =>
      guardComandoRegistrarFacturaProveedor(
        { fecha: HOY, proveedorId: "prov", nroFactura: "A-00001-00000077", seccionId: "sec", items: [{ productoId: "p", cantidad: 3, precioTotal: 300, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: CLAVE, detalleLibre: d },
        new Date("2026-10-28T15:00:00.000Z"),
        "suc_3"
      ),
  ],
  ["crearSolicitudTraspaso (pedir)", (d) => guardComandoCrearSolicitudTraspaso({ origenSucursalId: "suc", productoId: "p", cantidad: 1, seccionDestinoId: "sec", detalle: d })],
  ["crearEnvioDirectoTraspaso (enviar)", (d) => guardComandoCrearEnvioDirectoTraspaso({ destinoSucursalId: "suc", productoId: "p", cantidad: 1, seccionOrigenId: "sec", detalle: d })],
  [
    "reclasificarStock",
    (d) => guardComandoReclasificarStock({ productoId: "p", seccionOrigenId: "s1", destinos: [{ seccionId: "s2", cantidad: 1 }], claveIdempotencia: CLAVE, fecha: AHORA_DE_LA_CORRIDA, detalle: d }, AHORA_DE_LA_CORRIDA),
  ],
  ["registrarConteoFisico", (d) => guardComandoConteoFisico({ seccionId: "s", accion: "AJUSTAR", fechaConteo: AHORA_DE_LA_CORRIDA, claveIdempotencia: CLAVE, detalle: d }, AHORA_DE_LA_CORRIDA)],
  ["corregirCompra (detalle de la cabecera)", (d) => { const m = validarCorreccion([{ campo: "detalleLibre", anterior: null, nuevo: d }]); return m === null ? { ok: true } : { ok: false, mensaje: m }; }],
  [
    "registrarVenta (caso de uso)",
    async (d) => {
      // El rechazo ocurre antes de abrir la transacción: no toca la base.
      // Un detalle que pasa la validación sigue hasta abrir la transacción (sin base, en este test, falla ahí): llegar a ese punto cuenta como «aceptado».
      try {
        const r = await registrarVentaCasoDeUso(
          { usuarioId: "u", sucursalId: "s", sucursalNombre: "S", transaccion: undefined } as unknown as Parameters<typeof registrarVentaCasoDeUso>[0],
          { fecha: AHORA_DE_LA_CORRIDA, seccionId: "s", ventas: [], detalle: d } as unknown as DatosVentaInput
        );
        return r.ok ? { ok: true } : { ok: false, mensaje: r.mensaje };
      } catch {
        return { ok: true };
      }
    },
  ],
];

const RESERVADOS = [
  detalleReversionDeVenta("ck123", new Date("2026-10-08T00:00:00Z")),
  detalleReversionDeCompra("ck456", new Date("2026-10-08T00:00:00Z"), "A-0001"),
  "Anulación de la venta cualquier cosa",
  "Anulación de la compra x",
  "   Anulación de la venta con espacios",
  "ANULACIÓN DE LA COMPRA en mayúsculas",
];

describe("el detalle reservado de las reversiones se rechaza en CADA comando con detalle libre", () => {
  for (const [nombre, correr] of COMANDOS) {
    it(`${nombre}: rechaza cada variante con el mismo mensaje`, async () => {
      for (const detalle of RESERVADOS) {
        const r = await correr(detalle);
        expect(r.ok, `${nombre} aceptó «${detalle}»`).toBe(false);
        expect(r.mensaje, `${nombre} con «${detalle}»`).toBe(MENSAJE_DETALLE_RESERVADO);
      }
    });

    it(`${nombre}: un detalle legítimo (común, que solo menciona una anulación, o vacío) sigue pasando`, async () => {
      for (const detalle of ["Rotura de un frasco", "Corrección posterior a la Anulación de la venta de ayer", "Anulación de la venta", ""]) {
        const r = await correr(detalle);
        if (!r.ok) expect(r.mensaje, `${nombre} rechazó «${detalle}»`).not.toBe(MENSAJE_DETALLE_RESERVADO);
        expect(r.mensaje === MENSAJE_DETALLE_RESERVADO, `${nombre} con «${detalle}»`).toBe(false);
      }
    });
  }
});

describe("validarDetalleLibreDeOperacion (la función compartida)", () => {
  it("vacío o ausente → null; recorta; largo > 200 → «largo»; reservado → «formato»", () => {
    expect(validarDetalleLibreDeOperacion(undefined)).toEqual({ ok: true, valor: null });
    expect(validarDetalleLibreDeOperacion("   ")).toEqual({ ok: true, valor: null });
    expect(validarDetalleLibreDeOperacion("  hola ")).toEqual({ ok: true, valor: "hola" });
    expect(validarDetalleLibreDeOperacion("x".repeat(201))).toMatchObject({ ok: false, codigo: "largo" });
    expect(validarDetalleLibreDeOperacion("Anulación de la venta z")).toEqual({ ok: false, codigo: "formato", mensaje: MENSAJE_DETALLE_RESERVADO });
  });
});

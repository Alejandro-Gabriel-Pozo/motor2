import type { PrismaClient } from "@prisma/client";
import { esNumeroFinito } from "@/core/numero";
import { importeDeLinea, redondearMoneda } from "@/core/moneda";

/**
 * Mapa de mesas del salón (módulo POS, docs/plan-mapa-de-mesas-2026-09-24.md).
 *
 * El estado de una mesa NO se persiste: se deriva de su `Cuenta` abierta (a lo sumo una por mesa, índice único parcial
 * `Cuenta_una_abierta_por_mesa_key`), mismo criterio del resto del repo de no materializar lo que se puede derivar. Sin
 * vencimiento automático (docs/grounding-pos-mesas-comandas-2026-09-24.md §2): el «hace N min» es solo informativo.
 *
 * Las cuentas y sus ítems los escriben las acciones de «tomar pedido» (src/server/actions/pos/cuenta-*.ts,
 * docs/plan-tomar-pedido-2026-09-25.md). Una anulación es una fila ESPEJO con cantidad negativa y el mismo `numeroEnvio` que su
 * original: sin tocar nada de acá, baja el total, no cuenta como «sin enviar» ni como un envío nuevo (test/pos/mesas.test.ts).
 */
export type EstadoMesa = "libre" | "en_pedido" | "ocupada";

const ESTADOS_MESA: readonly EstadoMesa[] = ["libre", "en_pedido", "ocupada"];

export function esEstadoMesa(valor: unknown): valor is EstadoMesa {
  return typeof valor === "string" && (ESTADOS_MESA as readonly string[]).includes(valor);
}

/** Lo único que la derivación necesita de cada ítem: si ya salió a cocina (`numeroEnvio` no nulo) o no. */
export interface ItemParaEstado {
  numeroEnvio: number | null;
}

/**
 * Regla de derivación (aceptada en el plan, §B):
 * - sin cuenta abierta → `libre`;
 * - abierta con algún ítem sin enviar, o sin ningún ítem enviado (incluye la cuenta recién abierta, sin ítems) → `en_pedido`;
 * - abierta con al menos un ítem enviado y ninguno sin enviar → `ocupada`.
 * Una segunda ronda en una mesa ocupada (ítems nuevos sin enviar) la vuelve a `en_pedido`.
 */
export function resolverEstadoMesa(cuentaAbierta: { items: readonly ItemParaEstado[] } | null | undefined): EstadoMesa {
  if (!cuentaAbierta) return "libre";
  const enviados = cuentaAbierta.items.filter((i) => i.numeroEnvio !== null).length;
  const sinEnviar = cuentaAbierta.items.length - enviados;
  return enviados > 0 && sinEnviar === 0 ? "ocupada" : "en_pedido";
}

export interface MesaEnMapa {
  id: string;
  numero: number;
  estado: EstadoMesa;
  /** Suma de `cantidad` de los ítems que todavía no salieron a cocina. */
  productosSinEnviar: number;
  /** Suma de `cantidad × precioUnitario` de todos los ítems de la cuenta abierta (0 si está libre). */
  total: number;
  /** Quién abrió la cuenta: su nombre, o la parte local del email si no tiene. `null` si la mesa está libre. */
  mesero: string | null;
  /** «hace N min» desde que se abrió la cuenta; `null` si la mesa está libre. */
  tiempoAbierta: string | null;
  /** Cuántos envíos a cocina distintos hubo (valores distintos de `numeroEnvio`). */
  pedidosEnviados: number;
}

export interface MetricasMapa {
  total: number;
  libres: number;
  enPedido: number;
  ocupadas: number;
}

export function calcularMetricas(mesas: readonly Pick<MesaEnMapa, "estado">[]): MetricasMapa {
  return {
    total: mesas.length,
    libres: mesas.filter((m) => m.estado === "libre").length,
    enPedido: mesas.filter((m) => m.estado === "en_pedido").length,
    ocupadas: mesas.filter((m) => m.estado === "ocupada").length,
  };
}

/** Texto informativo del tiempo que lleva abierta una cuenta: «hace instantes», «hace 42 min», «hace 1 h», «hace 2 h 5 min». */
export function tiempoDesde(abiertaEn: Date, ahora: Date): string {
  const minutos = Math.floor((ahora.getTime() - abiertaEn.getTime()) / 60_000);
  if (minutos < 1) return "hace instantes"; // también un reloj apenas adelantado (abiertaEn en el futuro)
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `hace ${horas} h ${resto} min` : `hace ${horas} h`;
}

/**
 * Filtros de la pantalla (vienen de la URL: `?estado=…&q=…`). `estado` desconocido = sin filtro. `q` busca por número de mesa
 * (los dígitos que contenga, así «3», «03» o «mesa 3» encuentran la 3; «1» encuentra la 1, la 10, la 21…) o por el nombre de
 * quien abrió la cuenta.
 */
export function filtrarMesas<T extends Pick<MesaEnMapa, "numero" | "estado" | "mesero">>(mesas: readonly T[], filtros: { estado?: string; q?: string }): T[] {
  const estado = esEstadoMesa(filtros.estado) ? filtros.estado : undefined;
  const q = (filtros.q ?? "").trim().toLocaleLowerCase("es-AR");
  const digitos = q.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return mesas.filter((m) => {
    if (estado && m.estado !== estado) return false;
    if (!q) return true;
    if (digitos && String(m.numero).includes(digitos)) return true;
    return Boolean(m.mesero && m.mesero.toLocaleLowerCase("es-AR").includes(q));
  });
}

const MAXIMO_LIMITE_MESAS_ABIERTAS = 9999;

/**
 * Límite de mesas ABIERTAS a la vez en una sucursal (`Sucursal.maxMesasAbiertas`, docs/plan-comensales-y-limite-mesas-2026-09-26.md):
 * `null` = sin límite (default, y también lo que deja vacío el campo del formulario). Si no es `null`, entero entre 1 y
 * {@link MAXIMO_LIMITE_MESAS_ABIERTAS} (mismo tope que `NUMERO_MESA_MAXIMO` en src/server/actions/pos/mesas.ts: no puede hacer falta
 * un límite mayor que la mesa más alta que se puede dar de alta).
 */
export function validarMaxMesasAbiertas(valor: unknown): { ok: true; limite: number | null } | { ok: false; mensaje: string } {
  if (valor === null) return { ok: true, limite: null };
  const n = typeof valor === "number" ? valor : Number.NaN;
  if (!Number.isInteger(n) || !esNumeroFinito(n) || n < 1 || n > MAXIMO_LIMITE_MESAS_ABIERTAS) {
    return { ok: false, mensaje: `El límite tiene que ser un número entero entre 1 y ${MAXIMO_LIMITE_MESAS_ABIERTAS}, o vacío para no tener límite.` };
  }
  return { ok: true, limite: n };
}

/** Nombre visible de un usuario del salón: su nombre, o la parte local del email si no tiene (lo reusa src/core/pos/cuenta.ts). */
export function nombreDelMesero(usuario: { name: string | null; email: string }): string {
  const nombre = usuario.name?.trim();
  return nombre || usuario.email.split("@")[0];
}

export interface MapaDeMesas {
  mesas: MesaEnMapa[];
  metricas: MetricasMapa;
  /** Número sugerido para la próxima mesa: el mayor + 1, o 1 si todavía no hay ninguna. */
  siguienteNumero: number;
}

/**
 * Todas las mesas de la sucursal, ordenadas por número, con su estado derivado — UNA sola consulta (mesas + cuenta abierta +
 * ítems + quién la abrió). La página la llama directo, después de `requierePermisoVer(…, "pos_mesas")`: no es una Server Action
 * de lectura (mismo patrón que stock/conteo-frecuencia/page.tsx con `sugerirInsumosClaseA`).
 */
export async function obtenerMapaDeMesas(sucursalId: string, db: PrismaClient, ahora: Date = new Date()): Promise<MapaDeMesas> {
  const filas = await db.mesa.findMany({
    where: { sucursalId },
    orderBy: { numero: "asc" },
    include: {
      cuentas: {
        where: { cerradaEn: null },
        include: {
          items: { select: { cantidad: true, precioUnitario: true, numeroEnvio: true } },
          abiertaPor: { select: { name: true, email: true } },
        },
      },
    },
  });

  const mesas = filas.map((fila): MesaEnMapa => {
    const cuenta = fila.cuentas[0] ?? null; // el índice único parcial garantiza a lo sumo una abierta
    const items = cuenta?.items ?? [];
    return {
      id: fila.id,
      numero: fila.numero,
      estado: resolverEstadoMesa(cuenta),
      // Redondeo a los 4 decimales de la columna (Decimal(14, 4)): la suma en coma flotante no deja «2,0000000001 productos».
      productosSinEnviar: Math.round(items.filter((i) => i.numeroEnvio === null).reduce((suma, i) => suma + Number(i.cantidad), 0) * 10_000) / 10_000,
      // Mismo criterio que obtenerDetalleDeMesa/ticket/cerrarCuenta: Σ importeDeLinea, no la suma cruda re-redondeada.
      total: redondearMoneda(items.reduce((suma, i) => suma + importeDeLinea(Number(i.cantidad), Number(i.precioUnitario)), 0)),
      mesero: cuenta ? nombreDelMesero(cuenta.abiertaPor) : null,
      tiempoAbierta: cuenta ? tiempoDesde(cuenta.abiertaEn, ahora) : null,
      pedidosEnviados: new Set(items.flatMap((i) => (i.numeroEnvio === null ? [] : [i.numeroEnvio]))).size,
    };
  });

  return {
    mesas,
    metricas: calcularMetricas(mesas),
    siguienteNumero: mesas.length ? Math.max(...mesas.map((m) => m.numero)) + 1 : 1,
  };
}

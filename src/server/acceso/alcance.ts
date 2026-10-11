import "server-only";
import type { Prisma } from "@prisma/client";
import { agregarSucursalAlContextoDeLaTransaccion, baseDeEmpresa, serializarSucursalesDelAlcance, type AlcanceDeSucursal } from "@/core/auth/base";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { AccionDeSucursal } from "@/core/permisos/acciones";
import { sucursalesVisiblesPara } from "./gate";

/**
 * ENSANCHES del alcance por sucursal (M.3, plan `plan-m3-rls-por-sucursal`, paso A4). El contexto del usuario arranca con `alcance = { lectura: [activa], escritura: [activa] }`
 * (`core/auth/contexto.ts`). Lo único que puede AGRANDARLO son estas cinco funciones, cada una para un caso cerrado, y ninguna da un valor «todas»: devuelven un contexto NUEVO con
 * una lista de ids más larga (la base —`db` y `transaccion`— se rearma con ella) y dejan intacto el que recibieron. Las políticas por sucursal de la Fase B leen esas listas; sin
 * ensanche, una lectura o una escritura fuera de la sucursal activa no ve ni toca filas (falla cerrado).
 *
 * Qué pide cada una (y qué guardián lo verifica, en las dos direcciones: `test/arquitectura/ids-de-sucursal-declaran-a-que-se-atan.test.ts`,
 * `escrituras-en-sucursal-desde-empresa.test.ts` y `ensanches-de-alcance.test.ts`):
 *  - `conAlcanceEnSucursal(ctx, S, modo)`: SOLO después de que el gate aprobó a ese usuario EN `S` (forma `SUCURSAL_CON_GATE`: lo hacen `requerirVerEnSucursal` y
 *    `requerirVerAlgunaEnSucursal`; `GATE_EN_ESA_SUCURSAL`: `conPermisoEnOtraSucursal`; `MEMBRESIA_EN_ORIGEN`: la lectura del origen de una copia). El modo es explícito: una puerta
 *    de «Ver» ensancha la LECTURA y nunca la escritura. Además exige membresía vigente en `S` (`ctx.membresias`), aunque el gate ya la mire: dos llaves.
 *  - `lecturaEnSucursalesVisibles(ctx, clave)`: la LECTURA se ensancha a las sucursales de las membresías del usuario donde el gate le da el «Ver» de `clave` (la intersección con
 *    `sucursalesVisiblesPara`); la clave va como texto literal en cada llamada. Las pantallas que juntan datos de varias sucursales.
 *  - `conEscrituraEnLaEmpresa(ctx)`: lectura y escritura en TODAS las sucursales de la empresa, como lista de ids leída en el momento. Solo para los archivos de empresa entera declarados
 *    (`EMPRESA_ENTERA` de `escrituras-en-sucursal-desde-empresa.test.ts`): el alta de un producto, el guardado de la receta central, el alta de una sucursal.
 *  - `incluirSucursalCreadaEnLaTransaccion(tx, id)`: suma la sucursal que ESTA transacción acaba de crear a las dos listas, dentro de ella (no sobrevive a la transacción). Solo desde el alta de sucursal.
 *
 * Un contexto SIN alcance (el que se arma a mano en una prueba, `BaseDelContexto.alcance` ausente) no se ensancha: se devuelve tal cual. Nunca queda con MÁS de lo que tenía.
 */

/** Lo que hace falta para rearmar la base de un contexto con otro alcance. */
type ConBase = Pick<ContextoUsuario, "empresaId" | "db" | "transaccion" | "alcance">;

/** Qué se ensancha en una sucursal que el gate aprobó: solo lectura (puertas de «Ver», origen de una copia) o también escritura (puertas de «Editar»). */
export type ModoDeAlcance = "LECTURA" | "LECTURA_Y_ESCRITURA";

const unir = (actual: readonly string[], nuevos: readonly string[]): string[] => [...new Set([...actual, ...nuevos])];

/** El mismo contexto con otra base (`db` y `transaccion`) armada con `alcance`; lo demás queda igual. */
function conAlcance<C extends ConBase>(ctx: C, alcance: AlcanceDeSucursal): C {
  return { ...ctx, ...baseDeEmpresa(ctx.empresaId, alcance) };
}

/**
 * Suma `sucursalId` al alcance, SOLO DESPUÉS de que el gate aprobó a este usuario en ella (el llamador lo hace antes; el guardián de arquitectura lo verifica por AST). Falla si el
 * usuario no tiene membresía vigente en esa sucursal. Si la sucursal ya está en el alcance con ese modo, devuelve el mismo contexto.
 */
export function conAlcanceEnSucursal<C extends ConBase & Pick<ContextoUsuario, "membresias">>(ctx: C, sucursalId: string, modo: ModoDeAlcance): C {
  if (!ctx.membresias.some((m) => m.sucursalId === sucursalId)) throw new Error("No tenés acceso a esa sucursal.");
  const alcance = ctx.alcance;
  if (!alcance) return ctx;
  const conEscritura = modo === "LECTURA_Y_ESCRITURA";
  if (alcance.lectura.includes(sucursalId) && (!conEscritura || alcance.escritura.includes(sucursalId))) return ctx;
  return conAlcance(ctx, { lectura: unir(alcance.lectura, [sucursalId]), escritura: conEscritura ? unir(alcance.escritura, [sucursalId]) : alcance.escritura });
}

/**
 * Ensancha la LECTURA a las sucursales de las membresías del usuario donde puede VER `clave` (el gate, `sucursalesVisiblesPara`), además de la activa. La escritura no cambia. La clave
 * tiene que ser un texto literal en la llamada (lo exige `ensanches-de-alcance.test.ts`): de ella sale qué sucursales se ven.
 */
export async function lecturaEnSucursalesVisibles<C extends ConBase & Pick<ContextoUsuario, "usuarioId" | "membresias">>(ctx: C, clave: AccionDeSucursal): Promise<C> {
  const alcance = ctx.alcance;
  if (!alcance) return ctx;
  const visibles = await sucursalesVisiblesPara(ctx, clave);
  const lectura = unir(alcance.lectura, visibles.map((s) => s.id));
  return lectura.length === alcance.lectura.length ? ctx : conAlcance(ctx, { lectura, escritura: alcance.escritura });
}

/**
 * Ensancha lectura y escritura a TODAS las sucursales de la empresa (las ids se leen en este momento, `Sucursal` no depende del alcance), y devuelve además esa lista
 * (`sucursalIdsDeLaEmpresa`, en el orden de la base) para que quien siembra una fila por sucursal no tenga que leerla otra vez. Solo para los archivos de empresa entera declarados.
 */
export async function conEscrituraEnLaEmpresa<C extends ConBase>(ctx: C): Promise<C & { sucursalIdsDeLaEmpresa: readonly string[] }> {
  const sucursalIdsDeLaEmpresa = (await ctx.db.sucursal.findMany({ where: { empresaId: ctx.empresaId }, select: { id: true }, orderBy: { id: "asc" } })).map((s) => s.id);
  if (!ctx.alcance) return { ...ctx, sucursalIdsDeLaEmpresa };
  return { ...conAlcance(ctx, { lectura: unir(ctx.alcance.lectura, sucursalIdsDeLaEmpresa), escritura: unir(ctx.alcance.escritura, sucursalIdsDeLaEmpresa) }), sucursalIdsDeLaEmpresa };
}

/**
 * Dentro de la transacción `tx` que acaba de CREAR la sucursal `sucursalId`, la suma a las dos listas del alcance (la lista que se fijó al abrir la transacción no la conocía). Vale solo
 * hasta que la transacción termine. Falla si el id no tiene la forma de un id de sucursal o si esa sucursal no existe en esta transacción (y empresa). Solo desde el alta de sucursal.
 */
export async function incluirSucursalCreadaEnLaTransaccion(tx: Prisma.TransactionClient, sucursalId: string): Promise<void> {
  serializarSucursalesDelAlcance([sucursalId]);
  const existe = await tx.sucursal.findUnique({ where: { id: sucursalId }, select: { id: true } });
  if (!existe) throw new Error("La sucursal que se quiere incluir en el alcance no existe en esta transacción.");
  await agregarSucursalAlContextoDeLaTransaccion(tx, sucursalId);
}

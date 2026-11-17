/**
 * ORÁCULO de la etapa C2c (hora de corte de la sucursal), escrito APARTE del código (regla de combinaciones del dueño, 2026-10-28).
 *
 * 1. QUIÉN puede cambiar la hora: la acción es `renombrar_sucursal` (contexto empresa, piso `administrador_sistema`, semilla `admin`; dueño 2026-11-17, «5.- recomendado»: el MISMO
 *    permiso que renombrar, sin permiso nuevo). Dimensiones que cambian el permiso: el rol de la membresía (admin / operador / rol propio sin clave / ninguna), la fila de la matriz
 *    (sin fila, solo ver, editar apagada, editar prendida) y el rol de empresa (gerente / usuario / ninguno). Regla esperada: se permite SI Y SOLO SI el usuario tiene una membresía con
 *    rol `admin` (el piso) Y la fila de ese rol tiene «editar» prendido. El rol de empresa «gerente» NO habilita por sí solo (para una acción de piso `administrador_sistema`) y la fila
 *    prendida a mano en un operador o un rol propio NO alcanza (el piso manda sobre la matriz).
 * 2. QUÉ horas son válidas: `HH:MM` estricto, 00:00 a 23:59 (1440 válidas); lo demás se rechaza.
 */

export const ROLES_DE_MEMBRESIA = ["admin", "operador", "propio", "ninguno"] as const;
export type RolDeMembresia = (typeof ROLES_DE_MEMBRESIA)[number];

export const FILAS_DE_LA_MATRIZ = ["sin_fila", "solo_ver", "editar_apagada", "editar_prendida"] as const;
export type FilaDeLaMatriz = (typeof FILAS_DE_LA_MATRIZ)[number];

export const ROLES_DE_EMPRESA = ["gerente", "usuario", "ninguno"] as const;
export type RolDeEmpresa = (typeof ROLES_DE_EMPRESA)[number];

export interface CombinacionDeAcceso { rolDeMembresia: RolDeMembresia; fila: FilaDeLaMatriz; rolDeEmpresa: RolDeEmpresa }

/** La regla esperada, escrita a mano: no se deriva del código de permisos. */
export function permitidoEsperado(c: CombinacionDeAcceso): boolean {
  return c.rolDeMembresia === "admin" && c.fila === "editar_prendida";
}

/** Los siete casos con nombre de la tabla del diseño (2b). */
export const CASOS_DEL_DISENO: ReadonlyArray<{ nombre: string; combinacion: CombinacionDeAcceso; permitido: boolean }> = [
  { nombre: "gerente con membresía de rol admin y la fila semilla", combinacion: { rolDeMembresia: "admin", fila: "editar_prendida", rolDeEmpresa: "gerente" }, permitido: true },
  { nombre: "administrador (rol admin, fila semilla)", combinacion: { rolDeMembresia: "admin", fila: "editar_prendida", rolDeEmpresa: "usuario" }, permitido: true },
  { nombre: "administrador con la fila Editar apagada", combinacion: { rolDeMembresia: "admin", fila: "editar_apagada", rolDeEmpresa: "usuario" }, permitido: false },
  { nombre: "gerente SIN membresía de rol admin (operador)", combinacion: { rolDeMembresia: "operador", fila: "sin_fila", rolDeEmpresa: "gerente" }, permitido: false },
  { nombre: "operador sin fila", combinacion: { rolDeMembresia: "operador", fila: "sin_fila", rolDeEmpresa: "usuario" }, permitido: false },
  { nombre: "operador con la fila prendida a mano", combinacion: { rolDeMembresia: "operador", fila: "editar_prendida", rolDeEmpresa: "usuario" }, permitido: false },
  { nombre: "rol propio con la fila prendida a mano", combinacion: { rolDeMembresia: "propio", fila: "editar_prendida", rolDeEmpresa: "usuario" }, permitido: false },
  { nombre: "sin membresía", combinacion: { rolDeMembresia: "ninguno", fila: "sin_fila", rolDeEmpresa: "ninguno" }, permitido: false },
];

/** Horas inválidas típicas (no texto incluido). */
export const HORAS_INVALIDAS: readonly unknown[] = ["24:00", "6:00", "06:00:00", "", "06:0", "6:0", "0600", "06-00", "06:60", "23:60", "99:99", " 06:00", "06:00 ", "06:00\n", "-1:00", "ab:cd", "０６:００", null, undefined, 600, 6.5, true, {}, [], ["06:00"]];

/** Las 1440 horas válidas, por construcción independiente del validador. */
export function todasLasHorasValidas(): string[] {
  const r: string[] = [];
  for (let m = 0; m < 1440; m++) r.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return r;
}

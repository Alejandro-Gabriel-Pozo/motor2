import { LARGO_MAXIMO_SLUG_TENANT } from "./validaciones";

/**
 * Slug de las sucursales del portal (docs/plan-registro-tenants-2026-09-24.md, M2; ADR-006 Fase 8 borró el contrato HTTP
 * `RegistroTenantsV1` que consumía la app externa). Puro, sin Prisma.
 */

/**
 * Slug de una sucursal a partir de su nombre (decisión D2): sin diacríticos (NFD, mismo criterio que `normalizarNombreGrupo`),
 * minúsculas, todo lo que no sea `[a-z0-9]` pasa a `-`, sin guiones repetidos ni en los extremos, a lo sumo 60 caracteres. Si no
 * queda nada, "sucursal". Se calcula UNA vez al agregar la sucursal al portal y queda guardado: renombrar la sucursal no cambia
 * la URL pública.
 */
export function slugTenant(nombre: string): string {
  const s = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LARGO_MAXIMO_SLUG_TENANT)
    .replace(/-+$/, "");
  return s || "sucursal";
}

/**
 * `base` si está libre; si no, `base-2`, `base-3`… (recortando `base` para no pasar de 60 caracteres). Dos nombres que solo
 * difieren en mayúsculas o tildes ("Villa La Angostura" / "Villa la Angostura") dan el mismo slug base: el segundo lleva `-2`.
 */
export function slugTenantUnico(base: string, ocupados: ReadonlySet<string>): string {
  if (!ocupados.has(base)) return base;
  for (let n = 2; ; n++) {
    const sufijo = `-${n}`;
    const candidato = `${base.slice(0, LARGO_MAXIMO_SLUG_TENANT - sufijo.length).replace(/-+$/, "")}${sufijo}`;
    if (!ocupados.has(candidato)) return candidato;
  }
}

// Reemplaza `next/headers` en tests (alias en vitest.config.ts) — mismo
// motivo que el stub de `server-only`: `cookies()` real revienta fuera de
// un request de Next.js real, y acá los server actions/funciones de auth
// se importan directo bajo Node/Vitest. `__setCookieDeTestParaSucursal`
// es el hook explícito para que un test simule "el usuario ya eligió esta
// sucursal" (ver test/auth/contexto.test.ts).
let cookieSucursalActiva: string | undefined;

export function __setCookieDeTestParaSucursal(valor: string | undefined) {
  cookieSucursalActiva = valor;
}

export async function cookies() {
  return {
    get: (nombre: string) => (nombre === "sucursalActivaId" && cookieSucursalActiva !== undefined ? { name: nombre, value: cookieSucursalActiva } : undefined),
    set: () => {},
  };
}

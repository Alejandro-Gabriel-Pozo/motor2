// Reemplaza `next/headers` en tests (alias en vitest.config.ts) — mismo
// motivo que el stub de `server-only`: `cookies()` real revienta fuera de
// un request de Next.js real, y acá los server actions/funciones de auth
// se importan directo bajo Node/Vitest. `__setCookieDeTestParaSucursal`
// es el hook explícito para que un test simule "el usuario ya eligió esta
// sucursal" (ver test/auth/contexto.test.ts).
let cookieSucursalActiva: string | undefined;
let cookieEmpresaActiva: string | undefined;

export function __setCookieDeTestParaEmpresa(valor: string | undefined) {
  cookieEmpresaActiva = valor;
}

export function __setCookieDeTestParaSucursal(valor: string | undefined) {
  cookieSucursalActiva = valor;
}

export async function cookies() {
  return {
    get: (nombre: string) => {
      if (nombre === "sucursalActivaId" && cookieSucursalActiva !== undefined) return { name: nombre, value: cookieSucursalActiva };
      if (nombre === "empresaActivaId" && cookieEmpresaActiva !== undefined) return { name: nombre, value: cookieEmpresaActiva };
      return undefined;
    },
    set: (nombre: string, valor: string, opciones?: Record<string, unknown>) => {
      cookiesEscritas.set(nombre, valor);
      opcionesEscritas.set(nombre, opciones ?? {});
    },
    delete: (nombre: string) => {
      cookiesBorradas.push(nombre);
    },
  };
}

// Lo que un server action escribió/borró en las cookies — para verificar cambiarEmpresaActiva sin un request real.
const cookiesEscritas = new Map<string, string>();
const opcionesEscritas = new Map<string, Record<string, unknown>>();
const cookiesBorradas: string[] = [];

export function __cookiesDeTest() {
  return { escritas: cookiesEscritas, opciones: opcionesEscritas, borradas: cookiesBorradas };
}

export function __limpiarCookiesDeTest() {
  cookieSucursalActiva = undefined;
  cookieEmpresaActiva = undefined;
  cookiesEscritas.clear();
  opcionesEscritas.clear();
  cookiesBorradas.length = 0;
}

// `headers()` de Next: por defecto, sin encabezados. `__setHeadersDeTest` deja simular, por ejemplo, un `Referer` (ver test/auth/ir-al-login.test.ts).
let headersDeTest: Record<string, string> = {};

export function __setHeadersDeTest(valores: Record<string, string>) {
  headersDeTest = valores;
}

export async function headers() {
  return new Headers(headersDeTest);
}

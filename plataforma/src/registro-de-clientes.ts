/**
 * Un cliente de base por instalación (ADR-025), creado recién la primera vez que se lo pide y guardado por id. Es PURO: la fábrica entra por parámetro, así que se prueba sin base.
 * Si la URL de una instalación cambia (otro valor de la variable en un redeploy en caliente), el cliente viejo se descarta y se crea uno nuevo.
 */
export interface RegistroDeClientes<C> {
  obtener(id: string, url: string): C;
}

export function crearRegistroDeClientes<C>(fabrica: (url: string) => C): RegistroDeClientes<C> {
  const guardados = new Map<string, { url: string; cliente: C }>();
  return {
    obtener(id, url) {
      const existente = guardados.get(id);
      if (existente && existente.url === url) return existente.cliente;
      const cliente = fabrica(url);
      guardados.set(id, { url, cliente });
      return cliente;
    },
  };
}

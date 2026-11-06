# Catálogo por módulo: Reportes, fiscal y primitivas transversales (2026-11-06)

**Estado:** inventario de SOLO LECTURA (orden del dueño: sin implementar). Base: `main` `50c1153`. Todo es PROPUESTA salvo lo marcado. Lo no comprobado va como NO VERIFICADO. Diseño de partida: `origin/alegp/diseno-flujos-y-pasos` (`docs/diseno-flujos-y-pasos-2026-11-06.md`).

## 1. Flujos del módulo (PROPUESTA; el dueño los nombra)

Los reportes no tienen pasos propios: son LECTURAS al final de otros flujos. Cada uno se declara por la pregunta que responde y los flujos de los que sale.

| Reporte (consulta → pantalla) | Pregunta que responde | Sale de (flujo de origen) | Pasos |
|---|---|---|---|
| Por período (`consultas/reportes/periodo.ts` → `reportes/periodo`) | ¿Cuánto vendí, gasté y gané en el rango? | venta, compra, receta | no tiene |
| Resumen operativo / consolidado (`resumen-operativo.ts`, `resumen-consolidado.ts`) | ¿Cómo está la sucursal / todas hoy? | venta, compra, stock | no tiene |
| Compras registradas (`compras-registradas.ts` → `reportes/compras`) | ¿Qué facturas cargué y cuáles están anuladas? | compra (`FacturaProveedor`) P1 a P4 | muestra el estado de los pasos (pendiente de reparto, confirmada, anulada) |
| Costos y márgenes (`costos.ts`), margen real, de promos, de descuentos | ¿Cuánto cuesta y deja cada producto? | receta + compra + venta | no tiene |
| Valuación, vencimientos, diferencias, consignación, pérdidas, trazabilidad, historial | ¿Qué stock tengo, qué se pierde, qué vence? | stock, conteo, consignación | no tiene |
| Tickets emitidos (`tickets-emitidos.ts:76,99`) | ¿Qué ticket se imprimió y cómo? | cuenta del salón (`nombreEnTicket`) | no tiene |
| Rotación de mesas, ventas por opción/sección, sin receta, huecos de catálogo | ¿Qué rota, qué falta cargar? | venta, catálogo | no tiene |

Flujo fiscal (compra, M3d/ADR-029, `FacturaProveedor`): los datos fiscales (`letra`, `importeNeto`, `importeIva`, `condicionIvaEmpresa`, renglones con `alicuotaIva`) hoy son OPCIONALES (perilla `Empresa.llevaIvaDeCompras`, `schema.prisma:2510` aprox.). Paso donde se completan: PENDIENTE; el dueño no lo nombró.

## 2. Columnas

Clases del guardián: lo que exista en `columnas-del-esquema`/`clasificacion` de `test/arquitectura` es NO VERIFICADO acá (no lo abrí); la columna «clase» va como la propone esta nota.

| Modelo.columna | Flujo | Para qué | Escritor | Lectores | Clase (propuesta) | Observación |
|---|---|---|---|---|---|---|
| FacturaProveedor.importeTotal | compra P1 | deuda con el proveedor | `persistencia/compras/escribir-factura-proveedor.ts` | `reportes/compras-registradas.ts`, `periodo-compras` | dinero | «Nunca se modifica» (schema) |
| FacturaProveedor.anuladaEn | compra/salida | sacar la compra del gasto | anulación de compra | ≥10 consultas (§4) | dinero + stock | filtro repetido, ver §4 |
| FacturaProveedor.condicionPago | compra P4 | qué se debe y qué se pagó | `registrar-factura-proveedor.ts` | `reportes/compras-registradas.ts` | dinero | |
| FacturaProveedor.nroFacturaNormalizado | compra P1 | unicidad por proveedor | `escribir-factura-proveedor.ts` | `comprobante-en-la-empresa.ts` | ninguna | Lo calcula `core/compras/numero-de-comprobante.ts` |
| FacturaProveedor.fechaComprobante | compra P1 | «solo dato» | NO ENCONTRÉ escritor en `src/` (grep -w) | ninguno | ninguna | Columna sin uso (NO VERIFICADO si se escribe por SQL crudo) |
| FacturaProveedor.importeNeto / importeIva / condicionIvaEmpresa | compra (fiscal) | desglose de IVA | ninguno en `src/` ("Nada de src/ la escribe todavía (Etapa C)", schema NotaCrédito) | ninguno | dinero | CHECK en la base, sin escritor: no se puede completar nunca |
| FacturaProveedorRenglon.alicuotaIva / importeNeto / importeIva / importeIvaComputable | compra (fiscal) | IVA computable | ninguno en `src/` | ninguno | dinero | idem |
| FacturaProveedor.fechaPagoDeclarada / medioPagoDeclarado | compra P4 | (reemplazadas por `PagoDeFacturaProveedor`) | nadie | nadie | — | El schema ya las declara «SIN USO… candidata a poda en X3» |
| Empresa.condicionIva | fiscal | falla cerrado si NULL | la plataforma (script) | `core/fiscal/iva.ts` (tipo) | permisos | lectores en `src/`: NO VERIFICADO |
| Empresa.llevaIvaDeCompras | fiscal | perilla de IVA | la plataforma | NO VERIFICADO | — | |
| Proveedor.cuit / Empresa.cuit | fiscal | identificar | formularios; `core/fiscal/cuit.ts` | `diagnostico-cuit.ts` | — | |
| Producto.alicuotaIvaVenta | producto vendible V2 | IVA de venta | nadie (hallazgo ya anotado en el diseño de flujos) | `core/fiscal/alicuota-de-linea-de-venta.ts`, `pos/alicuotas-de-combo.ts`, `lecturas/carta/componentes-de-promo.ts` | dinero | Se lee, no se escribe: V2 no se completa |
| Producto.alicuotaIvaCompra | compra | IVA de compra | nadie | solo `core/fiscal/iva.ts` (comentario) | — | Sin uso en `src/` |
| CuentaItem.nombreEnTicket | cuenta del salón | reimprimir como se imprimió | `pos` | `reportes/tickets-emitidos.ts:76,99` | ninguna | El schema dice que reportes no la leen: contradice el código |
| Empresa.zonaHoraria | todos | corte de día | perfil de empresa | `sesion/contexto.ts` (`ctx.empresaZonaHoraria`), páginas de reportes | fechas | Ver fuente de verdad §4 |

Los reportes NO tienen columnas propias: ningún reporte persiste nada (§5). Las columnas que cada reporte lee se listan en las consultas `src/server/consultas/reportes/*.ts`; el relevamiento columna por columna de los ~32 reportes es NO VERIFICADO (no se hizo exhaustivo en esta pasada).

## 3. Funciones y primitivas (el catálogo que hoy no existe)

| Primitiva | Archivo | Qué hace | Copias o variantes (archivo:línea) | ¿Fuente única declarada? | Usos |
|---|---|---|---|---|---|
| Redondeo de dinero | `core/moneda.ts:41` `redondearMoneda` | centavos, medio hacia afuera, Decimal | `Math.round(n*100)/100` sigue en `core/carta/validaciones.ts:171`; `core/catalogo/cambio-de-precio.ts:23` (`Math.round(despues*100)`) | Sí, en comentario de `moneda.ts:10`; sin guardián | NO VERIFICADO el conteo |
| Reparto «por mayor resto» (importe) | `core/moneda.ts:117` `repartirImporte` | reparte pesos en centavos | `core/compras/reparto-de-factura.ts:26` `repartirEnteros` (misma lógica, misma regla de desempate) y `:60` `repartirCantidad` | NO: dos copias | `repartirImporte` en promo/combo (Task #16); `repartirEnteros` en reparto de factura; conteo de usos NO VERIFICADO |
| Pasar a centavos | `core/moneda.ts:33` `aCentavos` (privada, Decimal) | número→entero | `core/compras/reparto-de-factura.ts:23` `aCentavos` (exportada, otro Decimal clonado); `core/datos/importe.ts:67` `centavosDeImporte` | NO: tres versiones | — |
| Redondeo de porcentaje a 1 decimal | no existe | `Math.round(x/y*1000)/10` | ~40 líneas, p. ej. `core/reportes/costos.ts:221,222,381,382`, `periodo-margen.ts:148`, `periodo-compras.ts:143`, `server/consultas/reportes/periodo-margen.ts:77,123-156`, `descuentos-clientes.ts:115-134`, `margen-promociones.ts:114-118`, `descuentos-productos.ts:7`, `periodo-ratio.ts:60`, `periodo-precios.ts:104,165,221`, `margen-real.ts:67`, `rotacion-mesas.ts:35`, `rendimiento-recetas-vistas.ts:73,90`, `indices-economicos.ts:151` | NO | cuenta propia: grep, incluye algún no-porcentaje |
| Porcentaje de margen (`margen/ingreso`) | no existe | | `costos.ts:221`, `periodo-margen.ts:148` (core), `server/.../periodo-margen.ts:77,123`, `margen-promociones.ts:116`, `descuentos-clientes.ts:117,119` | NO | |
| redondearCantidad | `core/reportes/redondeo.ts:2` (3 decimales) | | 3 dec.: `rendimiento-conciliado.ts:32`, `historial-vistas.ts:12`, `rendimiento-recetas-vistas.ts:19`; 4 dec.: `core/pos/cuenta.ts:27`, `core/pos/comanda.ts:17` (`Math.round(n*10_000)/10_000`) | Parcial: `redondeo.ts` dice ser el puro, 3 reportes igual lo redefinen | 6 definiciones |
| Formato de dinero/cantidad | `core/pos/formato.ts:9,13` (`MONEDA` ARS 0–2 dec; `CANTIDAD` 4 dec.) | | `toLocaleString("es-AR")`: 143 usos en 66 archivos (grep exacto); constantes locales: `reportes/compras/page.tsx:24` `plata`, `catalogo/proveedores/[id]/page.tsx:16` `plata`, `catalogo/productos/[id]/page.tsx:22` `plata`, `reportes/periodo/tabla-periodo.tsx:80` `pesos` (¡divide por 100: centavos!), `carta/page.tsx:45` `pesos` (con espacio), `carta/agrupados/page.tsx:48`, `producto-form.tsx:52` (2 dec.), `bloque-de-reparto.tsx:23` (2 dec.), `components/carta/sincronizar-precio-grupo.tsx:8`, `agregar-opcion-item-agrupado-carta.ts:12`, `rotacion-mesas/page.tsx:11-12`, `actions/pos/cuenta-comun.ts:23` | NO (estilos: `$n`, `$ n`, 0–2 dec., 2 fijos, ARS currency) | |
| Normalizador «sin tilde y minúscula» | no existe | NFD + quitar diacríticos + minúscula | `opciones-agotadas.tsx:26`, `navegacion/buscar-pantalla.ts:5`, `carta/registro-tenants.ts:16`, `carta/nombre-en-carta.ts:9`, `carta/mantenimiento.ts:95` (+`.trim()`), `catalogo/no-comestibles.ts:22` (regex `̀-ͯ` en vez de `\p{Diacritic}`) | NO: 6 copias, 2 regex distintas, solo una hace `trim` | `core/texto.ts:50 textoDeBusqueda` NO es esto (quita caracteres para Postgres) |
| Texto limpio | `core/texto.ts:5` `texto` | trim/colapso | — | Sí | NO VERIFICADO |
| Número tecleado es-AR | `core/datos/numero-tecleado.ts:41,172` | interpreta `1.234,5` | — | Sí (`CONTEXTO_IMPORTE` 2 dec., `CONTEXTO_CANTIDAD_SIN_UNIDAD` 4 dec. `:87-90`) | |
| Validación de importe | `core/datos/importe.ts:49` `validarImporte`, `IMPORTE_MAXIMO` | | 7 validadores locales según `test/arquitectura/cerco-primitivas-de-dominio.test.ts:19` | Sí, congelada por cerco | |
| «Hoy» / corte de día | `core/tiempo/zona-horaria.ts` (`diaDeCalendario:78`, `inicioDelDia:111`, `rangoDeDias:151`) | | `ZONA_ARGENTINA` aparece en 43 archivos de `src/` (33 fuera de `core`), casi todos como valor por defecto de un parámetro `zona` (p. ej. `periodo.ts:28,52,96,197`, `resumen-consolidado.ts:39`, `periodo-precios.ts:156`) | Sí (la zona real es `Empresa.zonaHoraria`) | ver §4 |
| Alícuotas y condiciones de IVA | `core/fiscal/iva.ts:11,19` | listas cerradas | — | Sí | Solo listas: NO existe función de cálculo de IVA/neto en `src/` (grep de 1.21/0.21 sin resultados de dominio) |
| CUIT | `core/fiscal/cuit.ts:10-37` | normaliza/valida/formatea | — | Sí | |
| Número de comprobante | `core/datos/numero-comprobante.ts`, `core/datos/nro-factura.ts`, `core/compras/numero-de-comprobante.ts:13` | | tres archivos para lo mismo (`LARGO_MAXIMO_NRO_FACTURA=60` en `core/texto.ts:84`) | Parcial | |
| Excel | `core/excel.ts:91` `generarExcel` | | único consumidor `components/tabla-reporte.tsx` | Sí | |
| Estadística | `core/estadistica/mediana.ts`, `minimos-cuadrados.ts` | | | Sí | `mediana` en `historial-vistas.ts:3`, `rendimiento-recetas-vistas.ts:2`; `minimos-cuadrados` en `consultas/reportes/rendimiento-recetas.ts:9` |
| `nombreDeCarta` | `core/carta/armar-menu.ts:289` | | el diseño de flujos habla de 4 copias: solo verifiqué una definición por nombre exacto; el resto NO VERIFICADO (otras variantes pueden tener otro nombre) | | |

## 4. Fuentes de verdad (mismo número, criterios distintos)

| Número | Dónde se calcula | Diferencia | Evidencia |
|---|---|---|---|
| Margen | `core/reportes/costos.ts:202,220` (precio de carta − costo), `core/reportes/periodo-margen.ts:135,154` (ventas del período, costo nominal), `server/consultas/reportes/margen-real.ts:65` y `periodo-margen.ts:73` (costo REAL de lo vendido), `margen-promociones.ts:103-104`, `descuentos-clientes.ts` (a lista vs cobrado), IPC en `periodo-margen.ts:117` | al menos 5 definiciones de «margen» con costo y base distintos; ninguna llama a otra | las líneas citadas |
| Costo | `core/reportes/costos.ts`, `costo-historico.ts`, `lecturas/reportes/costos.ts`, `margen-real` | costo de receta actual vs histórico vs real; relación entre ellos NO VERIFICADO | |
| Anuladas | filtro `anuladaEn: null` repetido en ≥10 consultas de reportes (`vencimientos.ts`, `costo-historico.ts`, `descuentos-productos.ts`, `margen-promociones.ts`, `descuentos-clientes.ts`, `rendimiento-recetas.ts`, `periodo-ratio.ts`, `perdidas.ts`, `huecos-catalogo.ts`) más `consultas/movimientos/facturas-proveedor.ts`, `consultas/stock/sugerencia-clase-a.ts`, 6 archivos en `persistencia/`; el guardián `test/arquitectura/reportes-compras-anuladas.test.ts:15` tiene `RAIZ = src/core/reportes`: NO mira `src/server/consultas/reportes`, donde está el filtro real | olvidar el filtro en una consulta nueva de `server/` no lo detecta nadie | archivos por grep `anulad` |
| Saldo / deuda | `reportes/compras-registradas.ts` (condicionPago) vs `PagoDeFacturaProveedor` | el reporte de compras no muestra saldo; dónde se calcula el saldo de proveedor: NO VERIFICADO | |
| Zona horaria | `Empresa.zonaHoraria` (`schema.prisma:2497`, `NOT NULL`) llega por `ctx.empresaZonaHoraria` (`reportes/periodo/page.tsx:37`) | las consultas siguen con `zona = ZONA_ARGENTINA` por defecto: una llamada que olvide el argumento corta el día en Buenos Aires aunque la empresa tenga otra zona | `periodo.ts:28`. Qué páginas olvidan pasarla: NO VERIFICADO |
| Cantidades | 3 decimales en reportes, 4 en POS y en el campo tecleado | una cantidad de POS con 4 decimales se muestra/redondea a 3 en el reporte | §3 |

## 5. Escrituras de más

- En lecturas y reportes: NINGUNA encontrada. Grep de `create|update|upsert|delete|$executeRaw|INSERT|UPDATE` sobre `src/server/consultas/reportes`, `src/server/lecturas`, `src/core/reportes`: solo `enCurso.delete(productoId)` (`core/reportes/costos.ts:63`, un `Set` en memoria, no es base).
- Columnas fiscales que ningún código escribe pese a tener CHECK/constraint en la base (§2): `importeNeto`, `importeIva`, `condicionIvaEmpresa`, `fechaComprobante`, `alicuotaIva*` de factura. Es lo contrario (columna sin escritor), anotado como deuda.

## 6. Invariantes

| Regla | Documento | Test |
|---|---|---|
| Toda consulta de reporte de COMPRA/VENTA decide qué hace con las anuladas | cabecera de `reportes-compras-anuladas.test.ts` | `test/arquitectura/reportes-compras-anuladas.test.ts` (solo `src/core/reportes`) y `test/reportes/compras-anuladas.test.ts` |
| Importes y porcentajes se validan solo con `core/datos/importe.ts` | cabecera del cerco | `test/arquitectura/cerco-primitivas-de-dominio.test.ts` (solo importes y porcentajes) |
| El total de la página de compras se redondea bien | — | `test/reportes/compras-total-de-pagina-redondeo.test.ts` |
| El día de una compra se lee en la zona de la empresa | comentario `reportes/compras/page.tsx:52` | `test/reportes/compras-pagina-dia-en-la-zona.test.ts` |
| Reparto exacto: la suma de las partes da el total | doc de `moneda.ts:105-116` | NO VERIFICADO el test |
| Food cost objetivo en un solo lugar | — | `test/arquitectura/food-cost-objetivo-en-un-solo-lugar.test.ts` |
| Reportes con la carga única del catálogo | — | `test/reportes/carga-unica-catalogo.test.ts` |
| Un solo formato de dinero / un solo redondeo de porcentaje / un solo normalizador de texto | no declarada | SIN TEST |
| Toda consulta de `server/consultas/reportes` filtra anuladas | no declarada | SIN TEST (el guardián no llega) |
| Margen igual en dos reportes para el mismo producto y período | no declarada | SIN TEST |
| Consultas de reporte reciben la zona de la empresa | no declarada | SIN TEST |
| Un reporte no escribe | implícita | SIN TEST (solo este grep) |
| Conjunto de reportes con pruebas | — | 95 archivos `*reporte*` en `test/` (cuenta por nombre de ruta) |

## 7. Deuda

| Ítem | ¿Vencimiento? | Dónde |
|---|---|---|
| 7 validadores locales de importe/porcentaje | meta «bajar en la Fase 2», sin fecha | `cerco-primitivas-de-dominio.test.ts` (meta) |
| `fechaPagoDeclarada` y `medioPagoDeclarado` | «poda en X3», sin fecha | `schema.prisma` (FacturaProveedor) |
| Columnas fiscales sin escritor («Etapa C») | sin fecha | `schema.prisma` (FacturaProveedor, NotaCreditoProveedor) |
| Reparto «mayor resto» duplicado, tres `aCentavos`, 6 `redondearCantidad`, ~40 redondeos de porcentaje, 6 normalizadores, ≥12 formatos de dinero | sin lista de deuda ni fecha | no declarado (§3) |
| Guardián de anuladas sin cobertura de `server/consultas/reportes` | sin fecha | `reportes-compras-anuladas.test.ts:15` |

## 8. Interfaces con otros módulos (no inventariadas acá)

- Compras: `FacturaProveedor*`, `core/compras/reparto-de-factura.ts`, `numero-de-comprobante.ts` (copia del reparto, §3).
- POS/caja: `core/pos/formato.ts`, `cuenta.ts`, `comanda.ts` (`redondearCantidad` a 4), `CuentaItem.nombreEnTicket`.
- Carta/catálogo: `core/carta/*` (normalizadores, `nombreDeCarta`), `Producto.alicuotaIvaVenta`.
- Stock, recetas, promos: fuentes de los reportes de costo, valuación, vencimientos, margen de promociones.
- Plataforma: `Empresa.condicionIva`, `llevaIvaDeCompras`, `zonaHoraria` (cargadas por script de plataforma / perfil).
- Sesión: `ctx.empresaZonaHoraria` (`server/sesion/contexto.ts`).

## 9. NO VERIFICADO

- Conteo de usos de cada primitiva (solo contados los pedidos).
- Si `nombreDeCarta` tiene 4 copias (solo hallé 1 por nombre exacto).
- Clase de cada columna en el guardián de esquema (no abrí `test/arquitectura/columnas-del-esquema`).
- Si `importeNeto`, `importeIva`, `condicionIvaEmpresa`, `fechaComprobante` se escriben por SQL crudo o `plataforma/`.
- Lectores de `Empresa.condicionIva` y `llevaIvaDeCompras`.
- Cuántas páginas de reportes no pasan la zona de la empresa.
- Dónde se calcula el saldo de un proveedor; relación exacta entre los 5 «márgenes».
- Que los tests de §6 cubran lo que dice su nombre (no los corrí ni los leí enteros).
- Cuántos de los ~40 redondeos de porcentaje son realmente porcentajes (el grep trae alguno que no).

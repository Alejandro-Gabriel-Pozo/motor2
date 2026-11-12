# G. Pedernal: lo que dice el CÓDIGO REAL (verificación de E-pedernal-docs.md)

Repo leído (solo lectura): `/home/user/alejandro-gabriel-pozo/zuluhub-erp`, HEAD `83ff127` del 2026-11-12 (merge PR #273 `plan10-carta-real-t0-t1`). Ruta abreviada `ERP/` = ese repo. Nada se escribió ni se tocó ahí. Las pruebas se corrieron en una COPIA descartable (`.../scratchpad/g/run`, solo vitest + fast-check) para no ensuciar el repo.

Veredictos: VERIFICADO / DIFERENTE (lo que hay) / NO ENCONTRADO. Todo con archivo:línea del ERP.

---------------------------------------------------------------------
## 0. Lo más importante (los docs que resultaron FALSOS o DESACTUALIZADOS)

1. **Teléfono (doc E §2.2): DIFERENTE.** El doc dice `^\+?[0-9 ()./-]{6,30}$` y 6-15 dígitos. El código real: texto de una línea, `trim`, 1 a 40 caracteres, "sin control" (`ERP/migraciones/0034_clientes.sql:92-93` `char_length BETWEEN 1 AND 40 AND ~ '^[[:print:]]+$'`; `ERP/src/primitivas/contacto/telefono.ts:34-45`). No exige dígitos: `"<b>x</b>"` es un teléfono válido. Es además una lista de prohibidos (control) y no una de permitidos.
2. **Nombre de la parte: DIFERENTE.** El doc dice `texto_fiscal_valido`; el código usa `texto_de_catalogo_valido(nombre,200)` (`0034_clientes.sql:80`). Y como `0043` REDEFINE esa función para admitir `¿ ¡ ? ! % $` (`0043_carta_publica.sql:75-82`), la base hoy admite esos signos en `parte.nombre`, domicilio, cargo, etc., mientras la primitiva de código de la parte (`nombre-o-razon-social.ts`, sin `conSignosDeCatalogo`) los rechaza. La base quedó más ancha que el código en el directorio.
3. **Tope de importe 999.999.999,99 (doc E §6.1 D19, B3): DIFERENTE en alcance.** No es un tope general. Es el de CAJA (`movimiento_caja_tope_ck`, `declaracion_de_total_importe_ck`, `0027_caja.sql:511,1170`) y el del importe que escribe quien vende o cobra (`ERP/src/modulos/ventas/dominio/forma-del-importe.ts:7`). El comprobante fiscal usa 9.999.999.999.999,99 (`0009_facturacion.sql:181`; `calculo-de-renglones.ts:63`), el precio de venta del catálogo `< 1e12` (`0025_catalogo.sql:285`) y el precio unitario hasta 10^18-1 micro-pesos (`decimal-fijo.ts:9`). Hay CUATRO topes distintos según el módulo.
4. **"Carta pública real: especificada, sin código" (doc E §3 intro y §3.5): DESACTUALIZADO.** Ya existe `0043_carta_publica.sql` (tablas `carta_publica` y `disponibilidad_de_producto`, T0 y T1) y 3 páginas de carta en la web. PERO la web sirve un FALSO del puerto con cartas de ejemplo inventadas (`ERP/apps/web/servidor/vidriera.ts:10-20` y `vidriera-publica-falsa.ts`): la carta de la web NO lee la base todavía.
5. **Lista de permitidos de nombres con `¿ ¡ ? ! % $` (doc E §3.1, C-3, D30): VERIFICADO y resuelto en código** (Q3 del 12/11): existe `soloCaracteresPermitidosDeCatalogo` y `0043` lo copia a la base; la lista base (razón social, domicilio, notas) SIGUE rechazándolos. Probado (ver §2.3). Lo que el doc llamaba "contradicción abierta" ya está decidido en código, con el PDF fiscal fuera (solo catálogo).
6. **Viewport "375 px primero" (consigna): DIFERENTE.** Todo el código y las pruebas de celular usan **390 x 844** (`ERP/vitest.config.ts:46`, `PantallaDeEmitirDesdeUnTicket.test.tsx:63`); 375 no aparece en ningún lado de apps/ ni test/web.
7. **"Gate / ci-desde-el-minuto-1: 16 checks" (doc E §4.2): DIFERENTE.** El gate real es `npm run gate` = typecheck + lint + format:check + arquitectura + analizar:muerto + test (`ERP/package.json`), y el CI tiene 13 jobs (ver §6). No coincide con los 16 del doc ni con los 8 de motor2.
8. **Colores por sucursal/empresa "libres con control de contraste" (doc E §5.1, C-2): NO ENCONTRADO.** Lo único que existe es el tema de MARCA (por host/marca, 4 tokens `#rrggbb` de lista cerrada) más un "aspecto" de 5 listas cerradas. Nada por sucursal ni por empresa, ni libre.
9. **`on-primary` "pasa a opcional, se deriva" (doc E §5.1): NO ENCONTRADO.** Sigue siendo uno de los 4 tokens (`ERP/src/modulos/marcas/dominio/tema.ts:9`) y se mide su contraste. Tampoco se mide "primary contra fondo ≥ 3:1": solo 3 pares (`tema.ts` `contrastesDelTema`).
10. **Radios "RECTO|SUAVE|REDONDEADO" (doc E §5.1): DIFERENTE de nombre**: son `RECTA|SUAVE|REDONDEADA` (`aspecto.ts:16`), más 4 estilos, 3 superficies, 2 títulos y 3 ingresos.
11. **Nombre del cerco de fallo cerrado (CLAUDE de motor2 cita `cerco-lista-de-permitidos.test.ts`): en Pedernal es `test/arquitectura/lista-de-permitidos.test.ts`** (+ `-evasiones`, `-apoyo`), con deuda en `arquitectura/deuda/` (no `cercos/vencimientos.ts`). El caso real `/\p{Cc}/u` de `datos-fiscales.ts` SIGUE en el código (`src/modulos/fiscal/dominio/datos-fiscales.ts:160`), registrado como deuda (presupuesto `validacion-de-datos.json`: 24 archivos, 44 prohibidos, 12 duplicados; vence 2027-01-05).
12. Un nombre de prueba engañoso en Pedernal: `calcular-ticket.test.ts:28` se llama "26,87 / 26,87 / 26,86" pero afirma `total 26.87` y renglones `8.96/8.96/8.95` (otro caso). El ejemplo ADR-006 real está en `calculo-de-renglones.test.ts:121` y `prorrateo.test.ts:24`.

Todo lo demás de §1 a §4 del doc coincide con el código (detalle abajo).

---------------------------------------------------------------------
## 1. FICHA DE PARTE (migración 0034_clientes.sql + src/modulos/clientes)

Tablas: `rol_de_parte`, `tipo_de_vinculo`, `parte`, `parte_rol`, `parte_vinculo` (`0034:55-148`). Aditiva, sin SECURITY DEFINER, sin DELETE/TRUNCATE (disparadores `sin_borrado`).

| Afirmación del doc | Veredicto | Evidencia (ERP/) |
|---|---|---|
| Una sola entidad `parte` por empresa con roles y vínculos | VERIFICADO | `migraciones/0034_clientes.sql:79-148,152-190` |
| `naturaleza` HUMANA/JURIDICA (CHECK) | VERIFICADO | `0034:78` |
| `id` uuid por la base, `idempotencia_alta uuid NOT NULL`, única por empresa | VERIFICADO | `0034:76-77,115` (`parte_idempotencia_uk UNIQUE (empresa_id, idempotencia_alta)`) |
| `nombre` 1-200, NULL solo si anonimizada | VERIFICADO el tope y `(estado='ANONIMIZADA')=(nombre IS NULL)` (`0034:80,116`) pero DIFERENTE la función: `texto_de_catalogo_valido`, no `texto_fiscal_valido` |
| `apellido` solo HUMANA ≤100; `alias` ≤100 | VERIFICADO | `0034:81-82` |
| `documento_tipo` 6 valores | VERIFICADO | `0034:83-84` CUIT, CUIL, CDI, DNI, PASAPORTE, ID_EXTRANJERO |
| CUIT/CUIL/CDI con `cuit_valido()` | VERIFICADO | `0034:118-120` |
| DNI `^[1-9][0-9]{5,8}$` (6 a 9) | VERIFICADO | `0034:121`; `primitivas/identificacion-fiscal/documento.ts:46-52` |
| Pasaporte `^[A-Z0-9]{6,9}$`; ID extranjero `{3,20}`; país char(2) obligatorio en ambos | VERIFICADO | `0034:122-124`; `pasaporte.ts:32-46` (C-4 del doc: resuelto 6-9) |
| Jurídica solo CUIT o ID_EXTRANJERO | VERIFICADO | `0034:125-126`; `dominio/documento.ts:30-38` |
| `condicion_iva` 11 valores WSFE | VERIFICADO | `0034:87-90`; `primitivas/identificacion-fiscal/condicion-iva.ts:13-25` |
| `email` minúsculas+trim, `_@_`, ≤254, no único | VERIFICADO | `0034:91-92` y solo índice NO único (`parte_email_ix`, `0034:168`) |
| `telefono` `^\+?[0-9 ()./-]{6,30}$` y 6-15 dígitos | **DIFERENTE** | real: 1-40, `[[:print:]]`, sin mínimo de dígitos (`0034:93-94`, `telefono.ts`). Solo la columna `telefono_digitos` (para buscar duplicados) extrae dígitos |
| Domicilio AR estructurado o `dom_texto` ≤300, "completo o ninguno" con coalesce | VERIFICADO | `0034:95-103,128-142`; calle ≤100, número `^[0-9]{1,6}$` o `S/N`, piso/depto ≤20, localidad ≤100, provincia FK a `provincia`, CP `^[A-Z0-9]{4,8}$`; exterior: solo texto, ninguna estructurada |
| `nota` no vacía ≤2000 | VERIFICADO | `0034:104` |
| `estado` ACTIVA/INACTIVA/ANONIMIZADA con transiciones; anonimizada terminal; `anonimizada_en` la fija la base | VERIFICADO | `0034:105-106,213-251` (`parte_validar_cambio`); tabla espejo `dominio/estados.ts:15-19` |
| `es_atajo` inmutable; índice "fichas por completar" | VERIFICADO | `0034:107,213-215,171-172` (`parte_sin_documento_ix`); caso de uso `esAtajo: documento===null` en `casos-de-uso/partes.ts:140` |
| Columnas calculadas `nombre_busqueda`, `documento_normalizado` (T, D, P<país>:, I<país>:), `telefono_digitos` | VERIFICADO | `0034:111-125` (translate; `left(documento_tipo,1)` da P / I); `dominio/documento.ts:99-109` repite la clave |
| Índice único de documento "incluidas las inactivas" por empresa | VERIFICADO | `0034:162-163` `UNIQUE (empresa_id, documento_normalizado) WHERE documento_normalizado IS NOT NULL` (anonimizada lo libera, `parte_anonimizada_ck`) |
| `tipo_de_vinculo` como DATO global con 2 banderas (CONTACTO, AGENTE_DE) | VERIFICADO | `0034:61-72`: CONTACTO (humana, de cualquiera), AGENTE_DE (humana, de jurídica) |
| Reglas de vínculo: no consigo misma, contacto humano, agente de empresa, no con anonimizada, PK `(empresa, parte, de_parte, tipo)` | VERIFICADO | `0034:177-190,274-312`; espejo `dominio/vinculos.ts:20-45` |
| Naturaleza no cambia si un vínculo la exige | VERIFICADO | `0034:242-250` (constraint `parte_naturaleza_con_vinculos`, el doc escribió "…_vinculo") |
| Disparador diferido: anonimizada sin roles/vínculos activos | VERIFICADO | `0034:253-266,324-327` |
| Roles CUSTOMER y PROVEEDOR; EMPLEADO fuera | VERIFICADO | `0034:55-59`; `dominio/roles.ts:6` |
| RLS FORZADA, una política por comando | VERIFICADO | 5 `FORCE ROW LEVEL SECURITY` (`0034:372-381`); políticas `parte_app_leer/alta/cambiar` etc. (`0034:388-410`); INSERT/UPDATE por columna (`0034:356-368`); nadie DELETE |
| Auditoría guarda qué campo cambió, no valores | VERIFICADO | `casos-de-uso/partes.ts:154-163` (alta: naturaleza, roles, conDocumento, cantidad de duplicados) y `:233-239` (edición: solo nombres de campos) |
| Alta idempotente: mismo contenido → `yaExistia`; otro → `CLAVE_REUTILIZADA`; documento repetido → `DOCUMENTO_YA_REGISTRADO` o `PARTE_INACTIVA_CON_ESE_DOCUMENTO`; carrera resuelta | VERIFICADO | `partes.ts:101-166` |
| Duplicados por email/teléfono/nombre avisan, no bloquean | VERIFICADO | `dominio/duplicados.ts`; `partes.ts:50-85` |
| Permisos: operador crea/edita/cambia roles/vincula; solo gerente y administrador desactivan/reactivan | VERIFICADO | `ERP/src/capacidades/permisos/empresa.ts:203-210` |
| DEC-0305: no hay acción de anonimizar (el estado existe) | VERIFICADO | cero ocurrencias de "anonimiz" en `modulos/clientes/casos-de-uso/*.ts` (salvo estado en dominio/base) |
| "Sin dinero en la ficha" | VERIFICADO | ninguna columna de dinero en `parte` |
| Validador con TODOS los errores a la vez, un campo por error | VERIFICADO (extra) | `dominio/datos-de-parte.ts:93-196` |
| CUIT con guiones/DNI con puntos se aceptan al escribir | VERIFICADO (extra) | `cuit.ts` `FORMA_CON_GUIONES`; `documento.ts:52` `FORMATO_DE_DNI_CON_PUNTOS` |
| CUIT: no se valida el prefijo (20,23,27,30…) | VERIFICADO (extra) | `cuit.ts:9-10` |

Detalle de lo que el doc no decía: el nombre del contacto y el cargo usan la misma lista de permitidos (`vinculos.ts:51-58`, `parte_vinculo_cargo_ck`); la regla de caracteres de nombre/alias/apellido está en `primitivas/texto/texto-de-una-linea.ts` (una sola fuente, con la base copiada carácter por carácter por una prueba).

---------------------------------------------------------------------
## 2. CATÁLOGO (migración 0025_catalogo.sql + 0043)

### 2.1 Tablas y reglas (`ERP/migraciones/0025_catalogo.sql`)
9 tablas, VERIFICADO (`:50-63`): `unidad_de_medida`, `seccion_de_carta`, `producto`, `grupo_de_elecciones`, `opcion`, `version_de_opcion`, `consumo_de_opcion`, `precio_de_venta`, `copia_de_opciones`. RLS FORZADA (9 `FORCE`), una política por comando, sin DELETE/TRUNCATE.

| Afirmación del doc | Veredicto | Evidencia |
|---|---|---|
| 5 clases de uso (MATERIA_PRIMA, INSUMO, REVENTA, ELABORADO, VENDIBLE), no cambia | VERIFICADO | CHECK `:158-159`; disparador `producto_validar` "la clase no cambia" `:352-358` |
| Solo REVENTA y VENDIBLE llevan alícuota, sección, nombre de cocina, descripción | VERIFICADO | `producto_clase_sin_venta_ck` `:176-180` (y forma de venta fija en las que no venden `:182-184`) |
| `se_vende` columna GENERADA = clase vendible AND alícuota NOT NULL AND NOT falta_completar | VERIFICADO | `:168-169` |
| Alícuota 8 códigos `'0','2.5','5','10.5','21','27','EXENTO','NO_GRAVADO'`, sin default | VERIFICADO | `:164-165` (sin DEFAULT) |
| Nombre 1-120, único por empresa con `nombre_clave` (NFC + minúsculas) | VERIFICADO | `:149-150,190`; `primitivas/texto/nombre-de-producto.ts:24-26` `claveDeNombre` |
| `nombre_de_cocina` ≤80, `descripcion_en_carta` ≤300, `codigo` `^[A-Za-z0-9._-]{1,40}$` único, `codigo_de_barras` `^[0-9]{8,14}$` único, `tipo='BIEN'` | VERIFICADO | `:151-157,191-192`; primitivas `nombre-de-cocina.ts:8`, `descripcion-de-carta.ts:8`, `codigo-de-producto.ts:8-10` |
| Alta rápida deja `falta_completar=true` | VERIFICADO | `modulos/catalogo/casos-de-uso/crear-producto.ts:121,150` (`pedido.rapida`) |
| Forma de venta: `unidad_de_venta_id` misma dimensión + `paso_minimo numeric(18,4)` | VERIFICADO | `:161-163,171-174`; paso exacto en base (`producto_paso_no_exacto`) |
| `precio_de_venta` solo inserción; alcance sucursal NULL = empresa; `precio` NULL = precio abierto (o "vuelve a empresa" con sucursal) | VERIFICADO | trigger `precio_de_venta_solo_insercion` `:638-641`; `precio_de_venta` `:268-285`; K6 `:40-44` |
| `precio_vigente(...)` único lector SQL, STABLE, sin SECURITY DEFINER: primero sucursal (si no NULL), si no empresa | VERIFICADO | `:555-581` |
| `vigente_desde` estrictamente creciente (`precio_fuera_de_orden`) | VERIFICADO | `:555` bloque del disparador (`NEW.vigente_desde <= v_ultima`) |
| IVA incluido y ARS (CHECK) | VERIFICADO | `precio_de_venta_moneda_ck`/`iva_incluido_ck` |
| Sin precio propio si hay variante activa (R-18 `precio_propio_con_variante`) | VERIFICADO | disparador `:509-516` |
| `grupo_de_elecciones` propio del producto; 3 clases VARIANTE/INCLUIDA/ADICIONAL; una variante activa por producto | VERIFICADO | `:196-225` índice parcial `grupo_de_elecciones_variante_uk` |
| `es_obligatorio`, `admite_varias` (sin tope "hasta N") | VERIFICADO | `:206-207` |
| `se_muestra_en_carta DEFAULT false`; la variante exige true | VERIFICADO | `:209,219` (C-6 del doc: resuelta) |
| `recargo numeric(18,6) >= 0 AND < 1e12`, sin negativo; recargo = 0 en INCLUIDA/VARIANTE y en grupo oculto | VERIFICADO | `version_de_opcion_recargo_ck` `:250`; disparador `:470-478` |
| `factor_de_tamano` 0 < f ≤ 100, solo en la opción de tamaño | VERIFICADO | `:255,482-484` |
| `opcion` nombre (de la versión) 1-80, versión solo inserción, número = siguiente | VERIFICADO | `:248,631-634,486-491` |
| `consumo_de_opcion` solo dato, `cantidad > 0`, `escala_con_tamano`, solo en INCLUIDA/ADICIONAL, insumo MP/INSUMO/REVENTA ≠ dueño, solo en la misma transacción (`xmin`) | VERIFICADO | `:262-279,493-518` |
| `copia_de_opciones` solo inserción | VERIFICADO | `:287-301,642-645` |
| `cotizarParaVender`: precio del tamaño + Σ recargos, exacta, una sola cuenta | VERIFICADO | `modulos/catalogo/dominio/cotizar.ts:14-17,148-155`; `casos-de-uso/cotizar-para-vender.ts` |
| Producto sin precio no se muestra en carta | VERIFICADO | `cotizar.ts:249-253` `tienePrecioParaLaCarta` |
| Prueba de paridad carta = caja "al centavo para toda combinación" (P-5) | NO ENCONTRADO | no hay prueba de paridad; solo `tienePrecioParaLaCarta`. Esperable: la carta real no está construida |

### 2.2 Qué NO estaba en el doc y está en el código
- Unidades de medida: 14 unidades sembradas en 6 dimensiones (CONTEO, MASA, VOLUMEN, LONGITUD, SUPERFICIE, TIEMPO), factores enteros (`0025:113-120`).
- Cotas explícitas porque `numeric` acepta NaN (`producto_paso_cota_ck`, "la trampa de 0009 D11") `0025:185-186`.
- `0043`: `carta_publica` (código ≥ 22 chars base64url único en toda la plataforma, una por sucursal, nace `FUERA_DE_LINEA`) y `disponibilidad_de_producto` ("Ocultar" por empresa o por sucursal, independiente de `producto.activo`). Lectura pública por `app.codigo_de_carta`.

### 2.3 Caracteres permitidos en nombres: lista real y prueba
Lista base (`ERP/src/primitivas/texto/texto-de-una-linea.ts:52-66`): letras latinas `A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ`, dígitos, espacio y `. , & - ' / ( ) ° + : ; " # º ª ’ “ ” – — « » ® ™`; no puede empezar con `+` ni `-`; NFC; espacios colapsados; hasta `maximo`; al menos una letra si se pide. Catálogo = base + `¿ ¡ ? ! % $` (`SIGNOS_DEL_CATALOGO`), solo con `conSignosDeCatalogo: true` (nombre de producto/elección/descripción/carta). SQL: `texto_de_catalogo_valido` en `0025:73-85` (sin los seis) y redefinida en `0043:75-82` (con los seis).

Probé las constantes copiadas literalmente (`.../g/chars.mjs`):

| Cadena | Lista base (razón social, domicilio, nota…) | Lista catálogo (nombre de producto) |
|---|---|---|
| `¿Querés papas?` | NO | SÍ |
| `Pizza muzza!` | NO | SÍ |
| `Combo 2x1 50% off` | NO | SÍ |
| `Precio $500` | NO | SÍ |
| `Bife a la criolla`, `Café con leche`, `Ñoquis`, `Sándwich 1/2`, `Pepsi 2,25 l` | SÍ | SÍ |
| `+Kota` | NO (empieza con +) | NO |
| `=SUM(A1)`, `<b>x</b>`, `Juan 😀` | NO | NO |

Es decir: VERIFICADO que Pedernal admite `¿ ¡ ? ! % $` SOLO en el catálogo (decisión Q3 del 12/11) y que el nombre de un cliente/proveedor sigue sin ellos en código (pero la base ya los admite, ver §0.2).

---------------------------------------------------------------------
## 3. DINERO

### 3.1 Funciones exactas (todas con `bigint`, ningún `number`)
- `ERP/src/primitivas/cantidad/redondeo-entero.ts`: `dividirRedondeando(numerador: bigint, denominador: bigint, politica: "MITAD_SUBE_SIMETRICA" | "MITAD_PAR"): bigint` (la mitad se aleja del cero; o va al par).
- `ERP/src/primitivas/dinero/redondeo.ts`: `redondear(monto: MontoExacto, politica): Importe`; `POLITICA_VIGENTE = "MITAD_SUBE_SIMETRICA"` ("supuesto vigente, a confirmar con el contador").
- `ERP/src/primitivas/dinero/importe.ts`: `Importe` = `{moneda, unidades: bigint}` en centavos; `importeDesdeTexto(m, texto)` (estricto: más decimales de los admitidos se rechaza, no se redondea); `importeATexto`; `sumar`, `restar`.
- `ERP/src/primitivas/dinero/prorrateo.ts`: `prorratear(total: Importe, pesos: readonly MontoExacto[]): Importe[]` (restos mayores; empate gana el primero; suma exacta; total ≥ 0; pesos todos 0 con total ≠ 0 = `PESOS_INVALIDOS`) y `repartirPrecioUnitario(total: PrecioUnitario, pesos)` (misma regla en micro-pesos; sirve para combos).
- `ERP/src/modulos/fiscal/dominio/calculo-de-renglones.ts`: `calcularRenglones(moneda, renglones, modo: "IVA_INCLUIDO"|"IVA_DISCRIMINADO", politica): Resultado<{total, renglones[], desglose[], neto, iva}, "TOTAL_FUERA_DE_RANGO">`. Algoritmo documentado `:19-24`: (1) cada renglón exacto, (2) total redondeado UNA vez sobre la suma exacta, (3) prorrateo del total entre renglones con pesos = montos exactos, (4) por alícuota `neto = redondear(total/(1+a))`, `iva = total - neto`.
- `ERP/src/modulos/fiscal/dominio/comprobante.ts:62-72`: `desglosarAlicuota(codigo, total, politica)`.
- `ERP/src/modulos/ventas/dominio/` (`calcular-ticket`): el mismo mecanismo para el ticket (1 redondeo sobre el total, renglones prorrateados).
- Ejecuté `calcularRenglones` y salió (copia en `.../g/run/src/adhoc/imprime.test.ts`):
  - E1 entrada: 3 renglones `precio 9.95, cantidad 3, alícuota 21, descuento 10%`, IVA incluido → `total 80.60`, `renglones [26.87, 26.87, 26.86]`, `neto 66.61`, `iva 13.99`. **VERIFICADO**, incluido que "redondear cada línea daría 26,87×3 = 80,61 y no se hace" (exacto 26,865 c/u = 80,595 → 80,60).
  - E2 entrada: `1210.00 @21%` y `1050.00 @10.5%` → `total 2260.00`; 10,5%: `neto 950.23, iva 99.77`; 21%: `neto 1000.00, iva 210.00`; globales `neto 1950.23`, `iva 309.77`. **VERIFICADO** (1.950,23 + 309,77 = 2.260,00).
  - `redondear` de 10,005: MITAD_SUBE_SIMETRICA → 10.01; MITAD_PAR → 10.00. VERIFICADO.
- Las pruebas que lo cubren: `ERP/src/primitivas/dinero/prorrateo.test.ts:24-25` (80,60 → 26,87/26,87/26,86), `ERP/src/modulos/fiscal/dominio/calculo-de-renglones.test.ts:121-137` (E1 y E2), `:444-446` (golden contra los ejemplos de los docs), `prorrateo.propiedades.test.ts` (fast-check). Corrí en copia aislada 217 pruebas de dinero/cantidad/calcular-ticket/texto y 28 de `calculo-de-renglones`: **todas pasan**.

### 3.2 Topes (medidos, no leídos)
| Lugar | Tope | Evidencia | Prueba que hice |
|---|---|---|---|
| Caja (`importeDeEntrada`) y base de caja | 999.999.999,99 (`99_999_999_999n` centavos) | `modulos/caja/dominio/importes.ts:18`; `0027_caja.sql:511,1170` | `999999999.99` ok; `1000000000.00`, `999999999.999`, `1e3`, `-1` → `IMPORTE_INVALIDO` |
| Importe que escribe quien vende/cobra (precio abierto, cobro) | 9 enteros + 2 decimales, `^[0-9]{1,9}(\.[0-9]{1,2})?$` (admite `0`) | `modulos/ventas/dominio/forma-del-importe.ts:7` | idem |
| Total del comprobante fiscal | 9.999.999.999.999,99 (`10n**15n-1n` centavos), total > 0 | `calculo-de-renglones.ts:63`; `0009_facturacion.sql:181` | total de 999.999.999.999,99 pasa; por encima de 10^12 el PRECIO ya falla antes (`FUERA_DE_RANGO` al construir el precio unitario) |
| Precio/recargo del catálogo | `< 1e12`, `numeric(18,6)` | `0025:250,285` | |
| Precio unitario (primitiva) | hasta `10^18-1` micro-pesos | `cantidad/decimal-fijo.ts:9`; `dinero/interno.ts:35` | |

=> "Importe máximo 999.999.999,99" es verdad **solo en caja y en lo que teclea el vendedor**. Hay cuatro topes.

### 3.3 Otros hallazgos de dinero
- Reglas de arquitectura de dinero: `arquitectura/lint-dinero.cjs` (no `number`/`parseFloat`/`Math` en primitivas de dinero). `legibilidad-de-la-app.test.ts` (final del archivo) prohíbe `Number, parseFloat, parseInt, Date, Intl, toFixed, toLocale*, Math.` en el código del detalle de comprobante.
- JSON de importe: `{moneda, monto}` con `monto` texto (`importe.ts:8-9,28-33`). VERIFICADO.
- Moneda solo ARS (CHECK en base y `exigirMismaMoneda`). VERIFICADO.

---------------------------------------------------------------------
## 4. DISEÑO VISUAL

| Afirmación del doc | Veredicto | Evidencia |
|---|---|---|
| Tema = lista CERRADA de 4 tokens `primary`, `on-primary`, `secondary`, `accent` | VERIFICADO | `ERP/src/modulos/marcas/dominio/tema.ts:9`; `tema_valido` en `0007_marcas_y_planes.sql:250-252` |
| Valores `#rrggbb` minúsculas; nada de `#fff`, `rgb()`, `url()`, nombres | VERIFICADO | `tema.ts:20` `COLOR_DEL_TEMA=/^#[0-9a-f]{6}$/`; `capacidades/experiencia/tema-css.ts:12-14` (cinturón y tirantes: solo se escriben las 4 variables `--brand-*`) |
| Contraste: `on-primary/primary` ≥ 4,5; `accent` sobre fondo y superficie ≥ 3 | VERIFICADO | `tema.ts:97-130` (`CONTRASTE_MINIMO_DEL_TEXTO=4.5`, `..._ACENTO=3`); `secondary` no se mide |
| `primary` contra fondo ≥ 3:1 (propuesta) | NO ENCONTRADO | solo 3 pares |
| `on-primary` opcional, derivado | NO ENCONTRADO (sigue obligatorio al confirmar) | `tema.ts:9` |
| Tokens semánticos en código; los de estado nunca toman la marca | VERIFICADO | `apps/web/ui/tokens.css:1-9,33-48`; prueba `apps/web/ui/tokens.test.ts:141-190` (puentes exactamente 4; solo acción primaria, acento y secundario leen de la marca) |
| Hover/presionado derivados en código | VERIFICADO | `tokens.css:51-52` `color-mix(... black 12%/24%)` |
| Modo oscuro: no en v1 | VERIFICADO | `tokens.css:11` `color-scheme: light`; `test/web/legibilidad-de-la-app.test.ts` ("sin modo oscuro en v1") prohíbe `prefers-color-scheme: dark` |
| Tipografía: fuente del sistema, nada que descargar | VERIFICADO | `tokens.css:68-70`; test que prohíbe Google Fonts/`@font-face`/`next/font` |
| Piso 16 px; tamaños en `rem`, nunca `px` | VERIFICADO | `tokens.css:71-77` (chico=base=1rem); test `legibilidad-de-la-app.test.ts` (3 reglas) |
| Objetivo táctil 48 px en operación, 44 en administración | VERIFICADO | `tokens.css:96-98` (3rem / 2.75rem); `tokens.test.ts:326` |
| Foco con doble contorno | VERIFICADO | `tokens.css:139-144` |
| `reduced-motion` | VERIFICADO | `tokens.css:123-128` |
| Superficies NEUTRA/CALIDA/FRIA solo pisan fondo y superficie | VERIFICADO (extra) | `tokens.css:111-121`; `tema.ts:88-92` `COLORES_DE_SUPERFICIE`; `test/web/contraste-de-superficies.test.ts` |
| Aspecto: 5 listas (estilo 4, superficie 3, esquinas 3, titulos 2, ingreso 3) | VERIFICADO (extra) | `marcas/dominio/aspecto.ts:15-19`; `0014_aspecto_de_marca.sql` (columna jsonb con `aspecto_valido`) |
| Colores de marca por sucursal / por empresa / libres con control de contraste | **NO ENCONTRADO** | `grep` de "color" en migraciones solo da `0007` y `0014` (marca); ninguna columna ni código en sucursal/empresa |
| Logo, nombre propio por sucursal ("nivel 1") | NO ENCONTRADO | ninguna columna de logo/identidad en `sucursal` (0005, 0019) |
| `--agotado` 7:1 sobre la carta | VERIFICADO | `tokens.css:104-106`; `plantillas/vidriera/contraste.test.ts` |

### 4.1 Colores sueltos (conteo)
- 60 archivos CSS en `apps/` (59 CSS modules + `tokens.css`; 5 en `apps/plataforma`). **0 literales hex/rgb/hsl fuera de `tokens.css`** (`grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(" apps --include=*.css`). Lo impone `apps/web/ui/tokens.test.ts:191-197` (no `#hex`, no `rgb(`, no `--brand-` en ningún `.css` de componentes) con violación inyectada (`tokens.test.ts:111-140`: esquinas, capas, duraciones).
- En TS/TSX de `apps/` y `src/` (sin tests): solo `#ffffff/#000000` en SVG de QR (`src/adaptadores/qr/qr-svg.ts:63-64`; `apps/plataforma/pantallas/alta-segundo-factor.cliente.tsx:28-29`), `#000000` y `#eeeeee` en el PDF (`src/adaptadores/pdf/pincel-del-pdf.ts:24`, `tabla-del-pdf.ts:13`), las 3 superficies en `tema.ts:90-92` (espejo de `tokens.css`, igualado por prueba), y un ejemplo en un texto de ayuda. **9 literales de color en código ejecutable, 0 en CSS de pantallas.**
- Guardianes de diseño que existen: `tokens.test.ts` (colores, esquinas con tope 20 px, capas, duraciones, tokens sin consumidor, contraste de cada combinación por superficie, objetivo mínimo, foco), `test/web/legibilidad-de-la-app.test.ts` (letra), `test/web/contraste-de-superficies.test.ts`, `plantillas/vidriera/contraste.test.ts`, `capacidades/experiencia/tema-css.test.ts`.
- Guardián de mobile-first/ancho: NO hay una regla global de CSS. Hay pruebas por pantalla en Chromium real a 390 px y 1280/1600 px (`expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)`: `PantallaDeDetalleDeComprobante.test.tsx:85`, `PantallaDeAnularComprobante.test.tsx:53`, `PantallaDeEmitirDesdeUnTicket.test.tsx:126-130`), axe y 48 px de objetivo. Convención mobile-first de hecho: media queries solo `min-width` en el web (48rem x3, 64rem x2) y `prefers-reduced-motion`/`print`; únicas `max-width` están en `apps/plataforma` (2 de `47.99rem`, el menú móvil de la consola).

---------------------------------------------------------------------
## 5. REVISIÓN DE PANTALLAS (pedido expreso del dueño)

No se levantó la app (no se intentó: lectura alcanza).

### 5.1 Qué hay REALMENTE en `apps/web/app` (27 `page.tsx` + 5 `route.ts`)
Páginas (todas bajo `app/s/...` para el ruteo por host):
- **Entrada (sin sesión de empresa):** `ingreso`, `empresa` (elección de empresa), `invitacion`.
- **Operación (con sesión y empresa):** inicio `(operacion)/page.tsx`; **Facturación**: listado de comprobantes, pendientes, emitir, emitir desde un ticket (`emitir/venta/[ticketId]`), detalle, anular, imprimir (+ ruta `pdf`); **Configuración fiscal**: inicio, datos fiscales, certificado de ARCA (+ por ambiente), puntos de venta (listado, nuevo, detalle); **Cuenta** y **contacto de la sucursal**; **Sucursal**.
- **Carta pública:** `s/carta/[codigo]` y `s/carta/[codigo]/[producto]` (vidriera). Sirve el FALSO con cartas de ejemplo (ver §0.4).
- **Landing y neutra:** `s/landing/**`, `s/neutra`.
- **Consola (`apps/plataforma/app`, 9 páginas):** ingreso (+ alta de segundo factor, código), empresas (listado, nueva, plan de la empresa), submarcas (listado y editor).
- `route.ts`: `api/auth`, `api/salud`, `api/sesion/renovar`, `api/trabajos/cron`, `facturacion/comprobantes/[id]/pdf`.

### 5.2 Solo servidor (sin una sola pantalla en `apps/`)
Los 0 imports de `src/modulos/<x>/` desde `apps/` confirman (grep): **caja** (25 archivos de casos de uso), **catalogo** (15), **cierre** (8), **clientes** (9), **comandas** (10), **compras** (14), **empresas** (9), **identidad** (18), **producción** (10), **salon** (13), **stock** (34), **ventas** (22). Solo `fiscal` y `marcas` tienen consumo directo (2 archivos cada uno) y la facturación entra por `src/composicion/*` (p.ej. `facturacion-web.ts`, `facturar-tickets-web.ts`, `stock-de-ventas.ts`, `cierre-de-caja.ts`, `egreso-de-caja.ts`). Es decir: **no hay pantalla de catálogo, caja, venta rápida, salón, comandas, stock, compras, producción ni clientes/proveedores**. Coincide con `mapa-de-pantallas` del doc (§6.2: "un cliente de Motor2 no podría operar hoy").
- Lo que SÍ existe de ventas en pantalla es solo la factura "desde un ticket" (`emitir/venta/[ticketId]`), no una caja.

### 5.3 Cómo están hechas para celular
- Marco: `PlantillaOperacion` (columna flex, `min-height: 100dvh`, barra inferior `position: sticky`, contenido `flex:1`, padding `--espacio-4`) y `PlantillaAdministracion` (navegación horizontal con scroll en celular; desde `min-width: 48rem` pasa a lateral de 16rem).
- Listado de comprobantes: **tarjetas en celular** (cada una enlace entero) y **tabla desde 64rem** (`PantallaDeListadoDeComprobantes.module.css:9,97-105`, `overflow-x: auto`). Es la única `<table>` de pantalla; las otras tablas son del papel impreso (A4/ticket).
- Contenedores: carta `max-width: 40rem`; botones/campos con objetivo ≥ 48 px; `overflow-wrap: anywhere`; letra mínima 16 px.
- Probado: `vitest.config.ts:44-47` corre el proyecto "componentes" en Chromium con **390 x 844**; varias pantallas además a 1280/1600.
- Papel: HojaA4 y Ticket usan `pt`, con paginador propio y `@media print` (3).

### 5.4 Componentes de UI compartidos (`apps/web/ui`)
- Primitivas: `Pila`, `SoloLector`, `Texto`.
- Componentes (13): `Aviso`, `Boton.cliente`, `BotonIcono`, `CabeceraDeMarca`, `CajaDeCampo`, `Campo`, `CampoDeCodigo`, `CampoDeDocumento`, `CampoImporte`, `CampoNumero`, `EnlaceDeAccion`, `EstiloDeMarca`, `Insignia`, `Selector`.
- Patrones (≈15): `Superposicion` (`<dialog>`), `RegionDeEstado`, `FranjaSinConexion`, `FormularioDeAccion`, `ErrorDeSuperficie`, `SelectorDeSucursal`, `IndicadorDeSesion`, `AceptarInvitacion`, `AvisoDeSesion`, ganchos (`useEnvioConClave`, `useActividad`, `useEnLinea`), borrador de página.
- Plantillas: `PlantillaOperacion`, `PlantillaAdministracion`, `PlantillaNeutra`, y por dominio: `sesion/`, `configuracion-fiscal/`, `facturacion/` (+ `impresion/`), `vidriera/` (carta: 17 archivos).
- La **consola de plataforma comparte** `tokens.css`, `Texto`, `EnlaceDeAccion`, `Aviso` y `ErrorDeSuperficie` de `apps/web/ui` (`apps/plataforma/app/layout.tsx:4`, `empresas/page.tsx:1-3`) pero tiene 5 CSS propios.
- Regla "sin dato registrado no hay campo": cada campo con la prop `dato` registrada en `src/capacidades/datos/registro.ts`, y lo no conforme es deuda con vencimiento: 39 archivos con presupuesto en `arquitectura/deuda/campos-sin-dato.json` (7 entradas en el registro, vencen 2027-01-04).

---------------------------------------------------------------------
## 6. GATE / CI DE PEDERNAL

`npm run gate` (`ERP/package.json`): `typecheck` (tsc raíz + web + plataforma) → `lint` (eslint) → `format:check` (prettier) → `arquitectura` (= `depcruise src apps scripts` + `guardian` + `deuda` + `decisiones:verificar`) → `analizar:muerto` (knip) → `test` (`vitest run --project node`, necesita Postgres). Aparte: `test:componentes` (Chromium + axe), `test:recorrido` (app real + Postgres), `mutacion` (stryker), `build:web`, `build:plataforma`.

CI (`ERP/.github/workflows/ci.yml`, 13 jobs): `estatico` (tipos, lint, formato, arquitectura, muerto), `guardian` (contratos, vigilancia de la versión anterior de la base, deuda no crece, campos-sin-dato presupuesto solo baja, registro de decisiones), `pruebas` (Postgres real), `seguridad` (`npm audit --audit-level=high`, `npm audit signatures`, gitleaks), `flujos` (zizmor sobre workflows), `dependencias` (revisión en PR), `estabilidad` (integración x N copias, solo en ciertos cambios/noche), `mutacion-plan` + `mutacion` por grupo (stryker), `gate` (agrega todos: `evaluar-gate.cjs`), `web` (next build SIN variables `PEDERNAL_*`, web y consola), `componentes`, `recorrido`. Más `codeql.yml`, `gate-rapido.yml`, `migrar.yml` (manual, con aprobación del dueño), `cargar-entorno.yml`, `preparar-empresa-de-pruebas.yml`.

Cercos y guardianes relevantes (todos con violación inyectada):
- **Fallo cerrado / lista de permitidos:** `test/arquitectura/lista-de-permitidos.test.ts` (+ `-evasiones`, `-apoyo`); presupuesto `arquitectura/deuda/validacion-de-datos.json` (24 archivos, 44 prohibidos, 12 duplicados) con vencimiento 2027-01-05; exención exacta de 2 archivos de "formatos de terceros" (`set-cookie.ts`, `arca/saneamiento.ts`); reglas de SQL `arquitectura/lint-sql.cjs` + `test/arquitectura/lint-sql.test.ts`.
- **Sin dato registrado no hay campo:** `test/arquitectura/campos-con-dato*.test.ts`, `campos-sin-dato-presupuesto.test.ts`.
- **Fuente única:** `test/arquitectura/fuente-unica*.test.ts` (+ `compras-fuente-unica`, `largo-del-nombre-de-marca`).
- **Contratos:** guardián `arquitectura/contratos/*.cjs` con matriz de invariantes (`invariantes.cjs`), evasiones (`evasiones.json`, `evasiones-github.json`), no-debilitar contra la rama base, y ≈ 30 pruebas `guardian-*.test.ts`; cada módulo tiene `contratos.json`.
- **Cuota de decisiones por PR** (5 de negocio y 10 técnicas): `arquitectura/decisiones/cuota.json`, `test/arquitectura/decisiones-cuota.test.ts`; registro de decisiones sensibles.
- **Reglas de módulos y PDF:** `arquitectura/reglas-de-modulos.cjs`, `reglas-de-pdf.cjs`, `reglas.cjs` (+ `test/arquitectura/reglas.test.ts`); `catalogo-modulos.test.ts`, `tipos-permisos.test.ts`, `tipos-tx.test.ts`, `cobrar-no-expuesto.test.ts`, `frontera-servidor-cliente.test.ts`, `vercel-json.test.ts` (despliegue deshabilitado hasta aprobación), `workflow-*.test.ts`, `columnas-cifradas.test.ts`, `pdf-en-la-funcion.test.ts`, `vocabulario-de-gastronomia.test.ts`, `nombre-del-producto.test.ts` (marca blanca).
- **Diseño:** `apps/web/ui/tokens.test.ts`, `test/web/legibilidad-de-la-app.test.ts`, `contraste-de-superficies.test.ts`.
- **Deuda con vencimiento** (`arquitectura/deuda/registro.json`, 52 entradas: 18 `ts-expect-error`, 8 `eslint-disable`, 8 `archivo-grande`, 7 `campos-sin-dato`, resto sueltas) y tope de 400 líneas por archivo (`configuracion.json`).

---------------------------------------------------------------------
## 7. TABLA FINAL: afirmación del doc → veredicto → evidencia

| # | Afirmación (doc E-pedernal-docs.md) | Veredicto | Evidencia ERP/ |
|---|---|---|---|
| 1 | `parte` única con roles y vínculos | VERIFICADO | `migraciones/0034_clientes.sql:79-190` |
| 2 | naturaleza HUMANA/JURIDICA | VERIFICADO | `0034:78` |
| 3 | documento_tipo 6 valores | VERIFICADO | `0034:83-84` |
| 4 | CUIT/CUIL/CDI con `cuit_valido` | VERIFICADO | `0034:118-120` |
| 5 | DNI 6-9 sin cero inicial | VERIFICADO | `0034:121`; `documento.ts:46` |
| 6 | Pasaporte 6-9 alfanumérico, país obligatorio | VERIFICADO | `0034:122-124`; `pasaporte.ts` |
| 7 | Jurídica solo CUIT o ID_EXTRANJERO | VERIFICADO | `0034:125-126` |
| 8 | 11 condiciones de IVA | VERIFICADO | `0034:87-90` |
| 9 | email minúsculas ≤254, no único | VERIFICADO | `0034:91-92,168` |
| 10 | teléfono `^\+?[0-9 ()./-]{6,30}$` y 6-15 dígitos | **DIFERENTE** (1-40 `[[:print:]]`, sin mínimo de dígitos) | `0034:93-94`; `telefono.ts:34-45` |
| 11 | nombre 1-200 con `texto_fiscal_valido` | **DIFERENTE** (`texto_de_catalogo_valido`; base más ancha que el código tras 0043) | `0034:80`; `0043:75-82` |
| 12 | domicilio AR estructurado / `dom_texto` ≤300, completo o ninguno | VERIFICADO | `0034:95-103,128-142` |
| 13 | nota ≤2000 | VERIFICADO | `0034:104` |
| 14 | estados + transiciones con disparador | VERIFICADO | `0034:105,213-251` |
| 15 | índice único de documento incl. inactivas | VERIFICADO | `0034:162-163` |
| 16 | `idempotencia_alta` única por empresa | VERIFICADO | `0034:115`; `partes.ts:101-166` |
| 17 | `tipo_de_vinculo` dato con banderas; CONTACTO y AGENTE_DE | VERIFICADO | `0034:61-72` |
| 18 | reglas de vínculo y naturaleza con vínculo | VERIFICADO | `0034:177-190,242-250,274-312` |
| 19 | RLS FORZADA, sin DELETE | VERIFICADO | `0034:372-381,356-368` |
| 20 | auditoría sin valores | VERIFICADO | `partes.ts:154-163,233-239` |
| 21 | operador no desactiva; gerente/admin sí | VERIFICADO | `capacidades/permisos/empresa.ts:203-210` |
| 22 | sin acción de anonimizar (DEC-0305) | VERIFICADO | grep en `modulos/clientes/casos-de-uso` |
| 23 | 9 tablas de catálogo | VERIFICADO | `0025_catalogo.sql:50-63` |
| 24 | 5 clases, inmutables, CHECK por clase | VERIFICADO | `0025:158-159,176-184,352-358` |
| 25 | `se_vende` generada | VERIFICADO | `0025:168-169` |
| 26 | alícuota 8 códigos sin default | VERIFICADO | `0025:164-165` |
| 27 | nombre 1-120, único, `nombre_clave` | VERIFICADO | `0025:149-150,190`; `nombre-de-producto.ts` |
| 28 | `nombre_de_cocina` ≤80 | VERIFICADO | `0025:151`; `nombre-de-cocina.ts:8` |
| 29 | `precio_de_venta` solo inserción + `precio_vigente` único lector | VERIFICADO | `0025:268-285,555-581,638-641` |
| 30 | grupos propios, 3 clases, 1 variante activa | VERIFICADO | `0025:196-225` |
| 31 | recargo ≥ 0, sin negativo | VERIFICADO | `0025:250` |
| 32 | `se_muestra_en_carta` DEFAULT false | VERIFICADO | `0025:209` |
| 33 | nombres sin `¿ ¡ ? ! % $` | **DIFERENTE**: se admiten en catálogo desde 12/11; no en razón social/domicilio/nota | `texto-de-una-linea.ts:52-66`; `0043:75-82`; prueba §2.3 |
| 34 | prueba de paridad carta = caja al centavo | NO ENCONTRADO | solo `cotizar.ts:249` |
| 35 | carta pública real sin código | **DESACTUALIZADO** (0043 existe; web usa falso) | `0043_carta_publica.sql`; `apps/web/servidor/vidriera.ts:10-20` |
| 36 | importe máximo 999.999.999,99 | **DIFERENTE** (solo caja y lo que teclea el vendedor; fiscal 9,99e12; precio < 1e12) | `importes.ts:18`; `calculo-de-renglones.ts:63`; `0025:285` |
| 37 | redondeo una vez sobre el total, restos mayores | VERIFICADO | `calculo-de-renglones.ts:19-24,126-137`; `prorrateo.ts` |
| 38 | ADR-006 E1: 80,60 → 26,87/26,87/26,86 | VERIFICADO (ejecutado) | `calculo-de-renglones.test.ts:121`; `prorrateo.test.ts:24` |
| 39 | ADR-006 E2: 2.260,00 = 1.950,23 + 309,77 | VERIFICADO (ejecutado) | `calculo-de-renglones.test.ts:128-137` |
| 40 | política MITAD_SUBE_SIMETRICA | VERIFICADO | `redondeo.ts:15` |
| 41 | tema 4 tokens `#rrggbb` lista cerrada | VERIFICADO | `tema.ts:9,20`; `tema-css.ts` |
| 42 | contraste 4,5 y 3 | VERIFICADO | `tema.ts:97-130` |
| 43 | `on-primary` opcional/derivado; primary ≥ 3:1 | NO ENCONTRADO | `tema.ts:9` |
| 44 | colores de marca libres por sucursal/empresa con control de contraste | **NO ENCONTRADO** | no hay columnas ni código |
| 45 | modo oscuro no en v1 | VERIFICADO | `tokens.css:11`; `legibilidad-de-la-app.test.ts` |
| 46 | fuente del sistema, piso 16 px, rem | VERIFICADO | `tokens.css:68-77`; test de legibilidad |
| 47 | objetivo táctil 48 px | VERIFICADO | `tokens.css:96-98` |
| 48 | radios `RECTO\|SUAVE\|REDONDEADO` | **DIFERENTE** (`RECTA\|SUAVE\|REDONDEADA`, más 4 listas de aspecto) | `aspecto.ts:15-19` |
| 49 | tokens de estado nunca de marca | VERIFICADO | `tokens.test.ts:141-190` |
| 50 | 0 colores sueltos en CSS | VERIFICADO (0 en 59 CSS; 9 literales en TS de QR/PDF/espejo) | `grep`; `tokens.test.ts:191-197` |
| 51 | mobile primero 375 px | **DIFERENTE** (390 x 844) | `vitest.config.ts:46` |
| 52 | solo servidor, sin pantalla de catálogo/caja/ventas/stock/clientes/compras | VERIFICADO | 0 imports de `src/modulos/<x>` en `apps/` |
| 53 | gate de 16 checks | **DIFERENTE** (gate de 6 pasos; CI de 13 jobs) | `package.json`; `.github/workflows/ci.yml` |
| 54 | cerco fallo cerrado con deuda vencible y violación inyectada | VERIFICADO (nombre distinto) | `test/arquitectura/lista-de-permitidos*.test.ts`; `arquitectura/deuda/` |
| 55 | caso `/\p{Cc}/u` de `datos-fiscales.ts` motivó la regla | VERIFICADO el caso, y SIGUE en el código como deuda | `datos-fiscales.ts:160`; `validacion-de-datos.json` |

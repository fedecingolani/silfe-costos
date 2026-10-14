# Descarga de listas de precios en PDF y Excel (Fase 4 del roadmap)

## Objetivo

Descargar cualquier lista guardada en PDF, con el formato de la lista de referencia
(`2023-DICIEMBRE.pdf`), y en Excel, con los precios como números.

## Problema y por qué

La lista de precios se manda a los clientes, así que tiene que salir con la misma estética que
venían usando: logo, título subrayado, renglones agrupados, "x docena", "+ IVA (21%)", y un pie
con un texto destacado y los datos de contacto. El Excel sirve para operar con los números.

## Decisiones que aplican

- Los dos formatos se generan **a pedido desde la foto guardada**, sin almacenar archivos.
- El deploy corre en Cloudflare Workers: nada de Chrome headless, y las librerías tienen que ser
  JS puro.
- Logo nuevo: `public/logo-silfe.png`. Es el JPG CMYK de Drive (`LOGOSILFE.jpg`), convertido a
  PNG sRGB de 592×600.
- El texto destacado del pie y el contacto se configuran en **Configuración**. Si no se cargan,
  el pie no muestra nada.

## Formato del PDF (referencia: lista de diciembre 2023)

- Logo centrado arriba.
- Título de la lista centrado, en negrita y subrayado.
- Renglones en orden:
  - producto: código y descripción en negrita;
  - repuestos debajo de su producto, precedidos por un renglón "Repuestos:", con sangría y
    sin negrita;
  - presentación como "x docena" cuando no es la unidad base. Si es "Unidad", no se muestra;
  - precio como `$ 24.500 + IVA (21%)`, con separador de miles es-AR y sin decimales si el
    precio es entero;
  - ítems manuales como renglones comunes, sin código si no tienen.
- Pie: texto destacado grande y centrado (por ejemplo "SIL – FE 30 AÑOS") y, abajo, el contacto
  en varias líneas.
- Tamaño A4, varias páginas si hace falta.

## Formato del Excel

- Una hoja con el título en la primera fila y las columnas: Código, Descripción, Presentación,
  Precio sin IVA (numérico), IVA % (numérico) y Repuesto (Sí/No).
- Los precios con formato de número y separador de miles.

## Checklist

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | Runner de tests de unidad (Vitest) y tests en rojo de los generadores de PDF y Excel | delegada (writer) | [x] |
| T2 | Configuración: texto destacado y contacto (migración + RLS + pantalla de Parámetros) | delegada (writer) | [x] |
| T3 | Generador de PDF con pdf-lib | delegada (writer) | [x] |
| T4 | Generador de Excel | delegada (writer) | [x] |
| T5 | Rutas de descarga y botones "PDF" y "Excel" en el índice y el detalle | delegada (writer) | [x] |
| T6 | Recorrido en el navegador y revisión visual del PDF | orquestador | [x] |

## Criterios de aceptación

- `GET /listas-precios/<id>/pdf` y `/excel` devuelven el archivo con un nombre derivado del
  nombre de la lista. Solo con sesión iniciada; sin sesión, redirigen al login como el resto.
- El PDF reproduce la estructura de la referencia: logo, título, productos con sus repuestos,
  "x docena", "+ IVA (n%)" y el pie configurado.
- El Excel abre con los precios como números.
- Los generadores son funciones puras (datos → bytes), probadas con Vitest.

## Checks

- Test-first con Vitest para los generadores. Por ejemplo, el PDF tiene que contener los textos
  esperados, y el Excel las celdas con valores numéricos.
- `supabase test db`, `npm run typecheck`, `npm run lint` y `npm run build`.
- Recorrido en el navegador contra Supabase local y revisión visual del PDF generado.

## Progreso

- Rama `feat/datos-venta-producto`. Base de revisión: `c412fec`.
- Logo descargado de Drive con autorización del usuario y convertido a `public/logo-silfe.png`.

- T1 a T5 implementados por un writer delegado:
  - dependencias: `vitest@3.2.4` (dev), `pdf-lib@1.17.1` y `xlsx` 0.20.3 desde el tarball
    oficial de SheetJS;
  - generadores puros en `src/lib/listas-precios/`;
  - migración `20261017000001_parametros_lista_precio.sql`, con su test pgTAP;
  - rutas `[id]/pdf` y `[id]/excel` y botones de descarga.
- RED observado: `npm test` falló porque faltaban los módulos. GREEN: 25 tests de Vitest en verde,
  verificado también desde el orquestador. `supabase test db`: 69 en verde. Typecheck, lint y
  build OK.
- T6, recorrido en el navegador contra Supabase local:
  - en Parámetros se cargó el texto destacado y el contacto (datos de prueba);
  - se creó una lista;
  - `/pdf` responde 200, `application/pdf`, `%PDF`, unos 157 KB con el logo, y nombre de
    archivo `prueba-descarga.pdf`;
  - `/excel` responde 200, con el content-type de xlsx y firma `PK`;
  - sin sesión, la ruta del PDF redirige al login (307).
- Revisión visual del PDF de muestra: coincide con la referencia (logo, título subrayado,
  productos en negrita, "Repuestos:" con "x docena", "+ IVA (n%)" y el pie).
- Pendientes:
  - el logo se busca con un fetch al propio sitio, y eso no se probó en Workers; si falla, el
    PDF sale sin logo;
  - un id que no es uuid devuelve 500;
  - los caracteres fuera de WinAnsi salen como "?".

- Commit `be3bec0`. Revisión `review-fcf7ab3e060c8391`, con consentimiento: **aprobada y
  confirmada**. Seguimientos que no bloquean:
  - un id inválido devuelve 500 con el mensaje de la base;
  - el fetch del logo no tiene timeout y se ignora en silencio si falla;
  - una presentación larga puede superponerse con el precio en el PDF;
  - las rutas no tienen tests;
  - "Repuestos:" puede quedar sola al final de una página.

- Revisión de la rama completa (Fases 1 a 4) `review-ba61cec4ddf59e41`, con consentimiento:
  **aprobada y confirmada**. Hallazgos nuevos que no bloquean, para la pasada de mejoras:
  - borrar un producto entre que se abre el editor y se guarda la lista devuelve un error de FK
    (23503) crudo;
  - el fetch del logo corre dentro del mismo `Promise.all` y sin timeout, así que puede trabar
    la descarga;
  - el PDF no es determinístico (`CreationDate`/`ModDate`);
  - las palabras largas no se cortan;
  - el test de varias páginas es débil.

## Próximo paso

La pasada de mejoras con los seguimientos de las
revisiones y, más adelante, el deploy (con `db push`), que decide el usuario.

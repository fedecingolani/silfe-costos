-- =====================================================================
-- Silfe Costos - Pie de la lista de precios descargada (Fase 4)
-- Texto destacado y datos de contacto que se imprimen al final del PDF.
-- Se configuran en la pantalla de Parámetros. Si están vacíos, el pie no
-- muestra nada.
-- parametro_costeo ya tiene RLS y permisos para los autenticados
-- (20260901000003): las columnas nuevas no necesitan cambios de permisos.
-- =====================================================================

alter table parametro_costeo
  add column lista_texto_destacado text,
  add column lista_contacto        text;

comment on column parametro_costeo.lista_texto_destacado is
  'Texto grande y centrado del pie de la lista de precios en PDF (ej. "SIL – FE 30 AÑOS"). Vacío: no se imprime';
comment on column parametro_costeo.lista_contacto is
  'Datos de contacto del pie de la lista de precios en PDF, en varias líneas. Vacío: no se imprime';

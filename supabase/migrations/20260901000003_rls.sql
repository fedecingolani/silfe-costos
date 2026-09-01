-- =====================================================================
-- Silfe Costos - Row Level Security
-- Aplicación interna: todo usuario autenticado puede operar sobre los
-- datos; los anónimos no tienen acceso.
-- =====================================================================

do $$
declare
  t text;
  tablas text[] := array[
    'unidad_medida','conversion_unidad','proveedor','materia_prima',
    'precio_materia_prima','categoria_mano_obra','proceso','producto',
    'producto_componente','producto_proceso','parametro_costeo'
  ];
begin
  foreach t in array tablas loop
    execute format('alter table public.%I enable row level security', t);

    execute format($f$
      create policy "%1$s_select_autenticado" on public.%1$I
        for select to authenticated using (true)
    $f$, t);

    execute format($f$
      create policy "%1$s_insert_autenticado" on public.%1$I
        for insert to authenticated with check (true)
    $f$, t);

    execute format($f$
      create policy "%1$s_update_autenticado" on public.%1$I
        for update to authenticated using (true) with check (true)
    $f$, t);

    execute format($f$
      create policy "%1$s_delete_autenticado" on public.%1$I
        for delete to authenticated using (true)
    $f$, t);
  end loop;
end;
$$;

-- parametro_costeo es una fila única de configuración: no se borra.
drop policy "parametro_costeo_delete_autenticado" on public.parametro_costeo;
drop policy "parametro_costeo_insert_autenticado" on public.parametro_costeo;

-- ---------------------------------------------------------------------
-- Permisos explícitos por rol
-- ---------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

-- Los anónimos no ven nada.
revoke all on all tables in schema public from anon;

-- Los autenticados operan sobre las tablas; RLS ya está activo encima.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Las vistas de costeo son de sólo lectura y heredan el RLS de sus tablas
-- (security_invoker = true).
revoke insert, update, delete on
  v_materia_prima_precio, v_materia_prima_costo, v_proceso_costo,
  v_producto_mano_obra, v_subgrupo_costo, v_componente_detalle,
  v_producto_costo, v_explosion_materiales, v_uso_materia_prima
from authenticated;

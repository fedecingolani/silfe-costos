-- =====================================================================
-- Silfe Costos - Endurecimiento de funciones
--
-- Las dos funciones del esquema son de trigger y no deben poder
-- invocarse desde la API. PostgreSQL no exige EXECUTE para disparar un
-- trigger, así que revocarlo no afecta su funcionamiento.
-- =====================================================================

-- search_path fijo: la función sólo toca NEW, no necesita resolver nombres.
create or replace function fn_set_actualizado_en()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

revoke execute on function public.fn_set_actualizado_en() from anon, authenticated, public;
revoke execute on function public.fn_validar_estructura_dos_niveles() from anon, authenticated, public;

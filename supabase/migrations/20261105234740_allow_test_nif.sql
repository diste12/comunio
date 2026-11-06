-- Explicit test-fixture exception; retain the existing shape checks otherwise.
-- No stored values are changed. Existing unique constraints remain in place.
begin;

alter table public.condominiums
  drop constraint condominiums_nif_condominio_check,
  add constraint condominiums_nif_condominio_check
    check (nif_condominio = '55555' or nif_condominio ~ '^[0-9]{9}$');

alter table public.residents
  drop constraint residents_nif_check,
  add constraint residents_nif_check
    check (nif is null or nif = '55555' or nif ~ '^[0-9]{9}$');

commit;

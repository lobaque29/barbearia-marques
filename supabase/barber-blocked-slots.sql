begin;

create table if not exists public.barbearia_blocked_slots (
  id uuid primary key default gen_random_uuid(),
  booking_date date not null,
  booking_time time without time zone not null,
  barber_id text not null check (barber_id in ('wilson', 'barbeiro1', 'barbeiro2')),
  reason text not null default 'Indisponível'
    check (char_length(btrim(reason)) between 1 and 120),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (booking_date, booking_time, barber_id),
  check (booking_time between time '09:00' and time '18:00'
    and extract(minute from booking_time) = 0
    and extract(second from booking_time) = 0),
  check (extract(dow from booking_date) <> 0)
);

alter table public.barbearia_blocked_slots enable row level security;
revoke all on table public.barbearia_blocked_slots from public, anon, authenticated;

create or replace function public.barbearia_availability(
  p_start date,
  p_end date
)
returns table (
  booking_date date,
  booking_time time without time zone,
  barber_id text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_start is null or p_end is null
     or p_start < (now() at time zone 'America/Sao_Paulo')::date
     or p_end < p_start
     or p_end > (now() at time zone 'America/Sao_Paulo')::date + 21 then
    raise exception 'Período inválido' using errcode = '22023';
  end if;

  return query
  select occupied.booking_date, occupied.booking_time, occupied.barber_id
    from (
      select appointments.booking_date, appointments.booking_time, appointments.barber_id
        from public.barbearia_appointments as appointments
       where appointments.booking_date between p_start and p_end
         and appointments.status in ('pending', 'confirmed')
      union
      select blocks.booking_date, blocks.booking_time, blocks.barber_id
        from public.barbearia_blocked_slots as blocks
       where blocks.booking_date between p_start and p_end
    ) as occupied
   order by occupied.booking_date, occupied.booking_time, occupied.barber_id;
end;
$$;

create or replace function public.barbearia_reserve(
  p_service text,
  p_barber_id text,
  p_name text,
  p_phone text,
  p_date date,
  p_time time without time zone
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen text;
  barber_name text;
  clean_name text := regexp_replace(btrim(p_name), '\s+', ' ', 'g');
  clean_phone text := regexp_replace(p_phone, '[^0-9]', '', 'g');
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_service is null
     or not exists (
       select 1 from public.barbearia_services where service = p_service
     )
     or p_barber_id is null
     or p_barber_id not in ('any', 'wilson', 'barbeiro1', 'barbeiro2')
     or clean_name is null
     or char_length(clean_name) not between 2 and 80
     or clean_name ~ '[[:cntrl:]]'
     or clean_phone is null
     or clean_phone !~ '^[0-9]{10,15}$'
     or p_date is null
     or p_date < today
     or p_date > today + 21
     or extract(dow from p_date) = 0
     or p_time is null
     or p_time < time '09:00'
     or p_time > time '18:00'
     or extract(minute from p_time) <> 0
     or extract(second from p_time) <> 0
     or (p_date = today and p_time <= (now() at time zone 'America/Sao_Paulo')::time) then
    raise exception 'Confira o serviço, nome, telefone, data e horário.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_date::text),
    pg_catalog.hashtext(p_time::text)
  );

  select candidate.id
    into chosen
    from (values ('wilson', 1), ('barbeiro1', 2), ('barbeiro2', 3))
      as candidate(id, position)
   where (p_barber_id = 'any' or p_barber_id = candidate.id)
     and not exists (
       select 1
         from public.barbearia_appointments as appointments
        where appointments.booking_date = p_date
          and appointments.booking_time = p_time
          and appointments.barber_id = candidate.id
          and appointments.status in ('pending', 'confirmed')
     )
     and not exists (
       select 1
         from public.barbearia_blocked_slots as blocks
        where blocks.booking_date = p_date
          and blocks.booking_time = p_time
          and blocks.barber_id = candidate.id
     )
   order by candidate.position
   limit 1;

  if chosen is null then
    return jsonb_build_object('reserved', false);
  end if;

  insert into public.barbearia_appointments (
    service, barber_id, customer_name, customer_phone, booking_date, booking_time
  )
  values (p_service, chosen, clean_name, clean_phone, p_date, p_time);

  barber_name := case chosen
    when 'wilson' then 'Wilson'
    when 'barbeiro1' then 'Barbeiro 1'
    else 'Barbeiro 2'
  end;
  return jsonb_build_object(
    'reserved', true,
    'booking', jsonb_build_object('barber_id', chosen, 'barber_name', barber_name)
  );
end;
$$;

create or replace function public.barbearia_admin_blocked_slots(
  p_start date,
  p_end date
)
returns table (
  id uuid,
  booking_date date,
  booking_time time without time zone,
  barber_id text,
  barber_name text,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1
      from public.barbearia_admin_users as admins
     where admins.user_id = auth.uid()
  ) then
    raise exception 'Acesso administrativo não autorizado.' using errcode = '42501';
  end if;

  if p_start is null or p_end is null or p_end < p_start or p_end > p_start + 31 then
    raise exception 'Escolha um período válido de até 32 dias.' using errcode = '22023';
  end if;

  return query
  select blocks.id,
         blocks.booking_date,
         blocks.booking_time,
         blocks.barber_id,
         case blocks.barber_id
           when 'wilson' then 'Wilson'
           when 'barbeiro1' then 'Barbeiro 1'
           when 'barbeiro2' then 'Barbeiro 2'
         end,
         blocks.reason
    from public.barbearia_blocked_slots as blocks
   where blocks.booking_date between p_start and p_end
   order by blocks.booking_date, blocks.booking_time, blocks.barber_id;
end;
$$;

create or replace function public.barbearia_block_slot(
  p_date date,
  p_time time without time zone,
  p_barber_id text,
  p_reason text default null
)
returns table (
  id uuid,
  booking_date date,
  booking_time time without time zone,
  barber_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  block_id uuid;
  clean_reason text := coalesce(nullif(btrim(p_reason), ''), 'Indisponível');
begin
  if auth.uid() is null or not exists (
    select 1
      from public.barbearia_admin_users as admins
     where admins.user_id = auth.uid()
  ) then
    raise exception 'Acesso administrativo não autorizado.' using errcode = '42501';
  end if;

  if p_date is null or p_date < today or p_date > today + 21
     or extract(dow from p_date) = 0
     or p_time is null or p_time < time '09:00' or p_time > time '18:00'
     or extract(minute from p_time) <> 0 or extract(second from p_time) <> 0
     or p_barber_id is null
     or p_barber_id not in ('wilson', 'barbeiro1', 'barbeiro2')
     or char_length(clean_reason) > 120 then
    raise exception 'Escolha um barbeiro, data e horário válidos.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_date::text),
    pg_catalog.hashtext(p_time::text)
  );

  if exists (
    select 1
      from public.barbearia_appointments as appointments
     where appointments.booking_date = p_date
       and appointments.booking_time = p_time
       and appointments.barber_id = p_barber_id
       and appointments.status in ('pending', 'confirmed')
  ) then
    raise exception 'Esse horário já possui um agendamento.' using errcode = '23P01';
  end if;

  insert into public.barbearia_blocked_slots as inserted (
    booking_date, booking_time, barber_id, reason, created_by
  )
  values (p_date, p_time, p_barber_id, clean_reason, auth.uid())
  on conflict (booking_date, booking_time, barber_id) do nothing
  returning inserted.id into block_id;

  if block_id is null then
    raise exception 'Esse horário já está bloqueado.' using errcode = '23505';
  end if;

  return query
  select blocks.id, blocks.booking_date, blocks.booking_time, blocks.barber_id
    from public.barbearia_blocked_slots as blocks
   where blocks.id = block_id;
end;
$$;

create or replace function public.barbearia_unblock_slot(
  p_block_id uuid
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  block_date date;
  block_time time without time zone;
begin
  if auth.uid() is null or not exists (
    select 1
      from public.barbearia_admin_users as admins
     where admins.user_id = auth.uid()
  ) then
    raise exception 'Acesso administrativo não autorizado.' using errcode = '42501';
  end if;

  select blocks.booking_date, blocks.booking_time
    into block_date, block_time
    from public.barbearia_blocked_slots as blocks
   where blocks.id = p_block_id
   for update;

  if not found then
    raise exception 'Horário bloqueado não encontrado.' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(block_date::text),
    pg_catalog.hashtext(block_time::text)
  );

  delete from public.barbearia_blocked_slots as blocks
   where blocks.id = p_block_id;

  return query select p_block_id;
end;
$$;

revoke all on function public.barbearia_availability(date, date) from public;
revoke all on function public.barbearia_reserve(text, text, text, text, date, time without time zone) from public;
revoke all on function public.barbearia_admin_blocked_slots(date, date) from public, anon;
revoke all on function public.barbearia_block_slot(date, time without time zone, text, text) from public, anon;
revoke all on function public.barbearia_unblock_slot(uuid) from public, anon;

grant execute on function public.barbearia_availability(date, date) to anon, authenticated;
grant execute on function public.barbearia_reserve(text, text, text, text, date, time without time zone) to anon, authenticated;
grant execute on function public.barbearia_admin_blocked_slots(date, date) to authenticated;
grant execute on function public.barbearia_block_slot(date, time without time zone, text, text) to authenticated;
grant execute on function public.barbearia_unblock_slot(uuid) to authenticated;

commit;

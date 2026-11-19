-- Execute em um projeto Supabase novo, pelo SQL Editor.
begin;

create table public.barbearia_services (
  service text primary key,
  price_cents integer check (price_cents between 0 and 1000000)
);

insert into public.barbearia_services (service, price_cents) values
  ('Corte disfarçado', 3500), ('Corte social', 3000), ('Barba', 3000),
  ('Pezinho', 1500), ('Sobrancelha', 1500), ('Máquina geral', 2000),
  ('Pigmentação', 3000), ('Relaxamento', 3000),
  ('Disfarçado + Barba + Sobrancelha', 6500), ('Disfarçado + Barba', 5500),
  ('Disfarçado + Sobrancelha', 4500), ('Social + Barba + Sobrancelha', 6000),
  ('Social + Barba', 5000), ('Social + Sobrancelha', 4000);

create table public.barbearia_appointments (
  id uuid primary key default gen_random_uuid(),
  service text not null references public.barbearia_services(service),
  barber_id text not null check (barber_id in ('wilson', 'barbeiro1', 'barbeiro2')),
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 80),
  customer_phone text not null check (customer_phone ~ '^[0-9]{10,15}$'),
  booking_date date not null check (extract(dow from booking_date) <> 0),
  booking_time time not null check (booking_time between time '09:00' and time '18:00' and extract(minute from booking_time) = 0 and extract(second from booking_time) = 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create unique index barbearia_active_slot_unique
  on public.barbearia_appointments (booking_date, booking_time, barber_id)
  where status in ('pending', 'confirmed');

alter table public.barbearia_services enable row level security;
alter table public.barbearia_appointments enable row level security;
revoke all on public.barbearia_services, public.barbearia_appointments from public, anon, authenticated;

create function public.barbearia_prices()
returns table (service text, price_cents integer)
language sql security definer set search_path = ''
as $$
  select s.service, s.price_cents from public.barbearia_services s order by s.service;
$$;

create function public.barbearia_availability(p_start date, p_end date)
returns table (booking_date date, booking_time time, barber_id text)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_start is null or p_end is null or p_start < (now() at time zone 'America/Sao_Paulo')::date
      or p_end < p_start or p_end > (now() at time zone 'America/Sao_Paulo')::date + 21 then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  return query select a.booking_date, a.booking_time, a.barber_id
    from public.barbearia_appointments a
    where a.booking_date between p_start and p_end and a.status in ('pending', 'confirmed')
    order by a.booking_date, a.booking_time;
end;
$$;

create function public.barbearia_reserve(
  p_service text, p_barber_id text, p_name text, p_phone text, p_date date, p_time time
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  chosen text;
  barber_name text;
  clean_name text := regexp_replace(btrim(p_name), '\s+', ' ', 'g');
  clean_phone text := regexp_replace(p_phone, '[^0-9]', '', 'g');
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_service is null or not exists (select 1 from public.barbearia_services where service = p_service)
    or p_barber_id is null or p_barber_id not in ('any', 'wilson', 'barbeiro1', 'barbeiro2')
    or clean_name is null or char_length(clean_name) not between 2 and 80 or clean_name ~ '[[:cntrl:]]'
    or clean_phone is null or clean_phone !~ '^[0-9]{10,15}$'
    or p_date is null or p_date < today or p_date > today + 21 or extract(dow from p_date) = 0
    or p_time is null or p_time < time '09:00' or p_time > time '18:00'
    or extract(minute from p_time) <> 0 or extract(second from p_time) <> 0
    or (p_date = today and p_time <= (now() at time zone 'America/Sao_Paulo')::time) then
    raise exception 'Confira o serviço, nome, telefone, data e horário.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_date::text), pg_catalog.hashtext(p_time::text));
  select candidate.id into chosen
    from (values ('wilson', 1), ('barbeiro1', 2), ('barbeiro2', 3)) as candidate(id, position)
    where (p_barber_id = 'any' or p_barber_id = candidate.id)
      and not exists (
        select 1 from public.barbearia_appointments a
        where a.booking_date = p_date and a.booking_time = p_time
          and a.barber_id = candidate.id and a.status in ('pending', 'confirmed')
      )
    order by candidate.position limit 1;
  if chosen is null then
    return jsonb_build_object('reserved', false);
  end if;
  insert into public.barbearia_appointments (service, barber_id, customer_name, customer_phone, booking_date, booking_time)
    values (p_service, chosen, clean_name, clean_phone, p_date, p_time);
  barber_name := case chosen when 'wilson' then 'Wilson' when 'barbeiro1' then 'Barbeiro 1' else 'Barbeiro 2' end;
  return jsonb_build_object('reserved', true, 'booking', jsonb_build_object('barber_id', chosen, 'barber_name', barber_name));
end;
$$;

revoke all on function public.barbearia_prices() from public;
revoke all on function public.barbearia_availability(date, date) from public;
revoke all on function public.barbearia_reserve(text, text, text, text, date, time) from public;
grant execute on function public.barbearia_prices(), public.barbearia_availability(date, date),
  public.barbearia_reserve(text, text, text, text, date, time) to anon, authenticated;

commit;

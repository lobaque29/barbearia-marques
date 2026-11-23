begin;

create table if not exists public.barbearia_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.barbearia_admin_users enable row level security;
revoke all on table public.barbearia_admin_users from public, anon, authenticated;

create or replace function public.barbearia_admin_appointments(
  p_start date,
  p_end date
)
returns table (
  id uuid,
  service text,
  barber_id text,
  barber_name text,
  customer_name text,
  customer_phone text,
  status text,
  booking_date date,
  booking_time time without time zone
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
  select appointments.id,
         appointments.service,
         appointments.barber_id,
         case appointments.barber_id
           when 'wilson' then 'Wilson'
           when 'barbeiro1' then 'Barbeiro 1'
           when 'barbeiro2' then 'Barbeiro 2'
           else appointments.barber_id
         end,
         appointments.customer_name,
         appointments.customer_phone,
         appointments.status,
         appointments.booking_date,
         appointments.booking_time
    from public.barbearia_appointments as appointments
   where appointments.booking_date between p_start and p_end
   order by appointments.booking_date, appointments.booking_time, appointments.barber_id;
end;
$$;

create or replace function public.barbearia_cancel_appointment(
  p_appointment_id uuid
)
returns table (id uuid, status text)
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

  return query
  update public.barbearia_appointments as appointments
     set status = 'cancelled'
   where appointments.id = p_appointment_id
     and appointments.status in ('pending', 'confirmed')
   returning appointments.id, appointments.status;

  if not found then
    raise exception 'Agendamento não encontrado ou já cancelado.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.barbearia_admin_appointments(date, date) from public, anon;
revoke all on function public.barbearia_cancel_appointment(uuid) from public, anon;
grant execute on function public.barbearia_admin_appointments(date, date) to authenticated;
grant execute on function public.barbearia_cancel_appointment(uuid) to authenticated;

commit;

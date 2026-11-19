begin;

create or replace view public.barbearia_agenda_mensagem
with (security_invoker = true) as
select
  booking_date,
  '📅 *AGENDA DO DIA — ' || to_char(booking_date, 'DD/MM/YYYY') || '*' || E'\n\n' ||
  string_agg(
    '🕒 *' || to_char(booking_time, 'HH24:MI') || '*'
      || E'\n👤 Cliente: ' || customer_name
      || E'\n💈 Barbeiro: ' || case barber_id
        when 'wilson' then 'Wilson'
        when 'barbeiro1' then 'Barbeiro 1'
        when 'barbeiro2' then 'Barbeiro 2'
        else barber_id end
      || E'\n✂️ Serviço: ' || service
      || E'\n📌 Status: ' || case status when 'pending' then 'Aguardando' else 'Confirmado' end,
    E'\n\n' order by booking_time, barber_id, id
  ) || E'\n\n— Barbearia Marques' as mensagem
from public.barbearia_appointments
where status in ('pending', 'confirmed')
group by booking_date;

revoke all on public.barbearia_agenda_mensagem from public, anon, authenticated;

commit;

function formatPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(`${date}T12:00:00Z`));
}

export function buildMessage(appointment, daySchedule) {
  const heading = [
    '🔔 *NOVO AGENDAMENTO RECEBIDO*',
    '',
    `👤 *Cliente:* ${appointment.customer_name}`,
    `📞 *Contato:* +${formatPhone(appointment.customer_phone)}`,
    `🛠️ *Serviço:* ${appointment.service}`,
    `⏰ *Horário:* ${appointment.booking_time.slice(0, 5)} · ${formatDate(appointment.booking_date)}`,
    '',
    '_Horário bloqueado; confirme com o cliente para concluir o atendimento._',
    '',
    `📅 *AGENDA DO DIA (${formatDate(appointment.booking_date)}):*`,
  ];
  const rows = daySchedule.map(item => {
    const isNew = item.id === appointment.id;
    const line = `${item.booking_time.slice(0, 5)} - ${item.customer_name} (${item.service})`;
    return isNew ? `🕒 *${line}* 👈 _Novo_` : `• ${line}`;
  });
  return [...heading, ...rows, '', '— Barbearia Marquês'].join('\n');
}

(() => {
  const SUPABASE_URL = 'https://dufsnearwwbekqxmvyqn.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_GTkOo6txLjw7aBUsy4By3g_pVdOXiPq';
  const labels = { pending: 'Aguardando', confirmed: 'Confirmado', cancelled: 'Cancelado' };
  let session = null;

  const styles = document.createElement('style');
  styles.textContent = `
    #barber-dashboard-trigger{position:fixed;right:16px;bottom:16px;z-index:10000;border:1px solid #d4af37;border-radius:999px;background:#171717;color:#f2e3b1;padding:11px 16px;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 6px 24px #0008;cursor:pointer}
    #barber-dashboard-dialog{width:min(920px,calc(100vw - 24px));max-width:none;max-height:min(88vh,850px);padding:0;border:1px solid #39352a;border-radius:18px;background:#111;color:#f5f2e8;font:14px/1.5 system-ui,sans-serif}
    #barber-dashboard-dialog::backdrop{background:#000b;backdrop-filter:blur(3px)}
    #barber-dashboard-dialog *{box-sizing:border-box}
    #barber-dashboard-dialog .barber-shell{padding:24px}
    #barber-dashboard-dialog .barber-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
    #barber-dashboard-dialog .barber-title{margin:0;font-size:24px}
    #barber-dashboard-dialog .barber-muted{color:#b8b2a5}
    #barber-dashboard-dialog .barber-form{display:grid;gap:13px;margin-top:22px}
    #barber-dashboard-dialog .barber-field{display:grid;gap:6px}
    #barber-dashboard-dialog label{color:#b8b2a5;font-size:12px;font-weight:700}
    #barber-dashboard-dialog input{min-height:42px;width:100%;padding:0 11px;border:1px solid #39352a;border-radius:8px;background:#1b1b1b;color:#f5f2e8;font:inherit}
    #barber-dashboard-dialog .barber-button{min-height:38px;padding:0 13px;border:1px solid #39352a;border-radius:8px;background:#1b1b1b;color:#f5f2e8;font:600 13px system-ui,sans-serif;cursor:pointer}
    #barber-dashboard-dialog .barber-primary{border-color:#d4af37;background:#d4af37;color:#171717}
    #barber-dashboard-dialog .barber-cancel{color:#e17770}
    #barber-dashboard-dialog button:disabled{opacity:.55;cursor:wait}
    #barber-dashboard-dialog .barber-error{margin:14px 0;padding:10px 12px;border:1px solid #75403c;border-radius:8px;background:#321c1b;color:#f0aaa3}
    #barber-dashboard-dialog .barber-toolbar{display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin:18px 0}
    #barber-dashboard-dialog .barber-toolbar .barber-field{min-width:150px;flex:1}
    #barber-dashboard-dialog .barber-table-wrap{max-height:52vh;overflow:auto;border:1px solid #39352a;border-radius:10px}
    #barber-dashboard-dialog table{width:100%;border-collapse:collapse;min-width:700px;text-align:left}
    #barber-dashboard-dialog th,#barber-dashboard-dialog td{padding:10px;border-bottom:1px solid #39352a;font-size:12px}
    #barber-dashboard-dialog th{position:sticky;top:0;background:#1b1b1b;color:#b8b2a5;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
    #barber-dashboard-dialog .barber-status{display:inline-block;padding:4px 8px;border-radius:20px;background:#382f18;color:#f2d477;font-size:10px;font-weight:700}
    #barber-dashboard-dialog .barber-status.confirmed{background:#332b16;color:#e3c455}
    #barber-dashboard-dialog .barber-status.cancelled{background:#282722;color:#aaa}
    #barber-dashboard-dialog .barber-empty{padding:22px;text-align:center;color:#b8b2a5}
    @media(max-width:600px){#barber-dashboard-dialog .barber-shell{padding:18px}#barber-dashboard-dialog .barber-title{font-size:20px}}
  `;
  document.head.append(styles);

  const trigger = document.createElement('button');
  trigger.id = 'barber-dashboard-trigger';
  trigger.type = 'button';
  trigger.textContent = 'Área do barbeiro';

  const dialog = document.createElement('dialog');
  dialog.id = 'barber-dashboard-dialog';
  dialog.setAttribute('aria-labelledby', 'barber-dialog-title');

  const shell = document.createElement('div');
  shell.className = 'barber-shell';
  dialog.append(shell);
  document.body.append(trigger, dialog);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showError(container, message) {
    container.hidden = !message;
    container.textContent = message;
  }

  async function responseJson(response) {
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('O servidor retornou uma resposta inválida.');
      }
    }
    if (!response.ok) {
      throw new Error(
        payload?.msg || payload?.message || payload?.error_description ||
        payload?.error || 'Não foi possível concluir a solicitação.',
      );
    }
    return payload;
  }

  async function signIn(email, password) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    session = await responseJson(response);
  }

  async function refreshSession() {
    if (!session?.refresh_token) throw new Error('Sua sessão expirou. Entre novamente.');
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    session = await responseJson(response);
  }

  async function rpc(name, args, retry = true) {
    if (!session?.access_token) throw new Error('Entre novamente para continuar.');
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (response.status === 401 && retry) {
      try {
        await refreshSession();
      } catch {
        session = null;
        throw new Error('Sua sessão expirou. Entre novamente.');
      }
      return rpc(name, args, false);
    }
    return responseJson(response);
  }

  function dateKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  function shiftDate(value, days) {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function dateLabel(value) {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' })
      .format(new Date(`${value}T00:00:00Z`));
  }

  function setDateRange(start, end) {
    start.value = dateKey();
    end.value = shiftDate(start.value, 14);
  }

  function buildLogin() {
    shell.replaceChildren();
    const header = element('div', 'barber-top');
    header.append(
      element('h2', 'barber-title', 'Acesso do barbeiro'),
      closeButton(),
    );
    shell.append(header, element('p', 'barber-muted', 'Entre com seu e-mail e senha.'));

    const form = element('form', 'barber-form');
    const email = element('input');
    email.type = 'email';
    email.autocomplete = 'username';
    email.required = true;
    email.setAttribute('aria-label', 'E-mail');
    const password = element('input');
    password.type = 'password';
    password.autocomplete = 'current-password';
    password.required = true;
    password.setAttribute('aria-label', 'Senha');
    for (const [labelText, input] of [['E-mail', email], ['Senha', password]]) {
      const field = element('div', 'barber-field');
      field.append(element('label', '', labelText), input);
      form.append(field);
    }
    const error = element('div', 'barber-error');
    error.hidden = true;
    const submit = element('button', 'barber-button barber-primary', 'Entrar');
    submit.type = 'submit';
    form.append(submit);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      showError(error, '');
      try {
        await signIn(email.value.trim(), password.value);
        await buildAgenda();
      } catch (reason) {
        showError(error, reason.message);
      } finally {
        submit.disabled = false;
        password.value = '';
      }
    });
    shell.append(form, error);
    email.focus();
  }

  function closeButton() {
    const button = element('button', 'barber-button', 'Fechar');
    button.type = 'button';
    button.addEventListener('click', () => dialog.close());
    return button;
  }

  function appendCell(row, value) {
    const cell = element('td', '', value);
    row.append(cell);
    return cell;
  }

  async function loadAppointments(start, end, rows, empty, error) {
    if (!start.value || !end.value || end.value < start.value ||
        (Date.parse(end.value) - Date.parse(start.value)) / 86400000 > 31) {
      throw new Error('Escolha um período válido de até 32 dias.');
    }
    const appointments = await rpc('barbearia_admin_appointments', {
      p_start: start.value,
      p_end: end.value,
    });
    if (!Array.isArray(appointments)) throw new Error('Não foi possível interpretar a agenda.');
    rows.replaceChildren();
    empty.hidden = appointments.length > 0;
    for (const appointment of appointments) {
      const row = document.createElement('tr');
      appendCell(row, `${dateLabel(appointment.booking_date)} · ${String(appointment.booking_time).slice(0, 5)}`);
      appendCell(row, appointment.customer_name);
      appendCell(row, appointment.customer_phone || '—');
      appendCell(row, appointment.service);
      appendCell(row, appointment.barber_name || appointment.barber_id || '—');
      const status = element('span', `barber-status ${appointment.status}`, labels[appointment.status] || appointment.status);
      appendCell(row, '').append(status);
      const action = appendCell(row, '');
      if (appointment.status === 'pending' || appointment.status === 'confirmed') {
        const cancel = element('button', 'barber-button barber-cancel', 'Cancelar');
        cancel.type = 'button';
        cancel.addEventListener('click', async () => {
          const time = String(appointment.booking_time).slice(0, 5);
          if (!window.confirm(`Cancelar o horário de ${appointment.customer_name} em ${dateLabel(appointment.booking_date)} às ${time}?`)) return;
          cancel.disabled = true;
          showError(error, '');
          try {
            const result = await rpc('barbearia_cancel_appointment', {
              p_appointment_id: appointment.id,
            });
            if (!Array.isArray(result) || !result.length) {
              throw new Error('O agendamento não foi cancelado. Atualize a agenda e tente novamente.');
            }
            await loadAppointments(start, end, rows, empty, error);
          } catch (reason) {
            cancel.disabled = false;
            showError(error, reason.message);
          }
        });
        action.append(cancel);
      } else {
        action.textContent = '—';
      }
      rows.append(row);
    }
    showError(error, '');
  }

  async function buildAgenda() {
    shell.replaceChildren();
    const header = element('div', 'barber-top');
    header.append(element('h2', 'barber-title', 'Agenda de agendamentos'));
    const logout = element('button', 'barber-button', 'Sair');
    logout.type = 'button';
    logout.addEventListener('click', async () => {
      const token = session?.access_token;
      session = null;
      buildLogin();
      if (token) {
        try {
          const response = await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
            method: 'POST',
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
          });
          if (!response.ok) console.error('Não foi possível revogar a sessão remota.');
        } catch (error) {
          console.error('Não foi possível revogar a sessão remota:', error);
        }
      }
    });
    header.append(logout);
    shell.append(header, element('p', 'barber-muted', 'Cancele uma reserva se o cliente desistir; o horário será liberado no site.'));

    const toolbar = element('form', 'barber-toolbar');
    const start = element('input');
    const end = element('input');
    start.type = end.type = 'date';
    start.required = end.required = true;
    for (const [labelText, input] of [['De', start], ['Até', end]]) {
      const field = element('div', 'barber-field');
      const label = element('label', '', labelText);
      label.htmlFor = `barber-${labelText === 'De' ? 'start' : 'end'}`;
      input.id = label.htmlFor;
      field.append(label, input);
      toolbar.append(field);
    }
    setDateRange(start, end);
    const refresh = element('button', 'barber-button barber-primary', 'Buscar agenda');
    refresh.type = 'submit';
    toolbar.append(refresh);

    const error = element('div', 'barber-error');
    error.hidden = true;
    const tableWrap = element('div', 'barber-table-wrap');
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const heading of ['Data e horário', 'Cliente', 'Contato', 'Serviço', 'Barbeiro', 'Status', 'Ação']) {
      headerRow.append(element('th', '', heading));
    }
    head.append(headerRow);
    const rows = document.createElement('tbody');
    table.append(head, rows);
    const empty = element('div', 'barber-empty', 'Nenhum agendamento neste período.');
    empty.hidden = true;
    tableWrap.append(table, empty);
    toolbar.addEventListener('submit', event => {
      event.preventDefault();
      refresh.disabled = true;
      loadAppointments(start, end, rows, empty, error)
        .catch(reason => showError(error, reason.message))
        .finally(() => { refresh.disabled = false; });
    });
    shell.append(toolbar, error, tableWrap);
    try {
      await loadAppointments(start, end, rows, empty, error);
    } catch (reason) {
      showError(error, reason.message);
    }
  }

  trigger.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
    if (session?.access_token) buildAgenda();
    else buildLogin();
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
})();

# Barbearia Marques

## Site com Supabase

O site público usa o projeto Supabase configurado para a barbearia. As reservas
pendentes e confirmadas bloqueiam a data e o horário por barbeiro; o site
consulta a disponibilidade periodicamente e o banco impede reservas duplicadas.
Para avisar a barbearia, o cliente deve abrir o WhatsApp após reservar e enviar
a mensagem manualmente. A lista completa fica privada no Table Editor do
Supabase, na tabela `barbearia_appointments`. Altere `status` para `confirmed`
ou `cancelled`; o cancelamento libera o horário. Preços dos serviços ficam na
tabela `barbearia_services`; preços dos produtos são fixos no site.

No Table Editor, `barbearia_agenda_mensagem` contém uma mensagem privada por
data com os agendamentos pendentes e confirmados. Copie e envie manualmente;
datas sem agendamentos ativos não aparecem. A view é criada pelo arquivo
`supabase/agenda-mensagem.sql` e não deve ser exposta a clientes.

A chave publicável pode aparecer no site; nunca publique senhas nem chaves
`secret` ou `service_role`. A reserva pública não possui CAPTCHA nem limitação
de requisições por cliente e está sujeita a reservas falsas. O painel antigo
`admin.html`, o contador de visitas e o envio automático de notificações não
estão integrados ao Supabase.

## Acesso do barbeiro para cancelar horários

A opção **Área do barbeiro** aparece dentro da landing page. O acesso usa
Supabase Auth com e-mail e senha; clientes não podem listar nem
cancelar agendamentos. A senha é digitada no formulário e não deve ser colocada
no HTML, JavaScript ou em outros arquivos publicados. Para ativar:

1. Execute [`supabase/barber-admin.sql`](./supabase/barber-admin.sql) no SQL
   Editor do mesmo projeto Supabase usado pelo site.
2. Em **Authentication > Users**, crie um usuário com o e-mail e a senha do
   barbeiro e copie o UUID da conta.
3. No SQL Editor, autorize somente esse usuário:

   ```sql
   insert into public.barbearia_admin_users (user_id)
   values ('UUID_DO_USUARIO');
   ```

4. Publique o arquivo `barber-dashboard.js` junto com a landing page. O barbeiro
   abre **Área do barbeiro**, entra com e-mail e senha, filtra as datas e cancela
   uma reserva ativa; o horário volta a ficar disponível para os clientes.

As funções de agenda e cancelamento verificam a lista de usuários autorizados no
banco. Não conceda acesso direto à tabela nem use uma chave `service_role` no
navegador.

## Backend Docker anterior

## Publicação no VPS

O site, a API, o painel e o banco devem ser hospedados juntos pelo Docker Compose,
no mesmo domínio HTTPS. Consulte [as instruções de configuração](./backend/README.md).
Agenda, preços e painel recebem atualizações por eventos em tempo real; o painel
mantém uma consulta periódica como contingência.

O workflow `.github/workflows/deploy-vps.yml` executa os testes do backend e,
se forem aprovados, publica automaticamente cada atualização enviada à branch
`main`. Para ativá-lo:

1. Prepare o VPS com Docker Compose, clone este repositório em
   `/opt/barbearia-marques` e configure o arquivo `.env` nesse diretório.
2. Crie uma chave SSH de implantação restrita ao usuário do serviço. O usuário
   precisa poder executar `git pull` e `docker compose` no diretório do projeto.
3. Configure estes segredos no GitHub, em **Settings > Secrets and variables >
   Actions**: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_PRIVATE_KEY` e
   `DEPLOY_KNOWN_HOSTS`. O último deve conter a chave pública do host SSH do VPS,
   obtida e verificada por um canal confiável.
4. Confirme que o HTTPS do domínio termina no proxy reverso do VPS e que o
   `.env` usa `COOKIE_SECURE=true`; depois envie uma atualização para `main` ou
   execute o workflow manualmente.

O workflow não transfere nem armazena o `.env`; as credenciais e os volumes
permanecem no VPS. Depois de confirmar o domínio e as reservas no novo endereço,
desative GitHub Pages nas configurações do repositório, pois Pages não executa
este backend.

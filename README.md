# Barbearia Marques

## Agenda no Supabase e GitHub Pages

O site público usa as funções e tabelas de `supabase/agenda.sql`, aplicadas
uma vez em um projeto Supabase novo. O site usa somente a chave publicável;
nunca coloque a senha do banco nem chaves `secret` ou `service_role` no site.
As tabelas não permitem acesso direto aos clientes por usuários anônimos.

Reservas pendentes e confirmadas bloqueiam a data e horário do barbeiro;
cancelamentos liberam o horário. As funções do banco aplicam essa regra também
quando clientes reservam simultaneamente. A página consulta disponibilidade e
preços a cada 15 segundos; a reserva é sempre verificada novamente no banco.

Depois de reservar, o cliente precisa abrir o WhatsApp e tocar em **Enviar**.
A barbearia não recebe mensagem automaticamente se o cliente não enviar.
A mensagem contém somente os dados da própria reserva, não a agenda de outras
pessoas. Acesse **Table Editor > barbearia_appointments** no painel privado do
Supabase para consultar a agenda e alterar `status` para `confirmed` ou
`cancelled`. Os preços dos serviços podem ser alterados em `barbearia_services`;
os produtos são informativos no site e seus preços são fixos no HTML.

O fluxo público de reservas ainda não implementa CAPTCHA ou limitação de
requisições por cliente; avalie proteção contra abuso antes de uso comercial.
O painel `admin.html`, o contador de visitas e as notificações automáticas do
backend Docker não estão integrados à agenda do Supabase.

## Backend Docker anterior

## GitHub Pages

O workflow `.github/workflows/pages.yml` publica o site estático no GitHub Pages.
O restante desta seção descreve o backend Docker anterior, não a integração
Supabase usada pelo site atual.

## Publicação automática no VPS

O workflow `.github/workflows/deploy-vps.yml` executa os testes do backend e,
se forem aprovados, publica atualizações enviadas à branch `main` no VPS.
Para ativá-lo:

1. Prepare o VPS com Docker Compose, clone este repositório em
   `/opt/barbearia-marques` e configure o arquivo `.env` nesse diretório.
2. Crie uma chave SSH de implantação restrita ao usuário do serviço. Esse usuário
   precisa poder acessar o repositório e executar `git` e `docker compose`.
3. Configure os segredos `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_PRIVATE_KEY`
   e `DEPLOY_KNOWN_HOSTS` em **Settings > Secrets and variables > Actions** no
   GitHub. Verifique a chave pública do host SSH por um canal confiável antes
   de cadastrá-la em `DEPLOY_KNOWN_HOSTS`.
4. Configure HTTPS no proxy reverso do VPS, usando o mesmo domínio para o site
   e a API, e defina `COOKIE_SECURE=true` no `.env`.

O workflow não transfere o `.env` nem apaga os volumes. O GitHub Pages continua
publicando a vitrine estática separadamente, sem acesso ao backend do VPS.

Reservas e preços são atualizados na página aberta por eventos; há consultas
periódicas como contingência caso a conexão de eventos seja interrompida.

Stack local: site servido pelo Nginx, API Node.js, PostgreSQL para agendamentos,
worker de notificações e Evolution API com PostgreSQL/Redis próprios. Os horários
são gravados como horário local de `America/Sao_Paulo`; o índice único do banco
impede duas reservas ativas para a mesma data e hora.

## Preparar

1. Instale Docker Engine e Docker Compose v2.
2. Na raiz do projeto, copie `.env.example` para `.env`. Troque as três senhas
   de exemplo por segredos aleatórios distintos, usando letras e números, e
   informe o WhatsApp do estabelecimento em formato internacional, só com
   dígitos (por exemplo, `5531999999999`). Configure também `ADMIN_USERNAME`
   e uma senha exclusiva em `ADMIN_PASSWORD`, com no mínimo 12 caracteres.
   Em acesso local HTTP, `COOKIE_SECURE=false`; ao publicar sob HTTPS,
   configure `COOKIE_SECURE=true`.
3. Inicie os serviços:

   ```sh
   docker compose up --build -d
   ```

4. Abra `http://localhost:8088` para acessar a página e `http://localhost:8080`
   para configurar a Evolution API. A API da Evolution fica vinculada apenas ao
   loopback do host; não a publique diretamente na internet. Em produção, sirva
   o site por HTTPS atrás de um proxy reverso com certificado TLS.
5. Na primeira inicialização, crie a instância configurada em `EVOLUTION_INSTANCE`
   usando a API:

   ```sh
   INSTANCE="$(sed -n 's/^EVOLUTION_INSTANCE=//p' .env)"
   curl -X POST http://localhost:8080/instance/create \
     -H "apikey: $(sed -n 's/^EVOLUTION_API_KEY=//p' .env)" \
     -H "Content-Type: application/json" \
     -d "{\"instanceName\":\"$INSTANCE\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true}"
   ```

   Leia o QR code retornado com o WhatsApp do estabelecimento. Confirme que a
   instância está conectada antes de aceitar agendamentos. Para uma operação
   comercial com requisitos de suporte e estabilidade, avalie usar a integração
   oficial WhatsApp Cloud API em vez da sessão WhatsApp Web (Baileys).

## Como funciona

- O painel administrativo fica em `/admin.html` (ou `/admin`) no mesmo domínio
  da API. O login usa cookie `HttpOnly`, sessão aleatória revogável e expiração
  de 12 horas; os segredos ficam somente no `.env`.
- No painel é possível filtrar a agenda, confirmar/cancelar reservas e editar os
  valores. As alterações de preço aparecem no site servido pela mesma API.
- O painel atualiza automaticamente e pode mostrar notificações do navegador
  quando ele está aberto. A notificação de cada nova reserva também segue pela
  Evolution API/WhatsApp já configurada.
- O contador registra visualizações diárias agregadas, sem salvar endereço IP
  nem identificador de visitantes. Só contabiliza visitas na cópia do site que
  usa este servidor; GitHub Pages não executa a API.
- A agenda tem Wilson, Barbeiro 1 e Barbeiro 2. A opção “Qualquer barbeiro”
  reserva automaticamente um profissional que esteja livre no horário.
- `GET /api/availability?start_date=AAAA-MM-DD&end_date=AAAA-MM-DD` retorna
  datas, horários e barbeiros ocupados, sem expor dados dos clientes.
- `POST /api/appointments` recebe serviço, barbeiro (ou `any`), nome, telefone,
  data e hora. A reserva é sincronizada por barbeiro; transações e um índice
  único impedem duas reservas simultâneas para o mesmo profissional. A reserva
  e a notificação são gravadas na mesma transação; conflitos retornam HTTP 409.
- O agendamento começa como `pending` e já bloqueia a vaga. O worker monta a
  mensagem com os dados do novo cliente e a agenda daquele dia e envia pela
  Evolution API. Falhas são repetidas com espera crescente; após oito tentativas,
  o job fica como `failed`.
- Para confirmar ou cancelar, altere `appointments.status` para `confirmed` ou
  `cancelled` no PostgreSQL. Cancelar libera a vaga. A lista enviada ao WhatsApp
  inclui as reservas pendentes e confirmadas.

Comandos úteis:

```sh
docker compose ps
docker compose logs -f api notification-worker evolution-api
docker compose exec app-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

O schema é aplicado automaticamente somente quando o volume `app_data` é criado
pela primeira vez. A atualização para a agenda por barbeiro exige executar
`backend/schema.sql` uma vez no banco existente para migrar as reservas antigas
(que serão atribuídas a Wilson), criar o índice por profissional e adicionar as
tabelas do painel. Para aplicar atualizações do schema em um banco existente,
execute de forma controlada:

```sh
docker compose exec -T app-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backend/schema.sql
```

Não remova volumes para aplicar atualizações em produção; mantenha backups.
Não publique `.env` nem os volumes de sessão do WhatsApp. O GitHub Pages atual
continua estático; para que login, reservas e estatísticas funcionem, publique o
site e `/admin.html` sob o mesmo domínio HTTPS da API, usando este stack atrás de
um proxy reverso com certificado TLS.

Se uma notificação atingir o limite de tentativas, confira os logs do worker,
restabeleça a conexão da Evolution e reprograme o job no banco:

```sql
UPDATE notification_jobs
   SET status = 'retry', attempts = 0, available_at = now(),
       last_error = NULL, locked_at = NULL
 WHERE status = 'failed';
```

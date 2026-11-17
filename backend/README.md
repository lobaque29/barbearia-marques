# Barbearia Marquês: agenda em Docker

Stack local: site servido pelo Nginx, API Node.js, PostgreSQL para agendamentos,
worker de notificações e Evolution API com PostgreSQL/Redis próprios. Os horários
são gravados como horário local de `America/Sao_Paulo`; o índice único do banco
impede duas reservas ativas para a mesma data e hora.

## Preparar

1. Instale Docker Engine e Docker Compose v2.
2. Na raiz do projeto, copie `.env.example` para `.env`. Troque as três senhas
   de exemplo por segredos aleatórios distintos, usando letras e números, e
   informe o WhatsApp do estabelecimento em formato internacional, só com
   dígitos (por exemplo, `5531999999999`).
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

- `GET /api/availability?start_date=AAAA-MM-DD&end_date=AAAA-MM-DD` retorna apenas
  datas e horários ocupados, sem expor os dados dos clientes.
- `POST /api/appointments` recebe serviço, nome, telefone, data e hora. A reserva
  e a notificação são gravadas na mesma transação; conflito no horário retorna
  HTTP 409 e o site pede outro horário.
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
pela primeira vez. Não remova volumes para aplicar atualizações em produção;
execute migrações controladas e mantenha backups. Não publique `.env` nem os
volumes de sessão do WhatsApp.

Se uma notificação atingir o limite de tentativas, confira os logs do worker,
restabeleça a conexão da Evolution e reprograme o job no banco:

```sql
UPDATE notification_jobs
   SET status = 'retry', attempts = 0, available_at = now(),
       last_error = NULL, locked_at = NULL
 WHERE status = 'failed';
```

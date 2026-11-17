# Barbearia Marquês

Projeto da Barbearia Marquês: site público, agenda em Node.js/PostgreSQL e
notificações WhatsApp pela Evolution API.

## Publicação

O workflow em `.github/workflows/pages.yml` publica o site estático no GitHub
Pages após cada envio à branch `main`. As fotos e o conteúdo do site são
acessíveis publicamente.

O GitHub Pages não executa a API Node.js nem o PostgreSQL. No endereço público,
o formulário de agenda só funcionará depois que o backend for hospedado em um
servidor público com HTTPS e conectado ao site. O backend Docker está em
[backend/](./backend/); veja [as instruções de configuração](./backend/README.md).

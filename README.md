# Barbearia Marquês

Site público da Barbearia Marquês, com fotos, serviços e endereço.

## Publicação

O workflow em `.github/workflows/pages.yml` publica o site estático no GitHub
Pages após cada envio à branch `main`. As fotos e o conteúdo do site são
acessíveis publicamente.

O GitHub Pages não executa a API Node.js nem o PostgreSQL. Portanto, o
agendamento online permanece indisponível até que o backend seja hospedado em
um servidor público com HTTPS e conectado ao site.

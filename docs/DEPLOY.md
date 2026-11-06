# Plano de deploy

> Nenhum deploy de produção foi executado. Este é o plano para quando houver aprovação.

## Onde hospedar

**Hostinger VPS (KVM)** ou similar (Contabo, Hetzner, DigitalOcean, Magalu Cloud). A hospedagem compartilhada da Hostinger **não serve**: o produto precisa de processos Node contínuos, ffmpeg e Postgres.

- **Tamanho inicial sugerido:** 2 vCPU, 8 GB RAM, 100 GB NVMe. O ffmpeg em vídeos de 1h30 é o pico de CPU. Confirmar preço e plano na Hostinger.
- **Região:** dar preferência a datacenter no Brasil, se o plano oferecer (reduz latência; a transferência internacional continua existindo por causa dos provedores de IA).
- **Storage de mídia:**
  - *Começo:* disco da VPS (`STORAGE_DRIVER=local`), com backup e volume criptografado.
  - *Recomendado ao crescer:* Cloudflare R2 (S3-compatível, sem custo de saída, criptografia em repouso), com `STORAGE_DRIVER=s3`.

## Passo a passo (primeira vez)

1. Criar a VPS com Ubuntu 24.04 LTS e acesso SSH por chave (desativar login por senha). Ativar firewall liberando só as portas 22, 80 e 443.
2. Instalar Docker Engine e o plugin Compose.
3. Apontar o DNS do domínio (registro `A`) para o IP da VPS.
4. Clonar o repositório e configurar o ambiente:

```bash
git clone <repo> jump && cd jump/deploy
```

```bash
cp .env.example .env
```

5. Preencher `deploy/.env` com senhas fortes (`openssl rand -base64 32` para cada uma) e o domínio.
6. Subir os serviços:

```bash
docker compose up -d --build
```

7. O Caddy emite o certificado HTTPS automaticamente. Acesse `https://<domínio>/cadastro`.
8. Liberar o plano da primeira empresa:

```bash
docker compose run --rm migrate npx tsx scripts/grant-plan.ts --org <slug> --plan avaliador
```

## Atualizações

```bash
git pull && docker compose up -d --build
```

O serviço `migrate` aplica as novas migrations antes de o `web` subir.

## Backups

- **Postgres:** `pg_dump` diário (cron) para storage externo criptografado, com retenção de 14 dias. Testar a restauração mensalmente.
- **Mídia:** seguir a política de retenção. Com o driver local, sincronizar o volume `media` para storage externo.

## Monitoramento mínimo

- Healthcheck HTTP externo (UptimeRobot ou similar).
- `docker compose logs` com rotação; alertas de disco acima de 80%.

## Limitações conhecidas

- O daemon do Docker não estava disponível no ambiente de desenvolvimento, então o Compose **ainda não foi executado de ponta a ponta**. O build da aplicação, as migrations e os testes foram validados fora do Docker. Validar em uma VPS de homologação antes da produção.

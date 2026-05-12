# THAY Funnel Builder — Configuração do Backend

## Arquitetura

```
Frontend (index.html)
  └── POST /api/generate-page-copy  { brief }
        │
        ▼
  Cloudflare Worker (worker.js)
        │  usa env.CLAUDE_API_KEY (nunca exposta ao browser)
        ▼
  Claude API  →  JSON de copy
        │
        ▼
  Frontend recebe copy limpa
  THAY monta e renderiza o HTML
```

A chave Claude **nunca sai do servidor**.

---

## 1. Pré-requisitos

- Conta Cloudflare (gratuita)
- Node.js 18+
- Wrangler CLI: `npm install -g wrangler`
- Chave API Anthropic: https://console.anthropic.com

---

## 2. Deploy do Worker

```bash
# Clone / entre na pasta do projeto
cd thay

# Login no Cloudflare
wrangler login

# Deploy
wrangler deploy worker.js --name thay-api
```

---

## 3. Adicionar variáveis de ambiente

No painel Cloudflare:
**Workers & Pages → thay-api → Settings → Variables**

| Variável         | Valor                        | Tipo   |
|-----------------|------------------------------|--------|
| `CLAUDE_API_KEY` | sk-ant-...                   | Secret |
| `ANTHROPIC_MODEL`| claude-opus-4-7              | Text   |
| `USE_MOCK_AI`    | false                        | Text   |
| `ALLOWED_ORIGIN` | https://seu-dominio.com      | Text   |

Ou via CLI:
```bash
wrangler secret put CLAUDE_API_KEY
# cole a chave quando solicitado
```

---

## 4. Configurar o frontend

O `index.html` já chama `/api/generate-page-copy`.

Em produção, sirva o `index.html` pelo **Cloudflare Pages** — o Worker e o Pages compartilham o mesmo domínio, então `/api/...` resolve automaticamente.

```bash
# Deploy do frontend via Pages
wrangler pages deploy . --project-name thay-app
```

Em desenvolvimento local:
```bash
wrangler dev worker.js --local
# Worker sobe em http://localhost:8787
# Sirva o index.html em outro servidor apontando para localhost:8787
```

---

## 5. Desenvolvimento com mock

Para desenvolver sem gastar créditos da API:

```bash
# No painel Cloudflare ou via wrangler.toml:
USE_MOCK_AI=true
```

O Worker retorna copy de exemplo com aviso visual `[DEV MOCK]` no badge.
O frontend exibe normalmente — só a copy é fictícia.

---

## 6. `wrangler.toml` (opcional)

```toml
name = "thay-api"
main = "worker.js"
compatibility_date = "2024-01-01"

[vars]
ANTHROPIC_MODEL = "claude-opus-4-7"
USE_MOCK_AI = "false"
ALLOWED_ORIGIN = "*"

# CLAUDE_API_KEY nunca vai aqui — use wrangler secret put
```

---

## Regras de segurança

- `CLAUDE_API_KEY` → **somente** em Secret do Worker
- Nunca em `wrangler.toml`, `.env` commitado, frontend ou localStorage
- O frontend nunca vê, toca ou transporta a chave

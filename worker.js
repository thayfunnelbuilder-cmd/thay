/**
 * THAY Funnel Builder — Cloudflare Worker
 *
 * Endpoints:
 *   POST /api/generate-page-copy   — recebe brief, chama Claude, retorna JSON de copy
 *
 * Variáveis de ambiente (Cloudflare dashboard → Settings → Variables):
 *   CLAUDE_API_KEY    — chave Anthropic (obrigatória em produção)
 *   ANTHROPIC_MODEL   — modelo (padrão: claude-opus-4-7)
 *   USE_MOCK_AI       — "true" para usar mock em desenvolvimento (padrão: false)
 *   ALLOWED_ORIGIN    — domínio do frontend (padrão: * em dev)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return _cors(new Response(null, { status: 204 }), env);
    }

    if (url.pathname === '/api/generate-page-copy' && request.method === 'POST') {
      return _cors(await handleGenerateCopy(request, env), env);
    }

    return _cors(new Response(JSON.stringify({ message: 'Not found' }), { status: 404 }), env);
  },
};

/* ── Handler principal ── */
async function handleGenerateCopy(request, env) {
  let brief;
  try {
    const body = await request.json();
    brief = body.brief;
    if (!brief || typeof brief !== 'object') throw new Error('brief ausente');
  } catch {
    return jsonError('Requisição inválida.', 400);
  }

  // Modo de desenvolvimento com mock
  if (env.USE_MOCK_AI === 'true') {
    const copy = buildMockCopy(brief);
    return Response.json(copy);
  }

  // Produção: CLAUDE_API_KEY obrigatória
  if (!env.CLAUDE_API_KEY) {
    return jsonError('IA ainda não configurada no servidor.', 503);
  }

  try {
    const copy = await callClaude(brief, env);
    return Response.json(copy);
  } catch (err) {
    console.error('Claude error:', err.message);
    return jsonError('Erro ao processar com IA. Tente novamente.', 500);
  }
}

/* ── Claude API ── */
async function callClaude(brief, env) {
  const model = env.ANTHROPIC_MODEL || 'claude-opus-4-7';
  const prompt = buildPrompt(brief);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => resp.status);
    throw new Error(`Claude retornou ${resp.status}: ${detail}`);
  }

  const data = await resp.json();
  const raw = data.content[0].text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '');

  return JSON.parse(raw);
}

/* ── Prompt para Claude ── */
function buildPrompt(brief) {
  return `Você é especialista em copywriting estratégico brasileiro.

Briefing:
- Produto: ${brief.nome}
- Tipo: ${brief.tipo}
- Público: ${brief.publico}
- Tom: ${brief.tom}
- Ângulo de venda: ${brief.angulo}
- CTA principal: ${brief.cta}
- Dores: ${(brief.dores || []).join('; ')}
- Desejos: ${(brief.desejos || []).join('; ')}
- Objeções: ${(brief.objecoes || []).join('; ')}
- Evitar: ${(brief.evitar || []).join('; ')}

Regras obrigatórias:
- Responda SOMENTE com JSON válido
- Sem markdown, sem explicação, sem código HTML
- Copy premium, sem linguagem de guru, sem urgência falsa
- Adapte o tom ao tipo de produto

JSON esperado:
{
  "hero": {
    "badge": "texto curto do badge",
    "headline": "headline principal (max 8 palavras)",
    "subheadline": "subtítulo (1-2 frases)",
    "cta": "texto do botão"
  },
  "benefits": [
    { "icon": "emoji", "title": "título curto", "description": "1 frase" },
    { "icon": "emoji", "title": "título curto", "description": "1 frase" },
    { "icon": "emoji", "title": "título curto", "description": "1 frase" },
    { "icon": "emoji", "title": "título curto", "description": "1 frase" }
  ],
  "social": {
    "title": "título da seção de prova social",
    "stat1": { "number": "número", "label": "descrição" },
    "stat2": { "number": "número", "label": "descrição" },
    "stat3": { "number": "número", "label": "descrição" }
  },
  "offer": {
    "tag": "tag da oferta",
    "title": "título",
    "description": "1 frase",
    "cta": "texto do botão"
  },
  "faq": [
    { "question": "pergunta", "answer": "resposta objetiva" },
    { "question": "pergunta", "answer": "resposta objetiva" },
    { "question": "pergunta", "answer": "resposta objetiva" }
  ]
}`;
}

/* ── Mock de desenvolvimento (USE_MOCK_AI=true) ── */
function buildMockCopy(brief) {
  const nome = brief.nome || 'Produto';
  const cta  = brief.cta  || 'Saiba mais';
  return {
    hero: {
      badge: '[DEV MOCK] ' + (brief.tipo || '').toUpperCase().slice(0, 20),
      headline: `${nome} — copy gerada em modo dev`,
      subheadline: 'Este é um mock de desenvolvimento. Configure USE_MOCK_AI=false e adicione CLAUDE_API_KEY para ativar IA real.',
      cta,
    },
    benefits: [
      { icon: '🔧', title: 'Mock ativo',         description: 'Defina USE_MOCK_AI=false no Worker para usar Claude.' },
      { icon: '🔑', title: 'Chave ausente',       description: 'Adicione CLAUDE_API_KEY nas variáveis de ambiente.' },
      { icon: '🚀', title: 'Deploy rápido',       description: 'wrangler deploy — o Worker estará pronto em segundos.' },
      { icon: '📋', title: 'Brief recebido',      description: `Tipo detectado: ${brief.tipo || 'não identificado'}.` },
    ],
    social: {
      title: 'Ambiente de desenvolvimento',
      stat1: { number: 'DEV', label: 'ambiente atual' },
      stat2: { number: 'MOCK', label: 'modo ativo' },
      stat3: { number: 'OK',   label: 'endpoint respondendo' },
    },
    offer: {
      tag: 'CONFIGURAÇÃO',
      title: 'Ative a IA real',
      description: 'Adicione CLAUDE_API_KEY e defina USE_MOCK_AI=false no painel do Cloudflare.',
      cta,
    },
    faq: [
      { question: 'Como ativar a IA real?',           answer: 'Adicione CLAUDE_API_KEY nas variáveis de ambiente do Worker e defina USE_MOCK_AI=false.' },
      { question: 'Onde fica a chave Claude?',         answer: 'Somente no Worker (servidor). Nunca no frontend, nunca no navegador.' },
      { question: 'Como fazer deploy do Worker?',      answer: 'Execute: wrangler deploy. Veja SETUP.md para instruções completas.' },
    ],
  };
}

/* ── Helpers ── */
function jsonError(message, status) {
  return Response.json({ error: true, message }, { status });
}

function _cors(response, env) {
  const origin = env.ALLOWED_ORIGIN || '*';
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, headers });
}

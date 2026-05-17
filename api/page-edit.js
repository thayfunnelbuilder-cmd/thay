export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Use POST.' });

  const { userMessage, currentHtml } = req.body || {};
  if (!userMessage?.trim()) return res.status(400).json({ ok: false, message: 'userMessage é obrigatório.' });

  const claudeKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  console.log('[page-edit] msg:', userMessage.slice(0, 60));
  console.log('[page-edit] claude:', !!claudeKey, 'openai:', !!openaiKey);

  if (!claudeKey && !openaiKey) {
    return res.status(503).json({ ok: false, message: 'Nenhuma chave de IA configurada. Adicione CLAUDE_API_KEY na Vercel.' });
  }

  // Prompt enxuto — menos tokens = menos tempo
  const systemPrompt = `Você cria páginas de vendas em HTML+CSS premium para o mercado brasileiro.

REGRAS:
- Responda SOMENTE JSON: {"ok":true,"message":"...","html":"<!DOCTYPE html>..."}
- Zero markdown, zero texto fora do JSON
- HTML completo com <style> no <head>
- Sem CDN, sem imagens externas
- CSS inline apenas, responsivo, mobile-first
- Design premium: gradientes, cards, animações CSS leves
- Adapte TUDO ao nicho do pedido: cores, copy, emojis, vocabulário
- Português brasileiro

SEÇÕES (página nova): hero + prova social + benefícios + como funciona + depoimentos + oferta + garantia + FAQ + CTA final`;

  const userContent = currentHtml
    ? `Página atual (editar conforme pedido):\n${currentHtml.slice(0, 6000)}\n\nPedido: ${userMessage.trim()}`
    : `Pedido: ${userMessage.trim()}`;

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50000);

    // Tenta Claude primeiro
    if (claudeKey) {
      console.log('[page-edit] chamando Claude...');
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',  // Haiku: 5x mais rápido que Sonnet
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }]
        }),
        signal: controller.signal
      });

      console.log('[page-edit] Claude status:', r.status);

      if (r.ok) {
        const d = await r.json();
        const raw = d.content?.[0]?.text || '';
        const parsed = parseJSON(raw);
        if (parsed?.html) {
          console.log('[page-edit] Claude OK, html:', parsed.html.length, 'chars');
          return res.status(200).json({ ok: true, message: parsed.message || 'Página criada!', html: parsed.html });
        }
      } else {
        const err = await r.text();
        console.log('[page-edit] Claude erro:', err.slice(0, 150));
      }
    }

    // Fallback OpenAI
    if (openaiKey) {
      console.log('[page-edit] fallback OpenAI...');
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 4096,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ]
        }),
        signal: controller.signal
      });
      if (r.ok) {
        const d = await r.json();
        const raw = d.choices?.[0]?.message?.content || '';
        const parsed = parseJSON(raw);
        if (parsed?.html) return res.status(200).json({ ok: true, message: parsed.message || 'Página criada!', html: parsed.html });
      }
    }

    return res.status(502).json({ ok: false, message: 'IA não retornou HTML. Tente um prompt mais simples.' });

  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ ok: false, message: 'Timeout. A IA demorou demais. Tente novamente.' });
    return res.status(500).json({ ok: false, message: err.message });
  }
}

function parseJSON(raw) {
  try {
    return JSON.parse(raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim());
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) try { return JSON.parse(m[0]); } catch {}
    return null;
  }
}

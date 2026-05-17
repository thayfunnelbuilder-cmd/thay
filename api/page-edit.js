/**
 * THAY Funnel Builder — POST /api/page-edit
 * Usa OPENAI_API_KEY (GPT-4o) — fallback para CLAUDE_API_KEY se existir
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Use POST.' });

  const { userMessage, currentHtml } = req.body || {};
  if (!userMessage?.trim()) return res.status(400).json({ ok: false, message: 'userMessage é obrigatório.' });

  const openaiKey  = process.env.OPENAI_API_KEY;
  const claudeKey  = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;

  console.log('[page-edit] userMessage:', userMessage.slice(0, 80));
  console.log('[page-edit] openaiKey:', !!openaiKey, '| claudeKey:', !!claudeKey);

  if (!openaiKey && !claudeKey) {
    return res.status(503).json({
      ok: false,
      message: 'Nenhuma chave de IA configurada. Adicione OPENAI_API_KEY nas variáveis de ambiente da Vercel e faça redeploy.'
    });
  }

  const systemPrompt = `Você é o motor de criação de páginas de vendas da THAY Funnel Builder.

REGRAS:
- Responda SOMENTE JSON válido. Zero texto fora do JSON. Zero markdown.
- NUNCA use "O Método que Transformou 2.300 Alunos".
- NUNCA use "Descubra o Método que Transformou".
- Se não houver HTML atual: crie página completa do zero.
- Se houver HTML atual: edite conforme o pedido, mantenha o restante.
- Adapte ao nicho, público e produto do pedido.
- Use português brasileiro.
- HTML completo com CSS dentro de <style>.
- Sem imagens externas, CDN ou libs externas.
- Design premium: gradientes, cards, animações CSS, responsivo.

ESTRUTURA MÍNIMA (página nova):
1. Hero — headline forte + CTA
2. Prova social — números
3. Benefícios — grid de cards com emoji
4. Como funciona — 3 passos
5. Depoimentos — 3 cards
6. Oferta — preço + bônus
7. Garantia
8. FAQ — details/summary
9. CTA final

RESPOSTA (JSON puro):
{"ok":true,"message":"mensagem curta","html":"<!DOCTYPE html>..."}`;

  const userContent = currentHtml
    ? `HTML atual:\n${currentHtml.slice(0, 12000)}\n\nPedido: ${userMessage.trim()}`
    : `Pedido: ${userMessage.trim()}\n\nNão há página atual — crie do zero.`;

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 55000);

    let raw = '';

    // ── Tenta OpenAI primeiro ──────────────────────────────────
    if (openaiKey) {
      console.log('[page-edit] usando OpenAI GPT-4o...');
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 8000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userContent }
          ]
        }),
        signal: controller.signal
      });
      console.log('[page-edit] OpenAI status:', r.status);
      if (r.ok) {
        const d = await r.json();
        raw = d.choices?.[0]?.message?.content || '';
      } else {
        const err = await r.text();
        console.log('[page-edit] OpenAI erro:', err.slice(0, 200));
        if (!claudeKey) return res.status(502).json({ ok: false, message: `Erro OpenAI ${r.status}: ${err.slice(0, 100)}` });
      }
    }

    // ── Fallback: Claude ───────────────────────────────────────
    if (!raw && claudeKey) {
      console.log('[page-edit] usando Claude...');
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 8000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }]
        }),
        signal: controller.signal
      });
      console.log('[page-edit] Claude status:', r.status);
      if (r.ok) {
        const d = await r.json();
        raw = d.content?.[0]?.text || '';
      } else {
        const err = await r.text();
        return res.status(502).json({ ok: false, message: `Erro Claude ${r.status}: ${err.slice(0, 100)}` });
      }
    }

    if (!raw) return res.status(502).json({ ok: false, message: 'IA não retornou resposta.' });

    // Limpar markdown residual
    const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { const m = cleaned.match(/\{[\s\S]*\}/); if (m) try { parsed = JSON.parse(m[0]); } catch {} }

    if (!parsed?.html) {
      console.log('[page-edit] sem HTML na resposta, raw:', raw.slice(0, 200));
      return res.status(502).json({ ok: false, message: parsed?.message || 'IA não gerou HTML. Tente novamente.' });
    }

    console.log('[page-edit] sucesso, HTML:', parsed.html.length, 'chars');
    return res.status(200).json({ ok: true, message: parsed.message || 'Página atualizada!', html: parsed.html });

  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ ok: false, message: 'Timeout (55s). Tente um prompt mais curto.' });
    console.log('[page-edit] erro:', err.message);
    return res.status(500).json({ ok: false, message: err.message });
  }
}

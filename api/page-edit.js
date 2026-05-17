/**
 * THAY Funnel Builder — POST /api/page-edit
 *
 * Recebe { userMessage, currentHtml, pageState, mode }
 * Chama Claude com CLAUDE_API_KEY (ou ANTHROPIC_API_KEY como fallback)
 * Retorna { ok, message, html }
 *
 * Variável obrigatória na Vercel:
 *   CLAUDE_API_KEY   (ou ANTHROPIC_API_KEY)
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, message: 'Método não permitido. Use POST.' });

  const { userMessage, currentHtml, pageState } = req.body || {};

  if (!userMessage || !userMessage.trim())
    return res.status(400).json({ ok: false, message: 'userMessage é obrigatório.' });

  // Aceita CLAUDE_API_KEY ou ANTHROPIC_API_KEY
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;

  console.log('[page-edit] chamada recebida');
  console.log('[page-edit] userMessage:', userMessage.slice(0, 80));
  console.log('[page-edit] tem apiKey:', !!apiKey);
  console.log('[page-edit] currentHtml:', currentHtml ? `${currentHtml.length} chars` : 'nenhum');

  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      message: 'Chave de IA não configurada no servidor. Adicione CLAUDE_API_KEY nas variáveis de ambiente da Vercel (Settings → Environment Variables) e faça redeploy.'
    });
  }

  const systemPrompt = `Você é o motor real de criação e edição de páginas da THAY Funnel Builder.

Sua tarefa é gerar ou editar páginas de vendas em HTML/CSS com qualidade premium.

REGRAS ABSOLUTAS:
- Responda somente JSON válido. Sem markdown. Sem texto fora do JSON.
- Nunca use "O Método que Transformou 2.300 Alunos em 90 Dias".
- Nunca use "O Método que Está Transformando Resultados em 90 Dias".
- Nunca use "Descubra o Método que Transformou".
- Nunca use template genérico.
- Se não houver HTML atual: crie página completa do zero baseada no pedido.
- Se houver HTML atual: edite conforme o pedido, mantendo o restante intacto.
- Adapte ao nicho, público, tom, promessa e produto do pedido.
- Use português brasileiro coloquial e profissional.
- Gere HTML completo com CSS dentro de <style> no <head>.
- Não use imagens externas, CDN ou bibliotecas externas.
- Use gradientes, cards, formas CSS, emojis e animações CSS.
- A página deve ser responsiva (mobile-first).
- Design premium: tipografia forte, espaçamento generoso, cores do nicho pedido.

ESTRUTURA MÍNIMA PARA PÁGINA NOVA (não pule nenhuma seção):
1. Hero com headline forte e CTA
2. Barra de prova social (números)
3. Benefícios em grid de cards
4. Como funciona (3 passos)
5. Depoimentos (3 cards)
6. Oferta com preço e bônus
7. Garantia
8. FAQ (4 perguntas com details/summary)
9. CTA final

RESPOSTA OBRIGATÓRIA (JSON puro, sem markdown):
{
  "ok": true,
  "message": "mensagem curta para o usuário",
  "html": "<!DOCTYPE html>..."
}

Em caso de erro:
{
  "ok": false,
  "message": "descrição do erro"
}`;

  const userContent = currentHtml
    ? `HTML atual da página:\n${currentHtml.slice(0, 12000)}\n\nPedido do usuário: ${userMessage.trim()}`
    : `Pedido do usuário: ${userMessage.trim()}\n\nNão há página atual — crie uma página completa do zero.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    console.log('[page-edit] chamando Anthropic API...');

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    console.log('[page-edit] status Anthropic:', anthropicRes.status);

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.log('[page-edit] erro Anthropic:', errText.slice(0, 200));
      return res.status(502).json({
        ok: false,
        message: `Erro na API Anthropic (${anthropicRes.status}): ${errText.slice(0, 150)}`
      });
    }

    const anthropicData = await anthropicRes.json();
    const raw = anthropicData.content?.[0]?.text || '';

    console.log('[page-edit] resposta recebida, tamanho:', raw.length);

    // Limpar markdown residual
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Tentar extrair JSON do meio da resposta
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch {}
      }
    }

    if (!parsed) {
      console.log('[page-edit] JSON inválido, raw:', raw.slice(0, 200));
      return res.status(502).json({
        ok: false,
        message: 'A IA não retornou JSON válido. Tente novamente.'
      });
    }

    if (!parsed.html) {
      return res.status(502).json({
        ok: false,
        message: parsed.message || 'A IA não gerou HTML. Tente um prompt mais específico.'
      });
    }

    console.log('[page-edit] sucesso, HTML:', parsed.html.length, 'chars');
    return res.status(200).json({ ok: true, message: parsed.message || 'Página atualizada!', html: parsed.html });

  } catch (err) {
    if (err.name === 'AbortError')
      return res.status(504).json({ ok: false, message: 'Timeout: a IA demorou mais de 55s. Tente um prompt mais curto.' });

    console.log('[page-edit] erro inesperado:', err.message);
    return res.status(500).json({ ok: false, message: `Erro interno: ${err.message}` });
  }
}

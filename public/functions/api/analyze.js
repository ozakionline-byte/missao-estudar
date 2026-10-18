export async function onRequestPost({ request, env }) {
  const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!env.GEMINI_API_KEY) return json({ error: 'A chave GEMINI_API_KEY não foi configurada na Cloudflare.' }, 503);
  try {
    const form = await request.formData();
    const file = form.get('image');
    if (!file || typeof file.arrayBuffer !== 'function' || !file.type?.startsWith('image/')) return json({ error: 'Selecione uma imagem válida.' }, 400);
    if (file.size > 8 * 1024 * 1024) return json({ error: 'A imagem deve ter até 8 MB.' }, 413);
    const supported = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!supported.includes(file.type)) return json({ error: 'Use uma foto JPG, PNG ou WebP.' }, 415);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const imageBase64 = btoa(binary);
    const subject = String(form.get('subject') || 'Geral').slice(0, 80);
    const grade = String(form.get('grade') || 'Fundamental').slice(0, 80);
    const prompt = `Você é um professor brasileiro. Analise SOMENTE o conteúdo escolar legível na foto. Disciplina: ${subject}. Série: ${grade}. Retorne APENAS JSON válido, sem markdown, com este formato: {"extracted_text":"transcrição fiel do conteúdo visível sem nomes ou dados pessoais","topic":"assunto","questions":[{"question":"pergunta","options":["alternativa A","alternativa B","alternativa C","alternativa D"],"correct_index":0,"explanation":"explicação curta"}]}. Gere EXATAMENTE três perguntas, cada uma com quatro alternativas e uma resposta correta (correct_index de 0 a 3), coerentes com o texto visível e adequadas à série. Não invente conteúdo. Se a imagem for ilegível, inadequada ou insuficiente, retorne {"extracted_text":"Não foi possível ler conteúdo suficiente.","topic":"IMAGEM_ILEGIVEL","questions":[]}.`;
    const payload = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: file.type, data: imageBase64 } }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } });
    const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY };
    const send = async (model) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers, body: payload });
    let model = env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    let upstream = await send(model);
    if (upstream.status === 404) {
      // A lista de modelos vem da propria chave e evita adivinhar nomes de modelos.
      const modelsResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
      if (!modelsResponse.ok) return json({ error: `Gemini retornou 404 e não foi possível consultar os modelos disponíveis (código ${modelsResponse.status}).` }, 502);
      const available = (await modelsResponse.json()).models || [];
      const choices = available.filter(m => m.supportedGenerationMethods?.includes('generateContent') && /gemini.*flash/i.test(m.name) && !/preview|exp|image|tts|live|audio/i.test(m.name));
      choices.sort((a,b) => Number(/flash-lite/i.test(b.name)) - Number(/flash-lite/i.test(a.name)));
      const alternative = choices.find(m => m.name.replace(/^models\//,'') !== model);
      if (!alternative) return json({ error: 'Sua chave não apresenta um modelo Gemini Flash compatível com geração de texto e imagens. Verifique os modelos disponíveis no projeto.' }, 502);
      model = alternative.name.replace(/^models\//,'');
      upstream = await send(model);
    }
    if (!upstream.ok) {
      const errBody = await upstream.json().catch(() => ({}));
      const detail = String(errBody?.error?.message || '').slice(0, 240);
      if (upstream.status === 429) return json({ error: 'Limite gratuito do Gemini atingido. Aguarde antes de tentar novamente.' }, 429);
      return json({ error: `Gemini (${model}) retornou código ${upstream.status}. ${detail}`.trim() }, 502);
    }
    const raw = await upstream.json();
    const content = raw.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
    if (!content) return json({ error: 'O Gemini não retornou texto. Tente outra foto.' }, 502);
    let result;
    try { result = JSON.parse(content); } catch { return json({ error: 'O Gemini retornou uma resposta inválida. Tente novamente.' }, 502); }
    if (result.topic === 'IMAGEM_ILEGIVEL') return json({ error: 'Não consegui ler conteúdo suficiente. Tire outra foto com mais luz e foco.' }, 422);
    if (!Array.isArray(result.questions) || result.questions.length !== 3 || result.questions.some(q => typeof q.question !== 'string' || !q.question.trim() || !Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => typeof o !== 'string' || !o.trim()) || !Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index > 3 || typeof q.explanation !== 'string')) return json({ error: 'A IA não conseguiu gerar três perguntas válidas. Tente novamente.' }, 502);
    return json({ extracted_text: String(result.extracted_text || ''), topic: String(result.topic || subject), questions: result.questions });
  } catch (error) {
    return json({ error: error?.name === 'AbortError' ? 'A análise demorou demais. Tente novamente.' : 'Não foi possível processar a imagem. Tente novamente.' }, 500);
  }
}

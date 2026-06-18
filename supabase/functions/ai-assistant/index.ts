const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return json({ error: 'AI assistant is not configured yet.' }, 503);
    }

    const { systemPrompt, contents } = await req.json();
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt || '' }] },
          contents: Array.isArray(contents) ? contents : [],
          generationConfig: { temperature: 0.75, maxOutputTokens: 700, topP: 0.9 },
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return json({ error: errorBody?.error?.message || `Gemini HTTP ${response.status}` }, response.status);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return json({ text });
  } catch (error) {
    return json({ error: error?.message || 'AI assistant failed.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

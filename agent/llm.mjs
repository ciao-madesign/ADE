/**
 * Astrazione del "substrato cognitivo" di ADE: il modello linguistico.
 *
 * Provider supportati (variabile AI_PROVIDER, oppure auto-rilevamento):
 *
 *  - "openai"    → qualunque endpoint OpenAI-compatibile, quindi anche modelli
 *                  open source gratuiti:
 *                    · Ollama in locale:  OPENAI_BASE_URL=http://localhost:11434/v1
 *                                         AI_MODEL=llama3.3  (nessuna chiave)
 *                    · Groq (free tier):  OPENAI_BASE_URL=https://api.groq.com/openai/v1
 *                    · OpenRouter (modelli :free), vLLM, LM Studio, ecc.
 *  - "anthropic" → API Claude (richiede ANTHROPIC_API_KEY).
 *
 * Contratto unico: completeJSON() restituisce un oggetto conforme allo schema
 * più il conteggio dei token consumati (l'energia dell'entità).
 */

const PROVIDER = resolveProvider();

function resolveProvider() {
  const explicit = (process.env.AI_PROVIDER || "").toLowerCase();
  if (explicit) return explicit;
  if (process.env.OPENAI_BASE_URL || process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function providerInfo() {
  if (PROVIDER === "openai") {
    return {
      provider: "openai",
      model: process.env.AI_MODEL || "llama3.3",
      baseUrl: (process.env.OPENAI_BASE_URL || "http://localhost:11434/v1").replace(/\/+$/, ""),
      configured: true,
    };
  }
  if (PROVIDER === "anthropic") {
    return {
      provider: "anthropic",
      model: process.env.AI_MODEL || "claude-opus-4-8",
      configured: !!process.env.ANTHROPIC_API_KEY,
    };
  }
  return { provider: null, model: null, configured: false };
}

/**
 * @param {object} opts
 * @param {string} opts.system   prompt di sistema (identità + mente)
 * @param {string} opts.user     osservazioni del ciclo
 * @param {object} opts.schema   JSON schema atteso per la risposta
 * @param {number} [opts.maxTokens]
 * @param {{mimeType: string, base64: string, nome: string}[]} [opts.images]
 *   immagini da mostrare al modello insieme al testo (stimoli approvati e
 *   ancora presenti in environment/inbox/). Se il modello non supporta la
 *   visione, il provider risponderà con un errore: il ciclo verrà annullato
 *   senza effetti, come per qualunque altro errore del provider.
 * @returns {Promise<{data: object, tokens: number, stop: string}>}
 */
export async function completeJSON({ system, user, schema, maxTokens = 16000, images = [] }) {
  const info = providerInfo();
  if (!info.configured) throw new Error("Nessun provider AI configurato (vedi agent/llm.mjs).");
  if (info.provider === "anthropic") return anthropicJSON({ system, user, schema, maxTokens, images, info });
  return openaiJSON({ system, user, schema, maxTokens, images, info });
}

// ---------------------------------------------------------------- Anthropic

async function anthropicJSON({ system, user, schema, maxTokens, images, info }) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const content = images.length
    ? [
        ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.base64 } })),
        { type: "text", text: user },
      ]
    : user;

  const response = await client.messages.create({
    model: info.model,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  });

  const u = response.usage || {};
  const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) +
    (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);

  if (response.stop_reason === "refusal") return { data: null, tokens, stop: "refusal" };
  if (response.stop_reason === "max_tokens") return { data: null, tokens, stop: "max_tokens" };

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  return { data: JSON.parse(text), tokens, stop: response.stop_reason };
}

// ---------------------------------------------------------------- OpenAI-compatibile

async function openaiJSON({ system, user, schema, maxTokens, images, info }) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.OPENAI_API_KEY) headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;

  const userText =
    user +
    "\n\nRISPONDI ESCLUSIVAMENTE con un unico oggetto JSON valido (nessun testo prima o dopo, nessun code fence) conforme a questo JSON Schema:\n" +
    JSON.stringify(schema);

  function buildBody(imgs, tokens, withResponseFormat) {
    const userContent = imgs.length
      ? [
          { type: "text", text: userText },
          ...imgs.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.base64}` } })),
        ]
      : userText;
    const body = {
      model: info.model,
      max_tokens: tokens,
      // Temperatura più alta di default: un modello lasciato a un valore basso
      // tende a ripiegare sulla risposta più "sicura" e prevedibile ad ogni
      // ciclo, che con un'entità pensata per variare nel tempo si traduce in
      // frasi quasi identiche una dopo l'altra. Regolabile con AI_TEMPERATURE.
      temperature: process.env.AI_TEMPERATURE !== undefined ? Number(process.env.AI_TEMPERATURE) : 0.9,
      messages: [{ role: "system", content: system }, { role: "user", content: userContent }],
    };
    if (withResponseFormat) body.response_format = { type: "json_object" };
    // Alcuni modelli (es. qwen/qwen3.6-27b su Groq) supportano una modalità di
    // ragionamento esplicita ("thinking"); altri la rifiutano se ricevuta.
    // Per questo non è mai inviata di default: solo se impostata esplicitamente.
    if (process.env.AI_REASONING_EFFORT) body.reasoning_effort = process.env.AI_REASONING_EFFORT;
    return body;
  }

  async function send(body) {
    return fetch(`${info.baseUrl}/chat/completions`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
  }

  async function attempt(imgs, tokens) {
    let r = await send(buildBody(imgs, tokens, true));
    // Alcuni server OpenAI-compatibili non supportano response_format: riprova senza.
    if (r.status === 400) r = await send(buildBody(imgs, tokens, false));
    return r;
  }

  const isRateLimit = (r) => r.status === 413 || r.status === 429;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Estrae "riprova tra X secondi" dal corpo dell'errore Groq, se presente. */
  async function waitSuggestedByProvider(r) {
    const bodyText = await r.clone().text();
    const m = bodyText.match(/try again in ([\d.]+)s/i);
    const seconds = m ? Math.min(Number(m[1]) + 1, 60) : 5;
    await sleep(seconds * 1000);
  }

  let res = await attempt(images, maxTokens);

  // 413: la singola richiesta supera da sola il budget al minuto del
  // provider. 429 "tokens": il budget del minuto è già in parte consumato
  // da richieste precedenti, e questa lo farebbe sforare (il provider
  // stesso indica dopo quanti secondi riprovare). In entrambi i casi non
  // annulliamo il ciclo: aspettiamo se richiesto, poi ridimensioniamo,
  // togliendo prima il "peso" più grande (le immagini), poi riducendo lo
  // spazio di risposta. Un ciclo senza vista o più conciso vale più di
  // nessun ciclo.
  if (isRateLimit(res) && images.length) {
    if (res.status === 429) await waitSuggestedByProvider(res);
    res = await attempt([], maxTokens);
  }
  if (isRateLimit(res)) {
    if (res.status === 429) await waitSuggestedByProvider(res);
    res = await attempt([], Math.max(600, Math.floor(maxTokens / 2)));
  }

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 400);
    throw new Error(`Provider ${info.baseUrl} ha risposto ${res.status}: ${errText}`);
  }

  const out = await res.json();
  const choice = out.choices?.[0];
  const text = choice?.message?.content ?? "";
  const u = out.usage || {};
  const tokens = (u.prompt_tokens || 0) + (u.completion_tokens || 0) ||
    Math.ceil((system.length + user.length + text.length) / 4); // stima se il server non riporta usage

  if (choice?.finish_reason === "length") return { data: null, tokens, stop: "max_tokens" };

  return { data: extractJSON(text), tokens, stop: choice?.finish_reason || "stop" };
}

/** Estrae il primo oggetto JSON dal testo (tollera code fence e preamboli). */
function extractJSON(text) {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Il modello non ha prodotto JSON riconoscibile.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

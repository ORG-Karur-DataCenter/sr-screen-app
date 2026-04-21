/* =============================================
   SRScreen — Screening Worker (screening-worker.js)
   Domain-Expert LLM Screening: Gemini evaluates each
   article using its full domain knowledge + user criteria.
   Inclusion-first philosophy with token-efficient prompts.
   ============================================= */

let paused = false;
let aborted = false;
let completedCount = 0;
// Track key cooldowns to avoid reusing keys immediately after rate limits
const keyCooldowns = {};

self.onmessage = function (e) {
  const { type, payload } = e.data;

  switch (type) {
    case 'START':
      paused = false;
      aborted = false;
      completedCount = 0;
      runScreening(payload);
      break;
    case 'PAUSE':
      paused = true;
      self.postMessage({ type: 'PAUSED', payload: { index: completedCount } });
      break;
    case 'RESUME':
      paused = false;
      break;
    case 'ABORT':
      aborted = true;
      self.postMessage({ type: 'ABORTED', payload: { completedCount } });
      break;
  }
};

/* ─── Main screening loop ──────────────────── */

async function runScreening({ articles, criteria, apiKeys, model, config }) {
  const total = articles.length;
  const results = [];
  let currentKeyIndex = 0;

  for (let i = 0; i < total; i++) {
    // Check abort
    if (aborted) {
      self.postMessage({
        type: 'ABORTED',
        payload: { completedCount, results }
      });
      return;
    }

    // Pause loop
    while (paused && !aborted) {
      await sleep(200);
    }
    if (aborted) {
      self.postMessage({ type: 'ABORTED', payload: { completedCount, results } });
      return;
    }

    const article = articles[i];
    let result = null;
    let retries = (config.retryLimit || 3) + apiKeys.length * 2;
    const initialRetries = retries;
    let keysExhaustedCycle = 0;

    while (retries > 0) {
      try {
        const apiKey = apiKeys[currentKeyIndex];
        result = await screenArticle(article, criteria, apiKey, model, config);
        keysExhaustedCycle = 0; // Reset on success
        break;
      } catch (err) {
        retries--;
        const errMsg = err.message || '';
        const status = err.status || (errMsg.match(/HTTP\s(\d{3})/) || [])[1];
          const isRateLimit = status === '429';
        const isServiceUnavailable = status === '503' || errMsg.includes('503') || errMsg.includes('SERVICE_UNAVAILABLE');

        // Treat 503 as a short transient error: very short fixed backoff with jitter, do not cooldown the key immediately
        if (isServiceUnavailable) {
          self.postMessage({ type: 'ERROR', payload: { index: i, message: 'Service unavailable (503)', retriesLeft: retries, isServiceUnavailable: true } });
          // Very short fixed backoff + jitter (200-1000ms)
          const shortDelay = 200 + Math.floor(Math.random() * 800);
          await sleep(shortDelay);
          continue;
        }

        let keySwitched = false;
        if (isRateLimit && apiKeys.length > 1) {
          currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
          keysExhaustedCycle++;
          keySwitched = true;

          // If we've looped through all keys and they are ALL rate limited
          if (keysExhaustedCycle >= apiKeys.length) {
            keysExhaustedCycle = 0;
            keySwitched = false; // Let the heavy back-off sleep trigger below
          }
        }

        self.postMessage({
          type: 'ERROR',
          payload: {
            index: i,
            message: errMsg || 'Unknown error',
            retriesLeft: retries,
            isRateLimit,
            keySwitched
          }
        });

        // Compute attempt number for exponential backoff
        const attempt = initialRetries - retries;

        if (isRateLimit) {
          // Mark the key on cooldown to avoid immediate reuse
          try {
            const apiKey = apiKeys[currentKeyIndex];
            // Cooldown 30s by default
            keyCooldowns[apiKey] = Date.now() + (config.keyCooldownMs || 30000);
          } catch (e) {}

          // If server provided Retry-After, respect it
          const retryAfterMs = (err.retryAfter ? parseInt(err.retryAfter, 10) * 1000 : null);
          if (retryAfterMs && !isNaN(retryAfterMs)) {
            await sleep(retryAfterMs + Math.floor(Math.random() * 300));
          } else if (!keySwitched) {
            // Exponential backoff with jitter
            const base = 500;
            const delay = Math.min(60000, Math.pow(2, Math.max(0, attempt)) * base) + Math.floor(Math.random() * 500);
            await sleep(delay);
          } else {
            await sleep(250 + Math.floor(Math.random() * 200));
          }
        } else if (retries > 0 && !keySwitched) {
          // Transient non-rate errors: short backoff
          const base = 400;
          const delay = Math.min(10000, Math.pow(2, Math.max(0, attempt)) * base) + Math.floor(Math.random() * 300);
          await sleep(delay);
        } else if (keySwitched) {
          await sleep(250); // Small pause during key rotation
        }
      }
    }

    // If all retries failed, create a fallback result
    if (!result) {
      result = {
        decision: 'UNCERTAIN',
        confidence: 0,
        reasoning: 'AI screening failed after retries. Manual review required.',
        matchedCriteria: [],
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        promptSent: '',
        responseFull: 'ERROR: All retries exhausted'
      };
    }

    results.push({ ...article, ...result, index: i });
    completedCount = i + 1;

    // Post progress
    self.postMessage({
      type: 'PROGRESS',
      payload: {
        index: i,
        total,
        article,
        decision: result.decision,
        confidence: result.confidence,
        reasoning: result.reasoning,
        matchedCriteria: result.matchedCriteria,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs: result.latencyMs
      }
    });

    // Rate-limit delay between requests
    if (i < total - 1 && config.requestDelayMs > 0) {
      await sleep(config.requestDelayMs);
    }
  }

  // Summarize
  const included = results.filter(r => r.decision === 'INCLUDE').length;
  const excluded = results.filter(r => r.decision === 'EXCLUDE').length;
  const uncertain = results.filter(r => r.decision === 'UNCERTAIN').length;
  const totalTokensIn = results.reduce((s, r) => s + (r.tokensIn || 0), 0);
  const totalTokensOut = results.reduce((s, r) => s + (r.tokensOut || 0), 0);
  const totalLatency = results.reduce((s, r) => s + (r.latencyMs || 0), 0);

  self.postMessage({
    type: 'COMPLETE',
    payload: {
      results,
      summary: {
        total, included, excluded, uncertain,
        totalTokensIn, totalTokensOut,
        avgLatencyMs: total > 0 ? Math.round(totalLatency / total) : 0,
        durationMs: totalLatency
      }
    }
  });
}

/* ─── Screen a single article ──────────────── */

async function screenArticle(article, criteria, apiKey, model, config) {
  const prompt = buildPrompt(article, criteria);
  const t0 = performance.now();

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Build fetch options. By default we use query `key=` for API keys unless
  // `config.useBearerAuth` is true (for OAuth2 access tokens).
  const headers = { 'Content-Type': 'application/json' };
  let url = `${endpoint}?key=${apiKey}`;
  if (config && config.useBearerAuth) {
    url = endpoint;
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: config.temperature || 0.1,
        maxOutputTokens: config.maxTokens || 300
      }
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    const err = new Error(`API ${response.status}: ${errBody.slice(0, 200)}`);
    err.status = response.status;
    // Retry-After may be in seconds, prefer header when present
    const ra = response.headers.get('Retry-After');
    if (ra) err.retryAfter = ra;
    throw err;
  }

  const data = await response.json();
  const latencyMs = Math.round(performance.now() - t0);

  // Extract text from response
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!rawText) {
    throw new Error('Empty response from Gemini API');
  }

  // Parse usage metadata
  const usage = data?.usageMetadata || {};
  const tokensIn = usage.promptTokenCount || 0;
  const tokensOut = usage.candidatesTokenCount || 0;

  // Parse the decision JSON from the response
  const parsed = parseDecision(rawText);

  return {
    decision: parsed.decision,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    matchedCriteria: parsed.matchedCriteria || [],
    tokensIn,
    tokensOut,
    latencyMs,
    promptSent: prompt,
    responseFull: rawText
  };
}

/* ─── Build the screening prompt (Domain-Expert approach) ── */

function buildPrompt(article, criteria) {
  // Build a compact criteria summary
  const criteriaParts = [];

  // PICO
  const pico = criteria.pico || {};
  if (pico.P || pico.I || pico.C || pico.O) {
    const picoItems = [];
    if (pico.P) picoItems.push('Population: ' + pico.P);
    if (pico.I) picoItems.push('Intervention: ' + pico.I);
    if (pico.C) picoItems.push('Comparator: ' + pico.C);
    if (pico.O) picoItems.push('Outcome: ' + pico.O);
    criteriaParts.push('PICO:\n' + picoItems.join('\n'));
  }

  // Study types
  const studyTypes = criteria.study_types || [];
  if (studyTypes.length > 0 && !studyTypes.includes('All')) {
    criteriaParts.push('Acceptable study designs: ' + studyTypes.join(', '));
  }

  // Inclusion keywords
  const incTerms = criteria.inclusion_keywords?.terms || [];
  if (incTerms.length > 0) {
    const logic = criteria.inclusion_keywords?.logic || 'ANY';
    criteriaParts.push('Inclusion topics (' + logic + ' match): ' + incTerms.join(', '));
  }

  // Exclusion keywords
  const excTerms = criteria.exclusion_keywords?.terms || [];
  if (excTerms.length > 0) {
    criteriaParts.push('Exclusion topics: ' + excTerms.join(', '));
  }

  // Custom rules
  const rules = criteria.custom_rules || [];
  if (rules.length > 0) {
    criteriaParts.push('Rules:\n' + rules.map(r => '- IF ' + r.field + ' mentions "' + r.term + '" THEN ' + r.action).join('\n'));
  }

  const criteriaBlock = criteriaParts.length > 0
    ? criteriaParts.join('\n\n')
    : 'No specific criteria provided. Use your expert judgement to assess general relevance.';

  // Build article block (compact)
  const titleLine = article.title || '[No title]';
  const abstractLine = article.abstract || '';
  const metaLine = [
    article.authors ? 'Authors: ' + article.authors : '',
    article.year ? 'Year: ' + article.year : '',
    article.journal ? 'Journal: ' + article.journal : ''
  ].filter(Boolean).join(' | ');

  // The prompt: Expert screener with inclusion-first philosophy
  let prompt = `You are an expert systematic review screener with deep domain knowledge in biomedical and clinical research. Your task is to screen one article for a systematic review.

SCREENING CRITERIA:
${criteriaBlock}

ARTICLE:
Title: ${titleLine}`;

  if (metaLine) {
    prompt += '\n' + metaLine;
  }

  if (abstractLine) {
    prompt += '\nAbstract: ' + abstractLine;
  }

  prompt += `

INSTRUCTIONS:
Use your full domain knowledge to evaluate this article. Do NOT just do keyword matching — understand the meaning, synonyms, related concepts, and clinical context.

INCLUSION-FIRST RULE: Default to INCLUDE. Only EXCLUDE if the article is CLEARLY and DEFINITIVELY irrelevant to the review topic. If there is ANY reasonable possibility the article could be relevant, INCLUDE it.
- INCLUDE: Article is relevant or potentially relevant to the criteria.
- EXCLUDE: Article is definitively outside the scope (e.g., completely different population, unrelated topic, wrong study type).
- UNCERTAIN: Cannot determine from title/abstract alone.`;

  if (!abstractLine) {
    prompt += '\nNOTE: No abstract available. Be MORE inclusive — cap confidence at 70%.';
  }

  prompt += `

Return ONLY valid JSON, no markdown fences:
{"decision":"INCLUDE","confidence":85,"reasoning":"Brief 1-2 sentence explanation","matched_criteria":["relevant criterion"]}`;

  return prompt;
}

/* ─── Parse AI response into structured decision ── */

function parseDecision(rawText) {
  try {
    // Strip markdown fences if present
    let clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // Try to find JSON object in the response
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Normalize decision
    let decision = (parsed.decision || '').toUpperCase().trim();
    if (!['INCLUDE', 'EXCLUDE', 'UNCERTAIN'].includes(decision)) {
      decision = 'UNCERTAIN';
    }

    // Normalize confidence
    let confidence = parseInt(parsed.confidence, 10);
    if (isNaN(confidence) || confidence < 0) confidence = 0;
    if (confidence > 100) confidence = 100;

    return {
      decision,
      confidence,
      reasoning: parsed.reasoning || 'No reasoning provided.',
      matchedCriteria: Array.isArray(parsed.matched_criteria) ? parsed.matched_criteria : []
    };
  } catch (e) {
    // Fallback: try to infer from raw text
    const upper = rawText.toUpperCase();
    let decision = 'UNCERTAIN';
    if (upper.includes('"INCLUDE"') || upper.includes('DECISION: INCLUDE')) decision = 'INCLUDE';
    else if (upper.includes('"EXCLUDE"') || upper.includes('DECISION: EXCLUDE')) decision = 'EXCLUDE';

    return {
      decision,
      confidence: 30,
      reasoning: `Failed to parse JSON response. Raw: ${rawText.slice(0, 200)}`,
      matchedCriteria: []
    };
  }
}

/* ─── Utility ──────────────────────────────── */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

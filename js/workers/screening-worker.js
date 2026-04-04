/* =============================================
   SRScreen — Screening Worker (screening-worker.js)
   AI screener: Gemini API calls, pause/resume/abort
   ============================================= */

let paused = false;
let aborted = false;
let completedCount = 0;

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
    let keysExhaustedCycle = 0;

    while (retries > 0) {
      try {
        const apiKey = apiKeys[currentKeyIndex];
        result = await screenArticle(article, criteria, apiKey, model, config);
        keysExhaustedCycle = 0; // Reset on success
        break;
      } catch (err) {
        retries--;
        const isRateLimit = err.message && (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('TOO_MANY_REQUESTS') || err.message.includes('QUOTA_EXCEEDED'));

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
            message: err.message || 'Unknown error',
            retriesLeft: retries,
            isRateLimit,
            keySwitched
          }
        });

        if (isRateLimit && !keySwitched) {
          // Back off 10 seconds if we hit limit and can't switch/exhausted all keys
          await sleep(10000);
        } else if (retries > 0 && !keySwitched) {
          await sleep(2000);
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: config.temperature || 0.1,
        maxOutputTokens: config.maxTokens || 512
      }
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`API ${response.status}: ${errBody.slice(0, 200)}`);
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

/* ─── Build the screening prompt ───────────── */

function buildPrompt(article, criteria) {
  const studyTypes = (criteria.study_types || []).join(', ') || 'Any';
  const incLogic = criteria.inclusion_keywords?.logic || 'ANY';
  const incTerms = (criteria.inclusion_keywords?.terms || []).join(', ') || 'None specified';
  const excTerms = (criteria.exclusion_keywords?.terms || []).join(', ') || 'None specified';

  const pico = criteria.pico || {};
  const picoBlock = [
    pico.P ? `Population: ${pico.P}` : '',
    pico.I ? `Intervention: ${pico.I}` : '',
    pico.C ? `Comparator: ${pico.C}` : '',
    pico.O ? `Outcome: ${pico.O}` : ''
  ].filter(Boolean).join('\n') || 'Not specified';

  const rulesBlock = (criteria.custom_rules || [])
    .map(r => `- IF ${r.field} CONTAINS "${r.term}" THEN ${r.action}`)
    .join('\n') || 'None';

  return `You are a systematic review screener. Evaluate the following article against the inclusion/exclusion criteria and return a JSON decision.

## ARTICLE
Title: ${article.title || '[No title]'}
Authors: ${article.authors || '[Unknown]'}
Year: ${article.year || '[Unknown]'}
Abstract: ${article.abstract || '[Abstract not available]'}
Journal: ${article.journal || '[Unknown]'}

## CRITERIA
Study Types: ${studyTypes}

PICO Framework:
${picoBlock}

Inclusion keywords (${incLogic}): ${incTerms}
Exclusion keywords: ${excTerms}

Custom rules:
${rulesBlock}

## INSTRUCTIONS
Evaluate the article strictly against the criteria above. Consider the title and abstract carefully.
${!article.abstract ? 'NOTE: No abstract is available. Base your decision on the title only and cap confidence at 70%.' : ''}

Return ONLY valid JSON with no markdown fences, no preamble, no explanation outside the JSON:
{
  "decision": "INCLUDE" | "EXCLUDE" | "UNCERTAIN",
  "confidence": <integer 0-100>,
  "reasoning": "<2-4 sentences explaining your decision>",
  "matched_criteria": ["<list of matched inclusion or exclusion points>"]
}`;
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

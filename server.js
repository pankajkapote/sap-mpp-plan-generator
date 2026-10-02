import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the project folder, regardless of where `node` was started from.
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/*                                                                     */
/* Research chain (first one that works wins):                         */
/*   1. Gemini + Google Search grounding                               */
/*   2. Tavily search (help.sap.com / sap.com) + Cohere summary        */
/*   3. Tavily search alone (its own answer, or the raw SAP snippets)  */
/*   4. Local planning rules + search links                            */
/* ------------------------------------------------------------------ */

const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const TAVILY_API_BASE = process.env.TAVILY_API_BASE || "https://api.tavily.com";
const COHERE_API_BASE = process.env.COHERE_API_BASE || "https://api.cohere.com";

// Google Search grounding is available on the free tier for the Gemini 2.5 Flash family.
const GEMINI_MODELS = [
  ...new Set(
    [
      process.env.GEMINI_MODEL || "gemini-2.5-flash",
      ...(process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash-lite").split(",")
    ]
      .map(m => m.trim())
      .filter(Boolean)
  )
];

const COHERE_MODEL = process.env.COHERE_MODEL || "command-a-03-2025";
const TAVILY_DOMAINS = (process.env.TAVILY_DOMAINS || "help.sap.com,support.sap.com,sap.com")
  .split(",")
  .map(d => d.trim())
  .filter(Boolean);

const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 60000);
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 30000);

const getGeminiKey = () => (process.env.GEMINI_API_KEY || "").trim();
const getTavilyKey = () => (process.env.TAVILY_API_KEY || "").trim();
const getCohereKey = () => (process.env.COHERE_API_KEY || "").trim();

function clean(value, max = 200) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, max);
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

// POST JSON with a timeout. Throws an Error carrying .status on any non-2xx.
async function postJson(url, headers, body, timeoutMs = HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const raw = await response.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      /* non-JSON body */
    }

    if (!response.ok) {
      const message =
        data?.error?.message || // Gemini
        data?.detail?.error || // Tavily
        (typeof data?.error === "string" ? data.error : "") ||
        data?.message || // Cohere
        raw.slice(0, 300) ||
        response.statusText ||
        "Request failed";
      const err = new Error(message);
      err.status = response.status;
      throw err;
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      const err = new Error(`Timed out after ${timeoutMs / 1000}s`);
      err.status = 0;
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function describeError(error) {
  const detail = String(error.message || error)
    .replace(/\s+/g, " ")
    .replace(/\.+$/, "")
    .slice(0, 300);
  if (error.status === 200) return detail; // empty/blocked response, not an HTTP failure
  return `${error.status ? `HTTP ${error.status}` : "network error"}: ${detail}`;
}

function tidyText(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractPlanningConsiderations(text) {
  const match = text.match(/PLANNING CONSIDERATIONS:?\s*([\s\S]*)$/i);
  if (!match) return [];

  return match[1]
    .split("\n")
    .map(line => line.trim())
    .filter(line => /^([-*\u2022]|\d+[.)])\s+/.test(line))
    .map(line => line.replace(/^([-*\u2022]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .map(line => (line.endsWith(".") ? line : `${line}.`))
    .slice(0, 12);
}

function scenarioBlock(p) {
  return `Scenario
- Transformation type: ${clean(p.transformationType)}
- Source release: ${clean(p.sourceRelease)}
- Target release: ${clean(p.targetRelease)}
- Source hosting: ${clean(p.sourceHosting)}  ->  Target hosting: ${clean(p.targetHosting)}
- Source application OS: ${clean(p.sourceApplicationOS)}  ->  Target application OS: ${clean(p.targetApplicationOS)}
- Source database: ${clean(p.sourceDatabase)} (${clean(p.sourceDatabaseOS)})  ->  Target database: ${clean(p.targetDatabase)} (${clean(p.targetDatabaseOS)})
- Scope: ${clean(p.scope, 500)}`;
}

const ANSWER_LAYOUT = `Plain text only. No markdown tables, no # headings, no bold markers.

Answer in exactly this layout:

SUMMARY:
2-4 sentences on the recommended technical path (tools such as SUM, DMO, Maintenance Planner, Readiness Check as applicable) and the main risks.

KEY GUIDES:
- guide or document name - why it matters

PLANNING CONSIDERATIONS:
- one concise, actionable planning item per line (PAM / OS / DB support, prerequisites, downtime and SUM phases, SPDD/SPAU, HA/DR, rollback, post-conversion checks). Give 8 to 12 items.`;

/* ------------------------------------------------------------------ */
/* Tier 1: Gemini + Google Search grounding                            */
/* ------------------------------------------------------------------ */

function buildGeminiPrompt(p) {
  return `You are a senior SAP BASIS and cloud migration architect preparing a master project plan (MPP).
Use Google Search to find the CURRENT documentation on help.sap.com, support.sap.com, me.sap.com and sap.com for this scenario. Prefer SAP Help Portal guides and SAP Notes over third-party blogs.

${scenarioBlock(p)}

Rules
- Do not invent SAP Note numbers, guide names, or version numbers. If you could not confirm something from search results, write "verify on SAP Help / PAM".
- ${ANSWER_LAYOUT}`;
}

async function callGemini(model, apiKey, prompt, timeoutMs = GEMINI_TIMEOUT_MS) {
  return postJson(
    `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": apiKey },
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
    },
    timeoutMs
  );
}

async function callGeminiWithRetry(model, apiKey, prompt) {
  try {
    return await callGemini(model, apiKey, prompt);
  } catch (error) {
    // 503 = model overloaded; a single short retry usually clears it.
    if (error.status === 503) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return callGemini(model, apiKey, prompt);
    }
    throw error;
  }
}

function extractGeminiResult(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = tidyText(parts.map(part => part.text || "").join(""));

  if (!text) {
    const blocked = data?.promptFeedback?.blockReason;
    const finish = candidate?.finishReason;
    const err = new Error(
      `Gemini returned no text${blocked ? ` (blocked: ${blocked})` : ""}${finish ? ` (finishReason: ${finish})` : ""}`
    );
    err.status = 200;
    throw err;
  }

  const seen = new Set();
  const references = [];
  for (const chunk of candidate?.groundingMetadata?.groundingChunks || []) {
    const url = chunk?.web?.uri;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    references.push({ title: chunk.web.title || url, url });
  }

  return {
    text,
    references,
    searchQueries: candidate?.groundingMetadata?.webSearchQueries || [],
    planningConsiderations: extractPlanningConsiderations(text)
  };
}

function geminiHint(errors) {
  const joined = errors.join(" ");
  if (/HTTP 400/.test(joined) && /API key/i.test(joined)) {
    return "Gemini rejected the API key; re-create it in Google AI Studio and update GEMINI_API_KEY in .env.";
  }
  if (/HTTP 403/.test(joined)) {
    return "The Gemini key has no access to the Generative Language API for this project/region.";
  }
  if (/HTTP 404/.test(joined)) {
    return "The Gemini model is not available to this key. Google limits Gemini 2.5 models to projects that already used them; set GEMINI_MODEL in .env to a model your key can use (and that supports Google Search grounding on your tier).";
  }
  if (/HTTP 429/.test(joined)) {
    return "Gemini quota reached. Google Search grounding has its own daily limit on the free tier.";
  }
  return "";
}

// Returns a result object, or null (after pushing the reasons into `notes`).
async function tryGemini(payload, notes) {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    notes.push("Gemini: GEMINI_API_KEY is not set");
    return null;
  }

  const prompt = buildGeminiPrompt(payload);
  const errors = [];

  for (const model of GEMINI_MODELS) {
    try {
      const data = await callGeminiWithRetry(model, apiKey, prompt);
      const result = extractGeminiResult(data);
      const grounded = result.references.length > 0;

      return {
        source: grounded
          ? `Gemini (${model}) with Google Search`
          : `Gemini (${model}) - no live search results were used`,
        fallback: false,
        grounded,
        model,
        searchQueries: result.searchQueries,
        answer: result.text,
        planningConsiderations: result.planningConsiderations,
        references: result.references
      };
    } catch (error) {
      const message = `${model} -> ${describeError(error)}`;
      errors.push(message);
      console.error(`[research] Gemini attempt failed: ${message}`);
    }
  }

  notes.push(`Gemini: ${errors.join(" | ")}`);
  const hint = geminiHint(errors);
  if (hint) notes.push(hint);
  return null;
}

/* ------------------------------------------------------------------ */
/* Tier 2/3: Tavily search (+ Cohere summary)                          */
/* ------------------------------------------------------------------ */

function buildTavilyQuery(p) {
  const target = clean(p.targetRelease);
  const parts = [
    /sap/i.test(target) ? "" : "SAP",
    target,
    clean(p.transformationType),
    "guide",
    clean(p.targetDatabase)
  ].filter(Boolean);
  return parts.join(" ").slice(0, 380);
}

async function callTavily(apiKey, query) {
  return postJson(
    `${TAVILY_API_BASE}/search`,
    { Authorization: `Bearer ${apiKey}` },
    {
      query,
      topic: "general", // valid values: general | news | finance
      search_depth: "basic", // 1 credit per search
      max_results: 8,
      include_answer: true,
      include_domains: TAVILY_DOMAINS
    }
  );
}

function buildCoherePrompt(p, results) {
  const excerpts = results
    .map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${String(r.content || "").slice(0, 700)}`)
    .join("\n\n");

  return `You are a senior SAP BASIS and cloud migration architect preparing a master project plan (MPP).
Below are excerpts from SAP documentation found by a web search. Base your answer ONLY on these excerpts and on well-established SAP practice.

${excerpts}

${scenarioBlock(p)}

Rules
- Do not invent SAP Note numbers, guide names, or version numbers. If the excerpts do not confirm something, write "verify on SAP Help / PAM".
- ${ANSWER_LAYOUT}`;
}

async function callCohere(apiKey, prompt) {
  const data = await postJson(
    `${COHERE_API_BASE}/v2/chat`,
    { Authorization: `Bearer ${apiKey}` },
    {
      model: COHERE_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 1800
    },
    60000
  );

  const text = tidyText(
    (data?.message?.content || [])
      .map(part => (part?.type === "text" ? part.text || "" : ""))
      .join("")
  );
  if (!text) {
    const err = new Error("Cohere returned no text");
    err.status = 200;
    throw err;
  }
  return text;
}

async function tryTavily(payload, notes) {
  const tavilyKey = getTavilyKey();
  if (!tavilyKey) {
    notes.push("Tavily: TAVILY_API_KEY is not set");
    return null;
  }

  let search;
  try {
    search = await callTavily(tavilyKey, buildTavilyQuery(payload));
  } catch (error) {
    const message = describeError(error);
    notes.push(`Tavily: ${message}`);
    console.error(`[research] Tavily failed: ${message}`);
    return null;
  }

  const results = (search?.results || []).filter(r => r?.url);
  if (!results.length) {
    notes.push("Tavily: search returned no SAP documentation results");
    return null;
  }

  const references = results.map(r => ({ title: r.title || r.url, url: r.url }));
  const base = { fallback: false, grounded: true, searchQueries: [buildTavilyQuery(payload)], references };

  // Tier 2: Cohere turns the SAP excerpts into plan-ready text.
  const cohereKey = getCohereKey();
  if (cohereKey) {
    try {
      const text = await callCohere(cohereKey, buildCoherePrompt(payload, results));
      return {
        ...base,
        source: `Tavily Search + Cohere (${COHERE_MODEL})`,
        answer: `Found ${results.length} relevant SAP documents.\n\n${text}`,
        planningConsiderations: extractPlanningConsiderations(text)
      };
    } catch (error) {
      const message = describeError(error);
      notes.push(`Cohere: ${message}`);
      console.error(`[research] Cohere failed: ${message}`);
    }
  } else {
    notes.push("Cohere: COHERE_API_KEY is not set (using Tavily results without Cohere summary)");
  }

  // Tier 3: Tavily alone - its own answer if present, otherwise the raw SAP excerpts.
  const tavilyAnswer = tidyText(search?.answer || "");
  const excerptList = results
    .map(r => `- ${r.title}: ${String(r.content || "").replace(/\s+/g, " ").slice(0, 220)}`)
    .join("\n");

  return {
    ...base,
    source: "Tavily Search (SAP documentation)",
    answer:
      `Found ${results.length} relevant SAP documents.\n\n` +
      (tavilyAnswer ? `SUMMARY:\n${tavilyAnswer}\n\n` : "") +
      `SOURCE EXCERPTS:\n${excerptList}`,
    planningConsiderations: results.map(r => `Review SAP documentation: ${r.title}.`)
  };
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

app.post("/api/research/sap-guides", async (req, res) => {
  const payload = req.body || {};
  const notes = [];

  try {
    const gemini = await tryGemini(payload, notes);
    if (gemini) return res.json({ ...gemini, notes: [] });

    const tavily = await tryTavily(payload, notes);
    if (tavily) return res.json({ ...tavily, notes });
  } catch (error) {
    console.error("[research] Unexpected error:", error);
    notes.push(`Unexpected server error: ${error.message}`);
  }

  if (!getGeminiKey() && !getTavilyKey()) {
    notes.push("Add GEMINI_API_KEY and/or TAVILY_API_KEY to the .env file next to server.js and restart.");
  }
  return res.json(buildFallbackResearch(payload, notes.join(" | ")));
});

// Diagnostics: open http://localhost:3000/api/research/status in a browser.
// Add ?live=1 to run one small real call per configured provider (uses 1 Tavily credit).
app.get("/api/research/status", async (req, res) => {
  const status = {
    geminiKeyConfigured: Boolean(getGeminiKey()),
    geminiModels: GEMINI_MODELS,
    tavilyKeyConfigured: Boolean(getTavilyKey()),
    cohereKeyConfigured: Boolean(getCohereKey()),
    cohereModel: COHERE_MODEL
  };

  if (req.query.live === "1") {
    status.live = {};

    if (getGeminiKey()) {
      status.live.gemini = [];
      for (const model of GEMINI_MODELS) {
        try {
          const data = await callGemini(model, getGeminiKey(), "What is the latest SAP S/4HANA release? Answer in one sentence.");
          const result = extractGeminiResult(data);
          status.live.gemini.push({ model, ok: true, grounded: result.references.length > 0, sources: result.references.length, sample: result.text.slice(0, 200) });
        } catch (error) {
          status.live.gemini.push({ model, ok: false, error: describeError(error) });
        }
      }
    }

    if (getTavilyKey()) {
      try {
        const data = await callTavily(getTavilyKey(), "SAP S/4HANA conversion guide");
        status.live.tavily = { ok: true, results: (data?.results || []).length };
      } catch (error) {
        status.live.tavily = { ok: false, error: describeError(error) };
      }
    }

    if (getCohereKey()) {
      try {
        const text = await callCohere(getCohereKey(), "Reply with the single word: ok");
        status.live.cohere = { ok: true, sample: text.slice(0, 60) };
      } catch (error) {
        status.live.cohere = { ok: false, error: describeError(error) };
      }
    }
  }

  res.json(status);
});

function buildFallbackResearch(payload = {}, reason = "") {
  return {
    source: "Fallback SAP Help Portal Search",
    fallback: true,
    reason,
    answer: "Using local planning rules and SAP best practices.",
    planningConsiderations: [
      "Validate SAP Product Availability Matrix",
      "Use SAP Maintenance Planner",
      "Execute SAP Readiness Check",
      "Plan SPDD/SPAU transport sequence",
      "Schedule SUM phases with HA/DR validation"
    ],
    references: []
  };
}

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`SAP MPP Planner running at http://localhost:${port}`);
  console.log(
    `Research providers -> Gemini: ${getGeminiKey() ? "on" : "OFF"}, ` +
      `Tavily: ${getTavilyKey() ? "on" : "OFF"}, Cohere: ${getCohereKey() ? "on" : "OFF"}`
  );
});

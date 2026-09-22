import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Tavily Search
async function searchTavily(query) {
  if (!process.env.TAVILY_API_KEY) return null;

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: query,
        include_domains: ['help.sap.com', 'sap.com'],
        max_results: 5,
        topic: 'business'
      })
    });

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Tavily search failed:', error);
    return null;
  }
}

// Cohere Activity Generation
async function generateActivitiesCohere(searchResults, context) {
  if (!process.env.COHERE_API_KEY) return null;

  try {
    const documentContext = searchResults
      .map((r, i) => `${i + 1}. ${r.title}: ${r.content.substring(0, 200)}...`)
      .join('\n');

    const prompt = `Based on these SAP upgrade documents:

${documentContext}

Generate specific upgrade activities for:
- Source: ${context.sourceRelease} on ${context.sourceDatabase}
- Target: ${context.targetRelease} on ${context.targetDatabase}
- Transformation: ${context.transformationType}

Include: SUM phases, transport management, validation steps, HA/DR activities, and rollback procedures.
Format: One activity per line, with duration estimate (in hours).`;

    const response = await fetch('https://api.cohere.ai/v1/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'command-light',
        prompt: prompt,
        max_tokens: 1000,
        temperature: 0.3
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.generations[0].text;
  } catch (error) {
    console.error('Cohere generation failed:', error);
    return null;
  }
}

// Main endpoint
app.post("/api/research/sap-guides", async (req, res) => {
  const payload = req.body || {};

  try {
    // 1. Try Tavily search first
    const tavilyQuery = `SAP ${payload.targetRelease} ${payload.transformationType} upgrade procedure ${payload.targetDatabase}`;
    const tavilyResults = await searchTavily(tavilyQuery);

    if (tavilyResults && tavilyResults.results.length > 0) {
      // 2. Generate activities using Cohere if Tavily found results
      const enhancedActivities = await generateActivitiesCohere(
        tavilyResults.results,
        payload
      );

      if (enhancedActivities) {
        return res.json({
          source: "Tavily Search + Cohere Generation",
          fallback: false,
          answer: `Found ${tavilyResults.results.length} relevant SAP documents.\n\nGenerated upgrade activities:\n\n${enhancedActivities}`,
          planningConsiderations: tavilyResults.results.map(r => r.title),
          references: tavilyResults.results.map(r => ({
            title: r.title,
            url: r.url
          }))
        });
      }
    }

    // 3. Fall back to Gemini
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return res.json(buildFallbackResearch(payload));
    }

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `SAP ${payload.sourceRelease} to ${payload.targetRelease} upgrade guide...`
            }]
          }],
          tools: [{ google_search: {} }]
        })
      }
    );

    if (!geminiResponse.ok) {
      return res.json(buildFallbackResearch(payload));
    }

    const geminiData = await geminiResponse.json();
    return res.json({
      source: "Gemini with Google Search",
      fallback: false,
      answer: geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "",
      planningConsiderations: [],
      references: []
    });

  } catch (error) {
    console.error('Error:', error);
    return res.json(buildFallbackResearch(payload));
  }
});

function buildFallbackResearch(payload = {}) {
  return {
    source: "Fallback SAP Help Portal Search",
    fallback: true,
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
});

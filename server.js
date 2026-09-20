import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/research/sap-guides", async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({
        error: "GEMINI_API_KEY is not configured on the server."
      });
    }

    const {
      transformationType,
      sourceHosting,
      targetHosting,
      sourceApplicationOS,
      sourceDatabase,
      sourceDatabaseOS,
      targetApplicationOS,
      targetDatabase,
      targetDatabaseOS,
      sourceRelease,
      targetRelease,
      scope
    } = req.body;

    const prompt = `
You are supporting an SAP transformation project planning team.

Find official SAP Help Portal resources, SAP implementation guides,
SAP roadmaps, SAP Community resources and publicly accessible SAP
documentation relevant to this SAP transformation.

Transformation Type:
${transformationType}

Source Environment:
Hosting: ${sourceHosting}
SAP Application OS: ${sourceApplicationOS}
Database: ${sourceDatabase}
Database OS: ${sourceDatabaseOS}
SAP Release: ${sourceRelease}

Target Environment:
Hosting: ${targetHosting}
SAP Application OS: ${targetApplicationOS}
Database: ${targetDatabase}
Database OS: ${targetDatabaseOS}
SAP Release: ${targetRelease}

Scope:
${scope}

Return a concise response with these headings:

1. Applicable SAP Guides and Documentation
2. Important Planning Considerations
3. Technical Readiness Activities
4. Cutover and Downtime Considerations
5. Key Risks and Assumptions
6. Recommended SAP Documentation Links

Rules:
- Do not invent SAP Notes, SAP URLs, or document titles.
- Clearly state if a document must be verified in SAP for Me or SAP Support Portal.
- Focus on project planning implications.
- Mention SAP HANA and Linux requirements where relevant.
`;

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          tools: [
            {
              google_search: {}
            }
          ]
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      return res.status(response.status).json({
        error: "Gemini SAP guide research failed.",
        details: errorText
      });
    }

    const data = await response.json();

    const answer =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("\n") ||
      "No SAP guide research response was returned.";

    const groundingChunks =
      data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    const references = groundingChunks
      .map(chunk => {
        if (!chunk.web?.uri) return null;

        return {
          title: chunk.web.title || "SAP Reference",
          url: chunk.web.uri
        };
      })
      .filter(Boolean);

    return res.json({
      answer,
      references
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to complete SAP guide research.",
      details: error.message
    });
  }
});

app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`SAP MPP Planner is running at http://localhost:${port}`);
});

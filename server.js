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
  const payload = req.body || {};

  const buildFallbackResearch = (reason = "Gemini research is unavailable.") => {
    const {
      transformationType = "",
      sourceHosting = "",
      targetHosting = "",
      sourceApplicationOS = "",
      sourceDatabase = "",
      sourceDatabaseOS = "",
      targetApplicationOS = "",
      targetDatabase = "",
      targetDatabaseOS = "",
      sourceRelease = "",
      targetRelease = "",
      scope = ""
    } = payload;

    const hanaInScope =
      sourceDatabase === "SAP HANA" ||
      targetDatabase === "SAP HANA";

    const conversionInScope =
      transformationType.includes("Conversion") ||
      transformationType.includes("S/4HANA");

    const migrationInScope =
      transformationType.includes("Migration") ||
      transformationType.includes("Lift & Shift") ||
      transformationType.includes("RISE");

    const upgradeInScope =
      transformationType.includes("Upgrade");

    const searchTerms = [
      `"${targetRelease}" system requirements`,
      `"${targetRelease}" installation guide`,
      `"${targetRelease}" upgrade guide`,
      `"${targetRelease}" maintenance planner`,
      `"${targetRelease}" technical requirements`
    ];

    if (hanaInScope) {
      searchTerms.push(
        `"SAP HANA" Linux operating system requirements`,
        `"SAP HANA" hardware and software requirements`,
        `"SAP HANA" database migration option DMO guide`
      );
    }

    if (conversionInScope) {
      searchTerms.push(
        `"SAP S/4HANA conversion guide"`,
        `"SAP S/4HANA" simplification item catalog`,
        `"SAP Readiness Check" S/4HANA conversion`,
        `"Custom Code Migration" SAP S/4HANA`
      );
    }

    if (upgradeInScope) {
      searchTerms.push(
        `"SUM" software update manager guide`,
        `"SAP Maintenance Planner" upgrade planning`,
        `"SAP system upgrade" technical preparation`
      );
    }

    if (migrationInScope) {
      searchTerms.push(
        `"SAP system copy guide"`,
        `"SAP homogeneous system copy"`,
        `"SAP heterogeneous system copy"`,
        `"SAP migration" database migration option`
      );
    }

    if (targetHosting.includes("RISE")) {
      searchTerms.push(
        `"RISE with SAP" technical services guide`,
        `"RISE with SAP" customer responsibilities`,
        `"RISE with SAP" system conversion`
      );
    }

    const uniqueTerms = [...new Set(searchTerms)];

    const fallbackReferences = uniqueTerms.map(term => {
      const encodedTerm = encodeURIComponent(term);

      return {
        title: `Search SAP Help Portal: ${term}`,
        sapHelpUrl: `https://help.sap.com/docs/search?q=${encodedTerm}`,
        googleUrl: `https://www.google.com/search?q=${encodeURIComponent(
          `site:help.sap.com/docs ${term}`
        )}`
      };
    });

    const planningConsiderations = [
      "Validate the selected SAP release, application server operating system, database version and hosting model against the SAP Product Availability Matrix (PAM).",
      "Validate all SAP software maintenance, add-on compatibility, kernel requirements, Unicode requirements, support package dependencies and required SAP Notes through SAP for Me / SAP Support Portal.",
      "Use SAP Maintenance Planner to validate stack XML, compatible add-ons, technical dependencies and maintenance requirements.",
      "Use SAP Readiness Check where applicable to identify simplification items, custom code impacts, sizing considerations, business process impacts and integration risks.",
      "Use Production-derived refreshes for Sandbox, QA and Mock landscapes when approved by security and data privacy teams.",
      "Run non-production technical activities during the normal weekday single-shift calendar.",
      "Run Mock and Production uptime activities during normal single-shift working periods, but schedule cutover, smoke testing and initial reconciliation in the weekend 24x7 cutover calendar.",
      "Apply a Production transport freeze before the final Production cutover and define a formal emergency transport approval process."
    ];

    if (hanaInScope) {
      planningConsiderations.push(
        "SAP HANA database servers require Linux. The SAP application server operating system must be validated separately against the target SAP release and SAP PAM.",
        `Source database platform: ${sourceDatabase} on ${sourceDatabaseOS}. Target database platform: ${targetDatabase} on ${targetDatabaseOS}. Confirm migration, backup, restore, HA/DR and database revision compatibility.`
      );
    }

    if (conversionInScope) {
      planningConsiderations.push(
        "For S/4HANA conversion, include simplification item analysis, CVI readiness, custom code remediation, business partner readiness, Fiori/security assessment, financial data reconciliation and mandatory conversion checks."
      );
    }

    if (migrationInScope) {
      planningConsiderations.push(
        "For migration or lift-and-shift scope, include source/target connectivity, backup/restore validation, system copy method, database migration method, data transfer throughput, cutover rollback points and DR validation."
      );
    }

    if (targetHosting.includes("RISE")) {
      planningConsiderations.push(
        "For RISE with SAP, validate responsibility boundaries, service request lead times, connectivity, customer-managed integrations, identity/security responsibilities, transport process, backup/restore responsibilities and SAP operational procedures."
      );
    }

    return {
      source: "Fallback SAP Help Portal Search Plan",
      fallback: true,
      reason,
      answer: [
        "Gemini research is currently unavailable, has reached quota limits, or returned an error.",
        "",
        "The application has generated SAP Help Portal and Google site-restricted search links instead of failing.",
        "",
        "Recommended project planning considerations:",
        ...planningConsiderations.map(item => `• ${item}`),
        "",
        "Project context:",
        `• Transformation: ${transformationType}`,
        `• Source: ${sourceHosting}; SAP Application OS: ${sourceApplicationOS}; Database: ${sourceDatabase} on ${sourceDatabaseOS}; Release: ${sourceRelease}`,
        `• Target: ${targetHosting}; SAP Application OS: ${targetApplicationOS}; Database: ${targetDatabase} on ${targetDatabaseOS}; Release: ${targetRelease}`,
        `• Scope: ${scope}`
      ].join("\n"),
      planningConsiderations,
      references: fallbackReferences
    };
  };

  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.json(
        buildFallbackResearch(
          "Gemini API key is not configured on the server."
        )
      );
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
    } = payload;

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

      return res.json(
        buildFallbackResearch(
          `Gemini API request was unavailable. HTTP status: ${response.status}. ${errorText}`
        )
      );
    }

    const data = await response.json();

    const answer =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("\n") ||
      "";

    if (!answer.trim()) {
      return res.json(
        buildFallbackResearch(
          "Gemini returned no usable SAP documentation research result."
        )
      );
    }

    const groundingChunks =
      data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    const references = groundingChunks
      .map(chunk => {
        if (!chunk.web?.uri) return null;

        return {
          title: chunk.web.title || "SAP Documentation Reference",
          url: chunk.web.uri
        };
      })
      .filter(Boolean);

    return res.json({
      source: "Gemini with Google Search Grounding",
      fallback: false,
      answer,
      planningConsiderations: [],
      references
    });
  } catch (error) {
    return res.json(
      buildFallbackResearch(
        `Gemini research could not be completed. ${error.message}`
      )
    );
  }
});
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

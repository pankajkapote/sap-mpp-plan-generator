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

function buildFallbackResearch(payload = {}, reason = "Gemini research is unavailable.") {
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

  const isHanaInScope =
    sourceDatabase === "SAP HANA" ||
    targetDatabase === "SAP HANA";

  const isConversion =
    transformationType.toLowerCase().includes("conversion") ||
    transformationType.toLowerCase().includes("s/4hana");

  const isMigration =
    transformationType.toLowerCase().includes("migration") ||
    transformationType.toLowerCase().includes("lift & shift") ||
    transformationType.toLowerCase().includes("rise");

  const isUpgrade =
    transformationType.toLowerCase().includes("upgrade");

  const searchTerms = [
    `"${targetRelease}" installation guide`,
    `"${targetRelease}" system requirements`,
    `"${targetRelease}" technical requirements`,
    `"SAP Maintenance Planner" "${targetRelease}"`,
    `"SAP Product Availability Matrix" "${targetRelease}"`
  ];

  if (isUpgrade) {
    searchTerms.push(
      `"Software Update Manager" upgrade guide`,
      `"SAP SUM" maintenance planner upgrade`,
      `"SAP system upgrade" technical preparation`
    );
  }

  if (isConversion) {
    searchTerms.push(
      `"SAP S/4HANA conversion guide"`,
      `"SAP S/4HANA" simplification item catalog`,
      `"SAP Readiness Check" S/4HANA`,
      `"SAP Custom Code Migration" S/4HANA`,
      `"SAP Business Partner" conversion readiness`
    );
  }

  if (isMigration) {
    searchTerms.push(
      `"SAP system copy guide"`,
      `"SAP homogeneous system copy"`,
      `"SAP heterogeneous system copy"`,
      `"SAP database migration option" DMO`,
      `"SAP migration" technical guide`
    );
  }

  if (isHanaInScope) {
    searchTerms.push(
      `"SAP HANA" Linux operating system requirements`,
      `"SAP HANA" hardware and software requirements`,
      `"SAP HANA" database migration option DMO`,
      `"SAP HANA" backup recovery guide`
    );
  }

  if (targetHosting.toLowerCase().includes("rise")) {
    searchTerms.push(
      `"RISE with SAP" technical services guide`,
      `"RISE with SAP" customer responsibilities`,
      `"RISE with SAP" system conversion`,
      `"RISE with SAP" connectivity guide`
    );
  }

  const uniqueTerms = [...new Set(searchTerms)];

  const references = uniqueTerms.map(term => {
    const sapHelpQuery = encodeURIComponent(term);
    const googleQuery = encodeURIComponent(`site:help.sap.com/docs ${term}`);

    return {
      title: `Search SAP Help Portal: ${term}`,
      sapHelpUrl: `https://help.sap.com/docs/search?q=${sapHelpQuery}`,
      googleUrl: `https://www.google.com/search?q=${googleQuery}`
    };
  });

  const planningConsiderations = [
    "Validate the SAP Product Availability Matrix for the selected SAP release, SAP application server operating system, database, database operating system and hosting model.",
    "Validate applicable SAP implementation guides, installation guides, upgrade guides, migration guides and support documentation through SAP Help Portal and SAP for Me / SAP Support Portal.",
    "Use SAP Maintenance Planner to validate compatible add-ons, maintenance dependencies, stack XML requirements, support package dependencies and technical prerequisites.",
    "Use SAP Readiness Check where applicable to identify custom code findings, simplification items, sizing considerations, integration impacts, business process impacts and technical risks.",
    "Validate source-to-target connectivity, firewall rules, DNS, certificates, backup, restore, monitoring, HA/DR, access model and operational support processes.",
    "Use Production-derived refreshes for Sandbox, QA and Mock environments where approved by Security, Privacy, BASIS and DBA teams.",
    "Run normal planning, preparation, non-production upgrades, testing and Production uptime activities during the normal single-shift calendar.",
    "Schedule Mock and Production technical cutovers, smoke testing and initial reconciliation during the weekend 24x7 cutover calendar.",
    "Apply a Production transport freeze before final Production cutover. Define the emergency transport process, approval path, rollback transport approach and final queue validation."
  ];

  if (isHanaInScope) {
    planningConsiderations.push(
      "SAP HANA database servers require Linux. Validate SAP application server operating system support separately against the SAP Product Availability Matrix for the chosen target release.",
      `Source database: ${sourceDatabase} on ${sourceDatabaseOS}. Target database: ${targetDatabase} on ${targetDatabaseOS}. Validate database version/revision compatibility, migration procedure, backup/recovery, HA/DR and sizing.`
    );
  }

  if (isConversion) {
    planningConsiderations.push(
      "For S/4HANA conversion scope, include simplification item analysis, custom code remediation, CVI and Business Partner readiness, functional impact assessment, authorization/Fiori assessment, financial reconciliation, data validation and business process acceptance."
    );
  }

  if (isMigration) {
    planningConsiderations.push(
      "For migration, lift-and-shift or RISE transition scope, include system-copy/migration method validation, source/target bandwidth, data transfer throughput, migration downtime, rollback points, operational handover and disaster recovery validation."
    );
  }

  if (targetHosting.toLowerCase().includes("rise")) {
    planningConsiderations.push(
      "For RISE with SAP, validate responsibility boundaries, service request lead times, customer-managed integrations, connectivity, identity and security responsibilities, transport processes, backup/restore processes, monitoring model and SAP operational procedures."
    );
  }

  return {
    source: "Fallback SAP Help Portal Search Plan",
    fallback: true,
    reason,
    answer: [
      "Gemini guide research is currently unavailable, quota-limited, not configured, or did not return a usable result.",
      "",
      "The application has generated targeted SAP Help Portal searches and Google site-restricted searches for help.sap.com/docs.",
      "",
      "Recommended planning considerations:",
      ...planningConsiderations.map(item => `• ${item}`),
      "",
      "Project context:",
      `• Transformation: ${transformationType || "Not specified"}`,
      `• Source: Hosting=${sourceHosting || "Not specified"}; Application OS=${sourceApplicationOS || "Not specified"}; Database=${sourceDatabase || "Not specified"} on ${sourceDatabaseOS || "Not specified"}; Release=${sourceRelease || "Not specified"}`,
      `• Target: Hosting=${targetHosting || "Not specified"}; Application OS=${targetApplicationOS || "Not specified"}; Database=${targetDatabase || "Not specified"} on ${targetDatabaseOS || "Not specified"}; Release=${targetRelease || "Not specified"}`,
      `• Scope: ${scope || "Not specified"}`
    ].join("\n"),
    planningConsiderations,
    references
  };
}

app.post("/api/research/sap-guides", async (req, res) => {
  const payload = req.body || {};

  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.json(
        buildFallbackResearch(
          payload,
          "GEMINI_API_KEY is not configured on the application server."
        )
      );
    }

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

    const prompt = `
You are supporting an SAP transformation project planning team.

Research official SAP Help Portal resources, implementation guides, installation guides,
upgrade guides, migration guides, SAP roadmaps, publicly accessible SAP Community material,
and other reliable SAP documentation relevant to the following project.

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

Project Scope:
${scope}

Provide concise planning-oriented output with the following headings:

1. Applicable SAP Guides and Documentation
2. Technical Readiness Activities
3. Upgrade, Conversion or Migration Planning Considerations
4. Testing, Cutover and Downtime Considerations
5. Risks, Assumptions and Dependencies
6. Documentation Validation Actions

Rules:
- Do not invent SAP Note numbers, SAP URLs, guide titles or support documentation.
- Clearly identify anything that needs validation in SAP for Me, SAP Support Portal, SAP Product Availability Matrix or SAP Maintenance Planner.
- Mention that SAP HANA database servers require Linux when SAP HANA is in scope.
- Explain that SAP application server OS compatibility is independent and must be verified against the SAP Product Availability Matrix for the selected release.
- Focus on actionable project-plan tasks and dependencies.
`;

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
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

    if (!geminiResponse.ok) {
      const details = await geminiResponse.text();

      return res.json(
        buildFallbackResearch(
          payload,
          `Gemini request failed with HTTP ${geminiResponse.status}. ${details}`
        )
      );
    }

    const geminiData = await geminiResponse.json();

    const answer =
      geminiData?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("\n")
        .trim() || "";

    if (!answer) {
      return res.json(
        buildFallbackResearch(
          payload,
          "Gemini returned no usable documentation research content."
        )
      );
    }

    const groundingChunks =
      geminiData?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    const references = groundingChunks
      .map(chunk => {
        if (!chunk?.web?.uri) {
          return null;
        }

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
        payload,
        `Gemini research could not be completed. ${error.message}`
      )
    );
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`SAP MPP Plan Generator is running at http://localhost:${port}`);
});

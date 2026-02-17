const express = require("express");
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { sanitizeAIResponse } = require("../utils/ia-utils");

const router = express.Router();

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_TIMEOUT_MS = 25000;

const {
  OPENROUTER_MODEL,
  OPENROUTER_API_KEY: API_KEY,
} = process.env;

/* ============================================================
   UTIL: EXTRAER RESUMEN ESTRUCTURAL DEL DOM
============================================================ */
function extractDomStructureSummary(html) {
  const $ = cheerio.load(html);
  const tags = ["h1", "h2", "h3", "p", "button", "a", "section", "div"];
  const nodes = [];

  $(tags.join(",")).each((_, el) => {
    if (nodes.length >= 100) return false;

    const tag = el.tagName?.toLowerCase();
    const text = $(el).text().trim();
    const id = $(el).attr("id") || null;
    const className = $(el).attr("class") || null;

    if (tag === "div" && !id && !className) return;

    nodes.push({
      tag,
      text,
      id,
      class: className,
    });
  });

  return nodes;
}

/* ============================================================
   VALIDAR HTML BÁSICO
============================================================ */
function validateHtmlStructure(html) {
  return /<[^>]+>/g.test(html);
}

async function persistFileIfRequested(req, res, html) {
  const { filePath, persist } = req.body || {};
  if (!persist || !filePath) return null;

  const projectRoot = path.resolve(__dirname, "../../..");
  const resolved = path.resolve(projectRoot, filePath);

  const projNorm = projectRoot.replace(/\\/g, "/").toLowerCase();
  const resNorm = resolved.replace(/\\/g, "/").toLowerCase();

  if (!resNorm.startsWith(projNorm)) {
    res.status(400).json({ error: { code: "INVALID_PATH", message: "filePath fuera del directorio permitido" } });
    return false;
  }

  try {
    let backupPath = null;
    if (fs.existsSync(resolved)) {
      const bak = `${resolved}.bak.${Date.now()}`;
      await fs.promises.copyFile(resolved, bak);
      backupPath = path.relative(projectRoot, bak);
    } else {
      await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    }

    await fs.promises.writeFile(resolved, html, "utf8");

    return { persisted: true, filePath: path.relative(projectRoot, resolved), backupPath };
  } catch (err) {
    res.status(500).json({ error: { code: "WRITE_ERROR", message: "Error guardando archivo", detail: err.message } });
    return false;
  }
}

/* ============================================================
   ENDPOINT PRINCIPAL
============================================================ */
router.post("/ia-edit", async (req, res) => {
  try {
    const { code, instructions, selectedOption } = req.body;

    if (!code || !instructions) {
      return res.status(400).json({
        error: { code: "INVALID_INPUT", message: "Faltan parámetros" },
      });
    }

    /* ========================================================
       BLOQUE DETERMINISTA (phrases + text_center)
    ======================================================== */

    const hasPhrases = /const\s+phrases\s*=\s*\[/i.test(code);
    const hasCenterText = /const\s+text\s*=\s*['"`][\s\S]*?['"`]/i.test(code);

    function replacePhrasesArray(src, newArr) {
      return src.replace(
        /const\s+phrases\s*=\s*\[[\s\S]*?\];/i,
        `const phrases = [\n  ${newArr
          .map((p) => JSON.stringify(p))
          .join(",\n  ")}\n];`
      );
    }

    function replaceTextCenter(src, newText) {
      return src.replace(
        /const\s+text\s*=\s*(["'`])([\s\S]*?)\1\s*;/i,
        (m, q) => `const text = ${q}${newText}${q};`
      );
    }

    if (
      selectedOption === "phrases_array" ||
      selectedOption === "text_center" ||
      selectedOption === "both"
    ) {
      let newCode = code;
      let actions = [];

      if (
        selectedOption === "phrases_array" ||
        selectedOption === "both"
      ) {
        const phrasesMatch = instructions.match(/\[(.*?)\]/s);
        let userPhrases = null;

        if (phrasesMatch) {
          try {
            userPhrases = JSON.parse(`[${phrasesMatch[1]}]`);
          } catch {
            userPhrases = null;
          }
        }

        if (!userPhrases) {
          userPhrases = ["Nueva frase 1", "Nueva frase 2"];
        }

        newCode = replacePhrasesArray(newCode, userPhrases);
        actions.push({ type: "setPhrasesArray", phrases: userPhrases });
      }

      if (
        selectedOption === "text_center" ||
        selectedOption === "both"
      ) {
        const match = instructions.match(/['"`](.*?)['"`]/);
        const newText = match ? match[1] : "Texto cambiado";
        newCode = replaceTextCenter(newCode, newText);
        actions.push({ type: "setTextCenter", text: newText });
      }

      return res.json({
        ok: true,
        actionsApplied: actions,
        code: newCode,
      });
    }

    /* ========================================================
       FLUJO IA CON CONTEXTO ESTRUCTURAL
    ======================================================== */

    const domStructureSummary = extractDomStructureSummary(code);

      const systemPrompt = ` 
Eres un ingeniero experto en edición estructural de HTML.

Tu tarea:
1. Analizar la intención del usuario.
2. Identificar qué parte del HTML debe cambiar.
3. Modificar SOLO lo necesario.
4. Mantener estructura, scripts y estilos intactos.
5. No eliminar código existente a menos que sea solicitado explícitamente.

 Reglas estrictas:
- Devuelve únicamente el HTML completo.
- No agregues explicaciones.
- No uses markdown.
- No inventes contenido innecesario.
- Si no estás seguro, modifica lo mínimo posible.
`;

  

    /* ---------- PASO 3: ENVIAR CONTEXTO MEJORADO Y RECIBIR ACCIONES JSON ---------- */
    const userPrompt = `Estructura del documento:\n${JSON.stringify(domStructureSummary, null, 2)}\n\nArchivo HTML completo:\n${code}\n\nInstrucción del usuario:\n${instructions}\n\nRESPONDE SOLO CON UN JSON VALIDO CON LA SIGUIENTE ESTRUCTURA:\n{ "actions": [ { "type": "replaceText|setAttribute|addClass|removeElement|appendHTML", "selector": "...", ... } ] }`;

    // Extender systemPrompt con las reglas de motor estrictas
    const engineInstructions = `\n\nEres un motor de edición HTML estructurado.\nNUNCA devuelvas HTML completo.\nSOLO puedes responder con JSON válido bajo el formato especificado.\nSi no puedes cumplir una instrucción, devuelve:{"actions": []}\nNunca expliques nada.\nNunca agregues texto fuera del JSON.`;

    const finalSystemPrompt = `${systemPrompt}${engineInstructions}`;

    let rawReply;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          temperature: 0,
          max_tokens: 1200,
          messages: [
            { role: "system", content: finalSystemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const txt = await response.text();
        return res.status(502).json({
          error: { code: "MODEL_ERROR", message: "Error proveedor IA", detail: txt },
        });
      }

      const data = await response.json();
      rawReply = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || null;
    } catch (err) {
      if (err.name === "AbortError") {
        return res.status(504).json({ error: { code: "MODEL_TIMEOUT", message: "Timeout del modelo" } });
      }
      return res.status(502).json({ error: { code: "MODEL_CALL_FAILED", message: err.message } });
    }

    if (!rawReply) {
      return res.status(502).json({ error: { code: "EMPTY_MODEL_REPLY", message: "Respuesta vacía del modelo" } });
    }

    /* ---------- VALIDAR QUE LA RESPUESTA SEA JSON VÁLIDO (ACCIONES) ---------- */
    let parsed;
    try {
      parsed = JSON.parse(rawReply);
    } catch (err) {
      // intentar extraer primer bloque JSON y parsear, con fallback a JSON5
      const jsonMatch = String(rawReply).match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (e) {
          try {
            // JSON5 puede manejar comas finales u otras licencias menores
            const JSON5 = require("json5");
            parsed = JSON5.parse(jsonMatch[0]);
          } catch (e2) {
            return res.status(422).json({ error: { code: "INVALID_JSON", message: "Respuesta del modelo no es JSON válido.", detail: e2.message, raw: rawReply } });
          }
        }
      } else {
        return res.status(422).json({ error: { code: "INVALID_JSON", message: "Respuesta del modelo no contiene JSON.", raw: rawReply } });
      }
    }

    if (!parsed || !Array.isArray(parsed.actions)) {
      // Si parsed.actions es exactamente undefined or null -> aceptamos el caso vacío si parsed.actions === undefined? no.
      // Permitimos que el modelo devuelva { actions: [] } -> eso es válido. Si actions falta, devolvemos 422 pero con parsed included.
      if (parsed && Array.isArray(parsed.actions)) {
        // impossible branch but keep
      }
      return res.status(422).json({ error: { code: "MISSING_ACTIONS", message: "El JSON no contiene 'actions' válidas.", parsed } });
    }

    /* ---------- FUNCION: applyActions ---------- */
    function applyActions(htmlInput, actions) {
      const $ = cheerio.load(htmlInput, { decodeEntities: false });
      const applied = [];

      const allowedTypes = new Set(["replaceText", "setAttribute", "addClass", "removeElement", "appendHTML"]);

      for (const act of actions) {
        try {
          if (!act || !act.type || !allowedTypes.has(act.type)) {
            console.info("ia-edit: ignorando acción desconocida", act && act.type);
            continue;
          }
          const sel = act.selector;
          if (!sel || typeof sel !== "string") {
            console.info("ia-edit: acción sin selector, se ignora", act.type);
            continue;
          }
          const nodes = $(sel);
          if (!nodes || nodes.length === 0) {
            console.info(`ia-edit: selector no encontrado: ${sel}`);
            applied.push({ action: act.type, selector: sel, applied: false, reason: "not_found" });
            continue;
          }

          // Protecciones: nunca permitir operaciones que eliminen o reemplacen todo el documento
          const selNorm = sel.trim().toLowerCase();
          const forbiddenTargetForRemove = selNorm === "html" || selNorm === "body";

          switch (act.type) {
            case "replaceText": {
              // Seguridad: no permitir reescritura total de <html> o <body>
              if (forbiddenTargetForRemove) {
                console.info(`ia-edit: replaceText en ${sel} bloqueado por seguridad`);
                applied.push({ action: act.type, selector: sel, applied: false, reason: "forbidden_target" });
                break;
              }
              // Si no se proporcionó 'value', no sobreescribir con string vacío
              if (!Object.prototype.hasOwnProperty.call(act, 'value') || act.value === null || act.value === undefined) {
                // Si existe 'search', pero no 'value', no aplicamos
                applied.push({ action: act.type, selector: sel, applied: false, reason: "missing_value" });
                break;
              }

              // Si se provee 'search', reemplazamos solo la ocurrencia dentro del texto
              const search = act.search;
              const replacement = String(act.value);
              const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

              if (search && typeof search === 'string' && search.length > 0) {
                const re = new RegExp(escapeRegExp(search), 'g');
                nodes.each((_, el) => {
                  const cur = $(el).text();
                  $(el).text(cur.replace(re, replacement));
                });
              } else {
                // Sin 'search', reemplazo completo del texto del elemento
                nodes.each((_, el) => $(el).text(replacement));
              }

              applied.push({ action: act.type, selector: sel, applied: true, count: nodes.length });
              break;
            }
            case "setAttribute": {
              const attr = act.attribute;
              if (!attr) {
                applied.push({ action: act.type, selector: sel, applied: false, reason: "missing_attribute" });
                break;
              }
              nodes.each((_, el) => $(el).attr(attr, act.value == null ? "" : String(act.value)));
              applied.push({ action: act.type, selector: sel, attribute: attr, applied: true, count: nodes.length });
              break;
            }
            case "addClass": {
              const cls = act.className;
              if (!cls) { applied.push({ action: act.type, selector: sel, applied: false, reason: "missing_className" }); break; }
              nodes.addClass(cls);
              applied.push({ action: act.type, selector: sel, className: cls, applied: true, count: nodes.length });
              break;
            }
            case "removeElement": {
              if (forbiddenTargetForRemove) {
                console.info(`ia-edit: removeElement en ${sel} bloqueado por seguridad`);
                applied.push({ action: act.type, selector: sel, applied: false, reason: "forbidden_target" });
                break;
              }
              nodes.remove();
              applied.push({ action: act.type, selector: sel, applied: true, count: nodes.length });
              break;
            }
            case "appendHTML": {
              const htmlToAppend = act.html || "";
              nodes.each((_, el) => $(el).append(htmlToAppend));
              applied.push({ action: act.type, selector: sel, applied: true, count: nodes.length });
              break;
            }
            default:
              console.info("ia-edit: acción no manejada", act.type);
          }
        } catch (err) {
          console.error("ia-edit: error aplicando acción", act, err.message);
          applied.push({ action: act.type, selector: act.selector, applied: false, reason: "exception", detail: err.message });
        }
      }

      return { html: $.root().html(), applied };
    }

    /* ---------- APLICAR ACCIONES ---------- */
    let applyResult;
    try {
      applyResult = applyActions(code, parsed.actions);
    } catch (err) {
      return res.status(500).json({ error: { code: "APPLY_ACTIONS_FAILED", message: err.message } });
    }

    // Validación post-aplicación: intentar parsear el HTML resultante
    try {
      cheerio.load(applyResult.html);
    } catch (err) {
      return res.status(422).json({ error: { code: "APPLIED_HTML_PARSE_ERROR", message: err.message } });
    }

    // Persistir si se solicitó
    const persistData = await persistFileIfRequested(req, res, applyResult.html);
    if (persistData === false) return;

    return res.json({ ok: true, actionsApplied: applyResult.applied, code: applyResult.html, ...persistData });
  } catch (err) {
    console.error("ia-edit error:", err);
    return res.status(500).json({
      error: { code: "SERVER_ERROR" },
    });
  }
});

module.exports = router;

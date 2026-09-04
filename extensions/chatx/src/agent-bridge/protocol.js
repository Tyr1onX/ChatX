(() => {
  function normalizeToken(value) {
    return String(value ?? "").trim();
  }

  function developerCompletionMarker(token, generation, round) {
    return `END_HANDOFF ${normalizeToken(token)} G${generation} R${round}`;
  }

  function auditorCompletionMarker(token, generation, round) {
    return `END_AUDIT ${normalizeToken(token)} G${generation} R${round}`;
  }

  function readyCompletionMarker(role, generation) {
    const normalizedRole = String(role ?? "").trim().toUpperCase();
    return `READY ${normalizedRole} ${generation}`;
  }

  function isCompletionCandidate(text, completionMarker, generating) {
    const normalizedText = String(text ?? "").trim();
    const marker = String(completionMarker ?? "").trim();
    return Boolean(normalizedText && marker && normalizedText.includes(marker) && generating !== true);
  }

  function stripTrailingMarker(text, completionMarker) {
    const marker = String(completionMarker ?? "").trim();
    if (!marker) return null;
    const lines = String(text ?? "").trim().split(/\r?\n/);
    if (lines.length < 2 || lines.at(-1)?.trim() !== marker) return null;
    return lines.slice(0, -1).join("\n").trim();
  }

  function parseDeveloperHandoffText({ text, token, generation, round }) {
    const marker = developerCompletionMarker(token, generation, round);
    const body = stripTrailingMarker(text, marker);
    if (!body) return null;
    const lines = body.split(/\r?\n/);
    if (lines[0]?.trim() !== `DEVELOPER_HANDOFF ${normalizeToken(token)} ROUND ${round}`) return null;
    const details = lines.slice(1).join("\n");
    if (!details.includes(`GENERATION: ${generation}`)) return null;
    if (!details.includes("STATE:") || !details.includes("EVIDENCE:") || !details.includes("PENDING:")) return null;
    return body;
  }

  function parseAuditorVerdictText({ text, token, generation, round }) {
    const marker = auditorCompletionMarker(token, generation, round);
    const body = stripTrailingMarker(text, marker);
    if (!body) return null;
    const lines = body.split(/\r?\n/).map((line) => line.trim());
    const passMarker = `AUDIT_PASS ${normalizeToken(token)} ROUND ${round}`;
    const failMarker = `AUDIT_FAIL ${normalizeToken(token)} ROUND ${round}`;
    if (lines[0] === passMarker && lines.length === 1) {
      return { verdict: "PASS", feedback: null, text: body };
    }
    if (lines[0] !== failMarker) return null;
    const feedbackLine = lines.find((line) => line.startsWith("FEEDBACK:"));
    const feedback = feedbackLine?.slice(feedbackLine.indexOf(":") + 1).trim() || null;
    if (!feedback) return null;
    return { verdict: "FAIL", feedback, text: body };
  }

  function parseReadyText(text, role, generation) {
    const marker = readyCompletionMarker(role, generation);
    return String(text ?? "").trim() === marker ? marker : null;
  }

  globalThis.ChatGptBridgeProtocol = Object.freeze({
    developerCompletionMarker,
    auditorCompletionMarker,
    readyCompletionMarker,
    isCompletionCandidate,
    stripTrailingMarker,
    parseDeveloperHandoffText,
    parseAuditorVerdictText,
    parseReadyText,
  });
})();

// Graceful degradation when LLM quota or connectivity fails.

function isQuotaError(error) {
  const text = error instanceof Error ? error.message : String(error || "");
  return text.includes("429") || /quota|rate.?limit|insufficient/i.test(text);
}

function isLlmUnavailable(error) {
  return isQuotaError(error) || /timeout|ECONNREFUSED|fetch failed/i.test(String(error));
}

function llmUnavailableNotice() {
  return "AI summary unavailable (OpenAI API quota or connectivity). Automation and CLI output still work — check billing at platform.openai.com if needed.";
}

function shouldRunAutomationOnly(error) {
  return isQuotaError(error);
}

module.exports = {
  isQuotaError,
  isLlmUnavailable,
  llmUnavailableNotice,
  shouldRunAutomationOnly,
};

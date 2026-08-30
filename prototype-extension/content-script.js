window.addEventListener("message", event => {
  const request = event.data;
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    request?.sender !== "phantom-sdk" ||
    request?.target !== "phantom-extension" ||
    request?.channel !== "cardano"
  ) return;

  chrome.runtime.sendMessage({ ...request, origin: window.location.origin }, response => {
    const error = chrome.runtime.lastError;
    window.postMessage({
      sender: "phantom-extension",
      target: "phantom-sdk",
      channel: "cardano",
      requestId: request.requestId,
      ...(error ? { error: { code: -2, info: error.message } } : response),
    }, window.location.origin);
  });
});

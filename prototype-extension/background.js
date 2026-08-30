const pendingApprovals = new Map();
const approvalsByOrigin = new Map();
const APPROVAL_TIMEOUT_MS = 30_000;

const connectionKey = origin => `connected:${origin}`;
const result = value => ({ result: value });
const error = (code, info) => ({ error: { code, info } });

async function isConnected(origin) {
  const stored = await chrome.storage.local.get(connectionKey(origin));
  return Boolean(stored[connectionKey(origin)]);
}

async function enabledExtensions(origin) {
  const stored = await chrome.storage.local.get(connectionKey(origin));
  return stored[connectionKey(origin)]?.extensions ?? [];
}

async function requestApproval(origin, extensions) {
  if (approvalsByOrigin.has(origin)) return approvalsByOrigin.get(origin);
  const approvalId = crypto.randomUUID();
  const decision = new Promise(async resolve => {
    const query = new URLSearchParams({ approvalId, origin, extensions: JSON.stringify(extensions) });
    const popup = await chrome.windows.create({
      url: chrome.runtime.getURL(`approval.html?${query}`),
      type: "popup",
      width: 420,
      height: 540,
    });
    const finish = approved => {
      const pending = pendingApprovals.get(approvalId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingApprovals.delete(approvalId);
      approvalsByOrigin.delete(origin);
      resolve(approved);
    };
    const timer = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS);
    pendingApprovals.set(approvalId, { finish, windowId: popup.id, timer });
  });
  approvalsByOrigin.set(origin, decision);
  return decision;
}

chrome.windows.onRemoved.addListener(windowId => {
  for (const pending of pendingApprovals.values()) {
    if (pending.windowId === windowId) pending.finish(false);
  }
});

function validExtensions(value) {
  return Array.isArray(value) && value.every(item =>
    item &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    Object.keys(item).length === 1 &&
    Number.isSafeInteger(item.cip) &&
    item.cip >= 0
  );
}

function validBridgeRequest(message, sender) {
  if (message?.channel !== "cardano" || message?.sender !== "phantom-sdk" || message?.target !== "phantom-extension") return false;
  if (typeof message.requestId !== "string" || message.requestId.length > 128) return false;
  if (!sender.tab?.url || sender.frameId !== 0 || typeof message.origin !== "string") return false;
  try {
    return new URL(sender.tab.url).origin === new URL(message.origin).origin && new URL(message.origin).origin === message.origin;
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "approval-decision") {
    const pending = pendingApprovals.get(message.approvalId);
    pending?.finish(message.approved === true);
    sendResponse({ ok: Boolean(pending) });
    return;
  }

  if (!validBridgeRequest(message, sender)) return;
  const origin = message.origin;
  const respond = async () => {
    if (message.method === "isEnabled") return result(await isConnected(origin));
    if (message.method === "enable") {
      const requested = message.params?.extensions ?? [];
      if (!validExtensions(requested)) return error(-1, "Invalid extensions request.");
      const extensions = [];
      const existing = await enabledExtensions(origin);
      if (await isConnected(origin) && extensions.every(item => existing.some(enabled => enabled.cip === item.cip))) {
        return result({ enabled: true, extensions: existing });
      }
      if (!(await requestApproval(origin, extensions))) return error(-3, "User declined enablement.");
      await chrome.storage.local.set({ [connectionKey(origin)]: { extensions } });
      return result({ enabled: true, extensions });
    }
    if (!(await isConnected(origin))) return error(-3, "Origin is not connected.");
    if (message.method === "getExtensions") return result(await enabledExtensions(origin));
    return error(-2, `Prototype method is not implemented yet: ${message.method}`);
  };
  respond().then(sendResponse, cause => sendResponse(error(-2, cause?.message || String(cause))));
  return true;
});

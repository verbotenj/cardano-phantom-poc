import { walletCore } from "./wallet-core";

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

function requestApproval(origin, extensions, kind = "connect") {
  const approvalKey = `${origin}:${kind}`;
  if (approvalsByOrigin.has(approvalKey)) return approvalsByOrigin.get(approvalKey);
  const approvalId = crypto.randomUUID();
  let resolveDecision;
  const decision = new Promise(resolve => { resolveDecision = resolve; });
  const pending = { windowId: null, timer: null, finish: null };
  pending.finish = approved => {
    if (!pendingApprovals.has(approvalId)) return;
    clearTimeout(pending.timer);
    pendingApprovals.delete(approvalId);
    approvalsByOrigin.delete(approvalKey);
    resolveDecision(approved);
  };
  pending.timer = setTimeout(() => pending.finish(false), APPROVAL_TIMEOUT_MS);
  pendingApprovals.set(approvalId, pending);
  approvalsByOrigin.set(approvalKey, decision);

  const query = new URLSearchParams({ approvalId, origin, extensions: JSON.stringify(extensions), kind });
  chrome.windows.create({
      url: chrome.runtime.getURL(`approval.html?${query}`),
      type: "popup",
      width: 420,
      height: 540,
    }).then(popup => {
      if (popup?.id === undefined) pending.finish(false);
      else pending.windowId = popup.id;
    }, () => pending.finish(false));
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
  if (message?.type === "configure-wallet") {
    try {
      const inspected = walletCore.inspect(message.mnemonic);
      chrome.storage.local.set({ prototypeWallet: { mnemonic: message.mnemonic } })
        .then(() => sendResponse(result(inspected)), cause => sendResponse(error(-2, cause.message)));
    } catch (cause) {
      sendResponse(error(-1, cause.message));
    }
    return true;
  }
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
      const extensions = requested.filter(item => item.cip === 95);
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
    const stored = await chrome.storage.local.get("prototypeWallet");
    if (!stored.prototypeWallet) return error(-2, "Preview wallet is not configured.");
    const extensions = await enabledExtensions(origin);
    const cip95Enabled = extensions.some(item => item.cip === 95);
    if (message.method.startsWith("cip95.") && !cip95Enabled) return error(-3, "CIP-95 is not enabled.");
    if (["signTx", "signData", "cip95.signData"].includes(message.method)) {
      if (!(await requestApproval(origin, [], message.method))) return error(message.method === "signTx" ? 2 : 3, "User declined signing.");
    }
    try {
      return result(await walletCore.call(message.method, message.params, stored.prototypeWallet, cip95Enabled));
    } catch (cause) {
      return error(-2, cause.message || String(cause));
    }
  };
  respond().then(sendResponse, cause => sendResponse(error(-2, cause?.message || String(cause))));
  return true;
});

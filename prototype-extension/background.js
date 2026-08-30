const pendingApprovals = new Map();
const SUPPORTED_EXTENSIONS = [{ cip: 95 }];

const connectionKey = origin => `connected:${origin}`;
const result = value => ({ result: value });
const error = (code, info) => ({ error: { code, info } });

async function isConnected(origin) {
  const stored = await chrome.storage.local.get(connectionKey(origin));
  return stored[connectionKey(origin)] === true;
}

async function requestApproval(origin, extensions) {
  const approvalId = crypto.randomUUID();
  const decision = new Promise(resolve => pendingApprovals.set(approvalId, resolve));
  const query = new URLSearchParams({ approvalId, origin, extensions: JSON.stringify(extensions) });
  await chrome.windows.create({
    url: chrome.runtime.getURL(`approval.html?${query}`),
    type: "popup",
    width: 420,
    height: 540,
  });
  return decision;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "approval-decision") {
    const resolve = pendingApprovals.get(message.approvalId);
    if (resolve) {
      pendingApprovals.delete(message.approvalId);
      resolve(message.approved === true);
    }
    sendResponse({ ok: Boolean(resolve) });
    return;
  }

  if (message?.channel !== "cardano" || message?.sender !== "phantom-sdk") return;
  const origin = message.origin;
  const respond = async () => {
    if (typeof origin !== "string" || !sender.tab?.url?.startsWith(origin)) return error(-1, "Invalid request origin.");
    if (message.method === "isEnabled") return result(await isConnected(origin));
    if (message.method === "enable") {
      const requested = message.params?.extensions ?? [];
      if (!Array.isArray(requested)) return error(-1, "Invalid extensions request.");
      const extensions = requested.filter(item => item?.cip === 95);
      if (!(await requestApproval(origin, extensions))) return error(-3, "User declined enablement.");
      await chrome.storage.local.set({ [connectionKey(origin)]: true });
      return result({ enabled: true, extensions });
    }
    if (!(await isConnected(origin))) return error(-3, "Origin is not connected.");
    if (message.method === "getExtensions") return result(SUPPORTED_EXTENSIONS);
    return error(-2, `Prototype method is not implemented yet: ${message.method}`);
  };
  respond().then(sendResponse, cause => sendResponse(error(-2, cause?.message || String(cause))));
  return true;
});

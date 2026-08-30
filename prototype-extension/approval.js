const query = new URLSearchParams(location.search);
const approvalId = query.get("approvalId");
const kind = query.get("kind") || "connect";
const titles = {
  connect: "Connect Cardano wallet?",
  signTx: "Sign Cardano transaction?",
  signData: "Sign Cardano data?",
  "cip95.signData": "Sign with DRep key?",
};
document.querySelector("h1").textContent = titles[kind] || "Approve Cardano request?";
document.querySelector("#approve").textContent = kind === "connect" ? "Connect" : "Sign";
document.querySelector("#origin").textContent = query.get("origin") || "Unknown origin";
const extensions = JSON.parse(query.get("extensions") || "[]");
document.querySelector("#extensions").textContent = extensions.length ? extensions.map(item => `CIP-${item.cip}`).join(", ") : "None";
if (kind !== "connect") {
  document.querySelector("#approve").disabled = true;
  chrome.runtime.sendMessage({ type: "approval-details", approvalId }).then(response => {
    document.querySelector("#signing-details").hidden = false;
    if (!response?.result) {
      document.querySelector("#details").textContent = response?.error?.info || "Signing details could not be loaded.";
      return;
    }
    document.querySelector("#details").textContent = response.result;
    document.querySelector("#approve").disabled = false;
  });
}

async function decide(approved) {
  await chrome.runtime.sendMessage({ type: "approval-decision", approvalId, approved });
  window.close();
}

document.querySelector("#approve").addEventListener("click", () => decide(true));
document.querySelector("#reject").addEventListener("click", () => decide(false));

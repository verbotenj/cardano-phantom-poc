const query = new URLSearchParams(location.search);
const approvalId = query.get("approvalId");
document.querySelector("#origin").textContent = query.get("origin") || "Unknown origin";
const extensions = JSON.parse(query.get("extensions") || "[]");
document.querySelector("#extensions").textContent = extensions.length ? extensions.map(item => `CIP-${item.cip}`).join(", ") : "None";

async function decide(approved) {
  await chrome.runtime.sendMessage({ type: "approval-decision", approvalId, approved });
  window.close();
}

document.querySelector("#approve").addEventListener("click", () => decide(true));
document.querySelector("#reject").addEventListener("click", () => decide(false));

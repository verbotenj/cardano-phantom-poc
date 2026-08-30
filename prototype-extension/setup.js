document.querySelector("#save").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: "configure-wallet",
    mnemonic: document.querySelector("#mnemonic").value.trim(),
  });
  document.querySelector("#result").textContent = response?.error?.info || `Configured ${response.result.address}`;
});

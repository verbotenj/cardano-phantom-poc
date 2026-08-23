#!/usr/bin/env bash
# ==============================================================================
# LOCAL AUTOMATION: RUN CARDANO SDK BROWSER-SIMULATED E2E TEST (REAL ON-CHAIN TX)
# ==============================================================================
# This script automates starting the Local Gateway Proxy, executing the pure
# browser-simulated SDK transaction proof, and cleaning up the proxy process on exit.
# ==============================================================================

set -euo pipefail

# ANSI color codes
GREEN='\x1b[32m'
YELLOW='\x1b[33m'
RED='\x1b[31m'
CYAN='\x1b[36m'
NC='\x1b[0m' # No Color

echo -e "${GREEN}[*] Initializing Programmatic SDK Integration Workspace...${NC}"

# 1. Verify local environment file exists
if [ ! -f ".env.development" ]; then
    echo -e "${RED}[!] Error: Local environment configuration file '.env.development' not found!${NC}"
    echo -e "Please copy '.env.example' to '.env.development' and populate your keys first."
    exit 1
fi

# 2. Check if the SDK fork exists locally. If not (fresh clone), pull and bootstrap it!
SDK_FORK_PATH="./forks/phantom-connect-sdk"
if [ ! -f "${SDK_FORK_PATH}/package.json" ]; then
    echo -e "${YELLOW}[*] Portability Alert: SDK Fork directory '${SDK_FORK_PATH}' not found or uninitialized!${NC}"
    echo -e "${GREEN}[*] Autonomously cloning custom verbotenj/phantom-connect-sdk fork from GitHub...${NC}"

    # Clean up dirty empty directory if it exists
    rm -rf "${SDK_FORK_PATH}"
    mkdir -p ./forks
    git clone https://github.com/verbotenj/phantom-connect-sdk.git "${SDK_FORK_PATH}"

    # Apply on-the-fly TypeScript compilation fixes to the freshly cloned SDK files
    echo -e "${GREEN}[*] Applying on-the-fly DTS compile fixes and CIP-30 injections to cloned SDK files...${NC}"
    node -e "
    const fs = require('fs');
    const fileIndex = '${SDK_FORK_PATH}/packages/browser-injected-sdk/src/cardano/index.ts';
    if (fs.existsSync(fileIndex)) {
        let content = fs.readFileSync(fileIndex, 'utf8');
        content = content.replace('cardano: CardanoProvider;', 'cardano: import(\"./provider\").CardanoProvider;');
        fs.writeFileSync(fileIndex, content);
    }
    const fileProvider = '${SDK_FORK_PATH}/packages/browser-injected-sdk/src/cardano/provider.ts';
    if (fs.existsSync(fileProvider)) {
        let content = fs.readFileSync(fileProvider, 'utf8');
        if (!content.includes('declare let chrome')) {
            content = 'declare let chrome: any;\n' + content;
        }
        if (!content.includes('getUsedAddresses(): Promise<string[]>;')) {
            const searchStr = 'getChangeAddress(): Promise<string>;';
            const injectStr = '\n\n  getUsedAddresses(): Promise<string[]>;\n\n  getUnusedAddresses(): Promise<string[]>;';
            content = content.replace(searchStr, searchStr + injectStr);
        }
        if (!content.includes('getUsedAddresses: () =>')) {
            const searchStr = 'getChangeAddress: () => this._sendIPC<string>(\"getChangeAddress\"),';
            const injectStr = '\n      getUsedAddresses: () => this._sendIPC<string[]>(\"getUsedAddresses\"),\n      getUnusedAddresses: () => this._sendIPC<string[]>(\"getUnusedAddresses\"),';
            content = content.replace(searchStr, searchStr + injectStr);
        }
        fs.writeFileSync(fileProvider, content);
    }
    "

    echo -e "${GREEN}[*] Bootstrapping Corepack, installing yarn monorepo packages, and compiling...${NC}"
    (
        cd "${SDK_FORK_PATH}"
        corepack enable
        yarn install --immutable
        yarn build
    )
    echo -e "${GREEN}[+] SDK Fork prepared and compiled successfully!${NC}\n"
else
    echo -e "${GREEN}[*] SDK Fork found locally. Running fast local incremental build...${NC}"
    (
        cd "${SDK_FORK_PATH}"
        yarn build
    )
fi

# 3. Setup automated proxy background worker and cleanup hook
PROXY_PID=""

cleanup() {
    if [ -n "${PROXY_PID:-}" ]; then
        echo -e "\n${GREEN}[*] Cleaning up local environment: Terminating Gateway Proxy (PID: ${PROXY_PID})...${NC}"
        kill "${PROXY_PID}" 2>/dev/null || true
    fi
}

# Trap exit signals to ensure the background proxy is ALWAYS terminated on exit
trap cleanup EXIT INT TERM

# 3. Boot Local Gateway Proxy on port 8080 (handles cryptographic signTx)
echo -e "${GREEN}[*] Booting Local Gateway Proxy on port 8080...${NC}"
node tools/local-gateway-proxy.js &
PROXY_PID=$!

# Sleep for 3 seconds to allow the Express server to bind to port 8080
sleep 3

# 4. Execute the Browser-Simulated SDK On-Chain Transaction Proof
echo -e "\n${CYAN}======================================================================${NC}"
echo -e "${CYAN}[EXECUTION] Running Browser-Simulated SDK On-Chain Transaction Proof${NC}"
echo -e "${CYAN}======================================================================${NC}"

npx tsx proofs/test_sdk_integration.ts

echo -e "\n${GREEN}[+] SDK-to-App On-Chain Transaction Proof successfully completed!${NC}"

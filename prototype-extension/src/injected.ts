import { CardanoProvider } from "@prototype/cardano-provider";

const cardano = window.cardano ?? {};
if (!cardano.phantomPrototype) {
  cardano.phantomPrototype = new CardanoProvider({ supportedExtensions: [{ cip: 95 }] });
  window.cardano = cardano;
}

declare global {
  interface Window {
    cardano?: Record<string, unknown>;
  }
}

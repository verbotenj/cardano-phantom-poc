import { CardanoProvider } from "@prototype/cardano-provider";

const PROTOTYPE_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%235b35b5'/%3E%3Cpath d='M18 20h28v8H28v8h18v8H28v10H18z' fill='white'/%3E%3C/svg%3E";

class PrototypeCardanoProvider extends CardanoProvider {
  public readonly name = "Cardano Prototype (Unofficial)";
  public readonly icon = PROTOTYPE_ICON;
}

const cardano = window.cardano ?? {};
if (!cardano.phantomPrototype) {
  cardano.phantomPrototype = new PrototypeCardanoProvider();
  window.cardano = cardano;
}

declare global {
  interface Window {
    cardano?: Record<string, unknown>;
  }
}

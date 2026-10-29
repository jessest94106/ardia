import { create } from "zustand";
import { useBrowser } from "../browser/store";

const store = () => useBrowser.getState();

export type NewTabCard = { id: number; tabId: string; count: number };

export const useNewTabCards = create<{ cards: Record<string, NewTabCard | null> }>()(() => ({ cards: {} }));

let cardSeq = 0;

export function showNewTabCard(windowId: string, tabId: string) {
  useNewTabCards.setState((s) => {
    const current = s.cards[windowId];
    const count = current ? current.count + 1 : 1;
    return { cards: { ...s.cards, [windowId]: { id: ++cardSeq, tabId, count } } };
  });
}

export function hideNewTabCard(windowId: string, id: number) {
  useNewTabCards.setState((s) => (s.cards[windowId]?.id === id ? { cards: { ...s.cards, [windowId]: null } } : s));
}

export function openNewTabCard(windowId: string, card: NewTabCard) {
  hideNewTabCard(windowId, card.id);
  if (store().tabs[card.tabId]) store().activate(card.tabId);
}

import { hostOf } from "@ardia/core";
import type { BrowserState } from "../browser/store";
import { siteName } from "../groups/groupNames";
import { depthOf, leaveGroups, reparent, withGroupsPlaced } from "../groups/groups";
import { splitOf } from "../splits/splits";
import { removeTabs } from "../tabs/tabs";
import { regroupRestored, restoreSnapshots } from "./closedTabs";
import { placing } from "./placing";
import { withGroup } from "./tabGrouping";
import type { ClosedTab, Tab, TabGroup } from "../browser/types";

export type TabTidyPlan = {
  closes: { tabId: string; keeperId: string }[];
  dissolve: string[];
  files: { tabId: string; groupId: string }[];
  newGroups: { tabIds: string[]; name: string }[];
};

export type TidiedTabs = {
  windowId: string;
  order: string[];
  created: string[];
  dissolved: TabGroup[];
  closed: ClosedTab[];
  files: { tabId: string; groupId: string }[];
  tabs: number;
  groups: number;
  duplicates: number;
};

type TidySource = Pick<BrowserState, "tabs" | "groups" | "windows" | "splits" | "settings">;

const knownSites = new Map<string, string>();

export function websiteOf(url: string): string {
  const known = knownSites.get(url);
  if (known !== undefined) return known;
  const site = /^https?:\/\//i.test(url) ? hostOf(url) : "";
  if (knownSites.size >= 4096) knownSites.clear();
  knownSites.set(url, site);
  return site;
}

function innermostGroups(groups: Record<string, TabGroup>, windowId: string): Map<string, TabGroup> {
  const deepest = new Map<string, { group: TabGroup; depth: number }>();
  for (const g of Object.values(groups)) {
    if (g.windowId !== windowId) continue;
    const depth = depthOf(groups, g.id);
    for (const id of g.tabIds) if ((deepest.get(id)?.depth ?? -1) < depth) deepest.set(id, { group: g, depth });
  }
  return new Map([...deepest].map(([id, { group }]) => [id, group]));
}

function add<K, V>(lists: Map<K, V[]>, key: K, value: V) {
  const list = lists.get(key);
  if (list) list.push(value);
  else lists.set(key, [value]);
}

function onlySite(sites: Map<string, string>, g: TabGroup): string {
  const seen = new Set(g.tabIds.map((id) => sites.get(id) ?? ""));
  const [site] = seen;
  return seen.size === 1 && site ? site : "";
}

export function tidyTabsPlan(s: TidySource, windowId: string, profileId?: string, named = true): TabTidyPlan | null {
  const w = s.windows[windowId];
  if (!w || w.incognito || w.kind === "small") return null;
  const profile = profileId ?? w.profileId;
  const regroup = s.settings.tidyTabsGroups === "regroup";
  const sites = new Map(w.tabIds.map((id) => [id, websiteOf(s.tabs[id]?.url ?? "")]));
  const own = Object.values(s.groups).filter((g) => g.windowId === w.id && g.profileId === profile && !g.pinned && g.tabIds.length);
  const parents = new Set(own.flatMap((g) => (g.parentId ? [g.parentId] : [])));
  const siteGroup = new Map<string, string>();
  const dissolve: string[] = [];
  for (const g of own) {
    const site = !g.parentId && !g.pinnedOpenerId && !parents.has(g.id) ? onlySite(sites, g) : "";
    if (site && !siteGroup.has(site)) siteGroup.set(site, g.id);
    else if (regroup) dissolve.push(g.id);
  }
  const dissolving = new Set(dissolve);
  const innermost = innermostGroups(s.groups, w.id);
  const loose = w.tabIds.flatMap((id) => {
    const t = s.tabs[id];
    const group = innermost.get(id);
    return t && t.profileId === profile && !t.pinned && (!group || dissolving.has(group.id)) && !splitOf(s, id) && sites.get(id) ? [t] : [];
  });
  const grouped = new Set(own.filter((g) => !dissolving.has(g.id)).map((g) => g.id));
  const closes = duplicatesOf(s, w.id, w.activeTabIds[profile], loose, new Set(siteGroup.values()), grouped, innermost, sites);
  const closing = new Set(closes.map((c) => c.tabId));
  const bySite = new Map<string, Tab[]>();
  for (const t of loose) if (!closing.has(t.id)) add(bySite, sites.get(t.id)!, t);
  const files: TabTidyPlan["files"] = [];
  const newGroups: TabTidyPlan["newGroups"] = [];
  for (const [site, same] of bySite) {
    const groupId = siteGroup.get(site);
    if (groupId) files.push(...same.map((t) => ({ tabId: t.id, groupId })));
    else if (same.length >= 2) newGroups.push({ tabIds: same.map((t) => t.id), name: named ? siteName(same.map((t) => ({ url: t.url, title: t.title }))) : "" });
  }
  return closes.length || dissolve.length || files.length || newGroups.length ? { closes, dissolve, files, newGroups } : null;
}

function duplicatesOf(
  s: TidySource,
  windowId: string,
  shown: string | undefined,
  loose: Tab[],
  keptGroups: Set<string>,
  groups: Set<string>,
  innermost: Map<string, TabGroup>,
  sites: Map<string, string>,
): TabTidyPlan["closes"] {
  const order = s.windows[windowId]!.tabIds;
  const closes: TabTidyPlan["closes"] = [];
  const closeExtra = (sets: Iterable<string[]>, closable: (id: string) => boolean) => {
    for (const ids of sets) {
      if (ids.length < 2) continue;
      const keeperId = ids.find((id) => id === shown) ?? ids.find((id) => !closable(id)) ?? ids[0]!;
      for (const id of ids) if (id !== keeperId && closable(id)) closes.push({ tabId: id, keeperId });
    }
  };
  const inGroup = new Map<string, string[]>();
  for (const id of order) {
    const t = s.tabs[id];
    const groupId = innermost.get(id)?.id;
    if (!t || !groupId || !groups.has(groupId) || splitOf(s, id) || !sites.get(id)) continue;
    add(inGroup, `${groupId}\n${t.url}`, id);
  }
  closeExtra(inGroup.values(), () => true);
  const closing = new Set(closes.map((c) => c.tabId));
  const tidied = new Set(loose.map((t) => t.id));
  const sameUrl = new Map<string, string[]>();
  for (const id of order) {
    const t = s.tabs[id];
    if (!t || closing.has(id) || !(tidied.has(id) || keptGroups.has(innermost.get(id)?.id ?? ""))) continue;
    add(sameUrl, t.url, id);
  }
  closeExtra(sameUrl.values(), (id) => tidied.has(id));
  return closes;
}

type Checked = { tabs: TidySource["tabs"]; groups: object; splits: object; window: object | undefined; mode: string; can: boolean };

const plans = new Map<string, Checked>();

function sameForTidy(before: TidySource["tabs"], now: TidySource["tabs"], tabIds: string[]): boolean {
  if (before === now) return true;
  for (const id of tabIds) {
    const a = before[id];
    const b = now[id];
    if (a === b) continue;
    if (!a || !b || a.url !== b.url || a.pinned !== b.pinned || a.profileId !== b.profileId || a.windowId !== b.windowId) return false;
  }
  return true;
}

export function canTidyTabs(s: TidySource, windowId: string, profileId?: string): boolean {
  const key = `${windowId}\n${profileId ?? ""}`;
  const window = s.windows[windowId];
  const mode = s.settings.tidyTabsGroups;
  const known = plans.get(key);
  if (known && known.groups === s.groups && known.splits === s.splits && known.window === window && known.mode === mode && sameForTidy(known.tabs, s.tabs, window?.tabIds ?? [])) {
    known.tabs = s.tabs;
    return known.can;
  }
  const can = !!tidyTabsPlan(s, windowId, profileId, false);
  plans.set(key, { tabs: s.tabs, groups: s.groups, splits: s.splits, window, mode, can });
  if (plans.size > 64) plans.delete(plans.keys().next().value!);
  return can;
}

function withoutGroups(s: BrowserState, windowId: string, ids: Set<string>): BrowserState {
  if (!ids.size) return s;
  const kept: Record<string, TabGroup> = {};
  for (const g of Object.values(s.groups)) if (!ids.has(g.id)) kept[g.id] = g;
  return withGroupsPlaced(s, windowId, reparent(kept, s.groups));
}

export function tidyingTabs(s: BrowserState, windowId: string, profileId?: string): [BrowserState, TidiedTabs | null] {
  const plan = tidyTabsPlan(s, windowId, profileId);
  const w = s.windows[windowId];
  if (!plan || !w) return [s, null];
  let next = s;
  let closed: ClosedTab[] = [];
  if (plan.closes.length) {
    const ids = new Set(plan.closes.map((c) => c.tabId));
    next = removeTabs(next, [...ids], true);
    closed = next.closedTabs.filter((c) => !s.closedTabs.includes(c) && !!c.tabId && ids.has(c.tabId));
  }
  next = withoutGroups(next, windowId, new Set(plan.dissolve));
  for (const f of plan.files) next = placing(next, [f.tabId], { pinned: false, groupId: f.groupId });
  const created: string[] = [];
  for (const g of plan.newGroups) {
    const [grouped, id] = withGroup(next, g.tabIds, { name: g.name });
    if (!id) continue;
    next = grouped;
    created.push(id);
  }
  const tabs = plan.files.length + plan.newGroups.reduce((n, g) => n + g.tabIds.length, 0);
  const groups = new Set(plan.files.map((f) => f.groupId)).size + created.length;
  const dissolved = plan.dissolve.map((id) => s.groups[id]!);
  return [next, { windowId, order: [...w.tabIds], created, dissolved, closed, files: plan.files, tabs, groups, duplicates: plan.closes.length }];
}

export function untidyingTabs(current: BrowserState, tidied: TidiedTabs): BrowserState {
  if (!current.windows[tidied.windowId]) return current;
  const gone = new Set(tidied.closed.map((c) => c.id));
  const back = tidied.closed.filter((e) => !current.tabs[e.tabId ?? ""]);
  const [withReopened, reopened] = restoreSnapshots(
    { ...current, closedTabs: current.closedTabs.filter((c) => !gone.has(c.id)) },
    tidied.windowId,
    back.map((e) => ({ tab: e.tab, tabId: e.restoreFrom ?? e.tabId, index: e.index })),
  );
  const renamed = new Map(back.flatMap((e, i) => (e.tabId && reopened[i] ? [[e.tabId, reopened[i]!] as const] : [])));
  const dissolvedIds = new Set(tidied.dissolved.map((g) => g.id));
  const rejoining = back.flatMap((e, i) => (e.group && !dissolvedIds.has(e.group.id) && reopened[i] ? [{ e, id: reopened[i]! }] : []));
  const s = regroupRestored(withReopened, tidied.windowId, rejoining.map((r) => r.e), rejoining.map((r) => r.id));
  const now = (id: string) => renamed.get(id) ?? id;
  const w = s.windows[tidied.windowId]!;
  const created = new Set(tidied.created);
  const kept: Record<string, TabGroup> = {};
  for (const g of Object.values(s.groups)) if (!created.has(g.id)) kept[g.id] = g;
  const filed = new Set(tidied.files.filter((f) => s.groups[f.groupId]?.tabIds.includes(f.tabId)).map((f) => f.tabId));
  let groups = leaveGroups(reparent(kept, s.groups), filed);
  const grouped = new Set(Object.values(groups).flatMap((g) => g.tabIds));
  const restored: Record<string, TabGroup> = {};
  for (const g of tidied.dissolved) {
    if (groups[g.id]) continue;
    const tabIds = g.tabIds.map(now).filter((id) => s.tabs[id]?.windowId === w.id && !grouped.has(id));
    if (tabIds.length) restored[g.id] = { ...g, tabIds };
  }
  groups = reparent({ ...groups, ...restored }, { ...s.groups, ...Object.fromEntries(tidied.dissolved.map((g) => [g.id, g])) });
  const order = tidied.order.map(now);
  const before = new Set(order);
  const present = new Set(w.tabIds);
  const tabIds = [...order.filter((id) => present.has(id)), ...w.tabIds.filter((id) => !before.has(id))];
  return withGroupsPlaced({ ...s, groups, windows: { ...s.windows, [w.id]: { ...w, tabIds } } }, w.id, groups);
}

import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { canTidyTabs, tidyTabsPlan, tidyingTabs, untidyingTabs, websiteOf } = await import("./tidyTabs.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const groupOf = (id) => Object.values(S().groups).find((g) => g.tabIds.includes(id));

function windowWith(...urls) {
  const w = S().createWindow({ url: "https://home.com/" });
  const ids = urls.map((url) => S().newTab(w, { url, background: true }));
  return { w, ids };
}

function tidy(w) {
  let done = null;
  useBrowser.setState((s) => {
    const [next, tidied] = tidyingTabs(s, w);
    done = tidied;
    return next;
  });
  return done;
}

const undo = (tidied) => useBrowser.setState((s) => untidyingTabs(s, tidied));

test("a website is its host without www, and only web pages have one", () => {
  assert.equal(websiteOf("https://www.youtube.com/watch?v=EwtcDviZg68"), "youtube.com");
  assert.equal(websiteOf("https://YouTube.com/"), "youtube.com");
  assert.equal(websiteOf("https://m.youtube.com/watch?v=1"), "m.youtube.com");
  assert.equal(websiteOf("https://www.youtube.com/@veritasium"), "youtube.com", "an @ in the path isn't a user name");
  assert.equal(websiteOf("https://user:pw@example.com:8080/a"), "example.com");
  assert.equal(websiteOf("http://[::1]:3000/"), "[::1]");
  assert.equal(websiteOf("http://docs.google.com/a"), "docs.google.com");
  assert.equal(websiteOf("chrome://newtab/"), "");
  assert.equal(websiteOf("file:///Users/me/a.html"), "");
  assert.equal(websiteOf(""), "");
});

test("loose tabs of one website gather in a group named for it; a website with one tab stays loose", () => {
  reset();
  const { w, ids: [y1, g1, y2, y3, solo] } = windowWith(
    "https://www.youtube.com/watch?v=EwtcDviZg68",
    "https://github.com/a",
    "https://www.youtube.com/watch?v=2",
    "https://youtube.com/@channel",
    "https://news.ycombinator.com/",
  );
  const g2 = S().newTab(w, { url: "https://github.com/b", background: true });
  assert.ok(canTidyTabs(S(), w));
  const done = tidy(w);
  const youtube = groupOf(y1);
  assert.deepEqual(youtube.tabIds, [y1, y2, y3]);
  assert.equal(youtube.pinned, false);
  assert.ok(youtube.name);
  assert.deepEqual(groupOf(g1).tabIds, [g1, g2]);
  assert.equal(groupOf(solo), undefined);
  assert.deepEqual(done, { ...done, created: [youtube.id, groupOf(g1).id], tabs: 5, groups: 2 });
  assert.equal(tidyTabsPlan(S(), w), null, "nothing left to tidy");
  assert.equal(canTidyTabs(S(), w), false);
});

test("a tab joins a group that already holds only its website, even alone", () => {
  reset();
  const { w, ids: [a, b, c] } = windowWith("https://github.com/a", "https://github.com/b", "https://github.com/c");
  const existing = S().createGroup([a, b], { name: "Code" });
  const done = tidy(w);
  assert.deepEqual(S().groups[existing].tabIds, [a, b, c]);
  assert.deepEqual(done.files, [{ tabId: c, groupId: existing }]);
  assert.deepEqual(done.created, []);
});

test("pinned tabs and tabs already in a group are left alone", () => {
  reset();
  const { w, ids: [pinned, grouped, other, loose1, loose2] } = windowWith(
    "https://github.com/p",
    "https://github.com/g",
    "https://example.com/",
    "https://github.com/1",
    "https://github.com/2",
  );
  S().pinTabs([pinned], true, true);
  const mixed = S().createGroup([grouped, other], { name: "Mixed" });
  tidy(w);
  assert.equal(S().tabs[pinned].pinned, true);
  assert.equal(groupOf(pinned), undefined);
  assert.deepEqual(S().groups[mixed].tabIds, [grouped, other], "a group of several websites isn't a website's group");
  assert.deepEqual(groupOf(loose1).tabIds, [loose1, loose2]);
});

test("Undo takes the new groups apart and puts every tab back in its place", () => {
  reset();
  const { w, ids: [y1, g1, y2, a, b] } = windowWith("https://www.youtube.com/1", "https://github.com/1", "https://www.youtube.com/2", "https://github.com/a", "https://github.com/b");
  const existing = S().createGroup([a, b], { name: "Code" });
  const order = [...S().windows[w].tabIds];
  const groupsBefore = Object.keys(S().groups).sort();
  const done = tidy(w);
  assert.notDeepEqual(S().windows[w].tabIds, order);
  undo(done);
  assert.deepEqual(S().windows[w].tabIds, order);
  assert.deepEqual(Object.keys(S().groups).sort(), groupsBefore);
  assert.deepEqual(S().groups[existing].tabIds, [a, b]);
  for (const id of [y1, g1, y2]) assert.equal(groupOf(id), undefined);
});

function regroupWindow() {
  reset();
  S().updateSettings({ tidyTabsGroups: "regroup" });
  const { w, ids } = windowWith(
    "https://www.youtube.com/1",
    "https://github.com/1",
    "https://news.ycombinator.com/",
    "https://github.com/2",
    "https://www.youtube.com/2",
    "https://example.com/pinned",
    "https://example.com/folder",
  );
  const [y1, g1, hn, g2, y2, pinned, folderTab] = ids;
  const mixed = S().createGroup([y1, g1, hn], { name: "Reading" });
  const code = S().createGroup([g2], { name: "Code", color: "green" });
  S().pinTabs([pinned], true, true);
  const folder = S().groupTabs([folderTab], { pinned: true, name: "Folder" });
  return { w, y1, g1, hn, g2, y2, pinned, folderTab, mixed, code, folder };
}

test("Ungroup and regroup: mixed groups come apart, a one-website group stays and takes its website's tabs", () => {
  const { w, y1, g1, hn, g2, y2, pinned, folderTab, mixed, code, folder } = regroupWindow();
  const done = tidy(w);
  assert.equal(S().groups[mixed], undefined, "the mixed group is gone");
  assert.deepEqual(done.dissolved.map((g) => g.id), [mixed]);
  assert.deepEqual(S().groups[code].tabIds, [g1, g2].sort((a, b) => S().windows[w].tabIds.indexOf(a) - S().windows[w].tabIds.indexOf(b)));
  assert.equal(S().groups[code].color, "green", "the kept group keeps its look");
  assert.deepEqual(groupOf(y1).tabIds.slice().sort(), [y1, y2].sort());
  assert.equal(groupOf(hn), undefined, "a website with one tab ends up loose");
  assert.equal(S().tabs[pinned].pinned, true);
  assert.deepEqual(S().groups[folder].tabIds, [folderTab], "pinned groups stay put");
  assert.equal(tidyTabsPlan(S(), w), null);
});

test("Ungroup and regroup: Undo brings the mixed group back with its name and tabs", () => {
  const { w, y1, g1, hn, g2, mixed, code } = regroupWindow();
  const order = [...S().windows[w].tabIds];
  const done = tidy(w);
  undo(done);
  assert.deepEqual(S().groups[mixed]?.tabIds, [y1, g1, hn]);
  assert.equal(S().groups[mixed].name, "Reading");
  assert.deepEqual(S().groups[code].tabIds, [g2]);
  assert.deepEqual(S().windows[w].tabIds, order);
});

test("the setting decides: Leave groups as they are never takes a group apart", () => {
  const { w, mixed } = regroupWindow();
  S().updateSettings({ tidyTabsGroups: "keep" });
  assert.deepEqual(tidyTabsPlan(S(), w)?.dissolve ?? [], []);
  tidy(w);
  assert.ok(S().groups[mixed], "the mixed group stays");
  S().updateSettings({ tidyTabsGroups: "regroup" });
  assert.equal(canTidyTabs(S(), w), true, "switching the setting makes the mixed group tidy-able");
});

const urls = (w) => S().windows[w].tabIds.map((id) => S().tabs[id].url);

test("tabs with exactly the same address close down to one; the highest stays, a different query or fragment isn't a duplicate", () => {
  reset();
  const { w, ids: [a1, b, a2, a3, query, fragment] } = windowWith(
    "https://www.youtube.com/watch?v=EwtcDviZg68",
    "https://github.com/a",
    "https://www.youtube.com/watch?v=EwtcDviZg68",
    "https://www.youtube.com/watch?v=EwtcDviZg68",
    "https://www.youtube.com/watch?v=other",
    "https://www.youtube.com/watch?v=EwtcDviZg68#t=30",
  );
  const done = tidy(w);
  assert.equal(done.duplicates, 2);
  assert.deepEqual(done.closed.map((c) => c.tabId).sort(), [a2, a3].sort());
  assert.equal(S().tabs[a2], undefined);
  assert.equal(S().tabs[a3], undefined);
  assert.deepEqual(groupOf(a1).tabIds, [a1, query, fragment]);
  assert.equal(groupOf(b), undefined);
});

test("the duplicate on screen is the one that stays", () => {
  reset();
  const { w, ids: [first, second] } = windowWith("https://github.com/a", "https://github.com/a");
  S().activate(second);
  const done = tidy(w);
  assert.deepEqual(done.closed.map((c) => c.tabId), [first]);
  assert.ok(S().tabs[second]);
});

test("a loose duplicate of a tab in a one-website group closes, the grouped one stays", () => {
  reset();
  const { w, ids: [grouped, other, loose] } = windowWith("https://github.com/a", "https://github.com/b", "https://github.com/a");
  const code = S().createGroup([grouped, other], { name: "Code" });
  const done = tidy(w);
  assert.deepEqual(done.closed.map((c) => c.tabId), [loose]);
  assert.deepEqual(S().groups[code].tabIds, [grouped, other]);
});

test("Undo reopens the closed duplicates in their places", () => {
  reset();
  const { w } = windowWith("https://github.com/a", "https://example.com/", "https://github.com/a", "https://github.com/b");
  const before = urls(w);
  const done = tidy(w);
  assert.equal(urls(w).length, before.length - 1);
  undo(done);
  assert.deepEqual(urls(w), before);
  assert.equal(Object.keys(S().groups).length, 0);
});

test("Ungroup and regroup: a duplicate inside a mixed group closes, and Undo puts it back in that group", () => {
  reset();
  S().updateSettings({ tidyTabsGroups: "regroup" });
  const { w, ids: [a1, b, a2] } = windowWith("https://github.com/a", "https://example.com/", "https://github.com/a");
  const mixed = S().createGroup([a1, b, a2], { name: "Reading" });
  const done = tidy(w);
  assert.equal(done.duplicates, 1);
  assert.equal(S().groups[mixed], undefined);
  undo(done);
  assert.deepEqual(S().groups[mixed].tabIds.map((id) => S().tabs[id].url), ["https://github.com/a", "https://example.com/", "https://github.com/a"]);
});

test("everything already grouped: a duplicate inside a group closes down to one, even with nothing else to tidy", () => {
  reset();
  const { w, ids: [a1, b, a2, c1, c2] } = windowWith("https://github.com/a", "https://example.com/", "https://github.com/a", "https://news.ycombinator.com/", "https://news.ycombinator.com/");
  const reading = S().createGroup([a1, b, a2], { name: "Reading" });
  const news = S().createGroup([c1, c2], { name: "News" });
  assert.equal(canTidyTabs(S(), w), true);
  const done = tidy(w);
  assert.deepEqual(done.closed.map((c) => c.tabId).sort(), [a2, c2].sort());
  assert.deepEqual(S().groups[reading].tabIds, [a1, b], "the mixed group stays, without its duplicate");
  assert.deepEqual(S().groups[news].tabIds, [c1]);
  assert.equal(done.tabs, 0);
});

test("the same page in two different groups is left alone", () => {
  reset();
  const { w, ids: [a1, b, a2, c] } = windowWith("https://github.com/a", "https://example.com/", "https://github.com/a", "https://news.ycombinator.com/");
  S().createGroup([a1, b], { name: "One" });
  S().createGroup([a2, c], { name: "Two" });
  assert.equal(tidyTabsPlan(S(), w), null);
});

test("a duplicate in a pinned group stays: bookmark folders are never touched", () => {
  reset();
  const { w, ids: [a1, a2] } = windowWith("https://github.com/a", "https://github.com/a");
  const folder = S().groupTabs([a1, a2], { pinned: true, name: "Folder" });
  assert.equal(tidyTabsPlan(S(), w), null);
  assert.equal(S().groups[folder].tabIds.length, 2);
});

test("Undo puts a duplicate closed inside a group back in that group", () => {
  reset();
  const { w, ids: [a1, b, a2] } = windowWith("https://github.com/a", "https://example.com/", "https://github.com/a");
  const reading = S().createGroup([a1, b, a2], { name: "Reading" });
  const before = urls(w);
  const done = tidy(w);
  undo(done);
  assert.deepEqual(urls(w), before);
  assert.deepEqual(S().groups[reading].tabIds.map((id) => S().tabs[id].url), ["https://github.com/a", "https://example.com/", "https://github.com/a"]);
});

test("nothing to tidy when every website has one tab", () => {
  reset();
  const { w } = windowWith("https://a.com/", "https://b.com/", "https://c.com/");
  assert.equal(tidyTabsPlan(S(), w), null);
  assert.equal(tidy(w), null);
});

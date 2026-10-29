import { useBrowser } from "../browser/store";
import { plural } from "../browser/model";
import { tidyingTabs, untidyingTabs, type TidiedTabs } from "../pins/tidyTabs";
import { showToast } from "../app/toasts";

export function tidyTabs(windowId: string, profileId?: string) {
  let tidied: TidiedTabs | null = null;
  useBrowser.setState((s) => {
    const [next, done] = tidyingTabs(s, windowId, profileId);
    tidied = done;
    return next;
  });
  const done = tidied as TidiedTabs | null;
  if (!done) return;
  const duplicates = done.duplicates ? `Closed ${plural(done.duplicates, "duplicate tab")}` : "";
  const ungrouped = done.dissolved.length ? `Ungrouped ${plural(done.dissolved.length, "mixed group")}` : "";
  const notes = [duplicates, ungrouped];
  const title = done.tabs ? `Tidied ${plural(done.tabs, "Tab")} into ${plural(done.groups, "Group")}` : notes.find(Boolean)!;
  const rest = done.tabs ? [...notes, "Grouped by website"] : notes.slice(notes.indexOf(title) + 1);
  const message = rest.filter(Boolean).join(" · ") || undefined;
  showToast(windowId, title, message, {
    icon: "sparkles",
    action: { title: "Undo", run: () => useBrowser.setState((s) => untidyingTabs(s, done)) },
  });
}

import { messageAge, projectIdentity } from "./model.mjs";
import { projectFolderView, type ProjectFolderMatch } from "./project-folders.ts";

const PROJECT = "[data-sidebar-sticky-project-item][data-sidebar-project-id]";
const MOUNT = "[data-tf-inbox-mount]";

export interface SidebarSnapshot {
  projects: readonly { id: string; name: string }[];
  attentionIds: ReadonlySet<string>;
  messageTimes?: ReadonlyMap<string, number | null>;
  now?: number;
  searching?: boolean;
  threadStates?: ReadonlyMap<string, "running" | "waiting">;
  pinnedProjectNames?: ReadonlyMap<string, string>;
  projectFolders?: ReadonlyMap<string, ProjectFolderMatch>;
}

/** Decorate BB's native list without moving any React-owned nodes. */
export function enhanceSidebar(doc: Document, onMounts: (nodes: HTMLElement[]) => void) {
  let snapshot: SidebarSnapshot = { projects: [], attentionIds: new Set() };
  let mounts: HTMLElement[] = [];
  const headers = new Set<HTMLElement>();
  const marks = new Map<HTMLElement, HTMLElement>();
  const groups = new Set<HTMLElement>();
  const hiddenRows = new Set<HTMLElement>();
  const ages = new Map<HTMLElement, HTMLElement>();
  const pinnedLabels = new Map<HTMLElement, HTMLElement>();
  const ageTitles = new Map<HTMLElement, { node: HTMLElement; previous: string | null; owned: string }>();
  const searchStacks = new Set<HTMLElement>();
  const folderView = projectFolderView(doc);
  let frame: number | null = null;
  let disposed = false;

  function removePinnedLabel(row: HTMLElement) {
    pinnedLabels.get(row)?.remove();
    pinnedLabels.delete(row);
    row.removeAttribute("data-tf-pinned-project");
  }

  function removeAge(row: HTMLElement) {
    ages.get(row)?.remove(); ages.delete(row);
    row.removeAttribute("data-tf-thread-row");
    row.removeAttribute("data-tf-run-state");
    const tooltip = ageTitles.get(row);
    if (tooltip && tooltip.node.getAttribute("title") === tooltip.owned) {
      if (tooltip.previous === null) tooltip.node.removeAttribute("title");
      else tooltip.node.setAttribute("title", tooltip.previous);
    }
    ageTitles.delete(row);
  }

  function refresh() {
    if (frame !== null) doc.defaultView!.cancelAnimationFrame(frame);
    frame = null;
    if (disposed) return;
    const nextMounts: HTMLElement[] = [];
    for (const stack of doc.querySelectorAll<HTMLElement>("[data-sidebar-sticky-stack]")) {
      const content = stack.querySelector<HTMLElement>('[data-sidebar="group-content"]');
      if (!content) continue;
      if (snapshot.searching) { stack.dataset.tfSearching = ""; searchStacks.add(stack); }
      else { stack.removeAttribute("data-tf-searching"); searchStacks.delete(stack); }
      let mount = mounts.find((node) => node.parentElement === content);
      if (!mount) {
        mount = doc.createElement("div");
        mount.dataset.tfInboxMount = "";
        mount.dataset.bbPlugin = "thread-focus";
      }
      if (content.firstElementChild !== mount) content.prepend(mount);
      nextMounts.push(mount);
    }
    for (const stack of searchStacks) if (!stack.isConnected) {
      stack.removeAttribute("data-tf-searching"); searchStacks.delete(stack);
    }
    for (const mount of mounts) if (!nextMounts.includes(mount)) mount.remove();
    if (nextMounts.length !== mounts.length || nextMounts.some((node, i) => node !== mounts[i])) {
      mounts = nextMounts;
      onMounts(mounts);
    }

    const names = new Map(snapshot.projects.map((project) => [project.id, project.name]));
    for (const group of doc.querySelectorAll<HTMLElement>(PROJECT)) {
      const header = group.querySelector<HTMLElement>('[data-sidebar="group-label"]');
      const name = names.get(group.dataset.sidebarProjectId ?? "");
      if (!header || !name) continue;
      const identity = projectIdentity(name);
      let mark = marks.get(header);
      if (!mark || mark.parentElement !== header) {
        mark?.remove();
        mark = doc.createElement("span");
        mark.className = "tf-project-mark";
        mark.setAttribute("aria-hidden", "true");
        header.prepend(mark);
        marks.set(header, mark);
      }
      if (mark.textContent !== identity.monogram) mark.textContent = identity.monogram;
      if (header.dataset.tfMonogram !== identity.monogram) header.dataset.tfMonogram = identity.monogram;
      if (header.style.getPropertyValue("--tf-hue") !== String(identity.hue)) {
        header.style.setProperty("--tf-hue", String(identity.hue));
      }
      group.dataset.tfProject = "";
      headers.add(header);
      groups.add(group);
    }
    folderView.update(snapshot.projectFolders ?? new Map());

    const nextHidden = new Set<HTMLElement>();
    const currentRows = new Set<HTMLElement>();
    for (const anchor of doc.querySelectorAll<HTMLElement>("[data-sidebar-sticky-stack] a[data-sidebar-thread-id]")) {
      if (anchor.closest(MOUNT)) continue;
      const id = anchor.dataset.sidebarThreadId ?? "";
      const row = anchor.closest<HTMLElement>("[data-sidebar-rename-row]");
      const leading = anchor.parentElement;
      if (!row || !leading) continue;
      currentRows.add(row);
      row.dataset.tfThreadRow = "";
      let age = ages.get(row);
      if (!age || age.parentElement !== leading) {
        removeAge(row);
        row.dataset.tfThreadRow = "";
        age = doc.createElement("span");
        age.className = "tf-thread-age";
        leading.prepend(age);
        ages.set(row, age);
        ageTitles.set(row, { node: leading, previous: leading.getAttribute("title"), owned: "" });
      }
      const display = messageAge(snapshot.messageTimes?.get(id), snapshot.now ?? Date.now());
      if (age.textContent !== display.text) age.textContent = display.text;
      if (age.title !== display.title) { age.title = display.title; age.setAttribute("aria-label", display.title); }
      // Let the native overlay anchor handle all pointer actions. Its parent
      // supplies the inherited tooltip, including over the passive age label.
      const tooltip = ageTitles.get(row)!;
      tooltip.owned = display.title;
      if (leading.title !== display.title) leading.title = display.title;
      const state = snapshot.threadStates?.get(id);
      if (state) row.dataset.tfRunState = state;
      else row.removeAttribute("data-tf-run-state");

      const projectName = snapshot.pinnedProjectNames?.get(id);
      const title = projectName && !row.closest(PROJECT) ? leading.querySelector<HTMLElement>(".bb-thread-title") : null;
      if (title && projectName) {
        let label = pinnedLabels.get(row);
        if (!label || label.parentElement !== title) {
          removePinnedLabel(row);
          label = doc.createElement("span");
          label.className = "tf-pinned-project-name";
          title.append(label);
          pinnedLabels.set(row, label);
          row.dataset.tfPinnedProject = "";
        }
        if (label.textContent !== projectName) label.textContent = projectName;
      } else if (pinnedLabels.has(row)) {
        removePinnedLabel(row);
      }
      if (mounts.length && snapshot.attentionIds.has(id)) {
        // Only hide the row itself; its native menus and handlers stay mounted.
        nextHidden.add(row);
      }
    }
    for (const row of ages.keys()) if (!currentRows.has(row)) removeAge(row);
    for (const row of pinnedLabels.keys()) if (!currentRows.has(row)) removePinnedLabel(row);
    for (const row of hiddenRows) if (!nextHidden.has(row)) {
      row.removeAttribute("data-tf-attention-source");
      hiddenRows.delete(row);
    }
    for (const row of nextHidden) {
      row.dataset.tfAttentionSource = "";
      hiddenRows.add(row);
    }
    // Prune detached rows after native filters or project collapse changes.
    for (const row of hiddenRows) if (!row.isConnected) {
      row.removeAttribute("data-tf-attention-source"); hiddenRows.delete(row);
    }
    for (const header of headers) if (!header.isConnected) {
      marks.get(header)?.remove(); marks.delete(header);
      header.removeAttribute("data-tf-monogram"); header.style.removeProperty("--tf-hue"); headers.delete(header);
    }
    for (const group of groups) if (!group.isConnected) {
      group.removeAttribute("data-tf-project"); groups.delete(group);
    }
  }

  function schedule() {
    if (!disposed && frame === null) frame = doc.defaultView!.requestAnimationFrame(refresh);
  }
  const observer = new doc.defaultView!.MutationObserver((records) => {
    if (records.some((record) => !(record.target instanceof doc.defaultView!.Element) || !record.target.closest(MOUNT))) schedule();
  });
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-sidebar-project-id"] });
  refresh();

  return {
    update(next: SidebarSnapshot) { snapshot = next; refresh(); },
    dispose() {
      disposed = true;
      observer.disconnect();
      if (frame !== null) doc.defaultView!.cancelAnimationFrame(frame);
      folderView.dispose();
      for (const header of headers) {
        marks.get(header)?.remove();
        header.removeAttribute("data-tf-monogram");
        header.style.removeProperty("--tf-hue");
      }
      for (const group of groups) group.removeAttribute("data-tf-project");
      for (const row of hiddenRows) row.removeAttribute("data-tf-attention-source");
      for (const row of ages.keys()) removeAge(row);
      for (const row of pinnedLabels.keys()) removePinnedLabel(row);
      for (const mount of mounts) mount.remove();
      for (const stack of searchStacks) stack.removeAttribute("data-tf-searching");
      searchStacks.clear();
      ages.clear(); marks.clear(); headers.clear(); groups.clear(); hiddenRows.clear(); mounts = [];
    },
  };
}

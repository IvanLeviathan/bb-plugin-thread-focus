import { projectIdentity } from "./model.mjs";

export interface ProjectFolderMember { project: string; label: string }
export interface ProjectFolder { name: string; members: ProjectFolderMember[] }
export interface ProjectFolderMatch { name: string; label: string }
export interface FolderProject { id: string; name: string; isPersonal?: boolean }

const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();

/** One folder per line: Folder | Project: label | Another project: label */
export function parseProjectFolders(value: string): ProjectFolder[] | null {
  const folders: ProjectFolder[] = [];
  const names = new Set<string>();
  const projects = new Set<string>();
  for (const line of value.split(/\r?\n/).filter(line => line.trim())) {
    const [name, ...entries] = line.split("|").map(field => field.trim());
    if (!name || entries.length < 1 || names.has(normalize(name))) return null;
    names.add(normalize(name));
    const members: ProjectFolderMember[] = [];
    for (const entry of entries) {
      const [project, label = "", ...extra] = entry.split(":").map(field => field.trim());
      if (!project || extra.length || projects.has(normalize(project))) return null;
      projects.add(normalize(project));
      members.push({ project, label });
    }
    folders.push({ name, members });
  }
  return folders;
}

export function findFolderProject(reference: string, projects: readonly FolderProject[]) {
  const key = normalize(reference);
  const available = projects.filter(project => !project.isPersonal);
  return available.find(project => project.id === key) ?? available.find(project => normalize(project.name) === key);
}

export function matchProjectFolders(value: unknown, projects: readonly FolderProject[]) {
  const matches = new Map<string, ProjectFolderMatch>();
  if (typeof value !== "string") return matches;
  for (const folder of parseProjectFolders(value) ?? []) {
    for (const member of folder.members) {
      const project = findFolderProject(member.project, projects);
      if (project && !matches.has(project.id)) matches.set(project.id, { name: folder.name, label: member.label });
    }
  }
  return matches;
}

const COLLAPSED_KEY = "thread-focus.collapsed-project-folders";

function readCollapsed(doc: Document): Set<string> {
  try {
    const value: unknown = JSON.parse(doc.defaultView?.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === "string"));
  } catch { /* Private browsing may block storage. */ }
  return new Set();
}

/** Keep BB's project and sortable nodes in place. CSS orders their presentation. */
export function projectFolderView(doc: Document) {
  const collapsed = readCollapsed(doc);
  const lists = new Set<HTMLElement>();
  const rows = new Set<HTMLElement>();
  const labels = new Map<HTMLElement, HTMLElement>();
  const buttons = new Map<HTMLElement, Map<string, HTMLButtonElement>>();
  let matches: ReadonlyMap<string, ProjectFolderMatch> = new Map();

  function removeRow(row: HTMLElement) {
    row.removeAttribute("data-tf-folder-row");
    row.removeAttribute("data-tf-folder-member");
    row.removeAttribute("data-tf-folder-hidden");
    row.style.removeProperty("--tf-folder-order");
    labels.get(row)?.remove();
    labels.delete(row);
  }

  function update(next: ReadonlyMap<string, ProjectFolderMatch>) {
    matches = next;
    const membersByList = new Map<HTMLElement, Map<HTMLElement, ProjectFolderMatch>>();
    if (matches.size) for (const row of doc.querySelectorAll<HTMLElement>('[data-sidebar-visibility-group^="project:"]')) {
      const match = matches.get(row.dataset.sidebarVisibilityGroup!.slice("project:".length));
      const list = row.parentElement;
      if (!match || !list || !row.querySelector("[data-sidebar-sticky-project-item]")) continue;
      if (!membersByList.has(list)) membersByList.set(list, new Map());
      membersByList.get(list)!.set(row, match);
    }
    const usedRows = new Set<HTMLElement>();
    for (const [list, members] of membersByList) {
      lists.add(list);
      list.dataset.tfProjectFolders = "";
      const children = Array.from(list.children).filter((child): child is HTMLElement => child instanceof doc.defaultView!.HTMLElement && !child.hasAttribute("data-tf-folder-heading"));
      const grouped = new Map<string, HTMLElement[]>();
      for (const [row, parent] of members) {
        if (!grouped.has(parent.name)) grouped.set(parent.name, []);
        grouped.get(parent.name)!.push(row);
      }

      const headings = buttons.get(list) ?? new Map();
      buttons.set(list, headings);
      for (const [name, button] of headings) if (!grouped.has(name)) { button.remove(); headings.delete(name); }
      const placed = new Set<string>();
      let order = 0;
      for (const row of children) {
        const parent = members.get(row);
        if (!parent) {
          if (row.hasAttribute("data-tf-folder-member")) removeRow(row);
          row.dataset.tfFolderRow = "";
          row.style.setProperty("--tf-folder-order", String(order++));
          usedRows.add(row);
          continue;
        }
        if (placed.has(parent.name)) continue;
        placed.add(parent.name);
        const groupRows = grouped.get(parent.name)!;
        let button = headings.get(parent.name);
        if (!button) {
          button = doc.createElement("button");
          button.type = "button";
          button.dataset.tfFolderHeading = "";
          const chevron = doc.createElement("span");
          chevron.className = "tf-folder-chevron";
          chevron.setAttribute("aria-hidden", "true");
          const mark = doc.createElement("span");
          const identity = projectIdentity(parent.name);
          mark.className = "tf-project-mark";
          mark.textContent = identity.monogram;
          mark.style.setProperty("--tf-hue", String(identity.hue));
          mark.setAttribute("aria-hidden", "true");
          const title = doc.createElement("span");
          title.className = "tf-folder-title";
          title.textContent = parent.name;
          button.append(mark, title, chevron);
          button.onclick = () => {
            const key = normalize(parent.name);
            if (collapsed.has(key)) collapsed.delete(key);
            else collapsed.add(key);
            try { doc.defaultView?.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); }
            catch { /* Keep the current window state even without storage. */ }
            update(matches);
          };
          headings.set(parent.name, button);
        }
        if (button.parentElement !== list || button.nextElementSibling !== row) list.insertBefore(button, row);
        const isCollapsed = collapsed.has(normalize(parent.name));
        button.setAttribute("aria-expanded", String(!isCollapsed));
        button.style.setProperty("--tf-folder-order", String(order++));
        for (const memberRow of groupRows) {
          usedRows.add(memberRow);
          memberRow.dataset.tfFolderMember = "";
          memberRow.style.setProperty("--tf-folder-order", String(order++));
          memberRow.toggleAttribute("data-tf-folder-hidden", isCollapsed);
          const alias = members.get(memberRow)!.label;
          const header = memberRow.querySelector('[data-sidebar-sticky-project-item] [data-sidebar="group-label"]');
          if (alias && header) {
            let label = labels.get(memberRow);
            if (!label || label.parentElement !== header) {
              label?.remove();
              label = doc.createElement("span");
              label.className = "tf-project-role";
              header.insertBefore(label, header.lastElementChild);
              labels.set(memberRow, label);
            }
            if (label.textContent !== alias) label.textContent = alias;
          } else if (labels.has(memberRow)) {
            labels.get(memberRow)?.remove();
            labels.delete(memberRow);
          }
        }
      }
    }
    for (const row of rows) if (!usedRows.has(row)) removeRow(row);
    rows.clear();
    for (const row of usedRows) rows.add(row);
    for (const list of lists) if (!membersByList.has(list)) {
      list.removeAttribute("data-tf-project-folders");
      for (const button of buttons.get(list)?.values() ?? []) button.remove();
      buttons.delete(list);
      lists.delete(list);
    }
  }

  return { update, dispose: () => update(new Map()) };
}

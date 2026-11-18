/** @param {string} name */
export function projectIdentity(name) {
  const normalized = name.normalize("NFKC").trim();
  const words = normalized.replace(/^https?:\/\//i, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // Prefer the project name over common environment prefixes and DNS suffixes.
  while (words.length > 1 && /^(dev\d*|www\d*|portal|staging|test)$/i.test(words[0])) words.shift();
  while (words.length > 1 && /^(ru|com|net|org|io|app|new)$/i.test(words.at(-1) ?? "")) words.pop();
  const monogram = words.length > 1
    ? Array.from(words[0])[0] + Array.from(words[1])[0]
    : Array.from(words[0] ?? "?").slice(0, 2).join("");
  let hash = 2166136261;
  for (const character of normalized.toLowerCase()) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16777619) >>> 0;
  }
  return { monogram: monogram.toUpperCase(), hue: hash % 360 };
}

/** @param {{ hasPendingInteraction: boolean, indicator: string, isHidden: boolean, isArchived: boolean }} thread */
export function needsUserAction(thread) {
  return !thread.isHidden && !thread.isArchived &&
    (thread.hasPendingInteraction || thread.indicator === "waiting-for-input");
}

/** @param {{hasPendingInteraction: boolean, indicator: string, isHidden: boolean, isArchived: boolean, status: string, runtimeStatus?: string}} thread
 * @returns {"running" | "waiting" | null} */
export function threadVisualState(thread) {
  if (needsUserAction(thread)) return "waiting";
  if (thread.isHidden || thread.isArchived || thread.runtimeStatus === "waiting-for-host" || thread.runtimeStatus === "provisioning") return null;
  if (["starting", "active", "stopping"].includes(thread.status) || ["background-agent", "background-command", "workflow"].includes(thread.indicator)) return "running";
  return null;
}

/** @param {{parentThreadId: string | null, isUnread: boolean, status: string, hasPendingInteraction: boolean, indicator: string, isHidden: boolean, isArchived: boolean}} thread
 * @returns {"success" | "error" | null} */
export function unreadCompletion(thread) {
  // Match BB's unread completion rule even if another indicator masks it.
  if (thread.isHidden || thread.isArchived || thread.parentThreadId !== null || !thread.isUnread || needsUserAction(thread)) return null;
  if (thread.status === "idle") return "success";
  if (thread.status === "error") return "error";
  return null;
}

/** @template {{ id: string, latestAttentionAt: number | null, updatedAt: number, parentThreadId: string | null, isUnread: boolean, status: string, hasPendingInteraction: boolean, indicator: string, isHidden: boolean, isArchived: boolean }} T
 * @param {readonly T[]} threads
 * @returns {T[]} */
export function attentionThreads(threads) {
  return threads.filter(thread => needsUserAction(thread) || unreadCompletion(thread)).sort((a, b) =>
    (b.latestAttentionAt ?? b.updatedAt) - (a.latestAttentionAt ?? a.updatedAt) || a.id.localeCompare(b.id));
}

/** @param {readonly {kind: string, role?: string, createdAt: number}[]} rows */
export function latestMessageTime(rows) {
  const times = rows.filter(row => row.kind === "conversation" && (row.role === "user" || row.role === "assistant"))
    .map(row => row.createdAt).filter(time => Number.isFinite(time) && time > 0);
  return times.length ? Math.max(...times) : null;
}

/** @param {number | null | undefined} timestamp @param {number} now */
export function messageAge(timestamp, now) {
  if (!timestamp || !Number.isFinite(timestamp)) return { text: "—", title: "Время последнего сообщения недоступно" };
  const elapsed = Math.max(0, now - timestamp);
  let text = "<1м";
  let relative = "менее минуты назад";
  if (elapsed >= 60_000) {
    const unit = elapsed < 3_600_000
      ? { size: 60_000, suffix: "м", forms: ["минуту", "минуты", "минут"] }
      : elapsed < 86_400_000
        ? { size: 3_600_000, suffix: "ч", forms: ["час", "часа", "часов"] }
        : { size: 86_400_000, suffix: "д", forms: ["день", "дня", "дней"] };
    const count = Math.floor(elapsed / unit.size);
    const remainder = count % 100;
    const form = remainder >= 11 && remainder <= 14 ? 2 : count % 10 === 1 ? 0 : count % 10 >= 2 && count % 10 <= 4 ? 1 : 2;
    text = `${count}${unit.suffix}`;
    relative = `${count} ${unit.forms[form]} назад`;
  }
  return { text, title: `Последнее сообщение: ${new Date(timestamp).toLocaleString("ru-RU")}, ${relative}` };
}

/** @param {string} value */
function searchText(value) {
  return value.normalize("NFKC").toLowerCase().replace(/ё/g, "е");
}

/** @template {{id: string, name: string, isPersonal?: boolean}} P
 * @template {{id: string, projectId: string, displayTitle: string, isHidden: boolean, isArchived: boolean}} T
 * @param {readonly P[]} projects @param {readonly T[]} threads @param {string} query
 * @param {ReadonlyMap<string, {name: string, label: string}>} [folders]
 * @returns {{project: P, threads: T[], projectMatched: boolean}[]} */
export function searchSidebar(projects, threads, query, folders) {
  const words = searchText(query).trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return [];
  const matches = (/** @type {string} */ text) => words.every(word => searchText(text).includes(word));
  const visible = threads.filter(thread => !thread.isHidden && !thread.isArchived);
  return projects.flatMap(project => {
    const name = project.isPersonal ? `${project.name} Личные треды` : project.name;
    const folder = folders?.get(project.id);
    const projectText = folder ? `${name} ${folder.name} ${folder.label}` : name;
    const projectMatched = matches(projectText);
    const found = visible.filter(thread => thread.projectId === project.id &&
      (projectMatched || matches(`${projectText} ${thread.displayTitle}`)));
    return projectMatched || found.length ? [{ project, threads: found, projectMatched }] : [];
  });
}

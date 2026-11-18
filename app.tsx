import "./app.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MouseEvent } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  useBbContext,
  useBbNavigate,
  useSdk,
  useSettings,
  experimental_usePluginId as usePluginId,
} from "@get-bb/plugin-sdk/app";
import { attentionThreads, messageAge, needsUserAction, projectIdentity, searchSidebar, threadVisualState, unreadCompletion } from "./model.mjs";
import { enhanceSidebar } from "./sidebar";
import { useMessageTimes } from "./use-message-times";
import { matchProjectFolders } from "./project-folders";
import { FolderSettingsChanged, ProjectFolderEditor, ProjectFolderEditorButton } from "./project-folder-editor";
import type { CSSProperties } from "react";

// Derive from the public hook so this stays aligned with the installed SDK.
type SidebarThread = ReturnType<typeof useSidebarThreads>["threads"][number];
type SidebarProject = ReturnType<typeof useSidebarThreads>["projects"][number];

function closeMobileSidebar() {
  if (document.querySelector('[data-sidebar="panel"][aria-modal="true"][data-state="open"]')) {
    document.querySelector<HTMLButtonElement>('[data-sidebar="trigger"][aria-expanded="true"]')?.click();
  }
}

function QuestionIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 11.5a9 9 0 0 1-9 9 10 10 0 0 1-4-.9L3 21l1.4-4.6A9 9 0 1 1 21 11.5Z" />
    <path d="M9.6 8.8a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 1.9-2.4 3.5M12 16h.01" />
  </svg>;
}

function AttentionRow({ thread, projectName, timestamp, now, onOpen, compact = false }: { thread: SidebarThread; projectName: string; timestamp: number | null | undefined; now: number; onOpen?: () => void; compact?: boolean }) {
  const navigate = useBbNavigate();
  const { threadId } = useBbContext();
  const age = messageAge(timestamp, now);
  const waiting = needsUserAction(thread);
  const completion = unreadCompletion(thread);
  const badge = waiting ? "waiting" : completion;
  const visualState = threadVisualState(thread);
  const waitingLabel = thread.indicator === "waiting-for-input" && thread.indicatorLabel || "Нужен ваш ответ или подтверждение";
  const label = waiting ? waitingLabel :
    completion === "success" ? "Готово · непрочитано" :
    completion === "error" ? "Завершилось с ошибкой · непрочитано" : "";
  const actionTarget = {
    ...thread,
    environment: thread.environment?.id ? { id: thread.environment.id, path: thread.environment.path } : null,
  };

  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // Preserve the native mobile drawer closing behavior when the source row
    // exists, including while our CSS lifts it out of the project group.
    const nativeAnchor = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[data-sidebar-thread-id]"))
      .find((anchor) => anchor.dataset.sidebarThreadId === thread.id && !anchor.closest("[data-tf-inbox-mount]"));
    if (nativeAnchor) nativeAnchor.click();
    else {
      // A collapsed project has no mounted native row to close its drawer.
      closeMobileSidebar();
      navigate.toThread(thread.id);
    }
    onOpen?.();
  }

  return <ThreadActionsContextMenu thread={actionTarget}>
    <div className="tf-attention-row" data-needs-input={waiting || undefined} data-active={threadId === thread.id || undefined}>
      <a className="tf-attention-link" href={thread.href} onClick={open}
        data-sidebar-thread-id={thread.id} data-sidebar-thread-shortcut-target=""
        aria-label={[thread.displayTitle, projectName, label].filter(Boolean).join(". ")}
        aria-current={threadId === thread.id ? "page" : undefined}>
        <span className="tf-thread-age" title={age.title} aria-label={age.title}>{age.text}</span>
        <span className="tf-attention-copy">
          <span className="tf-attention-title">{thread.displayTitle}</span>
          {!compact && <span className="tf-attention-project">{projectName}</span>}
        </span>
        {badge ?
          <span className="tf-status-badge" data-status={badge} title={label} aria-hidden="true">
            {badge === "success" ? <Icon name="Check" aria-hidden="true" /> : badge === "waiting" ? "?" : "×"}
          </span> : visualState === "running" &&
          <span className="tf-running-icon" title="Тред работает" role="img" aria-label="Тред работает">
            <span className="tf-running-spinner" aria-hidden="true" />
          </span>}
      </a>
      <ThreadActionsMenu thread={actionTarget} trigger={(props) =>
        <button {...props} className={[props.className, "tf-thread-menu"].filter(Boolean).join(" ")} aria-label={`Действия: ${thread.displayTitle}`}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
        </button>
      } />
    </div>
  </ThreadActionsContextMenu>;
}

function ProjectSearchLink({ project, count, environmentLabel, onOpen }: { project: SidebarProject; count: number; environmentLabel?: string; onOpen: () => void }) {
  const navigate = useBbNavigate();
  const identity = projectIdentity(project.name);
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    closeMobileSidebar();
    navigate.toProject(project.id);
    onOpen();
  }
  return <a className="tf-search-project" href={project.href} onClick={open} title={`Открыть проект ${project.name}`}>
    <span className="tf-project-mark" style={{ "--tf-hue": identity.hue } as CSSProperties} aria-hidden="true">{identity.monogram}</span>
    <span className="tf-search-project-name">{project.isPersonal ? "Личные треды" : project.name}</span>
    {environmentLabel && <span className="tf-project-role" title={environmentLabel}>{environmentLabel}</span>}
    <span className="tf-search-count" aria-label={`Тредов: ${count}`}>{count}</span>
  </a>;
}

function SearchField({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="tf-search-field">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
    <input ref={input} type="search" value={query} placeholder="Проекты и треды" aria-label="Поиск проектов и тредов"
      autoComplete="off" spellCheck={false} onChange={event => onChange(event.target.value)}
      onKeyDown={event => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); onChange(""); } }} />
    {query && <button className="tf-search-clear" type="button" aria-label="Очистить поиск" onClick={() => { onChange(""); input.current?.focus(); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m7 7 10 10M7 17 17 7"/></svg>
    </button>}
  </div>;
}

function SidebarEnhancements() {
  const { threads, projects } = useSidebarThreads();
  const { values, isLoading } = useSettings();
  const sdk = useSdk();
  const pluginId = usePluginId();
  const storedSetting = typeof values?.projectFolders === "string" ? values.projectFolders : "";
  const [recentSave, setRecentSave] = useState<{ previous: string; value: string } | null>(null);
  const folderSetting = recentSave?.previous === storedSetting ? recentSave.value : storedSetting;
  const [editorMount, setEditorMount] = useState<HTMLElement | null>(null);
  const projectFolders = useMemo(() => matchProjectFolders(folderSetting, projects), [folderSetting, projects]);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const results = searchSidebar(projects, threads, query, projectFolders);
  const [now, setNow] = useState(Date.now);
  const messageTimes = useMessageTimes(threads, now);
  const attention = attentionThreads(threads);
  const waiting = attention.filter(needsUserAction);
  const completed = attention.filter(unreadCompletion);
  const [mounts, setMounts] = useState<HTMLElement[]>([]);
  const controller = useRef<ReturnType<typeof enhanceSidebar> | null>(null);

  useEffect(() => {
    if (recentSave && recentSave.previous !== storedSetting) setRecentSave(null);
  }, [recentSave, storedSetting]);

  async function saveProjectFolders(value: string, previous: string) {
    const current = await sdk.plugins.getSettings({ pluginId });
    if ((current.values.projectFolders ?? "") !== previous) throw new FolderSettingsChanged();
    await sdk.plugins.updateSettings({ pluginId, values: { projectFolders: value } });
    setRecentSave({ previous: storedSetting, value });
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    const refresh = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);

  useEffect(() => {
    const instance = enhanceSidebar(document, setMounts);
    controller.current = instance;
    return () => { instance.dispose(); controller.current = null; };
  }, []);
  useEffect(() => {
    const threadStates = new Map<string, "running" | "waiting">();
    const projectNames = new Map(projects.filter(project => !project.isPersonal).map(project => [project.id, project.name]));
    const pinnedProjectNames = new Map<string, string>();
    for (const thread of threads) {
      const state = threadVisualState(thread);
      if (state) threadStates.set(thread.id, state);
      const projectName = projectNames.get(thread.projectId);
      if (thread.isPinned && projectName) pinnedProjectNames.set(thread.id, projectName);
    }
    controller.current?.update({ projects, attentionIds: new Set(attention.map((thread) => thread.id)), messageTimes, now, searching, threadStates, pinnedProjectNames, projectFolders });
  }, [threads, projects, messageTimes, now, searching, projectFolders]);

  const names = new Map(projects.map((project) => [project.id, project.isPersonal ? "Личные треды" : project.name]));
  return mounts.map((mount, index) => createPortal(
    <div className="tf-sidebar-tools" data-bb-plugin="thread-focus">
      <div className="tf-sidebar-toolbar">
        <SearchField query={query} onChange={setQuery} />
        {!isLoading && <ProjectFolderEditorButton onClick={() => setEditorMount(mount)} />}
      </div>
      {editorMount === mount && <ProjectFolderEditor value={folderSetting} projects={projects} onSave={saveProjectFolders} onDismiss={() => setEditorMount(null)} />}
      {searching ? <section className="tf-search-results" aria-label="Результаты поиска">
        {!results.length && <p className="tf-search-empty" role="status">Ничего не найдено</p>}
        {results.map(({ project, threads: found }) => <div className="tf-search-group" key={project.id}>
          <ProjectSearchLink
            project={project}
            count={found.length}
            environmentLabel={projectFolders.get(project.id)?.label}
            onOpen={() => setQuery("")}
          />
          {found.map(thread => <AttentionRow key={thread.id} thread={thread} projectName={names.get(project.id) ?? project.name} timestamp={messageTimes.get(thread.id)} now={now} onOpen={() => setQuery("")} compact />)}
          {!found.length && <p className="tf-search-empty">В проекте пока нет тредов</p>}
        </div>)}
      </section> : [
        { kind: "waiting", title: "Нужно ваше действие", countLabel: "Ожидают ответа", items: waiting },
        { kind: "completed", title: "Завершённые", countLabel: "Непрочитанных завершений", items: completed },
      ].map(({ kind, title, countLabel, items }) => items.length > 0 &&
        <section key={kind} className="tf-inbox" data-kind={kind} aria-label={title}>
          <div className="tf-inbox-heading">
            <span className="tf-heading-icon">{kind === "waiting" ? <QuestionIcon /> : <Icon name="Check" aria-hidden="true" />}</span>
            <span>{title}</span>
            <span className="tf-inbox-count" aria-label={`${countLabel}: ${items.length}`} role="status">{items.length}</span>
          </div>
          <div className="tf-inbox-rows">{items.map((thread) =>
            <AttentionRow key={thread.id} thread={thread} projectName={names.get(thread.projectId) ?? "Проект"} timestamp={messageTimes.get(thread.id)} now={now} />
          )}</div>
        </section>)}
    </div>, mount, String(index),
  ));
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "sidebar-enhancements", component: SidebarEnhancements });
});

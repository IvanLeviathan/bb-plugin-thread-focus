// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

let app: Awaited<ReturnType<typeof loadPluginApp>>;
let mounted: ReturnType<typeof renderSlot> | undefined;
beforeAll(async () => { app = await loadPluginApp(() => import("../app")); });
afterEach(() => { mounted?.lifecycle.unmount(); mounted = undefined; document.body.replaceChildren(); vi.useRealTimers(); });

function setup(hasSource = true) {
  document.body.innerHTML = `<div data-sidebar-sticky-stack><div data-sidebar="group-content"><div tabindex="-1"><div data-sidebar-project-id="p1" data-sidebar-sticky-project-item><div data-sidebar="group-label">Project one</div>${hasSource ? '<div data-sidebar-rename-row><a data-sidebar-thread-id="waiting" href="/projects/p1/threads/waiting">Native waiting row</a></div>' : ''}</div></div></div></div>`;
}

const waiting = {
  id: "waiting", projectId: "p1", title: "Review my change", titleFallback: null,
  displayTitle: "Review my change", parentThreadId: null, parentNotifications: "auto" as const,
  lifecycleOwnerThreadId: null, sourceThreadId: null, sectionId: null, originKind: null,
  originPluginId: null, providerId: "codex", status: "active" as const, runtimeStatus: "active" as const,
  queuedWork: "none" as const, hasPendingInteraction: true,
  activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0 },
  indicator: "waiting-for-input" as const, indicatorLabel: "Thread needs user input",
  isUnread: true, isPinned: false, pinnedAt: null, pinSortKey: null, isArchived: false,
  archivedAt: null, isHidden: false, href: "/projects/p1/threads/waiting", environment: null,
  host: null, latestAttentionAt: 25, lastReadAt: null, createdAt: 1, updatedAt: 25,
};
const projects = [{ id: "p1", name: "Project one", isPersonal: false, href: "/projects/p1", settingsHref: "/projects/p1/settings" }];

test("a native pinned project row shows its project name and removes the label on cleanup", async () => {
  setup(false);
  const list = document.querySelector('[data-sidebar="group-content"] > div')!;
  list.insertAdjacentHTML("afterbegin", `<div data-sidebar-rename-row><span><a data-sidebar-thread-id="waiting" href="/projects/p1/threads/waiting"></a><span class="bb-thread-title"><span>Review my change</span></span></span></div>`);
  const pinned = { ...waiting, isPinned: true, pinnedAt: 25, hasPendingInteraction: false, indicator: "none" as const, indicatorLabel: null };
  mounted = renderSlot(app.appOverlays[0]!, {}, { sidebarThreads: { threads: [pinned], projects } });
  const label = await screen.findByText("Project one", { selector: ".tf-pinned-project-name" });
  expect(label.previousElementSibling?.textContent).toBe("Review my change");
  expect(label.closest('[data-tf-pinned-project]')).toBeTruthy();
  mounted.lifecycle.unmount(); mounted = undefined;
  expect(list.querySelector('.tf-pinned-project-name, [data-tf-pinned-project]')).toBeNull();
  expect(list.querySelector('[data-sidebar-thread-id="waiting"]')?.getAttribute("href")).toBe(pinned.href);
});

test("overlay renders real inbox portal, source project, right status, and native menu; click uses native navigation", async () => {
  setup();
  const source = document.querySelector<HTMLAnchorElement>('a[data-sidebar-thread-id="waiting"]')!;
  let clicks = 0;
  source.addEventListener("click", e => { e.preventDefault(); clicks++; });
  mounted = renderSlot(app.appOverlays[0]!, {}, {
    sidebarThreads: { threads: [waiting], projects },
    sdk: { threads: { timeline: async () => ({ rows: [
      { kind: "conversation", role: "assistant", createdAt: Date.now() - 2 * 86400000 - 60_000 },
      { kind: "system", createdAt: Date.now() },
    ] }) } },
  });
  await screen.findByRole("region", { name: "Нужно ваше действие" });
  expect(document.querySelector('.tf-attention-project')?.textContent).toBe("Project one");
  await waitFor(() => expect(document.querySelector('.tf-attention-link .tf-thread-age')?.textContent).toBe("2д"));
  expect(source.parentElement?.querySelector('.tf-thread-age')?.textContent).toBe("2д");
  expect(document.querySelector('.tf-status-badge[data-status="waiting"]')?.getAttribute("title")).toBe("Thread needs user input");
  expect(screen.queryByRole("img", { name: "Тред работает" })).toBeNull();
  expect(screen.getByRole("button", { name: "Действия: Review my change" })).toBeTruthy();
  const link = screen.getByRole("link", { name: /Review my change/ });
  expect(link.getAttribute("href")).toBe(waiting.href);
  expect(source.closest('[data-tf-attention-source]')).toBeTruthy();
  fireEvent.click(link);
  expect(clicks).toBe(1);
  expect(mounted.inspection.navigateCalls).toEqual([]);
  mounted.lifecycle.unmount(); mounted = undefined;
  expect(document.querySelector('[data-tf-attention-source], [data-tf-inbox-mount], .tf-project-mark')).toBeNull();
});

test("a waiting thread inside a collapsed project can open through BB navigation", async () => {
  setup(false);
  const panel = document.createElement("div");
  panel.setAttribute("data-sidebar", "panel");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("data-state", "open");
  panel.append(document.body.firstElementChild!);
  const trigger = document.createElement("button");
  trigger.setAttribute("data-sidebar", "trigger");
  trigger.setAttribute("aria-expanded", "true");
  let drawerCloses = 0;
  trigger.addEventListener("click", () => drawerCloses++);
  document.body.append(panel, trigger);
  mounted = renderSlot(app.appOverlays[0]!, {}, { sidebarThreads: { threads: [waiting], projects } });
  fireEvent.click(await screen.findByRole("link", { name: /Review my change/ }));
  expect(drawerCloses).toBe(1);
  expect(mounted.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "waiting" }]);
});

test("after an answer the inbox is absent and native project rows remain visible", async () => {
  setup();
  mounted = renderSlot(app.appOverlays[0]!, {}, { sidebarThreads: { threads: [{ ...waiting, hasPendingInteraction: false, indicator: "none", indicatorLabel: null }], projects } });
  await waitFor(() => expect(document.querySelector('[data-tf-monogram]')).toBeTruthy());
  expect(screen.queryByRole("region", { name: "Нужно ваше действие" })).toBeNull();
  expect(document.querySelector('[data-tf-attention-source]')).toBeNull();
});

test("unread completions appear below questions and restore the native row on BB's read update", async () => {
  vi.useFakeTimers();
  setup();
  const root = document.querySelector('[data-sidebar-project-id="p1"]')!;
  root.insertAdjacentHTML("beforeend", `<div data-sidebar-rename-row><a data-sidebar-thread-id="completed" href="/projects/p1/threads/completed">Native completed row</a></div>`);
  const source = root.querySelector<HTMLAnchorElement>('a[data-sidebar-thread-id="completed"]')!;
  const completed = { ...waiting, id: "completed", displayTitle: "Finished work", href: "/projects/p1/threads/completed", status: "idle" as const, runtimeStatus: "idle" as const, hasPendingInteraction: false, indicator: "unread-success" as const, indicatorLabel: null };
  const threads = [waiting, completed];
  source.addEventListener("click", event => { event.preventDefault(); threads[1] = { ...completed, isUnread: false }; });
  mounted = renderSlot(app.appOverlays[0]!, {}, { sidebarThreads: { threads, projects } });
  await act(async () => {});
  expect(screen.getAllByRole("region").map(region => region.getAttribute("aria-label"))).toEqual(["Нужно ваше действие", "Завершённые"]);
  expect(source.closest('[data-tf-attention-source]')).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: /Finished work.*Готово/ }));
  expect(threads[1].isUnread).toBe(false);
  // Trigger the overlay's next render after changing the fake SDK snapshot.
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.queryByRole("region", { name: "Завершённые" })).toBeNull();
  expect(source.closest('[data-tf-attention-source]')).toBeNull();
  expect(screen.getByRole("region", { name: "Нужно ваше действие" })).toBeTruthy();
});

test("a running thread refreshes its last message each minute while keeping cached idle histories", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T20:00:00Z"));
  setup();
  const reads = new Map<string, number>();
  mounted = renderSlot(app.appOverlays[0]!, {}, {
    sidebarThreads: { threads: [waiting, { ...waiting, id: "idle", status: "idle", indicator: "none", hasPendingInteraction: false }], projects },
    sdk: { threads: { timeline: async ({ threadId }) => {
      reads.set(threadId, (reads.get(threadId) ?? 0) + 1);
      return { rows: [{ kind: "conversation", role: "assistant", createdAt: Date.now() }] };
    } } },
  });
  await act(async () => {});
  expect(reads.get("waiting")).toBe(1);
  expect(reads.get("idle")).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(reads.get("waiting")).toBe(2);
  expect(reads.get("idle")).toBe(1);
});

test("search reaches collapsed projects, filters thread titles, clears on Escape and navigates to projects or threads", async () => {
  setup(false);
  const invoice = { ...waiting, id: "invoice", displayTitle: "Обновить счёт", hasPendingInteraction: false, indicator: "none" as const, indicatorLabel: null };
  const contract = { ...invoice, id: "contract", displayTitle: "Договор" };
  mounted = renderSlot(app.appOverlays[0]!, {}, { sidebarThreads: { threads: [invoice, contract], projects } });
  const input = await screen.findByRole("searchbox", { name: "Поиск проектов и тредов" });
  fireEvent.change(input, { target: { value: "PROJECT ONE" } });
  expect(screen.getByRole("region", { name: "Результаты поиска" })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Обновить счёт/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Договор/ })).toBeTruthy();
  expect(document.querySelector('[data-tf-searching]')).toBeTruthy();
  fireEvent.change(input, { target: { value: "СЧЕТ" } });
  expect(screen.getByRole("link", { name: /Обновить счёт/ })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Тред работает" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Договор/ })).toBeNull();
  fireEvent.change(input, { target: { value: "does-not-exist" } });
  expect(screen.getByRole("status").textContent).toBe("Ничего не найдено");
  fireEvent.keyDown(input, { key: "Escape" });
  expect((input as HTMLInputElement).value).toBe("");
  expect(document.querySelector('[data-tf-searching]')).toBeNull();
  fireEvent.change(input, { target: { value: "Project one" } });
  fireEvent.click(screen.getByTitle("Открыть проект Project one"));
  expect(mounted.inspection.navigateCalls).toEqual([{ method: "toProject", projectId: "p1" }]);
  expect((input as HTMLInputElement).value).toBe("");
  fireEvent.change(input, { target: { value: "счёт" } });
  fireEvent.click(screen.getByRole("link", { name: /Обновить счёт/ }));
  expect(mounted.inspection.navigateCalls.at(-1)).toEqual({ method: "toThread", threadId: "invoice" });
  expect((input as HTMLInputElement).value).toBe("");
  fireEvent.change(input, { target: { value: "Договор" } });
  fireEvent.click(screen.getByRole("button", { name: "Очистить поиск" }));
  expect((input as HTMLInputElement).value).toBe("");
  expect(document.activeElement).toBe(input);
});

test("search results show the saved environment label on each project", async () => {
  setup(false);
  const prod = { ...projects[0], id: "p2", name: "Project two", href: "/projects/p2" };
  mounted = renderSlot(app.appOverlays[0]!, {}, {
    sidebarThreads: { threads: [], projects: [...projects, prod] },
    settings: { projectFolders: "Маяк | Project one: Dev | Project two: Prod" },
  });
  const input = await screen.findByRole("searchbox", { name: "Поиск проектов и тредов" });
  fireEvent.change(input, { target: { value: "Маяк" } });
  expect(screen.getByTitle("Открыть проект Project one").querySelector(".tf-project-role")?.textContent).toBe("Dev");
  expect(screen.getByTitle("Открыть проект Project two").querySelector(".tf-project-role")?.textContent).toBe("Prod");
});

test("group controls create, edit and dissolve only the plugin's project folders", async () => {
  setup(false);
  const prototype = HTMLDialogElement.prototype;
  const showModal = Object.getOwnPropertyDescriptor(prototype, "showModal");
  const close = Object.getOwnPropertyDescriptor(prototype, "close");
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
  });
  try {
    let saved = "";
    const updateSettings = vi.fn(async ({ values }) => {
      saved = values.projectFolders;
      return { values };
    });
    const deleteProject = vi.fn();
    const prod = { ...projects[0], id: "p2", name: "Project two", href: "/projects/p2" };
    mounted = renderSlot(app.appOverlays[0]!, {}, {
      sidebarThreads: { threads: [], projects: [...projects, prod] },
      settings: { projectFolders: "" },
      sdk: {
        plugins: { getSettings: async () => ({ values: { projectFolders: saved } }), updateSettings },
        projects: { delete: deleteProject },
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Управление группами проектов" }));
    fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));
    fireEvent.change(screen.getByLabelText("Название группы"), { target: { value: "Маяк" } });
    for (const id of ["p1", "p2"]) {
      fireEvent.change(screen.getByRole("combobox", { name: "Выберите проект" }), { target: { value: id } });
      fireEvent.click(screen.getByRole("button", { name: "Добавить проект" }));
    }
    fireEvent.change(screen.getByLabelText("Метка проекта Project one"), { target: { value: "Dev" } });
    fireEvent.change(screen.getByLabelText("Метка проекта Project two"), { target: { value: "Prod" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    fireEvent.click(await screen.findByRole("button", { name: "Редактировать группу Маяк" }));
    expect(saved).toBe("Маяк | p1: Dev | p2: Prod");
    fireEvent.click(screen.getByRole("button", { name: "Убрать проект Project one из группы" }));
    fireEvent.change(screen.getByLabelText("Название группы"), { target: { value: "Production" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    fireEvent.click(await screen.findByRole("button", { name: "Удалить группу Production" }));
    expect(saved).toBe("Production | p2: Prod");
    expect(updateSettings).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Удалить группу", exact: true }));
    await screen.findByText("Пока нет групп проектов.");
    expect(saved).toBe("");
    expect(deleteProject).not.toHaveBeenCalled();
  } finally {
    mounted?.lifecycle.unmount();
    mounted = undefined;
    for (const [name, descriptor] of [["showModal", showModal], ["close", close]] as const) {
      if (descriptor) Object.defineProperty(prototype, name, descriptor);
      else Reflect.deleteProperty(prototype, name);
    }
  }
});

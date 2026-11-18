import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { attentionThreads, needsUserAction, projectIdentity, latestMessageTime, messageAge, searchSidebar, threadVisualState, unreadCompletion } from "../model.mjs";
import { enhanceSidebar } from "../sidebar.ts";
import { matchProjectFolders, parseProjectFolders, projectFolderView } from "../project-folders.ts";

const thread = (id, patch = {}) => ({ id, parentThreadId: null, isUnread: false, status: "idle", hasPendingInteraction: false, indicator: "none", isHidden: false, isArchived: false, latestAttentionAt: null, updatedAt: 10, ...patch });

test("only questions and approvals require user action; running, unread and queued work do not", () => {
  for (const patch of [{ status: "active" }, { isUnread: true }, { queuedWork: "waiting" }, { runtimeStatus: "waiting-for-host" }]) {
    assert.equal(needsUserAction(thread("a", patch)), false);
  }
  assert.equal(needsUserAction(thread("a", { hasPendingInteraction: true })), true);
  assert.equal(needsUserAction(thread("a", { indicator: "waiting-for-input" })), true);
  assert.equal(needsUserAction(thread("a", { hasPendingInteraction: true, isHidden: true })), false);
  assert.equal(needsUserAction(thread("a", { hasPendingInteraction: true, isArchived: true })), false);
});

test("attention is global across projects, sorted by newest request and disappears after answering", () => {
  const rows = [thread("old", { projectId: "p1", hasPendingInteraction: true, latestAttentionAt: 4 }), thread("new", { projectId: "p2", hasPendingInteraction: true, latestAttentionAt: 20 }), thread("idle")];
  assert.deepEqual(attentionThreads(rows).map(t => t.id), ["new", "old"]);
  assert.deepEqual(rows.map(t => t.id), ["old", "new", "idle"]);
  rows[1].hasPendingInteraction = false;
  assert.deepEqual(attentionThreads(rows).map(t => t.id), ["old"]);
});

test("unread BB completions join attention and drop out when read, even when the completion glyph is masked", () => {
  const success = thread("done", { isUnread: true, indicator: "queued-failed", latestAttentionAt: 3 });
  const failed = thread("failed", { isUnread: true, status: "error", latestAttentionAt: 5 });
  const waiting = thread("wait", { ...failed, id: "wait", hasPendingInteraction: true, latestAttentionAt: 2 });
  const other = [thread("active", { isUnread: true, status: "active" }), thread("read", { indicator: "unread-success" }), thread("child", { isUnread: true, parentThreadId: "parent" }), thread("archived", { isUnread: true, isArchived: true }), thread("hidden", { isUnread: true, isHidden: true })];
  assert.equal(unreadCompletion(success), "success");
  assert.equal(unreadCompletion(failed), "error");
  assert.equal(unreadCompletion(waiting), null);
  assert.deepEqual(attentionThreads([success, failed, waiting, ...other]).map(t => t.id), ["failed", "done", "wait"]);
  success.isUnread = false;
  assert.deepEqual(attentionThreads([success, failed, waiting, ...other]).map(t => t.id), ["failed", "wait"]);
});

test("user input takes precedence over running, and host waits/unread/queued work stay neutral", () => {
  assert.equal(threadVisualState(thread("a", { status: "active", hasPendingInteraction: true })), "waiting");
  assert.equal(threadVisualState(thread("a", { status: "active" })), "running");
  assert.equal(threadVisualState(thread("a", { status: "idle", indicator: "background-command" })), "running");
  assert.equal(threadVisualState(thread("a", { status: "starting", runtimeStatus: "waiting-for-host" })), null);
  assert.equal(threadVisualState(thread("a", { status: "starting", runtimeStatus: "provisioning" })), null);
  assert.equal(threadVisualState(thread("a", { status: "idle", isUnread: true, queuedWork: "waiting" })), null);
  assert.equal(threadVisualState(thread("a", { status: "active", isArchived: true })), null);
});

test("monograms identify project names, support Cyrillic, and keep deterministic colors", () => {
  assert.equal(projectIdentity("dev.example.com").monogram, "EX");
  assert.equal(projectIdentity("portal.example.org_new").monogram, "EX");
  assert.equal(projectIdentity("pool_server").monogram, "PS");
  assert.equal(projectIdentity("Мой проект").monogram, "МП");
  assert.equal(projectIdentity("   ").monogram, "?");
  assert.deepEqual(projectIdentity("Test project"), projectIdentity("Test project"));
  assert.notEqual(projectIdentity("project-a").hue, projectIdentity("project-b").hue);
});

function fixture() {
  return new JSDOM(`<body><div data-sidebar-sticky-stack><div data-sidebar="group-content"><div tabindex="-1"><div data-sidebar-sticky-project-item data-sidebar-project-id="p1"><div data-sidebar="group-label">Project one</div><div data-sidebar-rename-row><a data-sidebar-thread-id="wait" href="/threads/wait">Waiting</a></div><div data-sidebar-rename-row><a data-sidebar-thread-id="idle" href="/threads/idle">Idle</a></div></div></div></div></div></body>`, { pretendToBeVisual: true });
}

test("named project folders resolve by name or ID, validate input and make the folder searchable", () => {
  const projects = [{ id: "proj_dev", name: "test.slate.example.com" }, { id: "proj_prod", name: "portal.slate.example.com_new" }, { id: "proj_other", name: "Other" }];
  const setting = "Маяк | TEST.slate.example.com: Dev | proj_prod: Prod";
  assert.deepEqual([...matchProjectFolders(setting, projects)], [
    ["proj_dev", { name: "Маяк", label: "Dev" }], ["proj_prod", { name: "Маяк", label: "Prod" }],
  ]);
  const folders = matchProjectFolders(setting, projects);
  assert.deepEqual(searchSidebar(projects, [], "маяк", folders).map(result => result.project.id), ["proj_dev", "proj_prod"]);
  assert.deepEqual(searchSidebar(projects, [], "маяк prod", folders).map(result => result.project.id), ["proj_prod"]);
  assert.equal(parseProjectFolders("Маяк"), null);
  assert.deepEqual(parseProjectFolders("Маяк | test.slate.example.com: Dev"), [
    { name: "Маяк", members: [{ project: "test.slate.example.com", label: "Dev" }] },
  ]);
  assert.equal(parseProjectFolders("Маяк | Dev | DEV"), null);
  assert.deepEqual(parseProjectFolders(""), []);
});

test("project folder collapses and restores nonadjacent native project rows in place", () => {
  const markup = ["dev", "other", "prod"].map(id => `<div data-sidebar-visibility-group="project:${id}"><div data-sidebar-sticky-project-item><div data-sidebar="group-label"><span>${id}</span></div></div></div>`).join("");
  const dom = new JSDOM(`<body><div id="list">${markup}</div></body>`, { url: "https://bb.test" });
  const { document } = dom.window;
  const list = document.querySelector("#list");
  const [dev, other, prod] = list.children;
  const matches = new Map([["dev", { name: "Маяк", label: "Dev" }], ["prod", { name: "Маяк", label: "Prod" }]]);
  let view = projectFolderView(document);
  view.update(matches);
  const button = list.querySelector("button");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(prod.querySelector(".tf-project-role").textContent, "Prod");
  const order = row => Number(row.style.getPropertyValue("--tf-folder-order"));
  assert.ok(order(button) < order(dev) && order(dev) < order(prod) && order(prod) < order(other));
  assert.deepEqual([...list.querySelectorAll("[data-sidebar-visibility-group]")], [dev, other, prod]);
  button.click();
  assert.ok(dev.hasAttribute("data-tf-folder-hidden") && prod.hasAttribute("data-tf-folder-hidden"));
  assert.equal(other.hasAttribute("data-tf-folder-hidden"), false);
  view.dispose();
  view = projectFolderView(document);
  view.update(matches);
  assert.equal(list.querySelector("button").getAttribute("aria-expanded"), "false");
  list.querySelector("button").click();
  assert.equal(dev.hasAttribute("data-tf-folder-hidden"), false);
  view.dispose();
  assert.deepEqual([...list.children], [dev, other, prod]);
  assert.equal(list.querySelector(".tf-project-role, [data-tf-folder-member]"), null);
  dom.window.close();
});

test("search finds projects and their threads, handles case and ё, and excludes hidden/archived threads", () => {
  const projects = [{ id: "p1", name: "dev.Pebble.example.com" }, { id: "p2", name: "Маяк" }, { id: "empty", name: "Empty project" }, { id: "personal", name: "Personal", isPersonal: true }];
  const rows = [thread("invoice", { projectId: "p1", displayTitle: "Обновить счёт" }), thread("contract", { projectId: "p1", displayTitle: "Договор" }), thread("integration", { projectId: "p2", displayTitle: "Настройка интеграции" }), thread("hidden", { projectId: "p1", displayTitle: "Скрытый счёт", isHidden: true }), thread("archived", { projectId: "p1", displayTitle: "Архивный счёт", isArchived: true })];
  assert.deepEqual(searchSidebar(projects, rows, "PEBBLE")[0].threads.map(t => t.id), ["invoice", "contract"]);
  assert.deepEqual(searchSidebar(projects, rows, "СЧЕТ")[0].threads.map(t => t.id), ["invoice"]);
  assert.equal(searchSidebar(projects, rows, "счет")[0].projectMatched, false);
  assert.deepEqual(searchSidebar(projects, rows, "маяк интеграции")[0].threads.map(t => t.id), ["integration"]);
  assert.equal(searchSidebar(projects, rows, "empty")[0].threads.length, 0);
  assert.equal(searchSidebar(projects, rows, "личные")[0].project.id, "personal");
  assert.deepEqual(searchSidebar(projects, rows, "   "), []);
  assert.deepEqual(searchSidebar(projects, rows, "<script>"), []);
});

test("search hides the native list temporarily without changing its nodes or collapsed state", () => {
  const dom = fixture(), doc = dom.window.document;
  const stack = doc.querySelector('[data-sidebar-sticky-stack]');
  const native = doc.querySelector('[tabindex="-1"]');
  const header = native.querySelector('[data-sidebar="group-label"]');
  header.setAttribute('aria-expanded', 'false');
  const controller = enhanceSidebar(doc, () => {});
  const snapshot = { projects: [{ id: "p1", name: "Project one" }], attentionIds: new Set() };
  controller.update({ ...snapshot, searching: true });
  assert.ok(stack.hasAttribute('data-tf-searching'));
  assert.equal(doc.querySelector('[tabindex="-1"]'), native);
  assert.equal(header.getAttribute('aria-expanded'), 'false');
  controller.update({ ...snapshot, searching: false });
  assert.equal(stack.hasAttribute('data-tf-searching'), false);
  controller.update({ ...snapshot, searching: true });
  controller.dispose();
  assert.equal(stack.hasAttribute('data-tf-searching'), false);
  assert.equal(doc.querySelector('[tabindex="-1"]'), native);
  dom.window.close();
});

test("message age uses conversation timestamps, excludes system events, and formats minutes, hours and days", () => {
  const now = Date.UTC(2026, 10, 17, 20);
  const lastMessage = now - 2 * 86400000 - 1000;
  assert.equal(latestMessageTime([
    { kind: "conversation", role: "user", createdAt: lastMessage - 1000 },
    { kind: "conversation", role: "assistant", createdAt: lastMessage },
    { kind: "work", createdAt: now }, { kind: "system", createdAt: now },
  ]), lastMessage);
  assert.equal(messageAge(lastMessage, now).text, "2д");
  assert.match(messageAge(lastMessage, now).title, /2 дня назад/);
  for (const [elapsed, label] of [[0, "<1м"], [59_999, "<1м"], [60_000, "1м"], [3_599_999, "59м"], [3_600_000, "1ч"], [86_399_999, "23ч"], [86_400_000, "1д"]]) {
    assert.equal(messageAge(now - elapsed, now).text, label);
  }
  assert.match(messageAge(now - 60_000, now).title, /1 минуту назад/);
  assert.match(messageAge(now - 11 * 3_600_000, now).title, /11 часов назад/);
  assert.equal(messageAge(now + 1000, now).text, "<1м");
  assert.equal(latestMessageTime([{ kind: "system", createdAt: now }]), null);
  assert.equal(messageAge(null, now).text, "—");
});

test("native rows get their own message ages and indentation, update in place, and clean up", () => {
  const dom = fixture(), doc = dom.window.document;
  const leading = doc.querySelector('[data-sidebar-thread-id="wait"]').parentElement;
  leading.title = "Native tooltip";
  const now = Date.UTC(2026, 10, 17, 20);
  const controller = enhanceSidebar(doc, () => {});
  const snapshot = { projects: [{ id: "p1", name: "Project one" }], attentionIds: new Set(), now,
    messageTimes: new Map([["wait", now - 5 * 86400000], ["idle", now - 86400000]]) };
  controller.update(snapshot);
  const row = doc.querySelector('[data-sidebar-thread-id="wait"]').closest('[data-sidebar-rename-row]');
  const badge = row.querySelector('.tf-thread-age');
  assert.ok(row.hasAttribute('data-tf-thread-row'));
  assert.equal(badge.textContent, "5д");
  assert.match(leading.title, /5 дней назад/);
  assert.equal(doc.querySelector('[data-sidebar-thread-id="idle"]').parentElement.querySelector('.tf-thread-age').textContent, "1д");
  controller.update({ ...snapshot, messageTimes: new Map([["wait", now], ["idle", null]]) });
  assert.equal(row.querySelector('.tf-thread-age'), badge);
  assert.equal(badge.textContent, "<1м");
  assert.equal(doc.querySelector('[data-sidebar-thread-id="idle"]').parentElement.querySelector('.tf-thread-age').textContent, "—");
  controller.dispose();
  assert.equal(leading.title, "Native tooltip");
  assert.equal(doc.querySelector('[data-tf-thread-row], .tf-thread-age'), null);
  dom.window.close();
});

test("native status colors follow running/waiting transitions and clean up on idle or disable", () => {
  const dom = fixture(), doc = dom.window.document;
  const controller = enhanceSidebar(doc, () => {});
  const snapshot = { projects: [{ id: "p1", name: "Project one" }], attentionIds: new Set() };
  const row = doc.querySelector('[data-sidebar-thread-id="wait"]').closest('[data-sidebar-rename-row]');
  controller.update({ ...snapshot, threadStates: new Map([["wait", "running"]]) });
  assert.equal(row.dataset.tfRunState, "running");
  controller.update({ ...snapshot, threadStates: new Map([["wait", "waiting"]]) });
  assert.equal(row.dataset.tfRunState, "waiting");
  controller.update(snapshot);
  assert.equal(row.hasAttribute('data-tf-run-state'), false);
  controller.update({ ...snapshot, threadStates: new Map([["wait", "running"]]) });
  controller.dispose();
  assert.equal(row.hasAttribute('data-tf-run-state'), false);
  dom.window.close();
});

test("inbox goes before native projects and source rows return when answered, without moving native nodes", () => {
  const dom = fixture(), doc = dom.window.document;
  const native = doc.querySelector('[data-sidebar-thread-id="wait"]');
  let mounts = [];
  const controller = enhanceSidebar(doc, nodes => mounts = nodes);
  controller.update({ projects: [{ id: "p1", name: "Project one" }], attentionIds: new Set(["wait"]) });
  assert.equal(mounts.length, 1);
  assert.equal(doc.querySelector('[data-sidebar="group-content"]').firstElementChild, mounts[0]);
  assert.equal(doc.querySelector('[data-tf-monogram]').dataset.tfMonogram, "PO");
  assert.equal(doc.querySelectorAll('[data-tf-attention-source]').length, 1);
  assert.ok(native.closest('[data-tf-attention-source]'));
  assert.equal(native.textContent, "Waiting");
  assert.equal(doc.querySelector('[data-sidebar-thread-id="idle"]').closest('[data-tf-attention-source]'), null);
  controller.update({ projects: [{ id: "p1", name: "Renamed project" }], attentionIds: new Set() });
  assert.equal(doc.querySelector('[data-tf-monogram]').dataset.tfMonogram, "RP");
  assert.equal(doc.querySelectorAll('[data-tf-attention-source]').length, 0);
  assert.equal(doc.querySelector('[data-sidebar-thread-id="wait"]'), native);
  controller.dispose();
  assert.equal(doc.querySelector('[data-tf-project], [data-tf-monogram], [data-tf-inbox-mount]'), null);
  assert.equal(doc.querySelector('[data-sidebar="group-label"]').style.getPropertyValue('--tf-hue'), "");
  dom.window.close();
});

test("observer handles sidebar remounts and stops after disposal", async () => {
  const dom = fixture(), doc = dom.window.document;
  let mounts = [];
  const controller = enhanceSidebar(doc, nodes => mounts = nodes);
  const snapshot = { projects: [{ id: "p1", name: "Project one" }], attentionIds: new Set(["wait"]) };
  controller.update(snapshot);
  const clone = doc.querySelector('[data-sidebar-sticky-stack]').cloneNode(true);
  clone.querySelector('[data-tf-inbox-mount]').remove();
  doc.body.replaceChildren(clone);
  await new Promise(resolve => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(resolve)));
  assert.equal(mounts.length, 1);
  assert.ok(mounts[0].isConnected);
  assert.equal(doc.querySelectorAll('[data-tf-inbox-mount]').length, 1);
  controller.dispose();
  doc.body.append(clone.cloneNode(true));
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  assert.equal(doc.querySelector('[data-tf-inbox-mount]'), null);
  dom.window.close();
});

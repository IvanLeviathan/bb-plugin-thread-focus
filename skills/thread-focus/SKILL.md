---
name: thread-focus
description: Project monograms and the automatic user-action inbox in BB's sidebar.
---

Thread Focus decorates the native Thread list plugin. It uses BB theme colors,
creates project monograms from project names, and lifts active, visible threads
with pending questions or approvals into “Нужно ваше действие” above all groups.
Answering the interaction restores the thread to its native list, including
Pinned if it is pinned. Pinned project threads show their project name under
the title. Pin and unpin use BB's native thread actions.

Unread successful and failed completions follow in “Завершённые” above the
native list, with the same root-thread completion rule as BB. Opening a thread
uses BB's read tracking. When it is read, its native row returns.

Running indicators are green; pending questions/approvals are yellow and take
precedence over running status. Search rows use the same states. Waiting for a
host, unread messages and queued work alone do not count as running/user input.

The search box above the list matches project names and thread titles, including
collapsed projects, case-insensitively with е/ё treated alike. Matching a project
lists its active visible threads; other queries retain only matching threads
under their project. It never changes collapse state. Clear with the button or
Escape; selecting a result also clears it. Search is local to the app window.

Thread rows are indented and show compact time since the last user/assistant message
instead of provider icons. The tooltip shows the exact date. Times come from
one deferred tail segment per thread revision (three requests at a time, cached),
not from thread.updatedAt or read receipts. Labels refresh every minute.
Labels use <1м below one minute, minutes below one hour, hours below one day,
and days after that (5м, 3ч, 2д).
Unknown timestamps show a dash. Provider icons are disabled via the native
Thread list showProviderIcons preference; disabling this plugin does not reset it.

The plugin uses public live sidebar data; it does not change threads, projects,
pinning, sorting preferences, or archived/hidden state. Native project headers,
collapse controls, and menus remain in place. Inbox rows use BB's thread menus.

The projectFolders setting adds collapsible sidebar groups. Each line uses
`Group | Project: Dev | Another project: Prod`. Projects can be referenced by
exact name or ID, and labels are optional. Group names and labels also match
the sidebar search. The collapsed state lives in each browser or app profile.
Edit in Settings → Installed plugins → Thread Focus, or with `bb plugin config`.
The folder button beside sidebar search opens the visual editor. It supports
creating, renaming and dissolving a group, updating project labels, and adding
or removing individual members through the project picker. These operations
change only the plugin setting and do not delete projects or threads.

Disable Thread Focus in
Settings → Plugins to restore the native list. It requires BB 0.49 with SDK
0.6.132 or newer and the native Thread list layout's sidebar DOM attributes.

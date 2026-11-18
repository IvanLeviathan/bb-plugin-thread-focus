import { useId, useLayoutEffect, useRef, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { findFolderProject, parseProjectFolders, type FolderProject, type ProjectFolder } from "./project-folders";

type EditorView = { kind: "list" }
  | { kind: "edit"; index: number | null; draft: ProjectFolder }
  | { kind: "delete"; index: number };

interface Props {
  value: string;
  projects: readonly FolderProject[];
  onSave: (value: string, previous: string) => Promise<void>;
  onDismiss: () => void;
}

export function ProjectFolderEditor({ value, projects, onSave, onDismiss }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [view, setView] = useState<EditorView>({ kind: "list" });
  const [baseline, setBaseline] = useState(value);
  const [newProject, setNewProject] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const folders = parseProjectFolders(baseline) ?? [];

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  function edit(index: number | null) {
    const folder = index === null ? { name: "", members: [] } : folders[index];
    setNewProject("");
    setError("");
    setView({ kind: "edit", index, draft: folder });
  }

  function back() {
    setView({ kind: "list" });
    setError("");
  }

  async function save(next: ProjectFolder[]) {
    const setting = next.map(folder => [folder.name.trim(), ...folder.members.map(member => {
      const label = member.label.trim();
      return label ? `${member.project}: ${label}` : member.project;
    })].join(" | ")).join("\n");
    if (setting.length > 8000 || parseProjectFolders(setting) === null) {
      setError("Не удалось сохранить группы. Проверьте названия, проекты и длину меток.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(setting, baseline);
      setBaseline(setting);
      back();
    } catch (failure) {
      setError(failure instanceof FolderSettingsChanged ? failure.message : "Не удалось сохранить изменения. Повторите попытку.");
    } finally {
      setSaving(false);
    }
  }

  const draft = view.kind === "edit" ? view.draft : null;
  const used = new Set(
    (view.kind === "edit" ? folders.filter((_, index) => index !== view.index) : folders)
      .flatMap(folder => folder.members).concat(draft?.members ?? [])
      .map(member => findFolderProject(member.project, projects)?.id ?? member.project),
  );
  const available = projects.filter(project => !project.isPersonal && !used.has(project.id));
  const deleting = view.kind === "delete" ? folders[view.index] : undefined;
  const title = view.kind === "edit" ? view.index === null ? "Новая группа" : "Редактирование группы" : "Группы проектов";

  return <dialog ref={dialog} className="tf-folder-dialog" aria-labelledby={titleId} onCancel={event => {
    event.preventDefault();
    event.stopPropagation();
    if (!saving) onDismiss();
  }}>
    <div className="tf-folder-dialog-header">
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="tf-folder-close" aria-label="Закрыть управление группами" onClick={onDismiss} disabled={saving}>×</button>
    </div>
    {view.kind === "list" && <>
      <button type="button" className="tf-folder-primary" onClick={() => edit(null)}>Создать группу</button>
      {folders.length === 0 && <p className="tf-folder-description">Пока нет групп проектов.</p>}
      <ul className="tf-folder-editor-list">
        {folders.map((folder, index) => <li key={folder.name} className="tf-folder-editor-card">
          <div className="tf-folder-editor-card-copy">
            <strong>{folder.name}</strong>
            <span>{folder.members.map(member => findFolderProject(member.project, projects)?.name ?? member.project).join(", ")}</span>
          </div>
          <div className="tf-folder-editor-actions">
            <button type="button" onClick={() => edit(index)} aria-label={`Редактировать группу ${folder.name}`}>Редактировать</button>
            <button type="button" className="tf-folder-danger" onClick={() => setView({ kind: "delete", index })} aria-label={`Удалить группу ${folder.name}`}>Удалить</button>
          </div>
        </li>)}
      </ul>
    </>}
    {view.kind === "edit" && <form onSubmit={event => {
      event.preventDefault();
      if (saving) return;
      if (!view.draft.name.trim() || /[|\r\n]/.test(view.draft.name)) {
        setError("Введите название группы без символа |.");
        return;
      }
      if (view.draft.members.length === 0) {
        setError("Добавьте хотя бы один проект или удалите группу.");
        return;
      }
      if (view.draft.members.some(member => /[:|\r\n]/.test(member.label))) {
        setError("Уберите из меток символы : и |.");
        return;
      }
      const next = view.index === null ? [...folders, view.draft] : folders.map((folder, index) => index === view.index ? view.draft : folder);
      void save(next);
    }}>
      <fieldset disabled={saving}>
        <label className="tf-folder-field">Название группы
          <input value={view.draft.name} onChange={event => setView({ ...view, draft: { ...view.draft, name: event.target.value } })} />
        </label>
        <ul className="tf-folder-editor-list">
          {view.draft.members.map((member, index) => {
            const name = findFolderProject(member.project, projects)?.name ?? member.project;
            return <li key={member.project} className="tf-folder-editor-card">
              <strong className="tf-folder-editor-card-copy">{name}</strong>
              <div className="tf-folder-editor-actions">
                <input className="tf-folder-label-input" aria-label={`Метка проекта ${name}`} placeholder="Метка" value={member.label}
                  onChange={event => setView({ ...view, draft: { ...view.draft, members: view.draft.members.map((item, i) => i === index ? { ...item, label: event.target.value } : item) } })} />
                <button type="button" onClick={() => setView({ ...view, draft: { ...view.draft, members: view.draft.members.filter((_, i) => i !== index) } })} aria-label={`Убрать проект ${name} из группы`}>Убрать</button>
              </div>
            </li>;
          })}
        </ul>
        <div className="tf-folder-editor-add">
          <select aria-label="Выберите проект" value={newProject} onChange={event => setNewProject(event.target.value)} disabled={!available.length}>
            <option value="">{available.length ? "Выберите проект" : "Нет свободных проектов"}</option>
            {available.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button type="button" disabled={!available.some(project => project.id === newProject)} onClick={() => {
            setView({ ...view, draft: { ...view.draft, members: [...view.draft.members, { project: newProject, label: "" }] } });
            setNewProject("");
          }}>Добавить проект</button>
        </div>
        <div className="tf-folder-editor-actions tf-folder-footer">
          <button type="button" onClick={back}>Отмена</button>
          <button type="submit" className="tf-folder-primary">{saving ? "Сохраняю…" : "Сохранить"}</button>
        </div>
      </fieldset>
    </form>}
    {view.kind === "delete" && deleting && <>
      <p className="tf-folder-description">Удалить группу «{deleting.name}»? Проекты из неё вернутся в общий список вместе со своими тредами.</p>
      <div className="tf-folder-editor-actions tf-folder-footer">
        <button type="button" onClick={back} disabled={saving}>Отмена</button>
        <button type="button" className="tf-folder-danger" disabled={saving} onClick={() => void save(folders.filter((_, index) => index !== view.index))}>
          {saving ? "Удаляю…" : "Удалить группу"}
        </button>
      </div>
    </>}
    {error && <p className="tf-folder-editor-error" role="alert">{error}</p>}
  </dialog>;
}

export class FolderSettingsChanged extends Error {
  constructor() {
    super("Группы изменились в другом окне. Закройте управление и откройте его снова.");
  }
}

export function ProjectFolderEditorButton({ onClick }: { onClick: () => void }) {
  return <button className="tf-folder-editor-trigger" type="button" aria-label="Управление группами проектов" title="Управление группами проектов" aria-haspopup="dialog" onClick={onClick}>
    <Icon name="Folder" aria-hidden="true" />
  </button>;
}

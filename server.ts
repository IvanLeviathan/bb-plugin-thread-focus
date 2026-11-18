import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { z } from "zod";
import { parseProjectFolders } from "./project-folders";

export default function threadFocus(bb: BbPluginApi) {
  bb.settings.define({
    projectFolders: {
      type: "string",
      label: "Группы проектов",
      description: "Одна группа на строку. Например: Портал | dev.example.com: Dev | portal.example.com: Prod. Метки после двоеточия можно опустить.",
      default: "",
      experimental_multiline: true,
      experimental_schema: z.string().max(8000).refine(
        value => parseProjectFolders(value) !== null,
        "Укажите название группы и хотя бы один проект через |. Названия групп и проекты не должны повторяться.",
      ),
    },
  });
}

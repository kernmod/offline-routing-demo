import * as FileSystem from "expo-file-system/legacy";
import { createDraftStore } from "./draftStore";

if (!FileSystem.documentDirectory) throw new Error("application_document_directory_unavailable");

/** Private application-sandbox storage; drafts are never sent to the API. */
export const mobileDraftStore = createDraftStore(
  FileSystem,
  `${FileSystem.documentDirectory}route-studio-draft.json`
);

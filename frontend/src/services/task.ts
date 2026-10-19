import { Task } from "../types";
import { apiFetch } from "./api";

export const getTask = async (
  task_id: string,
  signal?: AbortSignal
): Promise<Task> =>
  apiFetch<Task>(`/api/tasks/${task_id}`, {
    errorMessage: "Failed to fetch task",
    signal,
  });

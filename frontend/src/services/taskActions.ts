import { Task, TaskFailure, TaskType } from "../types";
import { apiFetch } from "./api";

export const getActiveTasks = async (signal?: AbortSignal): Promise<Task[]> =>
  apiFetch<Task[]>("/api/tasks/active", {
    errorMessage: "Failed to fetch active tasks",
    signal,
  });

export const startTask = async (type: TaskType): Promise<void> =>
  apiFetch<void>(`/api/tasks/${type}`, {
    method: "POST",
    errorMessage: `Failed to start task ${type}`,
  });

export const runProcessor = async (
  processorName: string,
  force = false
): Promise<Task> =>
  apiFetch<Task>(`/api/tasks/run_processor/${processorName}`, {
    method: "POST",
    query: { force },
    errorMessage: `Failed to start processor ${processorName}`,
  });

export const runProcessorsForMedia = async (
  mediaIds: number[],
  processorNames: string[]
): Promise<Task> =>
  apiFetch<Task>("/api/tasks/run_processors_for_media", {
    method: "POST",
    body: {
      media_ids: mediaIds,
      processor_names: processorNames,
    },
    errorMessage: "Failed to run processors for media",
  });

export const cancelTask = async (id: string): Promise<void> =>
  apiFetch<void>(`/api/tasks/${id}/cancel`, {
    method: "POST",
    errorMessage: `Failed to cancel task ${id}`,
  });

export const getTaskFailures = async (
  id: string,
  signal?: AbortSignal
): Promise<TaskFailure[]> =>
  apiFetch<TaskFailure[]>(`/api/tasks/${id}/failures`, {
    errorMessage: `Failed to fetch failures for task ${id}`,
    signal,
  });

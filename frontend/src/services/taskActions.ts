import { API } from "../config";
import { Task, TaskFailure, TaskType } from "../types";

export const getActiveTasks = async (): Promise<Task[]> => {
  const res = await fetch(`${API}/api/tasks/active`);
  if (!res.ok) throw new Error("Failed to fetch active tasks");
  return res.json();
};

export const startTask = async (type: TaskType): Promise<void> => {
  const res = await fetch(`${API}/api/tasks/${type}`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to start task ${type}`);
};

export const runProcessor = async (
  processorName: string,
  force = false
): Promise<Task> => {
  const url = `${API}/api/tasks/run_processor/${processorName}?force=${force}`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to start processor ${processorName}`);
  return res.json();
};

export const cancelTask = async (id: string): Promise<void> => {
  const res = await fetch(`${API}/api/tasks/${id}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to cancel task ${id}`);
};

export const getTaskFailures = async (id: string): Promise<TaskFailure[]> => {
  const res = await fetch(`${API}/api/tasks/${id}/failures`);
  if (!res.ok) throw new Error(`Failed to fetch failures for task ${id}`);
  return res.json();
};

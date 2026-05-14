import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getTask } from "./services/task";
import { getActiveTasks } from "./services/taskActions";
import { Task, TaskType } from "./types";

const INITIAL_COUNTERS: Record<TaskType, number> = {
  scan: 0,
  process_media: 0,
  clean_missing_files: 0,
  cluster_persons: 0,
  find_duplicates: 0,
  compute_blur_scores: 0,
  run_processor: 0,
  run_processor_for_media: 0,
  auto_tag_custom: 0,
};

type TaskEventsContextValue = {
  activeTasks: Task[];
  completionCounters: Record<TaskType, number>;
  globalCompletionCount: number;
  lastCompletedTasks: Partial<Record<TaskType, Task>>;
  forceRefresh: () => Promise<void>;
  subscribe: () => () => void;
};

const TaskEventsContext = createContext<TaskEventsContextValue | null>(null);

async function safeFetchTask(id: string): Promise<Task | null> {
  try {
    return await getTask(id);
  } catch (error) {
    console.warn("Failed to fetch task", id, error);
    return null;
  }
}

export function TaskEventsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeTasks, setActiveTasks] = useState<Task[]>([]);
  const [completionCounters, setCompletionCounters] =
    useState<Record<TaskType, number>>(INITIAL_COUNTERS);
  const [globalCompletionCount, setGlobalCompletionCount] = useState(0);
  const [lastCompletedTasks, setLastCompletedTasks] =
    useState<Partial<Record<TaskType, Task>>>({});

  const prevTasksRef = useRef<Record<string, Task>>({});
  const pendingFetchRef = useRef<Promise<void> | null>(null);
  const subscribersRef = useRef(0);
  const pollIntervalRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const applyFinishedTasks = useCallback(async (finished: Task[]) => {
    if (!finished.length) return;

    const resolved = await Promise.all(finished.map((task) => safeFetchTask(task.id)));
    const completedTasks = resolved.filter(
      (task): task is Task => Boolean(task && task.status === "completed")
    );

    if (!completedTasks.length || !isMountedRef.current) return;

    const completedTypes = completedTasks.map((task) => task.task_type as TaskType);

    setLastCompletedTasks((prev) => {
      const next = { ...prev };
      completedTasks.forEach((task) => {
        next[task.task_type as TaskType] = task;
      });
      return next;
    });

    setCompletionCounters((prev) => {
      const next: Record<TaskType, number> = { ...prev };
      completedTypes.forEach((type) => {
        next[type] = (next[type] ?? 0) + 1;
      });
      return next;
    });

    setGlobalCompletionCount((value) => value + completedTypes.length);
  }, []);

  const fetchTasks = useCallback(async () => {
    if (pendingFetchRef.current) {
      try {
        await pendingFetchRef.current;
      } catch {
        // Previous fetch error already logged; continue.
      }
    }

    const run = (async () => {
      try {
        const tasks = await getActiveTasks();
        if (!isMountedRef.current) return;

        setActiveTasks(tasks);

        const nextMap = tasks.reduce<Record<string, Task>>((acc, task) => {
          acc[task.id] = task;
          return acc;
        }, {});

        const prevMap = prevTasksRef.current;
        const finished = Object.values(prevMap).filter((task) => !nextMap[task.id]);
        prevTasksRef.current = nextMap;

        if (finished.length) {
          await applyFinishedTasks(finished);
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("Failed to poll active tasks", error);
        }
      }
    })();

    pendingFetchRef.current = run;
    try {
      await run;
    } finally {
      if (pendingFetchRef.current === run) {
        pendingFetchRef.current = null;
      }
    }
  }, [applyFinishedTasks]);

  const startPolling = useCallback(() => {
    if (typeof window === "undefined") return;
    if (pollIntervalRef.current !== null) return;
    fetchTasks();
    pollIntervalRef.current = window.setInterval(fetchTasks, 2000);
  }, [fetchTasks]);

  const stopPolling = useCallback(() => {
    if (typeof window === "undefined") return;
    if (pollIntervalRef.current !== null) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const subscribe = useCallback(() => {
    subscribersRef.current += 1;
    if (subscribersRef.current === 1) {
      startPolling();
    }
    return () => {
      subscribersRef.current = Math.max(0, subscribersRef.current - 1);
      if (subscribersRef.current === 0) {
        stopPolling();
      }
    };
  }, [startPolling, stopPolling]);

  useEffect(() => () => {
    stopPolling();
  }, [stopPolling]);

  const forceRefresh = useCallback(async () => {
    await fetchTasks();
  }, [fetchTasks]);

  const value = useMemo(
    () => ({
      activeTasks,
      completionCounters,
      globalCompletionCount,
      lastCompletedTasks,
      forceRefresh,
      subscribe,
    }),
    [
      activeTasks,
      completionCounters,
      globalCompletionCount,
      lastCompletedTasks,
      forceRefresh,
      subscribe,
    ]
  );

  return (
    <TaskEventsContext.Provider value={value}>
      {children}
    </TaskEventsContext.Provider>
  );
}

export function useTaskEvents(shouldSubscribe = true) {
  const ctx = useContext(TaskEventsContext);
  if (!ctx) {
    throw new Error("useTaskEvents must be used within a TaskEventsProvider");
  }
  const { subscribe, ...rest } = ctx;
  useEffect(() => {
    if (!shouldSubscribe) {
      return undefined;
    }
    const unsubscribe = subscribe();
    return unsubscribe;
  }, [subscribe, shouldSubscribe]);
  return rest;
}

export function useTaskCompletionVersion(taskTypes?: TaskType[]) {
  const { completionCounters, globalCompletionCount } = useTaskEvents();
  if (!taskTypes || taskTypes.length === 0) {
    return globalCompletionCount;
  }
  return taskTypes.reduce(
    (acc, type) => acc + (completionCounters[type] ?? 0),
    0
  );
}

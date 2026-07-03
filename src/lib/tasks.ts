import type { TaskListResponse, TeamTask } from "../vite-env";

export function normalizeTasksResponse(data: TaskListResponse | TeamTask[] | null | undefined): TaskListResponse {
  if (Array.isArray(data)) {
    return {
      tasks: data,
      total: data.length,
      limit: data.length,
      offset: 0,
      storeCap: 500,
      storeCount: data.length,
    };
  }
  return {
    tasks: data?.tasks || [],
    total: data?.total ?? data?.tasks?.length ?? 0,
    limit: data?.limit ?? data?.tasks?.length ?? 0,
    offset: data?.offset ?? 0,
    storeCap: data?.storeCap ?? 500,
    storeCount: data?.storeCount ?? data?.tasks?.length ?? 0,
  };
}

export async function fetchTeamTasks(options?: { limit?: number; offset?: number; status?: string }): Promise<TaskListResponse> {
  const data = await window.jarvis.getTasks(options);
  return normalizeTasksResponse(data as TaskListResponse | TeamTask[]);
}

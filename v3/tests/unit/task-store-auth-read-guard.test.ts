import { afterEach, describe, expect, it, vi } from "vitest";

type ErrorCallback = (error: { code: string | null }) => void;

const taskService = vi.hoisted(() => ({
  subscribeToTasks: vi.fn(
    (_projectId: string, _onTasks: (tasks: []) => void, onError: ErrorCallback) => {
      onError({ code: "unauthenticated" });
      return () => undefined;
    },
  ),
  getTasks: vi.fn(),
}));

vi.mock("../../src/services/taskService", () => taskService);
vi.mock("../../src/services/telemetryService", () => ({
  default: { firstTicketObserved: vi.fn() },
}));

const { useTaskStore } = await import("../../src/stores/taskStore");

afterEach(() => {
  useTaskStore.setState({
    tasks: [],
    loading: false,
    subscriptionError: null,
  });
  taskService.subscribeToTasks.mockClear();
});

describe("task board auth read guard", () => {
  it("does not convert an unauthenticated Firestore listener failure to an empty board", () => {
    const release = useTaskStore.getState().subscribeToTasks("project-1");

    expect(useTaskStore.getState()).toMatchObject({
      tasks: [],
      loading: false,
      subscriptionError: "AUTH_REQUIRED",
    });
    release();
  });
});

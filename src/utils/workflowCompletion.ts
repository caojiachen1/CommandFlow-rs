import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export const WORKFLOW_COMPLETED_EVENT = "commandflow:workflow-completed";
export const WORKFLOW_FAILED_EVENT = "commandflow:workflow-failed";

export interface WorkflowCompletedEventDetail {
  title?: string;
  body?: string;
}

export interface WorkflowFailedEventDetail {
  title?: string;
  body?: string;
}

export interface WorkflowCompletionContent {
  title: string;
  body: string;
}

declare global {
  interface WindowEventMap {
    "commandflow:workflow-completed": CustomEvent<WorkflowCompletedEventDetail>;
    "commandflow:workflow-failed": CustomEvent<WorkflowFailedEventDetail>;
  }
}

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

let notificationPermissionGranted: boolean | null = null;
let notificationPermissionRequest: Promise<boolean> | null = null;

export const toWorkflowCompletionContent = (
  detail?: WorkflowCompletedEventDetail,
): WorkflowCompletionContent => ({
  title: detail?.title?.trim() || "工作流执行完成",
  body: detail?.body?.trim() || "当前工作流已经执行完成。",
});

export const toWorkflowFailureContent = (
  detail?: WorkflowFailedEventDetail,
): WorkflowCompletionContent => ({
  title: detail?.title?.trim() || "工作流执行失败",
  body: detail?.body?.trim() || "当前工作流执行失败，请检查日志。",
});

const ensureNotificationPermission = async () => {
  if (!isTauriRuntime()) {
    return false;
  }

  if (notificationPermissionGranted !== null) {
    return notificationPermissionGranted;
  }

  if (notificationPermissionRequest) {
    return notificationPermissionRequest;
  }

  notificationPermissionRequest = (async () => {
    if (await isPermissionGranted()) {
      notificationPermissionGranted = true;
      return true;
    }

    const permission = await requestPermission();
    const granted = permission === "granted";
    notificationPermissionGranted = granted;
    return granted;
  })().finally(() => {
    notificationPermissionRequest = null;
  });

  return notificationPermissionRequest;
};

export const announceWorkflowCompleted = (
  detail?: WorkflowCompletedEventDetail,
) => {
  window.dispatchEvent(
    new CustomEvent<WorkflowCompletedEventDetail>(WORKFLOW_COMPLETED_EVENT, {
      detail,
    }),
  );
};

export const announceWorkflowFailed = (detail?: WorkflowFailedEventDetail) => {
  window.dispatchEvent(
    new CustomEvent<WorkflowFailedEventDetail>(WORKFLOW_FAILED_EVENT, {
      detail,
    }),
  );
};

export const sendWorkflowCompletionSystemNotification = async (
  detail?: WorkflowCompletedEventDetail,
) => {
  if (!(await ensureNotificationPermission())) {
    return false;
  }

  sendNotification(toWorkflowCompletionContent(detail));
  return true;
};

export const sendWorkflowFailureSystemNotification = async (
  detail?: WorkflowFailedEventDetail,
) => {
  if (!(await ensureNotificationPermission())) {
    return false;
  }

  sendNotification(toWorkflowFailureContent(detail));
  return true;
};

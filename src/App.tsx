import {
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ChangeEvent,
} from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import FlowEditor from "./components/FlowEditor";
import NodePanel from "./components/NodePanel";
import Toolbar from "./components/Toolbar";
import StatusBar from "./components/StatusBar";
import VariablePanel from "./components/VariablePanel";
import ExecutionLog from "./components/ExecutionLog";
import CoordinatePicker from "./components/CoordinatePicker";
import InputRecorderCompactPanel from "./components/InputRecorderCompactPanel";
import InputRecordingSettingsModal from "./components/InputRecordingSettingsModal";
import LlmSettingsModal from "./components/LlmSettingsModal";
import { useWorkflowStore } from "./stores/workflowStore";
import {
  useExecutionStore,
  type ExecutionLogItem,
} from "./stores/executionStore";
import {
  useSettingsStore,
  type InputRecordingOptions,
} from "./stores/settingsStore";
import { useShortcutBindings } from "./hooks/useShortcutBindings";
import { listen } from "@tauri-apps/api/event";
import {
  getCursorPosition,
  pickUiElement,
  pickCoordinate,
  playCompletionBeep,
  runWorkflow,
  setBackgroundMode,
  startInputRecording,
  stopInputRecording,
  stopWorkflow,
} from "./utils/execution";
import { getNodePortSpec } from "./utils/nodePorts";
import { getNodeMeta, getTriggerMode } from "./utils/nodeMeta";
import {
  announceWorkflowCompleted,
  sendWorkflowCompletionSystemNotification,
  sendWorkflowFailureSystemNotification,
  toWorkflowCompletionContent,
  toWorkflowFailureContent,
  WORKFLOW_COMPLETED_EVENT,
  WORKFLOW_FAILED_EVENT,
  type WorkflowCompletedEventDetail,
  type WorkflowFailedEventDetail,
} from "./utils/workflowCompletion";
import { toBackendGraph } from "./utils/workflowBridge";
import type { WorkflowFile, WorkflowNode } from "./types/workflow";

const RIGHT_PANE_RATIO_STORAGE_KEY =
  "commandflow.layout.right-pane-top-ratio.v1";

const menuGroups = {
  文件: ["新建", "打开", "保存", "另存为"],
  编辑: ["撤销", "重做", "复制", "粘贴"],
  视图: ["放大", "缩小", "重置缩放", "后台模式"],
  运行: ["运行", "停止", "单步", "拾取坐标", "提取元素"],
  设置: ["LLM 预设", "键鼠预设"],
  帮助: ["文档", "快捷键"],
};

interface StepRuntimeContext {
  variables: Map<string, unknown>;
  loopRemaining: Map<string, number>;
  whileIterations: Map<string, number>;
  loopStack: string[];
  startQueue: string[];
  pendingBranchQueue: string[];
}

function truncateParams(params: Record<string, unknown>, maxLen = 80): string {
  const truncated = Object.fromEntries(
    Object.entries(params).map(([k, v]) => {
      if (typeof v === "string" && v.length > maxLen) {
        return [k, `${v.slice(0, maxLen)}...`];
      }
      return [k, v];
    }),
  );
  return JSON.stringify(truncated);
}

type WorkflowNodeEventPayload = {
  node_id: string;
  node_kind: string;
  node_kind_key?: string;
  node_label: string;
  params: Record<string, unknown>;
};

type WorkflowNodeCompletedPayload = WorkflowNodeEventPayload & {
  outputs?: Record<string, unknown>;
  selected_control_output?: string | null;
};

const workflowNodeKinds = [
  "trigger",
  "uiaElement",
  "mouseOperation",
  "keyboardOperation",
  "inputPresetReplay",
  "screenshot",
  "windowActivate",
  "launchApplication",
  "fileOperation",
  "pythonCode",
  "clipboardRead",
  "clipboardWrite",
  "showMessage",
  "delay",
  "systemOperation",
  "guiAgent",
  "guiAgentActionParser",
  "condition",
  "loop",
  "whileLoop",
  "tryCatch",
  "imageMatch",
  "ocrMatch",
  "varDefine",
  "varSet",
  "varMath",
  "varGet",
  "constValue",
  "jsonExtract",
] as const satisfies ReadonlyArray<WorkflowNode["data"]["kind"]>;

const isWorkflowNodeKind = (
  value: unknown,
): value is WorkflowNode["data"]["kind"] =>
  typeof value === "string" &&
  (workflowNodeKinds as readonly string[]).includes(value);

const stringifyLogValue = (value: unknown, maxLen = 180) => {
  let serialized = "";

  if (typeof value === "string") {
    serialized = JSON.stringify(value);
  } else if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    serialized = String(value);
  } else if (typeof value === "undefined") {
    serialized = "undefined";
  } else {
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = "[不可序列化的值]";
    }
  }

  if (serialized.length <= maxLen) {
    return serialized;
  }

  return `${serialized.slice(0, maxLen)}...（已截断）`;
};

const buildNodeOutputLogMessage = (payload: WorkflowNodeCompletedPayload) => {
  const nodeId = payload.node_id;
  if (!nodeId) return null;

  const nodeKind = payload.node_kind ?? "Unknown";
  const nodeLabel = payload.node_label ?? "未命名节点";
  const params = payload.params ?? {};
  const outputs = payload.outputs ?? {};
  const selectedControlOutput = payload.selected_control_output ?? null;
  const nodeKindKey = isWorkflowNodeKind(payload.node_kind_key)
    ? payload.node_kind_key
    : null;

  const lines = nodeKindKey
    ? getNodePortSpec(nodeKindKey, params).outputs.map((port) => {
        const hasValue = Object.prototype.hasOwnProperty.call(outputs, port.id);
        const displayValue =
          port.valueType === "control"
            ? String(selectedControlOutput === port.id)
            : hasValue
              ? stringifyLogValue(outputs[port.id])
              : "未输出";
        return `- ${port.label ?? port.id} (${port.id}) = ${displayValue}`;
      })
    : (() => {
        const rawEntries = Object.entries(outputs);
        if (
          selectedControlOutput &&
          !rawEntries.some(([key]) => key === selectedControlOutput)
        ) {
          rawEntries.unshift([selectedControlOutput, true]);
        }
        return rawEntries.map(
          ([key, value]) => `- ${key} = ${stringifyLogValue(value)}`,
        );
      })();

  if (lines.length === 0) {
    return `节点输出：${nodeLabel} [${nodeKind}] id=${nodeId}\n- （该节点没有定义输出触点）`;
  }

  return `节点输出：${nodeLabel} [${nodeKind}] id=${nodeId}\n${lines.join("\n")}`;
};

const isTriggerNode = (node: WorkflowNode) => node.data.kind === "trigger";

const isManualTriggerNode = (node: WorkflowNode) =>
  node.data.kind === "trigger" && getTriggerMode(node.data.params) === "manual";

let completionAudioContext: AudioContext | null = null;

const getCompletionAudioContext = async () => {
  const AudioContextCtor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("AudioContext unavailable");
  }

  if (!completionAudioContext || completionAudioContext.state === "closed") {
    completionAudioContext = new AudioContextCtor();
  }

  if (completionAudioContext.state === "suspended") {
    await completionAudioContext.resume();
  }

  return completionAudioContext;
};

const playWorkflowCompletedTone = () => {
  void (async () => {
    try {
      await playCompletionBeep();
    } catch {
      // continue with web audio fallback
    }

    try {
      const audioContext = await getCompletionAudioContext();
      const now = audioContext.currentTime;

      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
      gain.connect(audioContext.destination);

      const oscA = audioContext.createOscillator();
      oscA.type = "sine";
      oscA.frequency.setValueAtTime(880, now);
      oscA.connect(gain);
      oscA.start(now);
      oscA.stop(now + 0.16);

      const oscB = audioContext.createOscillator();
      oscB.type = "triangle";
      oscB.frequency.setValueAtTime(1174, now + 0.18);
      oscB.connect(gain);
      oscB.start(now + 0.18);
      oscB.stop(now + 0.34);
    } catch {
      if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance("执行完成");
        utterance.lang = "zh-CN";
        utterance.rate = 1.1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }
    }
  })();
};

function App() {
  const {
    undo,
    redo,
    resetWorkflow,
    exportWorkflow,
    importWorkflow,
    copySelectedNode,
    pasteCopiedNode,
    selectedNodeId,
    nodes,
    edges,
    addNode,
    updateNodeParams,
    setSelectedNode,
    setRunningNode,
    clearRunningNodes,
    setCursor,
  } = useWorkflowStore();
  const { running, setRunning, addLog, setVariables, clearVariables } =
    useExecutionStore();
  const loadSecureLlmPresets = useSettingsStore(
    (state) => state.loadLlmPresets,
  );
  const loadSecureInputRecordingPresets = useSettingsStore(
    (state) => state.loadInputRecordingPresets,
  );
  const inputRecordingPresets = useSettingsStore(
    (state) => state.inputRecordingPresets,
  );
  const updateInputRecordingPreset = useSettingsStore(
    (state) => state.updateInputRecordingPreset,
  );
  const saveRecordedActionsToPreset = useSettingsStore(
    (state) => state.saveRecordedActionsToPreset,
  );
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [lastFileName, setLastFileName] = useState<string>("workflow.json");
  const [lastFilePath, setLastFilePath] = useState<string | null>(null);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [helpType, setHelpType] = useState<"docs" | "shortcuts">("docs");
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false);
  const [inputRecordingSettingsOpen, setInputRecordingSettingsOpen] =
    useState(false);
  const [backgroundMode, setBackgroundModeState] = useState(false);
  const [compactView, setCompactView] = useState<"background" | "recorder">(
    "background",
  );
  const [coordinatePicking, setCoordinatePicking] = useState(false);
  const [elementPicking, setElementPicking] = useState(false);
  const [activeInputRecordingPresetId, setActiveInputRecordingPresetId] =
    useState("");
  const [inputRecorderRecording, setInputRecorderRecording] = useState(false);
  const [inputRecorderOperationCount, setInputRecorderOperationCount] =
    useState(0);
  const [inputRecorderDraftOptions, setInputRecorderDraftOptions] =
    useState<InputRecordingOptions>({
      recordKeyboard: true,
      recordMouseClicks: true,
      recordMouseMoves: true,
    });
  const [inputRecorderLogs, setInputRecorderLogs] = useState<
    ExecutionLogItem[]
  >([
    {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: "info",
      message: "键鼠录制器已就绪，请先选择预设并开始录制。",
    },
  ]);
  const [rightPaneTopRatio, setRightPaneTopRatio] = useState(() => {
    try {
      const raw = localStorage.getItem(RIGHT_PANE_RATIO_STORAGE_KEY);
      if (!raw) return 0.34;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return 0.34;
      return Math.min(0.8, Math.max(0.2, parsed));
    } catch {
      return 0.34;
    }
  });
  const [isResizingRightPane, setIsResizingRightPane] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const continuousStepRunningRef = useRef(false);
  const continuousStepStopRef = useRef(false);
  const stepCtxRef = useRef<StepRuntimeContext>({
    variables: new Map(),
    loopRemaining: new Map(),
    whileIterations: new Map(),
    loopStack: [],
    startQueue: [],
    pendingBranchQueue: [],
  });
  const stepNextNodeIdRef = useRef<string | null>(null);
  const loopRoundRef = useRef<Map<string, number>>(new Map());
  const runSingleStepRef = useRef<() => Promise<void>>(async () => {});
  const addLogRef = useRef(addLog);
  const lastGlobalStepTriggerAtRef = useRef(0);
  const backgroundModeRef = useRef(false);
  const compactViewRef = useRef<"background" | "recorder">("background");
  const inputRecorderRecordingRef = useRef(false);
  const activeInputRecordingPresetIdRef = useRef("");

  const inputRecorderDraftOptionsRef = useRef<InputRecordingOptions>({
    recordKeyboard: true,
    recordMouseClicks: true,
    recordMouseMoves: true,
  });

  useShortcutBindings();

  const menu = useMemo(() => Object.entries(menuGroups), []);
  const isTauriRuntime = "__TAURI_INTERNALS__" in window;
  const activeInputRecordingPreset = useMemo(
    () =>
      inputRecordingPresets.find(
        (item) => item.id === activeInputRecordingPresetId,
      ) ?? null,
    [activeInputRecordingPresetId, inputRecordingPresets],
  );

  const addInputRecorderLog = useCallback(
    (level: ExecutionLogItem["level"], message: string) => {
      setInputRecorderLogs((state) =>
        [
          ...state,
          {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            level,
            message,
          },
        ].slice(-1000),
      );
    },
    [],
  );

  const enterCompactMode = useCallback(
    async (view: "background" | "recorder") => {
      setCompactView(view);
      compactViewRef.current = view;

      if (backgroundModeRef.current) {
        return true;
      }

      const previous = backgroundModeRef.current;
      backgroundModeRef.current = true;
      setBackgroundModeState(true);
      setHelpModalOpen(false);

      try {
        const message = await setBackgroundMode(true);
        addLog("info", message);
        return true;
      } catch (error) {
        backgroundModeRef.current = previous;
        setBackgroundModeState(previous);
        addLog("error", `切换紧凑窗口失败：${String(error)}`);
        return false;
      }
    },
    [addLog],
  );

  const exitCompactMode = useCallback(async () => {
    try {
      const message = await setBackgroundMode(false);
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      backgroundModeRef.current = false;
      setBackgroundModeState(false);
      setCompactView("background");
      compactViewRef.current = "background";
      addLog("info", message);
    } catch (error) {
      addLog("error", `切换紧凑窗口失败：${String(error)}`);
    }
  }, [addLog]);

  const stopInputRecorderSession = useCallback(async () => {
    if (!inputRecorderRecordingRef.current) {
      return;
    }

    try {
      const result = await stopInputRecording();
      setInputRecorderRecording(false);
      inputRecorderRecordingRef.current = false;
      setInputRecorderOperationCount(result.operationCount);

      const presetId = activeInputRecordingPresetIdRef.current;
      if (presetId) {
        saveRecordedActionsToPreset(presetId, result.actions, result.options);
        addInputRecorderLog(
          "success",
          `${result.message} 已自动保存到当前预设。`,
        );
      } else {
        addInputRecorderLog(
          "warn",
          `${result.message} 但当前没有可保存的预设。`,
        );
      }
    } catch (error) {
      addInputRecorderLog("error", `停止录制失败：${String(error)}`);
    }
  }, [addInputRecorderLog, saveRecordedActionsToPreset]);

  const startInputRecorderSession = useCallback(async () => {
    const presetId = activeInputRecordingPresetIdRef.current;
    if (!presetId) {
      addInputRecorderLog("warn", "请先在设置中选择一个键鼠预设。");
      return;
    }

    if (inputRecorderRecordingRef.current) {
      addInputRecorderLog("warn", "当前已经在录制中。");
      return;
    }

    updateInputRecordingPreset(presetId, {
      options: inputRecorderDraftOptionsRef.current,
    });

    setInputRecorderLogs([
      {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        level: "info",
        message: `已进入录制会话：${activeInputRecordingPreset?.name ?? "未命名预设"}`,
      },
    ]);
    setInputRecorderOperationCount(0);

    try {
      const message = await startInputRecording(
        inputRecorderDraftOptionsRef.current,
      );
      setInputRecorderRecording(true);
      inputRecorderRecordingRef.current = true;
      addInputRecorderLog("info", message);
    } catch (error) {
      addInputRecorderLog("error", `开始录制失败：${String(error)}`);
    }
  }, [
    activeInputRecordingPreset?.name,
    addInputRecorderLog,
    updateInputRecordingPreset,
  ]);

  const openInputRecorderMode = useCallback(
    async (presetId: string, options: InputRecordingOptions) => {
      setActiveInputRecordingPresetId(presetId);
      activeInputRecordingPresetIdRef.current = presetId;
      setInputRecorderDraftOptions(options);
      inputRecorderDraftOptionsRef.current = options;
      setInputRecordingSettingsOpen(false);
      setInputRecorderLogs([
        {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          level: "info",
          message: "已打开键鼠录制窗口，请点击“开始录制”或按 Scroll Lock。",
        },
      ]);
      setInputRecorderOperationCount(0);
      await enterCompactMode("recorder");
    },
    [enterCompactMode],
  );

  const exitInputRecorderMode = useCallback(async () => {
    if (inputRecorderRecordingRef.current) {
      await stopInputRecorderSession();
    }
    await exitCompactMode();
  }, [exitCompactMode, stopInputRecorderSession]);

  useEffect(() => {
    const handleWorkflowCompleted = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowCompletedEventDetail>)
        .detail;
      const content = toWorkflowCompletionContent(detail);

      playWorkflowCompletedTone();
      clearRunningNodes();
      void sendWorkflowCompletionSystemNotification(content);
    };

    const handleWorkflowFailed = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowFailedEventDetail>).detail;
      const content = toWorkflowFailureContent(detail);

      playWorkflowCompletedTone();
      clearRunningNodes();
      void sendWorkflowFailureSystemNotification(content);
    };

    window.addEventListener(WORKFLOW_COMPLETED_EVENT, handleWorkflowCompleted);
    window.addEventListener(WORKFLOW_FAILED_EVENT, handleWorkflowFailed);

    return () => {
      window.removeEventListener(
        WORKFLOW_COMPLETED_EVENT,
        handleWorkflowCompleted,
      );
      window.removeEventListener(WORKFLOW_FAILED_EVENT, handleWorkflowFailed);
    };
  }, [clearRunningNodes]);

  useEffect(() => {
    void loadSecureLlmPresets();
  }, [loadSecureLlmPresets]);

  useEffect(() => {
    void loadSecureInputRecordingPresets();
  }, [loadSecureInputRecordingPresets]);

  useEffect(() => {
    if (inputRecordingPresets.length === 0) {
      setActiveInputRecordingPresetId("");
      activeInputRecordingPresetIdRef.current = "";
      return;
    }

    const current =
      inputRecordingPresets.find(
        (item) => item.id === activeInputRecordingPresetIdRef.current,
      ) ?? inputRecordingPresets[0];
    setActiveInputRecordingPresetId(current.id);
    activeInputRecordingPresetIdRef.current = current.id;
    setInputRecorderDraftOptions(current.options);
    inputRecorderDraftOptionsRef.current = current.options;
  }, [inputRecordingPresets]);

  useEffect(() => {
    if (isTauriRuntime) {
      let disposed = false;
      let timer: number | null = null;

      const pollCursor = async () => {
        try {
          const point = await getCursorPosition();
          if (!disposed) {
            setCursor(point);
          }
        } catch {
          // ignore transient cursor polling failures
        } finally {
          if (!disposed) {
            timer = window.setTimeout(() => {
              void pollCursor();
            }, 80);
          }
        }
      };

      void pollCursor();

      return () => {
        disposed = true;
        if (timer !== null) {
          window.clearTimeout(timer);
        }
      };
    }

    const handleMouseMove = (event: MouseEvent) => {
      setCursor({
        x: Math.round(event.screenX),
        y: Math.round(event.screenY),
        isPhysicalPixel: false,
        mode: "virtualScreen",
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [isTauriRuntime, setCursor]);

  useEffect(() => {
    const handleCloseMenuOutside = (event: Event) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    };

    const handleWindowBlur = () => setActiveMenu(null);

    document.addEventListener("pointerdown", handleCloseMenuOutside);
    document.addEventListener("contextmenu", handleCloseMenuOutside);
    document.addEventListener("wheel", handleCloseMenuOutside, {
      passive: true,
    });
    document.addEventListener("keydown", handleCloseMenuOutside);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("pointerdown", handleCloseMenuOutside);
      document.removeEventListener("contextmenu", handleCloseMenuOutside);
      document.removeEventListener("wheel", handleCloseMenuOutside);
      document.removeEventListener("keydown", handleCloseMenuOutside);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (!isResizingRightPane) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const container = rightPaneRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const raw = (event.clientY - rect.top) / rect.height;
      let clamped = Math.min(0.8, Math.max(0.2, raw));

      // 增加 50% 位置的磁力吸附 (磁力阈值 2%)
      if (Math.abs(clamped - 0.5) < 0.02) {
        clamped = 0.5;
      }

      setRightPaneTopRatio(clamped);
    };

    const stopResizing = () => {
      setIsResizingRightPane(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizingRightPane]);

  useEffect(() => {
    try {
      localStorage.setItem(
        RIGHT_PANE_RATIO_STORAGE_KEY,
        String(rightPaneTopRatio),
      );
    } catch {
      // ignore storage failures
    }
  }, [rightPaneTopRatio]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let unlistenProgress: (() => void) | null = null;
    let unlistenNodeCompleted: (() => void) | null = null;
    let unlistenVariables: (() => void) | null = null;
    let unlistenLog: (() => void) | null = null;
    void listen<WorkflowNodeEventPayload>("workflow-node-started", (event) => {
      const nodeId = event.payload?.node_id;
      if (!nodeId) return;

      const nodeKind = event.payload?.node_kind ?? "Unknown";
      const nodeLabel = event.payload?.node_label ?? "未命名节点";
      const params = event.payload?.params ?? {};

      if (nodeKind === "Loop") {
        const currentRound = (loopRoundRef.current.get(nodeId) ?? 0) + 1;
        loopRoundRef.current.set(nodeId, currentRound);
        const timesRaw = params.times;
        const totalRounds =
          typeof timesRaw === "number"
            ? Math.max(0, Math.floor(timesRaw))
            : typeof timesRaw === "string"
              ? Math.max(0, Math.floor(Number(timesRaw) || 0))
              : 1;

        if (currentRound <= totalRounds) {
          addLog(
            "info",
            `执行节点：${nodeLabel} [for 循环]（第 ${currentRound}/${totalRounds} 轮） id=${nodeId} 参数=${truncateParams(params)}`,
          );
        } else {
          addLog(
            "info",
            `执行节点：${nodeLabel} [for 循环]（循环完成，进入 done 分支） id=${nodeId} 参数=${truncateParams(params)}`,
          );
          loopRoundRef.current.delete(nodeId);
        }
      } else {
        addLog(
          "info",
          `执行节点：${nodeLabel} [${nodeKind}] id=${nodeId} 参数=${truncateParams(params)}`,
        );
      }

      setRunningNode(nodeId);
      setSelectedNode(nodeId);
    })
      .then((cleanup) => {
        unlistenProgress = cleanup;
      })
      .catch((error) => {
        addLog("warn", `监听执行进度失败：${String(error)}`);
      });

    void listen<{ variables: Record<string, unknown> }>(
      "workflow-variables-updated",
      (event) => {
        const vars = event.payload?.variables ?? {};
        setVariables(vars);
        addLog("info", `变量快照：${JSON.stringify(vars)}`);
      },
    )
      .then((cleanup) => {
        unlistenVariables = cleanup;
      })
      .catch((error) => {
        addLog("warn", `监听变量更新失败：${String(error)}`);
      });

    void listen<WorkflowNodeCompletedPayload>(
      "workflow-node-completed",
      (event) => {
        const message = buildNodeOutputLogMessage(event.payload);
        if (!message) return;
        addLog("info", message);
      },
    )
      .then((cleanup) => {
        unlistenNodeCompleted = cleanup;
      })
      .catch((error) => {
        addLog("warn", `监听节点输出失败：${String(error)}`);
      });

    void listen<{ level: string; message: string }>("workflow-log", (event) => {
      const level = event.payload?.level;
      const message = event.payload?.message;
      if (!message) return;

      if (
        level === "info" ||
        level === "warn" ||
        level === "error" ||
        level === "success"
      ) {
        addLog(level, message);
        return;
      }

      addLog("info", message);
    })
      .then((cleanup) => {
        unlistenLog = cleanup;
      })
      .catch((error) => {
        addLog("warn", `监听执行日志失败：${String(error)}`);
      });

    return () => {
      unlistenProgress?.();
      unlistenNodeCompleted?.();
      unlistenVariables?.();
      unlistenLog?.();
      clearRunningNodes();
      loopRoundRef.current.clear();
    };
  }, [addLog, clearRunningNodes, setRunningNode, setSelectedNode, setVariables]);

  const handleFlowEditorPaneClick = useCallback(() => {
    setActiveMenu(null);
  }, []);

  const isWorkflowFile = (value: unknown): value is WorkflowFile => {
    if (!value || typeof value !== "object") return false;
    const file = value as Partial<WorkflowFile>;
    return (
      file.version === "1.0.0" &&
      !!file.graph &&
      typeof file.graph.id === "string" &&
      typeof file.graph.name === "string" &&
      Array.isArray(file.graph.nodes) &&
      Array.isArray(file.graph.edges)
    );
  };

  const applyBackgroundMode = useCallback(
    async (enabled: boolean) => {
      setActiveMenu(null);
      if (enabled) {
        await enterCompactMode("background");
        return;
      }
      await exitCompactMode();
    },
    [enterCompactMode, exitCompactMode],
  );

  const toggleBackgroundMode = useCallback(async () => {
    if (backgroundModeRef.current) {
      await applyBackgroundMode(false);
      return;
    }
    setCompactView("background");
    compactViewRef.current = "background";
    await applyBackgroundMode(true);
  }, [applyBackgroundMode]);

  const toDisplayFileName = (path: string) => {
    const segments = path.split(/[/\\]/);
    return segments[segments.length - 1] || "workflow.json";
  };

  const toWorkflowPayload = () => {
    const file = exportWorkflow();
    const requestedName = (lastFileName ?? `${file.graph.name}.json`).trim();
    const finalName = requestedName.toLowerCase().endsWith(".json")
      ? requestedName
      : `${requestedName}.json`;
    const payload = JSON.stringify(file, null, 2);
    return { payload, finalName };
  };

  const downloadWorkflow = (preferredName?: string) => {
    const file = exportWorkflow();
    const requestedName = (
      preferredName ??
      lastFileName ??
      `${file.graph.name}.json`
    ).trim();
    const finalName = requestedName.toLowerCase().endsWith(".json")
      ? requestedName
      : `${requestedName}.json`;

    const payload = JSON.stringify(file, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = finalName;
    anchor.click();
    URL.revokeObjectURL(url);

    setLastFileName(finalName);
    addLog("success", `已保存工作流：${finalName}`);
  };

  const openWorkflowFromSystemDialog = async () => {
    const selectedPath = await open({
      multiple: false,
      filters: [{ name: "CommandFlow Workflow", extensions: ["json"] }],
    });

    if (!selectedPath || Array.isArray(selectedPath)) return;

    try {
      const content = await readTextFile(selectedPath);
      const parsed: unknown = JSON.parse(content);

      if (!isWorkflowFile(parsed)) {
        throw new Error("文件格式不是有效的 CommandFlow 工作流 JSON。");
      }

      importWorkflow(parsed, toDisplayFileName(selectedPath));
      setLastFileName(toDisplayFileName(selectedPath));
      setLastFilePath(selectedPath);
      addLog("success", `已打开工作流：${toDisplayFileName(selectedPath)}`);
    } catch (error) {
      addLog("error", `打开失败：${String(error)}`);
    }
  };

  const saveWorkflowToSystemPath = async (path: string) => {
    const { payload } = toWorkflowPayload();
    await writeTextFile(path, payload);
    setLastFilePath(path);
    setLastFileName(toDisplayFileName(path));
    addLog("success", `已保存工作流：${toDisplayFileName(path)}`);
  };

  const saveWorkflowAsSystemDialog = async () => {
    const { payload, finalName } = toWorkflowPayload();
    const targetPath = await save({
      defaultPath: finalName,
      filters: [{ name: "CommandFlow Workflow", extensions: ["json"] }],
    });
    if (!targetPath) return;

    await writeTextFile(targetPath, payload);
    setLastFilePath(targetPath);
    setLastFileName(toDisplayFileName(targetPath));
    addLog("success", `已另存为：${toDisplayFileName(targetPath)}`);
  };

  const handleOpenFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const parsed: unknown = JSON.parse(content);

      if (!isWorkflowFile(parsed)) {
        throw new Error("文件格式不是有效的 CommandFlow 工作流 JSON。");
      }

      importWorkflow(parsed, file.name);
      setLastFileName(file.name);
      setLastFilePath(null);
      addLog("success", `已打开工作流：${file.name}`);
    } catch (error) {
      addLog("error", `打开失败：${String(error)}`);
    } finally {
      event.target.value = "";
    }
  };

  const runSingleStep = useCallback(async () => {
    if (running) {
      addLog("warn", "当前正在执行，请先停止后再进行单步。");
      return;
    }

    const resetStepSession = () => {
      stepNextNodeIdRef.current = null;
      clearRunningNodes();
      stepCtxRef.current = {
        variables: new Map(),
        loopRemaining: new Map(),
        whileIterations: new Map(),
        loopStack: [],
        startQueue: [],
        pendingBranchQueue: [],
      };
      loopRoundRef.current.clear();
    };

    const pickStepStartQueue = () => {
      if (nodes.length === 0) return [] as string[];

      const incomingCount = new Map<string, number>();
      for (const node of nodes) {
        incomingCount.set(node.id, 0);
      }
      for (const edge of edges) {
        incomingCount.set(
          edge.target,
          (incomingCount.get(edge.target) ?? 0) + 1,
        );
      }

      const manualTriggerStarts = nodes
        .filter(isManualTriggerNode)
        .map((node) => node.id);
      const autoTriggerStarts = nodes
        .filter((node) => isTriggerNode(node) && !isManualTriggerNode(node))
        .map((node) => node.id);

      if (manualTriggerStarts.length > 0) {
        return manualTriggerStarts;
      }

      if (autoTriggerStarts.length === 1) {
        return autoTriggerStarts;
      }

      if (autoTriggerStarts.length > 1) {
        addLog(
          "error",
          "工作流存在多个非手动触发器，单步执行要求仅有一个，或至少有一个手动触发器。",
        );
        return [];
      }

      const roots = nodes
        .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
        .map((node) => node.id);
      if (roots.length > 0) {
        return roots;
      }

      return [nodes[0].id];
    };

    let currentNodeId = stepNextNodeIdRef.current;

    if (!currentNodeId) {
      const startQueue = pickStepStartQueue();
      if (startQueue.length === 0) {
        addLog("warn", "当前工作流没有可执行节点。");
        return;
      }

      resetStepSession();
      clearVariables();
      stepCtxRef.current.startQueue = [...startQueue];
      currentNodeId = stepCtxRef.current.startQueue.shift() ?? null;

      if (!currentNodeId) {
        addLog("warn", "无法确定单步执行起点。");
        return;
      }

      const startNode = nodes.find((node) => node.id === currentNodeId);
      addLog("info", `单步调试开始：${startNode?.data.label ?? currentNodeId}`);
    }

    const currentNode = nodes.find((node) => node.id === currentNodeId);
    if (!currentNode) {
      resetStepSession();
      addLog("warn", "单步调试上下文已失效（节点不存在），请重新选择起点。");
      return;
    }

    setSelectedNode(currentNode.id);

    const workflowFile = exportWorkflow();
    const stepFile: WorkflowFile = {
      ...workflowFile,
      updatedAt: new Date().toISOString(),
      graph: {
        ...workflowFile.graph,
        nodes: [currentNode],
        edges: [],
      },
    };

    setRunning(true);
    try {
      addLog("info", `单步执行节点：${currentNode.data.label}`);
      setRunningNode(currentNode.id);
      const message = await runWorkflow(toBackendGraph(stepFile));
      updateStepContextAfterNode(currentNode, stepCtxRef.current);
      setVariables(Object.fromEntries(stepCtxRef.current.variables.entries()));

      const nextNodeId = pickNextNodeId(currentNode, stepCtxRef.current);
      if (!nextNodeId) {
        const nextEntryStart = stepCtxRef.current.startQueue.shift() ?? null;
        if (!nextEntryStart) {
          resetStepSession();
          addLog("success", `单步完成：${message}（已到流程末尾）`);
          announceWorkflowCompleted({
            title: "单步调试完成",
            body: `${workflowFile.graph.name} 已到达流程末尾。`,
          });
          return;
        }

        stepCtxRef.current.loopStack = [];
        stepNextNodeIdRef.current = nextEntryStart;
        const nextEntryNode = nodes.find((node) => node.id === nextEntryStart);
        if (nextEntryNode) {
          setSelectedNode(nextEntryNode.id);
          addLog(
            "success",
            `单步完成：${message}，下一步将执行新的起点：${nextEntryNode.data.label}`,
          );
        } else {
          addLog("warn", "单步完成，但下一起点节点不存在，请检查流程。");
        }
        return;
      }

      stepNextNodeIdRef.current = nextNodeId;
      const nextNode = nodes.find((node) => node.id === nextNodeId);
      if (nextNode) {
        setSelectedNode(nextNode.id);
        addLog(
          "success",
          `单步完成：${message}，下一步将执行：${nextNode.data.label}`,
        );
      } else {
        addLog("warn", "单步完成，但下一节点不存在，请检查连线。");
      }
    } catch (error) {
      const message = String(error);
      resetStepSession();
      addLog("error", `单步失败：${message}`);
      window.dispatchEvent(
        new CustomEvent<WorkflowFailedEventDetail>(WORKFLOW_FAILED_EVENT, {
          detail: {
            title: "单步执行失败",
            body: `单步执行失败：${message}`,
          },
        }),
      );
    } finally {
      setRunning(false);
      clearRunningNodes();
    }
  }, [
    addLog,
    clearRunningNodes,
    clearVariables,
    edges,
    exportWorkflow,
    nodes,
    running,
    setRunningNode,
    setRunning,
    setSelectedNode,
    setVariables,
  ]);

  useEffect(() => {
    runSingleStepRef.current = runSingleStep;
  }, [runSingleStep]);

  useEffect(() => {
    addLogRef.current = addLog;
  }, [addLog]);

  useEffect(() => {
    backgroundModeRef.current = backgroundMode;
  }, [backgroundMode]);

  useEffect(() => {
    compactViewRef.current = compactView;
  }, [compactView]);

  useEffect(() => {
    inputRecorderRecordingRef.current = inputRecorderRecording;
  }, [inputRecorderRecording]);

  useEffect(() => {
    activeInputRecordingPresetIdRef.current = activeInputRecordingPresetId;
  }, [activeInputRecordingPresetId]);

  useEffect(() => {
    inputRecorderDraftOptionsRef.current = inputRecorderDraftOptions;
  }, [inputRecorderDraftOptions]);

  const startCoordinatePicking = useCallback(async () => {
    if (coordinatePicking) return;

    setCoordinatePicking(true);
    addLog(
      "info",
      "进入系统级坐标拾取（全屏 / 物理精准像素）。请在 Overlay 中点击目标位置。",
    );

    try {
      const point = await pickCoordinate();
      addLog(
        "success",
        `坐标拾取成功：x=${point.x}, y=${point.y}（物理像素/全局）`,
      );
    } catch (error) {
      const message = String(error);
      if (message.includes("取消")) {
        addLog("warn", "已取消坐标拾取。");
      } else {
        addLog("error", `坐标拾取失败：${message}`);
      }
    } finally {
      setCoordinatePicking(false);
    }
  }, [addLog, coordinatePicking]);

  const startElementPicking = useCallback(async () => {
    if (elementPicking) return;

    setElementPicking(true);
    addLog(
      "info",
      "进入元素提取（Accessibility）模式：请将鼠标悬停到目标元素后单击确认。",
    );

    try {
      const picked = await pickUiElement();

      const selectedNode =
        nodes.find((node) => node.id === selectedNodeId) ?? null;
      const position = selectedNode
        ? {
            x: selectedNode.position.x + 320,
            y: selectedNode.position.y,
          }
        : {
            x: 320 + (nodes.length % 4) * 36,
            y: 160 + (nodes.length % 3) * 28,
          };

      const nodeId = addNode("uiaElement", position);
      const baseMeta = getNodeMeta("uiaElement");
      updateNodeParams(nodeId, {
        ...baseMeta.defaultParams,
        elementLocator: picked.locator,
      });
      setSelectedNode(nodeId);

      addLog(
        "success",
        `元素提取成功：${picked.summary}。已新增 UIA 获取控件节点并写入稳定指纹。`,
      );
    } catch (error) {
      const message = String(error);
      if (message.includes("取消")) {
        addLog("warn", "已取消元素提取。");
      } else {
        addLog("error", `元素提取失败：${message}`);
      }
    } finally {
      setElementPicking(false);
    }
  }, [
    addLog,
    addNode,
    elementPicking,
    nodes,
    selectedNodeId,
    setSelectedNode,
    updateNodeParams,
  ]);

  const getParamString = (node: WorkflowNode, key: string, fallback = "") => {
    const value = node.data.params[key];
    return typeof value === "string" ? value : fallback;
  };

  const getParamNumber = (node: WorkflowNode, key: string, fallback = 0) => {
    const value = node.data.params[key];
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback;
  };

  const toNumeric = (value: unknown) => {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof value === "boolean") return value ? 1 : 0;
    return 0;
  };

  const parseOperand = (
    kind: string,
    raw: string,
    variables: Map<string, unknown>,
  ) => {
    if (kind === "var") {
      return variables.get(raw);
    }
    if (raw.toLowerCase() === "true") return true;
    if (raw.toLowerCase() === "false") return false;
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) return asNumber;
    return raw;
  };

  const evaluateCondition = (
    node: WorkflowNode,
    variables: Map<string, unknown>,
  ) => {
    const leftType = getParamString(node, "leftType", "var");
    const rightType = getParamString(node, "rightType", "literal");
    const operator = getParamString(node, "operator", "==");
    const leftRaw = getParamString(node, "left", "");
    const rightRaw = getParamString(node, "right", "");

    const left = parseOperand(leftType, leftRaw, variables);
    const right = parseOperand(rightType, rightRaw, variables);

    switch (operator) {
      case "==":
        return left === right;
      case "!=":
        return left !== right;
      case ">":
        return toNumeric(left) > toNumeric(right);
      case ">=":
        return toNumeric(left) >= toNumeric(right);
      case "<":
        return toNumeric(left) < toNumeric(right);
      case "<=":
        return toNumeric(left) <= toNumeric(right);
      default:
        return false;
    }
  };

  const updateStepContextAfterNode = (
    node: WorkflowNode,
    ctx: StepRuntimeContext,
  ) => {
    const nodeKind = node.data.kind;
    if (nodeKind === "varDefine") {
      const name = getParamString(node, "name", "").trim();
      if (!name) return;
      if (!ctx.variables.has(name)) {
        ctx.variables.set(name, node.data.params.value ?? null);
      }
      return;
    }

    if (nodeKind === "varSet") {
      const name = getParamString(node, "name", "").trim();
      if (!name) return;
      ctx.variables.set(name, node.data.params.value ?? null);
    }
  };

  const pickNextNodeId = (node: WorkflowNode, ctx: StepRuntimeContext) => {
    const outgoing = edges.filter((edge) => edge.source === node.id);

    const enqueueAndPickTarget = (targets: string[]) => {
      if (targets.length === 0) return null;
      if (targets.length > 1) {
        ctx.pendingBranchQueue.push(...targets.slice(1));
      }
      return targets[0];
    };

    const getBranchTargets = (
      handle: string,
      fallbackToFirstOutgoing: boolean,
    ) => {
      const matched = outgoing
        .filter((edge) => edge.sourceHandle === handle)
        .map((edge) => edge.target);
      if (matched.length > 0) {
        return matched;
      }

      if (fallbackToFirstOutgoing && outgoing.length > 0) {
        return [outgoing[0].target];
      }

      return [] as string[];
    };

    if (node.data.kind === "loop") {
      const loopTargets = getBranchTargets("loop", true);
      const doneTargets = (() => {
        const matched = getBranchTargets("done", false);
        if (matched.length > 0) return matched;
        return outgoing
          .filter((edge) => edge.sourceHandle !== "loop")
          .map((edge) => edge.target);
      })();
      const times = Math.max(0, Math.floor(getParamNumber(node, "times", 1)));
      const remaining = ctx.loopRemaining.get(node.id) ?? times;

      if (remaining > 0) {
        const nextLoopTarget = enqueueAndPickTarget(loopTargets);
        if (nextLoopTarget) {
          ctx.loopRemaining.set(node.id, remaining - 1);
          if (ctx.loopStack[ctx.loopStack.length - 1] !== node.id) {
            ctx.loopStack.push(node.id);
          }
          return nextLoopTarget;
        }
        ctx.loopRemaining.set(node.id, 0);
      }

      ctx.loopRemaining.delete(node.id);
      if (ctx.loopStack[ctx.loopStack.length - 1] === node.id) {
        ctx.loopStack.pop();
      }

      const nextDoneTarget = enqueueAndPickTarget(doneTargets);
      if (nextDoneTarget) {
        return nextDoneTarget;
      }

      if (ctx.pendingBranchQueue.length > 0) {
        return ctx.pendingBranchQueue.shift() ?? null;
      }

      return ctx.loopStack[ctx.loopStack.length - 1] ?? null;
    }

    if (node.data.kind === "whileLoop") {
      const loopTargets = getBranchTargets("loop", true);
      const doneTargets = (() => {
        const matched = getBranchTargets("done", false);
        if (matched.length > 0) return matched;
        return outgoing
          .filter((edge) => edge.sourceHandle !== "loop")
          .map((edge) => edge.target);
      })();
      const maxIterations = Math.max(
        1,
        Math.floor(getParamNumber(node, "maxIterations", 1000)),
      );
      const currentIterations = ctx.whileIterations.get(node.id) ?? 0;
      const conditionTrue = evaluateCondition(node, ctx.variables);

      if (conditionTrue && currentIterations < maxIterations) {
        const nextLoopTarget = enqueueAndPickTarget(loopTargets);
        if (nextLoopTarget) {
          ctx.whileIterations.set(node.id, currentIterations + 1);
          if (ctx.loopStack[ctx.loopStack.length - 1] !== node.id) {
            ctx.loopStack.push(node.id);
          }
          return nextLoopTarget;
        }
      } else if (conditionTrue && currentIterations >= maxIterations) {
        addLog(
          "warn",
          `while 节点 '${node.data.label}' 达到最大循环次数 ${maxIterations}，已自动切换 done 分支。`,
        );
      }

      ctx.whileIterations.delete(node.id);
      if (ctx.loopStack[ctx.loopStack.length - 1] === node.id) {
        ctx.loopStack.pop();
      }

      const nextDoneTarget = enqueueAndPickTarget(doneTargets);
      if (nextDoneTarget) {
        return nextDoneTarget;
      }

      if (ctx.pendingBranchQueue.length > 0) {
        return ctx.pendingBranchQueue.shift() ?? null;
      }

      return ctx.loopStack[ctx.loopStack.length - 1] ?? null;
    }

    if (node.data.kind === "condition") {
      const result = evaluateCondition(node, ctx.variables);
      const branchTargets = result
        ? getBranchTargets("true", false)
        : getBranchTargets("false", false);
      return enqueueAndPickTarget(branchTargets);
    }

    if (outgoing.length > 0) {
      return enqueueAndPickTarget(outgoing.map((edge) => edge.target));
    }

    if (ctx.pendingBranchQueue.length > 0) {
      return ctx.pendingBranchQueue.shift() ?? null;
    }

    return ctx.loopStack[ctx.loopStack.length - 1] ?? null;
  };

  const runContinuousStep = useCallback(async () => {
    if (running) {
      addLog("warn", "当前正在执行，请先停止后再进行连续单步。");
      return;
    }

    const selectedNode = nodes.find((node) => node.id === selectedNodeId);
    if (!selectedNode) {
      addLog("warn", "请先选中一个节点，再开始连续单步。");
      return;
    }

    continuousStepStopRef.current = false;
    continuousStepRunningRef.current = true;
    stepNextNodeIdRef.current = null;
    stepCtxRef.current = {
      variables: new Map(),
      loopRemaining: new Map(),
      whileIterations: new Map(),
      loopStack: [],
      startQueue: [],
      pendingBranchQueue: [],
    };
    clearRunningNodes();
    loopRoundRef.current.clear();
    clearVariables();
    setRunning(true);
    addLog("info", `开始连续单步：${selectedNode.data.label}`);

    let currentNode = selectedNode;
    let guard = 0;
    try {
      while (!continuousStepStopRef.current && guard < 2000) {
        guard += 1;

        const workflowFile = exportWorkflow();
        const stepFile: WorkflowFile = {
          ...workflowFile,
          updatedAt: new Date().toISOString(),
          graph: {
            ...workflowFile.graph,
            nodes: [currentNode],
            edges: [],
          },
        };

        addLog("info", `连续单步执行：${currentNode.data.label}`);
        setRunningNode(currentNode.id);
        await runWorkflow(toBackendGraph(stepFile));
        updateStepContextAfterNode(currentNode, stepCtxRef.current);
        setVariables(
          Object.fromEntries(stepCtxRef.current.variables.entries()),
        );

        const nextNodeId = pickNextNodeId(currentNode, stepCtxRef.current);
        if (!nextNodeId) {
          addLog("success", "连续单步完成：已到达流程末尾。");
          announceWorkflowCompleted({
            title: "连续单步完成",
            body: `${exportWorkflow().graph.name} 已到达流程末尾。`,
          });
          return;
        }

        const nextNode = nodes.find((node) => node.id === nextNodeId);
        if (!nextNode) {
          addLog("warn", `连续单步结束：未找到下一个节点 ${nextNodeId}。`);
          return;
        }

        setSelectedNode(nextNode.id);
        currentNode = nextNode;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      if (guard >= 2000) {
        addLog("warn", "连续单步已触发保护上限，已自动停止。");
      } else if (continuousStepStopRef.current) {
        addLog("warn", "连续单步已停止。");
      }
    } catch (error) {
      const message = String(error);
      addLog("error", `连续单步失败：${message}`);
      window.dispatchEvent(
        new CustomEvent<WorkflowFailedEventDetail>(WORKFLOW_FAILED_EVENT, {
          detail: {
            title: "连续单步失败",
            body: `连续单步失败：${message}`,
          },
        }),
      );
    } finally {
      continuousStepRunningRef.current = false;
      continuousStepStopRef.current = false;
      setRunning(false);
      clearRunningNodes();
    }
  }, [
    addLog,
    clearRunningNodes,
    clearVariables,
    exportWorkflow,
    nodes,
    pickNextNodeId,
    running,
    selectedNodeId,
    setRunningNode,
    setRunning,
    setSelectedNode,
    setVariables,
  ]);

  const stopAllExecution = useCallback(async () => {
    continuousStepStopRef.current = true;
    stepNextNodeIdRef.current = null;
    stepCtxRef.current = {
      variables: new Map(),
      loopRemaining: new Map(),
      whileIterations: new Map(),
      loopStack: [],
      startQueue: [],
      pendingBranchQueue: [],
    };
    loopRoundRef.current.clear();
    try {
      const message = await stopWorkflow();
      addLog("warn", message);
    } catch (error) {
      const message = String(error);
      addLog("error", `停止失败：${message}`);
      window.dispatchEvent(
        new CustomEvent<WorkflowFailedEventDetail>(WORKFLOW_FAILED_EVENT, {
          detail: {
            title: "停止执行失败",
            body: `停止执行失败：${message}`,
          },
        }),
      );
    } finally {
      setRunning(false);
      clearRunningNodes();
    }
  }, [addLog, clearRunningNodes, setRunning]);

  useEffect(() => {
    const resetStepDebug = () => {
      stepNextNodeIdRef.current = null;
      clearRunningNodes();
      stepCtxRef.current = {
        variables: new Map(),
        loopRemaining: new Map(),
        whileIterations: new Map(),
        loopStack: [],
        startQueue: [],
        pendingBranchQueue: [],
      };
    };

    window.addEventListener("commandflow:reset-step-debug", resetStepDebug);
    return () =>
      window.removeEventListener(
        "commandflow:reset-step-debug",
        resetStepDebug,
      );
  }, [clearRunningNodes]);

  useEffect(() => {
    const handleRunStep = () => {
      void runSingleStepRef.current();
    };

    window.addEventListener("commandflow:run-step", handleRunStep);
    let disposed = false;
    let unlistenGlobalStep: (() => void) | null = null;

    if ("__TAURI_INTERNALS__" in window) {
      void listen("commandflow-global-run-step", () => {
        const now = Date.now();
        if (now - lastGlobalStepTriggerAtRef.current < 120) {
          return;
        }

        lastGlobalStepTriggerAtRef.current = now;
        void runSingleStepRef.current();
      })
        .then((cleanup) => {
          if (disposed) {
            cleanup();
            return;
          }
          unlistenGlobalStep = cleanup;
        })
        .catch((error) => {
          addLogRef.current("warn", `监听全局单步快捷键失败：${String(error)}`);
        });
    }

    return () => {
      disposed = true;
      window.removeEventListener("commandflow:run-step", handleRunStep);
      unlistenGlobalStep?.();
    };
  }, []);

  useEffect(() => {
    const handleRunContinuousStep = () => {
      if (continuousStepRunningRef.current) {
        continuousStepStopRef.current = true;
        addLog("warn", "正在停止连续单步...");
        return;
      }
      void runContinuousStep();
    };

    const handleStop = () => {
      void stopAllExecution();
    };

    window.addEventListener(
      "commandflow:run-continuous-step",
      handleRunContinuousStep,
    );
    window.addEventListener("commandflow:stop-run", handleStop);

    return () => {
      window.removeEventListener(
        "commandflow:run-continuous-step",
        handleRunContinuousStep,
      );
      window.removeEventListener("commandflow:stop-run", handleStop);
    };
  }, [addLog, runContinuousStep, stopAllExecution]);

  useEffect(() => {
    const handleToggleBackgroundMode = () => {
      void toggleBackgroundMode();
    };

    window.addEventListener(
      "commandflow:toggle-background-mode",
      handleToggleBackgroundMode,
    );

    let disposed = false;
    let unlistenGlobalToggle: (() => void) | null = null;

    if ("__TAURI_INTERNALS__" in window) {
      void listen("commandflow-global-toggle-background-mode", () => {
        if (disposed) {
          return;
        }
        void toggleBackgroundMode();
      })
        .then((cleanup) => {
          if (disposed) {
            cleanup();
            return;
          }
          unlistenGlobalToggle = cleanup;
        })
        .catch((error) => {
          addLogRef.current(
            "warn",
            `监听全局后台模式快捷键失败：${String(error)}`,
          );
        });
    }

    return () => {
      disposed = true;
      window.removeEventListener(
        "commandflow:toggle-background-mode",
        handleToggleBackgroundMode,
      );
      unlistenGlobalToggle?.();
    };
  }, [toggleBackgroundMode]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let disposed = false;
    let unlistenRecorderState: (() => void) | null = null;
    let unlistenRecorderLog: (() => void) | null = null;
    let unlistenGlobalStart: (() => void) | null = null;
    let unlistenGlobalStop: (() => void) | null = null;

    void listen<{
      recording: boolean;
      operationCount: number;
      startedAtMs?: number | null;
      options: InputRecordingOptions;
    }>("input-recorder-state", (event) => {
      if (disposed) return;
      setInputRecorderRecording(event.payload?.recording ?? false);
      inputRecorderRecordingRef.current = event.payload?.recording ?? false;
      setInputRecorderOperationCount(event.payload?.operationCount ?? 0);
    })
      .then((cleanup) => {
        unlistenRecorderState = cleanup;
      })
      .catch((error) => {
        addLogRef.current("warn", `监听键鼠录制状态失败：${String(error)}`);
      });

    void listen<{
      level: ExecutionLogItem["level"];
      message: string;
      operationCount: number;
    }>("input-recorder-log", (event) => {
      if (disposed) return;
      if (!event.payload?.message) return;
      setInputRecorderOperationCount(event.payload.operationCount ?? 0);
      addInputRecorderLog(event.payload.level ?? "info", event.payload.message);
    })
      .then((cleanup) => {
        unlistenRecorderLog = cleanup;
      })
      .catch((error) => {
        addLogRef.current("warn", `监听键鼠录制日志失败：${String(error)}`);
      });

    void listen("commandflow-global-start-input-recording", () => {
      if (disposed || compactViewRef.current !== "recorder") {
        return;
      }
      void startInputRecorderSession();
    })
      .then((cleanup) => {
        unlistenGlobalStart = cleanup;
      })
      .catch((error) => {
        addLogRef.current(
          "warn",
          `监听全局开始录制快捷键失败：${String(error)}`,
        );
      });

    void listen("commandflow-global-stop-input-recording", () => {
      if (
        disposed ||
        compactViewRef.current !== "recorder" ||
        !inputRecorderRecordingRef.current
      ) {
        return;
      }
      void stopInputRecorderSession();
    })
      .then((cleanup) => {
        unlistenGlobalStop = cleanup;
      })
      .catch((error) => {
        addLogRef.current(
          "warn",
          `监听全局停止录制快捷键失败：${String(error)}`,
        );
      });

    return () => {
      disposed = true;
      unlistenRecorderState?.();
      unlistenRecorderLog?.();
      unlistenGlobalStart?.();
      unlistenGlobalStop?.();
    };
  }, [
    addInputRecorderLog,
    startInputRecorderSession,
    stopInputRecorderSession,
  ]);

  const handleMenuAction = async (item: string) => {
    setActiveMenu(null);
    switch (item) {
      case "新建":
        resetWorkflow();
        addLog("info", "已新建工作流。");
        break;
      case "打开":
        if (isTauriRuntime) {
          await openWorkflowFromSystemDialog();
        } else {
          fileInputRef.current?.click();
        }
        break;
      case "保存":
        try {
          if (isTauriRuntime) {
            if (lastFilePath) {
              await saveWorkflowToSystemPath(lastFilePath);
            } else {
              await saveWorkflowAsSystemDialog();
            }
          } else {
            downloadWorkflow(lastFileName);
          }
        } catch (error) {
          addLog("error", `保存失败：${String(error)}`);
        }
        break;
      case "另存为": {
        try {
          if (isTauriRuntime) {
            await saveWorkflowAsSystemDialog();
          } else {
            const suggested = lastFileName || "workflow.json";
            const inputName = window.prompt(
              "请输入文件名（支持 .json）",
              suggested,
            );
            if (!inputName) return;
            downloadWorkflow(inputName);
          }
        } catch (error) {
          addLog("error", `另存为失败：${String(error)}`);
        }
        break;
      }
      case "撤销":
        undo();
        break;
      case "重做":
        redo();
        break;
      case "复制": {
        const copied = copySelectedNode();
        addLog(
          copied ? "info" : "warn",
          copied ? "已复制选中节点。" : "未选中节点，无法复制。",
        );
        break;
      }
      case "粘贴": {
        const pasted = pasteCopiedNode();
        addLog(
          pasted ? "info" : "warn",
          pasted ? "已粘贴节点。" : "剪贴板为空，请先复制节点。",
        );
        break;
      }
      case "放大":
        window.dispatchEvent(new Event("commandflow:zoom-in"));
        break;
      case "缩小":
        window.dispatchEvent(new Event("commandflow:zoom-out"));
        break;
      case "重置缩放":
        window.dispatchEvent(new Event("commandflow:zoom-reset"));
        break;
      case "后台模式":
        await toggleBackgroundMode();
        break;
      case "运行":
        if (running) return;
        clearRunningNodes();
        stepNextNodeIdRef.current = null;
        stepCtxRef.current = {
          variables: new Map(),
          loopRemaining: new Map(),
          whileIterations: new Map(),
          loopStack: [],
          startQueue: [],
          pendingBranchQueue: [],
        };
        loopRoundRef.current.clear();
        setRunning(true);
        clearVariables();
        try {
          const workflowFile = exportWorkflow();
          const graph = toBackendGraph(workflowFile);
          addLog("info", `开始执行：${workflowFile.graph.name}`);
          const message = await runWorkflow(graph);
          addLog("success", message);
          announceWorkflowCompleted({
            body: `${workflowFile.graph.name} 已执行完成。`,
          });
        } catch (error) {
          const message = String(error);
          addLog("error", `执行失败：${message}`);
          window.dispatchEvent(
            new CustomEvent<WorkflowFailedEventDetail>(WORKFLOW_FAILED_EVENT, {
              detail: {
                title: "工作流执行失败",
                body: `工作流执行失败：${message}`,
              },
            }),
          );
        } finally {
          setRunning(false);
          clearRunningNodes();
        }
        break;
      case "停止":
        clearVariables();
        await stopAllExecution();
        break;
      case "单步":
        void runSingleStep();
        break;
      case "拾取坐标":
        await startCoordinatePicking();
        break;
      case "提取元素":
        await startElementPicking();
        break;
      case "文档":
        setHelpType("docs");
        setHelpModalOpen(true);
        break;
      case "快捷键":
        setHelpType("shortcuts");
        setHelpModalOpen(true);
        break;
      case "LLM 预设":
        setLlmSettingsOpen(true);
        break;
      case "键鼠预设":
        setInputRecordingSettingsOpen(true);
        break;
      default:
        console.log(`点击了 ${item}`);
    }
  };

  useEffect(() => {
    const handleOpenWorkflow = () => {
      void handleMenuAction("打开");
    };

    const handleSaveWorkflow = () => {
      void handleMenuAction("保存");
    };

    const handleSaveWorkflowAs = () => {
      void handleMenuAction("另存为");
    };

    window.addEventListener("commandflow:open-workflow", handleOpenWorkflow);
    window.addEventListener("commandflow:save-workflow", handleSaveWorkflow);
    window.addEventListener(
      "commandflow:save-workflow-as",
      handleSaveWorkflowAs,
    );

    return () => {
      window.removeEventListener(
        "commandflow:open-workflow",
        handleOpenWorkflow,
      );
      window.removeEventListener(
        "commandflow:save-workflow",
        handleSaveWorkflow,
      );
      window.removeEventListener(
        "commandflow:save-workflow-as",
        handleSaveWorkflowAs,
      );
    };
  }, [handleMenuAction]);

  useEffect(() => {
    return () => {
      if (backgroundModeRef.current) {
        void setBackgroundMode(false);
      }
    };
  }, []);

  const handleHelpModalBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      setHelpModalOpen(false);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#202020] text-slate-900 selection:bg-cyan-100 dark:bg-[#202020] dark:text-slate-100 dark:selection:bg-cyan-900/30">
      {!backgroundMode && (
        <header className="relative z-[100] flex h-8 shrink-0 items-center justify-between border-b border-slate-200 bg-[#202020]/70 px-3 backdrop-blur-xl dark:border-neutral-800 dark:bg-[#202020]/70">
          <div
            className="flex items-center gap-2 text-sm font-medium"
            ref={menuRef}
          >
            {menu.map(([group, items]) => (
              <div key={group} className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setActiveMenu(activeMenu === group ? null : group)
                  }
                  onMouseEnter={() => {
                    if (activeMenu) {
                      setActiveMenu(group);
                    }
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors hover:bg-slate-200/50 dark:hover:bg-slate-800/70 ${
                    activeMenu === group
                      ? "bg-slate-200/70 dark:bg-neutral-800/90 text-cyan-600 dark:text-cyan-400 font-semibold"
                      : ""
                  }`}
                >
                  {group}
                </button>
                {activeMenu === group && (
                  <div className="menu-dropdown-enter absolute left-0 z-[110] mt-1.5 min-w-[140px] rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur-2xl dark:border-neutral-700 dark:bg-neutral-900/95">
                    {items.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => handleMenuAction(item)}
                        className="block w-full truncate rounded-lg px-3 py-2 text-left text-xs transition-all hover:bg-cyan-500 hover:text-white dark:hover:bg-cyan-600"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </header>
      )}

      {helpModalOpen && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={handleHelpModalBackdropClick}
        >
          <div className="flex max-h-[80vh] w-[600px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-neutral-800 dark:bg-neutral-900/50">
              <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                {helpType === "docs" ? "文档说明" : "快捷键说明"}
              </h2>
              <button
                type="button"
                onClick={() => setHelpModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-800"
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    d="M18 6L6 18M6 6l12 12"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
              {helpType === "docs" ? (
                <div className="space-y-4 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    欢迎使用 CommandFlow-rs！
                  </p>
                  <p>
                    CommandFlow-rs 是一个基于 Tauri v2
                    的桌面自动化流程编排工具。它能够帮助你通过图形化界面创建复杂的自动化序列，包括鼠标点击、键盘输入、屏幕截图以及逻辑判断等功能。
                  </p>
                  <div className="space-y-2">
                    <p className="font-semibold">功能亮点：</p>
                    <ul className="list-inside list-disc space-y-1">
                      <li>
                        多窗口适配：支持基于窗口标题的相对坐标拾取和操作。
                      </li>
                      <li>
                        图像匹配：可以通过屏幕截图查找特定图标或按钮的位置。
                      </li>
                      <li>变量系统：定义并使用工作流中的动态数据。</li>
                      <li>流程控制：包含条件分支和循环节点，支持复杂逻辑。</li>
                    </ul>
                  </div>
                  <p>详细文档和高级用法请参考项目根目录的 README.md 文件。</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 text-xs">
                  {[
                    ["新建流程", "Ctrl + N"],
                    ["打开流程", "Ctrl + O"],
                    ["保存流程", "Ctrl + S"],
                    ["另存为", "Ctrl + Shift + S"],
                    ["撤销操作", "Ctrl + Z"],
                    ["重做操作", "Ctrl + Y"],
                    ["复制节点", "Ctrl + C"],
                    ["粘贴节点", "Ctrl + V"],
                    ["删除节点", "Delete"],
                    ["运行流程", "F5"],
                    ["停止执行", "F6"],
                    ["后台模式", "F8"],
                    ["连续单步", "F9"],
                    ["单步执行", "F10"],
                    ["开始键鼠录制", "Scroll Lock"],
                    ["停止键鼠录制", "Alt + Scroll Lock"],
                    ["全局刷新", "R"],
                    ["放大画布", "Ctrl + ="],
                    ["缩小画布", "Ctrl + -"],
                    ["重置缩放", "Ctrl + 0"],
                  ].map(([label, key]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-neutral-800/50"
                    >
                      <span className="text-slate-600 dark:text-slate-400">
                        {label}
                      </span>
                      <kbd className="rounded bg-white px-2 py-1 font-mono text-[10px] font-bold shadow-sm dark:bg-neutral-700 dark:text-cyan-400">
                        {key}
                      </kbd>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <LlmSettingsModal
        open={llmSettingsOpen}
        onClose={() => setLlmSettingsOpen(false)}
      />
      <InputRecordingSettingsModal
        open={inputRecordingSettingsOpen}
        onClose={() => setInputRecordingSettingsOpen(false)}
        onStartRecording={(presetId, options) => {
          void openInputRecorderMode(presetId, options);
        }}
      />

      {backgroundMode ? (
        compactView === "recorder" ? (
          <InputRecorderCompactPanel
            logs={inputRecorderLogs}
            recording={inputRecorderRecording}
            operationCount={inputRecorderOperationCount}
            onStart={() => {
              void startInputRecorderSession();
            }}
            onStop={() => {
              void stopInputRecorderSession();
            }}
            onExit={() => {
              void exitInputRecorderMode();
            }}
          />
        ) : (
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50/40 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/40">
              <button
                type="button"
                disabled={running}
                onClick={() => void handleMenuAction("运行")}
                className="rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                启动
              </button>
              <button
                type="button"
                disabled={running}
                onClick={() => void handleMenuAction("单步")}
                className="rounded-md bg-slate-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                单步
              </button>
              <button
                type="button"
                disabled={!running}
                onClick={() => void handleMenuAction("停止")}
                className="rounded-md bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                停止
              </button>
              <CoordinatePicker
                picking={coordinatePicking}
                onPick={startCoordinatePicking}
                elementPicking={elementPicking}
                onPickElement={startElementPicking}
                compact
              />
              <button
                type="button"
                onClick={() => void handleMenuAction("后台模式")}
                className="ml-auto rounded-md bg-slate-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-slate-500 dark:bg-slate-600 dark:hover:bg-slate-500"
              >
                退出后台模式
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <ExecutionLog />
            </div>
          </main>
        )
      ) : (
        <>
          <div className="shrink-0 flex flex-col">
            <Toolbar
              backgroundMode={backgroundMode}
              coordinatePicking={coordinatePicking}
              elementPicking={elementPicking}
              onPickCoordinate={startCoordinatePicking}
              onPickElement={startElementPicking}
              onToggleBackgroundMode={() => {
                void handleMenuAction("后台模式");
              }}
            />
          </div>

          <main className="flex min-h-0 flex-1 grid-cols-[280px_1fr_320px] overflow-hidden lg:grid">
            <NodePanel />
            <FlowEditor onPaneClick={handleFlowEditorPaneClick} />
            <div
              ref={rightPaneRef}
              className="flex min-h-0 flex-col border-l border-slate-200 bg-slate-50/30 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/40"
            >
              <div
                className="flex min-h-[120px] flex-col border-b border-slate-200 dark:border-neutral-800"
                style={{
                  height: `calc(${Math.round(rightPaneTopRatio * 1000) / 10}% - 3px)`,
                }}
              >
                <VariablePanel />
              </div>

              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="调整变量面板和执行日志高度"
                onPointerDown={(event) => {
                  event.preventDefault();
                  setIsResizingRightPane(true);
                }}
                className="group relative z-10 h-[12px] -my-[6px] shrink-0 cursor-row-resize touch-none bg-transparent"
              >
                <div
                  className={`absolute inset-x-0 top-1/2 h-[1px] -translate-y-1/2 transition-colors ${
                    isResizingRightPane
                      ? "bg-cyan-500 dark:bg-cyan-400"
                      : "bg-slate-200 group-hover:bg-cyan-400 dark:bg-neutral-700 dark:group-hover:bg-cyan-500"
                  }`}
                />
              </div>

              <div className="flex min-h-[120px] min-w-0 flex-1 flex-col">
                <ExecutionLog />
              </div>
            </div>
          </main>

          <div className="shrink-0">
            <StatusBar />
          </div>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleOpenFile}
      />
    </div>
  );
}

export default App;

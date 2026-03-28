import { useExecutionStore } from "../../stores/executionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { runWorkflow, stopWorkflow } from "../../utils/execution";
import {
  announceWorkflowCompleted,
  announceWorkflowFailed,
} from "../../utils/workflowCompletion";
import { toBackendGraph } from "../../utils/workflowBridge";
import { useState, useEffect } from "react";
import { Box, Moon, Play, Redo2, StepForward, Undo2, Square } from "lucide-react";
import CoordinatePicker from "../CoordinatePicker";
import { FluentProvider, webDarkTheme, webLightTheme, Button, Input, Text } from "@fluentui/react-components";

interface ToolbarProps {
  backgroundMode: boolean;
  onToggleBackgroundMode: () => void;
  onPackageWorkflow: () => void;
  onPickCoordinate: () => void;
  onPickElement: () => void;
  coordinatePicking: boolean;
  elementPicking: boolean;
}

export default function Toolbar({
  backgroundMode,
  onToggleBackgroundMode,
  onPackageWorkflow,
  onPickCoordinate,
  onPickElement,
  coordinatePicking,
  elementPicking,
}: ToolbarProps) {
  const { running, setRunning, addLog, clearVariables } = useExecutionStore();
  const { zoom } = useSettingsStore();
  const { undo, redo, exportWorkflow, graphName, setGraphName } =
    useWorkflowStore();
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(graphName);
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const checkDark = () => setIsDarkMode(document.documentElement.classList.contains('dark'));
    checkDark();
    const observer = new MutationObserver(checkDark);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const run = async () => {
    if (running) return;
    window.dispatchEvent(new Event("commandflow:reset-step-debug"));
    const workflowFile = exportWorkflow();
    const graph = toBackendGraph(workflowFile);

    clearVariables();
    setRunning(true);
    addLog("info", `开始执行流程：${workflowFile.graph.name}`);
    try {
      const message = await runWorkflow(graph);
      addLog("success", message);
      announceWorkflowCompleted({
        body: `${workflowFile.graph.name} 已执行完成。`,
      });
    } catch (error) {
      const message = `执行失败：${String(error)}`;
      addLog("error", message);
      announceWorkflowFailed({
        title: "工作流执行失败",
        body: `${workflowFile.graph.name} 执行失败：${String(error)}`,
      });
    } finally {
      setRunning(false);
    }
  };

  const stop = async () => {
    try {
      const message = await stopWorkflow();
      addLog("warn", message);
    } catch (error) {
      addLog("error", `停止失败：${String(error)}`);
    }
    setRunning(false);
  };

  return (
    <FluentProvider theme={isDarkMode ? webDarkTheme : webLightTheme} style={{ background: 'transparent' }} className="relative z-50 flex h-12 items-center gap-2 border-b border-slate-200 bg-slate-50/50 px-4 backdrop-blur-xl dark:border-neutral-800 dark:bg-black/50">
      <Button
        appearance="primary"
        icon={<Play className="h-4 w-4" />}
        onClick={run}
        disabled={running}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        F5 运行
      </Button>
      <Button
        appearance="secondary"
        icon={<StepForward className="h-4 w-4" />}
        onClick={() => window.dispatchEvent(new Event("commandflow:run-step"))}
        disabled={running}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        F10 单步
      </Button>
      <Button
        appearance={backgroundMode ? "primary" : "secondary"}
        icon={<Moon className="h-4 w-4" />}
        onClick={onToggleBackgroundMode}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {backgroundMode ? "退出后台" : "F8 后台模式"}
      </Button>
      <Button
        appearance="primary"
        style={{ backgroundColor: running ? '#e11d48' : undefined, borderColor: running ? '#e11d48' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        icon={<Square className="h-3 w-3" fill="currentColor" />}
        onClick={stop}
        disabled={!running}
      >
        F6 停止
      </Button>

      <Button
        appearance="secondary"
        icon={<Box className="h-4 w-4" />}
        onClick={onPackageWorkflow}
        disabled={running}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        打包 EXE
      </Button>

      <div className="mx-2 h-5 w-[1px] bg-slate-200 dark:bg-neutral-800" />

      <div className="flex items-center gap-1">
        <Button appearance="subtle" icon={<Undo2 className="h-4 w-4" />} onClick={undo} title="撤销 (Ctrl+Z)" aria-label="撤销" />
        <Button appearance="subtle" icon={<Redo2 className="h-4 w-4" />} onClick={redo} title="重做 (Ctrl+Y)" aria-label="重做" />
      </div>

      <div className="mx-2 h-5 w-[1px] bg-slate-200 dark:bg-neutral-800" />

      {isEditingName ? (
        <Input
          value={editName}
          onChange={(_e, data) => setEditName(data.value)}
          onBlur={() => {
            setGraphName(editName.trim() || "未命名工作流");
            setIsEditingName(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setGraphName(editName.trim() || "未命名工作流");
              setIsEditingName(false);
            } else if (e.key === "Escape") {
              setEditName(graphName);
              setIsEditingName(false);
            }
          }}
          autoFocus
        />
      ) : (
        <Button
          appearance="subtle"
          onClick={() => {
            setEditName(graphName);
            setIsEditingName(true);
          }}
          title="点击修改工作流名称"
        >
          {graphName}
        </Button>
      )}

      <div className="ml-auto flex items-center gap-3">
        <CoordinatePicker
          picking={coordinatePicking}
          onPick={onPickCoordinate}
          elementPicking={elementPicking}
          onPickElement={onPickElement}
          compact
        />
        <div className="flex items-center px-2">
          <Text size={200} style={{ color: 'var(--colorNeutralForeground2)' }}>
            缩放: {Math.round(zoom * 100)}%
          </Text>
        </div>
      </div>
    </FluentProvider>
  );
}

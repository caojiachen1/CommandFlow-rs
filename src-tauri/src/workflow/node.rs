use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    HotkeyTrigger,
    TimerTrigger,
    ManualTrigger,
    WindowTrigger,
    MouseClick,
    MouseMove,
    MouseDrag,
    MouseWheel,
    MouseDown,
    MouseUp,
    KeyboardKey,
    KeyboardInput,
    KeyboardDown,
    KeyboardUp,
    Shortcut,
    Screenshot,
    WindowActivate,
    FileCopy,
    FileMove,
    FileDelete,
    RunCommand,
    PythonCode,
    ClipboardRead,
    ClipboardWrite,
    FileReadText,
    FileWriteText,
    ShowMessage,
    Delay,
    Condition,
    Loop,
    WhileLoop,
    ImageMatch,
    VarDefine,
    VarSet,
    VarMath,
    VarGet,
    ConstValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowNode {
    pub id: String,
    pub label: String,
    pub kind: NodeKind,
    pub position_x: f64,
    pub position_y: f64,
    pub params: HashMap<String, Value>,
}

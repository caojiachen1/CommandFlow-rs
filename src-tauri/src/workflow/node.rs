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
    KeyboardKey,
    KeyboardInput,
    Shortcut,
    Screenshot,
    WindowActivate,
    RunCommand,
    PythonCode,
    Delay,
    Condition,
    Loop,
    WhileLoop,
    ErrorHandler,
    VarDefine,
    VarSet,
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

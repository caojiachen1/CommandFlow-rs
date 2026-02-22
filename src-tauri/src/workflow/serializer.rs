use crate::error::{CommandFlowError, CommandResult};
use crate::workflow::graph::WorkflowGraph;

pub fn to_json(graph: &WorkflowGraph) -> CommandResult<String> {
    serde_json::to_string_pretty(graph).map_err(|error| CommandFlowError::Validation(error.to_string()))
}

pub fn from_json(raw: &str) -> CommandResult<WorkflowGraph> {
    serde_json::from_str::<WorkflowGraph>(raw).map_err(|error| CommandFlowError::Validation(error.to_string()))
}

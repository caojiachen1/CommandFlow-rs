use crate::workflow::edge::WorkflowEdge;
use crate::workflow::node::WorkflowNode;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowGraph {
    pub id: String,
    pub name: String,
    pub nodes: Vec<WorkflowNode>,
    pub edges: Vec<WorkflowEdge>,
}

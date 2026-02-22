use crate::automation::{keyboard, mouse, screenshot, window};
use crate::error::{CommandFlowError, CommandResult};
use crate::workflow::graph::WorkflowGraph;
use crate::workflow::node::NodeKind;
use tokio::time::{sleep, Duration};

#[derive(Debug, Default)]
pub struct WorkflowExecutor;

impl WorkflowExecutor {
    pub async fn execute(&self, graph: &WorkflowGraph) -> CommandResult<()> {
        for node in &graph.nodes {
            match node.kind {
                NodeKind::MouseClick => {
                    mouse::click(0, 0, 1)?;
                }
                NodeKind::KeyboardInput => {
                    keyboard::text_input("commandflow")?;
                }
                NodeKind::Screenshot => {
                    screenshot::capture_region("capture.png", 320, 240)?;
                }
                NodeKind::WindowActivate => {
                    window::activate_window("CommandFlow-rs")?;
                }
                NodeKind::Delay => {
                    let duration = node
                        .params
                        .get("ms")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(100);
                    sleep(Duration::from_millis(duration)).await;
                }
                _ => {
                    // other node kinds will be implemented progressively
                }
            }
        }

        if graph.nodes.is_empty() {
            return Err(CommandFlowError::Validation(
                "workflow has no executable nodes".to_string(),
            ));
        }

        Ok(())
    }
}

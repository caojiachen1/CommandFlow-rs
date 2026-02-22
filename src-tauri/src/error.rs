use thiserror::Error;

#[derive(Debug, Error)]
pub enum CommandFlowError {
    #[error("I/O error: {0}")]
    Io(String),
    #[error("Workflow validation failed: {0}")]
    Validation(String),
    #[error("Automation failed: {0}")]
    Automation(String),
    #[error("Execution canceled")]
    Canceled,
}

pub type CommandResult<T> = Result<T, CommandFlowError>;

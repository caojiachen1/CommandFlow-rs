use crate::error::CommandResult;

pub fn find_template(_source_path: &str, _template_path: &str, threshold: f32) -> CommandResult<Option<(i32, i32)>> {
    let _ = threshold;
    Ok(None)
}

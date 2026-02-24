use crate::error::{CommandFlowError, CommandResult};
use std::fs;
use std::path::Path;

pub fn copy_path(source: &str, target: &str, overwrite: bool, recursive: bool) -> CommandResult<()> {
	let src = Path::new(source);
	let dst = Path::new(target);

	if !src.exists() {
		return Err(CommandFlowError::Validation(format!(
			"source path does not exist: {}",
			source
		)));
	}

	if src.is_file() {
		copy_file(src, dst, overwrite)?;
		return Ok(());
	}

	if !recursive {
		return Err(CommandFlowError::Validation(format!(
			"source is a directory; enable recursive copy: {}",
			source
		)));
	}

	copy_dir(src, dst, overwrite)
}

pub fn move_path(source: &str, target: &str, overwrite: bool) -> CommandResult<()> {
	let src = Path::new(source);
	let dst = Path::new(target);

	if !src.exists() {
		return Err(CommandFlowError::Validation(format!(
			"source path does not exist: {}",
			source
		)));
	}

	if dst.exists() {
		if !overwrite {
			return Err(CommandFlowError::Validation(format!(
				"target path already exists: {}",
				target
			)));
		}
		delete_existing(dst)?;
	}

	if let Some(parent) = dst.parent() {
		if !parent.exists() {
			fs::create_dir_all(parent).map_err(io_error)?;
		}
	}

	match fs::rename(src, dst) {
		Ok(_) => Ok(()),
		Err(_) => {
			copy_path(source, target, overwrite, true)?;
			delete_path(source, true)
		}
	}
}

pub fn delete_path(path: &str, recursive: bool) -> CommandResult<()> {
	let target = Path::new(path);
	if !target.exists() {
		return Err(CommandFlowError::Validation(format!(
			"path does not exist: {}",
			path
		)));
	}

	if target.is_file() {
		fs::remove_file(target).map_err(io_error)?;
		return Ok(());
	}

	if recursive {
		fs::remove_dir_all(target).map_err(io_error)?;
	} else {
		fs::remove_dir(target).map_err(io_error)?;
	}

	Ok(())
}

fn copy_file(src: &Path, dst: &Path, overwrite: bool) -> CommandResult<()> {
	if dst.exists() {
		if !overwrite {
			return Err(CommandFlowError::Validation(format!(
				"target file already exists: {}",
				dst.display()
			)));
		}
		delete_existing(dst)?;
	}

	if let Some(parent) = dst.parent() {
		if !parent.exists() {
			fs::create_dir_all(parent).map_err(io_error)?;
		}
	}

	fs::copy(src, dst).map_err(io_error)?;
	Ok(())
}

fn copy_dir(src: &Path, dst: &Path, overwrite: bool) -> CommandResult<()> {
	if dst.exists() {
		if !overwrite {
			return Err(CommandFlowError::Validation(format!(
				"target directory already exists: {}",
				dst.display()
			)));
		}
		delete_existing(dst)?;
	}

	fs::create_dir_all(dst).map_err(io_error)?;

	for entry in fs::read_dir(src).map_err(io_error)? {
		let entry = entry.map_err(io_error)?;
		let child_src = entry.path();
		let child_dst = dst.join(entry.file_name());

		if child_src.is_dir() {
			copy_dir(&child_src, &child_dst, overwrite)?;
		} else {
			copy_file(&child_src, &child_dst, overwrite)?;
		}
	}

	Ok(())
}

fn delete_existing(path: &Path) -> CommandResult<()> {
	if path.is_dir() {
		fs::remove_dir_all(path).map_err(io_error)?;
	} else {
		fs::remove_file(path).map_err(io_error)?;
	}
	Ok(())
}

fn io_error(error: std::io::Error) -> CommandFlowError {
	CommandFlowError::Io(error.to_string())
}

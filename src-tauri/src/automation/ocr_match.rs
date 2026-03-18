use crate::error::{CommandFlowError, CommandResult};
use paddle_ocr_rs::{EngineConfig, OcrInput, OcrResult, RapidOcrEngine, RunOptions};
use regex::Regex;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone)]
pub struct OcrMatchCandidate {
    pub x: i32,
    pub y: i32,
    pub text: String,
    pub confidence: f32,
}

#[derive(Debug, Clone)]
pub struct OcrMatchEvaluation {
    pub matched: Option<OcrMatchCandidate>,
    pub peak_text: String,
    pub peak_confidence: f32,
    pub debug_entries: Vec<OcrDebugEntry>,
}

#[derive(Debug, Clone)]
pub struct OcrDebugEntry {
    pub text: String,
    pub confidence: f32,
    pub center_x: i32,
    pub center_y: i32,
    pub quad: Option<[[f32; 2]; 4]>,
    pub is_text_match: bool,
    pub is_confidence_passed: bool,
}

static OCR_ENGINE: OnceLock<Mutex<RapidOcrEngine>> = OnceLock::new();

fn get_engine() -> CommandResult<&'static Mutex<RapidOcrEngine>> {
    if let Some(engine) = OCR_ENGINE.get() {
        return Ok(engine);
    }

    let mut config = EngineConfig::default();
    config.det.allow_download = true;
    config.cls.allow_download = true;
    config.rec.model.allow_download = true;

    let engine = RapidOcrEngine::new(config).map_err(|error| {
        CommandFlowError::Automation(format!(
            "初始化 OCR 引擎失败（自动模型下载/加载阶段）：{}",
            error
        ))
    })?;

    let _ = OCR_ENGINE.set(Mutex::new(engine));
    OCR_ENGINE
        .get()
        .ok_or_else(|| CommandFlowError::Automation("OCR 引擎初始化后无法获取实例".to_string()))
}

pub fn evaluate_path(
    image_path: &str,
    target_text: &str,
    match_mode: &str,
    case_sensitive: bool,
    use_regex: bool,
    min_confidence: f32,
) -> CommandResult<OcrMatchEvaluation> {
    let input = OcrInput::Path(std::path::PathBuf::from(image_path));
    evaluate_input(
        input,
        target_text,
        match_mode,
        case_sensitive,
        use_regex,
        min_confidence,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn evaluate_rgba(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    target_text: &str,
    match_mode: &str,
    case_sensitive: bool,
    use_regex: bool,
    min_confidence: f32,
) -> CommandResult<OcrMatchEvaluation> {
    let input = OcrInput::RgbaU8 {
        width: width as usize,
        height: height as usize,
        data: rgba,
    };

    evaluate_input(
        input,
        target_text,
        match_mode,
        case_sensitive,
        use_regex,
        min_confidence,
    )
}

fn evaluate_input(
    input: OcrInput,
    target_text: &str,
    match_mode: &str,
    case_sensitive: bool,
    use_regex: bool,
    min_confidence: f32,
) -> CommandResult<OcrMatchEvaluation> {
    let engine = get_engine()?;
    let mut guard = engine
        .lock()
        .map_err(|_| CommandFlowError::Automation("OCR 引擎锁已中毒，无法继续识别".to_string()))?;

    let run_options = RunOptions {
        use_det: Some(true),
        use_cls: Some(true),
        use_rec: Some(true),
        ..RunOptions::default()
    };

    let result = guard
        .run(input, run_options)
        .map_err(|error| CommandFlowError::Automation(format!("OCR 识别失败：{}", error)))?;

    find_match(
        &result,
        target_text,
        match_mode,
        case_sensitive,
        use_regex,
        min_confidence.clamp(0.0, 1.0),
    )
}

fn find_match(
    result: &OcrResult,
    target_text: &str,
    match_mode: &str,
    case_sensitive: bool,
    use_regex: bool,
    min_confidence: f32,
) -> CommandResult<OcrMatchEvaluation> {
    let mut matched: Option<OcrMatchCandidate> = None;
    let mut peak_confidence = 0.0_f32;
    let mut peak_text = String::new();
    let mut debug_entries = Vec::<OcrDebugEntry>::new();

    let regex = if use_regex {
        let pattern = if case_sensitive {
            target_text.to_string()
        } else {
            format!("(?i){}", target_text)
        };
        Some(Regex::new(&pattern).map_err(|error| {
            CommandFlowError::Validation(format!("OCR 正则表达式无效：{}", error))
        })?)
    } else {
        None
    };

    match result {
        OcrResult::Full(full) => {
            for ((text, score), quad) in full
                .txts
                .iter()
                .zip(full.scores.iter().copied())
                .zip(full.boxes.iter())
            {
                if score > peak_confidence {
                    peak_confidence = score;
                    peak_text = text.clone();
                }

                let is_text_match = text_matches(
                    text,
                    target_text,
                    match_mode,
                    case_sensitive,
                    regex.as_ref(),
                );
                let is_confidence_passed = score >= min_confidence;
                let (x, y) = quad_center(quad);

                debug_entries.push(OcrDebugEntry {
                    text: text.to_string(),
                    confidence: score,
                    center_x: x,
                    center_y: y,
                    quad: Some(*quad),
                    is_text_match,
                    is_confidence_passed,
                });

                if !is_confidence_passed {
                    continue;
                }

                if !is_text_match {
                    continue;
                }

                let candidate = OcrMatchCandidate {
                    x,
                    y,
                    text: text.to_string(),
                    confidence: score,
                };

                let replace = matched
                    .as_ref()
                    .map(|current| candidate.confidence > current.confidence)
                    .unwrap_or(true);
                if replace {
                    matched = Some(candidate);
                }
            }
        }
        OcrResult::Rec(rec) => {
            for (text, score) in rec.txts.iter().zip(rec.scores.iter().copied()) {
                if score > peak_confidence {
                    peak_confidence = score;
                    peak_text = text.clone();
                }

                let is_text_match = text_matches(
                    text,
                    target_text,
                    match_mode,
                    case_sensitive,
                    regex.as_ref(),
                );
                let is_confidence_passed = score >= min_confidence;
                debug_entries.push(OcrDebugEntry {
                    text: text.to_string(),
                    confidence: score,
                    center_x: -1,
                    center_y: -1,
                    quad: None,
                    is_text_match,
                    is_confidence_passed,
                });

                if !is_confidence_passed {
                    continue;
                }

                if !is_text_match {
                    continue;
                }

                let candidate = OcrMatchCandidate {
                    x: -1,
                    y: -1,
                    text: text.to_string(),
                    confidence: score,
                };
                let replace = matched
                    .as_ref()
                    .map(|current| candidate.confidence > current.confidence)
                    .unwrap_or(true);
                if replace {
                    matched = Some(candidate);
                }
            }
        }
        _ => {}
    }

    Ok(OcrMatchEvaluation {
        matched,
        peak_text,
        peak_confidence,
        debug_entries,
    })
}

fn text_matches(
    candidate: &str,
    target: &str,
    match_mode: &str,
    case_sensitive: bool,
    regex: Option<&Regex>,
) -> bool {
    if let Some(regex) = regex {
        return regex.is_match(candidate);
    }

    let (left, right) = if case_sensitive {
        (candidate.to_string(), target.to_string())
    } else {
        (candidate.to_lowercase(), target.to_lowercase())
    };

    match match_mode.trim().to_lowercase().as_str() {
        "exact" => left == right,
        _ => left.contains(&right),
    }
}

fn quad_center(quad: &[[f32; 2]; 4]) -> (i32, i32) {
    let mut sum_x = 0.0_f32;
    let mut sum_y = 0.0_f32;
    for point in quad {
        sum_x += point[0];
        sum_y += point[1];
    }

    ((sum_x / 4.0).round() as i32, (sum_y / 4.0).round() as i32)
}

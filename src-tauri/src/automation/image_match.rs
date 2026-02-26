use crate::error::{CommandFlowError, CommandResult};
use image::GrayImage;
use template_matching::{MatchTemplateMethod, TemplateMatcher as GpuTemplateMatcher};

const COARSE_SCALE: u32 = 4;

#[derive(Debug, Clone)]
pub struct MatchEvaluation {
    pub matched_point: Option<(i32, i32)>,
    pub best_similarity: f32,
    pub best_top_left: Option<(u32, u32)>,
    pub template_size: (u32, u32),
}

pub struct TemplateMatcher {
    template: GrayImage,
    threshold: f32,
    gpu_matcher: Option<GpuTemplateMatcher>,
}

impl TemplateMatcher {
    pub fn from_path(template_path: &str, threshold: f32) -> CommandResult<Self> {
        let template = image::open(template_path)
            .map_err(|error| CommandFlowError::Automation(error.to_string()))?
            .to_luma8();
        let (tw, th) = template.dimensions();
        if tw == 0 || th == 0 {
            return Err(CommandFlowError::Validation(
                "template image is empty".to_string(),
            ));
        }

        Ok(Self {
            template,
            threshold: threshold.clamp(0.0, 1.0),
            gpu_matcher: std::panic::catch_unwind(GpuTemplateMatcher::new).ok(),
        })
    }

    pub fn evaluate(&mut self, source: &GrayImage) -> MatchEvaluation {
        if let Some(gpu) = &mut self.gpu_matcher {
            let template_f32 = to_luma32f(&self.template);
            let input_f32 = to_luma32f(source);
            let input_image = template_matching::Image::new(
                &input_f32,
                source.width(),
                source.height(),
            );
            let template_image = template_matching::Image::new(
                &template_f32,
                self.template.width(),
                self.template.height(),
            );

            gpu.match_template(
                input_image,
                template_image,
                MatchTemplateMethod::SumOfSquaredDifferences,
            );

            if let Some(result) = gpu.wait_for_result() {
                let extremes = template_matching::find_extremes(&result);

                let score = extremes.min_value.max(0.0);
                let pixel_count = (self.template.width() * self.template.height()).max(1) as f32;
                let normalized_score = (score / pixel_count).clamp(0.0, 1.0);
                let similarity = (1.0 - normalized_score).clamp(0.0, 1.0);

                let matched_point = if similarity >= self.threshold {
                    let center_x = extremes.min_value_location.0 + self.template.width() / 2;
                    let center_y = extremes.min_value_location.1 + self.template.height() / 2;
                    Some((center_x as i32, center_y as i32))
                } else {
                    None
                };

                return MatchEvaluation {
                    matched_point,
                    best_similarity: similarity,
                    best_top_left: Some(extremes.min_value_location),
                    template_size: (self.template.width(), self.template.height()),
                };
            }
        }

        evaluate_template_cpu(source, &self.template, self.threshold)
    }
}

pub fn find_template(
    source_path: &str,
    template_path: &str,
    threshold: f32,
) -> CommandResult<Option<(i32, i32)>> {
    let source = image::open(source_path)
        .map_err(|error| CommandFlowError::Automation(error.to_string()))?
        .to_luma8();
    let mut matcher = TemplateMatcher::from_path(template_path, threshold)?;
    let evaluation = matcher.evaluate(&source);
    Ok(evaluation.matched_point)
}

fn to_luma32f(source: &GrayImage) -> Vec<f32> {
    let (w, h) = source.dimensions();
    let mut data = Vec::with_capacity((w * h) as usize);
    for value in source.as_raw() {
        data.push(*value as f32 / 255.0);
    }
    data
}

fn evaluate_template_cpu(source: &GrayImage, template: &GrayImage, threshold: f32) -> MatchEvaluation {
    let (sw, sh) = source.dimensions();
    let (tw, th) = template.dimensions();

    if tw > sw || th > sh {
        return MatchEvaluation {
            matched_point: None,
            best_similarity: 0.0,
            best_top_left: None,
            template_size: (tw, th),
        };
    }

    let (coarse_source, coarse_template, scale) = build_coarse_images(&source, &template);
    let coarse_best = find_best_position(&coarse_source, &coarse_template, 0, 0, None);
    let Some((coarse_x, coarse_y, _)) = coarse_best else {
        return MatchEvaluation {
            matched_point: None,
            best_similarity: 0.0,
            best_top_left: None,
            template_size: (tw, th),
        };
    };

    let coarse_ref_x = coarse_x.saturating_mul(scale);
    let coarse_ref_y = coarse_y.saturating_mul(scale);
    let radius = scale.max(1) * 2;

    let min_x = coarse_ref_x.saturating_sub(radius);
    let min_y = coarse_ref_y.saturating_sub(radius);
    let max_x = (coarse_ref_x + radius).min(sw.saturating_sub(tw));
    let max_y = (coarse_ref_y + radius).min(sh.saturating_sub(th));

    let refine_best = find_best_position(&source, &template, min_x, min_y, Some((max_x, max_y)));
    let Some((x, y, best_score)) = refine_best else {
        return MatchEvaluation {
            matched_point: None,
            best_similarity: 0.0,
            best_top_left: None,
            template_size: (tw, th),
        };
    };

    let similarity = (1.0 - best_score).clamp(0.0, 1.0);
    let matched_point = if similarity >= threshold {
        let center_x = x + tw / 2;
        let center_y = y + th / 2;
        Some((center_x as i32, center_y as i32))
    } else {
        None
    };

    MatchEvaluation {
        matched_point,
        best_similarity: similarity,
        best_top_left: Some((x, y)),
        template_size: (tw, th),
    }
}

fn build_coarse_images(source: &GrayImage, template: &GrayImage) -> (GrayImage, GrayImage, u32) {
    let (sw, sh) = source.dimensions();
    let (tw, th) = template.dimensions();

    if tw < COARSE_SCALE * 2 || th < COARSE_SCALE * 2 || sw < COARSE_SCALE * 2 || sh < COARSE_SCALE * 2 {
        return (source.clone(), template.clone(), 1);
    }

    let coarse_source = image::imageops::resize(
        source,
        (sw / COARSE_SCALE).max(1),
        (sh / COARSE_SCALE).max(1),
        image::imageops::FilterType::Triangle,
    );
    let coarse_template = image::imageops::resize(
        template,
        (tw / COARSE_SCALE).max(1),
        (th / COARSE_SCALE).max(1),
        image::imageops::FilterType::Triangle,
    );

    (coarse_source, coarse_template, COARSE_SCALE)
}

fn find_best_position(
    source: &GrayImage,
    template: &GrayImage,
    min_x: u32,
    min_y: u32,
    max_xy: Option<(u32, u32)>,
) -> Option<(u32, u32, f32)> {
    let (sw, sh) = source.dimensions();
    let (tw, th) = template.dimensions();
    if tw > sw || th > sh {
        return None;
    }

    let max_x_limit = sw - tw;
    let max_y_limit = sh - th;
    let (max_x, max_y) = max_xy.unwrap_or((max_x_limit, max_y_limit));
    let min_x = min_x.min(max_x_limit);
    let min_y = min_y.min(max_y_limit);
    let max_x = max_x.min(max_x_limit);
    let max_y = max_y.min(max_y_limit);

    if min_x > max_x || min_y > max_y {
        return None;
    }

    let total_pixels = (tw * th) as f32;
    let mut best = f32::MAX;
    let mut best_x = min_x;
    let mut best_y = min_y;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let mut sum_abs_diff: f32 = 0.0;
            let mut aborted = false;
            let early_exit_threshold = best * total_pixels * 255.0;

            for py in 0..th {
                for px in 0..tw {
                    let s = source.get_pixel(x + px, y + py).0[0] as f32;
                    let t = template.get_pixel(px, py).0[0] as f32;
                    sum_abs_diff += (s - t).abs();
                }

                if sum_abs_diff > early_exit_threshold {
                    aborted = true;
                    break;
                }
            }

            if aborted {
                continue;
            }

            let normalized = sum_abs_diff / (total_pixels * 255.0);
            if normalized < best {
                best = normalized;
                best_x = x;
                best_y = y;
            }
        }
    }

    if best.is_finite() {
        Some((best_x, best_y, best.clamp(0.0, 1.0)))
    } else {
        None
    }
}

use crate::error::{CommandFlowError, CommandResult};
use serde::{Deserialize, Serialize};
use windows::core::{HRESULT, Interface};
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationElementArray,
    IUIAutomationTreeWalker, TreeScope_Children, TreeScope_Subtree,
};

const RPC_E_CHANGED_MODE: HRESULT = HRESULT(0x80010106u32 as i32);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiElementRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiElementLocator {
    pub fingerprint: String,
    pub name: Option<String>,
    pub class_name: Option<String>,
    pub automation_id: Option<String>,
    pub control_type: Option<i32>,
    pub process_id: Option<u32>,
    pub top_level_hwnd: Option<i64>,
    pub top_level_name: Option<String>,
    pub top_level_class_name: Option<String>,
    pub parent_name: Option<String>,
    pub parent_class_name: Option<String>,
    pub parent_automation_id: Option<String>,
    pub parent_control_type: Option<i32>,
    pub relative_index: Option<u32>,
    pub fallback_x: Option<i32>,
    pub fallback_y: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiElementPreview {
    pub name: String,
    pub class_name: String,
    pub automation_id: String,
    pub control_type: i32,
    pub process_id: u32,
    pub rect: UiElementRect,
    pub center_x: i32,
    pub center_y: i32,
    pub locator: UiElementLocator,
    pub summary: String,
}

#[derive(Debug, Clone)]
struct ElementSnapshot {
    name: String,
    class_name: String,
    automation_id: String,
    control_type: i32,
    process_id: u32,
    rect: RECT,
    top_level_hwnd: i64,
    top_level_name: String,
    top_level_class_name: String,
    parent_name: String,
    parent_class_name: String,
    parent_automation_id: String,
    parent_control_type: i32,
    relative_index: u32,
}

pub fn inspect_element_at_point(x: i32, y: i32) -> CommandResult<Option<UiElementPreview>> {
    with_automation(|automation| {
        let element = unsafe { automation.ElementFromPoint(POINT { x, y }) }
            .map_err(|error| CommandFlowError::Automation(format!("UIA ElementFromPoint 失败：{}", error)))?;
        let walker = unsafe { automation.ControlViewWalker() }
            .map_err(|error| CommandFlowError::Automation(format!("UIA 获取 TreeWalker 失败：{}", error)))?;
        let snapshot = snapshot_element(automation, &walker, &element)?;
        Ok(Some(to_preview(snapshot)))
    })
}

pub fn resolve_locator_center(locator: &UiElementLocator) -> CommandResult<(i32, i32)> {
    let result = resolve_locator(locator)?;
    Ok((result.center_x, result.center_y))
}

pub fn resolve_locator(locator: &UiElementLocator) -> CommandResult<UiElementPreview> {
    with_automation(|automation| {
        let walker = unsafe { automation.ControlViewWalker() }
            .map_err(|error| CommandFlowError::Automation(format!("UIA 获取 TreeWalker 失败：{}", error)))?;
        let expected_name = normalize_option(&locator.name);

        let root = if let Some(hwnd_value) = locator.top_level_hwnd {
            if hwnd_value > 0 {
                unsafe {
                    automation.ElementFromHandle(HWND(hwnd_value as *mut core::ffi::c_void))
                }
                .ok()
                    .or_else(|| unsafe { automation.GetRootElement() }.ok())
                    .ok_or_else(|| CommandFlowError::Automation("无法获取 UIA 根元素。".to_string()))?
            } else {
                unsafe { automation.GetRootElement() }
                    .map_err(|error| CommandFlowError::Automation(format!("UIA 获取 RootElement 失败：{}", error)))?
            }
        } else {
            unsafe { automation.GetRootElement() }
                .map_err(|error| CommandFlowError::Automation(format!("UIA 获取 RootElement 失败：{}", error)))?
        };

        let candidates = collect_descendants(automation, &root)?;
        let mut best: Option<(i32, ElementSnapshot)> = None;
        let mut best_name_exact: Option<(i32, ElementSnapshot)> = None;
        let mut best_name_contains: Option<(i32, ElementSnapshot)> = None;

        for candidate in candidates {
            let snapshot = snapshot_element(automation, &walker, &candidate)?;
            if snapshot.rect.right <= snapshot.rect.left || snapshot.rect.bottom <= snapshot.rect.top {
                continue;
            }

            let score = score_snapshot(locator, &snapshot);
            if score <= 0 {
                continue;
            }

            if let Some(expected) = expected_name.as_ref() {
                let actual = normalize(&snapshot.name);
                if actual == *expected {
                    match &best_name_exact {
                        Some((best_score, _)) if *best_score >= score => {}
                        _ => {
                            best_name_exact = Some((score, snapshot.clone()));
                        }
                    }
                } else if !actual.is_empty() && actual.contains(expected) {
                    match &best_name_contains {
                        Some((best_score, _)) if *best_score >= score => {}
                        _ => {
                            best_name_contains = Some((score, snapshot.clone()));
                        }
                    }
                }
            }

            match &best {
                Some((best_score, _)) if *best_score >= score => {}
                _ => {
                    best = Some((score, snapshot));
                }
            }
        }

        if let Some((_, snapshot)) = best_name_exact {
            return Ok(to_preview(snapshot));
        }

        if let Some((_, snapshot)) = best_name_contains {
            return Ok(to_preview(snapshot));
        }

        if let Some((_, snapshot)) = best {
            return Ok(to_preview(snapshot));
        }

        if let (Some(x), Some(y)) = (locator.fallback_x, locator.fallback_y) {
            if let Some(preview) = inspect_element_at_point(x, y)? {
                return Ok(preview);
            }
        }

        Err(CommandFlowError::Automation(format!(
            "未找到匹配元素：{}",
            locator.fingerprint
        )))
    })
}

fn with_automation<T>(run: impl FnOnce(&IUIAutomation) -> CommandResult<T>) -> CommandResult<T> {
    let mut did_init = false;

    let init_hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if init_hr.is_ok() {
        did_init = true;
    } else if init_hr != RPC_E_CHANGED_MODE {
        return Err(CommandFlowError::Automation(format!(
            "初始化 COM 失败：{:?}",
            init_hr
        )));
    }

    let automation = unsafe {
        CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
    }
    .map_err(|error| CommandFlowError::Automation(format!("创建 CUIAutomation 失败：{}", error)))?;

    let result = run(&automation);

    if did_init {
        unsafe {
            CoUninitialize();
        }
    }

    result
}

fn snapshot_element(
    automation: &IUIAutomation,
    walker: &IUIAutomationTreeWalker,
    element: &IUIAutomationElement,
) -> CommandResult<ElementSnapshot> {
    let name = safe_current_name(element);
    let class_name = safe_current_class_name(element);
    let automation_id = safe_current_automation_id(element);
    let control_type = safe_current_control_type(element);
    let process_id = safe_current_process_id(element);
    let rect = safe_current_rect(element);

    let parent = unsafe { walker.GetParentElement(element) }.ok();
    let (parent_name, parent_class_name, parent_automation_id, parent_control_type) = if let Some(parent) = parent.as_ref() {
        (
            safe_current_name(parent),
            safe_current_class_name(parent),
            safe_current_automation_id(parent),
            safe_current_control_type(parent),
        )
    } else {
        (String::new(), String::new(), String::new(), 0)
    };

    let relative_index = parent
        .as_ref()
        .map(|parent| sibling_index(automation, parent, element).unwrap_or(0))
        .unwrap_or(0);

    let (top_level_hwnd, top_level_name, top_level_class_name) = top_level_signature(walker, element);

    Ok(ElementSnapshot {
        name,
        class_name,
        automation_id,
        control_type,
        process_id,
        rect,
        top_level_hwnd,
        top_level_name,
        top_level_class_name,
        parent_name,
        parent_class_name,
        parent_automation_id,
        parent_control_type,
        relative_index,
    })
}

fn top_level_signature(walker: &IUIAutomationTreeWalker, element: &IUIAutomationElement) -> (i64, String, String) {
    let mut current = element.clone();
    let mut last = current.clone();

    while let Ok(parent) = unsafe { walker.GetParentElement(&current) } {
        last = parent.clone();
        current = parent;
    }

    let hwnd = safe_current_hwnd(&last);
    (
        hwnd,
        safe_current_name(&last),
        safe_current_class_name(&last),
    )
}

fn collect_descendants(
    automation: &IUIAutomation,
    root: &IUIAutomationElement,
) -> CommandResult<Vec<IUIAutomationElement>> {
    let condition = unsafe { automation.CreateTrueCondition() }
        .map_err(|error| CommandFlowError::Automation(format!("UIA CreateTrueCondition 失败：{}", error)))?;

    let array = unsafe { root.FindAll(TreeScope_Subtree, &condition) }
        .map_err(|error| CommandFlowError::Automation(format!("UIA FindAll 失败：{}", error)))?;

    read_element_array(&array)
}

fn read_element_array(array: &IUIAutomationElementArray) -> CommandResult<Vec<IUIAutomationElement>> {
    let len = unsafe { array.Length() }
        .map_err(|error| CommandFlowError::Automation(format!("UIA 读取数组长度失败：{}", error)))?;

    let mut out = Vec::with_capacity(len as usize);
    for idx in 0..len {
        let element = unsafe { array.GetElement(idx) }
            .map_err(|error| CommandFlowError::Automation(format!("UIA 读取元素失败：{}", error)))?;
        out.push(element);
    }

    Ok(out)
}

fn sibling_index(
    automation: &IUIAutomation,
    parent: &IUIAutomationElement,
    target: &IUIAutomationElement,
) -> CommandResult<u32> {
    let condition = unsafe { automation.CreateTrueCondition() }
        .map_err(|error| CommandFlowError::Automation(format!("UIA CreateTrueCondition 失败：{}", error)))?;

    let children = unsafe { parent.FindAll(TreeScope_Children, &condition) }
        .map_err(|error| CommandFlowError::Automation(format!("UIA 查找子节点失败：{}", error)))?;

    let len = unsafe { children.Length() }
        .map_err(|error| CommandFlowError::Automation(format!("UIA 读取子节点长度失败：{}", error)))?;

    for i in 0..len {
        let child = unsafe { children.GetElement(i) }
            .map_err(|error| CommandFlowError::Automation(format!("UIA 读取子节点失败：{}", error)))?;

        if child.as_raw() == target.as_raw() {
            return Ok((i + 1) as u32);
        }
    }

    Ok(0)
}

fn score_snapshot(locator: &UiElementLocator, snapshot: &ElementSnapshot) -> i32 {
    let mut score = 0;
    let has_expected_name = normalize_option(&locator.name).is_some();

    if let Some(expected) = normalize_option(&locator.automation_id) {
        if expected == normalize(&snapshot.automation_id) {
            score += 140;
        } else {
            score -= if has_expected_name { 4 } else { 10 };
        }
    }

    if let Some(expected) = normalize_option(&locator.class_name) {
        if expected == normalize(&snapshot.class_name) {
            score += 55;
        } else {
            score -= if has_expected_name { 3 } else { 8 };
        }
    }

    if let Some(expected) = normalize_option(&locator.name) {
        if expected == normalize(&snapshot.name) {
            score += 220;
        } else if normalize(&snapshot.name).contains(&expected) {
            score += 120;
        } else {
            score -= 22;
        }
    }

    if let Some(expected) = locator.control_type {
        if expected == snapshot.control_type {
            score += 26;
        }
    }

    if let Some(expected) = locator.process_id {
        if expected == snapshot.process_id {
            score += 16;
        } else {
            score -= if has_expected_name { 4 } else { 14 };
        }
    }

    if let Some(expected) = locator.top_level_hwnd {
        if expected > 0 && expected == snapshot.top_level_hwnd {
            score += 30;
        }
    }

    if let Some(expected) = normalize_option(&locator.top_level_class_name) {
        if expected == normalize(&snapshot.top_level_class_name) {
            score += 18;
        }
    }

    if let Some(expected) = normalize_option(&locator.top_level_name) {
        if expected == normalize(&snapshot.top_level_name) {
            score += 18;
        }
    }

    if let Some(expected) = normalize_option(&locator.parent_automation_id) {
        if expected == normalize(&snapshot.parent_automation_id) {
            score += 42;
        }
    }

    if let Some(expected) = normalize_option(&locator.parent_class_name) {
        if expected == normalize(&snapshot.parent_class_name) {
            score += 24;
        }
    }

    if let Some(expected) = normalize_option(&locator.parent_name) {
        if expected == normalize(&snapshot.parent_name) {
            score += 20;
        }
    }

    if let Some(expected) = locator.parent_control_type {
        if expected == snapshot.parent_control_type {
            score += 12;
        }
    }

    if let Some(expected) = locator.relative_index {
        if expected == snapshot.relative_index {
            score += 20;
        }
    }

    score
}

fn normalize_option(value: &Option<String>) -> Option<String> {
    value.as_ref().map(|v| normalize(v)).filter(|v| !v.is_empty())
}

fn normalize(value: &str) -> String {
    value.trim().to_lowercase()
}

fn to_preview(snapshot: ElementSnapshot) -> UiElementPreview {
    let center_x = (snapshot.rect.left + snapshot.rect.right) / 2;
    let center_y = (snapshot.rect.top + snapshot.rect.bottom) / 2;

    let fingerprint = build_fingerprint(&snapshot);
    let summary = if snapshot.automation_id.trim().is_empty() {
        format!(
            "类名是{}，名字是‘{}’，相对父级位置是第{}个",
            fallback_text(&snapshot.class_name, "(未知类名)"),
            fallback_text(&snapshot.name, "(无名称)"),
            snapshot.relative_index.max(1)
        )
    } else {
        format!(
            "automationId='{}'，类名='{}'，名字='{}'",
            snapshot.automation_id,
            fallback_text(&snapshot.class_name, "(未知类名)"),
            fallback_text(&snapshot.name, "(无名称)")
        )
    };

    UiElementPreview {
        name: snapshot.name.clone(),
        class_name: snapshot.class_name.clone(),
        automation_id: snapshot.automation_id.clone(),
        control_type: snapshot.control_type,
        process_id: snapshot.process_id,
        rect: UiElementRect {
            left: snapshot.rect.left,
            top: snapshot.rect.top,
            right: snapshot.rect.right,
            bottom: snapshot.rect.bottom,
        },
        center_x,
        center_y,
        locator: UiElementLocator {
            fingerprint,
            name: optional(snapshot.name.clone()),
            class_name: optional(snapshot.class_name.clone()),
            automation_id: optional(snapshot.automation_id.clone()),
            control_type: Some(snapshot.control_type),
            process_id: Some(snapshot.process_id),
            top_level_hwnd: if snapshot.top_level_hwnd > 0 {
                Some(snapshot.top_level_hwnd)
            } else {
                None
            },
            top_level_name: optional(snapshot.top_level_name.clone()),
            top_level_class_name: optional(snapshot.top_level_class_name.clone()),
            parent_name: optional(snapshot.parent_name.clone()),
            parent_class_name: optional(snapshot.parent_class_name.clone()),
            parent_automation_id: optional(snapshot.parent_automation_id.clone()),
            parent_control_type: if snapshot.parent_control_type > 0 {
                Some(snapshot.parent_control_type)
            } else {
                None
            },
            relative_index: Some(snapshot.relative_index.max(1)),
            fallback_x: Some(center_x),
            fallback_y: Some(center_y),
        },
        summary,
    }
}

fn build_fingerprint(snapshot: &ElementSnapshot) -> String {
    if !snapshot.automation_id.trim().is_empty() {
        return format!(
            "aid:{}|class:{}|name:{}|ctrl:{}|pid:{}|top:{}",
            snapshot.automation_id,
            snapshot.class_name,
            snapshot.name,
            snapshot.control_type,
            snapshot.process_id,
            snapshot.top_level_hwnd
        );
    }

    format!(
        "class:{}|name:{}|parentClass:{}|parentName:{}|idx:{}|ctrl:{}|pid:{}|topClass:{}",
        snapshot.class_name,
        snapshot.name,
        snapshot.parent_class_name,
        snapshot.parent_name,
        snapshot.relative_index,
        snapshot.control_type,
        snapshot.process_id,
        snapshot.top_level_class_name
    )
}

fn optional(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn fallback_text<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

fn safe_current_name(element: &IUIAutomationElement) -> String {
    unsafe { element.CurrentName() }
        .map(|b| b.to_string())
        .unwrap_or_default()
}

fn safe_current_class_name(element: &IUIAutomationElement) -> String {
    unsafe { element.CurrentClassName() }
        .map(|b| b.to_string())
        .unwrap_or_default()
}

fn safe_current_automation_id(element: &IUIAutomationElement) -> String {
    unsafe { element.CurrentAutomationId() }
        .map(|b| b.to_string())
        .unwrap_or_default()
}

fn safe_current_control_type(element: &IUIAutomationElement) -> i32 {
    unsafe { element.CurrentControlType() }
        .map(|value| value.0)
        .unwrap_or_default()
}

fn safe_current_process_id(element: &IUIAutomationElement) -> u32 {
    unsafe { element.CurrentProcessId() }.unwrap_or_default() as u32
}

fn safe_current_hwnd(element: &IUIAutomationElement) -> i64 {
    unsafe { element.CurrentNativeWindowHandle() }
        .map(|hwnd| hwnd.0 as i64)
        .unwrap_or_default()
}

fn safe_current_rect(element: &IUIAutomationElement) -> RECT {
    unsafe { element.CurrentBoundingRectangle() }.unwrap_or(RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    })
}

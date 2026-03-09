import type { NodeKind } from '../types/workflow'

export type ParamFieldType = 'string' | 'number' | 'boolean' | 'select' | 'json' | 'text'

const WINDOW_ADVANCED_FIELD_KEYS = ['programPath', 'className', 'processId']

export type SystemOperationKind =
  | 'shutdown'
  | 'restart'
  | 'sleep'
  | 'hibernate'
  | 'lock'
  | 'signOut'
  | 'volumeMute'
  | 'volumeSet'
  | 'volumeAdjust'
  | 'brightnessSet'
  | 'wifiSwitch'
  | 'bluetoothSwitch'
  | 'networkAdapterSwitch'
  | 'theme'
  | 'powerPlan'
  | 'openSettings'

export type FileOperationKind = 'copy' | 'move' | 'delete' | 'readText' | 'writeText'

export type MouseOperationKind = 'click' | 'move' | 'drag' | 'wheel' | 'down' | 'up'

export type KeyboardOperationKind = 'key' | 'input' | 'down' | 'up' | 'shortcut'

export interface ParamField {
  key: string
  label: string
  type: ParamFieldType
  placeholder?: string
  description?: string
  min?: number
  max?: number
  step?: number
  options?: Array<{ label: string; value: string }>
}

export interface NodeMeta {
  label: string
  description: string
  fields: ParamField[]
  defaultParams: Record<string, unknown>
}

export const SYSTEM_OPERATION_OPTIONS: Array<{ label: string; value: SystemOperationKind }> = [
  { label: '系统关机', value: 'shutdown' },
  { label: '系统重启', value: 'restart' },
  { label: '系统睡眠', value: 'sleep' },
  { label: '系统休眠', value: 'hibernate' },
  { label: '锁定系统', value: 'lock' },
  { label: '注销登录', value: 'signOut' },
  { label: '系统音量静音', value: 'volumeMute' },
  { label: '系统音量设置', value: 'volumeSet' },
  { label: '系统音量增减', value: 'volumeAdjust' },
  { label: '系统亮度设置', value: 'brightnessSet' },
  { label: 'WiFi 开关', value: 'wifiSwitch' },
  { label: '蓝牙开关', value: 'bluetoothSwitch' },
  { label: '网络适配器开关', value: 'networkAdapterSwitch' },
  { label: '系统主题模式', value: 'theme' },
  { label: '电源计划', value: 'powerPlan' },
  { label: '打开系统设置页', value: 'openSettings' },
]

export const FILE_OPERATION_OPTIONS: Array<{ label: string; value: FileOperationKind }> = [
  { label: '复制文件/文件夹', value: 'copy' },
  { label: '移动文件/文件夹', value: 'move' },
  { label: '删除文件/文件夹', value: 'delete' },
  { label: '读取文本文件', value: 'readText' },
  { label: '写入文本文件', value: 'writeText' },
]

export const MOUSE_OPERATION_OPTIONS: Array<{ label: string; value: MouseOperationKind }> = [
  { label: '鼠标点击', value: 'click' },
  { label: '鼠标移动', value: 'move' },
  { label: '鼠标拖拽', value: 'drag' },
  { label: '鼠标滚轮', value: 'wheel' },
  { label: '鼠标按下', value: 'down' },
  { label: '鼠标松开', value: 'up' },
]

export const KEYBOARD_OPERATION_OPTIONS: Array<{ label: string; value: KeyboardOperationKind }> = [
  { label: '键盘按键', value: 'key' },
  { label: '键盘输入', value: 'input' },
  { label: '键盘按下', value: 'down' },
  { label: '键盘松开', value: 'up' },
  { label: '组合键', value: 'shortcut' },
]

const SYSTEM_OPERATION_FIELD_KEYS: Record<SystemOperationKind, string[]> = {
  shutdown: ['timeoutSec', 'force'],
  restart: ['timeoutSec', 'force'],
  sleep: [],
  hibernate: [],
  lock: [],
  signOut: ['force'],
  volumeMute: ['mode'],
  volumeSet: ['percent'],
  volumeAdjust: ['delta'],
  brightnessSet: ['percent'],
  wifiSwitch: ['state'],
  bluetoothSwitch: ['state'],
  networkAdapterSwitch: ['adapterName', 'state'],
  theme: ['mode'],
  powerPlan: ['plan'],
  openSettings: ['page'],
}

const FILE_OPERATION_FIELD_KEYS: Record<FileOperationKind, string[]> = {
  copy: ['sourcePath', 'targetPath', 'overwrite', 'recursive'],
  move: ['sourcePath', 'targetPath', 'overwrite'],
  delete: ['path', 'recursive'],
  readText: ['path', 'outputVar'],
  writeText: ['path', 'inputMode', 'inputText', 'inputVar', 'append', 'createParentDir'],
}

const MOUSE_OPERATION_FIELD_KEYS: Record<MouseOperationKind, string[]> = {
  click: ['x', 'y', 'times'],
  move: ['x', 'y'],
  drag: ['fromX', 'fromY', 'toX', 'toY'],
  wheel: ['vertical'],
  down: ['x', 'y', 'button'],
  up: ['x', 'y', 'button'],
}

const KEYBOARD_OPERATION_FIELD_KEYS: Record<KeyboardOperationKind, string[]> = {
  key: ['key'],
  input: ['text'],
  down: ['key', 'simulateRepeat', 'repeatCount', 'repeatIntervalMs'],
  up: ['key'],
  shortcut: ['modifiers', 'key'],
}

export const getSystemOperationKind = (
  params: Record<string, unknown>,
  defaultOperation: SystemOperationKind = 'shutdown',
): SystemOperationKind => {
  const operation = String(params.operation ?? defaultOperation)
  return SYSTEM_OPERATION_OPTIONS.some((item) => item.value === operation)
    ? (operation as SystemOperationKind)
    : defaultOperation
}

export const getFileOperationKind = (
  params: Record<string, unknown>,
  defaultOperation: FileOperationKind = 'copy',
): FileOperationKind => {
  const operation = String(params.operation ?? defaultOperation)
  return FILE_OPERATION_OPTIONS.some((item) => item.value === operation)
    ? (operation as FileOperationKind)
    : defaultOperation
}

export const getMouseOperationKind = (
  params: Record<string, unknown>,
  defaultOperation: MouseOperationKind = 'click',
): MouseOperationKind => {
  const operation = String(params.operation ?? defaultOperation)
  return MOUSE_OPERATION_OPTIONS.some((item) => item.value === operation)
    ? (operation as MouseOperationKind)
    : defaultOperation
}

export const getKeyboardOperationKind = (
  params: Record<string, unknown>,
  defaultOperation: KeyboardOperationKind = 'key',
): KeyboardOperationKind => {
  const operation = String(params.operation ?? defaultOperation)
  return KEYBOARD_OPERATION_OPTIONS.some((item) => item.value === operation)
    ? (operation as KeyboardOperationKind)
    : defaultOperation
}

export const getSystemOperationLabel = (
  params: Record<string, unknown>,
  defaultOperation: SystemOperationKind = 'shutdown',
): string => {
  const operation = getSystemOperationKind(params, defaultOperation)
  return SYSTEM_OPERATION_OPTIONS.find((item) => item.value === operation)?.label ?? '系统操作'
}

export const getFileOperationLabel = (
  params: Record<string, unknown>,
  defaultOperation: FileOperationKind = 'copy',
): string => {
  const operation = getFileOperationKind(params, defaultOperation)
  return FILE_OPERATION_OPTIONS.find((item) => item.value === operation)?.label ?? '文件操作'
}

export const getMouseOperationLabel = (
  params: Record<string, unknown>,
  defaultOperation: MouseOperationKind = 'click',
): string => {
  const operation = getMouseOperationKind(params, defaultOperation)
  return MOUSE_OPERATION_OPTIONS.find((item) => item.value === operation)?.label ?? '鼠标操作'
}

export const getKeyboardOperationLabel = (
  params: Record<string, unknown>,
  defaultOperation: KeyboardOperationKind = 'key',
): string => {
  const operation = getKeyboardOperationKind(params, defaultOperation)
  return KEYBOARD_OPERATION_OPTIONS.find((item) => item.value === operation)?.label ?? '键盘操作'
}

export const getNodeDisplayLabel = (
  kind: NodeKind,
  params: Record<string, unknown> = {},
  fallbackLabel?: string,
): string => {
  if (kind === 'launchApplication') {
    const appName = String(params.appName ?? '').trim()
    return appName ? `启动应用 · ${appName}` : (fallbackLabel ?? getNodeMeta(kind).label)
  }

  if (kind === 'systemOperation') {
    return getSystemOperationLabel(params, getSystemOperationKind(getNodeMeta(kind).defaultParams))
  }

  if (kind === 'fileOperation') {
    return getFileOperationLabel(params, getFileOperationKind(getNodeMeta(kind).defaultParams))
  }

  if (kind === 'mouseOperation') {
    return getMouseOperationLabel(params, getMouseOperationKind(getNodeMeta(kind).defaultParams))
  }

  if (kind === 'keyboardOperation') {
    return getKeyboardOperationLabel(params, getKeyboardOperationKind(getNodeMeta(kind).defaultParams))
  }

  return fallbackLabel ?? getNodeMeta(kind).label
}

export const isNodeFieldVisible = (
  kind: NodeKind,
  field: ParamField,
  params: Record<string, unknown>,
  defaultParams: Record<string, unknown> = {},
) => {
  if (kind === 'systemOperation') {
    if (field.key === 'operation') return true
    const operation = getSystemOperationKind(
      params,
      getSystemOperationKind(defaultParams, 'shutdown'),
    )
    return SYSTEM_OPERATION_FIELD_KEYS[operation].includes(field.key)
  }

  if (kind === 'fileOperation') {
    if (field.key === 'operation') return true
    const operation = getFileOperationKind(
      params,
      getFileOperationKind(defaultParams, 'copy'),
    )
    if (!FILE_OPERATION_FIELD_KEYS[operation].includes(field.key)) {
      return false
    }

    if ((field.key === 'inputText' || field.key === 'inputVar') && operation === 'writeText') {
      const inputMode = String(params.inputMode ?? defaultParams.inputMode ?? 'literal')
      if (field.key === 'inputText') return inputMode === 'literal'
      if (field.key === 'inputVar') return inputMode === 'var'
    }

    return true
  }

  if (kind === 'mouseOperation') {
    if (field.key === 'operation') return true
    const operation = getMouseOperationKind(
      params,
      getMouseOperationKind(defaultParams, 'click'),
    )
    return MOUSE_OPERATION_FIELD_KEYS[operation].includes(field.key)
  }

  if (kind === 'keyboardOperation') {
    if (field.key === 'operation') return true
    const operation = getKeyboardOperationKind(
      params,
      getKeyboardOperationKind(defaultParams, 'key'),
    )
    if (!KEYBOARD_OPERATION_FIELD_KEYS[operation].includes(field.key)) {
      return false
    }
    if ((field.key === 'repeatCount' || field.key === 'repeatIntervalMs') && operation === 'down') {
      return Boolean(params.simulateRepeat ?? defaultParams.simulateRepeat ?? false)
    }
    return true
  }

  if (kind === 'guiAgent') {
    const continuousMode = Boolean(params.continuousMode ?? defaultParams.continuousMode ?? true)
    if (field.key === 'imageInput') {
      return !continuousMode
    }
    if (field.key === 'maxSteps') {
      return continuousMode
    }
    if (field.key === 'systemPrompt') {
      return false
    }
  }

  if (kind === 'windowActivate') {
    const mode = String(params.switchMode ?? defaultParams.switchMode ?? 'title')
    if (mode === 'title') {
      return !['program', 'shortcut', 'shortcutTimes', 'shortcutIntervalMs'].includes(field.key)
    }
    if (mode === 'program') {
      return !['title', 'shortcut', 'shortcutTimes', 'shortcutIntervalMs'].includes(field.key)
    }
    if (mode === 'shortcut') {
      return !['title', 'program', 'matchMode', ...WINDOW_ADVANCED_FIELD_KEYS].includes(field.key)
    }
  }

  if (kind === 'windowTrigger') {
    const target = String(params.matchTarget ?? defaultParams.matchTarget ?? 'title')
    if (target === 'title') {
      return field.key !== 'program'
    }
    if (target === 'program') {
      return field.key !== 'title'
    }
  }

  if (kind === 'varMath' && field.key === 'operand') {
    const unaryOperations = new Set([
      'neg',
      'abs',
      'sign',
      'square',
      'cube',
      'sqrt',
      'cbrt',
      'exp',
      'ln',
      'log2',
      'log10',
      'sin',
      'cos',
      'tan',
      'asin',
      'acos',
      'atan',
      'ceil',
      'floor',
      'round',
      'trunc',
      'frac',
      'recip',
      'lnot',
      'bnot',
    ])
    const operation = String(params.operation ?? defaultParams.operation ?? 'add')
    return !unaryOperations.has(operation)
  }

  if ((kind === 'varDefine' || kind === 'varSet' || kind === 'constValue') && field.key.startsWith('value')) {
    const valueType = String(params.valueType ?? defaultParams.valueType ?? 'number')
    if (field.key === 'valueType') return true
    if (field.key === 'valueString') return valueType === 'string'
    if (field.key === 'valueNumber') return valueType === 'number'
    if (field.key === 'valueBoolean') return valueType === 'boolean'
    if (field.key === 'valueJson') return valueType === 'json'
    return false
  }

  if (kind === 'varMath' && field.key.startsWith('operand')) {
    const unaryOperations = new Set([
      'neg',
      'abs',
      'sign',
      'square',
      'cube',
      'sqrt',
      'cbrt',
      'exp',
      'ln',
      'log2',
      'log10',
      'sin',
      'cos',
      'tan',
      'asin',
      'acos',
      'atan',
      'ceil',
      'floor',
      'round',
      'trunc',
      'frac',
      'recip',
      'lnot',
      'bnot',
    ])
    const operation = String(params.operation ?? defaultParams.operation ?? 'add')
    if (unaryOperations.has(operation)) {
      return field.key === 'operandType'
    }

    const operandType = String(params.operandType ?? defaultParams.operandType ?? 'number')
    if (field.key === 'operandType') return true
    if (field.key === 'operandNumber') return operandType === 'number'
    if (field.key === 'operandString') return operandType === 'string'
    if (field.key === 'operandBoolean') return operandType === 'boolean'
    if (field.key === 'operandJson') return operandType === 'json'
    return false
  }

  if (
    (kind === 'clipboardWrite' || kind === 'showMessage') &&
    (field.key === 'inputText' || field.key === 'inputVar')
  ) {
    const inputMode = String(params.inputMode ?? defaultParams.inputMode ?? 'literal')
    if (field.key === 'inputText') return inputMode === 'literal'
    if (field.key === 'inputVar') return inputMode === 'var'
  }

  return true
}

const resolveSystemOperationField = (
  field: ParamField,
  operation: SystemOperationKind,
): ParamField => {
  if (field.key === 'mode') {
    if (operation === 'theme') {
      return {
        ...field,
        label: '主题模式',
        options: [
          { label: '深色', value: 'dark' },
          { label: '浅色', value: 'light' },
        ],
      }
    }

    return {
      ...field,
      label: '静音模式',
      options: [
        { label: '切换', value: 'toggle' },
        { label: '静音', value: 'mute' },
        { label: '取消静音', value: 'unmute' },
      ],
    }
  }

  if (field.key === 'percent') {
    return {
      ...field,
      label: operation === 'brightnessSet' ? '亮度(%)' : '音量(%)',
    }
  }

  if (field.key === 'state' && operation === 'networkAdapterSwitch') {
    return {
      ...field,
      options: [
        { label: '切换', value: 'toggle' },
        { label: '启用', value: 'on' },
        { label: '禁用', value: 'off' },
      ],
    }
  }

  return field
}

const resolveFileOperationField = (
  field: ParamField,
  operation: FileOperationKind,
): ParamField => {
  if (field.key === 'sourcePath') {
    return {
      ...field,
      label: '源路径',
      placeholder: operation === 'move' ? 'C:\\input\\folder-a' : 'C:\\input\\a.txt',
    }
  }

  if (field.key === 'targetPath') {
    return {
      ...field,
      label: '目标路径',
      placeholder: operation === 'move' ? 'D:\\output\\folder-a' : 'D:\\output\\a.txt',
    }
  }

  if (field.key === 'path') {
    return {
      ...field,
      label:
        operation === 'delete'
          ? '路径'
          : operation === 'readText' || operation === 'writeText'
            ? '文件路径'
            : '路径',
      placeholder:
        operation === 'delete'
          ? 'D:\\temp\\old-folder'
          : operation === 'readText'
            ? 'C:\\temp\\note.txt'
            : operation === 'writeText'
              ? 'D:\\output\\result.txt'
              : 'D:\\temp\\path',
    }
  }

  if (field.key === 'recursive') {
    return {
      ...field,
      label: operation === 'delete' ? '目录递归删除' : '目录递归复制',
    }
  }

  if (field.key === 'inputText') {
    return {
      ...field,
      label: '文本内容',
      placeholder: '支持多行文本，也支持 {{变量名}} 模板占位。',
    }
  }

  if (field.key === 'inputVar') {
    return {
      ...field,
      label: '变量名',
      placeholder: 'fileText',
    }
  }

  if (field.key === 'outputVar') {
    return {
      ...field,
      label: '输出变量名',
      placeholder: 'fileText',
      description: '读取到的文本将写入该变量；留空则仅记录日志。',
    }
  }

  return field
}

const resolveMouseOperationField = (
  field: ParamField,
  operation: MouseOperationKind,
): ParamField => {
  if ((field.key === 'x' || field.key === 'y') && (operation === 'down' || operation === 'up')) {
    return {
      ...field,
      label: field.key === 'x' ? 'X 坐标' : 'Y 坐标',
    }
  }

  if (field.key === 'vertical' && operation === 'wheel') {
    return {
      ...field,
      label: '滚动值',
    }
  }

  return field
}

const resolveKeyboardOperationField = (
  field: ParamField,
  operation: KeyboardOperationKind,
): ParamField => {
  if (field.key === 'key') {
    return {
      ...field,
      label: operation === 'shortcut' ? '主键' : '按键',
      placeholder: operation === 'shortcut' ? 'S' : 'Enter',
    }
  }

  if (field.key === 'text') {
    return {
      ...field,
      label: '文本',
      placeholder: '请输入文本',
    }
  }

  if (field.key === 'modifiers') {
    return {
      ...field,
      label: '修饰键(JSON数组)',
      description: '例如 ["Ctrl", "Shift"]',
    }
  }

  return field
}

export const getNodeFields = (
  kind: NodeKind,
  params: Record<string, unknown> = {},
  defaultParams: Record<string, unknown> = {},
): ParamField[] => {
  const fields = metas[kind].fields.filter((field) => isNodeFieldVisible(kind, field, params, defaultParams))

  if (kind !== 'systemOperation' && kind !== 'fileOperation') {
    if (kind === 'mouseOperation') {
      const operation = getMouseOperationKind(params, getMouseOperationKind(defaultParams, 'click'))
      return fields.map((field) => resolveMouseOperationField(field, operation))
    }

    if (kind === 'keyboardOperation') {
      const operation = getKeyboardOperationKind(params, getKeyboardOperationKind(defaultParams, 'key'))
      return fields.map((field) => resolveKeyboardOperationField(field, operation))
    }

    return fields
  }

  if (kind === 'fileOperation') {
    const operation = getFileOperationKind(params, getFileOperationKind(defaultParams, 'copy'))
    return fields.map((field) => resolveFileOperationField(field, operation))
  }

  const operation = getSystemOperationKind(params, getSystemOperationKind(defaultParams, 'shutdown'))
  return fields.map((field) => resolveSystemOperationField(field, operation))
}

const metas: Record<NodeKind, NodeMeta> = {
  hotkeyTrigger: {
    label: '热键触发',
    description: '按下设定热键时触发工作流。',
    defaultParams: { hotkey: 'Ctrl+Shift+R' },
    fields: [{ key: 'hotkey', label: '热键', type: 'string', placeholder: 'Ctrl+Shift+R' }],
  },
  timerTrigger: {
    label: '定时触发',
    description: '按时间间隔触发后续节点。',
    defaultParams: { intervalMs: 1000 },
    fields: [{ key: 'intervalMs', label: '等待毫秒', type: 'number', min: 0, step: 100 }],
  },
  manualTrigger: {
    label: '手动触发',
    description: '点击运行按钮后触发工作流。',
    defaultParams: {},
    fields: [],
  },
  windowTrigger: {
    label: '窗口触发',
    description: '检测到指定前台窗口标题或程序时触发。',
    defaultParams: {
      matchTarget: 'title',
      title: 'Untitled - Notepad',
      program: 'notepad.exe',
      matchMode: 'contains',
      programPath: '',
      className: '',
      processId: 0,
    },
    fields: [
      {
        key: 'matchTarget',
        label: '匹配目标',
        type: 'select',
        options: [
          { label: '窗口标题', value: 'title' },
          { label: '窗口程序', value: 'program' },
        ],
      },
      { key: 'title', label: '窗口标题', type: 'string', placeholder: 'Untitled - Notepad' },
      { key: 'program', label: '窗口程序', type: 'string', placeholder: 'notepad.exe' },
      { key: 'programPath', label: '程序路径(可选)', type: 'string', placeholder: 'C:\\Windows\\System32\\notepad.exe' },
      { key: 'className', label: '窗口类名(可选)', type: 'string', placeholder: 'Notepad' },
      { key: 'processId', label: '进程 PID(可选)', type: 'number', min: 0, step: 1 },
      {
        key: 'matchMode',
        label: '匹配方式',
        type: 'select',
        options: [
          { label: '包含', value: 'contains' },
          { label: '完全匹配', value: 'exact' },
        ],
      },
    ],
  },
  mouseOperation: {
    label: '鼠标操作',
    description: '统一的鼠标操作节点；选择操作类型后动态显示对应参数与输出。',
    defaultParams: {
      operation: 'click',
      x: 0,
      y: 0,
      times: 1,
      fromX: 0,
      fromY: 0,
      toX: 200,
      toY: 200,
      vertical: -1,
      button: 'left',
    },
    fields: [
      { key: 'operation', label: '操作类型', type: 'select', options: MOUSE_OPERATION_OPTIONS },
      { key: 'x', label: 'X 坐标', type: 'number', step: 1 },
      { key: 'y', label: 'Y 坐标', type: 'number', step: 1 },
      { key: 'times', label: '点击次数', type: 'number', min: 1, step: 1 },
      { key: 'fromX', label: '起点 X', type: 'number', step: 1 },
      { key: 'fromY', label: '起点 Y', type: 'number', step: 1 },
      { key: 'toX', label: '终点 X', type: 'number', step: 1 },
      { key: 'toY', label: '终点 Y', type: 'number', step: 1 },
      { key: 'vertical', label: '滚动值', type: 'number', step: 1 },
      {
        key: 'button',
        label: '按键',
        type: 'select',
        options: [
          { label: '左键', value: 'left' },
          { label: '右键', value: 'right' },
          { label: '中键', value: 'middle' },
        ],
      },
    ],
  },
  keyboardOperation: {
    label: '键盘操作',
    description: '统一的键盘操作节点；选择操作类型后动态显示对应参数与输出。',
    defaultParams: {
      operation: 'key',
      key: 'Enter',
      text: 'Hello CommandFlow',
      simulateRepeat: false,
      repeatCount: 8,
      repeatIntervalMs: 35,
      modifiers: ['Ctrl'],
    },
    fields: [
      { key: 'operation', label: '操作类型', type: 'select', options: KEYBOARD_OPERATION_OPTIONS },
      { key: 'key', label: '按键', type: 'string', placeholder: 'Enter' },
      { key: 'text', label: '文本', type: 'string', placeholder: '请输入文本' },
      {
        key: 'simulateRepeat',
        label: '模拟长按重复输入',
        type: 'boolean',
        description: '开启后会连续触发多次按键点击，更接近“长按出连字”的效果。',
      },
      { key: 'repeatCount', label: '重复次数', type: 'number', min: 1, step: 1 },
      { key: 'repeatIntervalMs', label: '重复间隔(ms)', type: 'number', min: 1, step: 1 },
      {
        key: 'modifiers',
        label: '修饰键(JSON数组)',
        type: 'json',
        description: '例如 ["Ctrl", "Shift"]',
      },
    ],
  },
  screenshot: {
    label: '屏幕截图',
    description: '执行屏幕截图，可选择是否保存到本地文件夹，并输出截图(base64)。',
    defaultParams: { shouldSave: true, saveDir: '', fullscreen: false, startX: 0, startY: 0, width: 320, height: 240 },
    fields: [
      { key: 'shouldSave', label: '是否保存', type: 'boolean' },
      { key: 'saveDir', label: '保存文件夹', type: 'string', placeholder: 'D:\\captures' },
      { key: 'fullscreen', label: '是否全屏', type: 'boolean' },
      { key: 'startX', label: '起点 X', type: 'number', min: 0, step: 1 },
      { key: 'startY', label: '起点 Y', type: 'number', min: 0, step: 1 },
      { key: 'width', label: '宽度', type: 'number', min: 1, step: 1 },
      { key: 'height', label: '高度', type: 'number', min: 1, step: 1 },
    ],
  },
  guiAgent: {
    label: 'GUI Agent',
    description: '使用多模态 LLM 解析截图并自动执行 GUI 指令。',
    defaultParams: {
      continuousMode: true,
      maxSteps: 20,
      llmPresetId: '',
      imageInput: '',
      stripThink: true,
      instruction: '请根据截图执行下一步操作。',
      systemPrompt: `You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
\`\`\`
Thought: ...
Action: ...
\`\`\`


## Action Space
click(point='<point>x1 y1</point>')
left_double(point='<point>x1 y1</point>')
right_single(point='<point>x1 y1</point>')
drag(start_point='<point>x1 y1</point>', end_point='<point>x2 y2</point>')
hotkey(key='ctrl c') # Split keys with a space and use lowercase. Also, do not use more than 3 keys in one hotkey action.
type(content='xxx') # Use escape characters \\', \\\" and \\n in content part to ensure we can parse the content in normal python string format. If you want to submit your input, use \\n at the end of content.
scroll(point='<point>x1 y1</point>', direction='down or up or right or left') # Show more information on the \`direction\` side.
wait() #Sleep for 5s and take a screenshot to check for any changes.
finished(content='xxx') # Use escape characters \\', \\\" and \\n in content part to ensure we can parse the content in normal python string format.


## Note
- Use Chinese in \`Thought\` part.
- Write a small plan and finally summarize your next action (with its target element) in one sentence in \`Thought\` part.`,
    },
    fields: [
      {
        key: 'continuousMode',
        label: '连续执行模式',
        type: 'boolean',
      },
      {
        key: 'maxSteps',
        label: '最大连续步数',
        type: 'number',
        min: 1,
        step: 1,
      },
      {
        key: 'llmPresetId',
        label: 'LLM 预设',
        type: 'select',
        options: [],
        description: '在设置里维护 LLM 预设，这里仅选择预设。',
      },
      {
        key: 'imageInput',
        label: '输入图片(base64)',
        type: 'string',
        placeholder: '连接图像，或输入base64',
        description: '非连续模式需手动提供图片输入。',
      },
      {
        key: 'instruction',
        label: '指令',
        type: 'string',
        placeholder: '例如：点击登录按钮',
      },
      {
        key: 'systemPrompt',
        label: 'System Prompt',
        type: 'text',
        placeholder: '支持 {instruction} 占位符，将自动替换为识别指令',
      },
    ],
  },
  guiAgentActionParser: {
    label: 'GUI Agent 元数据解析',
    description: '解析 GUI Agent metadata，并按选定动作输出结构化字段。',
    defaultParams: {
      operation: 'click',
      metadata: {
        action: 'click',
      },
    },
    fields: [
      {
        key: 'operation',
        label: '动作类型',
        type: 'select',
        options: [
          { label: 'click', value: 'click' },
          { label: 'left_double', value: 'left_double' },
          { label: 'right_single', value: 'right_single' },
          { label: 'drag', value: 'drag' },
          { label: 'hotkey', value: 'hotkey' },
          { label: 'type', value: 'type' },
          { label: 'scroll', value: 'scroll' },
          { label: 'wait', value: 'wait' },
          { label: 'finished', value: 'finished' },
        ],
      },
      {
        key: 'metadata',
        label: 'Metadata(JSON)',
        type: 'json',
        description: '建议连接 GUI Agent 节点 metadata 输出触点。',
      },
    ],
  },
  windowActivate: {
    label: '切换窗口',
    description: '可按窗口标题、窗口程序切换，或通过 Alt+Tab 等快捷键切换。',
    defaultParams: {
      switchMode: 'title',
      title: 'CommandFlow-rs',
      program: 'commandflow-rs.exe',
      matchMode: 'contains',
      programPath: '',
      className: '',
      processId: 0,
      shortcut: 'Alt+Tab',
      shortcutTimes: 1,
      shortcutIntervalMs: 120,
    },
    fields: [
      {
        key: 'switchMode',
        label: '切换方式',
        type: 'select',
        options: [
          { label: '按窗口标题', value: 'title' },
          { label: '按窗口程序', value: 'program' },
          { label: '按快捷键', value: 'shortcut' },
        ],
      },
      { key: 'title', label: '窗口标题', type: 'string', placeholder: 'CommandFlow-rs' },
      { key: 'program', label: '窗口程序', type: 'string', placeholder: 'commandflow-rs.exe' },
      { key: 'programPath', label: '程序路径(可选)', type: 'string', placeholder: 'D:\\Apps\\CommandFlow-rs\\commandflow-rs.exe' },
      { key: 'className', label: '窗口类名(可选)', type: 'string', placeholder: 'Chrome_WidgetWin_1' },
      { key: 'processId', label: '进程 PID(可选)', type: 'number', min: 0, step: 1 },
      {
        key: 'matchMode',
        label: '匹配方式',
        type: 'select',
        options: [
          { label: '包含', value: 'contains' },
          { label: '完全匹配', value: 'exact' },
        ],
      },
      {
        key: 'shortcut',
        label: '快捷键',
        type: 'select',
        options: [
          { label: 'Alt + Tab（下一个窗口）', value: 'Alt+Tab' },
          { label: 'Alt + Shift + Tab（上一个窗口）', value: 'Alt+Shift+Tab' },
          { label: 'Win + Tab（任务视图）', value: 'Win+Tab' },
          { label: 'Win + 1（任务栏第 1 个应用）', value: 'Win+1' },
          { label: 'Win + 2（任务栏第 2 个应用）', value: 'Win+2' },
          { label: 'Win + 3（任务栏第 3 个应用）', value: 'Win+3' },
          { label: 'Win + 4（任务栏第 4 个应用）', value: 'Win+4' },
          { label: 'Win + 5（任务栏第 5 个应用）', value: 'Win+5' },
          { label: 'Win + 6（任务栏第 6 个应用）', value: 'Win+6' },
          { label: 'Win + 7（任务栏第 7 个应用）', value: 'Win+7' },
          { label: 'Win + 8（任务栏第 8 个应用）', value: 'Win+8' },
          { label: 'Win + 9（任务栏第 9 个应用）', value: 'Win+9' },
          { label: 'Ctrl + Tab（应用内下一个标签）', value: 'Ctrl+Tab' },
          { label: 'Ctrl + Shift + Tab（应用内上一个标签）', value: 'Ctrl+Shift+Tab' },
        ],
      },
      { key: 'shortcutTimes', label: '快捷键次数', type: 'number', min: 1, step: 1 },
      { key: 'shortcutIntervalMs', label: '快捷键间隔(ms)', type: 'number', min: 1, step: 1 },
    ],
  },
  launchApplication: {
    label: '启动应用',
    description: '扫描 Windows 开始菜单中的快捷方式，选择一个有效应用并启动。',
    defaultParams: {
      selectedApp: '',
      appName: '',
      targetPath: '',
      iconPath: '',
      sourcePath: '',
    },
    fields: [
      {
        key: 'selectedApp',
        label: '开始菜单应用',
        type: 'select',
        options: [],
        description: '下拉列表来自系统级与当前用户开始菜单中扫描到的有效快捷方式。',
      },
    ],
  },
  fileOperation: {
    label: '文件操作',
    description: '统一的文件操作节点；先选择复制、移动、删除、读取文本或写入文本，再按需填写对应参数。',
    defaultParams: {
      operation: 'copy',
      sourcePath: '',
      targetPath: '',
      path: '',
      overwrite: false,
      recursive: true,
      inputMode: 'literal',
      inputText: 'Hello File',
      inputVar: 'fileText',
      outputVar: 'fileText',
      append: false,
      createParentDir: true,
    },
    fields: [
      {
        key: 'operation',
        label: '操作类型',
        type: 'select',
        options: FILE_OPERATION_OPTIONS,
      },
      { key: 'sourcePath', label: '源路径', type: 'string', placeholder: 'C:\\input\\a.txt' },
      { key: 'targetPath', label: '目标路径', type: 'string', placeholder: 'D:\\output\\a.txt' },
      { key: 'path', label: '路径', type: 'string', placeholder: 'D:\\temp\\old-folder' },
      { key: 'overwrite', label: '覆盖已存在目标', type: 'boolean' },
      { key: 'recursive', label: '目录递归复制', type: 'boolean' },
      {
        key: 'inputMode',
        label: '输入来源',
        type: 'select',
        options: [
          { label: '文本', value: 'literal' },
          { label: '变量', value: 'var' },
        ],
      },
      {
        key: 'inputText',
        label: '文本内容',
        type: 'text',
        placeholder: '支持多行文本，也支持 {{变量名}} 模板占位。',
      },
      { key: 'inputVar', label: '变量名', type: 'string', placeholder: 'fileText' },
      { key: 'outputVar', label: '输出变量名', type: 'string', placeholder: 'fileText' },
      { key: 'append', label: '追加写入', type: 'boolean' },
      { key: 'createParentDir', label: '自动创建父目录', type: 'boolean' },
    ],
  },
  runCommand: {
    label: '执行命令',
    description: '在系统 shell 中执行命令。',
    defaultParams: { command: 'echo CommandFlow', shell: true },
    fields: [
      { key: 'command', label: '命令', type: 'string', placeholder: 'echo Hello' },
      { key: 'shell', label: '通过 Shell 执行', type: 'boolean' },
    ],
  },
  pythonCode: {
    label: '执行 Python',
    description: '使用系统 Python 执行代码。',
    defaultParams: { code: 'print("Hello CommandFlow")' },
    fields: [
      {
        key: 'code',
        label: 'Python 代码',
        type: 'text',
        placeholder: 'print("Hello")',
        description: '支持多行代码，执行输出会写入执行日志。',
      },
    ],
  },
  clipboardRead: {
    label: '读取剪贴板',
    description: '读取系统剪贴板文本并输出到变量。',
    defaultParams: { outputVar: 'clipboardText' },
    fields: [
      {
        key: 'outputVar',
        label: '输出变量名',
        type: 'string',
        placeholder: 'clipboardText',
        description: '读取到的文本将写入该变量；留空则仅记录日志。',
      },
    ],
  },
  clipboardWrite: {
    label: '写入剪贴板',
    description: '将文本写入系统剪贴板。',
    defaultParams: {
      inputMode: 'literal',
      inputText: 'Hello from CommandFlow',
      inputVar: 'clipboardText',
    },
    fields: [
      {
        key: 'inputMode',
        label: '输入来源',
        type: 'select',
        options: [
          { label: '文本', value: 'literal' },
          { label: '变量', value: 'var' },
        ],
      },
      {
        key: 'inputText',
        label: '文本内容',
        type: 'text',
        placeholder: '支持多行文本，也支持 {{变量名}} 模板占位。',
      },
      {
        key: 'inputVar',
        label: '变量名',
        type: 'string',
        placeholder: 'clipboardText',
      },
    ],
  },
  showMessage: {
    label: '弹窗提示',
    description: '显示系统弹窗消息。',
    defaultParams: {
      title: 'CommandFlow',
      inputMode: 'literal',
      inputText: '执行完成',
      inputVar: 'messageText',
      level: 'info',
    },
    fields: [
      { key: 'title', label: '标题', type: 'string', placeholder: 'CommandFlow' },
      {
        key: 'inputMode',
        label: '消息来源',
        type: 'select',
        options: [
          { label: '文本', value: 'literal' },
          { label: '变量', value: 'var' },
        ],
      },
      {
        key: 'inputText',
        label: '消息内容',
        type: 'text',
        placeholder: '支持多行文本，也支持 {{变量名}} 模板占位。',
      },
      { key: 'inputVar', label: '变量名', type: 'string', placeholder: 'messageText' },
      {
        key: 'level',
        label: '弹窗级别',
        type: 'select',
        options: [
          { label: '信息', value: 'info' },
          { label: '警告', value: 'warning' },
          { label: '错误', value: 'error' },
        ],
      },
    ],
  },
  delay: {
    label: '等待延时',
    description: '暂停指定时间后继续。',
    defaultParams: { ms: 500 },
    fields: [{ key: 'ms', label: '毫秒', type: 'number', min: 0, step: 100 }],
  },
  systemOperation: {
    label: '系统操作',
    description: '统一的系统操作节点；先选择操作类型，再按需填写对应参数。',
    defaultParams: {
      operation: 'shutdown',
      timeoutSec: 0,
      force: false,
      mode: 'toggle',
      percent: 50,
      delta: 10,
      state: 'toggle',
      adapterName: '',
      plan: 'balanced',
      page: 'sound',
    },
    fields: [
      {
        key: 'operation',
        label: '操作类型',
        type: 'select',
        options: SYSTEM_OPERATION_OPTIONS,
      },
      { key: 'timeoutSec', label: '延时秒数', type: 'number', min: 0, step: 1 },
      { key: 'force', label: '强制关闭应用', type: 'boolean' },
      {
        key: 'mode',
        label: '模式',
        type: 'select',
        options: [
          { label: '切换', value: 'toggle' },
          { label: '静音', value: 'mute' },
          { label: '取消静音', value: 'unmute' },
          { label: '深色', value: 'dark' },
          { label: '浅色', value: 'light' },
        ],
      },
      { key: 'percent', label: '百分比(%)', type: 'number', min: 0, max: 100, step: 1 },
      { key: 'delta', label: '变化值(可负数)', type: 'number', min: -100, max: 100, step: 1 },
      {
        key: 'state',
        label: '目标状态',
        type: 'select',
        options: [
          { label: '切换', value: 'toggle' },
          { label: '开启', value: 'on' },
          { label: '关闭', value: 'off' },
        ],
      },
      { key: 'adapterName', label: '适配器名称', type: 'string', placeholder: 'Wi-Fi' },
      {
        key: 'plan',
        label: '电源计划',
        type: 'select',
        options: [
          { label: '平衡', value: 'balanced' },
          { label: '高性能', value: 'highPerformance' },
          { label: '节能', value: 'powerSaver' },
        ],
      },
      {
        key: 'page',
        label: '设置页面',
        type: 'select',
        options: [
          { label: '声音', value: 'sound' },
          { label: '显示', value: 'display' },
          { label: '网络', value: 'network' },
          { label: 'WiFi', value: 'wifi' },
          { label: '蓝牙', value: 'bluetooth' },
          { label: '电源与电池', value: 'power' },
          { label: '系统首页', value: 'system' },
        ],
      },
    ],
  },
  condition: {
    label: '条件判断',
    description: 'if 条件判断。',
    defaultParams: {
      leftType: 'var',
      left: 'counter',
      operator: '==',
      rightType: 'literal',
      right: '1',
    },
    fields: [
      {
        key: 'leftType',
        label: '左值类型',
        type: 'select',
        options: [
          { label: '变量', value: 'var' },
          { label: '字面量', value: 'literal' },
        ],
      },
      { key: 'left', label: '左值', type: 'string', placeholder: 'counter' },
      {
        key: 'operator',
        label: '运算符',
        type: 'select',
        options: [
          { label: '==', value: '==' },
          { label: '!=', value: '!=' },
          { label: '>', value: '>' },
          { label: '>=', value: '>=' },
          { label: '<', value: '<' },
          { label: '<=', value: '<=' },
        ],
      },
      {
        key: 'rightType',
        label: '右值类型',
        type: 'select',
        options: [
          { label: '变量', value: 'var' },
          { label: '字面量', value: 'literal' },
        ],
      },
      { key: 'right', label: '右值', type: 'string', placeholder: '1' },
    ],
  },
  loop: {
    label: 'for 循环',
    description: 'for 条件循环。',
    defaultParams: { times: 3 },
    fields: [{ key: 'times', label: '循环次数', type: 'number', min: 0, step: 1 }],
  },
  whileLoop: {
    label: 'while 循环',
    description: 'while 条件循环。',
    defaultParams: {
      leftType: 'var',
      left: 'counter',
      operator: '<',
      rightType: 'literal',
      right: '10',
      maxIterations: 1000,
    },
    fields: [
      {
        key: 'leftType',
        label: '左值类型',
        type: 'select',
        options: [
          { label: '变量', value: 'var' },
          { label: '字面量', value: 'literal' },
        ],
      },
      { key: 'left', label: '左值', type: 'string', placeholder: 'counter' },
      {
        key: 'operator',
        label: '运算符',
        type: 'select',
        options: [
          { label: '==', value: '==' },
          { label: '!=', value: '!=' },
          { label: '>', value: '>' },
          { label: '>=', value: '>=' },
          { label: '<', value: '<' },
          { label: '<=', value: '<=' },
        ],
      },
      {
        key: 'rightType',
        label: '右值类型',
        type: 'select',
        options: [
          { label: '变量', value: 'var' },
          { label: '字面量', value: 'literal' },
        ],
      },
      { key: 'right', label: '右值', type: 'string', placeholder: '10' },
      {
        key: 'maxIterations',
        label: '最大循环次数',
        type: 'number',
        min: 1,
        step: 1,
        description: '防止 while 条件长期为真导致死循环。',
      },
    ],
  },
  imageMatch: {
    label: '图像匹配',
    description: '在截图或指定源图中查找模板图。',
    defaultParams: {
      sourcePath: '',
      templatePath: '',
      threshold: 0.99,
      timeoutMs: 10000,
      pollMs: 16,
      confirmFrames: 2,
      clickOnMatch: false,
      clickTimes: 1,
    },
    fields: [
      {
        key: 'sourcePath',
        label: '源图路径(留空=实时截图)',
        type: 'string',
        placeholder: 'D:\\screens\\current.png',
      },
      {
        key: 'templatePath',
        label: '模板图路径',
        type: 'string',
        placeholder: 'D:\\templates\\button.png',
      },
      {
        key: 'threshold',
        label: '阈值(0~1)',
        type: 'number',
        min: 0,
        max: 1,
        step: 0.01,
      },
      { key: 'timeoutMs', label: '超时(ms)', type: 'number', min: 0, step: 100 },
      {
        key: 'pollMs',
        label: '轮询间隔(ms)',
        type: 'number',
        min: 1,
        step: 1,
        description: '建议 8~33ms；越小越实时，但 CPU 占用更高。',
      },
      {
        key: 'confirmFrames',
        label: '确认帧数',
        type: 'number',
        min: 1,
        step: 1,
        description: '连续命中达到该帧数才判定成功。',
      },
      { key: 'clickOnMatch', label: '匹配成功后自动点击', type: 'boolean' },
      { key: 'clickTimes', label: '点击次数', type: 'number', min: 1, step: 1 },
    ],
  },
  varDefine: {
    label: '变量定义',
    description: '定义一个变量并给初值。',
    defaultParams: {
      name: 'counter',
      valueType: 'number',
      valueString: 'hello',
      valueNumber: 0,
      valueBoolean: 'false',
      valueJson: 'null',
      value: 0,
    },
    fields: [
      { key: 'name', label: '变量名', type: 'string', placeholder: 'counter' },
      {
        key: 'valueType',
        label: '值类型',
        type: 'select',
        options: [
          { label: '字符串', value: 'string' },
          { label: '数字', value: 'number' },
          { label: '布尔', value: 'boolean' },
          { label: 'JSON', value: 'json' },
        ],
      },
      { key: 'valueString', label: '初始值(字符串)', type: 'string', placeholder: 'hello' },
      { key: 'valueNumber', label: '初始值(数字)', type: 'number', step: 1 },
      {
        key: 'valueBoolean',
        label: '初始值(布尔)',
        type: 'select',
        options: [
          { label: 'true', value: 'true' },
          { label: 'false', value: 'false' },
        ],
      },
      { key: 'valueJson', label: '初始值(JSON)', type: 'json', description: '对象/数组等复杂值。' },
    ],
  },
  varSet: {
    label: '变量赋值',
    description: '修改变量值。',
    defaultParams: {
      name: 'counter',
      valueType: 'number',
      valueString: 'world',
      valueNumber: 1,
      valueBoolean: 'false',
      valueJson: 'null',
      value: 1,
    },
    fields: [
      { key: 'name', label: '变量名', type: 'string', placeholder: 'counter' },
      {
        key: 'valueType',
        label: '值类型',
        type: 'select',
        options: [
          { label: '字符串', value: 'string' },
          { label: '数字', value: 'number' },
          { label: '布尔', value: 'boolean' },
          { label: 'JSON', value: 'json' },
        ],
      },
      { key: 'valueString', label: '新值(字符串)', type: 'string', placeholder: 'world' },
      { key: 'valueNumber', label: '新值(数字)', type: 'number', step: 1 },
      {
        key: 'valueBoolean',
        label: '新值(布尔)',
        type: 'select',
        options: [
          { label: 'true', value: 'true' },
          { label: 'false', value: 'false' },
        ],
      },
      { key: 'valueJson', label: '新值(JSON)', type: 'json', description: '对象/数组等复杂值。' },
    ],
  },
  varMath: {
    label: '变量运算',
    description: '对变量执行扩展数值运算（算术/比较/逻辑/位运算/常见函数）。',
    defaultParams: {
      name: 'counter',
      operation: 'add',
      operandType: 'number',
      operandNumber: 1,
      operandString: '1',
      operandBoolean: 'false',
      operandJson: '1',
      operand: 1,
      assignToVariable: true,
    },
    fields: [
      { key: 'name', label: '变量名', type: 'string', placeholder: 'counter' },
      {
        key: 'operation',
        label: '运算符',
        type: 'select',
        options: [
          { label: '加 (+)', value: 'add' },
          { label: '减 (-)', value: 'sub' },
          { label: '乘 (*)', value: 'mul' },
          { label: '除 (/)', value: 'div' },
          { label: '取模 (mod)', value: 'mod' },
          { label: '余数 (rem)', value: 'rem' },
          { label: '整除 (floorDiv)', value: 'floorDiv' },
          { label: '幂运算 (pow)', value: 'pow' },
          { label: '最大值 (max)', value: 'max' },
          { label: '最小值 (min)', value: 'min' },
          { label: '斜边 (hypot)', value: 'hypot' },
          { label: 'atan2', value: 'atan2' },
          { label: '相等 (==)', value: 'eq' },
          { label: '不等 (!=)', value: 'ne' },
          { label: '大于 (>)', value: 'gt' },
          { label: '大于等于 (>=)', value: 'ge' },
          { label: '小于 (<)', value: 'lt' },
          { label: '小于等于 (<=)', value: 'le' },
          { label: '逻辑与 (&&)', value: 'land' },
          { label: '逻辑或 (||)', value: 'lor' },
          { label: '逻辑异或', value: 'lxor' },
          { label: '按位与 (&)', value: 'band' },
          { label: '按位或 (|)', value: 'bor' },
          { label: '按位异或 (^)', value: 'bxor' },
          { label: '左移 (<<)', value: 'shl' },
          { label: '右移 (>>)', value: 'shr' },
          { label: '无符号右移 (>>> )', value: 'ushr' },
          { label: '取反符号 (-x)', value: 'neg' },
          { label: '绝对值 (abs)', value: 'abs' },
          { label: '符号 (sign)', value: 'sign' },
          { label: '平方 (x²)', value: 'square' },
          { label: '立方 (x³)', value: 'cube' },
          { label: '平方根 (sqrt)', value: 'sqrt' },
          { label: '立方根 (cbrt)', value: 'cbrt' },
          { label: '指数 (exp)', value: 'exp' },
          { label: '自然对数 (ln)', value: 'ln' },
          { label: '对数 log2', value: 'log2' },
          { label: '对数 log10', value: 'log10' },
          { label: '正弦 (sin)', value: 'sin' },
          { label: '余弦 (cos)', value: 'cos' },
          { label: '正切 (tan)', value: 'tan' },
          { label: '反正弦 (asin)', value: 'asin' },
          { label: '反余弦 (acos)', value: 'acos' },
          { label: '反正切 (atan)', value: 'atan' },
          { label: '向上取整 (ceil)', value: 'ceil' },
          { label: '向下取整 (floor)', value: 'floor' },
          { label: '四舍五入 (round)', value: 'round' },
          { label: '截断 (trunc)', value: 'trunc' },
          { label: '小数部分 (frac)', value: 'frac' },
          { label: '倒数 (1/x)', value: 'recip' },
          { label: '逻辑非 (!x)', value: 'lnot' },
          { label: '按位非 (~x)', value: 'bnot' },
          { label: '赋值 (= 操作数)', value: 'set' },
        ],
      },
      {
        key: 'operandType',
        label: '操作数类型',
        type: 'select',
        options: [
          { label: '数字', value: 'number' },
          { label: '字符串', value: 'string' },
          { label: '布尔', value: 'boolean' },
          { label: 'JSON', value: 'json' },
        ],
      },
      { key: 'operandNumber', label: '操作数(数字)', type: 'number', step: 1, description: '一元运算符会忽略该值。' },
      { key: 'operandString', label: '操作数(字符串)', type: 'string', placeholder: '1' },
      {
        key: 'operandBoolean',
        label: '操作数(布尔)',
        type: 'select',
        options: [
          { label: 'true', value: 'true' },
          { label: 'false', value: 'false' },
        ],
      },
      { key: 'operandJson', label: '操作数(JSON)', type: 'json' },
      {
        key: 'assignToVariable',
        label: '是否赋值给原变量',
        type: 'boolean',
        description: '关闭后仅计算并输出日志，不会回写变量。',
      },
    ],
  },
  varGet: {
    label: '获取变量值',
    description: '纯输出节点：读取变量当前值并从 value 触点输出。',
    defaultParams: { name: 'counter' },
    fields: [
      { key: 'name', label: '变量名', type: 'string', placeholder: 'counter' },
    ],
  },
  constValue: {
    label: '常量输出',
    description: '纯输出节点：输出固定常量值。',
    defaultParams: {
      valueType: 'number',
      valueString: 'hello',
      valueNumber: 1,
      valueBoolean: 'false',
      valueJson: 'null',
      value: 1,
    },
    fields: [
      {
        key: 'valueType',
        label: '值类型',
        type: 'select',
        options: [
          { label: '字符串', value: 'string' },
          { label: '数字', value: 'number' },
          { label: '布尔', value: 'boolean' },
          { label: 'JSON', value: 'json' },
        ],
      },
      { key: 'valueString', label: '常量值(字符串)', type: 'string', placeholder: 'hello' },
      { key: 'valueNumber', label: '常量值(数字)', type: 'number', step: 1 },
      {
        key: 'valueBoolean',
        label: '常量值(布尔)',
        type: 'select',
        options: [
          { label: 'true', value: 'true' },
          { label: 'false', value: 'false' },
        ],
      },
      { key: 'valueJson', label: '常量值(JSON)', type: 'json', description: '对象/数组等复杂值。' },
    ],
  },
}

export const getNodeMeta = (kind: NodeKind): NodeMeta => metas[kind]

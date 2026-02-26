import type { NodeKind } from '../types/workflow'

export type ParamFieldType = 'string' | 'number' | 'boolean' | 'select' | 'json' | 'text'

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
    description: '检测到指定窗口时触发。',
    defaultParams: { title: 'Untitled - Notepad', matchMode: 'contains' },
    fields: [
      { key: 'title', label: '窗口标题', type: 'string', placeholder: 'Untitled - Notepad' },
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
  mouseClick: {
    label: '鼠标点击',
    description: '将鼠标移动到坐标并点击。',
    defaultParams: { x: 0, y: 0, times: 1 },
    fields: [
      { key: 'x', label: 'X 坐标', type: 'number', step: 1 },
      { key: 'y', label: 'Y 坐标', type: 'number', step: 1 },
      { key: 'times', label: '点击次数', type: 'number', min: 1, step: 1 },
    ],
  },
  mouseMove: {
    label: '鼠标移动',
    description: '移动鼠标到指定位置。',
    defaultParams: { x: 0, y: 0 },
    fields: [
      { key: 'x', label: 'X 坐标', type: 'number', step: 1 },
      { key: 'y', label: 'Y 坐标', type: 'number', step: 1 },
    ],
  },
  mouseDrag: {
    label: '鼠标拖拽',
    description: '按住鼠标左键从起点拖到终点。',
    defaultParams: { fromX: 0, fromY: 0, toX: 200, toY: 200 },
    fields: [
      { key: 'fromX', label: '起点 X', type: 'number', step: 1 },
      { key: 'fromY', label: '起点 Y', type: 'number', step: 1 },
      { key: 'toX', label: '终点 X', type: 'number', step: 1 },
      { key: 'toY', label: '终点 Y', type: 'number', step: 1 },
    ],
  },
  mouseWheel: {
    label: '鼠标滚轮',
    description: '按步长滚动鼠标滚轮。',
    defaultParams: { vertical: -1 },
    fields: [{ key: 'vertical', label: '滚动值', type: 'number', step: 1 }],
  },
  mouseDown: {
    label: '鼠标按下',
    description: '将鼠标移动到坐标并按下（不松开）鼠标按键。',
    defaultParams: { x: 0, y: 0, button: 'left' },
    fields: [
      { key: 'x', label: 'X 坐标', type: 'number', step: 1 },
      { key: 'y', label: 'Y 坐标', type: 'number', step: 1 },
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
  mouseUp: {
    label: '鼠标松开',
    description: '将鼠标移动到坐标并松开鼠标按键。',
    defaultParams: { x: 0, y: 0, button: 'left' },
    fields: [
      { key: 'x', label: 'X 坐标', type: 'number', step: 1 },
      { key: 'y', label: 'Y 坐标', type: 'number', step: 1 },
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
  keyboardKey: {
    label: '键盘按键',
    description: '模拟单个按键点击。',
    defaultParams: { key: 'Enter' },
    fields: [{ key: 'key', label: '按键', type: 'string', placeholder: 'Enter' }],
  },
  keyboardInput: {
    label: '键盘输入',
    description: '输入一段文本。',
    defaultParams: { text: 'Hello CommandFlow' },
    fields: [{ key: 'text', label: '文本', type: 'string', placeholder: '请输入文本' }],
  },
  keyboardDown: {
    label: '键盘按下',
    description: '按下指定按键（不松开）。可选模拟“长按重复输入”。',
    defaultParams: { key: 'Shift', simulateRepeat: false, repeatCount: 8, repeatIntervalMs: 35 },
    fields: [
      { key: 'key', label: '按键', type: 'string', placeholder: 'Shift' },
      {
        key: 'simulateRepeat',
        label: '模拟长按重复输入',
        type: 'boolean',
        description: '开启后会连续触发多次按键点击，更接近“长按出连字”的效果。',
      },
      { key: 'repeatCount', label: '重复次数', type: 'number', min: 1, step: 1 },
      { key: 'repeatIntervalMs', label: '重复间隔(ms)', type: 'number', min: 1, step: 1 },
    ],
  },
  keyboardUp: {
    label: '键盘松开',
    description: '松开指定按键。',
    defaultParams: { key: 'Shift' },
    fields: [{ key: 'key', label: '按键', type: 'string', placeholder: 'Shift' }],
  },
  shortcut: {
    label: '组合键',
    description: '按修饰键 + 主键执行快捷操作。',
    defaultParams: { modifiers: ['Ctrl'], key: 'S' },
    fields: [
      {
        key: 'modifiers',
        label: '修饰键(JSON数组)',
        type: 'json',
        description: '例如 ["Ctrl", "Shift"]',
      },
      { key: 'key', label: '主键', type: 'string', placeholder: 'S' },
    ],
  },
  screenshot: {
    label: '屏幕截图',
    description: '保存截图到指定地址',
    defaultParams: { path: 'capture.png', fullscreen: false, width: 320, height: 240 },
    fields: [
      { key: 'path', label: '保存地址', type: 'string', placeholder: 'capture.png' },
      { key: 'fullscreen', label: '是否全屏', type: 'boolean' },
      { key: 'width', label: '宽度', type: 'number', min: 1, step: 1 },
      { key: 'height', label: '高度', type: 'number', min: 1, step: 1 },
    ],
  },
  windowActivate: {
    label: '切换窗口',
    description: '可按窗口标题切换，或通过 Alt+Tab 等快捷键切换。',
    defaultParams: {
      switchMode: 'title',
      title: 'CommandFlow-rs',
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
          { label: '按快捷键', value: 'shortcut' },
        ],
      },
      { key: 'title', label: '窗口标题', type: 'string', placeholder: 'CommandFlow-rs' },
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
  fileCopy: {
    label: '复制文件/文件夹',
    description: '复制文件或目录到目标路径。',
    defaultParams: { sourcePath: '', targetPath: '', overwrite: false, recursive: true },
    fields: [
      { key: 'sourcePath', label: '源路径', type: 'string', placeholder: 'C:\\input\\a.txt' },
      { key: 'targetPath', label: '目标路径', type: 'string', placeholder: 'D:\\output\\a.txt' },
      { key: 'overwrite', label: '覆盖已存在目标', type: 'boolean' },
      { key: 'recursive', label: '目录递归复制', type: 'boolean' },
    ],
  },
  fileMove: {
    label: '移动文件/文件夹',
    description: '移动文件或目录到目标路径。',
    defaultParams: { sourcePath: '', targetPath: '', overwrite: false },
    fields: [
      { key: 'sourcePath', label: '源路径', type: 'string', placeholder: 'C:\\input\\a.txt' },
      { key: 'targetPath', label: '目标路径', type: 'string', placeholder: 'D:\\output\\a.txt' },
      { key: 'overwrite', label: '覆盖已存在目标', type: 'boolean' },
    ],
  },
  fileDelete: {
    label: '删除文件/文件夹',
    description: '删除目标文件或目录。',
    defaultParams: { path: '', recursive: true },
    fields: [
      { key: 'path', label: '路径', type: 'string', placeholder: 'D:\\temp\\old-folder' },
      { key: 'recursive', label: '目录递归删除', type: 'boolean' },
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
  delay: {
    label: '等待延时',
    description: '暂停指定时间后继续。',
    defaultParams: { ms: 500 },
    fields: [{ key: 'ms', label: '毫秒', type: 'number', min: 0, step: 100 }],
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
    defaultParams: { name: 'counter', value: 0 },
    fields: [
      { key: 'name', label: '变量名', type: 'string', placeholder: 'counter' },
      { key: 'value', label: '初始值(JSON)', type: 'json' },
    ],
  },
  varSet: {
    label: '变量赋值',
    description: '修改变量值。',
    defaultParams: { name: 'counter', value: 1 },
    fields: [
      { key: 'name', label: '变量名', type: 'string', placeholder: 'counter' },
      { key: 'value', label: '新值(JSON)', type: 'json' },
    ],
  },
  varMath: {
    label: '变量运算',
    description: '对变量执行扩展数值运算（算术/比较/逻辑/位运算/常见函数）。',
    defaultParams: { name: 'counter', operation: 'add', operand: 1 },
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
        key: 'operand',
        label: '操作数',
        type: 'number',
        step: 1,
        description: '一元运算符会忽略该值。',
      },
    ],
  },
}

export const getNodeMeta = (kind: NodeKind): NodeMeta => metas[kind]

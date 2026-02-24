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
    description: '切换到目标窗口并置顶。',
    defaultParams: { title: 'CommandFlow-rs' },
    fields: [{ key: 'title', label: '窗口标题', type: 'string', placeholder: 'CommandFlow-rs' }],
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
    label: '循环',
    description: 'for 循环。',
    defaultParams: { times: 3 },
    fields: [{ key: 'times', label: '循环次数', type: 'number', min: 0, step: 1 }],
  },
  errorHandler: {
    label: '错误处理',
    description: '用于标记错误处理逻辑入口。',
    defaultParams: {},
    fields: [],
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
}

export const getNodeMeta = (kind: NodeKind): NodeMeta => metas[kind]

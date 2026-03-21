import {
  Bot,
  Braces,
  Calculator,
  Camera,
  Clipboard,
  Clock3,
  Code2,
  FileText,
  Globe,
  GitBranch,
  Keyboard,
  MessageSquare,
  Monitor,
  MousePointerClick,
  Play,
  Repeat,
  Rocket,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import type { NodeKind } from '../types/workflow'

export interface NodePaletteItem {
  label: string
  kind: NodeKind
  color: string
  icon: LucideIcon
  category: NodePaletteCategory['title']
}

export interface NodePaletteCategory {
  title: '触发与流程' | '输入控制' | '网页自动化' | '系统与文件' | '变量与数据'
  items: NodePaletteItem[]
}

const categories: NodePaletteCategory[] = [
  {
    title: '触发与流程',
    items: [
      { label: '触发器', kind: 'trigger', color: 'bg-orange-500', icon: Play, category: '触发与流程' },
      { label: '条件处理', kind: 'condition', color: 'bg-rose-500', icon: GitBranch, category: '触发与流程' },
      { label: 'for 循环', kind: 'loop', color: 'bg-fuchsia-500', icon: Repeat, category: '触发与流程' },
      { label: 'while 循环', kind: 'whileLoop', color: 'bg-purple-600', icon: Repeat, category: '触发与流程' },
      { label: 'try/catch/finally', kind: 'tryCatch', color: 'bg-amber-600', icon: GitBranch, category: '触发与流程' },
      { label: '图像匹配', kind: 'imageMatch', color: 'bg-teal-500', icon: Search, category: '触发与流程' },
      { label: 'OCR 文字匹配', kind: 'ocrMatch', color: 'bg-emerald-500', icon: Search, category: '触发与流程' },
    ],
  },
  {
    title: '输入控制',
    items: [
      { label: 'UIA 获取控件', kind: 'uiaElement', color: 'bg-cyan-700', icon: Search, category: '输入控制' },
      { label: '获取鼠标坐标', kind: 'getMousePosition', color: 'bg-sky-500', icon: MousePointerClick, category: '输入控制' },
      { label: '鼠标操作', kind: 'mouseOperation', color: 'bg-cyan-500', icon: MousePointerClick, category: '输入控制' },
      { label: '键盘操作', kind: 'keyboardOperation', color: 'bg-sky-600', icon: Keyboard, category: '输入控制' },
      { label: '回放键鼠预设', kind: 'inputPresetReplay', color: 'bg-cyan-600', icon: Repeat, category: '输入控制' },
    ],
  },
  {
    title: '网页自动化',
    items: [
      { label: '打开网页', kind: 'webOpenPage', color: 'bg-blue-600', icon: Globe, category: '网页自动化' },
      { label: '获取网页对象', kind: 'webGetOpenedPage', color: 'bg-blue-500', icon: Globe, category: '网页自动化' },
      { label: '点击元素(Web)', kind: 'webElementClick', color: 'bg-cyan-600', icon: MousePointerClick, category: '网页自动化' },
      { label: '悬停元素(Web)', kind: 'webElementHover', color: 'bg-sky-600', icon: MousePointerClick, category: '网页自动化' },
      { label: '填写输入框(Web)', kind: 'webInputFill', color: 'bg-indigo-600', icon: Keyboard, category: '网页自动化' },
      { label: '关闭网页', kind: 'webClosePage', color: 'bg-rose-600', icon: Globe, category: '网页自动化' },
    ],
  },
  {
    title: '系统与文件',
    items: [
      { label: '系统操作', kind: 'systemOperation', color: 'bg-red-500', icon: Settings, category: '系统与文件' },
      { label: '屏幕截图', kind: 'screenshot', color: 'bg-indigo-500', icon: Camera, category: '系统与文件' },
      { label: '切换窗口', kind: 'windowActivate', color: 'bg-violet-500', icon: Monitor, category: '系统与文件' },
      { label: '终止程序', kind: 'terminateProcess', color: 'bg-rose-600', icon: Monitor, category: '系统与文件' },
      { label: '启动应用', kind: 'launchApplication', color: 'bg-emerald-600', icon: Rocket, category: '系统与文件' },
      { label: '文件操作', kind: 'fileOperation', color: 'bg-fuchsia-500', icon: FileText, category: '系统与文件' },
      { label: '执行 Python', kind: 'pythonCode', color: 'bg-blue-600', icon: Code2, category: '系统与文件' },
      { label: '读取剪贴板', kind: 'clipboardRead', color: 'bg-emerald-500', icon: Clipboard, category: '系统与文件' },
      { label: '写入剪贴板', kind: 'clipboardWrite', color: 'bg-teal-500', icon: Clipboard, category: '系统与文件' },
      { label: '弹窗提示', kind: 'showMessage', color: 'bg-orange-500', icon: MessageSquare, category: '系统与文件' },
      { label: '等待延时', kind: 'delay', color: 'bg-purple-500', icon: Clock3, category: '系统与文件' },
      { label: 'GUI Agent', kind: 'guiAgent', color: 'bg-violet-600', icon: Bot, category: '系统与文件' },
      { label: 'GUI Agent 元数据解析', kind: 'guiAgentActionParser', color: 'bg-violet-500', icon: Braces, category: '系统与文件' },
    ],
  },
  {
    title: '变量与数据',
    items: [
      { label: '变量定义', kind: 'varDefine', color: 'bg-pink-500', icon: Braces, category: '变量与数据' },
      { label: '变量赋值', kind: 'varSet', color: 'bg-emerald-500', icon: Braces, category: '变量与数据' },
      { label: '变量运算', kind: 'varMath', color: 'bg-teal-500', icon: Calculator, category: '变量与数据' },
      { label: '获取变量值', kind: 'varGet', color: 'bg-cyan-500', icon: Braces, category: '变量与数据' },
      { label: '常量输出', kind: 'constValue', color: 'bg-slate-500', icon: Braces, category: '变量与数据' },
      { label: '当前时间', kind: 'currentTime', color: 'bg-violet-500', icon: Clock3, category: '变量与数据' },
      { label: '提取 JSON 值', kind: 'jsonExtract', color: 'bg-indigo-500', icon: Braces, category: '变量与数据' },
    ],
  },
]

export const NODE_PALETTE_CATEGORIES = categories

export const ALL_NODE_PALETTE_ITEMS = categories.flatMap((category) => category.items)

export const ALL_NODE_KINDS = ALL_NODE_PALETTE_ITEMS.map((item) => item.kind)

export const NODE_PALETTE_ITEM_MAP: Record<NodeKind, NodePaletteItem> = ALL_NODE_PALETTE_ITEMS.reduce(
  (acc, item) => {
    acc[item.kind] = item
    return acc
  },
  {} as Record<NodeKind, NodePaletteItem>,
)

export const getNodePaletteItem = (kind: NodeKind) => NODE_PALETTE_ITEM_MAP[kind]
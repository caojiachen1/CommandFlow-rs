import {
  Bot,
  Braces,
  Calculator,
  Camera,
  Clipboard,
  Clock3,
  Code2,
  Database,
  FileText,
  FolderOpen,
  GitBranch,
  Keyboard,
  Layers,
  MessageSquare,
  Monitor,
  Mouse,
  MousePointerClick,
  Network,
  Play,
  Power,
  Repeat,
  Rocket,
  Search,
  Settings,
  Speaker,
  Sun,
  TerminalSquare,
  Timer,
  Volume2,
  VolumeX,
  Wifi,
  Bluetooth,
  Lock,
  LogOut,
  Moon,
  Zap,
  MonitorCog,
  Terminal,
  Crosshair,
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
  title: '触发器' | '流程控制' | '鼠标' | '键盘' | '控件定位' | '电源管理' | '音频与显示' | '网络' | '系统设置' | '窗口与进程' | '文件与剪贴板' | '脚本与命令' | 'AI 智能体' | '变量与数据'
  icon: LucideIcon
  items: NodePaletteItem[]
}

const categories: NodePaletteCategory[] = [
  {
    title: '触发器',
    icon: Zap,
    items: [
      { label: '手动触发', kind: 'manualTrigger', color: 'bg-orange-500', icon: Play, category: '触发器' },
      { label: '热键触发', kind: 'hotkeyTrigger', color: 'bg-orange-600', icon: Keyboard, category: '触发器' },
      { label: '定时触发', kind: 'timerTrigger', color: 'bg-amber-500', icon: Timer, category: '触发器' },
      { label: '窗口触发', kind: 'windowTrigger', color: 'bg-orange-400', icon: Monitor, category: '触发器' },
    ],
  },
  {
    title: '流程控制',
    icon: GitBranch,
    items: [
      { label: '条件处理', kind: 'condition', color: 'bg-rose-500', icon: GitBranch, category: '流程控制' },
      { label: 'for 循环', kind: 'loop', color: 'bg-fuchsia-500', icon: Repeat, category: '流程控制' },
      { label: 'while 循环', kind: 'whileLoop', color: 'bg-purple-600', icon: Repeat, category: '流程控制' },
      { label: 'try/catch/finally', kind: 'tryCatch', color: 'bg-amber-600', icon: GitBranch, category: '流程控制' },
      { label: '图像匹配', kind: 'imageMatch', color: 'bg-teal-500', icon: Search, category: '流程控制' },
      { label: 'OCR 文字匹配', kind: 'ocrMatch', color: 'bg-emerald-500', icon: Search, category: '流程控制' },
    ],
  },
  {
    title: '鼠标',
    icon: Mouse,
    items: [
      { label: '获取鼠标坐标', kind: 'getMousePosition', color: 'bg-sky-500', icon: MousePointerClick, category: '鼠标' },
      { label: '鼠标操作', kind: 'mouseOperation', color: 'bg-cyan-500', icon: MousePointerClick, category: '鼠标' },
    ],
  },
  {
    title: '键盘',
    icon: Keyboard,
    items: [
      { label: '键盘操作', kind: 'keyboardOperation', color: 'bg-sky-600', icon: Keyboard, category: '键盘' },
      { label: '回放键鼠预设', kind: 'inputPresetReplay', color: 'bg-cyan-600', icon: Repeat, category: '键盘' },
    ],
  },
  {
    title: '控件定位',
    icon: Crosshair,
    items: [
      { label: 'UIA 获取控件', kind: 'uiaElement', color: 'bg-cyan-700', icon: Search, category: '控件定位' },
    ],
  },
  {
    title: '电源管理',
    icon: Power,
    items: [
      { label: '系统关机', kind: 'shutdown', color: 'bg-red-600', icon: Power, category: '电源管理' },
      { label: '系统重启', kind: 'restart', color: 'bg-red-500', icon: Power, category: '电源管理' },
      { label: '系统睡眠', kind: 'sleep', color: 'bg-indigo-500', icon: Moon, category: '电源管理' },
      { label: '系统休眠', kind: 'hibernate', color: 'bg-indigo-600', icon: Moon, category: '电源管理' },
      { label: '锁定系统', kind: 'lock', color: 'bg-gray-600', icon: Lock, category: '电源管理' },
      { label: '注销登录', kind: 'signOut', color: 'bg-gray-500', icon: LogOut, category: '电源管理' },
    ],
  },
  {
    title: '音频与显示',
    icon: Speaker,
    items: [
      { label: '系统音量静音', kind: 'volumeMute', color: 'bg-sky-500', icon: VolumeX, category: '音频与显示' },
      { label: '系统音量设置', kind: 'volumeSet', color: 'bg-sky-600', icon: Volume2, category: '音频与显示' },
      { label: '系统音量增减', kind: 'volumeAdjust', color: 'bg-sky-400', icon: Volume2, category: '音频与显示' },
      { label: '系统亮度设置', kind: 'brightnessSet', color: 'bg-yellow-500', icon: Sun, category: '音频与显示' },
    ],
  },
  {
    title: '网络',
    icon: Network,
    items: [
      { label: 'WiFi 开关', kind: 'wifiSwitch', color: 'bg-blue-500', icon: Wifi, category: '网络' },
      { label: '蓝牙开关', kind: 'bluetoothSwitch', color: 'bg-blue-600', icon: Bluetooth, category: '网络' },
      { label: '网络适配器开关', kind: 'networkAdapterSwitch', color: 'bg-blue-400', icon: Zap, category: '网络' },
    ],
  },
  {
    title: '系统设置',
    icon: Settings,
    items: [
      { label: '系统主题模式', kind: 'theme', color: 'bg-violet-500', icon: MonitorCog, category: '系统设置' },
      { label: '电源计划', kind: 'powerPlan', color: 'bg-green-500', icon: Zap, category: '系统设置' },
      { label: '打开系统设置页', kind: 'openSettings', color: 'bg-teal-500', icon: Settings, category: '系统设置' },
    ],
  },
  {
    title: '窗口与进程',
    icon: Layers,
    items: [
      { label: '屏幕截图', kind: 'screenshot', color: 'bg-indigo-500', icon: Camera, category: '窗口与进程' },
      { label: '切换窗口', kind: 'windowActivate', color: 'bg-violet-500', icon: Monitor, category: '窗口与进程' },
      { label: '终止程序', kind: 'terminateProcess', color: 'bg-rose-600', icon: Monitor, category: '窗口与进程' },
      { label: '启动应用', kind: 'launchApplication', color: 'bg-emerald-600', icon: Rocket, category: '窗口与进程' },
    ],
  },
  {
    title: '文件与剪贴板',
    icon: FolderOpen,
    items: [
      { label: '文件操作', kind: 'fileOperation', color: 'bg-fuchsia-500', icon: FileText, category: '文件与剪贴板' },
      { label: '读取剪贴板', kind: 'clipboardRead', color: 'bg-emerald-500', icon: Clipboard, category: '文件与剪贴板' },
      { label: '写入剪贴板', kind: 'clipboardWrite', color: 'bg-teal-500', icon: Clipboard, category: '文件与剪贴板' },
    ],
  },
  {
    title: '脚本与命令',
    icon: TerminalSquare,
    items: [
      { label: '执行命令', kind: 'runCommand', color: 'bg-zinc-600', icon: Terminal, category: '脚本与命令' },
      { label: '执行 Python', kind: 'pythonCode', color: 'bg-blue-600', icon: Code2, category: '脚本与命令' },
      { label: '弹窗提示', kind: 'showMessage', color: 'bg-orange-500', icon: MessageSquare, category: '脚本与命令' },
      { label: '等待延时', kind: 'delay', color: 'bg-purple-500', icon: Clock3, category: '脚本与命令' },
    ],
  },
  {
    title: 'AI 智能体',
    icon: Bot,
    items: [
      { label: 'GUI Agent', kind: 'guiAgent', color: 'bg-violet-600', icon: Bot, category: 'AI 智能体' },
      { label: 'GUI Agent 元数据解析', kind: 'guiAgentActionParser', color: 'bg-violet-500', icon: Braces, category: 'AI 智能体' },
    ],
  },
  {
    title: '变量与数据',
    icon: Database,
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
import type { NodeKind } from '../types/workflow'

export interface NodePaletteItem {
  label: string
  kind: NodeKind
  color: string
  category: NodePaletteCategory['title']
}

export interface NodePaletteCategory {
  title: '触发与流程' | '输入控制' | '系统与文件' | '变量与数据'
  items: NodePaletteItem[]
}

const categories: NodePaletteCategory[] = [
  {
    title: '触发与流程',
    items: [
      { label: '触发器', kind: 'trigger', color: 'bg-orange-500', category: '触发与流程' },
      { label: '条件处理', kind: 'condition', color: 'bg-rose-500', category: '触发与流程' },
      { label: 'for 循环', kind: 'loop', color: 'bg-fuchsia-500', category: '触发与流程' },
      { label: 'while 循环', kind: 'whileLoop', color: 'bg-purple-600', category: '触发与流程' },
      { label: '图像匹配', kind: 'imageMatch', color: 'bg-teal-500', category: '触发与流程' },
    ],
  },
  {
    title: '输入控制',
    items: [
      { label: '鼠标操作', kind: 'mouseOperation', color: 'bg-cyan-500', category: '输入控制' },
      { label: '键盘操作', kind: 'keyboardOperation', color: 'bg-sky-600', category: '输入控制' },
    ],
  },
  {
    title: '系统与文件',
    items: [
      { label: '系统操作', kind: 'systemOperation', color: 'bg-red-500', category: '系统与文件' },
      { label: '屏幕截图', kind: 'screenshot', color: 'bg-indigo-500', category: '系统与文件' },
      { label: '切换窗口', kind: 'windowActivate', color: 'bg-violet-500', category: '系统与文件' },
      { label: '启动应用', kind: 'launchApplication', color: 'bg-emerald-600', category: '系统与文件' },
      { label: '文件操作', kind: 'fileOperation', color: 'bg-fuchsia-500', category: '系统与文件' },
      { label: '执行命令', kind: 'runCommand', color: 'bg-violet-500', category: '系统与文件' },
      { label: '执行 Python', kind: 'pythonCode', color: 'bg-blue-600', category: '系统与文件' },
      { label: '读取剪贴板', kind: 'clipboardRead', color: 'bg-emerald-500', category: '系统与文件' },
      { label: '写入剪贴板', kind: 'clipboardWrite', color: 'bg-teal-500', category: '系统与文件' },
      { label: '弹窗提示', kind: 'showMessage', color: 'bg-orange-500', category: '系统与文件' },
      { label: '等待延时', kind: 'delay', color: 'bg-purple-500', category: '系统与文件' },
      { label: 'GUI Agent', kind: 'guiAgent', color: 'bg-violet-600', category: '系统与文件' },
      { label: 'GUI Agent 元数据解析', kind: 'guiAgentActionParser', color: 'bg-violet-500', category: '系统与文件' },
    ],
  },
  {
    title: '变量与数据',
    items: [
      { label: '变量定义', kind: 'varDefine', color: 'bg-pink-500', category: '变量与数据' },
      { label: '变量赋值', kind: 'varSet', color: 'bg-emerald-500', category: '变量与数据' },
      { label: '变量运算', kind: 'varMath', color: 'bg-teal-500', category: '变量与数据' },
      { label: '获取变量值', kind: 'varGet', color: 'bg-cyan-500', category: '变量与数据' },
      { label: '常量输出', kind: 'constValue', color: 'bg-slate-500', category: '变量与数据' },
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
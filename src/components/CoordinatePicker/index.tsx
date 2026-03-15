interface CoordinatePickerProps {
  picking: boolean
  onPick: () => void
  elementPicking?: boolean
  onPickElement?: () => void
  compact?: boolean
}

export default function CoordinatePicker({
  picking,
  onPick,
  elementPicking = false,
  onPickElement,
  compact = false,
}: CoordinatePickerProps) {
  return (
    <div className="flex items-center gap-1.5">
      {!compact && <span className="text-[11px] text-slate-500">坐标 / 元素提取</span>}
      <button
        type="button"
        onClick={onPick}
        disabled={picking}
        className="rounded bg-cyan-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-500"
        title="进入坐标拾取模式"
      >
        {picking ? '拾取中...' : '拾取坐标'}
      </button>

      {onPickElement ? (
        <button
          type="button"
          onClick={onPickElement}
          disabled={elementPicking}
          className="rounded bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-500"
          title="进入元素提取模式"
        >
          {elementPicking ? '提取中...' : '提取元素'}
        </button>
      ) : null}
    </div>
  )
}

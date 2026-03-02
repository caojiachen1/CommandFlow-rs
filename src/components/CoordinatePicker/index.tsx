interface CoordinatePickerProps {
  picking: boolean
  onPick: () => void
  compact?: boolean
}

export default function CoordinatePicker({ picking, onPick, compact = false }: CoordinatePickerProps) {
  return (
    <div className="flex items-center gap-1.5">
      {!compact && <span className="text-[11px] text-slate-500">坐标拾取</span>}
      <button
        type="button"
        onClick={onPick}
        disabled={picking}
        className="rounded bg-cyan-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-500"
        title="进入坐标拾取模式"
      >
        {picking ? '拾取中...' : '拾取坐标'}
      </button>
    </div>
  )
}

import { useSettingsStore } from '../../stores/settingsStore'

export default function CoordinatePicker() {
  const { coordinateMode, setCoordinateMode } = useSettingsStore()

  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-slate-500">坐标模式</span>
      <button
        type="button"
        onClick={() => setCoordinateMode(coordinateMode === 'virtualScreen' ? 'activeWindow' : 'virtualScreen')}
        className="rounded border border-slate-300 px-2 py-1 text-[11px] dark:border-neutral-700"
        title="后续将接入全局热键坐标拾取"
      >
        {coordinateMode === 'virtualScreen' ? '物理像素/全局' : '相对窗口'}
      </button>
    </div>
  )
}

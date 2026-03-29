import { Button } from "@fluentui/react-components";

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
  const compactButtonStyle = compact
    ? {
        minWidth: "auto",
        paddingInline: 8,
        height: 24,
      }
    : undefined

  return (
    <div className={compact ? "flex items-center gap-1" : "flex items-center gap-1.5"}>
      {!compact && <span className="text-[11px] text-slate-500">坐标 / 元素提取</span>}
      <Button
        appearance={picking ? "primary" : "secondary"}
        onClick={onPick}
        disabled={picking}
        title="进入坐标拾取模式"
        size="small"
        style={compactButtonStyle}
      >
        {picking ? '拾取中...' : '拾取坐标'}
      </Button>

      {onPickElement ? (
        <Button
          appearance={elementPicking ? "primary" : "secondary"}
          onClick={onPickElement}
          disabled={elementPicking}
          title="进入元素提取模式"
          size="small"
          style={compactButtonStyle}
        >
          {elementPicking ? '提取中...' : '提取元素'}
        </Button>
      ) : null}
    </div>
  )
}

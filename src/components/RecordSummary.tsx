import {
  SOURCE_LABEL,
  burdenLabel,
  formatInZone,
  formatOccurred,
  tagLabel,
  type Checkin,
} from "@/lib/checkins/model";

/** 기록 한 개의 읽기 전용 표시 */
export default function RecordSummary({ record }: { record: Checkin }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-sm text-muted">
        {formatOccurred(record)}
        {record.source === "recall" && <> · {SOURCE_LABEL.recall} (입력: {formatInZone(record.recorded_at, record.recorded_tz)})</>}
        {record.source === "device" && <> · {SOURCE_LABEL.device}</>}
      </p>
      <p className="text-lg font-semibold">{burdenLabel(record.burden)}</p>
      {record.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="생활 항목">
          {record.tags.map((t) => (
            <li key={t} className="rounded-full bg-accent-soft px-3 py-0.5 text-sm">
              {tagLabel(t)}
            </li>
          ))}
        </ul>
      )}
      {record.note && <p className="whitespace-pre-wrap break-words">{record.note}</p>}
    </div>
  );
}

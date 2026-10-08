"use client";

import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { BURDEN_OPTIONS, NOTE_MAX, TAG_OPTIONS, type Burden, type Checkin, type TagCode } from "@/lib/checkins/model";
import { FAIL_TEXT, deleteCheckin, updateCheckin, type FailReason, type RecordsClient } from "@/lib/checkins/api";
import RecordSummary from "./RecordSummary";

type Mode =
  | { kind: "view" }
  | { kind: "edit" }
  | { kind: "confirmDelete" }
  | { kind: "conflictEdit"; server: Checkin }
  | { kind: "conflictDelete" };

interface Edit {
  burden: Burden;
  tags: TagCode[];
  note: string;
}

export default function RecordItem({
  record,
  onReplace,
  onRemove,
}: {
  record: Checkin;
  onReplace: (r: Checkin) => void;
  onRemove: (id: string) => void;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [edit, setEdit] = useState<Edit>({ burden: record.burden, tags: record.tags, note: record.note ?? "" });
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<FailReason | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const client = () => getBrowserClient() as unknown as RecordsClient | null;

  function startEdit() {
    setEdit({ burden: record.burden, tags: record.tags, note: record.note ?? "" });
    setFail(null);
    setNotice(null);
    setMode({ kind: "edit" });
  }

  async function save(expectedVersion: number) {
    const c = client();
    if (!c) return;
    setBusy(true);
    setFail(null);
    const res = await updateCheckin(c, { id: record.id, expectedVersion, ...edit });
    setBusy(false);
    if (res.kind === "saved") {
      onReplace(res.record);
      setMode({ kind: "view" });
      setNotice("고친 내용을 저장했어요.");
    } else if (res.kind === "conflict") {
      // 다른 기기에서 먼저 바뀜: 덮어쓰지 않고 사용자가 고르게 한다. 내가 고친 내용(edit)은 그대로 둔다.
      setMode({ kind: "conflictEdit", server: res.server });
    } else if (res.kind === "not_found") {
      onRemove(record.id);
    } else if (res.kind === "error") {
      setFail(res.reason);
    }
  }

  async function remove() {
    const c = client();
    if (!c) return;
    setBusy(true);
    setFail(null);
    const res = await deleteCheckin(c, { id: record.id, expectedVersion: record.version });
    setBusy(false);
    if (res.kind === "deleted" || res.kind === "not_found") {
      onRemove(record.id);
    } else if (res.kind === "conflict") {
      onReplace(res.server);
      setMode({ kind: "conflictDelete" });
    } else if (res.kind === "error") {
      setFail(res.reason);
    }
  }

  return (
    <li className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      {mode.kind !== "edit" && mode.kind !== "conflictEdit" && <RecordSummary record={record} />}

      {notice && mode.kind === "view" && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}

      {mode.kind === "view" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={startEdit} className="rounded-lg border border-line px-4 py-2 hover:bg-accent-soft">
            고치기
          </button>
          <button
            type="button"
            onClick={() => {
              setFail(null);
              setNotice(null);
              setMode({ kind: "confirmDelete" });
            }}
            className="rounded-lg border border-line px-4 py-2 hover:bg-warn-soft"
          >
            지우기
          </button>
        </div>
      )}

      {(mode.kind === "edit" || mode.kind === "conflictEdit") && (
        <fieldset disabled={busy} className="space-y-4">
          <legend className="sr-only">기록 고치기</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {BURDEN_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={edit.burden === o.value}
                onClick={() => setEdit((e) => ({ ...e, burden: o.value }))}
                className={`min-h-12 rounded-xl border-2 px-4 text-left ${
                  edit.burden === o.value ? "border-accent bg-accent-soft font-medium" : "border-line"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="생활 항목">
            {TAG_OPTIONS.map((t) => {
              const on = edit.tags.includes(t.value);
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setEdit((e) => ({ ...e, tags: on ? e.tags.filter((x) => x !== t.value) : [...e.tags, t.value] }))
                  }
                  className={`min-h-10 rounded-full border px-3.5 ${on ? "border-accent bg-accent-soft" : "border-line"}`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium">메모</span>
            <textarea
              id={`note-${record.id}`}
              rows={3}
              maxLength={NOTE_MAX}
              value={edit.note}
              onChange={(e) => setEdit((x) => ({ ...x, note: e.target.value }))}
              className="w-full rounded-xl border border-line bg-bg px-3 py-2"
            />
          </label>

          {mode.kind === "conflictEdit" ? (
            <div role="alert" className="space-y-3 rounded-xl bg-warn-soft p-4 text-warn">
              <p className="font-semibold">다른 기기에서 이 기록이 먼저 바뀌었어요. 아직 아무것도 덮어쓰지 않았어요.</p>
              <div className="rounded-lg bg-surface p-3 text-fg">
                <p className="mb-1 text-sm text-muted">지금 서버에 있는 내용</p>
                <RecordSummary record={mode.server} />
              </div>
              <p className="text-fg">위 내용 대신 지금 고친 내용으로 바꿀지 골라 주세요.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => save(mode.server.version)}
                  className="rounded-lg bg-accent px-4 py-2 font-semibold text-accent-fg"
                >
                  {busy ? "저장하는 중…" : "내가 고친 내용으로 저장"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onReplace(mode.server);
                    setMode({ kind: "view" });
                    setNotice("다른 기기에서 바뀐 내용을 그대로 두었어요.");
                  }}
                  className="rounded-lg border border-current px-4 py-2"
                >
                  서버 내용 그대로 두기
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => save(record.version)}
                className="min-h-12 rounded-xl bg-accent px-5 font-semibold text-accent-fg"
              >
                {busy ? "저장하는 중…" : "고친 내용 저장"}
              </button>
              <button type="button" onClick={() => setMode({ kind: "view" })} className="min-h-12 rounded-xl px-4 text-muted">
                그만두기
              </button>
            </div>
          )}
        </fieldset>
      )}

      {mode.kind === "confirmDelete" && (
        <div className="space-y-2 rounded-xl bg-warn-soft p-4 text-warn">
          <p>이 기록을 지울까요? 지운 기록은 되돌릴 수 없어요.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="rounded-lg bg-warn px-4 py-2 font-semibold text-white disabled:opacity-60 dark:text-[#1a0f0c]"
            >
              {busy ? "지우는 중…" : "지우기"}
            </button>
            <button type="button" onClick={() => setMode({ kind: "view" })} className="rounded-lg border border-current px-4 py-2">
              그만두기
            </button>
          </div>
        </div>
      )}

      {mode.kind === "conflictDelete" && (
        <div role="alert" className="space-y-2 rounded-xl bg-warn-soft p-4 text-warn">
          <p>다른 기기에서 이 기록이 바뀌어서 지우지 않았어요. 위에 보이는 최신 내용을 확인한 뒤 다시 지워 주세요.</p>
          <button type="button" onClick={() => setMode({ kind: "view" })} className="rounded-lg border border-current px-4 py-2">
            확인했어요
          </button>
        </div>
      )}

      {fail && (
        <p role="alert" className="rounded-xl bg-warn-soft p-3 text-warn">
          {FAIL_TEXT[fail]}
        </p>
      )}
    </li>
  );
}

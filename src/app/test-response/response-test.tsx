"use client";

import { useEffect, useRef, useState } from "react";
import AuthScope from "@/components/AuthScope";
import CheckinForm from "@/components/CheckinForm";
import RecordList from "@/components/RecordList";
import { createResponseLossTest } from "@/lib/checkins/responseTest";

export default function ResponseTest() {
  const control = useRef<ReturnType<typeof createResponseLossTest> | null>(null);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<"form" | "records">("form");
  const [message, setMessage] = useState("준비 중…");
  useEffect(() => {
    const original = window.fetch;
    const test = createResponseLossTest(original.bind(window), setMessage);
    control.current = test;
    window.fetch = test.fetch;
    setReady(true);
    setMessage("가상 데이터를 입력한 뒤 시험 준비 버튼을 누르세요.");
    return () => {
      test.cancel();
      if (window.fetch === test.fetch) window.fetch = original;
      control.current = null;
    };
  }, []);
  return <>
    <section className="mb-6 rounded-xl border border-line p-4">
      <h1 className="text-lg font-semibold">응답 유실 시험</h1>
      <p className="my-3">테스트 계정 A와 가상 메모만 사용하세요. 시험 준비 후 첫 저장의 성공 응답만 중단합니다. 실패 안내와 메모 유지를 확인한 뒤 다시 저장하고, 내 기록에서 메모가 한 개인지 확인하세요.</p>
      <button type="button" disabled={!ready} onClick={() => {
        setScreen("form");
        control.current?.arm();
        setMessage("준비됐습니다. 아래 저장하기를 한 번 누르세요.");
      }} className="rounded-lg border border-line px-3 py-2">응답 유실 시험 준비</button>
      <button type="button" onClick={() => {
        control.current?.cancel();
        setMessage("시험 준비를 취소했습니다. 다음 요청은 정상 처리됩니다.");
      }} className="ml-2 rounded-lg border border-line px-3 py-2">시험 준비 취소</button>
      <p role="status" className="mt-3">{message}</p>
      <h2 className="mt-5 font-semibold"> 계정 전환 후 지연 조회 시험</h2>
      <p className="my-3">A로 로그인한 상태에서 지연 조회 시작을 누르세요. 보류 안내가 뜨면 같은 주소의 다른 탭에서 로그아웃 후 B로 로그인하세요. 이 탭은 새로고침하지 마세요. B 기록 확인 후 보류 응답을 전달해도 A 기록이 나타나면 안 됩니다.</p>
      <a href="/today" target="_blank" rel="noopener noreferrer" className="underline">계정 전환용 새 탭 열기</a>
      <button type="button" disabled={!ready} className="ml-2 rounded-lg border border-line px-3 py-2" onClick={() => {
        control.current?.holdNextList();
        setScreen("records");
        setMessage("다음 조회 응답을 보류합니다. 목록이 이미 열렸다면 다시 불러오기를 누르세요.");
      }}>지연 조회 시작</button>
      <button type="button" className="ml-2 rounded-lg border border-line px-3 py-2" onClick={() => control.current?.release()}>보류 응답 전달</button>
    </section>
    {ready && <AuthScope redirectOnLogout={false}>{screen === "form" ? <CheckinForm /> : <RecordList />}</AuthScope>}
  </>;
}

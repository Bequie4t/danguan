import { CONTACTS, HELP_CHECKED_ON, LOCAL_CENTER } from "../contacts";

export const dynamic = "force-static";

export function GET() {
  const text = [
    "당우안 · 도움 연락처",
    `안내 확인 날짜: ${HELP_CHECKED_ON}`,
    "이 파일을 미리 저장하면 인터넷 없이 읽을 수 있어요.",
    "전화 연결에는 통신망이 필요하고, 출처 링크는 인터넷이 필요해요.",
    "운영 방식은 바뀔 수 있으니 온라인 도움 화면에서 최신 안내를 확인해 주세요.",
    "",
    ...CONTACTS.flatMap((c) => [
      `${c.name}: ${c.number}`,
      c.detail,
      ...c.sources.map((s) => `출처: ${s.label}\n${s.url}`),
      "",
    ]),
    LOCAL_CENTER.title,
    LOCAL_CENTER.body,
    ...LOCAL_CENTER.sources.map((s) => `출처: ${s.label}\n${s.url}`),
    "",
    "최신 안내: https://danguan.vercel.app/help",
    "이 안내는 상태를 판단하거나 안전을 보장하지 않아요.",
    "위험하다고 느끼면 망설이지 말고 위 번호로 연락해 주세요.",
    "",
  ].join("\n");

  return new Response(`\uFEFF${text}`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="danguan-help-contacts.txt"',
      "Cache-Control": "public, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

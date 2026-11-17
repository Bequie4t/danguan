// 나눠서 공개: 아직 전문가 검토가 끝나지 않은 화면을 운영 사이트에서만 숨긴다.
// 미리보기·로컬에서는 그대로 보여서 검토와 휴대폰 점검을 계속할 수 있다.
//
// 예약 대본(/booking)의 '걱정 풀기'에는 의료법·상법 내용이 있어 법률 검토 뒤에 연다.
// 검토가 끝나면 BOOKING_REVIEWED 를 true 로 바꾸는 PR 하나로 연다.
export const BOOKING_REVIEWED = false;

/** 예약 대본을 보여 줄지. environment = Vercel이 정하는 VERCEL_ENV ("production" | "preview" | "development" | 없음) */
export function bookingOpen(environment: string | undefined, reviewed: boolean = BOOKING_REVIEWED): boolean {
  if (reviewed) return true;
  return environment !== "production";
}

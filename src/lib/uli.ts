// 울이(고양이 유령)의 모습.
// 울이는 점수나 평가가 아니다. 사용자가 가장 최근에 직접 고른 버거움 하나를 그대로 비춘다.
// - 여러 기록을 평균 내거나 대표값으로 바꾸지 않는다.
// - 기록이 없으면 '괜찮음'으로 바꾸지 않고 기본 모습(rest)을 보여 준다.
import type { Burden } from "./checkins/model";

export type UliState = "light" | "bearable" | "heavy" | "very_heavy" | "unsure" | "rest";

const BY_BURDEN: Record<Burden, UliState> = {
  okay: "light",
  bearable: "bearable",
  heavy: "heavy",
  very_heavy: "very_heavy",
  unsure: "unsure",
};

export function uliStateFor(burden: Burden | null | undefined): UliState {
  if (!burden) return "rest";
  return BY_BURDEN[burden] ?? "rest";
}

export const ULI_LABEL: Record<UliState, string> = {
  light: "가볍게 떠 있는 고양이 유령 울이",
  bearable: "그럭저럭 떠 있는 고양이 유령 울이",
  heavy: "무겁게 내려앉은 고양이 유령 울이",
  very_heavy: "바닥에 녹듯 누워 쉬는 고양이 유령 울이",
  unsure: "고개를 갸웃하는 고양이 유령 울이",
  rest: "조용히 떠 있는 고양이 유령 울이",
};

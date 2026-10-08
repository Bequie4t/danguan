// 도움 화면 연락처 정보.
// - 공식 기관 누리집에서 확인한 내용만 쓴다. 확인한 날짜(checkedOn)와 출처를 함께 둔다.
// - 기관·지역마다 달라질 수 있는 서비스(비용, 연결 방식)는 일괄 보장하지 않는다.
// - 출시 전과 정기적으로 사람이 다시 확인한다. 바꿀 때는 docs/help-sources.md 도 함께 고친다.
// - 이 파일은 Supabase·기록 코드를 import 하지 않는다 (도움 화면은 로그인·저장과 독립).

export const HELP_CHECKED_ON = "2026-10-08";

export interface HelpSource {
  label: string;
  url: string;
}

export interface HelpContact {
  name: string;
  number: string;
  tel: string;
  detail: string;
  sources: HelpSource[];
}

export const CONTACTS: HelpContact[] = [
  {
    name: "자살예방상담전화",
    number: "109",
    tel: "109",
    detail: "24시간 전화 상담. 힘든 마음을 이야기할 수 있어요.",
    sources: [
      {
        label: "보건복지부 보도자료 「분산된 자살예방 상담전화 1월 1일부터 ‘109’로 통합 운영」",
        url: "https://www.mohw.go.kr/board.es?mid=a10503010100&bid=0027&act=view&list_no=1479607&tag=&nPage=1",
      },
      { label: "한국생명존중희망재단", url: "https://www.kfsp.or.kr/" },
    ],
  },
  {
    name: "정신건강위기상담전화",
    number: "1577-0199",
    tel: "15770199",
    detail: "정신건강전문요원 등이 상담해요. 밤과 공휴일에는 광역정신건강복지센터로 연결된다고 안내돼 있어요.",
    sources: [
      {
        label: "보건복지부 「정신건강복지센터 및 정신건강상담전화 운영」",
        url: "https://www.mohw.go.kr/menu.es?mid=a10706040100",
      },
    ],
  },
  {
    name: "긴급 구조·구급",
    number: "119",
    tel: "119",
    detail: "다쳤거나 몸이 위급할 때 (구급·구조)",
    sources: [{ label: "소방청 「119 신고 방법」", url: "https://www.nfa.go.kr/nfa/safetyinfo/emergencyservice/119emergencydeclaration/" }],
  },
  {
    name: "경찰 긴급신고",
    number: "112",
    tel: "112",
    detail: "지금 안전하지 않을 때 (경찰 긴급신고)",
    sources: [{ label: "경찰청", url: "https://www.police.go.kr/" }],
  },
];

export const LOCAL_CENTER = {
  title: "가까운 곳에서 상담을 알아보고 싶다면",
  body:
    "시·군·구마다 정신건강복지센터가 있어요. 지역 주민이 상담을 문의할 수 있다고 안내돼 있어요. " +
    "상담 방식, 비용, 예약 여부는 센터마다 다를 수 있으니 사는 지역 센터에 직접 확인해 주세요.",
  sources: [
    {
      label: "보건복지부 「정신건강복지센터 및 정신건강상담전화 운영」",
      url: "https://www.mohw.go.kr/menu.es?mid=a10706040100",
    },
  ] as HelpSource[],
};

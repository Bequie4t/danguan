// 울이: 404 blue의 고양이 유령 캐릭터.
// 색은 globals.css의 --uli-* 변수에서 가져와 밝은/어두운 화면을 모두 따른다.
// 그림만 그린다. 상태 계산은 src/lib/uli.ts 에서 한다 (점수·평가 아님).
// React를 직접 가져와 Next 밖(단위 시험)에서도 그림을 그릴 수 있게 한다.
import * as React from "react";
import { ULI_LABEL, type UliState } from "@/lib/uli";

const INK = "var(--uli-ink)";
const STROKE = { stroke: INK, strokeWidth: 2.6, strokeLinejoin: "round" as const };

function Gradient({ id, stops }: { id: string; stops: [string, string, string] }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={stops[0]} />
        <stop offset="0.5" stopColor={stops[1]} />
        <stop offset="1" stopColor={stops[2]} />
      </linearGradient>
    </defs>
  );
}

function Ears({ y = 0, droop = false, fill = "var(--uli-top)" }: { y?: number; droop?: boolean; fill?: string }) {
  if (droop) {
    return (
      <g>
        <path d="M42 52L28 38L52 42Z" fill={fill} {...STROKE} />
        <path d="M78 52L92 38L68 42Z" fill={fill} {...STROKE} />
        <path d="M28 38L36 46L39 40Z" fill="var(--uli-tip)" />
        <path d="M92 38L84 46L81 40Z" fill="var(--uli-tip)" />
      </g>
    );
  }
  return (
    <g transform={`translate(0 ${y})`}>
      <path d="M41 44L37 20L56 32Z" fill={fill} {...STROKE} />
      <path d="M79 44L83 20L64 32Z" fill={fill} {...STROKE} />
      <path d="M37 20L39.5 31L45 27Z" fill="var(--uli-tip)" />
      <path d="M83 20L80.5 31L75 27Z" fill="var(--uli-tip)" />
    </g>
  );
}

function Blush({ y, left = 44, right = 76 }: { y: number; left?: number; right?: number }) {
  return (
    <g fill="var(--uli-blush)">
      <ellipse cx={left} cy={y} rx="4" ry="2.2" />
      <ellipse cx={right} cy={y} rx="4" ry="2.2" />
    </g>
  );
}

const STANDING_BODY =
  "M34 92V60C34 38 46 27 60 27C74 27 86 38 86 60V92q-5.2 8-10.4 0q-5.2 8-10.4 0q-5.2 8-10.4 0q-5.2 8-10.4 0q-5.2 8-10.4 0Z";

function Figure({ state, gid }: { state: UliState; gid: string }) {
  const g = `url(#${gid})`;
  switch (state) {
    case "light":
      return (
        <>
          <Gradient id={gid} stops={["var(--uli-top)", "var(--uli-mid)", "var(--uli-low)"]} />
          <ellipse cx="60" cy="112" rx="15" ry="2.6" fill="var(--uli-shadow)" />
          <g transform="translate(0 -6)">
            <Ears />
            <path d={STANDING_BODY} fill={g} {...STROKE} />
            <rect x="48.5" y="54" width="5" height="10" rx="2.5" fill={INK} />
            <rect x="66.5" y="54" width="5" height="10" rx="2.5" fill={INK} />
            <path d="M57 68q1.5 2.6 3 0q1.5 2.6 3 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
            <Blush y={67} />
          </g>
          <path d="M95 34l5-3M97 44h6M22 40l-5-2" stroke="var(--uli-mute)" strokeWidth="2" strokeLinecap="round" />
        </>
      );
    case "heavy":
      return (
        <>
          <Gradient id={gid} stops={["var(--uli-top)", "var(--uli-low)", "var(--uli-deep)"]} />
          <ellipse cx="60" cy="108" rx="30" ry="3.2" fill="var(--uli-shadow)" />
          <Ears droop />
          <path
            d="M31 100V70C31 51 44 42 60 42C76 42 89 51 89 70V100q-5.8 7-11.6 0q-5.8 7-11.6 0q-5.8 7-11.6 0q-5.8 7-11.6 0q-5.8 7-11.6 0Z"
            fill={g}
            {...STROKE}
          />
          <path d="M47 67h7M66 67h7" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M57 77q3-2.4 6 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          <Blush y={75} left={43} right={77} />
        </>
      );
    case "very_heavy":
      return (
        <>
          <Gradient id={gid} stops={["var(--uli-mid)", "var(--uli-low)", "var(--uli-deep)"]} />
          <ellipse cx="60" cy="108" rx="48" ry="3.2" fill="var(--uli-shadow)" />
          <path d="M42 84L35 70L52 80Z" fill="var(--uli-mid)" {...STROKE} />
          <path d="M78 84L85 70L68 80Z" fill="var(--uli-mid)" {...STROKE} />
          <path
            d="M14 102C14 88 32 79 60 79C88 79 106 88 106 102q-9.2 6-18.4 0q-9.2 6-18.4 0q-9.2 6-18.4 0q-9.2 6-18.4 0q-9.2 6-18.4 0Z"
            fill={g}
            {...STROKE}
          />
          <path d="M46 92q4 3 8 0M66 92q4 3 8 0" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          <Blush y={96} left={40} right={80} />
          <path d="M88 60h8l-8 8h8M98 50h6l-6 6h6" fill="none" stroke="var(--uli-mute)" strokeWidth="1.6" strokeLinejoin="round" />
        </>
      );
    case "unsure":
      return (
        <>
          <Gradient id={gid} stops={["var(--uli-top)", "var(--uli-mid)", "var(--uli-low)"]} />
          <ellipse cx="58" cy="110" rx="20" ry="3" fill="var(--uli-shadow)" />
          <g transform="rotate(-9 60 64)">
            <Ears y={2} />
            <path d={STANDING_BODY} transform="translate(0 2)" fill={g} {...STROKE} />
            <rect x="51.5" y="57" width="5" height="9" rx="2.5" fill={INK} />
            <rect x="69.5" y="57" width="5" height="9" rx="2.5" fill={INK} />
            <circle cx="62" cy="72" r="2" fill="none" stroke={INK} strokeWidth="2" />
            <Blush y={70} left={45} right={78} />
          </g>
          <circle cx="98" cy="22" r="10" fill="var(--uli-shadow)" />
          <path d="M94.5 19a3.5 3.5 0 1 1 4.5 3.4V25M99 28.5v.5" fill="none" stroke="var(--uli-tip)" strokeWidth="2" strokeLinecap="round" />
        </>
      );
    case "bearable":
    case "rest":
    default:
      return (
        <>
          <Gradient id={gid} stops={["var(--uli-top)", "var(--uli-mid)", "var(--uli-low)"]} />
          <ellipse cx="60" cy="110" rx="20" ry="3" fill="var(--uli-shadow)" />
          <Ears y={2} />
          <path d={STANDING_BODY} transform="translate(0 2)" fill={g} {...STROKE} />
          <rect x="48.5" y="57" width="5" height="9" rx="2.5" fill={INK} />
          <rect x="66.5" y="57" width="5" height="9" rx="2.5" fill={INK} />
          {state === "rest" ? (
            <path d="M57 70q1.5 2.2 3 0q1.5 2.2 3 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          ) : (
            <path d="M57 71h6" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          )}
          <Blush y={70} />
        </>
      );
  }
}

export default function Uli({
  state,
  size = 160,
  decorative = false,
}: {
  state: UliState;
  size?: number;
  /** 옆에 같은 내용을 글로 보여 줄 때 true: 화면 낭독기가 두 번 읽지 않게 한다. */
  decorative?: boolean;
}) {
  const label = ULI_LABEL[state];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    >
      <Figure state={state} gid={`uli-grad-${state}`} />
    </svg>
  );
}

"use client";

import { Component, type ReactNode } from "react";

/**
 * 머리글의 부가 부품(계정 메뉴 등)이 오류를 내도 그 부품만 숨기고 화면 나머지는 그대로 둔다.
 * 오류 내용은 기록하거나 밖으로 보내지 않는다.
 */
export default class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // 일부러 아무것도 하지 않는다 (콘솔·오류 리포트로 보내지 않음).
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

"use client";

import { Component, type ReactNode } from "react";

/**
 * Safety net around the guided tour. If anything in the tour throws during
 * render, this catches it and renders NOTHING — the tour disables itself and the
 * rest of the app keeps working. A tour bug can never blank or break the app.
 */
export class TourBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Non-fatal — log for later, keep the app alive.
    console.error("[tour] disabled after an error:", error);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

import * as FramerMotion from "framer-motion";
import * as LucideReact from "lucide-react";
import * as React from "react";

/**
 * Scope for react-live. Streamed code often uses hooks without `React.useState`;
 * those names must exist in scope because imports are stripped before eval.
 */
export const livePreviewScope = {
  ...LucideReact,
  ...FramerMotion,
  React,
  useState: React.useState,
  useEffect: React.useEffect,
  useLayoutEffect: React.useLayoutEffect,
  useCallback: React.useCallback,
  useMemo: React.useMemo,
  useRef: React.useRef,
  useContext: React.useContext,
  useReducer: React.useReducer,
  useId: React.useId,
  useTransition: React.useTransition,
  useDeferredValue: React.useDeferredValue,
  useSyncExternalStore: React.useSyncExternalStore,
  useImperativeHandle: React.useImperativeHandle,
  useInsertionEffect: React.useInsertionEffect,
  Fragment: React.Fragment,
  createElement: React.createElement,
  memo: React.memo,
  forwardRef: React.forwardRef,
  lazy: React.lazy,
  Suspense: React.Suspense,
};

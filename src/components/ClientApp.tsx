"use client";

import dynamic from "next/dynamic";

// The app is a local, fully client-side workspace: skip SSR to avoid hydration mismatches.
export const ClientApp = dynamic(() => import("./App").then((m) => m.App), { ssr: false });

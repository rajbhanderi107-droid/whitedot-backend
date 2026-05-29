import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { sendSuccess } from "../utils/apiResponse.js";

/* ───────────────────────────────────────────────────────────────────────────
   All-in-one Google overview — DYNAMIC FLOW.

   Returns a list of "sources". The frontend renders whatever this sends, so to
   add a metric or a whole source you only edit this file.

   - logins: LIVE now — derived from the DB (users + Google login activity).
   - analytics / search-console / ads: report connected:false with a setup hint
     until the matching Google API client + credentials are wired. Flip each to
     connected:true and fill `metrics` once the API call is implemented; the UI
     needs no change.
   ─────────────────────────────────────────────────────────────────────────── */

interface GoogleMetric {
  label: string;
  value: string | number;
  delta?: string;
  hint?: string;
}
interface GoogleSource {
  key: string;
  title: string;
  connected: boolean;
  setupHint?: string;
  consoleUrl?: string;
  metrics: GoogleMetric[];
  rows?: Array<Record<string, string | number>>;
  rowColumns?: Array<{ key: string; label: string }>;
}

const has = (k: string) => Boolean(process.env[k] && process.env[k]!.trim());

async function buildLoginsSource(): Promise<GoogleSource> {
  const since = new Date();
  since.setDate(since.getDate() - 28);

  const [totalUsers, activeUsers, googleLogins28d, recentLogins] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.activityLog.count({
      where: { action: { contains: "LOGIN", mode: "insensitive" }, createdAt: { gte: since } },
    }),
    prisma.activityLog.findMany({
      where: { action: { contains: "LOGIN", mode: "insensitive" } },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  return {
    key: "logins",
    title: "Admin Logins",
    connected: true,
    metrics: [
      { label: "Admin users", value: totalUsers },
      { label: "Active users", value: activeUsers },
      { label: "Logins (28d)", value: googleLogins28d },
    ],
    rowColumns: [
      { key: "who", label: "User" },
      { key: "action", label: "Action" },
      { key: "when", label: "When" },
    ],
    rows: recentLogins.map((l) => ({
      who: l.user?.name || l.user?.email || "Unknown",
      action: l.action.replace(/_/g, " ").toLowerCase(),
      when: new Date(l.createdAt).toLocaleString(),
    })),
  };
}

function buildApiSource(
  key: string,
  title: string,
  envKeys: string[],
  consoleUrl: string,
  setupHint: string,
): GoogleSource {
  const ready = envKeys.every(has);
  return {
    key,
    title,
    connected: false, // flip to `ready` once the live API call is implemented
    setupHint: ready
      ? "Credentials detected. Live API fetch not implemented yet — add the Google client call in google.controller.ts."
      : setupHint,
    consoleUrl,
    metrics: [],
  };
}

export async function getGoogleOverview(_req: Request, res: Response) {
  const sources: GoogleSource[] = [
    await buildLoginsSource(),
    buildApiSource(
      "analytics",
      "Analytics (GA4)",
      ["GA4_PROPERTY_ID", "GOOGLE_APPLICATION_CREDENTIALS"],
      "https://analytics.google.com/",
      "Set GA4_PROPERTY_ID + a service-account key (GOOGLE_APPLICATION_CREDENTIALS) and add @google-analytics/data to fetch traffic, users and pageviews.",
    ),
    buildApiSource(
      "search-console",
      "Search Console",
      ["GSC_SITE_URL", "GOOGLE_APPLICATION_CREDENTIALS"],
      "https://search.google.com/search-console",
      "Set GSC_SITE_URL + a service-account key and add the Search Console API to fetch queries, impressions, clicks and rankings.",
    ),
    buildApiSource(
      "ads",
      "Google Ads",
      ["GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_REFRESH_TOKEN"],
      "https://ads.google.com/",
      "Set GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_DEVELOPER_TOKEN + an OAuth refresh token and add google-ads-api to fetch campaign spend and performance.",
    ),
  ];

  return sendSuccess(res, {
    range: "Last 28 days",
    generatedAt: new Date().toISOString(),
    sources,
  });
}

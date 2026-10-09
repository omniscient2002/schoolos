/* ============================================================
   Capabilities — the decoupling contract client.
   Asks the server which rails/plugins are actually configured,
   so optional features (SMS, WhatsApp, Razorpay, library,
   transport, files) HIDE themselves instead of erroring.
   Non-technical users should never see a dead feature.
   ============================================================ */
import { apiGet } from './liveApi';


export interface Capabilities {
  rails: {
    /* `sandbox` means the rail is on its default `logger` provider: it records the message and
       reports success, but nothing is sent. `configured` is false in that state, so a school is
       never told SMS is connected while its notices go to a log. */
    sms: { configured: boolean; provider: string; sandbox?: boolean };
    whatsapp: { configured: boolean; provider: string; sandbox?: boolean };
    razorpay: { configured: boolean };
    files: { configured: boolean };
  };
  plugins: Record<string, { enabled: boolean }>;
}

let memo: Capabilities | null = null;

/** Fetch once per session; falls back to "nothing optional" on any failure,
 *  so a cold/broken capabilities door degrades to hiding optional features,
 *  never to showing them broken. */
export async function getCapabilities(force = false): Promise<Capabilities> {
  if (memo && !force) return memo;
  try {
    const data = await apiGet<Capabilities>("/capabilities");
    memo = data;
    return data;
  } catch {
    memo = {
      rails: {
        sms: { configured: false, provider: 'none' },
        whatsapp: { configured: false, provider: 'none' },
        razorpay: { configured: false },
        files: { configured: false },
      },
      plugins: {},
    };
    return memo;
  }
}

export function pluginEnabled(id: string): boolean {
  return memo?.plugins?.[id]?.enabled === true;
}

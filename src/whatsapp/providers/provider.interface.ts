export interface IncomingMessage {
  from: string;
  text: string;
  id?: string;
  profileName?: string;
}

// An outbound message that was sent from the business number outside of the
// bot (e.g. the owner replying directly via the WhatsApp app under coexistence,
// or replying from a WATI inbox). The webhook reports it back to us so we can
// detect human takeover and stand down.
export interface OutboundEcho {
  to: string;
  text: string;
  id?: string;
}

export type SendResult = { id?: string };

export type SignatureDebug = {
  received: string | undefined;
  expected: string | undefined;
  bodyLength: number;
  appSecretConfigured: boolean;
};

export interface WhatsAppProvider {
  sendMessage(to: string, text: string): Promise<SendResult>;
  sendTemplate(
    to: string,
    templateName: string,
    vars: Record<string, string>,
  ): Promise<SendResult>;
  parseWebhook(payload: unknown): IncomingMessage | null;
  parseOutboundEcho?(payload: unknown): OutboundEcho | null;
  validateWebhookSignature(raw: Buffer, headers: Record<string, string | undefined>): boolean;
  // Optional diagnostic — return the received vs. computed signature so we
  // can see why validation failed without dumping the app secret directly.
  debugSignature?(raw: Buffer, headers: Record<string, string | undefined>): SignatureDebug;
  verifyWebhook?(mode: string, token: string, challenge: string): string;
  assignToHuman?(conversationId: string): Promise<void>;
}

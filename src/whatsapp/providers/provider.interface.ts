export interface IncomingMessage {
  from: string;
  text: string;
  id?: string;
  profileName?: string;
}

// An outbound message that was sent from the business number outside of the
// bot — the owner replying directly via the WhatsApp app under coexistence.
// The webhook reports it back to us so we can detect human takeover and
// stand down.
export interface OutboundEcho {
  to: string;
  text: string;
  id?: string;
}

export type SendResult = { id?: string };

export interface WhatsAppProvider {
  sendMessage(to: string, text: string): Promise<SendResult>;
  sendTemplate(
    to: string,
    templateName: string,
    vars: Record<string, string>,
  ): Promise<SendResult>;
  parseWebhook(payload: unknown): IncomingMessage | null;
  parseOutboundEcho?(payload: unknown): OutboundEcho | null;
}

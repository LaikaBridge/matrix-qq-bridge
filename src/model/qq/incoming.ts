export interface IncomingMetadata {
    group: number;
    qq: number;
    senderGlobalname: string;
    senderNickname: string;
}

export type MessageId = number | null;

export type InlineMessageComponent =
    | {
          type: "text";
          data: string;
      }
    | {
          type: "image";
          url: string;
      }
    | {
          type: "at";
          name: string;
          qq: number;
      }
    | {
          type: "unknown";
          placeholder: string;
      };
export type Quote =
    | {
          type: "quoteOnline";
          msgId: MessageId;
      }
    | {
          type: "quoteOffline";
          quoted: MessageBlock;
      };

export type InlineMessage = {
    type: "inline";
    messageId: MessageId;
    quoting: Quote | null;
    messages: InlineMessageComponent[];
};

export type ForwardedMessageLine = {
    senderId: number;
    senderString: string;
    content: MessageBlock;
};
export type ForwardedMessage = {
    type: "forwarded";
    messageId: MessageId;
    forwardedLines: ForwardedMessageLine[];
};

export type MessageBlock = InlineMessage | ForwardedMessage;

export type IncomingMessage =
    | {
          type: "message";
          metadata: IncomingMetadata;
          message: MessageBlock;
          uuid: string;
      }
    | {
          type: "retract";
          group: number;
          retractedId: MessageId;
          uuid: string;
      };

export interface MatrixMsgMeta {
    roomId: string;
    eventId: string;
    uuid: string;
    repliedId: string;
    mentions: string[];
}
export type MatrixURL =
    | {
          type: "mxc";
          url: string;
      }
    | {
          type: "http";
          url: string;
      };

export interface MatrixText {
    type: "m.text";
    body: string;
}

export interface MatrixImage {
    type: "m.image";
    url: MatrixURL;
    mime: string;
}

export interface MatrixUnknown {
    type: "unknown";
    matrixType: string;
}

export interface MatrixRedaction {
    redacted: {
        roomId: string;
        eventId: string;
    };
    reason?: string;
}

export type MatrixMessage = (MatrixText | MatrixImage | MatrixUnknown) &
    MatrixMsgMeta;

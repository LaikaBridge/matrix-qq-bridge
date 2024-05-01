export interface OutgoingMetadata {
    group: number;
    quoting?: number;
}

export type OutgoingMessageComponent =
    | {
          type: "text";
          data: string;
      }
    | {
          type: "image";
          mime: string;
          url: string;
      }
    | {
          type: "at";
          name: string;
          qq: number;
      };

export type OutgoingMessage = {
    metadata: OutgoingMetadata;
    components: OutgoingMessageComponent[];
};

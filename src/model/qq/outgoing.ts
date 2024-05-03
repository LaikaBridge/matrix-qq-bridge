import type { MimedFilePath } from "../../utils/mime";

export interface OutgoingMetadata {
    group: number;
    quoting?: number;
    uuid: string;
}

export type OutgoingMessageComponent =
    | {
          type: "text";
          data: string;
      }
    | {
          type: "image";
          imageId: string;
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

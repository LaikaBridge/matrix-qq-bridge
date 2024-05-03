import type { MimedFilePath } from "../../utils/mime";

export interface TaskFetchImage {
    type: "fetchImage";
    uuid: string;
    url: string;
}

export interface TaskFetchImageResponse {
    type: "fetchImageResponse";
    uuid: string;
    response:
        | {
              type: "success";
              path: MimedFilePath;
          }
        | { type: "error"; reason: string };
}

export interface TaskUploadImage {
    type: "uploadImage";
    file: MimedFilePath;
    group: number;
}
export interface TaskUploadImageResponse {
    type: "uploadImageResponse";
    uuid: string;
    response:
        | {
              type: "success";
              imageId: string;
              url: string;
          }
        | { type: "error"; reason: string };
}

export interface QQMessageSent {
    type: "messageSent";
    uuid: string;
    messageId: number;
}

export type Task = TaskFetchImage | TaskUploadImage;
export type TaskResponse =
    | TaskFetchImageResponse
    | QQMessageSent
    | TaskUploadImageResponse;
